import re

def normalize_lookup(val: str) -> str:
    """
    Normalizes a lookup string:
    - Lowercase and trim.
    - If masked (e.g. XXXXXXX1234 or ***1234 or •••1234), strip leading mask characters
      if at least 3 alphanumeric characters remain.
    """
    if not val or not isinstance(val, str):
        return ""
    clean = val.strip().lower()
    if not clean:
        return ""
    # Strip leading mask characters: x, *, •, \u2022, -, .
    unmasked = re.sub(r'^[x\*\u2022\-\.\s]+', '', clean)
    if len(unmasked) >= 3:
        return unmasked
    return clean

def up(db):
    """Normalize masked lookup strings in the VendorLookups container."""
    container = db.get_container_client("VendorLookups")
    print("Querying all VendorLookups to normalize masked lookup values...")
    try:
        query = "SELECT * FROM c"
        lookups = list(container.query_items(query, enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying VendorLookups: {e}")
        return

    # Track lookups by (UserId, VendorId, NormalizedValue) to merge duplicates if any
    existing_map = {}
    updated_count = 0
    deleted_duplicates = 0
    error_count = 0

    for item in lookups:
        user_id = item.get("UserId")
        vendor_id = item.get("VendorId")
        current_val = item.get("LookupValue", "")
        norm_val = normalize_lookup(current_val)

        if not norm_val or not user_id or not vendor_id:
            continue

        key = (user_id, vendor_id, norm_val)
        if key in existing_map:
            # Duplicate lookup value for the same vendor and user
            target_item = existing_map[key]
            target_item["Hits"] = target_item.get("Hits", 1) + item.get("Hits", 1)
            try:
                container.replace_item(item=target_item['id'], body=target_item)
                container.delete_item(item=item['id'], partition_key=user_id)
                deleted_duplicates += 1
            except Exception as e:
                print(f"Error merging duplicate lookup '{item.get('id')}': {e}")
                error_count += 1
        else:
            if current_val != norm_val:
                item["LookupValue"] = norm_val
                try:
                    container.replace_item(item=item['id'], body=item)
                    updated_count += 1
                except Exception as e:
                    print(f"Error updating lookup '{item.get('id')}': {e}")
                    error_count += 1
            existing_map[key] = item

    print(f"VendorLookups Migration: Normalized {updated_count} records. Merged & removed {deleted_duplicates} duplicates. Errors: {error_count}.")
