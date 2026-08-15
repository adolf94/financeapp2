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
from prompts.sms_prompts import SMS_IS_FINANCIAL_PROMPT, SMS_EXTRACTION_PROMPT, SMS_CLASSIFICATION_PROMPT
from prompts.app_prompts import APP_IS_FINANCIAL_PROMPT, APP_CLASSIFICATION_PROMPT
from prompts.email_prompts import EMAIL_CLASSIFICATION_PROMPT

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
You are a personal finance assistant.

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
  "why": string (explain the classification so the user can spot mistakes and provide corrections — mention which runbook rule, keyword, or past transaction match drove each decision. Do NOT include raw UUIDs.)
}}

Rules:
- Apply the User Runbook rules ABOVE everything else.
- For transaction_type: "Expense" means money leaving the user's personal accounts (e.g. purchases, payments to external parties for services/goods). "Income" means money entering the user's personal accounts (e.g. salary, deposits from external parties). "Transfer" means money moving between Asset, Liability, Bank, or Investment accounts. This includes moving money between the user's own accounts (e.g. Bank to Bank, Bank to EWallet/Asset, paying a Credit Card) AND receiving/sending money that affects a Liability/Receivable (e.g. receiving a loan payment from someone else).
- For Expense: debit = expense account, credit = source bank/cash account
- For Income: debit = bank account, credit = income account
- For Transfer: debit = receiving asset/bank account, credit = sending asset/bank account
- Entries must balance (debit amount positive, credit amount negative)


- **Pre-matched Vendors**: You are provided with "Vendor Matches Found" - these vendors were matched based on extracted account numbers/names from the notification text. **STRONGLY PRIORITIZE THESE MATCHES** in your classification. Check their tags to understand what they're for. If a vendor match has high hit counts, it's very likely correct.
- **Vendor Matching**: You are also provided with a list of "Existing Vendors" with their tags. Check if any of these match the transaction vendor. If a vendor from the "Vendor Matches Found" list also appears in "Existing Vendors", that's a strong confirmation.
- **Suggested Vendor**: If the transaction vendor matches one of the "Existing Vendors" (either by exact name or was found in "Vendor Matches Found"), set `suggested_vendor` to null. If there is NO match in the existing vendors or vendor matches, you MUST provide a `suggested_vendor` object with proposed name, tags, and type. The type must strictly be one of "Individual", "Business", or "Internal". When suggesting tags, consider the vendor's purpose and existing vendor tags to maintain consistency.
- **Account IDs**: DO NOT hallucinate account IDs. Use exact account IDs from the accounts list. If no appropriate account exists, set the debit/credit account ID to null and provide a `suggested_account_creation`. CRITICAL: Never invent or guess account IDs. If you are not 100% certain an account ID exists in the provided list, set it to null.
- **Suggested Account Creation**: Focus ONLY on the functional, financial purpose of the account.
- **Explanation field ('why')**: Do NOT include raw UUIDs (like '018f3a3d-...'). Refer to accounts by their human-readable names. Write enough detail that the user can clearly identify what drove each classification decision. Mention if vendor matches influenced your decision.

User Runbook (Explicit Rules):
{runbook_content}

Available accounts:
{accounts}

Existing Vendors:
{vendors}

Vendor Matches Found (via account number/name lookup):
{vendor_matches}

==================================================
Now, classify the following specific notification transaction:
==================================================

Notification: {raw_msg}
Source App / Sender: {app_name}
Full payload: {raw_payload}

