# Personal Finance Runbook

This document contains explicit rules and preferences for how the AI should classify incoming notifications. The AI reads this document during classification. Explicit rules here **override** the vector similarity context.

## 1. Mappings & Logic
- **Credit Card / Liability Payments:** Any payments to a credit card or a liability account should ALWAYS be classified as a `Transfer` to the account instead of an `Expense`.
- **Internal Transfers via Account Numbers:** If a notification mentions a receiver or sender account number that exists in your existing account tags, classify the transaction as a `Transfer` and set the vendor to `Internal`.
- **Vendor Lookup Matching:** Before classification, the system extracts account numbers/names and searches the VendorLookups container. If vendor matches are found via account number/name lookup, strongly consider these matches in classification. High-hit vendor matches are likely correct.
- **Maybank Withdrawals:** Maybank ATM withdrawals are free. Assume withdrawals can only be in multiples of 100. Any remainder amount shown in the notification (like withdrawal fees) should be considered waived/ignored.

## 2. Tagging Preferences
- **Account Identification:** For any suggested bank accounts or credit cards, include the account number (or the last 4 digits) as a tag if it is mentioned in the notification.
*(Add your specific tagging preferences here in the future, e.g., tagging specific merchants with 'guilty-pleasure')*

## 3. Temporary Rules
*(Add temporary rules here, e.g., tagging expenses for a specific trip during a certain month)*

