---
status: approved
---
# Homelab Production Migration Plan (Docker, No Emulators)

> Approved: 2026-10-17 — "productionize, not use emulators"
> Revised: 2026-10-17 — merged API + SignalR into one .NET service; auth stays Ar.Auth.OpenId; no Tailscale (Cloudflare Tunnel); Postgres runs pgvector.
> Goal: Migrate the entire Personal Finance App to a personal homelab server with Docker, using **real self-hosted production software** (no Cosmos/Azurite/SignalR emulators). **AI/LLM calls stay cloud-based** (Gemini/OpenAI); auth stays on the existing Ar.Auth.OpenId provider.

---

## 1. Decisions

| # | Decision |
|---|---|
| 1 | **Cosmos DB → PostgreSQL 17** (official `postgres`-based image, **with pgvector**: `pgvector/pgvector:pg17`). EF Core provider swap (`UseCosmos` → `UseNpgsql`); Python repositories rewritten onto asyncpg/SQLAlchemy. `/UserId` partitioning becomes a `user_id` column + indexes everywhere. pgvector hosts the retrieval layer (see PBI-022 revision). |
| 2 | **Azure Blob → MinIO** (S3-compatible). Blob usage is Python-only (`services/blob_storage_service.py` + `images/{ingestion_id}` route) — swap the Azure SDK for `minio-py`. |
| 3 | **Merge API + SignalR into one .NET service.** The backend is no longer Azure Functions: one plain **ASP.NET Core app** (`api/`) hosting Minimal API routes (ported from `backend/Functions/*`) **+ the `NotificationHub` SignalR hub + Ar.Auth middleware** — single origin, single container, no functions host, no Azure SignalR. `services/signalr_publisher.py` (Python) posts to the merged service's `/publish` endpoint; frontend `useSignalR.ts` connects to `/hub/notificationHub` on the same origin. |
| 4 | **Cosmos change feed trigger → Postgres poller worker.** The Python Functions host keeps its HTTP routes (phone_hook, image_hook, ingestions, runbook); the `ClassifyNotificationFunction` change-feed binding is extracted into a long-running `classify-worker` container that polls the hooks table (`FOR UPDATE SKIP LOCKED`) and reuses `NotificationTypeDetector` + the pipeline services unchanged. |
| 5 | **Timer trigger → scheduler.** `function_app.py:1593` email timer becomes an HTTP route (shared-secret) invoked by a lightweight cron container. Removes the last `AzureWebJobsStorage` dependency. |
| 6 | **Auth: keep Ar.Auth.OpenId as-is** (`backend/Program.cs:20` → moves to the merged `api/` service). No Authentik/Keycloak; the existing authority (Entra ID / current provider) remains the one auth dependency in the cloud. |
| 7 | **Remote access: Cloudflare Tunnel** (public HTTPS hostname, no open ports, no Tailscale). LAN-only access works as a fallback if the tunnel is down. |
| 8 | **Vector retrieval (PBI-022): assumes pgvector** — vector store is a `vector(768)` column + HNSW index in Postgres itself; hybrid via Postgres full-text + RRF. PBI-022 keeps CosmosDB as a retained alternative backend for the Azure deployment; the homelab stack assumes pgvector. |
| 9 | Cloud-only (by design): LLM/embedding APIs, IMAP→Gmail fetch, exchange-rate API, package feeds at build time, **Ar.Auth authority**. |

---

## 2. Target Architecture