Similar past transactions (for context):
{similar_context}
"""

IS_FINANCIAL_PROMPT = APP_IS_FINANCIAL_PROMPT
CLASSIFICATION_PROMPT = APP_CLASSIFICATION_PROMPT


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
        notification_type: Optional[str] = None,
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
            notification_type=notification_type,
        )

        # Primary: write to CosmosDB
        await self._debug_repo.add_async(log)

        # Fallback: also write a local file (keeps backward compat for local dev)
        try:
            import uuid
            os.makedirs("debug_prompts", exist_ok=True)
            prefix = f"{notification_type}_" if notification_type else ""
            file_name = f"{prefix}{call_type}_{uuid.uuid4().hex[:8]}.md"
            file_path = os.path.join("debug_prompts", file_name)
            
            yaml_lines = [
                "---",
                f"timestamp: '{log.timestamp.isoformat()}'",
                f"call_type: '{call_type}'",
                f"notification_type: '{notification_type}'" if notification_type else "notification_type: null",
                f"provider: '{provider.provider_label}'",
                f"system: {repr(system) if system else 'null'}",
                f"input_tokens: {input_tokens if input_tokens is not None else 'null'}",
                f"output_tokens: {output_tokens if output_tokens is not None else 'null'}",
                "---"
            ]
            yaml_header = "\n".join(yaml_lines)
            
            md_content = f"""{yaml_header}

# Prompt Debug Log: {call_type}

## System Instruction
```text
{system or 'None'}
```

## Prompt
```text
{prompt}
```

