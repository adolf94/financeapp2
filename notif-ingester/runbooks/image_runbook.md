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
  - **Atome**: Bright yellow / black / neon-lime theme, "atome" logo, Atome Card / Pay in 3 confirmation, or filename with `atome`.
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

