---
status: planned
---
# PBI: Granular Route Scopes — Transactions & Accounts Claims

## Description

The backend currently enforces a single global scope (`api://finance-app-api/user`) via the
`Ar.Auth.OpenId.AzureFunctions` middleware (`ArAuth__RequiredScopes__0` in config / App Settings).
Any token with the `/user` scope can call every non-excluded endpoint.

This PBI introduces **additional granular claims (scopes)** so routes can demand more than the
baseline `/user` scope:

| Scope | Purpose |
|-------|---------|
| `transactions:create` | Creating transactions |
| `transactions:read:self` | Reading a single transaction |
| `accounts:read` | Reading accounts — list **and single account** — plus account groups list |

### Route-to-Scope Mapping

| Function | Route | Method | Required Scope |
|----------|-------|--------|----------------|
| `GetAccounts` | `accounts` | GET | `accounts:read` |
| `GetAccountById` | `accounts/{id}` | GET | `accounts:read` |
| `GetAccountGroups` | `account-groups` | GET | `accounts:read` |
| `CreateTransaction` | `transactions` | POST | `transactions:create` |
| `GetTransactionById` | `transactions/{id}` | GET | `transactions:read:self` |

All other routes remain protected by the baseline `api://finance-app-api/user` scope only.

---

## Design Decisions (Resolved)

| # | Question | Decision |
|---|----------|----------|
| Q1 | `accounts:read` coverage | **Accounts only** — `GET /accounts`, `GET /accounts/{id}`, and `GET /account-groups`. Single transaction is covered by `transactions:read:self`. |
| Q2 | `accounts:create` scope | **Dropped** — not needed; create-account route stays under baseline `/user`. |
| Q3 | Enforcement mechanism | **Per-function checks** in `FunctionContextExtensions` (`HasScope`/`HasAnyScope` + `MissingScopeResult` → `403`). The **global** `user` requirement was **dropped** (`ArAuth__RequiredScopes__0` removed from `local.settings.json`); every non-granular route now explicitly requires `user`. |
| Q4 | Scope claim parsing | Claim type `scope`, space-delimited values (matches how the ArAuth middleware parses scopes). |
| Q5 | Client packages | **v1.2.0 published** with any-of scope support: .NET `ArAuthOptions.AnyScopes` (`Ar.Auth.OpenId.AzureFunctions` 1.2.0) and Python `validate(..., any_scopes=[...])` (`ar-auth-python-client` 1.2.0). Bump the backend csproj once the nupkg is reachable (see Phase 0). |

---

## Proposed Changes

### Phase 0 — Package Bump ✅ (done)

- **Python (`notif-ingester`)**: `requirements.txt` pinned to `ar-auth-python-client` **1.2.0** (adds `validate(..., any_scopes=[...])`), installed into `.venv`.
- **\.NET (`backend`)**: `backend.csproj` bumped to `Ar.Auth.OpenId.AzureFunctions` **1.2.0** (adds `ArAuthOptions.AnyScopes` → `ArAuth__AnyScopes__N` config). Restored & built cleanly.
- **Credential fix**: `nuget.config` now uses `ClearTextPassword = "%NPM_AUTH_TOKEN%"` (NuGet env-var substitution) instead of the hard-coded PAT. ⚠️ The old exposed `ghp_...` PAT should be **revoked/rotated** (it remains in git history).

### Phase 1 — Backend Scope Helper *(implement first)*

**File: `backend/Extensions/FunctionContextExtensions.cs`**

- Add `HasScope(this FunctionContext, string scope)`:
  - Reads `ArAuthUser` `ClaimsPrincipal` from `context.Items`.
  - Collects all claims of type `scope`, splits on spaces, ordinal match.
- Each granular check follows the existing pattern:

```csharp
string? userId = context.GetUserId();
if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
if (!context.HasScope("accounts:read")) return new ForbidResult();
```

**Files to touch:** `backend/Functions/AccountFunctions.cs`, `backend/Functions/TransactionFunctions.cs`
(only the four functions in the mapping table above).

### Phase 2 — Frontend Scope Request

**Files: `frontend/src/main.tsx`, `frontend/public/authConfig/config.js`**

Extend the fallback/deployed `scope` string:

```
openid profile email api://finance-app-api/user
  api://finance-app-api/accounts:read
  api://finance-app-api/transactions:create
  api://finance-app-api/transactions:read:self
```

### Phase 3 — Auth Server Setup *(manual, out-of-repo)*

- Register the three new scopes on `auth.adolfrey.com` for the `finance-app-api` client/audience.
- Grant the scopes to the relevant users; verify tokens carry the new claims.

---

## Verification Plan

- [ ] Token with only `/user` → `403` on the five mapped routes; all other routes still succeed.
- [ ] Token with `/user` + `accounts:read` → `GET /accounts`, `GET /accounts/{id}`, and `GET /account-groups` succeed; `POST /account-groups` (unmapped) remains gated by baseline scope only.
- [ ] Token with `/user` + `transactions:create` → `POST /transactions` succeeds (201).
- [ ] Token with `/user` + `transactions:read:self` → `GET /transactions/{id}` succeeds.
- [ ] Token without a granular scope still accesses unmapped routes (e.g. `GET /transactions`, vendors).
- [ ] Backend builds: `dotnet build backend`.
- [ ] Frontend updated scope string requests all four scopes at login (`main.tsx`, `public/authConfig/config.js`).

## Follow-ups

- Update `spec.md` auth section once implemented (granular scope mapping table).