## Response
```json
{response_text}
```
"""
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(md_content)
        except Exception as e:
            yaml_header = ""  # Unused, keeps compiler happy
            logging.warning("PROMPT_DEBUG file fallback failed: %s", e)

    async def _generate_stream_to_signalr(
        self,
        provider,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        target: str = "reclassifyProgress",
        operation_id: str = None,
        user_id: str = None,
        include_reasoning: bool = True,
        stream_reasoning_to_client: bool = True,
        connection_id: str = None,
    ) -> str:
        from services.signalr_publisher import publish_signalr_message, add_user_to_group, remove_user_from_group, add_connection_to_group, remove_connection_from_group
        import time
        
        # Add user/connection to the operation group if provided
        if operation_id:
            if connection_id:
                await add_connection_to_group("notificationHub", connection_id, operation_id)
            elif user_id:
                await add_user_to_group("notificationHub", user_id, operation_id)
        
        # Globally enable/disable reasoning via environment variable
        global_enable = os.environ.get("ENABLE_REASONING", "false").lower() == "true"
        include_reasoning = include_reasoning and global_enable

        # Globally enable/disable streaming final content via environment variable
        stream_content_to_client = os.environ.get("STREAM_FINAL_CONTENT", "false").lower() == "true"

        debounce_delay = float(os.environ.get("THINKING_STREAM_DEBOUNCE_SECONDS", "0.0"))
        
        content_chunks: list[str] = []
        thinking_chunks: list[str] = []
        content_publish_chunks: list[str] = []
        last_thinking_publish_time = time.time()
        last_content_publish_time = time.time()

        async for chunk_type, text in provider.generate_stream(
            prompt=prompt,
            system=system,
            # When reasoning is requested, suppress json_mode — many models
            # drop CoT when response_format=json_object is active.
            # We parse JSON from the accumulated content chunks afterwards.
            json_mode=json_mode and not include_reasoning,
            include_reasoning=include_reasoning,
        ):
            if chunk_type == "thinking":
                # Publish CoT tokens to a dedicated target so the UI can
                # display them in a separate section from the final JSON.
                if stream_reasoning_to_client:
                    if debounce_delay > 0:
                        thinking_chunks.append(text)
                        current_time = time.time()
                        if current_time - last_thinking_publish_time >= debounce_delay:
                            accumulated_thinking = "".join(thinking_chunks)
                            thinking_chunks = []
                            last_thinking_publish_time = current_time
                            
                            if operation_id:
                                args = [accumulated_thinking, operation_id, debounce_delay]
                                await publish_signalr_message(
                                    "notificationHub", "reclassifyThinking", args, user_id=user_id, group_name=operation_id
                                )
                    else:
                        if operation_id:
                            args = [text, operation_id, debounce_delay]
                            await publish_signalr_message(
                                "notificationHub", "reclassifyThinking", args, user_id=user_id, group_name=operation_id
                            )
            else:
                # Accumulate final content for JSON parsing after the stream.
                content_chunks.append(text)
                if operation_id and stream_content_to_client:
                    if debounce_delay > 0:
                        content_publish_chunks.append(text)
                        current_time = time.time()
                        if current_time - last_content_publish_time >= debounce_delay:
                            accumulated_content = "".join(content_publish_chunks)
                            content_publish_chunks = []
                            last_content_publish_time = current_time
                            
                            args = [accumulated_content, operation_id, debounce_delay]
                            await publish_signalr_message(
                                "notificationHub", target, args, user_id=user_id, group_name=operation_id
                            )
                    else:
                        args = [text, operation_id, debounce_delay]
                        await publish_signalr_message(
                            "notificationHub", target, args, user_id=user_id, group_name=operation_id
                        )

        # Flush any remaining thinking chunks
        if stream_reasoning_to_client and debounce_delay > 0 and thinking_chunks:
            accumulated_thinking = "".join(thinking_chunks)
            if operation_id:
                args = [accumulated_thinking, operation_id, debounce_delay]
                await publish_signalr_message(
                    "notificationHub", "reclassifyThinking", args, user_id=user_id, group_name=operation_id
                )

        # Flush any remaining content chunks
        if stream_content_to_client and debounce_delay > 0 and content_publish_chunks:
            accumulated_content = "".join(content_publish_chunks)
            if operation_id:
                args = [accumulated_content, operation_id, debounce_delay]
                await publish_signalr_message(
                    "notificationHub", target, args, user_id=user_id, group_name=operation_id
                )

        if operation_id:
            if connection_id:
                await remove_connection_from_group("notificationHub", connection_id, operation_id)
            elif user_id:
                await remove_user_from_group("notificationHub", user_id, operation_id)

        return "".join(content_chunks)
        
    def _extract_json(self, text: str) -> dict:
        """Extract and parse JSON from the LLM response, stripping markdown blocks if present."""
        text = text.strip()
        if not text:
            raise ValueError("Empty response text")
            
        import re
        # Try to find a JSON block in markdown
        match = re.search(r'```(?:json)?(.*?)```', text, re.DOTALL)
        if match:
            text = match.group(1).strip()
            
        return json.loads(text)


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
                header = "Expense\nID | Category | Name | Tags"
            elif 'income' in type_name_lower:
                header = "Income\nID | Category | Name | Tags"
            elif 'creditcard' in type_name_lower or 'credit card' in type_name_lower:
                header = "Credit Card\nID | Group | Name | Tags"
            elif 'asset' in type_name_lower:
                header = "Asset\nID | Group | Name | Tags"
            else:
                header = f"{type_name}\nID | Group | Name | Tags"
                
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
                name = v.get("name") or ""
                tags = ", ".join(v.get("tags") or [])
                tags_str = f" [Tags: {tags}]" if tags else ""
                v_type = v.get("type") or "Business"
                vendors_lines.append(f"{name} (Type: {v_type}){tags_str}")
            else:
                vendors_lines.append(f"- {v}")
        return "\n".join(vendors_lines)

    def _format_vendor_matches(self, vendor_matches: list[dict]) -> str:
        """Format vendor matches found via lookup values for AI context"""
        if not vendor_matches:
            return "No vendor matches found via account number/name lookup."
        
        matches_lines = []
        matches_lines.append("Vendor matches found via account number/name lookup:")
        matches_lines.append("(These vendors matched based on extracted account info - consider them in classification)")
        
        for match in vendor_matches:
            vendor_name = match.get("vendor_name", "Unknown")
            matched_lookups = match.get("matched_lookups", [])
            total_hits = match.get("total_hits", 0)
            vendor_type = match.get("vendor_type", "Business")
            vendor_tags = match.get("vendor_tags", [])
            
            lookups_str = ", ".join(matched_lookups[:3])  # Show first 3 matches
            if len(matched_lookups) > 3:
                lookups_str += f" (+{len(matched_lookups)-3} more)"
            
            tags_str = f" [Tags: {', '.join(vendor_tags)}]" if vendor_tags else ""
                
            matches_lines.append(f"- {vendor_name} (Type: {vendor_type}, Hits: {total_hits}){tags_str} matched via: {lookups_str}")
        
        return "\n".join(matches_lines)

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
                thinking_budget=0,
            )

            await self._debug_log(
                "is_financial",
                self.classification_provider,
                prompt,
                response_text,
                input_tokens=in_tok,
                output_tokens=out_tok,
                notification_type="app",
            )

            data = json.loads(response_text)
            return data.get("is_financial", True) # Default to true if ambiguous
        except Exception as e:
            logging.error(f"Error checking if financial transaction: {e}")
    def _format_user_corrections(self, user_corrections: Optional[dict], accounts: list[dict] = None) -> tuple[str, str]:
        if not user_corrections:
            return "", ""

        parts = ["User Corrections / Instructions Provided:"]
        
        comment = user_corrections.get("comment") or user_corrections.get("user_why")
        if comment:
            parts.append(f"- User Instruction/Comment: {comment}")
            
        corr_type = user_corrections.get("type") or user_corrections.get("transaction_type")
        if corr_type:
            parts.append(f"- Expected Transaction Type: {corr_type}")
            
        vendor = user_corrections.get("vendor")
        if vendor:
            vendor_name = vendor.get("name") if isinstance(vendor, dict) else vendor
            if vendor_name:
                parts.append(f"- Expected Vendor: {vendor_name}")

        def _get_acc_label(acc_id):
            if not acc_id:
                return None
            if accounts:
                for a in accounts:
                    if a.get("id") == acc_id:
                        return f"{a.get('name')} (ID: {acc_id})"
            return acc_id

        debit_id = user_corrections.get("debit_account_id")
        if debit_id:
            parts.append(f"- Selected Debit Account: {_get_acc_label(debit_id)}")

        credit_id = user_corrections.get("credit_account_id")
        if credit_id:
            parts.append(f"- Selected Credit Account: {_get_acc_label(credit_id)}")

        if len(parts) == 1:
            return "", ""

        parts.append("- Note on suggested_rule: Formulate a concise, reusable rule string in 'suggested_rule' based on these user corrections / comments for RUNBOOK.md.")

        section = "\n" + "\n".join(parts) + "\n"
        suggested_rule_field = ',\n  "suggested_rule": string (A concise, reusable rule or instruction suitable for adding to the user\'s RUNBOOK.md based on this transaction and user corrections/instructions. Return null or empty string if not applicable.)'
        return section, suggested_rule_field

    async def classify_async(
        self,
        hook: PhoneHookMessage,
        similar_vectors: List[Tuple[TransactionVector, float]],
        accounts: list[dict],
        runbook_content: str,
        vendors: list[dict] | list[str] = None,
        vendor_matches: list[dict] = None,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning_to_client: bool = True,
        exchange_rate_info: str = "",
        user_corrections: Optional[dict] = None
    ) -> AiParsedData:
        
        context = self._build_context(similar_vectors)
        accounts_text = self._format_accounts(accounts)
        
        vendors_text = self._format_vendors(vendors)
        
        # Format vendor matches for AI context
        vendor_matches_text = self._format_vendor_matches(vendor_matches)

        user_corrections_section, suggested_rule_field = self._format_user_corrections(user_corrections, accounts)

        # Resolve a clean app name from the hook data
        app_name = hook.raw_payload.get("notif_pkg") or hook.raw_payload.get("sms_rcv_sender") or hook.raw_payload.get("sms_sender") or ""

        conversion_instructions = ""
        if exchange_rate_info:
            conversion_instructions = """
