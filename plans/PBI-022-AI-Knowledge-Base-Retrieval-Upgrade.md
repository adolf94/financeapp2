---
status: implemented (Phases 1–3 + partial Phase 4; Phase 5 + reranker + corrections loop deferred)
---# AI Knowledge Base Retrieval Pipeline Upgrade — Architectural Assessment & Plan

> Assessment date: 2026-10-17
> Scope: Reduce hallucinations, improve search quality, and replace naive chunking/search across the
> notification-ingestion AI pipeline (`notif-ingester/`) and the CosmosDB runbook state (`/cosmos`).
> No files were modified during the assessment phase.

---

## 1. Current File & Data Map

### 1.1 Knowledge Ingestion & Document Processing
There is **no document ingestion (PDF/TXT) and no chunking** — "knowledge" = runbook markdown, always injected **whole** into the prompt:

| Component | Location |
|---|---|
| Runbook fetch (Cosmos `Settings` container, partitioned by `/UserId`) | `notif-ingester/services/finance_api_service.py:602-768` (`get_runbook_content_async`, `runbook-sms`, `runbook-email`, `runbook-app:{pkg}`, `runbook-review-session`) |
| Runbook injection into prompt | `notif-ingester/services/ai_service.py:569-587` (`classify_async` → `APP_CLASSIFICATION_USER_PROMPT.format(runbook_content=...)`) |
| Static fallback / bootstrap templates | `notif-ingester/RUNBOOK.md`, `notif-ingester/runbooks/{sms,email,shopee_email,image}_runbook.md` (loaded via `ai_service.py:438-445`, `sms_processing_service.py:86-116`, `email_processing_service.py:109-148`) |
| Only "budget" mechanism | 8,000-char truncation for the per-app runbook tier only: `ingestion_service.py:78-83` |

### 1.2 `/cosmos` (runbook state dump) — `cosmos/settings.json`
5 documents in the `Settings` container, all partitioned by `UserId`:

| id | Shape | Role |
|---|---|---|
| `runbook` | `{id, UserId, content: markdown}` | Global app-notification rules ("explicit rules override vector similarity") |
| `runbook-sms` / `runbook-email` / `runbook-image` | same | Channel-specific rule tiers |
| `runbook-review-session` | `{corrections[], runbook_type, pkg, chat_history[], proposed_runbook, account_description_updates[], vendor_updates[], created_at, updated_at}` | **Live operational state** from the Runbook Review chat (promoted to `runbook` docs only on user acceptance) |

The runbooks are **structured rule documents** (ID-handling, Transfer vs Expense logic, account-number verification, confidence thresholds per channel) — read fresh per classification via point-read (`read_item`, `finance_api_service.py:609`), so the pipeline is *not* stale for the main runbooks. Staleness risk exists only in (a) the static `RUNBOOK.md` fallback and (b) the `proposed_runbook` sitting unaccepted in the review session.

### 1.3 Vector Storage & Search
- **Store:** CosmosDB container `TransactionVectors` (`repositories/vector_repository.py:18-46`), model `models/transaction_vector.py` (768-dim Gemini embeddings per `embedding_service.py`).
- **Search:** `services/vector_service.py:10-34` — loads **ALL user vectors into memory** and computes cosine in a Python loop. No vector index, no `VectorDistance` query, no BM25/full-text, no hybrid search, no reranking. (`grep` across the repo confirms: no qdrant/pinecone/pgvector/faiss/bm25/rerank usage.)
- **Learning loop:** `ingestion_service.py:674-730` (`embed_and_learn_async`) upserts one vector per confirmed transaction.

