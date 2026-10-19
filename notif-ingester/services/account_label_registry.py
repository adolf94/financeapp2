"""
account_label_registry.py
-------------------------
Deterministic account selection support for AI classification.

The LLM never sees account GUIDs in classification prompts. Accounts are
presented as human-readable `Group | Name` labels; the model must copy an
exact label from the Available accounts list, and this module resolves the
label back to the real account (GUID) with strict validation against the
**fetched accounts list** (single source of truth, rebuilt every request):

- normalization: trim, collapse whitespace, case-insensitive, separator drift
  (" | ", " - ", ":") tolerated
- duplicate-label ambiguity detection (two accounts sharing `Group | Name`)
- resolution of debit/credit selections (incl. Shopee multi-order items)
  from the raw parsed JSON into real GUIDs
- bounded-retry feedback text + terminal fail-safe payload building

A label that does not resolve raises `AccountSelectionError` carrying a
fail-safe copy of the payload so callers can degrade gracefully (null IDs,
capped confidence, Pending status) instead of writing orphaned ledger
entries to CosmosDB.
"""

import copy
import logging
import re
from typing import Optional, Tuple

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

_SIDES = ("debit", "credit")


def looks_like_uuid(value) -> bool:
    """True when the model echoed an account GUID instead of a label."""
    if not value:
        return False
    return bool(_UUID_RE.fullmatch(str(value).strip().lower()))


class AccountSelectionError(Exception):
    """Raised when the model referenced accounts that don't exist or are ambiguous."""

    def __init__(self, invalid_labels=None, conflicts=None, partial_data=None):
        self.invalid_labels = list(invalid_labels or [])
        # label -> list of conflicting rendered labels
        self.conflicts = dict(conflicts or {})
        # Fail-safe snapshot: unresolved selections nulled, confidence capped,
        # auto-confirm disabled. Callers use this for the terminal fail-safe.
        self.partial_data = dict(partial_data or {})
        super().__init__(
            f"Invalid account selection: unknown={self.invalid_labels}, "
            f"ambiguous={list(self.conflicts.keys())}"
        )

    def build_feedback(self) -> str:
        """Human/model-readable correction section appended to the retry prompt."""
        lines = [
            "ACCOUNT SELECTION CORRECTION (your previous answer was REJECTED):",
        ]
        for label in self.invalid_labels:
            if looks_like_uuid(label):
                lines.append(
                    f'- "{label}" is an account ID/GUID — GUIDs are NOT accepted. '
                    f'Reference accounts by their exact `Group | Name` line instead.'
                )
            else:
                lines.append(
                    f'- "{label}" does NOT exist in the Available accounts list.'
                )
        for label, confs in self.conflicts.items():
            lines.append(
                f'- "{label}" is ambiguous — multiple accounts share this label: '
                f'({", ".join(confs)}). Use a more specific account or null.'
            )
        lines.append(
            "Copy ONLY exact `Group | Name` lines from the Available accounts list, "
            "or set the account field to null and provide `suggested_account_creation`."
        )
        return "\n".join(lines)