- **Currency Conversion**: Since this transaction is in a currency other than PHP, use the provided exchange rate to convert the transaction amount to PHP (i.e. `Amount in PHP = Foreign Amount * Exchange Rate`). Return this converted PHP amount in the `amount` field, and explain the conversion calculation in the `why` field.
- **Foreign Transaction Summary**: In the `summary` field, include the original transaction amount and its currency (e.g. "Paid 10.00 USD (converted to PHP)...").
"""

        prompt = CLASSIFICATION_PROMPT.format(
            runbook_content=runbook_content,
            raw_msg=hook.raw_msg,
            app_name=app_name,
            raw_payload=json.dumps(hook.raw_payload, indent=2),
            similar_context=context,
            accounts=accounts_text,
            vendors=vendors_text,
            vendor_matches=vendor_matches_text,
            user_corrections_section=user_corrections_section,
            suggested_rule_field=suggested_rule_field,
            exchange_rate_info=exchange_rate_info,
            conversion_instructions=conversion_instructions
        )

        system_instruction = "You are a personal finance assistant. Classify the notification as a financial transaction."

        response_text = await self._generate_stream_to_signalr(
            self.classification_provider,
            prompt=prompt,
            system=system_instruction,
            json_mode=True,
            include_reasoning=False,
            target="reclassifyProgress",
            operation_id=operation_id,
            user_id=hook.user_id,
            connection_id=connection_id,
            stream_reasoning_to_client=stream_reasoning_to_client
        )
        in_tok, out_tok = None, None

        await self._debug_log(
            "classify",
            self.classification_provider,
            prompt,
            response_text,
            system=system_instruction,
            input_tokens=in_tok,
            output_tokens=out_tok,
            notification_type="app",
        )

        data = self._extract_json(response_text)
        
        # Fallback for application field
        if not data.get("application"):
            data["application"] = app_name
            
        return AiParsedData(**data)

    async def classify_sms_async(
        self,
        hook: PhoneHookMessage,
        similar_vectors: List[Tuple[TransactionVector, float]],
        accounts: list[dict],
        runbook_content: str,
        vendors: list[dict] | list[str] = None,
        vendor_matches: list[dict] = None,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning_to_client: bool = True,
        exchange_rate_info: str = "",
        user_corrections: Optional[dict] = None
    ) -> AiParsedData:
        """Classify using SMS-specific prompt (tailored for SMS banking messages)."""
        context = self._build_context(similar_vectors)
        accounts_text = self._format_accounts(accounts)
        vendors_text = self._format_vendors(vendors)
        vendor_matches_text = self._format_vendor_matches(vendor_matches)
        user_corrections_section, suggested_rule_field = self._format_user_corrections(user_corrections, accounts)

        # Resolve SMS sender from payload
        app_name = (
            hook.raw_payload.get("sms_rcv_sender")
            or hook.raw_payload.get("sms_sender")
            or hook.raw_payload.get("notif_pkg")
            or ""
        )

        conversion_instructions = ""
        if exchange_rate_info:
            conversion_instructions = """