### 1.4 LLM Orchestration
- Entry: CosmosDB Change Feed → `ClassifyNotificationFunction` → `NotificationTypeDetector` → 4 pipelines (App/SMS/Email/Image), all extending `IngestionService` (`ingestion_service.py`; subclasses in `sms/email/image_processing_service.py`).
- Context assembly order in `process_hook_async` (`ingestion_service.py:350-541`):
  1. Embed raw msg
  2. Top-5 vector search
  3. Fetch accounts + vendors + runbook (Cosmos point-read)
  3.5 `is_financial` gate (App & SMS)
  3.6 Preprocess (AI call #1) → vendor lookup + related-txn context
  4. Classify (AI call #2, full context injection)
  5. Auto-confirm logic → embed & learn
- Prompts: `prompts/{app,sms,email,image,runbook}_prompts.py`; providers: `llm_provider.py`; debug telemetry: `ai_service.py:55-148` + `debug_prompts/*.md`.
- Reference doc: `notif-ingester/AI_PIPELINE_ANALYSIS.md` documents the pipeline design and prior decisions.

---

## 2. Architecture Gaps (hallucination & mismatch drivers)

1. **Query/document embedding asymmetry (critical).**
   Queries embed `hook.raw_msg` (raw SMS/notification text, `ingestion_service.py:353`), but stored vectors embed a structured `embed_text` of *vendor + tx_type + account names + application* (`ingestion_service.py:701-714`). Cosine similarity between a raw notification and a structured label string is near-noise → the "similar past transactions" context the prompt tells the model to trust is effectively garbage. This directly pushes the LLM to lean on parametric memory → hallucinated vendors/categories.

2. **Naive retrieval mechanics.**
   Full in-memory O(N) scan per notification (`vector_service.py:14-33`); no ANN index, no lexical/BM25 channel, no score fusion, no reranker. The vendor lookup (`search_all_vendor_matches_by_lookups_async`) is the only "lexical" signal and is injected unscored/unfused.

3. **Runbook never chunked/indexed — prompt-bloat grounding risk.**
   The full runbook (plus app-tier, plus Shopee runbook for emails) is injected on *every* call. Only the app-tier has a truncation budget (`ingestion_service.py:78-83`); the global/channel runbooks don't. As runbooks grow (they already contain dozens of rules), relevance dilution → the model misses or contradicts the one applicable rule. Rules also lack stable IDs, so the `why` field can't cite rules verifiably.

4. **No abstention/grounding discipline.**
   Prompts say "DO NOT hallucinate account IDs" (`app_prompts.py:51`) but never define behavior when context is insufficient — no "set confidence ≤ 0.5 / leave accounts null" fallback tied to retrieval scores. The SMS runbook's own confidence thresholds (`confidence <= 0.80 requires review`) live in runbook data, not enforced by code; auto-confirm (`ingestion_service.py:507-519`) trusts self-reported confidence.

5. **Operational state underused.**
   `runbook-review-session.corrections` and `user_why` corrections are queued only for the review chat (`learn_ingestion_async:661-665`); they are never embedded as few-shot exemplars or feedback signals into the classification prompt, so the system repeats mistakes until a human lands a runbook edit.

6. **Static/dynamic duplication.**
   Four bundled `.md` templates + root `RUNBOOK.md` duplicate CosmosDB content; bootstrap-on-first-use writes them into Cosmos, after which they silently drift. No versioning (`_etag` ignored), no re-index trigger on runbook save.

7. **Image pipeline has no retrieval at all** (`similar_vectors=[]` hardcoded), and email queries embed a summarized `raw_msg`, worsening gap #1.

---

## 3. Concrete Upgrade Plan (ordered)

> **Decision (2026-10-17):** The retrieval layer is **storage-agnostic** — implemented behind the existing repository/service interfaces so the vector backend is swappable by config:
> - **Backend A (assumed, default): pgvector** — the app is migrating off CosmosDB to self-hosted **PostgreSQL 17 with pgvector** (see `plans/PBI-023-Homelab-Docker-Self-Hosting.md`, which assumes pgvector). `vector(768)` column + HNSW index, hybrid via Postgres FTS + RRF.
> - **Backend B (retained option): CosmosDB** — for the current Azure deployment or if the homelab migration is abandoned. Two sub-options: native NoSQL vector search (`VectorDistance`, requires the account feature flag; DiskANN needs ≥1,000 vectors, else server-side flat scan) **or** in-process ANN (usearch) persisted to Blob as a rebuildable cache. Lexical channel = in-process BM25.
>
> All later phases (hybrid fusion, reranker, runbook chunking, grounding) are backend-independent and work on either.

### Phase 1 — Fix retrieval fundamentals (highest hallucination ROI)
1. **Unify embedding space.**
   In `ingestion_service.py`, embed the *query* with the same canonical representation used at learning time: run preprocess first (extracted vendor/account/app fields), build a query "transaction card," and embed that — or switch both sides to a notification-normalized template. Update `embed_and_learn_async` to also store `raw_msg_summary` for reranking display.
2. **Move vector search into a real ANN backend (swappable via `IVectorRepository`/`RetrievalService`).**
   - **Backend A — pgvector (default, per PBI-023):** `TransactionVectors` becomes a `transaction_vectors` table with an `embedding vector(768)` column and an **HNSW** index (`vector_cosine_ops`); `vector_service.py` runs `ORDER BY embedding <=> $1 LIMIT k` via the SQLAlchemy repository. No 1,000-vector minimum; exact scan is fine at single-user scale.
   - **Backend B — CosmosDB (retained):** either (i) native `VectorDistance` query (enable "Vector Search for NoSQL API" account flag + container vector policy; DiskANN engages at ≥1,000 vectors, flat/server-side scan below that — still cheaper than the current client-side full fetch), or (ii) in-process ANN (usearch/hnswlib) index persisted to Blob Storage per user, Cosmos remaining the system of record and the index a rebuildable cache.

### Phase 2 — Hybrid search + reranking
3. **Add a lexical channel (backend-dependent):** new `RetrievalService` fuses lexical + vector scores via Reciprocal Rank Fusion; keep the existing vendor-lookup channel as a third fused signal. Wire into `process_hook_async` step 2.
   - **pgvector backend:** `tsvector` column + GIN index over `embed_text`/`summary` — vector + FTS + RRF in one SQL round-trip.
   - **CosmosDB backend:** small in-process BM25 (e.g., `rank-bm25`) over the same fields (or enroll in Cosmos full-text search if on Azure with the feature flag).
4. **Add a cross-encoder reranker** (small rerank model behind the provider abstraction in `llm_provider.py`) over top-20 fused candidates → top-5 injected into `similar_context`, with scores exposed in `AiParsedData.why` and `top_matches`.

### Phase 3 — Runbook RAG over the CosmosDB state (replaces "inject whole doc")
5. **New `RunbookIndexService`:** on runbook save (`save_runbook_content_async`) and on bootstrap, split runbooks into **rule-atomic chunks — NOT naive size/overlap and NOT flat `##` sections**:
   - Small sections → one chunk as-is (e.g., "Maybank Withdrawals").
   - Fat sections (e.g., `runbook`'s "Mappings & Logic", 7 dense rules) → split to `###` subsections, or **one bullet-rule = one chunk** where subsections are still multi-rule.
   - Each chunk carries its section title + parent runbook id as context (`## SMS-Specific Vendor Rules → P2P Transfers`) — never a floating orphan bullet.
   - Store in a `runbook_chunks` table (`{id, user_id, runbook_id, section_title, rule_id, content, embedding vector(768), fts tsvector, pinned bool, etag_version}`) with HNSW + GIN indexes (Postgres per PBI-023; on CosmosDB: a `RunbookChunks` container partitioned by `/UserId`).
   - **Pinned rules:** mark rules that must be injected on EVERY classification regardless of retrieval (e.g., "Strict ID Handling", the "explicit rules override" header) with `pinned = true`.
6. **Retrieve per-classification:** fetch top-k relevant rule chunks (hybrid vector + keyword, reranked) **per channel + app-tier**, plus all pinned chunks, and inject only those, preserving the "explicit rules override" header. Give each rule a stable ID (`R-APP-1`, `R-SMS-3`, …) and require the prompt's `why` to cite rule IDs — enabling code-level validation of grounding (hallucination tripwire). Authoring experience is unchanged: the user still writes one markdown doc per channel; the splitter runs at save time.
7. **State synchronization:** trigger re-chunking from the runbook change feed (or inside `save_runbook_content_async` / review-session acceptance path in `hook_service.py`); treat `runbooks/*.md` as bootstrap-only templates; record `_etag`-based version in each prompt for audit.

### Phase 4 — Grounding & state feedback loop
8. **Harden system prompts** (`app/sms/email/image_prompts.py`): explicit abstention contract — "If retrieved context doesn't support a field, return null/low confidence; never infer account IDs or vendors not present in context"; add retrieval-score-aware confidence calibration (code-side clamp before auto-confirm in `ingestion_service.py:507`).
9. **Feed corrections back:** use `runbook-review-session.corrections` and recent `user_why` corrections as few-shot exemplars in the classify prompt (top-3 most similar corrections, retrieved via the same hybrid search over a small `CorrectionsIndex`).

### Phase 5 — Verification
10. **Offline eval harness** built from `PromptDebugLog` + `debug_prompts/*.md`: measure classification accuracy, rule-citation rate, and abstention rate on ambiguous cases before/after each phase.

### Key files to touch
`ingestion_service.py`, `vector_service.py`, `vector_repository.py`, `embedding_service.py`, `ai_service.py`, `finance_api_service.py` (runbook API), `prompts/*.py`, plus new `retrieval_service.py` (backend-agnostic fusion: pgvector+FTS on Postgres, ANN+BM25 on CosmosDB), `reranker.py`, `runbook_index_service.py` (section chunking; `runbook_chunks` table on Postgres / `RunbookChunks` container on CosmosDB).

### Process notes (per `AGENTS.md`)
- Use the `spec-updater` skill to keep `spec.md` synchronized when architecture/database/API changes land.
- Use the `finance-test-scaffold` skill for unit/integration tests (extend `tests/test_ingestions_search.py`, `tests/test_ai_pipeline_optimization.py`).
