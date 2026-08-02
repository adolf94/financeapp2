import os
import json
import asyncio
from pathlib import Path

# Add the parent directory to sys.path so we can import services
import sys
script_dir = Path(__file__).resolve().parent
# script_dir is scripts/migrations, so parent is scripts, parent.parent is notif-ingester
notif_ingester_dir = script_dir.parent.parent
sys.path.append(str(notif_ingester_dir))

from services.finance_api_service import FinanceApiService

async def main():
    # Load connection string
    settings_path = notif_ingester_dir / "local.settings.json"
    conn_str = "AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
    db_name = "FinanceDb"
    
    if settings_path.exists():
        try:
            with open(settings_path, "r") as f:
                data = json.load(f)
                values = data.get("Values", {})
                if "CosmosConnectionString" in values:
                    conn_str = values["CosmosConnectionString"]
                if "COSMOS_DB" in values:
                    db_name = values["COSMOS_DB"]
        except Exception as e:
            print(f"Warning: Failed to load settings: {e}")

    # Read RUNBOOK.md
    runbook_path = notif_ingester_dir / "RUNBOOK.md"
    if not runbook_path.exists():
        print(f"Error: {runbook_path} not found.")
        return
        
    with open(runbook_path, "r", encoding="utf-8") as f:
        content = f.read()

    print("Connecting to Cosmos DB to seed runbook...")
    service = FinanceApiService(conn_str, db_name)
    
    # We use 'default' as the user ID for local dev, but maybe we should find all distinct users?
    # Actually, let's just insert for 'default' user ID for now, since it's the main dev user.
    # In function_app.py, user_id defaults to user.get("sub", "default").
    # For now, let's just seed for "default" and also "3d0689b7-81bd-4251-bdc1-8488e0cfa0b3" which is a typical mock UUID, 
    # but let's just query the Settings container and see what UserIds exist, or just insert 'default'.
    
    await service.save_runbook_content_async("default", content)
    print("Runbook seeded successfully for user 'default'.")

if __name__ == "__main__":
    asyncio.run(main())
