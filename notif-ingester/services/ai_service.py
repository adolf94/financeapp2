import json
import os
import logging
from google import genai
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import AiParsedData
from models.transaction_vector import TransactionVector
from typing import List, Tuple

RUNBOOK_REVIEW_PROMPT = """
You are a personal finance assistant. Your job is to review a batch of manual transaction corrections and propose updates to the user's transaction classification rules runbook (RUNBOOK.md) and/or account descriptions.

Here is the current content of RUNBOOK.md:
---
{current_runbook}
---

Here are the existing accounts in the system:
---
{accounts}
---

The user has manually corrected one or more AI classifications in the New Transaction window. Here are the corrections:
{corrections}

Your task:
1. Analyze why the initial AI classification was wrong based on the user's final corrected accounts, vendors, and the "why" reason they provided.
2. Formulate a proposal. Is this a missing explicit rule for the RUNBOOK? Or is an account description ambiguous and needs updating?
3. Provide a friendly conversational message explaining your proposed changes. Ask for clarification if the user's reason is ambiguous.
4. Output the COMPLETE updated RUNBOOK.md text.
5. If any account descriptions or tags should be updated to help AI classify better, provide a list of updates.

Return ONLY valid JSON matching this schema:
{{
  "message": "Your conversational explanation to the user",
  "questions": ["Any specific questions or clarifications formatted as an array of strings, or empty array"],
  "proposed_runbook": "The full markdown text of the updated runbook",
  "account_description_updates": [
    {{
      "account_id": "string",
      "new_tags": ["string"]
    }}
  ]
}}
"""

RUNBOOK_CHAT_PROMPT = """
You are a personal finance assistant. You are in an active conversation with the user to refine proposed updates to their RUNBOOK.md and account descriptions.

Current RUNBOOK.md:
---
{current_runbook}
---

Accounts context:
---
{accounts}
---

Proposed RUNBOOK.md (from previous turn):
---
{proposed_runbook}
---

Proposed Account Description Updates (from previous turn):
---
{proposed_account_updates}
---

Chat History:
{chat_history}

User's latest message: {user_message}

Your task:
7. CRITICAL: Do NOT alter the `account_description_updates` from their previous state UNLESS the user explicitly comments on them or requests a change in their latest message.

Return ONLY valid JSON matching this schema:
{{
  "message": "Your conversational response",
  "questions": ["Any specific questions or clarifications formatted as an array of strings, or empty array"],
  "proposed_runbook": "The full markdown text of the updated runbook",
  "account_description_updates": [
    {{
      "account_id": "string",
      "new_description": "string",
      "new_tags": ["string"]
    }}
  ]
}}
"""

