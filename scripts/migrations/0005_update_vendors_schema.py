def up(db):
    """Update existing vendors to have a Type and Tags if missing."""
    
    vendors_container = db.get_container_client("Vendors")
    
    print("Querying all vendors to apply schema updates (Type, Tags)...")
    try:
        query = "SELECT * FROM c"
        items = list(vendors_container.query_items(query, enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Vendors: {e}")
        return
        
    success_count = 0
    error_count = 0
    
    for item in items:
        updated = False
        
        if "Type" not in item:
            item["Type"] = "Business"
            updated = True
            
        if "Tags" not in item:
            item["Tags"] = []
            updated = True
            
        if updated:
            try:
                vendors_container.replace_item(item=item['id'], body=item)
                success_count += 1
            except Exception as e:
                print(f"Error updating vendor '{item.get('id')}': {e}")
                error_count += 1
                
    print(f"Successfully updated {success_count} vendors. Errors: {error_count}.")
