import os
import json
from pathlib import Path
from azure.cosmos import CosmosClient, PartitionKey

def load_settings():
    """Load settings from local.settings.json if available."""
    # Look in the script's parent's parent directory (notif-ingester root)
    script_dir = Path(__file__).resolve().parent
    settings_path = script_dir.parent / "local.settings.json"
    
    settings = {
        "CosmosConnectionString": "AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
        "COSMOS_DB": "FinanceDb"
    }
    
    if settings_path.exists():
        try:
            with open(settings_path, "r") as f:
                data = json.load(f)
                values = data.get("Values", {})
                if "CosmosConnectionString" in values:
                    settings["CosmosConnectionString"] = values["CosmosConnectionString"]
                if "COSMOS_DB" in values:
                    settings["COSMOS_DB"] = values["COSMOS_DB"]
            print(f"Loaded configuration from {settings_path}")
        except Exception as e:
            print(f"Warning: Failed to load {settings_path}: {e}. Using defaults/environment.")
            
    # Allow environment variables to override
    if "CosmosConnectionString" in os.environ:
        settings["CosmosConnectionString"] = os.environ["CosmosConnectionString"]
    if "COSMOS_DB" in os.environ:
        settings["COSMOS_DB"] = os.environ["COSMOS_DB"]
        
    return settings

def main():
    settings = load_settings()
    conn_str = settings["CosmosConnectionString"]
    db_name = settings["COSMOS_DB"]
    
    print(f"Connecting to Cosmos DB...")
    client = CosmosClient.from_connection_string(conn_str)
    
    # 1. Create/Ensure Database exists
    print(f"Ensuring database '{db_name}' exists...")
    db = client.create_database_if_not_exists(id=db_name)
    
    # 2. Define containers to verify/create
    # Standard containers partitioned by /UserId according to workspace rules
    user_partitioned_containers = [
        "PhoneHookMessages",
        "PendingIngestions",
        "TransactionVectors",
        "Settings",
        "RunbookChunks"
    ]
    
    for container_name in user_partitioned_containers:
        print(f"Ensuring container '{container_name}' exists (partition key: /UserId)...")
        try:
            db.create_container_if_not_exists(
                id=container_name,
                partition_key=PartitionKey(path="/UserId")
            )
            print(f" -> Verified/Created '{container_name}' successfully.")
        except Exception as e:
            print(f" -> Error checking/creating '{container_name}': {e}")
            
    # 3. Ensure Lease container exists (requires /id partition key)
    lease_container = "PhoneHookMessages-leases"
    print(f"Ensuring lease container '{lease_container}' exists (partition key: /id)...")
    try:
        db.create_container_if_not_exists(
            id=lease_container,
            partition_key=PartitionKey(path="/id")
        )
        print(f" -> Verified/Created '{lease_container}' successfully.")
    except Exception as e:
        print(f" -> Error checking/creating '{lease_container}': {e}")
        
    print("Database migration and initialization completed!")

if __name__ == "__main__":
    main()
