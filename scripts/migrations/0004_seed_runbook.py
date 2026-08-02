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
        
    container = db.get_container_client("Settings")
    
    doc = {
        "id": "runbook",
        "UserId": "default",
        "content": content
    }
    
    container.upsert_item(doc)
    print("Successfully seeded RUNBOOK.md to Settings container for 'default' user.")
