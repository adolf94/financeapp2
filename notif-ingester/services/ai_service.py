import json
import os
import logging
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import AiParsedData
from models.transaction_vector import TransactionVector
from models.prompt_debug_log import PromptDebugLog
from typing import List, Optional, Tuple
from services.llm_provider import LlmProvider, make_provider
from repositories.prompt_debug_repository import IPromptDebugRepository, NoOpPromptDebugRepository

RUNBOOK_REVIEW_PROMPT = """
You are a personal finance assistant. Your job is to review the user's transaction classification rules runbook (RUNBOOK.md) and propose updates to it, as well as account descriptions and vendor tags.

Here is the current content of RUNBOOK.md:
---
{current_runbook}
---

Here are the existing accounts in the system:
---
{accounts}
---

Here are the existing vendors in the system:
---
{vendors}
---

{corrections_section}

Your task:
1. Analyze the context (and any corrections, if provided).
2. Formulate a proposal. If there are corrections, determine if there is a missing explicit rule, ambiguous account description, or missing vendor tags. CRITICAL: If there are NO corrections (ad-hoc chat), DO NOT propose any updates yet; just greet the user and ask what they want to change. You MUST return empty arrays for all updates if there are no corrections.
3. Provide a friendly conversational message explaining your proposed changes (or your greeting). Ask for clarification if needed.
4. Output the COMPLETE updated RUNBOOK.md text (if no changes are needed, output the exact current RUNBOOK.md text).
5. If any account descriptions or tags should be updated, provide a list of updates. (Leave empty if no changes).
6. If any vendor tags should be updated, provide a list of updates. (Leave empty if no changes).

Return ONLY valid JSON matching this schema:
{{
  "message": "Your conversational explanation to the user",
  "questions": ["Any specific questions or clarifications formatted as an array of strings, or empty array"],
  "proposed_runbook": "The full markdown text of the updated runbook",
  "account_description_updates": [
    {{
      "account_id": "string",
      "new_description": "string",
      "new_tags": ["string"]
    }}
  ],
  "vendor_updates": [
    {{
      "vendor_id": "string",
      "new_tags": ["string"]
    }}
  ]
}}
"""

RUNBOOK_CHAT_PROMPT = """
You are a personal finance assistant. You are in an active conversation with the user to refine proposed updates to their RUNBOOK.md, account descriptions, and vendor tags.

Current RUNBOOK.md:
---
{current_runbook}
---

Accounts context:
---
{accounts}
---

Vendors context:
---
{vendors}
---

Proposed RUNBOOK.md (from previous turn):
---
{proposed_runbook}
---

Proposed Account Description Updates (from previous turn):
---
{proposed_account_updates}
---

Proposed Vendor Updates (from previous turn):
---
{proposed_vendor_updates}
---

{corrections_section}

Chat History:
{chat_history}

User's latest message: {user_message}

Your task:
7. CRITICAL: Do NOT alter the `account_description_updates` or `vendor_updates` from their previous state UNLESS the user explicitly comments on them or requests a change in their latest message.

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
  ],
  "vendor_updates": [
    {{
      "vendor_id": "string",
      "new_tags": ["string"]
    }}
  ]
}}
"""