class AccountLabelRegistry:
    """Lookup from normalized `Group | Name` labels to accounts, built from the
    fetched accounts list for a single classification request."""

    def __init__(self, accounts: Optional[list]):
        self._accounts = list(accounts or [])
        self._by_label: dict[str, list[dict]] = {}
        for acc in self._accounts:
            label = self.normalize_label(self.label_for(acc))
            if not label:
                continue
            self._by_label.setdefault(label, []).append(acc)
        self._ambiguous: set[str] = {
            label for label, accs in self._by_label.items() if len(accs) > 1
        }
        if self._ambiguous:
            logging.warning(
                "[AccountLabelRegistry] Ambiguous account labels (duplicates): %s",
                sorted(self._ambiguous),
            )

    @staticmethod
    def label_for(acc: dict) -> str:
        """Canonical rendered label: `Group | Name` (falls back to whichever part exists)."""
        acc = acc or {}
        group = str(acc.get("accountGroupName") or "").strip()
        name = str(acc.get("name") or "").strip()
        if group and name:
            return f"{group} | {name}"
        return group or name

    @staticmethod
    def normalize_label(label) -> str:
        """Lowercase and collapse internal/outer whitespace."""
        if label is None:
            return ""
        return re.sub(r"\s+", " ", str(label)).strip().lower()

    @classmethod
    def _variant_keys(cls, label) -> list[str]:
        """Ordered lookup keys for a model-supplied label: plain normalization,
        then a canonical `group | name` rebuild split on the first standalone separator."""
        base = cls.normalize_label(label)
        if not base:
            return []
        variants = [base]
        m = re.match(r"^(.+?)\s*(?:\|\s*|\s+-\s+|\s+–\s+|\s+:\s+)\s*(.+)$", base)
        if m:
            group, name = m.group(1).strip(), m.group(2).strip()
            if group and name:
                variants.append(f"{group} | {name}")
        return variants

    def resolve(self, label) -> Tuple[Optional[dict], list[str]]:
        """Resolve a label to an account. Returns (account, conflicts):
        - exact/unique match → (account, [])
        - ambiguous (duplicate label) → (None, [rendered labels of each match])
        - unknown → (None, [])
        Falls back to a unique case-insensitive NAME-only match when the label
        has no group part (e.g. model wrote just "BPI Savings")."""
        keys = self._variant_keys(label)
        for key in keys:
            matches = self._by_label.get(key)
            if matches:
                if len(matches) > 1:
                    return None, [self.label_for(a) for a in matches]
                return matches[0], []

        # Name-only fallback: only when the label had no separator at all.
        base = keys[0] if keys else ""
        if base and not re.search(r"\||\s-\s|\s–\s|\s:\s", base):
            name_matches = [
                acc for acc in self._accounts
                if self.normalize_label(acc.get("name")) == base
            ]
            if len(name_matches) == 1:
                return name_matches[0], []
        return None, []

    def valid_account_ids(self) -> set:
        return {acc.get("id") for acc in self._accounts if acc.get("id")}


def _resolve_side(data: dict, side: str, registry: "AccountLabelRegistry") -> Tuple[Optional[str], Optional[str], dict[str, list[str]]]:
    """Resolve one debit/credit selection. Returns (resolved_id_or_None,
    invalid_label_or_None, conflicts keyed by the offending label).
    Pops the label keys from `data`."""
    label_key = f"{side}_account_name"
    id_key = f"{side}_account_id"
    label = data.pop(label_key, None)
    if label is None and id_key in data:
        # Legacy/rogue GUID-style answer: treat it as a label candidate; it will
        # fail resolution and trigger corrective feedback.
        label = data.pop(id_key)
    else:
        data.pop(id_key, None)

    if label is None or not str(label).strip():
        return None, None, {}

    stripped = str(label).strip()
    acc, conflicts = registry.resolve(label)
    if conflicts:
        return None, None, {stripped: conflicts}
    if acc is None:
        return None, stripped, {}
    return acc.get("id"), None, {}


def _cap_confidence(data: dict) -> dict:
    """Cap confidence at 0.5 and disable auto-confirm."""
    conf = data.get("confidence")
    try:
        conf = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        conf = None
    if conf is None or conf > 0.5:
        data["confidence"] = 0.5
    data["is_auto_confirmed"] = False
    return data


def _resolve_item_accounts(item: dict, registry: "AccountLabelRegistry") -> Tuple[list[str], dict[str, list[str]]]:
    """Resolve debit/credit labels inside one multi-order item dict (in place)."""
    invalid: list[str] = []
    conflicts: dict[str, list[str]] = {}
    for side in _SIDES:
        resolved_id, bad_label, side_conflicts = _resolve_side(item, side, registry)
        item[f"{side}_account_id"] = resolved_id
        if bad_label:
            invalid.append(bad_label)
        conflicts.update(side_conflicts)
    return invalid, conflicts


