"""
Unit tests for the PBI-022 retrieval upgrade:
  - services/transaction_card.py   (unified query/learning embedding space)
  - services/retrieval_service.py  (hybrid vector + BM25 + vendor signal via RRF)
  - services/runbook_index_service.py (rule-atomic chunking, pinned rules, retrieval)
  - wiring in ingestion_service (preprocess-first, retrieval service, rules context)
"""
import os
os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

import pytest
from unittest.mock import AsyncMock, MagicMock

from models.pending_ingestion import AiParsedData
from models.phone_hook import PhoneHookMessage
from models.transaction_vector import TransactionVector
from services.preprocessing_service import ExtractedAccountInfo
from services.transaction_card import (
    build_query_card_text,
    build_ocr_query_card_text,
    build_learning_card_text,
    extract_vendor_name,
)
from services.retrieval_service import SimpleBM25, RetrievalService, reciprocal_rank_fusion, tokenize
from services.runbook_index_service import (
    RunbookChunk,
    RunbookIndexService,
    chunk_runbook,
)
from services.ingestion_service import IngestionService
from services.vector_service import VectorService
from datetime import datetime, timezone


# ── transaction_card ─────────────────────────────────────────────────────────

def test_query_card_uses_structured_fields_not_raw_msg():
    extracted = ExtractedAccountInfo(
        account_numbers=["09171234567"],
        account_names=["Maybank Savings"],
        application="gcash",
        potential_vendor_names=["Grab"],
        currency="PHP",
    )
    card = build_query_card_text(extracted)
    assert "Grab" in card
    assert "Maybank Savings" in card
    assert "09171234567" in card
    assert "gcash" in card


def test_query_card_empty_when_no_extracted_info():
    assert build_query_card_text(None) == ""


def test_ocr_card_extracts_vendor_and_app():
    ocr = {"vendor": "Starbucks", "potential_vendor_names": [], "application": "", "inferred_app": "bpi"}
    card = build_ocr_query_card_text(ocr)
    assert "Starbucks" in card
    assert "bpi" in card


def test_learning_card_matches_existing_embed_text_format():
    parsed = {
        "vendor": {"name": "Grab"},
        "transaction_type": "Expense",
        "debit_account_id": "acc-1",
        "credit_account_id": "acc-2",
        "application": "grab",
    }
    accounts = [
        {"id": "acc-1", "name": "Wallet", "accountGroupName": "GCash"},
        {"id": "acc-2", "name": "Savings", "accountGroupName": "Maybank"},
    ]
    card = build_learning_card_text(parsed, accounts)
    assert card == "Grab Expense GCash - Wallet Maybank - Savings grab"


def test_learning_and_query_cards_share_vocabulary():
    """Query side and learning side must produce overlapping vocabulary."""
    extracted = ExtractedAccountInfo(
        account_numbers=[],
        account_names=["GCash Wallet"],
        application="grab",
        potential_vendor_names=["Grab"],
        currency="PHP",
    )
    parsed = {
        "vendor": {"name": "Grab"},
        "transaction_type": "Expense",
        "debit_account_id": "acc-1",
        "credit_account_id": "",
        "application": "grab",
    }
    accounts = [{"id": "acc-1", "name": "Wallet", "accountGroupName": "GCash"}]
    query_tokens = set(tokenize(build_query_card_text(extracted)))
    learning_tokens = set(tokenize(build_learning_card_text(parsed, accounts)))
    overlap = query_tokens & learning_tokens - {"grab"}
    assert len(overlap) >= 2


def test_extract_vendor_name_handles_shapes():
    assert extract_vendor_name({"vendor": {"name": "Grab"}}) == "Grab"
    assert extract_vendor_name({"vendor": ""}) == ""


# ── SimpleBM25 ────────────────────────────────────────────────────────────────

def test_bm25_ranks_relevant_doc_first():
    docs = [
        tokenize("grab ride expense gcash wallet"),
        tokenize("maybank withdrawal atm cash"),
        tokenize("shopee order payment maybank savings"),
    ]
    bm25 = SimpleBM25(docs)
    scores = bm25.scores("maybank withdrawal")
    assert scores[1] > scores[0]
    assert scores[1] > scores[2]


def test_bm25_no_match_returns_zero():
    bm25 = SimpleBM25([tokenize("grab ride")])
    assert bm25.scores(" totally unrelated ") == [0.0]


# ── RRF fusion ────────────────────────────────────────────────────────────────

