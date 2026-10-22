# Model Routing Plan — Notification Classification & Reclassification

> **Version:** v2 (finalized 2026-10-21)
> **Status:** Implemented (2026-10-21) — Go API key must be set in App Settings for deploy
> **Volume basis:** ~75k input + ~75k output tokens/day (avg) = ~4.5M tokens/month

---

## 1. Objective

Route all classification/reclassification model traffic through the already-subscribed
**OpenCode Go** plan, using **OpenRouter** purely as a cheapest-possible overflow path.
Zero variable cash cost beyond the fixed $10/mo subscription under normal operation.

## 2. Lane Assignments

### Lane A — Reclassification (high-volume, lower complexity)

| Role     | Model               | Provider     | Endpoint                                                                  | API shape |
| -------- | ------------------- | ------------ | ------------------------------------------------------------------------- | --------- |
| Primary  | `glm-5.3-flash`     | OpenCode Go  | `https://opencode.ai/inference/go/openai/v1/chat/completions`             | OpenAI    |
| Backup   | `qwen/qwen3.7-flash`| OpenRouter   | `https://openrouter.ai/api/v1/chat/completions`                           | OpenAI    |

- Pure OpenAI lane: failover = base URL + API key + model ID swap, **no format translation**.
- Full-load draw: **~$1.46/mo = 2.4% of $60/mo cap**.
- Cached input read on Go: $0.03/1M (make prompts cache-friendly).

### Lane B — Classification (new notifications, higher quality requirement)

| Role     | Model                 | Provider   | Endpoint                                                            | API shape   |
| -------- | --------------------- | ---------- | ------------------------------------------------------------------- | ----------- |
| Primary  | `qwen3.7-plus`        | OpenCode Go| `https://opencode.ai/inference/go/anthropic/v1/messages`            | Anthropic   |
| Backup   | `qwen/qwen3.7-flash`  | OpenRouter | `https://openrouter.ai/api/v1/chat/completions`                     | OpenAI      |

- Full-load draw: **~$4.50/mo = 7.5% of $60/mo cap**.
- The Anthropic↔OpenAI request adapter exists **only in this lane**.
- Cached input read on Go: $0.04/1M (shared system prompt → near-free repeated classifications).

### Runbook Review (REASONING role — added 2026-10-21)

| Role     | Model                 | Provider   | Endpoint                                                                  | API shape |
| -------- | --------------------- | ---------- | ------------------------------------------------------------------------- | --------- |
| Primary  | `glm-5.3-flash`       | OpenCode Go| `https://opencode.ai/inference/go/openai/v1/chat/completions`             | OpenAI    |
| Backup   | `qwen/qwen3.7-flash`  | OpenRouter | `https://openrouter.ai/api/v1/chat/completions`                           | OpenAI    |

- **Always -flash** on this lane (user policy): GLM flash primary, OpenRouter Qwen flash backup.
- Pure OpenAI lane — no format adapter needed. Shares Lane A's circuit-free role:
  own `REASONING` lane key, but same failover policy (2+2, latching, manual reset).
- Reasoning streams natively from GLM (`delta.reasoning`) — no request parameter
  needed; the existing OpenAI-compat parser handles it, so the runbook-review CoT
  stream to SignalR works unchanged. Reasoning tokens bill as output
  (`completion_tokens_details.reasoning_tokens`) — negligible at flash pricing.
- Config keys: `REASONING_AI` / `REASONING_APIKEY` (Go key) +
  `REASONING_AI_BACKUP` / `REASONING_APIKEY_BACKUP` (OpenRouter key).

### Shared Backup

`qwen/qwen3.7-flash` (OpenRouter) is the **single** fallback model for both lanes:
- Cheapest token rates available ($0.03 / $0.13 per 1M at ≤32K prompts).
- One pricing profile, no escalation chains, both lanes converge on one model.

### Pre-classification (preprocessing) policy

