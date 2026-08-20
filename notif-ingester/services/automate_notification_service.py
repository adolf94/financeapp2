import os
import logging
import aiohttp
from typing import Optional

async def send_error_notification_async(
    summary_text: str,
    user_name: str = "User",
    action: str = "finance_ingestion_error"
) -> bool:
    """
    Sends an error notification to LlamaLabs Automate webhook endpoint.
    Environment variables:
      - AUTOMATE_KEY: Secret key
      - AUTOMATE_EMAIL: Recipient email
      - AUTOMATE_ENDPOINT: Webhook URL
    """
    key = os.environ.get("AUTOMATE_KEY")
    email = os.environ.get("AUTOMATE_EMAIL")
    endpoint = os.environ.get("AUTOMATE_ENDPOINT")

    if not key or not email or not endpoint:
        logging.info("[AutomateNotification] AUTOMATE_KEY, AUTOMATE_EMAIL, or AUTOMATE_ENDPOINT not set. Skipping notification.")
        return False

    payload = {
        "secret": key,
        "to": email,
        "device": None,
        "priority": "high",
        "payload": {
            "action": action,
            "user": user_name,
            "summary": summary_text
        }
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(endpoint, json=payload, timeout=10) as response:
                if response.status < 300:
                    logging.info("[AutomateNotification] Successfully sent notification to LlamaLabs Automate")
                    return True
                else:
                    body = await response.text()
                    logging.warning(f"[AutomateNotification] Failed to send notification. HTTP {response.status}: {body}")
                    return False
    except Exception as e:
        logging.error(f"[AutomateNotification] Error sending notification: {e}")
        return False