- **Currency Conversion**: Since this transaction is in a currency other than PHP, use the provided exchange rate to convert the transaction amount to PHP (i.e. `Amount in PHP = Foreign Amount * Exchange Rate`). Return this converted PHP amount in the `amount` field, and explain the conversion calculation in the `why` field.
- **Foreign Transaction Summary**: In the `summary` field, include the original transaction amount and its currency (e.g. "Paid 10.00 USD (converted to PHP)...").
"""

        prompt = SMS_CLASSIFICATION_PROMPT.format(
            runbook_content=runbook_content,
            raw_msg=hook.raw_msg,
            app_name=app_name,
            raw_payload=json.dumps(hook.raw_payload, indent=2),
            similar_context=context,
            accounts=accounts_text,
            vendors=vendors_text,
            vendor_matches=vendor_matches_text,
            user_corrections_section=user_corrections_section,
            suggested_rule_field=suggested_rule_field,
            exchange_rate_info=exchange_rate_info,
            conversion_instructions=conversion_instructions
        )

        system_instruction = "You are a personal finance assistant. Classify the SMS banking notification as a financial transaction. Pay special attention to transfer patterns, masked account numbers, and person-to-person payment indicators."

        response_text = await self._generate_stream_to_signalr(
            self.classification_provider,
            prompt=prompt,
            system=system_instruction,
            json_mode=True,
            include_reasoning=True,
            target="reclassifyProgress",
            operation_id=operation_id,
            user_id=hook.user_id,
            connection_id=connection_id,
            stream_reasoning_to_client=stream_reasoning_to_client
        )
        in_tok, out_tok = None, None

        await self._debug_log(
            "classify",
            self.classification_provider,
            prompt,
            response_text,
            system=system_instruction,
            input_tokens=in_tok,
            output_tokens=out_tok,
            notification_type="sms",
        )

        data = self._extract_json(response_text)

        if not data.get("application"):
            data["application"] = app_name

        return AiParsedData(**data)

    async def classify_email_async(
        self,
        hook: PhoneHookMessage,
        similar_vectors: List[Tuple[TransactionVector, float]],
        accounts: list[dict],
        runbook_content: str,
        vendors: list[dict] | list[str] = None,
        vendor_matches: list[dict] = None,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning_to_client: bool = True,
        exchange_rate_info: str = "",
        user_corrections: Optional[dict] = None
    ) -> AiParsedData:
        """Classify using Email-specific prompt (tailored for email receipts/statements)."""
        context = self._build_context(similar_vectors)
        accounts_text = self._format_accounts(accounts)
        vendors_text = self._format_vendors(vendors)
        vendor_matches_text = self._format_vendor_matches(vendor_matches)
        user_corrections_section, suggested_rule_field = self._format_user_corrections(user_corrections, accounts)

        sender = hook.raw_payload.get("sender") or ""
        subject = hook.raw_payload.get("subject") or ""
        email_body = hook.raw_payload.get("markdown_content") or hook.raw_payload.get("body") or hook.raw_msg

        conversion_instructions = ""
        if exchange_rate_info:
            conversion_instructions = """
