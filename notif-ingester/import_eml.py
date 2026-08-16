import argparse
import asyncio
import email
from email.policy import default
import json
import os
import sys
from datetime import datetime, timezone
import dotenv

# Load local.settings.json or .env if present
current_dir = os.path.dirname(os.path.abspath(__file__))
local_settings_path = os.path.join(current_dir, "local.settings.json")
if os.path.exists(local_settings_path):
    try:
        with open(local_settings_path, "r", encoding="utf-8") as f:
            settings = json.load(f)
            for k, v in settings.get("Values", {}).items():
                if k not in os.environ and isinstance(v, str):
                    os.environ[k] = v
    except Exception as e:
        print(f"Warning: Could not parse local.settings.json: {e}")

dotenv.load_dotenv()

from models.phone_hook import PhoneHookMessage
from repositories.hook_repository import CosmosHookRepository
from services.ai_service import AiService
from repositories.prompt_debug_repository import CosmosPromptDebugRepository, NoOpPromptDebugRepository
from services.email_fetching_service import get_ai_ready_body, get_original_sent_time

async def import_eml(file_path: str, user_id: str = "3575cfa0-ec94-40d2-8b25-ee9f0f135027", run_ai_summary: bool = True):
    if not os.path.exists(file_path):
        print(f"ERROR: File not found: {file_path}")
        return None

    print(f"Reading EML file: {file_path}")
    with open(file_path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=default)

    subject = msg['subject'] if msg['subject'] else "[No Subject]"
    sender = msg['from'] if msg['from'] else "[Unknown Sender]"
    print(f"Subject: {subject}")
    print(f"Sender: {sender}")

    body = get_ai_ready_body(msg)
    body["subject"] = subject
    body["sender"] = sender

    msg_id = msg.get('Message-ID') or msg.get('Message-Id') or ''
    if msg_id:
        import re
        clean_msg_id = re.sub(r'[^\w\-]', '_', msg_id.strip('<>'))
        email_id = f"local-eml|{clean_msg_id}"
    else:
        file_stem = os.path.splitext(os.path.basename(file_path))[0]
        email_id = f"local-eml|{file_stem}"

    body["emailId"] = email_id

    sent_time = get_original_sent_time(msg)
    if sent_time:
        sent_dt = sent_time if sent_time.tzinfo else sent_time.replace(tzinfo=timezone.utc)
        sent_dt_utc = sent_dt.astimezone(timezone.utc)
    else:
        sent_dt_utc = datetime.now(timezone.utc)
    body["timestamp"] = sent_dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    month_key = sent_dt_utc.strftime("%Y-%m-01")

    hook_repo = CosmosHookRepository()
    existing = await hook_repo.get_by_notif_id_async(email_id, month_key)
    if existing:
        print(f"Hook already exists for notif_id: {email_id} (month_key: {month_key}). Skipping import.")
        return existing
    markdown_content = body.get('markdown_content', 'Email received')

    ai_summary = "Email received"
    if run_ai_summary:
        print("Running AI summarization on email body...")
        prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"
        debug_repo = CosmosPromptDebugRepository() if prompt_debug else NoOpPromptDebugRepository()
        ai_service = AiService(debug_repo=debug_repo)
        try:
            ai_data = await ai_service.summarize_email_async(
                sender=sender,
                subject=subject,
                markdown_content=markdown_content
            )
            ai_summary = ai_data.get("summary", "Email received")
            body["extracted_info"] = {
                "account_numbers": ai_data.get("account_numbers", []),
                "account_names": ai_data.get("account_names", []),
                "potential_vendor_names": ai_data.get("potential_vendor_names", [])
            }
            print(f"AI Summary: {ai_summary}")
            print(f"Extracted info: {body['extracted_info']}")
        except Exception as e:
            print(f"AI summarization skipped/failed ({e}), using default summary.")

    body["action"] = "email_received"

    hook_msg = PhoneHookMessage(
        user_id=user_id,
        action="email_received",
        raw_payload=body,
        raw_msg=f"[EMAIL]: {ai_summary}",
        month_key=month_key,
        partition_key=month_key,
        notification_type="email"
    )
    hook_msg.raw_payload["notif_id"] = email_id

    print("Saving PhoneHookMessage to Cosmos DB container 'PhoneHookMessages'...")
    hook_repo = CosmosHookRepository()
    saved = await hook_repo.add_async(hook_msg)
    print(f"Successfully saved! Hook ID: {saved.id}, notif_id: {email_id}, month_key: {month_key}")
    return saved

def main():
    parser = argparse.ArgumentParser(description="Import an .eml file into PhoneHookMessages Cosmos DB table.")
    parser.add_argument("eml_path", nargs="?", default=r"C:\Users\adolf\Downloads\Your payment has been confirmed (3).eml", help="Path to .eml file")
    parser.add_argument("--user-id", default="3575cfa0-ec94-40d2-8b25-ee9f0f135027", help="User ID for partition key")
    parser.add_argument("--no-ai", action="store_true", help="Skip AI summarization")
    args = parser.parse_args()

    asyncio.run(import_eml(args.eml_path, user_id=args.user_id, run_ai_summary=not args.no_ai))

if __name__ == "__main__":
    main()