Preprocessing/extraction is **lane-aware** (revised 2026-10-21 — supersedes the
earlier "always -plus" policy):
- **New-notification flow:** `opencode-go:qwen3.7-plus` (Lane B, CLASSIFICATION role).
- **During a reclassification run:** `opencode-go:glm-5.3-flash` (Lane A) — the
  `process_hook`/`extract_with_ai` calls accept a `lane` parameter, and
  `reclassify_ingestion_async` passes `lane="RECLASSIFICATION"`, so both the
  preprocessing and the classification steps of a reclassify run ride Lane A
  (and share its circuit state and backup).
- The image pipeline's reclassify reuses its stored extraction (no LLM
  preprocess call), so nothing to thread there. Config: `PREPROCESSING` /
  `RECLASSIFICATION` roles inherit the CLASSIFICATION lane when unset — do not
  set `PREPROCESSING_AI` unless deliberately overriding.

## 3. Failover Policy (identical per lane)

### Per-request: 2 tries primary → 2 tries backup → fail

```
attempt(primary, 2)        # retry on 429 / 5xx / timeout, ~0.5–1s backoff between tries
   → exhausted? attempt(backup, 2)
   → exhausted? FAIL the request (as designed — caller handles)
```

- Only retryable errors consume tries: 429, 5xx, timeout.
- A 400 (malformed request) **fails immediately** without consuming any try.
- On success at any try, remaining tries are skipped (no penalty).

### Circuit state (latching — no automatic recovery)

| Scope                          | Behavior                                              |
| ------------------------------ | ----------------------------------------------------- |
| This request                   | 2 primary tries → 2 backup tries → fail               |
| Lane after failed primary      | **Latch to backup** — subsequent requests skip straight to backup with no primary tries |
| Return to primary              | **Manual only** (ops action / config flip). Automatic probing and auto-restore are deliberately built-out. |
| FAIL on both (all 4 tries)     | Handled by a **manual reclassification run** on the affected items — no in-line automatic retry-and-spinning machinery. |

The 2+2 gauntlet only runs on lanes believed healthy — after latch, a capped Go
primary costs zero tries. Cap exhaustion, 5-hr window limits, and transient
throttling all surface as 429 — treat them identically. Each lane is an
**independent circuit**; lanes never flip together.

Rules:
- Do **NOT** enable "Extra usage" in the OpenCode Console. A clean 429 is the
  correct trigger for OpenRouter; silent credit billing would mask failover.
- Send `x-opencode-session` (stable per conversation thread) on all Go requests.

## 4. Cost Summary (steady state vs. worst case)

| Item                                                | Amount        |
| --------------------------------------------------- | ------------- |
| OpenCode Go subscription (fixed)                     | $10.00/mo     |
| Go capacity consumed (both lanes, steady state)      | ~$5.96 of $120 combined caps (~5.0%) |
| OpenRouter backup — normal month                     | ~$0.00–0.05   |
| OpenRouter backup — pathological (full-month failover)| ~$0.36       |
| **Total worst-case monthly**                         | **≤ $10.36**  |

Per-lane reference (75k in / 75k out daily = 2.25M / 2.25M per month, no caching):

| Model               | In $/1M | Out $/1M | Monthly draw | Cap  | % of cap |
| ------------------- | ------- | -------- | ------------ | ---- | -------- |
| `glm-5.3-flash` (Go)| $0.15   | $0.50    | $1.46        | $60  | 2.4%     |
| `qwen3.7-plus` (Go) | $0.40   | $1.60    | $4.50        | $60  | 7.5%     |
| `qwen/qwen3.7-flash`(OR) | $0.03 | $0.13 | $0.36 (if 24/7) | unlimited | n/a |

## 5. Implementation Notes

1. **Format adapter (Lane B only):** Go Qwen models require the Anthropic Messages
   body (`max_tokens` mandatory); OpenRouter requires the OpenAI body. Write one
   bidirectional adapter; Lane A shares one OpenAI client for both providers.