- **Currency Conversion**: Since this transaction is in a currency other than PHP, use the provided exchange rate to convert the transaction amount to PHP (i.e. `Amount in PHP = Foreign Amount * Exchange Rate`). Return this converted PHP amount in the `amount` field, and explain the conversion calculation in the `why` field.
- **Foreign Transaction Summary**: In the `summary` field, include the original transaction amount and its currency (e.g. "Paid 10.00 USD (converted to PHP)...").
"""

        prompt = EMAIL_CLASSIFICATION_PROMPT.format(
            runbook_content=runbook_content,
            body=email_body,
            sender=sender,
            subject=subject,
            accounts=accounts_text,
            vendors=vendors_text,
            vendor_matches=vendor_matches_text,
            user_corrections_section=user_corrections_section,
            suggested_rule_field=suggested_rule_field,
            exchange_rate_info=exchange_rate_info,
            conversion_instructions=conversion_instructions
        )

        system_instruction = "You are a personal finance assistant. Classify the Email notification as a financial transaction. Pay special attention to invoice tables, vendor names, and credit/debit account assignments."

        response_text = await self._generate_stream_to_signalr(
            self.classification_provider,
            prompt=prompt,
            system=system_instruction,
            json_mode=True,
            include_reasoning=True,
            target="reclassifyProgress",
            operation_id=operation_id,
            user_id=hook.user_id,
            connection_id=connection_id,
            stream_reasoning_to_client=stream_reasoning_to_client
        )
        in_tok, out_tok = None, None

        await self._debug_log(
            "classify",
            self.classification_provider,
            prompt,
            response_text,
            system=system_instruction,
            input_tokens=in_tok,
            output_tokens=out_tok,
            notification_type="email",
        )

        data = self._extract_json(response_text)

        if not data.get("application"):
            # Use sender email/domain or fallback
            data["application"] = sender.split("@")[-1].replace(">", "") if "@" in sender else sender

        return AiParsedData(**data)

    async def summarize_email_async(self, sender: str, subject: str, markdown_content: str) -> dict:
        prompt = f"""You are a financial data extraction assistant. Extract ALL account identifiers, vendor names, and provide a summary from this email.