def test_rrf_favors_docs_ranked_high_in_multiple_channels():
    fused = reciprocal_rank_fusion(
        [[0, 1, 2], [1, 0, 2]],
        weights=[1.0, 1.0],
        k=60,
    )
    # doc 1 ranks 1st in one list and 2nd in the other; doc 0 ranks 1st and 2nd
    assert fused[0] == pytest.approx(1 / 61 + 1 / 62, abs=1e-9)
    assert fused[1] == pytest.approx(1 / 61 + 1 / 62, abs=1e-9)
    assert fused[2] == pytest.approx(1 / 63 + 1 / 63, abs=1e-9)


def test_rrf_weight_boosts_channel():
    fused = reciprocal_rank_fusion([[0], [1]], weights=[1.0, 5.0])
    assert fused[1] > fused[0]


# ── RetrievalService ──────────────────────────────────────────────────────────

def _vec(tx_id: str, vendor: str, embed_text: str, embedding: list) -> TransactionVector:
    return TransactionVector(
        user_id="user-1",
        transaction_id=tx_id,
        vendor=vendor,
        category="Food",
        summary=f"{vendor} purchase",
        embed_text=embed_text,
        embedding=embedding,
    )


@pytest.mark.asyncio
async def test_retrieval_fusion_uses_cosine_score_and_rrf_order():
    # Vec A: strong lexical match but poor cosine; Vec B: strong cosine, no lexical
    a = _vec("tx-a", "Maybank", "maybank withdrawal atm cash", [1.0, 0.0])
    b = _vec("tx-b", "Grab", "grab ride expense", [0.0, 1.0])
    query = [0.9, 0.4]  # cosine favors a
    query_text = "maybank withdrawal"

    vector_service = MagicMock(spec=VectorService)
    vector_service.find_similar_async = AsyncMock(return_value=[(a, 0.99), (b, 0.05)])

    svc = RetrievalService(vector_service)
    results = await svc.find_similar_async(query, "user-1", query_text=query_text, top_k=2)

    assert len(results) == 2
    # Lexical winner (a) must come first under RRF despite near-zero cosine for b
    scores = {r[0].transaction_id: r[1] for r in results}
    assert results[0][0].transaction_id == "tx-a"
    # Returned scores remain cosine similarities (threshold semantics preserved)
    assert scores["tx-a"] == 0.99


@pytest.mark.asyncio
async def test_retrieval_vendor_signal_boosts_vendor_match():
    a = _vec("tx-a", "Grab", "grab ride expense", [0.5, 0.5])
    b = _vec("tx-b", "Maybank", "maybank withdrawal", [0.6, 0.6])
    vector_service = MagicMock(spec=VectorService)
    vector_service.find_similar_async = AsyncMock(return_value=[(b, 0.9), (a, 0.8)])

    svc = RetrievalService(vector_service)
    results = await svc.find_similar_async(
        [1.0, 1.0], "user-1", query_text="grab", top_k=2,
        vendor_matches=[{"vendor_name": "Grab", "matched_lookups": ["grab"]}]
    )

    assert results[0][0].transaction_id == "tx-a"


@pytest.mark.asyncio
async def test_retrieval_empty_candidates_returns_empty():
    vector_service = MagicMock(spec=VectorService)
    vector_service.find_similar_async = AsyncMock(return_value=[])
    svc = RetrievalService(vector_service)
    assert await svc.find_similar_async([1.0], "user-1", query_text="x") == []


# ── chunk_runbook ─────────────────────────────────────────────────────────────

RUNBOOK_MD = """Explicit rules override vector similarity.

## Strict ID Handling

- [pinned] Never guess account IDs; verify against the accounts list.

## Maybank Withdrawals

- Maybank withdrawal = transfer to Cash Wallet.

## Mappings & Logic

### Grab

- Grab ride = Expense, debit GCash Wallet.
- Grab food = Expense, debit GCash Wallet.
- Grab mart = Expense, debit Maybank Savings.
- Grab express = Expense, debit GCash Wallet.

### Shopee

- Shopee order = Expense, debit Maybank Credit.
"""


def test_chunk_runbook_small_section_is_single_chunk():
    chunks = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    maybank = [c for c in chunks if "Maybank Withdrawals" in c.section_title]
    assert len(maybank) == 1
    assert "Maybank withdrawal = transfer" in maybank[0].content


