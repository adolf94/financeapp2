# Product Specification Document: Personal Finance App

**Last Updated:** 2026-08-04

## 1. Product Vision & Objective
**Objective:** Create a mobile-first personal finance application that allows users to seamlessly track income, expenses, and account balances, functioning as a robust personal accounting tool. The focus is strictly on historical tracking of transactions rather than forward-looking budgeting.

**Target Audience:** Individuals seeking a clear, organized, and accessible way to manage their daily financial transactions and monitor their overall financial health.

**Design Philosophy:** Mobile-first approach, prioritizing quick data entry and easily digestible financial overviews.

## 2. Core Features & Requirements

### 2.1. Account Management
Users need a structured way to mirror their real-world financial accounts within the app.
- **Account Groups (Categories):** Custom groups (e.g., "Cash," "Bank Accounts," "Credit Cards," "Investments"). System provides defaults. Note: "Expense" and "Income" types are excluded from manual group creation in the main Accounts UI, as they function as dynamic tracking categories rather than persistent running-balance accounts. They are managed instead via the Settings tab.
- **Accounts (Specific Entities):** Added under groups. Fields include: Name, Group, Starting Balance, Currency. For Credit Cards, fields also include `CreditCardCycleStartDay` and `CreditCardPaymentDueDay`.
- **Actions:** CRUD operations, view balances, drill-down to Account History View, and Balance Adjustment (reconcile differences with actual bank balances via automated balancing Journal transactions under an `Adjustment`-type group/account).
- **Settings Tab (Configuration):** A dedicated configuration area designed to strictly separate structural financial accounts from tracking meta-data. It features:
  - **Categories Management:** CRUD management for `Expense` and `Income` groups (Categories) and their nested accounts (Sub-Categories).
  - **Vendor Management:** Dedicated UI to view, create, and delete Vendors.

### 2.2. Transaction Management
- **Transaction Modes:**
  - **Simple Mode:** Streamlined UI for common Income, Expense, and Transfers. Generates standard dual-entry ledgers automatically.
  - **Advanced Mode (Journal):** Full double-entry accounting view supporting multiple splits and manual debit/credit allocation.
- **Transaction Types:** Expense, Income, Transfer, Journal.
- **Categorization:** Two-level (Primary Group > Specific Selection).
- **Fields:** Type, Amount, Date, Account (From/To for transfers), Category Group, Specific Selection, Note, Vendor.
- **Inline Creation & Search (Combobox):** The Category, Sub-Category, and Vendor selection fields utilize a custom `Combobox` component. This enables searchable dropdowns and allows users to seamlessly create new categories, sub-categories, or vendors inline directly during the Add Transaction flow without navigating away.

### 2.3. Recurring Transactions
- Automates data entry (Daily, Weekly, Monthly, Yearly).
- Supports configuring `maxOccurrences` to automatically stop generation after a fixed number of transactions.
- Uses `RecurringTransaction` entity featuring document embedding in Cosmos DB (nesting `templateEntries` and `occurrences` directly in the document).
- When creating an initial transaction via `POST /transactions` with a `scheduleId`, the initial occurrence is automatically linked to the parent recurring schedule (`RecurringTransactionOccurrence`).
- Handled efficiently in the background via a nightly Azure Functions `[TimerTrigger]`. 
- Provides an automated view under the Transactions page, showcasing the scheduled history and expected end dates.

