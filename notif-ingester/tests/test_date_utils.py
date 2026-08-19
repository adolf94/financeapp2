import pytest
from datetime import datetime, timezone, timedelta
from services.date_utils import parse_iso_or_local_to_utc, format_utc_iso

def test_parse_iso_with_z():
    res = parse_iso_or_local_to_utc("2026-08-16T14:30:00Z")
    assert res == datetime(2026, 8, 16, 14, 30, 0, tzinfo=timezone.utc)

def test_parse_iso_with_timezone_offset():
    # 22:30:00 GMT+8 should convert to 14:30:00 UTC
    res = parse_iso_or_local_to_utc("2026-08-16T22:30:00+08:00")
    assert res == datetime(2026, 8, 16, 14, 30, 0, tzinfo=timezone.utc)

def test_parse_naive_iso_string_assumes_manila_and_converts_to_utc():
    # Naive "2026-08-16T22:30:00" should assume GMT+8 and convert to 14:30:00 UTC
    res = parse_iso_or_local_to_utc("2026-08-16T22:30:00")
    assert res == datetime(2026, 8, 16, 14, 30, 0, tzinfo=timezone.utc)

def test_parse_naive_datetime_assumes_manila_and_converts_to_utc():
    naive_dt = datetime(2026, 8, 16, 22, 30, 0)
    res = parse_iso_or_local_to_utc(naive_dt)
    assert res == datetime(2026, 8, 16, 14, 30, 0, tzinfo=timezone.utc)

def test_parse_epoch_millis_and_seconds():
    # 1723818600 is 2024-08-16 14:30:00 UTC
    res_sec = parse_iso_or_local_to_utc(1723818600)
    assert res_sec == datetime(2024, 8, 16, 14, 30, 0, tzinfo=timezone.utc)

    res_ms = parse_iso_or_local_to_utc(1723818600000)
    assert res_ms == datetime(2024, 8, 16, 14, 30, 0, tzinfo=timezone.utc)

def test_format_utc_iso():
    dt = datetime(2026, 8, 16, 14, 30, 0, tzinfo=timezone.utc)
    assert format_utc_iso(dt) == "2026-08-16T14:30:00Z"

    # Naive formatted as UTC Z
    naive = datetime(2026, 8, 16, 14, 30, 0)
    assert format_utc_iso(naive) == "2026-08-16T14:30:00Z"