def resolve_parsed_accounts(data, registry: "AccountLabelRegistry") -> dict:
    """Resolve label-based account selections in raw parsed LLM JSON to real GUIDs.

    Handles dict payloads and Shopee-style lists / `orders` / `multi_order_items`.
    Raises `AccountSelectionError` when any referenced label is unknown (and no
    `suggested_account_creation` was offered) or ambiguous. The exception carries
    a fail-safe copy of the payload for terminal handling.
    """
    if isinstance(data, list):
        aggregate_invalid: list[str] = []
        aggregate_conflicts: dict[str, list[str]] = {}
        for idx, item in enumerate(data):
            if not isinstance(item, dict):
                continue
            invalid, conflicts = _resolve_item_accounts(item, registry)
            aggregate_invalid.extend(invalid)
            for key, conf in conflicts.items():
                aggregate_conflicts[f"order[{idx}] {key}"] = conf
        if aggregate_invalid or aggregate_conflicts:
            raise AccountSelectionError(aggregate_invalid, aggregate_conflicts, data)
        return data

    if not isinstance(data, dict):
        return data

    # Non-financial answers carry no account selection — skip validation.
    if data.get("is_financial") is False:
        for side in _SIDES:
            data.pop(f"{side}_account_name", None)
            data[f"{side}_account_id"] = None
        return data

    invalid: list[str] = []
    conflicts: dict[str, list[str]] = {}
    failed_sides: set[str] = set()

    for side in _SIDES:
        resolved_id, bad_label, side_conflicts = _resolve_side(data, side, registry)
        data[f"{side}_account_id"] = resolved_id
        if bad_label:
            invalid.append(bad_label)
        if side_conflicts:
            conflicts.update(side_conflicts)
        if bad_label or side_conflicts:
            failed_sides.add(side)

    # Shopee multi-order: resolve per-order debit/credit labels in place.
    for items_key in ("orders", "multi_order_items"):
        items = data.get(items_key)
        if not isinstance(items, list):
            continue
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            item_invalid, item_conflicts = _resolve_item_accounts(item, registry)
            invalid.extend(f"{items_key}[{idx}]: {lbl}" for lbl in item_invalid)
            for key, conf in item_conflicts.items():
                conflicts[f"{items_key}[{idx}] {key}"] = conf

    if not invalid and not conflicts:
        return data

    # Self-heal: unknown label but the model already suggested account creation —
    # null the selection and keep the suggestion instead of burning a retry.
    has_suggestion = bool(data.get("suggested_account_creation"))
    healable = invalid and not conflicts and has_suggestion
    # Fail-safe snapshot: only the failed sides are nulled; valid resolutions
    # (and any per-order resolved items) are preserved for terminal handling.
    snapshot = copy.deepcopy(_cap_confidence(data))
    for side in failed_sides:
        snapshot.pop(f"{side}_account_name", None)
        snapshot[f"{side}_account_id"] = None
    if healable:
        logging.info(
            "[resolve_parsed_accounts] Unknown account label(s) %s healed via suggested_account_creation.",
            invalid,
        )
        return data
    raise AccountSelectionError(invalid, conflicts, snapshot)


def build_fail_safe_parsed_data(error: AccountSelectionError, attempts: int) -> dict:
    """Terminal fail-safe payload after the final failed retry: null IDs,
    confidence capped at 0.5, auto-confirm disabled, explanatory notes."""
    data = dict(error.partial_data or {})
    note = (
        f"AI could not select valid accounts after {attempts} attempt(s) "
        f"(invalid: {', '.join(error.invalid_labels) or 'ambiguous labels'}) — "
        f"please pick accounts manually."
    )
    existing = data.get("notes")
    data["notes"] = f"{note} {existing}".strip() if existing else note
    conf = data.get("confidence")
    try:
        conf = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        conf = None
    if conf is None or conf > 0.5:
        data["confidence"] = 0.5
    data["is_auto_confirmed"] = False
    return data