CLASSIFICATION_PROMPT = """
You are a personal finance assistant. Classify this notification as a financial transaction.

User Runbook (Explicit Rules):
{runbook_content}

Notification: {raw_msg}
Source App / Sender: {app_name}
Full payload: {raw_payload}

Similar past transactions (for context):
{similar_context}

Available accounts:
{accounts}

Existing Vendors:
{vendors}

Return ONLY valid JSON matching this schema:
{{
  "is_financial": boolean (true if this notification represents an actual financial transaction such as a charge, fee, cash withdrawal, transfer, debit, deposit, bill payment, etc. false if it is a general/non-financial notification, marketing promo, security alert, password reset, login notification, OTP code, etc.),
  "vendor": string,
  "amount": number (positive),
  "transaction_type": "Expense"|"Income"|"Transfer"|"Journal",
  "debit_account_id": string (account id from the list above),
  "credit_account_id": string (account id from the list above),
  "suggested_account_creation": [{{"type": "Cash"|"Bank"|"CreditCard"|"Investment"|"Asset"|"Liability"|"Equity"|"Income"|"Expense"|"Adjustment", "account_group": "string", "name": "string", "description": "string", "tags": ["string (3-5 concise tags representing what this account tracks, e.g. 'grab', 'uber', 'taxi')"], "reason": "string (Explain the financial purpose of this account AND why you chose this specific name and group. NEVER mention that it is because an account is missing or not found. Focus purely on what financial activity this account tracks and why it is named this way, e.g., 'To track dining expenses under the Food group'.)"}}] (empty array if no accounts need to be created, or if not financial),
  "notes": string,
  "summary": string (A concise, human-readable summary or description of this transaction based on the context. Do NOT use the raw notification text, null if not financial),
  "confidence": number (0.0-1.0),
  "recipient_account_number": string (recipient/card/account number if mentioned in the message),
  "recipient_account_name": string (recipient name if mentioned in the message),
  "sender_account_number": string (sender account/card/wallet number if mentioned in the message),
  "sender_account_name": string (sender name if mentioned in the message),
  "application": string (name of the app or SMS sender, e.g. BPI, GCash),
  "why": string (brief explanation of why this transaction was classified this way, including which rules, keywords, or vector context matches were used. Do NOT include raw UUIDs in this explanation.)
}}

Rules:
- Apply the User Runbook rules ABOVE everything else.
- For transaction_type: "Expense" means money leaving the user's personal accounts (e.g. purchases, payments to external parties for services/goods). "Income" means money entering the user's personal accounts (e.g. salary, deposits from external parties). "Transfer" means money moving between Asset, Liability, Bank, or Investment accounts. This includes moving money between the user's own accounts (e.g. Bank to Bank, Bank to EWallet/Asset, paying a Credit Card) AND receiving/sending money that affects a Liability/Receivable (e.g. receiving a loan payment from someone else).
- For Expense: debit = expense account, credit = source bank/cash account
- For Income: debit = bank account, credit = income account
- For Transfer: debit = receiving asset/bank account, credit = sending asset/bank account
- Entries must balance (debit amount positive, credit amount negative)
- Vendor Matching: You are provided with a list of "Existing Vendors". Prefer an exact match from this list if the business/person matches. If not found in the list, you may guess or extract a new vendor name.
- Account IDs: DO NOT hallucinate account IDs. Use exact account IDs from the accounts list. If no appropriate account exists, set the debit/credit account ID to null and provide a `suggested_account_creation`.
- Suggested Account Creation: Focus ONLY on the functional, financial purpose of the account AND explain why you chose this specific name and group (e.g., "To categorize online shopping expenses..."). NEVER say "because it doesn't exist" or "no account was found".
- Explanation field ('why'): Do NOT include raw UUIDs (like '018f3a3d-...'). Refer to accounts by their human-readable names.
"""

IS_FINANCIAL_PROMPT = """
You are a personal finance assistant. Determine if this notification represents a financial transaction.
A financial transaction is anything involving movement of money (e.g., payments, expenses, income, transfers, withdrawals, bills).
General notifications, security alerts, login OTPs, promotional messages, etc., are NOT financial transactions.

Notification: {raw_msg}
Source App / Sender: {app_name}

Return ONLY a boolean matching this JSON schema:
{{
  "is_financial": boolean
}}
"""