2. **Prompt sizing:** OpenRouter `qwen3.7-flash` bills 3x ($0.10/$0.40 per 1M) for
   prompts >32K. Keep reclassification batch prompts ≤32K, or accept 3x on
   oversized batches (verify actual billing in Activity view after one big batch).
3. **Go endpoint auth:** `Authorization: Bearer <Go API key>` on all
   `https://opencode.ai/inference/go/...` requests. Models list:
   `curl https://opencode.ai/inference/go/v1/models`.
4. **No OpenCode config changes required** — Go is called via plain HTTP with the
   Go API key, not through the TUI/provider config.
5. **Zero data retention** on both Go Qwen models and GLM (0-day retention,
   not used for training) — better posture than most OpenRouter routes.
6. **User-agent:** identify the client with its own agent UA (per Go requirements),
   not a generic SDK name.
7. **Reasoning streaming — verified against the gateway (2026-10-21):**
   Lane A (`go`, GLM-5.3-flash): accepts `reasoning_effort` on the OpenAI shape
   and streams reasoning as **`delta.reasoning_content`** (DeepSeek/Zhipu
   convention; without an explicit request GLM skips CoT on JSON-only prompts).
   `OpenAICompatibleProvider` sends `reasoning_effort: medium` when
   `include_reasoning=True` and parses both `delta.reasoning` and
   `delta.reasoning_content` to ("thinking", …) chunks. Reasoning bills as
   output tokens (`completion_tokens_details.reasoning_tokens`). Lane B
   (`go-anthropic`, Qwen3.7-plus) requires the Messages API thinking parameter —
   wired in `GoAnthropicProvider` (`include_reasoning=True` → thinking enabled
   with budget `GO_ANTHROPIC_THINKING_BUDGET`, default 1024; temperature omitted
   per API constraint; `thinking_delta` SSE events parsed to ("thinking", …)
   chunks). `x-opencode-session` is **enforced** by the gateway (requests
   without it are rejected with `MissingSessionID`).

## 6. Known Risks & Mitigations

| Risk                                            | Mitigation                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Output drift on Lane A failover (GLM → Qwen)     | Accepted (backup runs ≈0% of traffic). If outputs degrade: swap Lane A backup to `qwen/qwen3.8-flash` (+~$0.02/mo), or revert primary to `qwen3.8-flash` (reintroduces Anthropic adapter for Lane A). |
| GLM quality regression on real documents         | Run worst-case documents through GLM before cutover; one-line revert available. |
| >32K prompt price bracket on OpenRouter          | Batch-size ceiling for backup requests; confirm bracket behavior once in Activity. |
| Go plan pricing/allowance changes                | Re-verify draw % quarterly against Console usage page.                      |
| Mini-throughput degradation at cap windows       | Lane latches to backup (OpenRouter) until ops restores it manually; no automatic behavior. |

## 7. Go-Live Validation Checklist

- [ ] Smoke request: `glm-5.3-flash` via Go OpenAI endpoint
- [ ] Smoke request: `qwen3.7-plus` via Go Anthropic endpoint
- [ ] Runbook review smoke: opens a review chat, confirm primary `opencode-go:glm-5.3-flash` and CoT stream (`delta.reasoning`) reaches the UI
- [ ] Preprocessing check: extraction call logs `opencode-go:qwen3.7-plus` for a new-notification flow, and `opencode-go:glm-5.3-flash` for a reclassify flow (lane-aware preprocessing)
- [ ] Smoke + billing check: OpenRouter `qwen/qwen3.7-flash`
- [ ] One >32K OpenRouter request → confirm bracket pricing behavior
- [ ] Simulated 429 → retry → latch-to-backup cycle per lane; verify latch holds (no primary re-tries) until manual reset
- [ ] Week-1 review: Console usage shows expected ~$1.46 + ~$4.50 draw
- [ ] Confirm `x-opencode-session` header present on Go requests
