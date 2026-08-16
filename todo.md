# Finance App - Pending Implementation Tasks

Based on the `spec.md`, the following features are pending implementation:

## 1. Recurring Transactions (Section 2.3)
**Description:** Automate data entry for recurring schedules and auto-generate transactions on scheduled dates.
- [x] **Backend:** Create `RecurringTransaction` entity, DTOs, and interface.
- [x] **Backend:** Implement API endpoints (CRUD) for recurring schedules.
- [x] **Backend:** Implement background worker/cron job to automatically process and generate due transactions.
- [x] **Frontend:** Create UI in the "Add Transaction" modal (or a dedicated page) to set schedules (Daily, Weekly, Monthly, Yearly).
- [x] **Frontend:** Create a view to manage (pause/edit/cancel) active recurring transactions.

## 2. Category History View (Section 2.7)
**Description:** Drill-down view for transactions tied to a specific primary group or specific selection.
- [x] **Frontend:** Create a `CategoryDetails.tsx` page (similar to `AccountDetails.tsx`).
- [x] **Frontend:** Link to this page from the Analysis charts or a dedicated categories list.
- [x] **Backend:** Ensure `GET /transactions` supports filtering by `AccountGroupId` (if not already supported).

## 3. Custom Billing Cycles / Statement Cut-off (Section 2.7)
**Description:** Account History view should support custom billing cycles (Statement Cut-off Date) for credit cards.
- [x] **Backend:** Add `StatementCutoffDay` to the `Account` model.
- [x] **Frontend:** Update `AccountDetails.tsx` to group transactions by billing cycle rather than just standard chronological months for credit card accounts.

## 4. Goal Tracking (Section 2.8)
**Description:** Track progress towards savings goals.
- [ ] **Backend:** Create `Goal` entity (Name, Target Amount, Target Date, Linked Account IDs).
- [ ] **Backend:** Implement API endpoints to manage savings goals.
- [ ] **Frontend:** Build a UI to create and manage goals.
- [ ] **Frontend:** Update `useAnalysis.ts` to calculate real progress instead of using the hardcoded `goalProgress: 65` value.

## 5. Shopee Multi-Order Email Flow (Section 2.4 / PBI-013)
**Description:** Support multi-order Shopee checkout emails mapped to 1 ingestion, 1 transaction with N+1 ledger entries, and source account card resolution.
- [x] **Ingester:** Add `SHOPEE_MULTI_ORDER_PROMPT` and `classify_email_shopee_async` in AI service.
- [x] **Ingester:** Add `find_by_amount_and_time_async` in Cosmos repository for candidate resolution.
- [x] **Ingester:** Add `_resolve_source_account_async` and Shopee email handling in `EmailProcessingService`.
- [x] **Backend & Ingester:** Implement 1 Transaction with N+1 LedgerEntries in `TransactionFunctions.cs` and `FinanceApiService.cs`.
- [x] **Frontend:** Add multi-order chip breakdown in `PendingIngestionCard` and auto-prefill journal lines in `AddTransactionContext`.
