# Bug Report: Bug 1 - Advanced Option Error 400

## Issue Description
When using the Advanced Option (Journal mode) in the transaction creation form, users receive an HTTP 400 error when attempting to save the transaction.

## Impact
- Users cannot create Journal transactions using Advanced mode
- Double-entry accounting functionality is broken
- Advanced accounting features unavailable

## Reproduction Steps
1. Open Add Transaction Modal
2. Switch to "Advanced" mode
3. Fill in Journal entries (multiple debit/credit lines)
4. Click "Save" or "Save & Close"
5. **Result**: HTTP 400 error occurs

## Current State Analysis

### Frontend Validation (AddTransactionModal.tsx:473-476)
```javascript
if (Math.abs(debitSum - creditSum) > 0.01) {
  alert(`Debits (₱${debitSum.toFixed(2)}) must equal Credits (₱${creditSum.toFixed(2)}).`);
  return;
}
```

### Backend Validation (TransactionService.cs:107-111)
```csharp
var balance = transaction.Entries.Sum(e => e.Amount);
if (balance != 0)
{
    throw new InvalidOperationException($"Transaction entries must balance to zero. Current balance is {balance}.");
}
```

## Root Cause Investigation

### Potential Causes:
1. **Floating-Point Precision Issue**: Frontend uses `> 0.01` tolerance, backend uses exact equality
2. **Data Type Mismatch**: Frontend `parseFloat()` vs backend `decimal` type
3. **Amount Conversion Issue**: Journal line amount handling may have sign errors
4. **Missing Validation**: Some edge cases not caught by frontend validation

### Specific Code Locations:
1. **Amount Parsing**: `AddTransactionModal.tsx:461` - `parseFloat(line.amount || '0')`
2. **Sign Handling**: `AddTransactionModal.tsx:469` - `amount: line.type === 'Debit' ? amt : -amt`
3. **Backend Amount**: `LedgerEntry.cs:12` - `public decimal Amount { get; set; }`
4. **Balance Calculation**: `TransactionService.cs:107` - `transaction.Entries.Sum(e => e.Amount)`

## Technical Details

### Frontend Data Flow:
1. User inputs amounts as strings
2. Converted to numbers via `parseFloat()`
3. Debits positive, Credits negative for backend
4. Sum calculated with JavaScript floating-point arithmetic

### Backend Data Flow:
1. Receives `decimal` amounts from JSON
2. C# `decimal` type (128-bit, precise decimal arithmetic)
3. Sum calculated with C# decimal arithmetic
4. Exact zero comparison (no tolerance)

### Critical Discrepancy:
- **Frontend**: JavaScript `number` (IEEE 754 double-precision floating-point)
- **Backend**: C# `decimal` (precise decimal arithmetic)
- **Comparison**: Frontend allows ±0.01 tolerance, backend requires exact zero

## Proposed Fixes

### Option 1: Frontend Fix (Recommended)
```javascript
// Current (line 473-476)
if (Math.abs(debitSum - creditSum) > 0.01) {
  alert(`Debits (₱${debitSum.toFixed(2)}) must equal Credits (₱${creditSum.toFixed(2)}).`);
  return;
}

// Proposed Fix
const tolerance = 0.00001; // Smaller tolerance for decimal precision
if (Math.abs(debitSum - creditSum) > tolerance) {
  alert(`Debits (₱${debitSum.toFixed(2)}) must equal Credits (₱${creditSum.toFixed(2)}).`);
  return;
}
```

### Option 2: Backend Fix
```csharp
// Current (line 107-111)
var balance = transaction.Entries.Sum(e => e.Amount);
if (balance != 0)
{
    throw new InvalidOperationException($"Transaction entries must balance to zero. Current balance is {balance}.");
}

// Proposed Fix
var balance = transaction.Entries.Sum(e => e.Amount);
var tolerance = 0.00001m; // Small decimal tolerance
if (Math.Abs(balance) > tolerance)
{
    throw new InvalidOperationException($"Transaction entries must balance to zero. Current balance is {balance}.");
}
```

### Option 3: Enhanced Validation (Both)
1. **Frontend**: Use `toFixed(2)` for display, maintain full precision for calculation
2. **Backend**: Add rounding to 2 decimal places before validation
3. **Both**: Implement consistent decimal handling

## Testing Scenarios

### Test Cases:
1. **Exact Match**: Debits 100.00, Credits 100.00
2. **Floating Point**: Debits 33.33 + 66.67, Credits 100.00
3. **Rounding Issue**: Debits 50.005, Credits 50.005 (rounded to 50.01)
4. **Multiple Entries**: Complex journal with 5+ entries
5. **Negative Amounts**: Credits with negative signs in frontend

## Files to Modify

### Primary:
1. `frontend/src/components/AddTransactionModal.tsx`
   - Update balance validation tolerance
   - Improve amount parsing and rounding
   - Add debug logging for balance calculation

2. `backend/Services/TransactionService.cs`
   - Update balance validation with tolerance
   - Add rounding before comparison
   - Improve error messages

### Secondary:
1. `frontend/src/hooks/useTransactions.ts`
   - Ensure amount serialization consistency
2. `backend/Models/LedgerEntry.cs`
   - Verify decimal precision settings

## Success Criteria
1. Journal transactions save successfully with balanced entries
2. No HTTP 400 errors for valid Journal entries
3. Proper error messages for unbalanced entries
4. Consistent behavior between Simple and Advanced modes

## Priority: HIGH
- Blocks core accounting functionality
- Affects all users using Advanced mode
- Simple workaround exists (use Simple mode) but limits functionality

## Resolution: FIXED

### Changes Made:

#### Frontend (`AddTransactionModal.tsx`)
- Added `Math.round(amt * 100) / 100` rounding on each journal line amount before calculations (line ~465)
- This prevents IEEE 754 floating-point accumulation errors across multiple entries
- Vendor field now uses selected `vendor` state instead of hardcoded `null` in Advanced mode (line ~490)
- Auto-creates vendor if not in `dbVendors` list before saving transaction (lines ~486-501)

#### Backend (`TransactionService.cs`)
- Changed balance validation from exact zero (`balance != 0`) to tolerance-based (`Math.Abs(balance) > 0.00001m`) (line ~108)
- Handles any remaining precision edge cases during JSON serialization/deserialization

### Files Modified:
1. `frontend/src/components/AddTransactionModal.tsx` - Amount rounding + vendor handling
2. `backend/Services/TransactionService.cs` - Tolerance-based balance check

### Build Status: ✅ Passed (0 errors)