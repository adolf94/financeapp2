def up(db):
    """Migrate database documents to ensure new_lookups and NewVendorLookups properties are initialized."""
    
    # 1. Ingestions new_lookups
    ingestions_container = db.get_container_client("PendingIngestions")
    print("Querying all pending ingestions to check for missing new_lookups field...")
    try:
        query = "SELECT * FROM c"
        ingestions = list(ingestions_container.query_items(query, enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying PendingIngestions: {e}")
        ingestions = []

    ingestion_success = 0
    ingestion_error = 0

    for item in ingestions:
        updated = False
        parsed = item.get("ai_parsed")
        if parsed and parsed.get("vendor"):
            vendor_field = parsed["vendor"]
            if isinstance(vendor_field, dict) and "new_lookups" not in vendor_field:
                vendor_field["new_lookups"] = []
                parsed["vendor"] = vendor_field
                item["ai_parsed"] = parsed
                updated = True
                
        if updated:
            try:
                ingestions_container.replace_item(item=item['id'], body=item)
                ingestion_success += 1
            except Exception as e:
                print(f"Error updating ingestion '{item.get('id')}': {e}")
                ingestion_error += 1

    print(f"Ingestions Update: Initialized new_lookups in {ingestion_success} documents. Errors: {ingestion_error}.")

    # 2. Transactions NewVendorLookups
    tx_container = db.get_container_client("Transactions")
    print("Querying all Transactions to check for missing NewVendorLookups field...")
    try:
        query = "SELECT * FROM c WHERE c['$type'] = 'Transaction'"
        transactions = list(tx_container.query_items(query, enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Transactions: {e}")
        transactions = []

    tx_success = 0
    tx_error = 0

    for item in transactions:
        if "NewVendorLookups" not in item:
            item["NewVendorLookups"] = []
            try:
                tx_container.replace_item(item=item['id'], body=item)
                tx_success += 1
            except Exception as e:
                print(f"Error updating transaction '{item.get('id')}': {e}")
                tx_error += 1

    print(f"Transactions Update: Initialized NewVendorLookups in {tx_success} documents. Errors: {tx_error}.")
