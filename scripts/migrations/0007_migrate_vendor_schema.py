def up(db):
    """Migrate pending ingestions and transactions to the new vendor schema."""
    
    # 1. Migrate Pending Ingestions
    ingestions_container = db.get_container_client("PendingIngestions")
    print("Querying all pending ingestions to migrate vendor schema...")
    
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
        if parsed:
            vendor_field = parsed.get("vendor")
            # If vendor field is flat (string or None) rather than an object
            if vendor_field is None or isinstance(vendor_field, str):
                old_name = vendor_field
                old_type = parsed.get("vendor_type")
                old_matched = parsed.get("vendor_matched", False)
                suggested = parsed.get("suggested_vendor")
                
                is_rec = False
                tags = []
                
                if suggested:
                    is_rec = not suggested.get("is_created", False)
                    tags = suggested.get("tags") or []
                    if not old_name:
                        old_name = suggested.get("name")
                    if not old_type:
                        old_type = suggested.get("type")

                # Build new nested vendor structure
                new_vendor = {
                    "name": old_name,
                    "type": old_type or "Business",
                    "matched": old_matched,
                    "is_recommendation": is_rec,
                    "lookups": [],
                    "new_lookups": [],
                    "tags": tags
                }
                
                parsed["vendor"] = new_vendor
                
                # Delete deprecated fields
                if "vendor_type" in parsed:
                    del parsed["vendor_type"]
                if "vendor_matched" in parsed:
                    del parsed["vendor_matched"]
                if "suggested_vendor" in parsed:
                    del parsed["suggested_vendor"]
                    
                item["ai_parsed"] = parsed
                updated = True
            elif isinstance(vendor_field, dict):
                # Ensure new_lookups exists in already migrated records
                if "new_lookups" not in vendor_field:
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

    print(f"Ingestions Migration: Successfully updated {ingestion_success} documents. Errors: {ingestion_error}.")

    # 2. Initialize MatchedVendorLookups and NewVendorLookups in Transactions
    tx_container = db.get_container_client("Transactions")
    print("Querying all Transaction documents to ensure MatchedVendorLookups & NewVendorLookups exist...")
    
    try:
        query = "SELECT * FROM c WHERE c['$type'] = 'Transaction'"
        transactions = list(tx_container.query_items(query, enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Transactions: {e}")
        transactions = []

    tx_success = 0
    tx_error = 0

    for item in transactions:
        tx_updated = False
        if "MatchedVendorLookups" not in item:
            item["MatchedVendorLookups"] = []
            tx_updated = True
        if "NewVendorLookups" not in item:
            item["NewVendorLookups"] = []
            tx_updated = True
            
        if tx_updated:
            try:
                tx_container.replace_item(item=item['id'], body=item)
                tx_success += 1
            except Exception as e:
                print(f"Error updating transaction '{item.get('id')}': {e}")
                tx_error += 1

    print(f"Transactions Migration: Successfully updated {tx_success} documents. Errors: {tx_error}.")
