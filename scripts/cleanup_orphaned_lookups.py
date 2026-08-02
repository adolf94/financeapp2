import os
import sys
import json
from pathlib import Path
from azure.cosmos import CosmosClient

# Add workspace root to system path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT_DIR))

def load_settings():
    """Load settings from local.settings.json or environment."""
    settings = {
        "CosmosConnectionString": "AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
        "COSMOS_DB": "FinanceDb"
    }
    
    backend_settings = ROOT_DIR / "backend" / "local.settings.json"
    ingester_settings = ROOT_DIR / "notif-ingester" / "local.settings.json"
    
    for settings_path in [backend_settings, ingester_settings]:
        if settings_path.exists():
            try:
                with open(settings_path, "r") as f:
                    data = json.load(f)
                    values = data.get("Values", {})
                    if "CosmosConnectionString" in values:
                        settings["CosmosConnectionString"] = values["CosmosConnectionString"]
                    if "COSMOS_DB" in values:
                        settings["COSMOS_DB"] = values["COSMOS_DB"]
                    elif "CosmosDatabaseName" in values:
                        settings["COSMOS_DB"] = values["CosmosDatabaseName"]
                print(f"Loaded config from {settings_path}")
                break
            except Exception as e:
                print(f"Warning: Failed to read {settings_path}: {e}")
                
    if "CosmosConnectionString" in os.environ:
        settings["CosmosConnectionString"] = os.environ["CosmosConnectionString"]
    if "COSMOS_DB" in os.environ:
        settings["COSMOS_DB"] = os.environ["COSMOS_DB"]
        
    return settings

def main():
    settings = load_settings()
    conn_str = settings["CosmosConnectionString"]
    db_name = settings["COSMOS_DB"]
    
    print(f"Connecting to Cosmos DB: {db_name}...")
    client = CosmosClient.from_connection_string(conn_str)
    db = client.get_database_client(db_name)
    
    vendors_container = db.get_container_client("Vendors")
    lookups_container = db.get_container_client("VendorLookups")
    
    print("Fetching all Vendors...")
    vendors = list(vendors_container.query_items(
        query="SELECT c.id FROM c",
        enable_cross_partition_query=True
    ))
    vendor_ids = {v["id"] for v in vendors}
    print(f"Found {len(vendor_ids)} Vendors.")
    
    print("Fetching all VendorLookups...")
    lookups = list(lookups_container.query_items(
        query="SELECT c.id, c.VendorId, c.UserId, c.LookupValue FROM c",
        enable_cross_partition_query=True
    ))
    print(f"Found {len(lookups)} VendorLookups.")
    
    orphans = []
    for l in lookups:
        vendor_id = l.get("VendorId")
        if not vendor_id or vendor_id not in vendor_ids:
            orphans.append(l)
            
    print(f"Found {len(orphans)} orphaned VendorLookups.")
    
    if not orphans:
        print("No orphaned VendorLookups found. Database is clean!")
        return
        
    deleted_count = 0
    for orphan in orphans:
        lookup_id = orphan.get("id")
        user_id = orphan.get("UserId")
        lookup_val = orphan.get("LookupValue")
        vendor_id = orphan.get("VendorId")
        
        print(f"Deleting orphaned lookup: ID={lookup_id}, Value='{lookup_val}', Referenced VendorID={vendor_id}...")
        try:
            lookups_container.delete_item(item=lookup_id, partition_key=user_id)
            deleted_count += 1
        except Exception as e:
            print(f"Error deleting lookup {lookup_id}: {e}")
            
    print(f"\nCleanup complete. Successfully deleted {deleted_count} orphaned VendorLookups.")

if __name__ == "__main__":
    main()
