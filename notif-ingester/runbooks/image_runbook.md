# Image & Receipt Classification Rules

This runbook defines custom routing rules for transactions parsed from uploaded receipt and statement images.

## Application & Screenshot Identification
- **Physical Receipts**: For any physical printed slip, POS terminal receipt, register tape, supermarket invoice, or restaurant bill, the `application` MUST be `"Physical Receipt"`.
- **Mobile App Screenshots**: For digital payment, banking, or checkout screenshots, determine the application from the filename or visual UI branding/header:
  - **GCash**: Blue header, G logo, Express Send, Pay QR, or filename with `gcash` / `com.globe.gcash`.
  - **Maya**: Neon green / black header, Maya logo, Send Money, or filename with `maya` / `paymaya`.
  - **Vybe**: Purple / Magenta / Violet theme, "VYBE by BPI" logo, Scan to Pay / Send, or filename with `vybe` / `com.bpi.vybe`.
  - **BPI**: Red header, BPI logo, Transfer to Other Banks / QR, or filename with `bpi` / `com.bpi.ng.app`.
  - **BDO**: Blue & Yellow header, BDO Online / Pay logo, or filename with `bdo`.

  - **UnionBank**: Orange header, UB logo, or filename with `unionbank`.
  - **Grab**: Green header, GrabPay receipt / delivery summary, or filename with `grab`.
  - **Shopee**: Orange header, ShopeePay receipt / order summary, or filename with `shopee`.
  - **Foodpanda**: Pink header, order receipt, or filename with `foodpanda`.
  - **Atome**: Clean light gray background (`#f7f8fa`) with rounded white cards, centered **"Details"** header with `[?]` help icon, light peach circle with store icon (`🏪`), "Payment" header, "Transaction Details" card with Merchant/Reference Number/Copy button/Posted Date/Payment Method (QR Ph), and signature **"Loan Agreement >"** card. Also yellow/lime/black theme, "atome" logo, Atome Card / Pay in 3, or filename with `atome`. **Fallback rule**: If not sure of app, presence of "Loan Agreement" and paid via "QR Ph" strictly assumes "Atome".
  - **GoTyme**: Teal/Green header, GoTyme Bank confirmation.

  - **SeaBank**: Orange/White header, SeaBank transfer.
  - **RCBC**: Blue/Yellow header, DiskarTech / Pulz confirmation.
  - **Metrobank**: Blue/Gold header, Metrobank App confirmation.

## Common Receipt & Transaction Types
- **Restaurant & Food**: Debit Food / Dining expense, Credit Cash or payment card.
- **Groceries & Supermarkets**: Debit Groceries expense, Credit Cash or payment card.
- **Utilities & Bills**: Debit Utilities expense, Credit source account.
- **Retail & Shopping**: Debit Shopping expense, Credit payment card or e-wallet.
- **Bank Transfer Confirmation Screenshots**: Transfer between designated accounts.

