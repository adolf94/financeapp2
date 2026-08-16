# Shopee Email Classification Rules

- Always classify as `Expense`.
- Shopee emails may contain one or multiple orders from different sellers paid in one checkout.
- For each order, use the `Total Payment` value as the amount (this is the post-voucher, post-discount amount). Do not deduct vouchers or discounts again.
- Shipping fees of 0.00 are normal and should not be added.
- The Order ID (e.g., `#260808R1R49PTC`) must be stored as the `reference_number` for duplicate tracking.
- For each order, determine and assign the specific expense category account (e.g., Groceries/Food, Electronics, Clothing, Household) based on the purchased items and seller, rather than defaulting to generic shopping when a specific category fits.
- If credit card is unresolvable from the email itself, leave `credit_account_id` blank for automatic resolution via matching SMS/app notification.
