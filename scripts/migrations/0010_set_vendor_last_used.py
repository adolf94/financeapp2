from datetime import datetime, timezone

def up(db):
    """
    Migration:
    1. Query all vendors across all users.
    2. Set 'LastUsed' to today's date (UTC) if missing or null.
    3. Query all transactions to find the latest transaction date for each vendor.
    4. If the latest transaction date is later than the vendor's current LastUsed date, update LastUsed.
    """
    vendors_container = db.get_container_client("Vendors")
    tx_container = db.get_container_client("Transactions")

    print("Querying all vendors...")
    try:
        vendors = list(vendors_container.query_items("SELECT * FROM c", enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Vendors container: {e}")
        vendors = []

    print(f"Found {len(vendors)} vendors.")

    print("Querying all transactions with vendors...")
    try:
        query_tx = "SELECT c.UserId, c.Vendor, c.Date FROM c WHERE c['$type'] = 'Transaction' AND IS_DEFINED(c.Vendor) AND c.Vendor != null AND c.Vendor != ''"
        transactions = list(tx_container.query_items(query_tx, enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Transactions container: {e}")
        transactions = []

    print(f"Found {len(transactions)} transactions with vendors.")

    # Build map of (user_id, normalized_vendor_name) -> max_transaction_datetime
    latest_tx_dates = {}
    for tx in transactions:
        user_id = tx.get("UserId")
        vendor_name = (tx.get("Vendor") or "").strip().lower()
        date_val = tx.get("Date")

        if not user_id or not vendor_name or not date_val:
            continue

        try:
            # Parse ISO string
            if isinstance(date_val, str):
                dt = datetime.fromisoformat(date_val.replace("Z", "+00:00"))
            elif isinstance(date_val, (int, float)):
                dt = datetime.fromtimestamp(date_val, timezone.utc)
            else:
                continue

            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)

            key = (user_id, vendor_name)
            if key not in latest_tx_dates or dt > latest_tx_dates[key]:
                latest_tx_dates[key] = dt
        except Exception:
            continue

    now_utc = datetime.now(timezone.utc)
    success_count = 0
    error_count = 0

    for vendor in vendors:
        user_id = vendor.get("UserId")
        vendor_name = (vendor.get("Name") or "").strip().lower()
        key = (user_id, vendor_name)

        target_dt = now_utc
        # If transaction date exists and is later than now_utc (or matches past tx), check
        if key in latest_tx_dates:
            tx_dt = latest_tx_dates[key]
            if tx_dt > target_dt:
                target_dt = tx_dt

        # Check existing LastUsed
        existing_last_used_str = vendor.get("LastUsed")
        needs_update = False

        if not existing_last_used_str:
            needs_update = True
        else:
            try:
                existing_dt = datetime.fromisoformat(existing_last_used_str.replace("Z", "+00:00"))
                if existing_dt.tzinfo is None:
                    existing_dt = existing_dt.replace(tzinfo=timezone.utc)

                if target_dt > existing_dt:
                    needs_update = True
                else:
                    target_dt = existing_dt
            except Exception:
                needs_update = True

        if needs_update:
            vendor["LastUsed"] = target_dt.isoformat()
            try:
                vendors_container.replace_item(item=vendor["id"], body=vendor)
                success_count += 1
            except Exception as e:
                print(f"Error updating vendor '{vendor.get('id')}': {e}")
                error_count += 1

    print(f"Vendors LastUsed Migration: Successfully updated {success_count} vendors. Errors: {error_count}.")