CLASSIFICATION_PROMPT = """
You are a personal finance assistant. Classify this notification as a financial transaction.

Apply the rules below to classify the transaction. Return ONLY valid JSON matching this schema:
{{
  "is_financial":true,
  "vendor": string,
  "vendor_type": "Individual"|"Business"|"Internal" (Individual means a person/friend/relative, Business means a merchant/store/app/company, Internal means a transfer/adjustment/movement between the user's own accounts/assets or the user's own name),
  "suggested_vendor": {{
    "name": "string (suggested name of the vendor, e.g. Starbucks, McDonald's)",
    "tags": ["string (2-4 concise lowercase tags describing what the vendor *does*, e.g. 'coffee', 'cafe', 'food'. Do NOT include the vendor name, country, bank name, or vendor type as tags. Tags must be unique to this vendor's activity and not redundant with each other.)"],
    "type": "Individual"|"Business"|"Internal"
  }} (or null if there is a match in the Existing Vendors list),
  "amount": number (positive),
  "transaction_type": "Expense"|"Income"|"Transfer"|"Journal",
  "debit_account_id": string (account id from the list above),
  "credit_account_id": string (account id from the list above),
  "suggested_account_creation": [{{"type": "Cash"|"Bank"|"CreditCard"|"Investment"|"Asset"|"Liability"|"Equity"|"Income"|"Expense"|"Adjustment", "account_group": "string", "name": "string", "tags": ["string (2-4 concise lowercase tags that are *unique transaction-routing keywords* for this account, e.g. 'grab', 'uber', 'taxi'. Rules: (1) Do NOT repeat the account name, account type, group name, bank name, country, or currency as tags. (2) Do NOT use tags already covered by the vendor's tags — account tags should complement, not duplicate vendor tags. (3) Tags must be specific enough to distinguish this account from similar ones.)"]}}] (empty array if no accounts need to be created, or if not financial),
  "notes": string,
  "summary": string (A concise, human-readable summary or description of this transaction based on the context. Do NOT use the raw notification text, null if not financial),
  "confidence": number (0.0-1.0),
  "recipient_account_number": string (recipient/card/account number if mentioned in the message),
  "recipient_account_name": string (recipient name if mentioned in the message),
  "sender_account_number": string (sender account/card/wallet number if mentioned in the message),
  "sender_account_name": string (sender name if mentioned in the message),
  "application": string (name of the app or SMS sender, e.g. BPI, GCash),
  "why": string (provide a concise explanation why this transaction was classified this way, including which rules, keywords, or vector context matches were used. Do NOT include raw UUIDs in this explanation.)
}}

Rules:
- Apply the User Runbook rules ABOVE everything else.
- For transaction_type: "Expense" means money leaving the user's personal accounts (e.g. purchases, payments to external parties for services/goods). "Income" means money entering the user's personal accounts (e.g. salary, deposits from external parties). "Transfer" means money moving between Asset, Liability, Bank, or Investment accounts. This includes moving money between the user's own accounts (e.g. Bank to Bank, Bank to EWallet/Asset, paying a Credit Card) AND receiving/sending money that affects a Liability/Receivable (e.g. receiving a loan payment from someone else).
- For Expense: debit = expense account, credit = source bank/cash account
- For Income: debit = bank account, credit = income account
- For Transfer: debit = receiving asset/bank account, credit = sending asset/bank account
- Entries must balance (debit amount positive, credit amount negative)
- Vendor Matching: You are provided with a list of "Existing Vendors". Prefer an exact match from this list if the business/person matches. If not found in the list, you may guess or extract a new vendor name.
- Suggested Vendor: If the transaction vendor matches one of the "Existing Vendors" (either by exact name or lookup string), set `suggested_vendor` to null. If there is NO match in the existing vendors, you MUST provide a `suggested_vendor` object with proposed name, tags, and type. The type must strictly be one of "Individual", "Business", or "Internal".
- Account IDs: DO NOT hallucinate account IDs. Use exact account IDs from the accounts list. If no appropriate account exists, set the debit/credit account ID to null and provide a `suggested_account_creation`.
- Suggested Account Creation: Focus ONLY on the functional, financial purpose of the account.
- Explanation field ('why'): Do NOT include raw UUIDs (like '018f3a3d-...'). Refer to accounts by their human-readable names. MUST be strictly exactly 2 sentences long.

User Runbook (Explicit Rules):
{runbook_content}

Available accounts:
{accounts}

Existing Vendors:
{vendors}

==================================================
Now, classify the following specific notification transaction:
==================================================

Notification: {raw_msg}
Source App / Sender: {app_name}
Full payload: {raw_payload}

Similar past transactions (for context):
{similar_context}
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
    def __init__(self, debug_repo: Optional[IPromptDebugRepository] = None):
        self.classification_provider = make_provider("CLASSIFICATION")
        self.reasoning_provider = make_provider("REASONING")
        self._debug_repo = debug_repo or NoOpPromptDebugRepository()
        self._prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"

    async def _debug_log(
        self,
        call_type: str,
        provider: LlmProvider,
        prompt: str,
        response_text: str,
        system: Optional[str] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
    ) -> None:
        """Persist a PROMPT_DEBUG entry to CosmosDB (and file as fallback)."""
        if not self._prompt_debug:
            return

        # Try to parse response as JSON for structured querying
        try:
            response_json = json.loads(response_text)
        except Exception:
            response_json = None

        log = PromptDebugLog(
            call_type=call_type,
            provider=provider.provider_label,
            prompt=prompt,
            system=system,
            response=response_text,
            response_json=response_json,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

        # Primary: write to CosmosDB
        await self._debug_repo.add_async(log)

        # Fallback: also write a local file (keeps backward compat for local dev)
        try:
            import uuid
            os.makedirs("debug_prompts", exist_ok=True)
            file_path = os.path.join("debug_prompts", f"{call_type}_{uuid.uuid4().hex[:8]}.json")
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(log.model_dump(by_alias=True, mode="json"), f, indent=2, ensure_ascii=False)
        except Exception as e:
            logging.warning("PROMPT_DEBUG file fallback failed: %s", e)

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

    def _format_vendors(self, vendors: list) -> str:
        if not vendors:
            return "No existing vendors yet."
        vendors_lines = []
        for v in vendors:
            if isinstance(v, dict):
                v_id = v.get("id") or ""
                name = v.get("name") or ""
                tags = ", ".join(v.get("tags") or [])
                tags_str = f" [Tags: {tags}]" if tags else ""
                v_type = v.get("type") or "Business"
                vendors_lines.append(f"{v_id} | {name} (Type: {v_type}){tags_str}")
            else:
                vendors_lines.append(f"- {v}")
        return "\n".join(vendors_lines)

    async def generate_account_description_async(self, account_name: str, account_type: str, group_name: str, accounts: list[dict], context: str = "", ai_debug: bool = False) -> dict:
        """
        Generates a unique and unambiguous description for a new or existing account.
        """
        formatted_accounts = self._format_accounts(accounts)
        
        context_section = f"\nCurrent Description: {context}\n" if context else ""
        
        prompt = f"""
