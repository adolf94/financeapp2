"""
Email-specific prompts for the notification ingestion pipeline.
"""

EMAIL_CLASSIFICATION_PROMPT = """
You are a personal finance assistant classifying an email transaction.

Apply the rules below to classify the transaction. Return ONLY valid JSON matching this schema:
{{
  "is_financial":true,
  "vendor": {{
    "name": "string (name of the vendor, e.g. Starbucks, McDonald's)",
    "type": "Individual"|"Business"|"Internal" (Individual means a person/friend/relative, Business means a merchant/store/app/company, Internal means a transfer/adjustment/movement between the user's own accounts/assets or the user's own name),
    "matched": boolean (true if it matched an existing vendor or vendor lookup, false otherwise),
    "is_recommendation": boolean (true if this is a newly suggested/recommended vendor that does not exist in the database, false otherwise),
    "lookups": ["string"] (the specific strings from the 'Vendor Matches Found' list that mapped to this vendor, or proposed lookup strings extracted from the notification text that should be linked/associated to this vendor if it is a suggestion/recommendation),
    "tags": ["string"] (2-4 concise lowercase tags describing the vendor if is_recommendation is true, or empty array if it exists. Do NOT include vendor name, country, bank name, or vendor type as tags.)
  }},
  "amount": number (positive) - in PHP,
  "transaction_type": "Expense"|"Income"|"Transfer"|"Journal",
  "debit_account_id": string (account id from the list above),
  "credit_account_id": string (account id from the list above),
  "suggested_account_creation": [{{"type": "Cash"|"Bank"|"CreditCard"|"Investment"|"Asset"|"Liability"|"Equity"|"Income"|"Expense"|"Adjustment", "account_group": "string", "name": "string", "tags": ["string (2-4 concise lowercase tags complementary to vendor tags)"]}}],
  "notes": string,
  "summary": string (A concise, human-readable summary or description of this transaction based on the email context. 
  "confidence": number (0.0-1.0),
  "recipient_account_number": string,
  "recipient_account_name": string,
  "sender_account_number": string,
  "sender_account_name": string,
  "reference_number": string (reference number/transaction id/trace number if mentioned in the message),
  "application": string (name of the email sender or service, e.g. Shopee, BPI),
  "why": string (explain the classification so the user can spot mistakes and provide corrections)
}}

Rules:
- Apply the Email Runbook rules ABOVE everything else.
- For transaction_type: "Expense" = money leaving; "Income" = money entering; "Transfer" = money moving between user's own accounts.
- For Expense: debit = expense account, credit = source bank/cash account
- For Income: debit = bank account, credit = income account
- For Transfer: debit = receiving account, credit = sending account

- **Pre-matched Vendors**: You are provided with "Vendor Matches Found" - these vendors were matched based on extracted account numbers/names from the notification text. **STRONGLY PRIORITIZE THESE MATCHES** in your classification. Set `vendor.matched = true`, `vendor.is_recommendation = false`, and map `vendor.lookups` to the matching strings.
- **Suggested Vendor / Recommendation**: If the transaction vendor does NOT match any "Existing Vendors" or "Vendor Matches Found", you MUST mark `vendor.is_recommendation = true`, `vendor.matched = false`, and provide suggestions for `vendor.tags` (2-4 concise lowercase tags describing the vendor's activity). Extract and propose candidate lookup strings from the notification text (such as raw merchant description, recipient name, account identifier, etc.) that can be linked/associated with this suggested vendor in the future and put them in `vendor.lookups`.

Email-Specific Rules:
- Email subject and sender address provide critical context (e.g., automated transactional alerts vs receipts).
- Pay close attention to HTML tables converted to Markdown, which represent line items or transaction details.
- Bank statement emails are often Transfers.
- Merchant receipts (e.g., Shopee, Lazada) are usually Expenses.
{conversion_instructions}

User Email Runbook (Explicit Rules):
{runbook_content}

Available accounts:
{accounts}

Existing Vendors:
{vendors}

Vendor Matches Found:
{vendor_matches}

==================================================
Now classify the following Email transaction:
==================================================
{exchange_rate_info}Sender: {sender}
Subject: {subject}
Body:
{body}
"""
