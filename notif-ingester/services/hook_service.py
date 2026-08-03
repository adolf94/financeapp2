from models.phone_hook import PhoneHookMessage
from repositories.hook_repository import IHookRepository
from datetime import datetime, timezone
import json

class HookService:
    def __init__(self, repo: IHookRepository):
        self._repo = repo

    async def save_hook_async(self, body: dict) -> PhoneHookMessage:
        notif_id = body.get("notif_id")
        timestamp_str = body.get("timestamp")
        
        # Determine month_key from timestamp
        try:
            if timestamp_str:
                dt = datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            else:
                dt = datetime.now(timezone.utc)
        except ValueError:
            dt = datetime.now(timezone.utc)
            
        month_key = dt.strftime("%Y-%m-01")

        if notif_id:
            existing = await self._repo.get_by_notif_id_async(notif_id, month_key)
            if existing:
                return existing # Already processed

        action = body.get("action", "unknown")
        raw_msg = f"{body.get('notif_title', '')}: {body.get('notif_msg', '')}".strip()
        if not raw_msg or raw_msg == ":":
            raw_msg = "Unknown notification"

        hook_msg = PhoneHookMessage(
            user_id="3575cfa0-ec94-40d2-8b25-ee9f0f135027",
            action=action,
            raw_payload=body,
            raw_msg=raw_msg,
            month_key=month_key,
            partition_key=month_key
        )

        return await self._repo.add_async(hook_msg)