def test_chunk_runbook_carries_section_context():
    chunks = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    grab = [c for c in chunks if "Grab ride" in c.content][0]
    assert grab.section_title == "Mappings & Logic — Grab"
    assert grab.content.startswith("## Mappings & Logic — Grab")


def test_chunk_runbook_fat_subsection_splits_per_bullet():
    chunks = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    grab_chunks = [c for c in chunks if c.section_title == "Mappings & Logic — Grab"]
    assert len(grab_chunks) == 4
    assert all("Grab" in c.content for c in grab_chunks)


def test_chunk_runbook_preamble_and_pinned_detection():
    chunks = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    header = [c for c in chunks if c.section_title == "Header"]
    assert len(header) == 1
    assert header[0].pinned  # "override" in preamble
    strict = [c for c in chunks if "Strict ID Handling" in c.section_title]
    assert strict[0].pinned  # section title match + [pinned] tag
    assert not any(c.pinned for c in chunks if "Shopee" in c.section_title)


def test_chunk_runbook_stable_rule_ids():
    chunks1 = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    chunks2 = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    ids1 = sorted(c.rule_id for c in chunks1)
    ids2 = sorted(c.rule_id for c in chunks2)
    assert ids1 == ids2
    assert all(rule_id.startswith("R-SMS-") for rule_id in ids1)


def test_chunk_runbook_rule_id_changes_when_rule_changes():
    c1 = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    modified = RUNBOOK_MD.replace("Grab ride = Expense", "Grab ride = Transportation")
    c2 = chunk_runbook(modified, "runbook-sms")
    old_ids = {c.rule_id for c in c1}
    new_ids = {c.rule_id for c in c2}
    assert old_ids != new_ids


def test_chunk_runbook_channel_codes():
    app = chunk_runbook(RUNBOOK_MD, "runbook")
    sms = chunk_runbook(RUNBOOK_MD, "runbook-sms")
    pkg = chunk_runbook(RUNBOOK_MD, "runbook-app:com.gcash")
    assert all(c.rule_id.startswith("R-APP-") for c in app)
    assert all(c.rule_id.startswith("R-SMS-") for c in sms)
    assert all(c.rule_id.startswith("R-APP-COM-GCASH") for c in pkg)


def test_chunk_runbook_empty():
    assert chunk_runbook("", "runbook") == []


# ── RunbookIndexService ───────────────────────────────────────────────────────

def _make_index_service(chunks=None):
    embedding = AsyncMock()
    embedding.embed_async = AsyncMock(side_effect=lambda text: [float(len(text)), 1.0])
    repo = AsyncMock()
    repo.replace_all_async = AsyncMock()
    repo.get_by_runbook_async = AsyncMock(return_value=chunks or [])
    return RunbookIndexService(embedding, repo), embedding, repo


@pytest.mark.asyncio
async def test_reindex_embeds_and_persists_chunks():
    svc, embedding, repo = _make_index_service()
    chunks = await svc.reindex_runbook_async("user-1", "runbook-sms", RUNBOOK_MD)
    assert chunks
    assert all(c.embedding is not None for c in chunks)
    assert all(c.user_id == "user-1" for c in chunks)
    repo.replace_all_async.assert_awaited_once()
    assert embedding.embed_async.await_count == len(chunks)


@pytest.mark.asyncio
async def test_reindex_skips_reembed_on_same_content():
    svc, embedding, repo = _make_index_service()
    await svc.reindex_runbook_async("user-1", "runbook-sms", RUNBOOK_MD)
    count = embedding.embed_async.await_count
    await svc.reindex_runbook_async("user-1", "runbook-sms", RUNBOOK_MD)
    assert embedding.embed_async.await_count == count


@pytest.mark.asyncio
async def test_get_rules_context_pinned_always_included():
    pinned = RunbookChunk(
        runbook_id="runbook-sms", section_title="Strict ID Handling",
        rule_id="R-SMS-AAA", content="## Strict ID Handling\n\nNever guess IDs.",
        pinned=True,
    )
    filler = RunbookChunk(
        runbook_id="runbook-sms", section_title="Other",
        rule_id="R-SMS-BBB", content="## Other\n\nIrrelevant rule.",
        embedding=[0.0, 0.0],
    )
    svc, _, repo = _make_index_service(chunks=[pinned, filler])
    repo.get_by_runbook_async.return_value = [pinned, filler]

    ctx = await svc.get_rules_context_async(
        "user-1", ["runbook-sms"],
        query_embedding=[1.0, 0.0],
        query_text="something totally unrelated to any rule",
    )

    assert "R-SMS-AAA" in ctx
    assert "(pinned)" in ctx
    # Unrelated, unpinned chunk with zero similarity should not crowd the context
    assert "R-SMS-BBB" in ctx or "Irrelevant" not in ctx


