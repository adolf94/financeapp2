import os
import sys
import json
from pathlib import Path
from azure.cosmos import CosmosClient

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT_DIR))

def load_settings():
    settings = {
        "CosmosConnectionString": "AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
    }
    
    ingester_settings = ROOT_DIR / "notif-ingester" / "local.settings.json"
    if ingester_settings.exists():
        try:
            with open(ingester_settings, "r") as f:
                data = json.load(f)
                values = data.get("Values", {})
                if "CosmosConnectionString" in values:
                    settings["CosmosConnectionString"] = values["CosmosConnectionString"]
        except Exception:
            pass
            
    return settings

def main():
    settings = load_settings()
    conn_str = settings["CosmosConnectionString"]
    old_db_name = "FinanceAppLocal"
    
    print(f"Connecting to Cosmos DB Emulator...")
    client = CosmosClient.from_connection_string(conn_str)
    
    try:
        old_db = client.get_database_client(old_db_name)
        old_container = old_db.get_container_client("HookMessages")
    except Exception as e:
        print(f"Error connecting to source database/container '{old_db_name}.HookMessages': {e}")
        sys.exit(1)
        
    print(f"Querying historical SMS/Notification hooks from {old_db_name}.HookMessages...")
    
    # Check both 'Status' and 'status' to be safe
    query = "SELECT * FROM c WHERE c.Status = 'Imported' OR c.status = 'Imported'"
    try:
        items = list(old_container.query_items(query, enable_cross_partition_query=True))
        print(f"Found {len(items)} items to update.")
    except Exception as e:
        print(f"Error querying items: {e}")
        sys.exit(1)
        
    success_count = 0
    error_count = 0
    
    for item in items:
        try:
            if "Status" in item and item["Status"] == "Imported":
                item["Status"] = "New"
            if "status" in item and item["status"] == "Imported":
                item["status"] = "New"
                
            old_container.replace_item(item=item['id'], body=item)
            success_count += 1
        except Exception as e:
            print(f"Error updating item ID {item.get('id')}: {e}")
            error_count += 1
            
    print(f"\nUpdate finished! Success: {success_count}, Errors: {error_count}")

if __name__ == "__main__":
    main()
