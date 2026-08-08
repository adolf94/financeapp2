"""
App notification-specific prompts for the notification ingestion pipeline.
These are the original prompts used for push notification / app-based messages.
"""

APP_CLASSIFICATION_PROMPT = """
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
- **Account Number Uniqueness**: The same account number CANNOT appear in both recipient_account_number and sender_account_number. If a notification contains only one account number, assign it to the most contextually appropriate field (recipient if money was sent out, sender if money was received) and leave the other field empty.
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

APP_IS_FINANCIAL_PROMPT = """
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

