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
    
    print("Fetching all Vendors...")
    vendors = list(vendors_container.query_items(
        query="SELECT * FROM c",
        enable_cross_partition_query=True
    ))
    print(f"Found {len(vendors)} Vendors.")
    
    updated_count = 0
    for v in vendors:
        needs_update = False
        
        # Check and fix Tags
        if "Tags" not in v or v["Tags"] is None:
            v["Tags"] = []
            needs_update = True
            
        # Check and fix Type
        if "Type" not in v or v["Type"] is None:
            # We default missing Type to 'Business' since almost all default vendors are businesses
            v["Type"] = "Business"
            needs_update = True
            
        if needs_update:
            print(f"Fixing Vendor '{v.get('Name')}' (ID: {v.get('id')}) -> Type: '{v['Type']}', Tags: {v['Tags']}")
            try:
                vendors_container.replace_item(item=v["id"], body=v)
                updated_count += 1
            except Exception as e:
                print(f"Error updating vendor {v.get('id')}: {e}")
                
    print(f"\nCompleted. Successfully updated {updated_count} vendors with default values.")

if __name__ == "__main__":
    main()