class AiService:
    def __init__(self):
        api_key = os.environ.get("GEMINI_API_KEY", "")
        self.client = genai.Client(api_key=api_key)

    def _build_context(self, similar_vectors: List[Tuple[TransactionVector, float]]) -> str:
        if not similar_vectors:
            return "No previous similar transactions found."
        
        context_parts = []
        for vec, score in similar_vectors:
            context_parts.append(
                f"Vendor: {vec.vendor}, Category: {vec.category}, "
                f"Summary: {vec.summary}, "
                f"Debit Acc: {vec.debit_account_id}, Credit Acc: {vec.credit_account_id} "
                f"(Similarity: {score:.2f})"
            )
        return "\n".join(context_parts)

    def _format_accounts(self, accounts: list[dict]) -> str:
        if not accounts:
            return "No accounts available."
        
        # Group accounts dynamically by the actual accountType property
        groups = {}
        for acc in accounts:
            acc_type = acc.get('accountType') or 'Other'
            groups.setdefault(acc_type, []).append(acc)
            
        sections = []
        for type_name, acc_list in groups.items():
            type_name_lower = type_name.lower()
            
            # Determine header/label names dynamically based on the account type value
            if 'expense' in type_name_lower:
                header = "Expense\nid | Category | Name | Tags"
            elif 'income' in type_name_lower:
                header = "Income\nid | Category | Name | Tags"
            elif 'creditcard' in type_name_lower or 'credit card' in type_name_lower:
                header = "Credit Card\nid | Group | Name | Tags"
            elif 'asset' in type_name_lower:
                header = "Asset\nid | Group | Name | Tags"
            else:
                header = f"{type_name}\nid | Group | Name | Tags"
                
            lines = []
            for acc in acc_list:
                acc_id = acc.get('id') or ''
                name = acc.get('name') or ''
                tags = acc.get('tags') or []
                tags_str = ", ".join(tags)
                group_info = acc.get('accountGroupName') or acc.get('accountGroupId') or "N/A"
                lines.append(f"{acc_id} | {group_info} | {name} | {tags_str}")
                
            sections.append(f"{header}\n" + "\n".join(lines))
            
        return "\n\n".join(sections)

    async def generate_account_description_async(self, account_name: str, account_type: str, group_name: str, accounts: list[dict], context: str = "", ai_debug: bool = False) -> dict:
        """
        Generates a unique and unambiguous description for a new or existing account.
        """
        formatted_accounts = self._format_accounts(accounts)
        
        context_section = f"\nCurrent Description: {context}\n" if context else ""
        
        prompt = f"""
You are a financial AI assistant. Your task is to generate a short, unambiguous description for a financial account to help another AI correctly classify transactions into it in the future.

Account Name: {account_name}
Account Type: {account_type}
Account Group: {group_name}{context_section}

Here are the existing accounts in the system:
{formatted_accounts}

Please write a 1-2 sentence description for this account that clearly distinguishes it from the existing accounts. Also provide 3-5 concise tags (e.g. 'grab', 'uber', 'taxi') that represent what this account is for.
Return ONLY valid JSON matching this schema:
{{
  "description": "string",
  "tags": ["string"]
}}
"""
        try:
            from google.genai import types

            response = self.client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.2,
                )
            )
            
            if ai_debug or os.environ.get("PROMPT_DEBUG", "").lower() == "true":
                os.makedirs("debug_prompts", exist_ok=True)
                import uuid
                file_path = os.path.join("debug_prompts", f"desc_{uuid.uuid4().hex[:8]}.txt")
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write("=== PROMPT ===\n")
                    f.write(prompt)
                    f.write("\n\n=== RESPONSE ===\n")
                    f.write(response.text)

            return json.loads(response.text)
        except Exception as e:
            import logging
            logging.error(f"Error generating description: {e}")
            return {"description": f"{account_name} ({account_type} - {group_name})", "tags": []}

    def get_default_runbook_content(self) -> str:
        # Load the runbook from the root of the project
        runbook_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "RUNBOOK.md")
        try:
            with open(runbook_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return "No runbook rules available."

    async def is_financial_transaction_async(self, hook: PhoneHookMessage) -> bool:
        app_name = hook.raw_payload.get("notif_pkg") or hook.raw_payload.get("sms_rcv_sender") or hook.raw_payload.get("sms_sender") or ""

        prompt = IS_FINANCIAL_PROMPT.format(
            raw_msg=hook.raw_msg,
            app_name=app_name
        )

        try:
            response = self.client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config={"response_mime_type": "application/json"}
            )
            
            data = json.loads(response.text)
            return data.get("is_financial", True) # Default to true if ambiguous
        except Exception as e:
            logging.error(f"Error checking if financial transaction: {e}")
            return True # If it fails, default to true to let the full flow handle it


    async def classify_async(
        self,
        hook: PhoneHookMessage,
        similar_vectors: List[Tuple[TransactionVector, float]],
        accounts: list[dict],
        runbook_content: str,
        vendors: list[str] = None
    ) -> AiParsedData:
        
        context = self._build_context(similar_vectors)
        accounts_text = self._format_accounts(accounts)
        vendors_text = "\n".join([f"- {v}" for v in vendors]) if vendors else "No existing vendors yet."

        # Resolve a clean app name from the hook data
        app_name = hook.raw_payload.get("notif_pkg") or hook.raw_payload.get("sms_rcv_sender") or hook.raw_payload.get("sms_sender") or ""

        prompt = CLASSIFICATION_PROMPT.format(
            runbook_content=runbook_content,
            raw_msg=hook.raw_msg,
            app_name=app_name,
            raw_payload=json.dumps(hook.raw_payload, indent=2),
            similar_context=context,
            accounts=accounts_text,
            vendors=vendors_text
        )

        response = self.client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"}
        )

        if os.environ.get("PROMPT_DEBUG", "").lower() == "true":
            os.makedirs("debug_prompts", exist_ok=True)
            import uuid
            file_path = os.path.join("debug_prompts", f"classify_{uuid.uuid4().hex[:8]}.txt")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write("=== PROMPT ===\n")
                f.write(prompt)
                f.write("\n\n=== RESPONSE ===\n")
                f.write(response.text)
        
        data = json.loads(response.text)
        
        # Fallback for application field
        if not data.get("application"):
            data["application"] = app_name
            
        return AiParsedData(**data)

    async def start_runbook_review_async(
        self,
        corrections: list[dict],
        accounts: list[dict],
        current_runbook: str
    ) -> dict:
        # Strip out bulky fields like raw_payload and top_matches
        clean_corrections = []
        for c in corrections:
            clean_corrections.append({
                "raw_msg": c.get("raw_msg"),
                "ai_parsed_classification": c.get("ai_parsed"),
                "user_corrected_classification": c.get("user_confirmed"),
            })
            
        corrections_text = json.dumps(clean_corrections, indent=2)
        accounts_text = self._format_accounts(accounts)

        prompt = RUNBOOK_REVIEW_PROMPT.format(
            current_runbook=current_runbook,
            accounts=accounts_text,
            corrections=corrections_text
        )

        response = self.client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"}
        )

        if os.environ.get("PROMPT_DEBUG", "").lower() == "true":
            os.makedirs("debug_prompts", exist_ok=True)
            import uuid
            file_path = os.path.join("debug_prompts", f"review_start_{uuid.uuid4().hex[:8]}.txt")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write("=== PROMPT ===\n")
                f.write(prompt)
                f.write("\n\n=== RESPONSE ===\n")
                f.write(response.text)
        
        return json.loads(response.text)

    async def chat_runbook_review_async(
        self,
        chat_history: list[dict],
        user_message: str,
        proposed_runbook: str,
        proposed_account_updates: list[dict],
        corrections: list[dict],
        accounts: list[dict],
        current_runbook: str
    ) -> dict:
        # Strip out bulky fields like raw_payload and top_matches
        clean_corrections = []
        for c in corrections:
            clean_corrections.append({
                "raw_msg": c.get("raw_msg"),
                "ai_parsed_classification": c.get("ai_parsed"),
                "user_corrected_classification": c.get("user_confirmed"),
            })
            
        corrections_text = json.dumps(clean_corrections, indent=2)
        accounts_text = self._format_accounts(accounts)
        history_text = json.dumps(chat_history, indent=2)
        proposed_updates_text = json.dumps(proposed_account_updates, indent=2)

        prompt = RUNBOOK_CHAT_PROMPT.format(
            current_runbook=current_runbook,
            proposed_runbook=proposed_runbook,
            proposed_account_updates=proposed_updates_text,
            accounts=accounts_text,
            corrections=corrections_text,
            chat_history=history_text,
            user_message=user_message
        )

        response = self.client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"}
        )

        if os.environ.get("PROMPT_DEBUG", "").lower() == "true":
            os.makedirs("debug_prompts", exist_ok=True)
            import uuid
            file_path = os.path.join("debug_prompts", f"review_chat_{uuid.uuid4().hex[:8]}.txt")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write("=== PROMPT ===\n")
                f.write(prompt)
                f.write("\n\n=== RESPONSE ===\n")
                f.write(response.text)
        
        return json.loads(response.text)
