# SMS Classification Rules

This runbook applies ONLY to SMS banking notifications. Rules here take precedence over general classification logic.

## SMS-Specific Vendor Rules

### Person-to-Person (P2P) Transfers
1. If SMS says "sent to [NAME]" or "transferred to [NAME]" → vendor = that person's name, vendor_type = Individual
2. If SMS says "received from [NAME]" → vendor = that person's name, vendor_type = Individual, transaction_type = Income
3. If recipient is a person name (not a bank or business) → vendor_type = Individual

### Bank-to-Bank Transfers
1. If SMS says "transferred to [BANK NAME] account" with no recipient name → vendor = Internal, vendor_type = Internal, transaction_type = Transfer
2. BDO, BPI, UnionBank, Metrobank, etc. as destination without a person name → Transfer between own accounts

### Masked Card/Account Numbers
1. Numbers like ****1234 or xxxx-5678 → record in recipient_account_number/sender_account_number
2. Masked numbers alone should NOT prevent classification — use context clues

## SMS Confidence Thresholds
- SMS transactions with clear amount + account resolution → confidence >= 0.90 is acceptable for auto-confirm
- SMS with masked recipient only (no person name, no vendor match) → confidence should be <= 0.80 (require review)
- SMS with known vendor match via account number → confidence += 0.10 bonus (strong signal)

## SMS Transfer Detection
1. Keywords "sent", "transferred", "paid to", "remitted to" → likely Expense or Transfer
2. Keywords "received", "credited", "deposited" → likely Income or Transfer
3. If both sending account and receiving account are the user's own accounts → Transfer
4. Bank transfer between same user's accounts (e.g., BPI Savings → BPI Credit Card) → Transfer

## SMS Sender Interpretation
- The SMS sender (e.g., "BPI", "GCash", "Metrobank") is the BANK sending the notification, NOT the transaction vendor
- The vendor/recipient is identified from the message body, not the sender field
- Exception: if SMS sender is a MERCHANT (e.g., "LAZADA", "GRAB"), it may also be the vendor

## Common SMS Patterns

### BPI SMS Format
- "[BPI] You have transferred PHP X to [BANK] on [DATE]" → Transfer
- "[BPI] Your payment of PHP X to [MERCHANT] was processed" → Expense

### GCash SMS Format  
- "You sent PHP X to [NAME] via GCash" → P2P Transfer or Expense
- "You received PHP X from [NAME] via GCash" → Income