Sender: {sender}
Subject: {subject}
Body:
{markdown_content}

Extract the following information:
1. **Account Numbers**: Any account/card/wallet numbers mentioned (e.g., "1234", "****5678")
2. **Account Names**: Any account holder/merchant/person names mentioned (e.g., "John Doe", "Merchant Name")
3. **Potential Vendor Names**: Any store/merchant/business names mentioned
4. **Summary**: A concise, 1-sentence financial transaction summary (e.g., "Payment made to [Vendor] via [Method] from [Sender]"). Do NOT include extraneous details like "sent a confirmation", "notes that...", etc. Focus ONLY on the core transaction. CRITICAL: You must explicitly include any sender, recipient, vendor, or account names mentioned in the text within this summary.

CRITICAL FILTERING RULES:
- If this appears to be a FUND TRANSFER between accounts (e.g., bank transfer, e-wallet transfer, payment to another person):
  - DO NOT include bank names (e.g., BPI, BDO, UnionBank), e-wallet names (e.g., GCash, Maya), or financial institution names in 'potential_vendor_names'
  - For transfers, the vendor should be the PERSON or BUSINESS receiving the money, not the bank/wallet

Return ONLY valid JSON matching this schema:
{{
  "summary": "string",
  "account_numbers": ["string"],
  "account_names": ["string"],
  "potential_vendor_names": ["string"]
}}
"""
        system_instruction = "You are a helpful assistant. Provide a concise summary and extract details."
        
        response_text, in_tok, out_tok = await self.classification_provider.generate(
            prompt=prompt,
            system=system_instruction,
            json_mode=True,
        )
        try:
            parsed_data = self._extract_json(response_text)
        except Exception as e:
            logging.error(f"Failed to parse summarize_email_async JSON: {e}")
            parsed_data = {
                "summary": "Email received",
                "account_numbers": [],
                "account_names": [],
                "potential_vendor_names": []
            }
            
        await self._debug_log(
            "summarize",
            self.classification_provider,
            prompt,
            response_text,
            system=system_instruction,
            input_tokens=in_tok,
            output_tokens=out_tok,
            notification_type="email",
        )
        return parsed_data

    async def start_runbook_review_async(
        self,
        corrections: list[dict],
        accounts: list[dict],
        vendors: list[dict],
        current_runbook: str,
        user_id: str = None,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning: bool = True
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

        response_text = await self._generate_stream_to_signalr(
            self.reasoning_provider,
            prompt=prompt,
            include_reasoning=stream_reasoning,
            json_mode=True,
            target="chatProgress",
            user_id=user_id,
            operation_id=operation_id,
            connection_id=connection_id,
            stream_reasoning_to_client=stream_reasoning
        )

        in_tok, out_tok = None, None
        await self._debug_log("review_start", self.reasoning_provider, prompt, response_text, input_tokens=in_tok, output_tokens=out_tok)

        return self._extract_json(response_text)

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
        current_runbook: str,
        user_id: str = None,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning: bool = True
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

        response_text = await self._generate_stream_to_signalr(
            self.reasoning_provider,
            prompt=prompt,
            include_reasoning=stream_reasoning,
            json_mode=True,
            target="chatProgress",
            user_id=user_id,
            operation_id=operation_id,
            connection_id=connection_id,
            stream_reasoning_to_client=stream_reasoning
        )
        in_tok, out_tok = None, None

        await self._debug_log("review_chat", self.reasoning_provider, prompt, response_text, input_tokens=in_tok, output_tokens=out_tok)

        return self._extract_json(response_text)