```
Homelab server (docker compose)                        Cloud (outbound only)
┌────────────────────────────────────────────┐
│ caddy :443 (TLS, Let's Encrypt)            │      Gemini / OpenAI (LLM,
│  ├─ /            → frontend (static dist) │        embeddings, reranker)
│  └─ /*           → api (.NET, one origin) │             ▲
│                    ├─ Minimal API routes   │      IMAP → imap.gmail.com
│                    ├─ /hub (SignalR)       │             ▲
│                    └─ ArAuth middleware     │     frankfurter.dev FX API
│                                            │
│ api (.NET: APIs + SignalR + ArAuth) ─┐     │    Cloudflare Tunnel → phone +
│ notif-ingester (Py functions: HTTP) ─┼─ postgres :5432 (pgvector, FTS)
│ classify-worker (Py poller)          ─┤    │
│ scheduler (cron → email-check route) │     │    Ar.Auth authority (existing)
│ backup (pg_dump + mc mirror nightly) ┘     │
│                                    minio :9000 (receipt images)
└────────────────────────────────────────────┘
```

Volumes: `pg-data`, `minio-data`. All images **pinned by version tag** (no `latest`). Restart `unless-stopped` + healthchecks everywhere.

---

## 3. Migration Workstreams

### A. Database: Cosmos → PostgreSQL + pgvector (largest workstream)
1. **.NET** — `backend/Data/FinanceDbContext.cs`: replace `.ToContainer(...)`, `.HasPartitionKey(...)`, `.HasNoDiscriminator()` with Npgsql mappings (partition key → indexed `user_id` column; `Transactions`/`LedgerEntry` shared container → two tables; `OwnsMany` templates/occurrences → child tables). Connection string → `Host=postgres;...` (moved to the merged `api/` service). Add EF migrations (replaces the Cosmos-era `scripts/migrations/*`).
2. **Python** — rewrite repositories onto async SQLAlchemy models mirroring the same schema: `repositories/ingestion_repository.py`, `hook_repository.py`, `vector_repository.py`, `prompt_debug_repository.py`, plus all Cosmos access in `services/finance_api_service.py` (Settings/runbooks, vendor lookups, confirmed-ledger search). Keep repository interfaces unchanged so the pipelines are untouched. Use `model-syncer` to keep the .NET and Pydantic models aligned.
3. **Python models** — Pydantic shapes unchanged; persistence maps to SQL (JSONB for flexible fields: `raw_payload`, `ai_parsed`, `top_matches`, `chat_history`; runbook `content` stays text).
4. **Runbook state** — `Settings` container → `settings` table (`id`, `user_id`, `content/json`, `_etag` → optimistic-lock `version` column). Same for `runbook-review-session`.
5. **Vector tables (PBI-022)** — `transaction_vectors` + `runbook_chunks` tables with `embedding vector(768)` + HNSW indexes and `tsvector` full-text columns, created in the same EF/SQLAlchemy migration set.
6. **Change-feed replacement** — `classify-worker` container polls `phone_hooks` for unprocessed rows (`SKIP LOCKED`), runs `NotificationTypeDetector` + the same four pipeline services (`ingestion_service.py` + subclasses — zero changes to pipeline logic).
7. **Data migration ETL** — one-time exporter (reuse `scripts/sync_cosmos_emulator.py` / `cosmos_copy.py` patterns): read all Cosmos containers → transform (`UserId` → `user_id`, discriminator split) → bulk insert into Postgres. Verify counts + a balance reconciliation query (sum of ledger entries per user before/after).

### B. Storage: Blob → MinIO
8. `services/blob_storage_service.py` — swap `azure-storage-blob` for `minio-py` (bucket `receipts`). `image_hook` upload and `images/{ingestion_id}` read route behavior unchanged.
9. One-time blob sync: `azcopy`/az CLI download (or from `__blobstorage__`) → `mc mirror` into MinIO.

### C. Merge API + SignalR into one .NET service
10. New `api/` ASP.NET Core project (evolves from `backend/`): port `Functions/{Account,Adjustment,RecurringTransaction,Transaction,Vendor}Functions.cs` to Minimal API routes (same routes/DTOs, EF services and DI from `Program.cs` carry over almost verbatim); add `NotificationHub` with the existing client events (`announcement`, `reclassifyProgress`, `reclassifyThinking`, `chatProgress`, `reclassifyComplete`, `checkEmailItem`); add authenticated internal `/publish` endpoint (shared secret) for the ingester; mount Ar.Auth middleware unchanged.
11. `services/signalr_publisher.py` — replace Azure SignalR REST/JWT code with a POST to `/publish`; keep function signatures so ~15 call sites don't change.
12. `frontend/src/hooks/useSignalR.ts` — hub URL → `/hub/notificationHub` (SDK negotiate built in); keep `accessTokenFactory` (Ar.Auth token).
13. Frontend axios base → single origin (caddy); remove per-service base URLs.

