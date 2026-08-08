from models.phone_hook import PhoneHookMessage


class NotificationTypeDetector:
    """Determines whether a hook is an SMS or App notification.

    Detection rules (applied in order):
    1. hook.notification_type already set (not 'unknown') -> trust it
    2. action contains 'sms' (e.g. 'sms_receive')        -> 'sms'
    3. payload has sms_rcv_sender / sms_sender            -> 'sms'
    4. payload has sms_rcv_msg / sms_msg                  -> 'sms'
    5. action == 'notif_post' or payload has notif_pkg    -> 'app'
    6. Fallback                                           -> 'app'
    """

    SMS_TYPE = "sms"
    APP_TYPE = "app"
    EMAIL_TYPE = "email"

    def detect_type(self, hook: PhoneHookMessage) -> str:
        """Return 'sms', 'app', or 'email' based on hook action and payload fields."""
        if hook.notification_type and hook.notification_type != "unknown":
            return hook.notification_type
        return self._detect_from_payload(hook.action, hook.raw_payload)

    def detect_type_from_payload(self, action: str, payload: dict) -> str:
        """Convenience: detect from raw values (useful before model construction)."""
        return self._detect_from_payload(action or "", payload or {})

    def _detect_from_payload(self, action: str, payload: dict) -> str:
        action_lower = (action or "").lower()
        
        # Email indicators
        if action_lower == "email_received":
            return self.EMAIL_TYPE

        # SMS indicators
        if "sms" in action_lower:
            return self.SMS_TYPE
        if payload.get("sms_rcv_sender") or payload.get("sms_sender"):
            return self.SMS_TYPE
        if payload.get("sms_rcv_msg") or payload.get("sms_msg"):
            return self.SMS_TYPE

        # App indicators
        if action_lower == "notif_post" or payload.get("notif_pkg"):
            return self.APP_TYPE

        # Default: treat as app notification
        return self.APP_TYPE