@pytest.mark.asyncio
async def test_get_rules_context_ranks_by_embedding_similarity():
    near = RunbookChunk(
        runbook_id="runbook-sms", section_title="Grab",
        rule_id="R-SMS-CCC", content="## Grab\n\nGrab ride = Expense.",
        embedding=[1.0, 0.0],
    )
    far = RunbookChunk(
        runbook_id="runbook-sms", section_title="Maybank",
        rule_id="R-SMS-DDD", content="## Maybank\n\nMaybank withdrawal rule.",
        embedding=[0.0, 1.0],
    )
    svc, _, repo = _make_index_service(chunks=[far, near])
    repo.get_by_runbook_async.return_value = [far, near]

    ctx = await svc.get_rules_context_async(
        "user-1", ["runbook-sms"], query_embedding=[1.0, 0.0], query_text="grab ride"
    )

    assert "R-SMS-CCC" in ctx
    # Zero-similarity, zero-lexical-overlap rule must be excluded entirely
    assert "R-SMS-DDD" not in ctx


@pytest.mark.asyncio
async def test_get_rules_context_empty_when_no_chunks():
    svc, _, _ = _make_index_service(chunks=[])
    assert await svc.get_rules_context_async("user-1", ["runbook-sms"]) == ""


# ── FinanceApiService reindex trigger ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_runbook_triggers_reindex():
    from services.finance_api_service import FinanceApiService
    svc = FinanceApiService.__new__(FinanceApiService)
    svc.client = MagicMock()
    svc.db_name = "FinanceDb"
    svc.container_client = MagicMock()
    svc.client.get_database_client.return_value.get_container_client.return_value = svc.container_client
    svc.container_client.upsert_item = AsyncMock()
    svc.runbook_index_service = AsyncMock()

    await svc.save_runbook_content_async("user-1", "# Rules", runbook_id="runbook-sms")

    svc.runbook_index_service.reindex_runbook_async.assert_awaited_once_with(
        "user-1", "runbook-sms", "# Rules"
    )


@pytest.mark.asyncio
async def test_save_runbook_reindex_failure_does_not_break_save():
    from services.finance_api_service import FinanceApiService
    svc = FinanceApiService.__new__(FinanceApiService)
    svc.client = MagicMock()
    svc.db_name = "FinanceDb"
    svc.container_client = MagicMock()
    svc.client.get_database_client.return_value.get_container_client.return_value = svc.container_client
    svc.container_client.upsert_item = AsyncMock()
    svc.runbook_index_service = AsyncMock()
    svc.runbook_index_service.reindex_runbook_async = AsyncMock(side_effect=RuntimeError("boom"))

    await svc.save_runbook_content_async("user-1", "# Rules")

    svc.container_client.upsert_item.assert_awaited_once()


# ── IngestionService wiring ───────────────────────────────────────────────────

def _make_wired_service():
    finance = MagicMock()
    finance.get_accounts_async = AsyncMock(return_value=[])
    finance.get_vendors_async = AsyncMock(return_value=[])
    finance.get_runbook_content_async = AsyncMock(return_value="GLOBAL")
    finance.get_app_runbook_content_async = AsyncMock(return_value="")
    finance.search_all_vendor_matches_by_lookups_async = AsyncMock(return_value=[])
    finance.search_confirmed_ledger_entries_async = AsyncMock(return_value=[])
    finance.get_specific_accounts_async = AsyncMock(return_value=[])

    embedding = AsyncMock()
    embedding.embed_async = AsyncMock(return_value=[0.1, 0.2])
    vector_service = MagicMock(spec=VectorService)
    vector_service.find_similar_async = AsyncMock(return_value=[])

    retrieval = RetrievalService(vector_service)
    runbook_index = AsyncMock()
    runbook_index.get_rules_context_async = AsyncMock(return_value="")

    service = IngestionService(
        ingestion_repo=AsyncMock(),
        embedding_service=embedding,
        vector_service=vector_service,
        ai_service=MagicMock(_debug_repo=None),
        finance_api_service=finance,
        retrieval_service=retrieval,
        runbook_index_service=runbook_index,
    )
    service._ai_service.classify_async = AsyncMock(return_value=AiParsedData(is_financial=True))
    service._ai_service.is_financial_transaction_async = AsyncMock(return_value=True)
    service._ai_service.get_default_runbook_content = MagicMock(return_value="FALLBACK")
    return service, finance, embedding, runbook_index


