# PBI 007: Personal Token Grant Integration

## Problem Statement
Currently, external or programmatic access to the ingestion API (`POST /phone_hook`) relies on a static `API_KEY` validated via the `x-api-key` header matching the `API_KEY` environment variable. Static keys are hard to rotate, insecure to hardcode, and do not natively carry user context or claims. 

We want to replace this static `api_token` mechanism with the OIDC-compliant `"personal_token"` grant flow issued by the `ar-auth` service. The client will authenticate with `ar-auth` using this grant to obtain a standard JWT access token, and then send it as a Bearer token in the `Authorization: Bearer <token>` header.

## Current State Analysis
1. **Python Ingester (`notif-ingester`)**:
   - `POST /phone_hook` uses `validate_api_key(req)` to match `x-api-key` against `API_KEY`.
   - All other endpoints call `_require_auth(req)` which verifies standard Bearer JWTs via `ArAuthClient` (pointing to `https://auth.adolfrey.com/api`).
2. **.NET Backend (`backend`)**:
   - Authentication for all controllers is handled via `ArAuthMiddleware` using Bearer JWTs.
   - The backend proxies `GenerateAccountDescription` requests to `notif-ingester` by sending `x-api-key` and `x-user-id` headers.

## User Stories
### Primary User Story
"As an automated client (e.g. mobile notification uploader, Tasker script), I want to authenticate my requests using a Bearer token obtained via the `ar-auth` personal_token grant rather than using a static API key, so that my connection is secure, dynamic, and properly associated with my user claims."

### Secondary User Stories
1. "As a system administrator, I want to rotate client credentials or personal tokens on the identity server without changing service configuration files or environment variables on the ingestion server."
2. "As a developer, I want all endpoints to share a unified authentication path using OIDC JWTs, simplifying security audits and middleware logic."

## Technical Requirements
1. **Unify Ingester Auth**: Replace `x-api-key` validation in `POST /phone_hook` with OIDC JWT validation via `_require_auth(req)`.
2. **Context Resolution**: Use the `sub` claim inside the validated JWT to identify the active user (`UserId`) for partitioning Cosmos DB documents.
3. **Backend Proxy Update**: Update the `.NET` proxy in `GenerateAccountDescription` to forward the caller's incoming `Authorization` Bearer token instead of `x-api-key`.
4. **Configuration Clean up**: Remove `API_KEY` and `INGESTER_API_KEY` configurations from environment variables and settings.

---

## Implementation Design

### Architecture Changes

**Current Flow**:
```
[External Client] --(x-api-key)--> [phone_hook (Python)]
[Frontend] --(Bearer JWT)--> [.NET API] --(x-api-key & x-user-id)--> [notif-ingester]
```

**Proposed Flow**:
```
[External Client] --(Personal Token Grant)--> [ar-auth] --> (Bearer JWT)
[External Client] --(Bearer JWT)--> [phone_hook (Python)]
[Frontend] --(Bearer JWT)--> [.NET API] --(Forward Bearer JWT)--> [notif-ingester]
```

### Component Changes

#### Python Ingester (`notif-ingester/function_app.py`)
- Remove `validate_api_key(req)` function.
- Update `PhoneHookFunction`:
  ```python
  payload, err_resp = _require_auth(req)
  if err_resp:
      return err_resp
  
  user_id = payload.get("sub", "default")
  ```
- Inject the resolved `user_id` into the parsed hook payload before saving it.

#### .NET Backend (`backend/Functions/AccountFunctions.cs`)
- Update `GenerateAccountDescription` to retrieve the Bearer token from the incoming request's `Authorization` header and forward it to the python ingester:
  ```csharp
  var authHeader = req.Headers.Authorization.ToString();
  if (!string.IsNullOrEmpty(authHeader))
  {
      httpClient.DefaultRequestHeaders.Add("Authorization", authHeader);
  }
  ```

---

## Implementation Plan

### Phase 1: Python Ingester Auth Migration
1. Update `PhoneHookFunction` in `notif-ingester/function_app.py` to use `_require_auth(req)`.
2. Map the token's `sub` claim to `UserId` in the created `PhoneHookMessage`.
3. Remove `API_KEY` check logic and configuration references.

### Phase 2: .NET Backend Proxy Updates
1. Modify `GenerateAccountDescription` in [AccountFunctions.cs](file:///d:/Users/adolf/source/repos/Finance/backend/Functions/AccountFunctions.cs) to forward the `Authorization` header instead of `x-api-key`.
2. Remove any references to `INGESTER_API_KEY`.

### Phase 3: Configuration and Verification
1. Remove `API_KEY` from `local.settings.json` and `INGESTER_API_KEY` from backend configs.
2. Verify token signature validation behaves correctly with JWTs issued under the `personal_token` grant.
