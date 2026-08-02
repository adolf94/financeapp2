from pathlib import Path
import json

def up(db):
    """Seed the initial RUNBOOK.md into the Cosmos DB Settings container."""
    
    # Locate RUNBOOK.md
    # Current file is in scripts/migrations/, so parent is scripts, parent.parent is project root
    project_root = Path(__file__).resolve().parent.parent.parent
    runbook_path = project_root / "notif-ingester" / "RUNBOOK.md"
    
    if not runbook_path.exists():
        print(f"Error: RUNBOOK.md not found at {runbook_path}")
        return
        
    with open(runbook_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    settings_container = db.get_container_client("Settings")
    accounts_container = db.get_container_client("Accounts")
    
    try:
        query = "SELECT DISTINCT c.UserId FROM c"
        user_ids = [item["UserId"] for item in accounts_container.query_items(query=query, enable_cross_partition_query=True) if "UserId" in item]
    except Exception as e:
        print(f"Warning: Failed to query UserIds from Accounts: {e}")
        user_ids = []
        
    if not user_ids:
        print("No users found in Accounts container. Defaulting to 'default'.")
        user_ids = ["default"]
        
    for user_id in user_ids:
        doc = {
            "id": "runbook",
            "UserId": user_id,
            "content": content
        }
        settings_container.upsert_item(doc)
        print(f"Successfully seeded RUNBOOK.md to Settings container for user '{user_id}'.")