You are a financial AI assistant. Your task is to generate tags for a financial account to help another AI correctly classify transactions into it in the future.

Account Name: {account_name}
Account Type: {account_type}
Account Group: {group_name}{context_section}

Here are the existing accounts in the system:
{formatted_accounts}

Please provide 3-5 concise tags (e.g. 'grab', 'uber', 'taxi') that represent what this account is for.
Return ONLY valid JSON matching this schema:
{{
  "tags": ["string"]
}}
"""
        try:
            response_text, in_tok, out_tok = await self.classification_provider.generate(
                prompt=prompt,
                json_mode=True,
                temperature=0.2,
            )

            await self._debug_log("desc", self.classification_provider, prompt, response_text, input_tokens=in_tok, output_tokens=out_tok)

            data = json.loads(response_text)
            return {"description": "", "tags": data.get("tags", [])}
        except Exception as e:
            import logging
            logging.error(f"Error generating description: {e}")
            return {"description": "", "tags": []}

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
            response_text, in_tok, out_tok = await self.classification_provider.generate(
                prompt=prompt,
                json_mode=True,
            )

            await self._debug_log("is_financial", self.classification_provider, prompt, response_text, input_tokens=in_tok, output_tokens=out_tok)

            data = json.loads(response_text)
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
        vendors: list[dict] | list[str] = None
    ) -> AiParsedData:
        
        context = self._build_context(similar_vectors)
        accounts_text = self._format_accounts(accounts)
        
        vendors_text = self._format_vendors(vendors)

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

        system_instruction = "You are a personal finance assistant. Classify the notification as a financial transaction."

        response_text, in_tok, out_tok = await self.classification_provider.generate(
            prompt=prompt,
            system=system_instruction,
            json_mode=True,
        )

        await self._debug_log(
            "classify",
            self.classification_provider,
            prompt,
            response_text,
            system=system_instruction,
            input_tokens=in_tok,
            output_tokens=out_tok,
        )

        data = json.loads(response_text)
        
        # Fallback for application field
        if not data.get("application"):
            data["application"] = app_name
            
        return AiParsedData(**data)

    async def start_runbook_review_async(
        self,
        corrections: list[dict],
        accounts: list[dict],
        vendors: list[dict],
        current_runbook: str
    ) -> dict:
        
        if corrections:
            clean_corrections = []
            for c in corrections:
                clean_corrections.append({
                    "raw_msg": c.get("raw_msg"),
                    "ai_parsed_classification": c.get("ai_parsed"),
                    "user_corrected_classification": c.get("user_confirmed"),
                })
            corrections_text = json.dumps(clean_corrections, indent=2)
            corrections_section = f"The user has manually corrected one or more AI classifications. Here are the corrections:\n{corrections_text}"
        else:
            corrections_section = "CRITICAL INSTRUCTION: This is an ad-hoc runbook chat. No recent corrections were provided. The user wants to manually update the runbook or some tags directly. DO NOT propose any changes to the runbook, account descriptions, or vendor tags yet. Just greet the user and ask how you can help."

        accounts_text = self._format_accounts(accounts)
        vendors_text = self._format_vendors(vendors)

        prompt = RUNBOOK_REVIEW_PROMPT.format(
            current_runbook=current_runbook,
            accounts=accounts_text,
            vendors=vendors_text,
            corrections_section=corrections_section
        )

        response_text, in_tok, out_tok = await self.reasoning_provider.generate(
            prompt=prompt,
            json_mode=True,
        )

        await self._debug_log("review_start", self.reasoning_provider, prompt, response_text, input_tokens=in_tok, output_tokens=out_tok)

        return json.loads(response_text)

    async def chat_runbook_review_async(
        self,
        chat_history: list[dict],
        user_message: str,
        proposed_runbook: str,
        proposed_account_updates: list[dict],
        proposed_vendor_updates: list[dict],
        corrections: list[dict],
        accounts: list[dict],
        vendors: list[dict],
        current_runbook: str
    ) -> dict:
        
        if corrections:
            clean_corrections = []
            for c in corrections:
                clean_corrections.append({
                    "raw_msg": c.get("raw_msg"),
                    "ai_parsed_classification": c.get("ai_parsed"),
                    "user_corrected_classification": c.get("user_confirmed"),
                })
            corrections_text = json.dumps(clean_corrections, indent=2)
            corrections_section = f"The user has manually corrected one or more AI classifications. Here are the corrections:\n{corrections_text}"
        else:
            corrections_section = "This is an ad-hoc runbook chat. No recent corrections were provided."
            
        accounts_text = self._format_accounts(accounts)
        vendors_text = self._format_vendors(vendors)
        history_text = json.dumps(chat_history, indent=2)
        proposed_account_updates_text = json.dumps(proposed_account_updates, indent=2)
        proposed_vendor_updates_text = json.dumps(proposed_vendor_updates, indent=2)

        prompt = RUNBOOK_CHAT_PROMPT.format(
            current_runbook=current_runbook,
            proposed_runbook=proposed_runbook,
            proposed_account_updates=proposed_account_updates_text,
            proposed_vendor_updates=proposed_vendor_updates_text,
            accounts=accounts_text,
            vendors=vendors_text,
            corrections_section=corrections_section,
            chat_history=history_text,
            user_message=user_message
        )

        response_text, in_tok, out_tok = await self.reasoning_provider.generate(
            prompt=prompt,
            json_mode=True,
        )

        await self._debug_log("review_chat", self.reasoning_provider, prompt, response_text, input_tokens=in_tok, output_tokens=out_tok)

        return json.loads(response_text)