### 2.4. Data Entry & Automation
- **Smart Categorization:** Learns from manual entries to suggest categories based on past transaction vectors using cosine-similarity retrieval.
- **Automated Data Capture via Notification Ingester:** A dedicated Python Azure Functions microservice (`notif-ingester/`) handles incoming phone notifications and auto-creates pending transactions:
  1. **Receive:** A mobile notification payload is `POST`ed to `/phone_hook` (API key protected) and saved to the `PhoneHookMessages` CosmosDB container with `status = "received"`.
  2. **Classify:** A Cosmos DB Change Feed trigger fires. The pipeline first runs a lightweight Gemini check (`is_financial_transaction_async`) to skip non-financial notifications (`status = "NonFinancial"`, TTL = 7 days). For financial ones, it embeds the raw text via Gemini `text-embedding-004`, retrieves top-5 similar past transactions via cosine similarity, fetches accounts and the RUNBOOK.md, then calls Gemini for structured classification into an `AiParsedData` result.
  3. **Vendor Matching:** The AI has a guess for the vendor, but can be overridden by vendor lookup. If there is a match via vendor lookup, prepopulate the new transaction Vendor. Else, if there is a match from the current vendor list via AI classification, prepopulate using this value. If there is no matching, the AI provides a suggestion (showing the Vendor, (I/B) type, and tags). If the suggestion has masks (containing asterisks `*` or `xxx` or related), quick create is disabled, requiring the user to edit it or select/add via the Vendor dropdown. If there are no masks, quick create is enabled, but custom edit is still available. After saving a newly created vendor, the dropdown is automatically populated.
  4. **Auto-Confirm:** If the top similarity score ≥ `AUTO_CONFIRM_THRESHOLD` (default `0.92`) and all account IDs are resolved, the transaction is created immediately via the Finance API (`status = "AutoConfirmed"`) and the vector embedding is learned.
  5. **Pending Review:** Otherwise the ingestion remains `status = "Pending"` for user review.
  6. **User Actions:** The user can review via `GET /ingestions`, quick-confirm via `POST /ingestions/{id}/confirm-status`, edit & confirm via the `AddTransactionModal` (pre-filled from AI data), reject via `POST /ingestions/{id}/reject`, or reclassify via `POST /ingestions/{id}/reclassify`. Vendor can be patched inline via `PATCH /ingestions/{id}/vendor`.
  7. **Learn:** On confirmation, `POST /ingestions/{id}/learn` embeds the confirmed transaction and stores a `TransactionVector` for future similarity lookups.
  8. **Historical Import:** `GET /historical-hooks` and `POST /historical-hooks/{id}/import` allow migrating past notifications from a legacy CosmosDB database into the new pipeline.

### 2.5. Monthly Transaction List View
- Chronological log of financial activity for a calendar month, accessed via the **Daily tab** (default) inside the Transactions page.
- Grouped by date with sticky date headers. Each row shows: Type Icon (color-coded), Account/Description, Vendor, Note (italic), and Amount.
- **Edit/Delete:** Each transaction row exposes an inline Pencil (edit) and Trash (delete) action. Tapping the pencil opens `AddTransactionModal` pre-filled with the transaction's data.

### 2.6. Monthly Calendar Overview
- Accessed via the **Month tab** inside the Transactions page (alongside the **Daily tab**, which is the default chronological list).
- Displays a 7-column calendar grid (Sun–Sat) for the selected month.
- **Per-day cells** show: daily total income (green chip), daily total expense (red chip), and net (blue/amber).
- **Month summary bar** at the top of the grid shows the month-level totals for Income, Expenses, and Net.
- **Income/Expense computation is account-type driven** (applies to all transaction types including Journal entries):
  - An entry is counted as **Income** when its linked account has `AccountType = Income`. The absolute amount is tallied to consistently handle double-entry sign variances, aligning with Dashboard analysis logic.
  - An entry is counted as **Expense** when its linked account has `AccountType = Expense`. The absolute amount is tallied.
  - Net = Total Income − Total Expense.
- Tapping a day with transactions opens a **Day Transaction Modal** (bottom sheet) showing:
  - Day totals summary (Income / Expense / Net chips).
  - Scrollable list of all transactions for that day with the same visual style as the Daily tab.
  - Closes on X button or backdrop tap.