def _hook(extracted: dict = None) -> PhoneHookMessage:
    payload = {"notif_pkg": "com.example.app"}
    if extracted is not None:
        payload["extracted_info"] = extracted
    return PhoneHookMessage(
        id="hook-1",
        user_id="user-1",
        raw_msg="Paid 100 to Grab",
        raw_payload=payload,
        action="",
        status="",
        month_key="2026-10",
        partition_key="user-1",
        received_at=datetime.now(timezone.utc),
        notification_type="app",
    )


@pytest.mark.asyncio
async def test_process_hook_embeds_query_card_not_raw_msg():
    service, finance, embedding, runbook_index = _make_wired_service()
    service._vector_service.find_similar_async = AsyncMock(return_value=[])
    service._repo.add_async = AsyncMock(side_effect=lambda x: x)

    hook = _hook({"potential_vendor_names": ["Grab"], "account_names": ["GCash Wallet"], "amount": 100})
    await service.process_hook_async(hook)

    embedded_text = embedding.embed_async.await_args_list[0].args[0]
    assert "Grab" in embedded_text
    assert "Paid 100 to Grab" not in embedded_text


@pytest.mark.asyncio
async def test_process_hook_uses_hybrid_retrieval_service():
    service, finance, embedding, runbook_index = _make_wired_service()
    service._repo.add_async = AsyncMock(side_effect=lambda x: x)
    orig_find = service._retrieval_service.find_similar_async
    service._retrieval_service.find_similar_async = AsyncMock(side_effect=orig_find)

    hook = _hook({"potential_vendor_names": ["Grab"], "amount": 100})
    await service.process_hook_async(hook)

    service._retrieval_service.find_similar_async.assert_awaited_once()
    kwargs = service._retrieval_service.find_similar_async.call_args.kwargs
    assert "Grab" in kwargs["query_text"]
    assert kwargs["vendor_matches"] == []


@pytest.mark.asyncio
async def test_process_hook_injects_rules_context_over_whole_doc():
    service, finance, embedding, runbook_index = _make_wired_service()
    runbook_index.get_rules_context_async = AsyncMock(return_value="[R-APP-XXX] pinned rule")
    service._repo.add_async = AsyncMock(side_effect=lambda x: x)

    hook = _hook({"potential_vendor_names": ["Grab"], "amount": 100})
    await service.process_hook_async(hook)

    call_args = service._ai_service.classify_async.call_args
    assert call_args.args[3] == "[R-APP-XXX] pinned rule"
    runbook_ids = runbook_index.get_rules_context_async.call_args[0][1]
    assert "runbook" in runbook_ids
    assert "runbook-app:com.example.app" in runbook_ids


@pytest.mark.asyncio
async def test_process_hook_falls_back_to_whole_doc_without_index():
    service, finance, embedding, runbook_index = _make_wired_service()
    runbook_index.get_rules_context_async = AsyncMock(return_value="")
    service._repo.add_async = AsyncMock(side_effect=lambda x: x)

    hook = _hook({"potential_vendor_names": ["Grab"], "amount": 100})
    await service.process_hook_async(hook)

    call_args = service._ai_service.classify_async.call_args
    assert "GLOBAL" in call_args.args[3]


@pytest.mark.asyncio
async def test_process_hook_without_index_service_uses_whole_doc():
    finance = MagicMock()
    finance.get_accounts_async = AsyncMock(return_value=[])
    finance.get_vendors_async = AsyncMock(return_value=[])
    finance.get_runbook_content_async = AsyncMock(return_value="GLOBAL")
    finance.get_app_runbook_content_async = AsyncMock(return_value="")
    finance.search_all_vendor_matches_by_lookups_async = AsyncMock(return_value=[])
    finance.search_confirmed_ledger_entries_async = AsyncMock(return_value=[])

    embedding = AsyncMock()
    embedding.embed_async = AsyncMock(return_value=[0.1])
    vector_service = MagicMock(spec=VectorService)
    vector_service.find_similar_async = AsyncMock(return_value=[])

    service = IngestionService(
        ingestion_repo=AsyncMock(),
        embedding_service=embedding,
        vector_service=vector_service,
        ai_service=MagicMock(_debug_repo=None),
        finance_api_service=finance,
    )
    service._ai_service.classify_async = AsyncMock(return_value=AiParsedData(is_financial=True))
    service._ai_service.is_financial_transaction_async = AsyncMock(return_value=True)
    service._ai_service.get_default_runbook_content = MagicMock(return_value="FALLBACK")
    service._repo.add_async = AsyncMock(side_effect=lambda x: x)

    hook = _hook({"potential_vendor_names": ["Grab"], "amount": 100})
    await service.process_hook_async(hook)

    call_args = service._ai_service.classify_async.call_args
    assert "GLOBAL" in call_args.args[3]


