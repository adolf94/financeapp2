# Finance API — Third-Party App Integration

Guide for 3rd-party applications integrating with the Finance API using
granular OAuth2 scopes.

- **Authority:** `https://auth.adolfrey.com/api`
- **API audience / identifier:** `api://finance-app-api`
- **API base URL:** `<API_BASE_URL>/api`

---

## Authentication

The Finance API validates JWT Bearer tokens (`Authorization: Bearer <token>`).
Request tokens from the authority with the audience/scope prefix
`api://finance-app-api/`.

| Flow | Use when |
|------|----------|
| `client_credentials` | Server-to-server integration (a 3rd-party app acting as itself). |
| `authorization_code` / SPA | The end user is signed in; the token carries the user's identity. |

Every protected route returns:

| Status | Meaning |
|--------|---------|
| `401` | Missing/invalid/expired token. |
| `403` | Token valid but lacking the required scope — body contains `insufficient_scope` and the accepted scopes. |
| `404` | Resource does not exist **or** is not visible to the caller. |

---

## Scopes

| Scope | Allowed flow(s) | Endpoints guarded |
|-------|-----------------|-------------------|
| `transactions:create` | **`client_credentials` only** | `POST /api/transactions`, `POST <INGESTER_BASE_URL>/ingestions/{id}/confirm-status` |
| `transactions:read:self` | **`client_credentials` only** | `GET /api/transactions/owner/{userId}`, `GET /api/transactions/{id}` |
| `accounts:read` | `client_credentials` **or** `spa` | `GET /api/accounts`, `GET /api/accounts/{id}`, `GET /api/account-groups` |
| `ingestions:read` | `client_credentials` **or** `spa` | `GET <INGESTER_BASE_URL>/ingestions`, `GET <INGESTER_BASE_URL>/ingestions/{id}`, `GET <INGESTER_BASE_URL>/images/{ingestion_id}` |

> `transactions:create` and `transactions:read:self` are issued exclusively to
> confidential clients via `client_credentials`. SPA / user tokens cannot obtain
> them. `accounts:read` works with either flow.

---

## Endpoint Reference

### POST `/api/transactions` — requires `transactions:create`

Creates a transaction **on behalf of a user**. The caller identifies itself by
the token's `sub` claim, so the target owner must be supplied explicitly.

Rules:

- `UserId` in the body is **required** → the transaction is stored in (and
  billed to) that user's ledger.
- `CreatedBy` is **always set by the API** to the caller's `sub` — any value
  sent in the body is overwritten and cannot be spoofed.

```http
POST <API_BASE_URL>/api/transactions
Authorization: Bearer <client_credentials token>
Content-Type: application/json

{
  "userId": "<target-user-id>",
  "date": "2026-09-05T00:00:00Z",
  "type": "Expense",
  "note": "Payment via partner app",
  "entries": [
    { "accountId": "<credit-account>", "amount": -250.00 },
    { "accountId": "<debit-account>",  "amount": 250.00 }
  ]
}
```