### 2.7. Specific History Views (Drill-Downs)
- **Account History:** Transactions tied to a specific account with a running balance. For Credit Cards, standard chronological daily groupings are further segmented with visual Statement Cycle boundaries based on the `CreditCardCycleStartDay` (e.g. "STATEMENT: JUL 15 - AUG 14- **Category History:** Drill-down view for transactions tied to a specific primary group (Category Group / `AccountGroup`) accessed via `/categories/$categoryId` or a specific selection (Sub-category / `Account`) accessed via `/accounts/$accountId`. The Category Group details view displays transactions grouped by day, displaying subcategories and impact amount.
- **Analysis Integration:** The Analysis dashboard displays a spending breakdown list under the pie chart; clicking a Category Group redirects to `/categories/$categoryId`, and clicking a Sub-category redirects to `/accounts/$accountId`.

## 2.8. Analysis & Insights
- **Goal Tracking:** Track progress towards savings goals.
- **Visualizations:** Charts/graphs for spending by category and cash flow (e.g., Recharts).
- **Dynamic Context:** Includes a month ticker to dynamically filter and calculate spending charts and cash flow based on the specifically selected month.

## 3. Non-Functional Requirements
- **UI:** Touch-friendly, large tap targets. Follows "OLED-First" branding guidelines.
- **Dark Mode:** System-level and manual toggle.
- **Performance:** Instantaneous loading.

## 4. Technical Specification

### 4.1 Architecture Overview
- **Frontend:** React + Vite (SPA)
- **Backend:** Azure Functions (.NET 10) — primary CRUD API
- **Notification Ingester:** Azure Functions (Python) — AI-powered notification-to-transaction pipeline
- **Database:** CosmosDB (NoSQL)
- **Communication:** REST API via Axios
- **Currency:** Philippine Peso (`₱`). All monetary values displayed and stored in PHP.
- **ID Generation:** Always use `uuidv7` for generating new GUIDs/UUIDs to ensure time-sortable primary keys across the application (both .NET using `UuidExtensions` and Python using `uuid_extensions`).

### 4.2 Backend Design (.NET + Azure Functions)
- **Layered Structure:** Controller/Function Layer (entry point) -> Service Layer (business logic) -> Repository Layer (data access logic).
- **Interface Pattern:** All business logic and data access hidden behind interfaces (ITransactionService, ITransactionRepository, IVendorService, ICategoryService) for DI and unit testing.
- **Data Access:** Entity Framework Core for CosmosDB.
- **Containers & Partitioning:**
  - `AccountGroups` (`/UserId`) — Categories and financial groups (`AccountType`: `Expense`, `Income`, `Asset`, `Liability`, `Equity`, `Adjustment`, `Cash`, `Bank`, `CreditCard`, `Investment`).
  - `Accounts` (`/UserId`) — Subcategories and individual account entities belonging to an `AccountGroup` (`AccountGroupId`). Supports `CreditCardCycleStartDay` and `CreditCardPaymentDueDay` for billing cycle tracking.
  - `Transactions` (`/UserId`) — Shared container storing both `Transaction` and `LedgerEntry` documents, differentiated by an EF Core Discriminator.
    - `Transaction` acts as the root header document.
    - `LedgerEntry` acts as the individual line items. Due to EF Core Cosmos provider limitations on non-embedded relationships, entries are fetched manually in the Repository (bypassing `.Include()`) and mapped via composite foreign keys (`TransactionId`, `UserId`).
  - `Vendors` (`/UserId`) — Standalone vendor entity container for tracking and dropdown selection.
- **Database Initialization:** Invokes `Database.EnsureCreatedAsync()` during application startup in `Program.cs` to ensure target database and containers are automatically created.
- **Serialization & Persistence Rules:** 
  - Enums (`AccountType`, `TransactionType`) are decorated with `[JsonConverter(typeof(JsonStringEnumConverter))]` and processed with custom `JsonSerializerOptions` to support string enum values in HTTP JSON payloads.
  - EF Core model configuration uses `.HasConversion<string>()` in `FinanceDbContext` to store enums as human-readable string values in Cosmos DB documents.
- **Transaction Updates:** To maintain double-entry accounting integrity, updating a transaction explicitly removes existing `LedgerEntry` child records and inserts replacements, seamlessly reversing and reapplying account balance impacts atomically.
- **API Filtering:** `GET /transactions` accepts an optional `accountGroupId` query parameter, filtering transactions to those having entries matching any subcategories under the specified account group.
- **Testing:** `backend.Tests` xUnit project utilizing `Moq` for unit testing service business logic and `System.Text.Json` model serialization.

### 4.3 Frontend Design (React + Vite)
- **Data Fetching:** Two Axios instances:
  - `apiClient` — calls the .NET Finance API. Uses a request interceptor to attach the Bearer JWT token retrieved via `getUserManager()` from `@adolf94/ar-auth-client`.
  - `ingesterClient` (`src/lib/ingesterClient.ts`) — calls the Python `notif-ingester` directly. Uses the same JWT Bearer token from `getUserManager()` with localStorage OIDC key fallback.
- **Runtime Configuration:** Auth and API config loaded dynamically from `/authConfig/config.js` (injected at deploy time) with `import.meta.env` fallback for local dev.
- **Routing:** `@tanstack/router` for type-safe navigation.
- **Development Standard:** No direct fetch. All network requests MUST go through the configured Axios instance (`apiClient` or `ingesterClient`). Logic and UI separated. Hooks used for data retrieval using React Query.
- **Testing:** Vitest and React Testing Library utilized for verifying React Query custom hooks (`useTransactions`, etc.) and component interactions via mocked API clients.
- **Key Components:**
  - `Settings.tsx` (`pages/`) — Tabbed configuration area for manual management of Categories (Expense/Income groups) and Vendors, keeping the main Accounts view decluttered.
  - `Combobox.tsx` (`components/ui/`) — Reusable, searchable dropdown component that supports inline creation. Embedded throughout the Transaction Modal for fast data entry.
  - `Transactions.tsx` — Monthly transaction page. Houses a **Daily | Month** tab switcher. The Daily tab renders the existing chronological list; the Month tab renders `CalendarView`.
  - `CalendarView.tsx` (`pages/`) — 42-cell (6×7) calendar grid. Accepts `transactions[]` and `accounts[]` as props (already fetched by the parent). Computes per-day income/expense summaries using the account-type driven rule (see §2.6). Opens `DayModal` on day tap.
  - `DayModal.tsx` (`components/`) — Bottom-sheet modal displaying day-level Income/Expense/Net summary chips and a scrollable transaction list for the selected date.
  - `CategoryDetails.tsx` (`pages/`) — Detail page displaying category group name, type, and transaction list grouped by date.
  - `PendingIngestions.tsx` (`pages/`) — Page rendering `PendingIngestionsList`. Accessible from the bottom navigation.
  - `PendingIngestionsList.tsx` (`components/`) — Reviews AI-classified ingestions. Supports: quick-confirm, edit-and-confirm (opens `AddTransactionModal` with a bold, compact review layout), reject, vendor inline patch, and suggested account creation with AI-generated descriptions.
  - `HistoricalHooksList.tsx` (`components/`) — Lists legacy notifications from the old CosmosDB. Supports per-item import (triggers the full classify pipeline) and ignore actions.
  - `EditAccountModal.tsx` (`components/`) — Modal for editing existing accounts (name, description, group, starting balance, credit card fields).
  - `TransactionCard.tsx` (`components/`) — Reusable component for rendering a single transaction row.
  - `PendingIngestionCard.tsx` (`components/`) — Reusable component for rendering a pending AI-classified ingestion item. Displays suggested vendor name, type badges (Individual/Business, skipping Internal), and tags. Disables the Quick Confirm icon button and shows a warning when the suggestion contains masks (wildcards, xxx, repeating x, or 4+ digits), requiring manual correction.
  - `RunbookReviewModal.tsx` (`components/`) — Modal for interactively reviewing and chatting with AI to apply suggested `RUNBOOK.md` corrections. Features a dual-mode interface: Chat Mode (visualizing suggested updates and conversational refinements) and Editor Mode (direct markdown editing via Monaco Editor, formatting toolbar, table-of-contents section navigator, and enhanced diff/preview tabs).
  - `DiffViewer.tsx` (`components/`) — Visualizer for displaying text differences in runbook updates.
  - `EnhancedDiffViewer.tsx` (`components/ui/`) — Rich diff visualizer supporting Line, Word, and Character differences.
  - `RunbookEditorPanel.tsx` (`components/RunbookReview/`) — Container component for the Monaco-based direct runbook markdown editor.
  - `RunbookSectionNavigator.tsx` (`components/RunbookReview/`) — Table of contents section jump navigator.
- **Key Hooks:**
  - `useIngestions.ts` — `useGetPendingIngestions`, `useConfirmIngestion`, `useRejectIngestion`, `useUpdateIngestionVendor`, `useGenerateAccountDescription`, `useReclassifyIngestion`. All use `ingesterClient`.
  - `useRunbookReview.ts` — `useGetRunbookCorrections`, `useStartRunbookReview`, `useChatRunbookReview`, `useUpdateRunbookSession`, `useApproveRunbookReview`. Uses `pythonApiClient`.
- **Account Interface (`useAccounts.ts`):** The `Account.accountType` field uses the full enum union matching the backend: `'Cash' | 'Bank' | 'CreditCard' | 'Investment' | 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense' | 'Adjustment'`. This is required for the calendar to identify income/expense accounts during per-day aggregation.

### 4.4 API Design Guidelines
- **Version:** API v1.
- **Authentication:** OAuth via `@adolf94/ar-auth-client` on the frontend.
- **Backend Authentication:** JWT validation and authorization via the `Ar.Auth.OpenId.AzureFunctions` middleware.
- **Error Handling:** Consistent response envelopes for all errors.

### 4.5 Notification Ingester (Python Azure Functions)
- **Language & Runtime:** Python 3.11+, Azure Functions v2 programming model (`azure-functions`).
- **Authentication:**
  - `POST /phone_hook` — API key protected (`x-api-key` header vs. `API_KEY` env var).
  - All other endpoints — JWT Bearer validated via `ArAuthClient` from `ar_auth` package (JWKS cached, authority: `https://auth.adolfrey.com/api`).
- **Dependency Injection:** Manual factory functions (`get_hook_service()`, `get_ingestion_service()`) compose services in `function_app.py`.
- **Service Layer:**
  - `HookService` — Validates and persists incoming `PhoneHookMessage` to CosmosDB.
  - `EmbeddingService` — Calls Google Gemini `text-embedding-004` to produce a 768-dimension float vector from notification text.
  - `VectorService` — Performs cosine-similarity search (via `numpy`) across all stored `TransactionVector` documents for a user to retrieve top-k matches.
  - `AiService` — Two-stage Gemini calls: (1) `is_financial_transaction_async` — lightweight check to filter non-financial notifications; (2) `classify_async` — full structured JSON classification with notification + similar transactions + accounts + RUNBOOK.md context. Produces `AiParsedData` with enhanced fields: `vendor`, `amount`, `transaction_type`, `debit_account_id`, `credit_account_id`, `suggested_account_creation`, `notes`, `confidence`, `recipient_account_number/name`, `sender_account_number/name`, `application`, `why`, `user_why`, `is_financial`, `is_auto_confirmed`, `vendor_matched`.
  - `FinanceApiService` — Directly queries CosmosDB containers (`Accounts`, `AccountGroups`, `Vendors`, `VendorLookups`) to resolve accounts and vendors. Creates confirmed transactions by writing directly to the `Transactions` container. Methods include `get_accounts_async`, `search_vendors_by_lookups_async`, `ensure_vendor_and_lookups_async`, `create_transaction_async`, `get_runbook_content_async`, `update_vendor_tags_async`.
  - `IngestionService` — Orchestrates the full pipeline: financial-check → embed → vector-search → fetch-accounts+runbook → classify → vendor-match → auto-confirm-or-pending → save.
- **HTTP Endpoints (`function_app.py`):**
  - `POST /phone_hook` — Receive raw notification, API key auth.
  - `GET /ingestions` — List ingestions by status (default `Pending`), JWT auth.
  - `POST /ingestions/{id}/confirm-status` — Mark as `Confirmed`, record `transaction_id`, trigger learn, JWT auth.
  - `POST /ingestions/{id}/reject` — Mark as `Rejected`, JWT auth.
  - `POST /ingestions/{id}/learn` — Embed and store `TransactionVector` for a confirmed ingestion, JWT auth.
  - `POST /ingestions/{id}/reclassify` — Re-run full AI classification pipeline with optional user corrections, comments, and `operationId` for real-time SignalR progress streaming, JWT auth.
  - `GET/POST /negotiate` — SignalR Hub negotiation endpoint for real-time Chain of Thoughts (CoT) and progress updates during reclassification and runbook operations, JWT auth.
  - `PATCH /ingestions/{id}/vendor` — Patch vendor name and set `vendor_matched = true`, JWT auth.
  - `POST /ingestions/classify-hook` — Synchronous classification (no Change Feed), JWT auth.
  - `POST /accounts/generate-description` — Generate an AI account description, JWT auth.
  - `GET /historical-hooks` — Fetch legacy hook messages from old CosmosDB (`OldCosmosConnectionString`), JWT auth.
  - `POST /historical-hooks/{id}/import` — Map old schema → `PhoneHookMessage`, upsert to new DB, classify synchronously, JWT auth.
  - `POST /historical-hooks/{id}/ignore` — Mark old hook as `Ignored` in legacy DB, JWT auth.
  - `GET /runbook/corrections` — Fetch AI-suggested runbook mapping corrections, JWT auth.
  - `POST /runbook/review/start` — Start a runbook review session, JWT auth.
  - `POST /runbook/review/chat` — Chat with AI to iteratively refine the proposed runbook changes. The system prompt is configured to strictly enforce returning empty JSON arrays when no corrections are found. JWT auth.
  - `PUT /runbook/review/session` — Update active review session's proposed runbook content or update lists. JWT auth.
  - `POST /runbook/review/approve` — Approve and save the reviewed runbook to Cosmos DB, JWT auth.
- **Auto-Confirm Threshold:** Configurable via `AUTO_CONFIRM_THRESHOLD` env var (default `0.92`). When top cosine similarity score ≥ threshold and all account IDs are present, transactions are created automatically (`AutoConfirmed`).
- **Gemini Model Configuration:** Gemini models are configurable via environment variables or a `.env` file:
  - `GEMINI_EMBEDDING_MODEL` defines the model used for embedding raw notification text (default: `gemini-embedding-2`).
  - `GEMINI_CLASSIFICATION_MODEL` defines the model used for structured transaction classification, non-financial filtering, and account description generation (default: `gemini-2.5-flash-lite`).
  - `GEMINI_REASONING_MODEL` defines the model used for runbook review start and chat review sessions (default: `gemini-2.5-flash`).
- **Key Models (Pydantic):**
  - `PhoneHookMessage` — Raw notification payload (`id`, `UserId`, `action`, `raw_msg`, `raw_payload`, `status`, `month_key`, `partition_key`, `received_at`). Includes a `_ttl` of 60 days for auto-expiry.
  - `PendingIngestion` — AI classification result with `AiParsedData`, `top_matches`, `similarity_score`, `status` (`Pending` | `AutoConfirmed` | `Confirmed` | `Rejected` | `NonFinancial`), `transaction_id`, `user_confirmed`, `month_key`, `partition_key`.
  - `AiParsedData` — Full structured AI output (see AiService above). Synced as a C# class (`backend/Models/AiParsedData.cs`) via the `model-syncer` skill.
  - `TransactionVector` — Persisted embedding document (`id`, `UserId`, `transaction_id`, `vendor`, `category`, `summary`, `embed_text`, `embedding`, `debit_account_id`, `credit_account_id`, `confirmed_at`, `partition_key`). Synced as a C# class (`backend/Models/TransactionVector.cs`).
- **CosmosDB Containers:**
  - `PhoneHookMessages` (`/partition_key`) — Raw incoming hook documents with Change Feed trigger and `PhoneHookMessages-leases` lease container.
  - `PendingIngestions` (`/partition_key`) — AI-classified transaction proposals awaiting user confirmation.
  - `TransactionVectors` (`/userId`) — Historical embeddings indexed for similarity retrieval.
  - `VendorLookups` (`/UserId`) — Lookup strings (account numbers, names, app identifiers) mapped to `VendorId` with a `Hits` counter for frequency-weighted matching. Managed by both .NET (`VendorLookup.cs`, `VendorRepository`) and Python (`FinanceApiService.ensure_vendor_and_lookups_async`).
- **RUNBOOK.md:** A human-editable markdown file stored in CosmosDB (fetched via `FinanceApiService.get_runbook_content_async`). Defines explicit vendor→category→type overrides that take precedence over AI inference.
- **Model Sync:** The `model-syncer` skill (`scripts/sync_check.py`) validates that Python Pydantic models and C# classes remain in sync. Key synced pairs: `AiParsedData`, `TransactionVector`.
