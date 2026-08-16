def up(db):
    """
    Migration 0011:
    1. Scan Transactions container for any documents with prefixed 'id' (Transaction|... or LedgerEntry|...).
    2. Re-create them with raw GUID 'id' and delete the old prefixed items.
    3. Ensure LedgerEntry.TransactionId does not contain 'Transaction|' prefix.
    4. Fix any PendingIngestions referencing prefixed transaction_id.
    """
    tx_container = db.get_container_client("Transactions")

    print("Querying all transactions and ledger entries in Transactions container...")
    try:
        items = list(tx_container.query_items("SELECT * FROM c", enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Transactions container: {e}")
        items = []

    print(f"Found {len(items)} items in Transactions container.")

    migrated_tx_count = 0
    migrated_entry_count = 0
    errors = 0

    for item in items:
        user_id = item.get("UserId")
        old_id = item.get("id", "")
        doc_type = item.get("$type") or item.get("Discriminator", "")
        needs_migration = False

        if old_id.startswith("Transaction|") or (doc_type == "Transaction" and "|" in old_id):
            raw_id = old_id.replace("Transaction|", "")
            item["id"] = raw_id
            item["Id"] = raw_id
            needs_migration = True
            is_tx = True
        elif old_id.startswith("LedgerEntry|") or (doc_type == "LedgerEntry" and "|" in old_id):
            raw_id = old_id.replace("LedgerEntry|", "")
            item["id"] = raw_id
            item["Id"] = raw_id
            needs_migration = True
            is_tx = False
        else:
            is_tx = (doc_type == "Transaction")

        # Check TransactionId in LedgerEntry
        if doc_type == "LedgerEntry" and item.get("TransactionId", "").startswith("Transaction|"):
            item["TransactionId"] = item["TransactionId"].replace("Transaction|", "")
            needs_migration = True

        if needs_migration:
            try:
                if old_id != item["id"]:
                    # Create new item with clean ID
                    tx_container.upsert_item(body=item)
                    # Delete old item
                    try:
                        tx_container.delete_item(item=old_id, partition_key=user_id)
                    except Exception as del_err:
                        print(f"Warning: Failed to delete old item {old_id}: {del_err}")
                else:
                    # Update in-place (e.g. TransactionId fix)
                    tx_container.upsert_item(body=item)

                if is_tx:
                    migrated_tx_count += 1
                else:
                    migrated_entry_count += 1
            except Exception as e:
                print(f"Error migrating item '{old_id}': {e}")
                errors += 1

    print(f"Transactions container migration complete: {migrated_tx_count} transactions and {migrated_entry_count} ledger entries migrated. Errors: {errors}")

    # Fix PendingIngestions references
    try:
        ingestion_container = db.get_container_client("PendingIngestions")
        ingestion_items = list(ingestion_container.query_items(
            "SELECT * FROM c WHERE IS_DEFINED(c.transaction_id) AND c.transaction_id != null",
            enable_cross_partition_query=True
        ))
        fixed_ingestions = 0
        for ing in ingestion_items:
            tx_id = ing.get("transaction_id", "")
            if tx_id.startswith("Transaction|"):
                ing["transaction_id"] = tx_id.replace("Transaction|", "")
                ingestion_container.upsert_item(body=ing)
                fixed_ingestions += 1
        print(f"Fixed {fixed_ingestions} PendingIngestion transaction_id references.")
    except Exception as e:
        print(f"Note: PendingIngestions container check skipped/error: {e}")
