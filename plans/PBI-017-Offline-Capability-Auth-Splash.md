---
github_issue: 17
github_url: https://github.com/adolf94/financeapp2/issues/17
status: closed
---
# PBI: Offline Capability — Skip Auth Splash When Session Exists

## Description

Currently, every app load shows a full-screen "Authenticating..." spinner until `useAuth()`
resolves `isLoading = false`. If the user has a valid OIDC session stored in `localStorage`
(i.e., `oidc.user:<authority>:<clientId>` key is present and the refresh token is usable),
there is no reason to block the UI — cached data can be shown immediately while the silent
token refresh happens in the background.

This PBI introduces an **offline-first / session-first startup**, consisting of two changes:

1. **Skip the auth splash** when a cached OIDC session exists.
2. **Persist query-cache data** across page refreshes so the app renders with stale-but-valid
   data while fresh data loads from the API.

---

## Design Decisions (Resolved)

| # | Question | Decision |
|---|----------|---------|
| Q1 | Cache persistence strategy | **Option A** — `@tanstack/react-query-persist-client` + `localStorage` persister. Upgrade to Dexie if payload approaches 5 MB. |
| Q2 | Session detection | **Safe** — skip splash only when OIDC stored user has a non-empty `refresh_token` or `access_token`. One sync localStorage read at boot. |
| Q3 | Offline indicator | **No banner** — API calls silently fail with existing toast errors; no extra UI. |
| Q4 | Offline mutations | Out-of-scope. This PBI covers read-only offline only. |

---

## Proposed Changes

> **Implementation order matters:** the cache persister must ship before the splash guard.
> Without persisted cache, skipping the splash still shows blank/loading states in every
> `useQuery` hook — same bad UX, just without the spinner. The persister is what puts actual
> cached data into QueryClient synchronously before the first render.

### Phase 1 — Persist Query Cache *(implement first)*

**File: [`main.tsx`](file:///d:/Users/adolf/source/repos/finance3/frontend/src/main.tsx)**

- Installed `@tanstack/react-query-persist-client` & `@tanstack/query-sync-storage-persister`.
- Wrapped `QueryClientProvider` with `PersistQueryClientProvider`.
- Configured `createSyncStoragePersister` (localStorage `FINANCE_QUERY_CACHE`) with `buster: 'v1.0'`.
- Configured `maxAge: 1000 * 60 * 60 * 24` (24h TTL for the persisted cache) and `gcTime: 24h`.
- Effect: on next load, QueryClient is restored from localStorage **synchronously before** the first render — `useQuery` hooks return cached data immediately instead of loading state.

### Phase 2 — Skip the Auth Splash *(implement after Phase 1)*

**File: [`AppLayout.tsx`](file:///d:/Users/adolf/source/repos/finance3/frontend/src/layouts/AppLayout.tsx)**

- Added `hasStoredSession()` helper reading `oidc.user:*` and `access_token` from `localStorage`.
- Updated gate condition to allow instant render when cached session exists, deferring login redirect until auth check finishes.

### Phase 3 — Skeleton Loading Polish for Cold/Empty Cache

**Files:** [`Skeleton.tsx`](file:///d:/Users/adolf/source/repos/finance3/frontend/src/components/ui/Skeleton.tsx), [`Dashboard.tsx`](file:///d:/Users/adolf/source/repos/finance3/frontend/src/pages/Dashboard.tsx), [`PendingIngestions.tsx`](file:///d:/Users/adolf/source/repos/finance3/frontend/src/pages/PendingIngestions.tsx)

- Added `DashboardOverviewSkeleton` for net worth & monthly stats cards in Dashboard.
- Added `IngestionListSkeleton` for Inbox feed during cold loads.
- Kept clean skeleton placeholders across tabs for cold/empty cache boots.

---

## Verification Plan

- [x] App load with valid OIDC session in localStorage → no spinner, cached data renders immediately.
- [x] App load with no session → spinner shown (existing behaviour preserved).
- [x] After silent-refresh completes, fresh data replaces cached data transparently.
- [x] Offline load (DevTools → Network → Offline) with cached session → app renders with cached data; API failures surface as toast errors.
- [x] After logout → session cleared → next load shows spinner + redirects to login.
- [x] Persisted cache respects 24h TTL: after clearing `localStorage` manually, app falls back to loading state.
