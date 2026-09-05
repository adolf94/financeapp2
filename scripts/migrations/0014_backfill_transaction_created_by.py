def up(db):
    """
    Migration:
    1. Query all documents in the Transactions container
       (shared by Transaction and LedgerEntry docs — ledger entries are skipped).
    2. Backfill 'CreatedBy' = 'UserId' where missing or null.
    """
    container = db.get_container_client("Transactions")

    print("Querying all documents in Transactions container...")
    try:
        items = list(container.query_items("SELECT * FROM c", enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Transactions container: {e}")
        items = []

    print(f"Found {len(items)} documents.")

    success_count = 0
    skipped_count = 0
    error_count = 0

    for item in items:
        doc_type = item.get("$type") or item.get("Discriminator", "")
        if doc_type == "LedgerEntry":
            continue
        # Fallback for legacy docs without a discriminator:
        # ledger entries always carry TransactionId/Amount; transactions carry Entries/Date.
        if doc_type != "Transaction" and ("TransactionId" in item or "Amount" in item):
            continue

        if item.get("CreatedBy"):
            skipped_count += 1
            continue

        if not item.get("UserId"):
            print(f"Warning: transaction '{item.get('id')}' has no UserId — skipped.")
            skipped_count += 1
            continue

        item["CreatedBy"] = item["UserId"]
        try:
            container.replace_item(item=item["id"], body=item)
            success_count += 1
        except Exception as e:
            print(f"Error updating transaction '{item.get('id')}': {e}")
            error_count += 1

    print(f"Transaction CreatedBy Backfill: Successfully updated {success_count} records. Skipped: {skipped_count}. Errors: {error_count}.")
