from datetime import datetime, timezone, timedelta
from typing import Optional, Union

# Default local timezone for banking / notifications is Asia/Manila (GMT+08:00)
MANILA_OFFSET = timedelta(hours=8)

def parse_iso_or_local_to_utc(date_val: Union[str, datetime, int, float, None]) -> Optional[datetime]:
    """
    Parse a date/timestamp input and return a timezone-aware datetime strictly normalized to UTC.
    If given a naive datetime or timestamp without offset, assumes Asia/Manila (GMT+8) and converts to UTC.
    If given an epoch millisecond or second timestamp, converts directly to UTC.
    """
    if date_val is None:
        return None

    if isinstance(date_val, (int, float)):
        if date_val > 30000000000:
            return datetime.fromtimestamp(date_val / 1000, tz=timezone.utc)
        return datetime.fromtimestamp(date_val, tz=timezone.utc)

    if isinstance(date_val, datetime):
        if date_val.tzinfo is None:
            # Naive datetime: assume Manila local time and convert to UTC
            return (date_val - MANILA_OFFSET).replace(tzinfo=timezone.utc)
        return date_val.astimezone(timezone.utc)

    if isinstance(date_val, str):
        s = date_val.strip()
        if not s:
            return None
        if s.isdigit():
            val = float(s)
            if val > 30000000000:
                return datetime.fromtimestamp(val / 1000, tz=timezone.utc)
            return datetime.fromtimestamp(val, tz=timezone.utc)

        try:
            # Handle ISO8601 with Z or offset
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                return (dt - MANILA_OFFSET).replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None

    return None

def format_utc_iso(dt: Optional[datetime]) -> Optional[str]:
    """Format a datetime strictly as an ISO8601 UTC string ending in 'Z'."""
    if dt is None:
        return None
    utc_dt = dt.astimezone(timezone.utc) if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    return utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