@pytest.mark.asyncio
async def test_embed_and_learn_stores_card_and_raw_summary():
    service, finance, embedding, _ = _make_wired_service()
    finance.get_specific_accounts_async = AsyncMock(return_value=[
        {"id": "acc-1", "name": "Wallet", "accountGroupName": "GCash"}
    ])

    from models.pending_ingestion import PendingIngestion
    ingestion = PendingIngestion(
        user_id="user-1",
        hook_id="hook-1",
        received_at=datetime.now(timezone.utc),
        raw_payload={},
        raw_msg="Paid 100 to Grab via GCash",
        ai_parsed=AiParsedData(is_financial=True),
        user_confirmed={
            "vendor": {"name": "Grab"},
            "transaction_type": "Expense",
            "debit_account_id": "acc-1",
            "credit_account_id": "",
            "application": "grab",
        },
        transaction_id="tx-1",
        month_key="2026-10",
        partition_key="user-1",
    )
    service._vector_service.upsert_async = AsyncMock()

    await service.embed_and_learn_async(ingestion)

    vector = service._vector_service.upsert_async.call_args[0][0]
    assert vector.embed_text == "Grab Expense GCash - Wallet grab"
    assert vector.raw_msg_summary == "Paid 100 to Grab via GCash"
    assert vector.vendor == "Grab"
    assert vector.debit_account_name == "GCash - Wallet"
    assert vector.credit_account_name == ""


def test_resolve_account_names_formats_group_and_name():
    from services.transaction_card import resolve_account_names
    accounts = [
        {"id": "acc-1", "name": "Wallet", "accountGroupName": "GCash"},
        {"id": "acc-2", "name": "Savings", "accountGroupName": "Maybank"},
    ]
    parsed = {"debit_account_id": "acc-1", "credit_account_id": "acc-2"}
    debit, credit = resolve_account_names(parsed, accounts)
    assert debit == "GCash - Wallet"
    assert credit == "Maybank - Savings"

    # Unknown ids resolve to empty strings, never fabricated
    parsed_unknown = {"debit_account_id": "acc-404", "credit_account_id": None}
    debit, credit = resolve_account_names(parsed_unknown, accounts)
    assert debit == ""
    assert credit == ""

    # Missing group or name degrades gracefully to whichever exists
    partial = [{"id": "acc-3", "name": "Cash", "accountGroupName": ""}]
    debit, credit = resolve_account_names({"debit_account_id": "acc-3"}, partial)
    assert debit == "Cash"


def test_build_context_renders_account_names_with_ids():
    from services.ai_service import AiService
    vec = _vec("tx-a", "Grab", "grab ride expense", [1.0, 0.0])
    vec.debit_account_id = "acc-1"
    vec.credit_account_id = "acc-2"
    vec.debit_account_name = "GCash Wallet"
    vec.credit_account_name = "Maybank Savings"

    ai = AiService.__new__(AiService)
    ai._debug_repo = None
    context = ai._build_context([(vec, 0.9)])

    assert "acc-1 (GCash Wallet)" in context
    assert "acc-2 (Maybank Savings)" in context


def test_build_context_falls_back_to_id_or_na_when_name_missing():
    from services.ai_service import AiService
    vec = _vec("tx-a", "Grab", "grab ride expense", [1.0, 0.0])
    vec.debit_account_id = "acc-1"
    vec.credit_account_id = "acc-2"
    vec.debit_account_name = ""
    vec.credit_account_name = ""

    ai = AiService.__new__(AiService)
    ai._debug_repo = None
    context = ai._build_context([(vec, 0.9)])

    assert "Debit Acc: acc-1" in context
    assert "Credit Acc: acc-2" in context