`201 Created` → returns the persisted transaction including its generated
`id` (keep it — it's needed for reads).

| Body invalid | Status |
|--------------|--------|
| Missing `userId` | `400` |
| Unknown account | `404` |
| Unbalanced entries | `400` |

### GET `/api/transactions/owner/{userId}` — requires `transactions:read:self`

Lists the transactions **your app created for a given user** (the
client_credentials equivalent of `GET /api/transactions`).

- Visibility rule: `UserId == {userId}` **and** `CreatedBy == {sub}` — you
  never see transactions created by other apps or the user directly.
- Optional query params: `startDate`, `endDate` (same semantics as
  `GET /api/transactions`).

```http
GET <API_BASE_URL>/api/transactions/owner/{userId}?startDate=2026-09-01&endDate=2026-10-01
Authorization: Bearer <client_credentials token>
```

`200 OK` → array of transactions (may be empty; an unknown/other user simply
returns `[]`, never another user's data).

### GET `/api/transactions/{id}` — requires `transactions:read:self`

Reads back a **single transaction created by this client**.

- Visibility rule: only transactions with `CreatedBy == {sub}` are returned.
  A `client_credentials` token therefore sees exactly what it created —
  `404` for everything else, including other apps' transactions.
- Because the check is on `CreatedBy` (not the owner `UserId`), your app can
  read its transactions without holding any end-user identity.

```http
GET <API_BASE_URL>/api/transactions/{id}
Authorization: Bearer <client_credentials token>
```

`200 OK` → transaction with its ledger entries. `404` → not found or not created by you.

### GET `/api/accounts`, GET `/api/accounts/{id}`, GET `/api/account-groups` — requires `accounts:read`

Read the ledger account structure.

- **SPA flow:** returns the signed-in user's accounts/groups.
- **client_credentials flow:** returns accounts visible to the caller's
  identity (`{sub}`).

```http
GET <API_BASE_URL>/api/accounts
Authorization: Bearer <token>
```

```http
GET <API_BASE_URL>/api/accounts/{id}
Authorization: Bearer <token>
```

```http
GET <API_BASE_URL>/api/account-groups
Authorization: Bearer <token>
```

---

## Data Models

All JSON payloads use **camelCase** on the wire; request deserialization is
case-insensitive. IDs are GUIDv7 strings.

### Enum: `AccountType`

`"Cash" | "Bank" | "CreditCard" | "Investment" | "Asset" | "Liability" | "Equity" | "Income" | "Expense" | "Adjustment"`

### Enum: `TransactionType`

`"Income" | "Expense" | "Transfer" | "Journal"`

### `Account` — returned by `accounts:read`

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | GUIDv7 |
| `userId` | string | Owner (partition key) |
| `accountGroupId` | string | Grouping this account belongs to |
| `name` | string | |
| `description` | string \| null | AI-generated summary |
| `tags` | string[] | |
| `startingBalance` | decimal | |
| `currentBalance` | decimal | Maintained by the ledger |
| `accountType` | `AccountType` | |
| `creditCardCycleStartDay` | int \| null | Only for `CreditCard` |
| `creditCardPaymentDueDay` | int \| null | Only for `CreditCard` |

```json
{
  "id": "019a1f2e-3c4d-7abc-9def-0123456789ab",
  "userId": "user-123",
  "accountGroupId": "019a1f2e-...-group",
  "name": "BDO Checking",
  "description": "Primary peso salary account",
  "tags": ["salary", "ph"],
  "startingBalance": 5000.00,
  "currentBalance": 12750.45,
  "accountType": "Bank",
  "creditCardCycleStartDay": null,
  "creditCardPaymentDueDay": null
}
```

### `AccountGroup` — returned by `GET /api/account-groups`

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | GUIDv7 |
| `userId` | string | Owner |
| `name` | string | |
| `accountType` | `AccountType` | Category shared by member accounts |

```json
{
  "id": "019a1f2e-...-group",
  "userId": "user-123",
  "name": "Cash & Banks",
  "accountType": "Cash"
}
```

### `Transaction` — created via `POST /api/transactions`, returned by the read endpoints

| Field | Type | Req. on create | Notes |
|-------|------|----------------|-------|
| `id` | string | server | GUIDv7, generated if omitted |
| `userId` | string | **yes** (read:self callers) | Target owner; forced to `{sub}` for `user` tokens |
| `createdBy` | string | server | Always `{sub}` of the caller — not settable |
| `date` | datetime | yes | ISO 8601 |
| `type` | `TransactionType` | yes | |
| `note` | string | no | |
| `referenceNumber` | string \| null | no | |
| `vendor` | string \| null | no | Vendor name |
| `scheduleId` | string \| null | no | Set for recurring occurrences |
| `entries` | `LedgerEntry[]` | **yes** | Double-entry lines; must sum to 0 |
| `isAutoConfirmed` | bool | no | Default `false` |
| `ingestionId` | string \| null | no | Ingestion pipeline field |
| `mergedIngestionIds` | string[] | server | |
| `matchedVendorLookups` | string[] | server | |
| `newVendorLookups` | string[] | server | |

### `LedgerEntry` — element of `transaction.entries`

| Field | Type | Req. on create | Notes |
|-------|------|----------------|-------|
| `id` | string | server | |
| `userId` | string | server | Copied from the owner |
| `transactionId` | string | server | |
| `accountId` | string | **yes** | Must exist for the owner (`404` otherwise) |
| `amount` | decimal | **yes** | Debit positive, credit negative; all entries must balance |
| `note` | string \| null | no | |
| `referenceNumber` | string \| null | no | |

```json
{
  "id": "019a1f2e-...-tx",
  "userId": "user-123",
  "createdBy": "partner-app",
  "date": "2026-09-05T00:00:00Z",
  "type": "Expense",
  "note": "Payment via partner app",
  "referenceNumber": "PAY-001",
  "vendor": "Shell",
  "scheduleId": null,
  "isAutoConfirmed": false,
  "ingestionId": null,
  "mergedIngestionIds": [],
  "matchedVendorLookups": [],
  "newVendorLookups": [],
  "entries": [
    { "id": "019a1f2e-...-e1", "userId": "user-123", "transactionId": "019a1f2e-...-tx",
      "accountId": "019a1f2e-...-bank",  "amount": -250.00, "note": null, "referenceNumber": null },
    { "id": "019a1f2e-...-e2", "userId": "user-123", "transactionId": "019a1f2e-...-tx",
      "accountId": "019a1f2e-...-expense", "amount": 250.00, "note": null, "referenceNumber": "PAY-001" }
  ]
}
```

---

## Ingestion Reads (Notification Ingester API)

Ingestion records (parsed SMS/notification events awaiting confirmation) live in
a separate service: the **Notification Ingester**, based at
`<INGESTER_BASE_URL>` (e.g. `http://localhost:7072` locally). These routes
accept `user` OR `ingestions:read`.

### GET `/ingestions` — requires `ingestions:read`

Lists the caller's ingestion records.

- Scoped to the token's `{sub}` — the caller only ever sees their own ingestions.
- Query params: `status` (default `Pending`), `$skip`, `$top`.

```http
GET <INGESTER_BASE_URL>/ingestions?status=Pending&$top=50
Authorization: Bearer <token>
```

### GET `/ingestions/{ingestion_id}` — requires `ingestions:read`

Reads a single ingestion record; `404` if it doesn't exist or isn't the caller's.

### GET `/images/{ingestion_id}` — requires `ingestions:read`

Returns the receipt/statement image blob attached to an ingestion (from Blob
Storage); `404` if the ingestion has no image.

### POST `/ingestions/{ingestion_id}/confirm-status` — requires `user` OR `transactions:create`

Marks an ingestion as `Confirmed` after you created the transaction for it
(`POST /api/transactions` → then confirm with the resulting `transaction_id`).

- `user` tokens act on their own ingestions (`{sub}`).
- `transactions:create`-only callers act on behalf of a user and **must**
  include `user_id` in the body (the owner of the ingestion) — omitting it
  returns `400`.
- Optional body fields: `user_confirmed` (feeds AI learning), `skip_learning`,
  `dismiss_related_ids` + `dismiss_status` (merge related notifications).

```http
POST <INGESTER_BASE_URL>/ingestions/{ingestion_id}/confirm-status
Authorization: Bearer <client_credentials token>
Content-Type: application/json

{
  "user_id": "<target-user-id>",
  "transaction_id": "<tx created via POST /api/transactions>"
}
```

`200 OK` → the updated ingestion record.

> Other mutation routes on the ingester (`.../reject`, `.../learn`,
> `.../reclassify`, etc.) are **not** covered by `ingestions:read` — they remain
> on the `user` scope.

---

## Getting a Token (client_credentials)

```bash
curl -X POST https://auth.adolfrey.com/api/connect/token \
  -d grant_type=client_credentials \
  -d client_id=<your-client-id> \
  -d client_secret=<your-client-secret> \
  -d scope="api://finance-app-api/transactions:create api://finance-app-api/transactions:read:self api://finance-app-api/accounts:read api://finance-app-api/ingestions:read"
```

Onboarding checklist:

1. Register your app as a confidential client with the required scopes
   (`transactions:create`, `transactions:read:self`, `accounts:read`).
2. Obtain each end-user's `userId` and their account IDs out of band
   (or via `accounts:read`).
3. `POST /api/transactions` with `userId` in the body; store the returned `id`.
4. `GET /api/transactions/owner/{userId}` (or `GET /api/transactions/{id}`) to confirm/re-read your own creations.

---

## Behaviour Notes

- Ledger side effects (balance updates, vendor last-used tracking) run
  synchronously during creation; a `201` means the double-entry is committed.
- `PATCH`/`PUT`/`DELETE` are **not** exposed to `transactions:create` callers —
  user-scoped (`user`) tokens only.
- Rate limiting / auditing is enforced at the API gateway; contact the Finance
  team for throughput guarantees.