### D. Containers & edge
14. New Dockerfiles: `api/Dockerfile` (.NET), `notif-ingester/Dockerfile` (python functions image — HTTP routes only), `classify-worker/Dockerfile` (same base as ingester), `frontend/Dockerfile` (node build → caddy static), `scheduler` (alpine cron + curl).
15. `docker-compose.prod.yml` (repo root): caddy, api, notif-ingester, classify-worker, scheduler, postgres (`pgvector/pgvector:pg17`), minio, backup, **cloudflared** (tunnel). Healthchecks + pinned versions + `finance3-net`.
16. Caddyfile: TLS, reverse-proxy `/*` → api (except static), WebSocket upgrade for `/hub`. Frontend static served by caddy directly.
17. Cloudflare Tunnel: `cloudflared` container routes the public hostname → caddy; phone (Android) app config switches its base URL to the tunnel hostname.

### E. Ops
18. Nightly `backup` service: `pg_dump` + `mc mirror minio/ → /backups` (+ offsite copy if desired). Monthly restore drill.
19. Docker log rotation + pinned-tag update procedure; Uptime Kuma optional.

---

## 4. Risks / Notes

- **Backend Functions → Minimal APIs is a port, not a rewrite** — the service/repository layers (`Program.cs` DI) are host-agnostic; the five Functions classes become route groups. Budget ~1 day.
- **Change feed semantics lost** — the poller replaces trigger-based classification; at one-user volume, 5–10s poll intervals are fine. Keep `SKIP LOCKED` + `status` re-check to avoid double-classification.
- **EF Core Cosmos → Npgsql is not mechanical** — owned collections, discriminator-sharing (`Transactions` container), enum conversions need explicit mapping decisions; budget 2–3 days for .NET + migrations alone.
- **Python repositories are the long tail** — `finance_api_service.py` has ~15 Cosmos touch points; keep interfaces stable and the pipelines won't notice.
- **Cloudflare Tunnel is the only inbound path** — if it's down, app is LAN-only until it reconnects (acceptable for a personal app; phone caches/queues notifications).
- **PBI-022 revised in tandem** — retrieval moves from in-process ANN to pgvector; no separate index-file lifecycle to maintain.
- The 14 Cosmos-era Python migration scripts (`scripts/migrations/`) become obsolete — archive after the ETL lands.

## 5. Implementation Order

| Phase | Workstream | Exit criteria |
|---|---|---|
| 1 | Postgres + pgvector schema, EF swap, Python repos (A) | All backend + ingester integration tests pass against Postgres; parity reconciliation clean |
| 2 | Merged `api/` service: Minimal APIs + NotificationHub + ArAuth (C) | Single origin serves API + hub; frontend live updates |
| 3 | classify-worker + scheduler (A.6, D.14) | End-to-end: phone_hook → classification → SignalR broadcast |
| 4 | MinIO (B) | Image upload/read round-trip |
| 5 | Compose + Caddy + Cloudflare Tunnel (D) | Phone reaches the app via public hostname |
| 6 | ETL data migration + backups (A.7, E) | Cosmos data fully reconciled in Postgres; nightly backup verified |

### Process notes (per `AGENTS.md`)
- Use `spec-updater` to sync `spec.md` once Phase 1 lands (database architecture change).
- Use `finance-test-scaffold` for .NET + React tests per workstream; `model-syncer` for the C#/Pydantic alignment during A.2.
