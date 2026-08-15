using FinanceApp.Interfaces;
using FinanceApp.Models;

namespace FinanceApp.Services
{
    public class AdjustmentService : IAdjustmentService
    {
        private readonly IAccountRepository _accountRepository;
        private readonly ITransactionService _transactionService;

        public AdjustmentService(
            IAccountRepository accountRepository,
            ITransactionService transactionService)
        {
            _accountRepository = accountRepository;
            _transactionService = transactionService;
        }

        public async Task<Transaction> AdjustAccountBalanceAsync(string userId, string accountId, AdjustmentRequest request)
        {
            var targetAccount = await _accountRepository.GetAccountByIdAsync(userId, accountId);
            if (targetAccount == null)
            {
                throw new KeyNotFoundException($"Account with ID '{accountId}' not found.");
            }

            var currentBalance = targetAccount.CurrentBalance;
            var delta = request.ActualBalance - currentBalance;

            if (delta == 0)
            {
                throw new InvalidOperationException("Actual balance is equal to the current balance. No adjustment needed.");
            }

            // Resolve or create Adjustment AccountGroup
            var groups = await _accountRepository.GetAccountGroupsAsync(userId);
            var adjustmentGroup = groups.FirstOrDefault(g => g.AccountType == AccountType.Adjustment);

            if (adjustmentGroup == null)
            {
                adjustmentGroup = new AccountGroup
                {
                    UserId = userId,
                    Name = "Adjustments",
                    AccountType = AccountType.Adjustment
                };
                await _accountRepository.AddAccountGroupAsync(adjustmentGroup);
            }

            // Resolve or create Adjustment Account
            var accounts = await _accountRepository.GetAccountsAsync(userId);
            var adjustmentAccount = accounts.FirstOrDefault(a => a.AccountType == AccountType.Adjustment && a.AccountGroupId == adjustmentGroup.Id);

            if (adjustmentAccount == null)
            {
                adjustmentAccount = new Account
                {
                    UserId = userId,
                    Name = "Balance Adjustments",
                    AccountGroupId = adjustmentGroup.Id,
                    AccountType = AccountType.Adjustment,
                    StartingBalance = 0,
                    CurrentBalance = 0
                };
                await _accountRepository.AddAccountAsync(adjustmentAccount);
            }

            var note = string.IsNullOrWhiteSpace(request.Note) ? "Balance adjustment" : request.Note.Trim();
            var date = request.Date ?? DateTime.UtcNow;

            var transaction = new Transaction
            {
                UserId = userId,
                Date = date,
                Note = note,
                Type = TransactionType.Journal,
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry
                    {
                        AccountId = targetAccount.Id,
                        Amount = delta
                    },
                    new LedgerEntry
                    {
                        AccountId = adjustmentAccount.Id,
                        Amount = -delta
                    }
                }
            };

            return await _transactionService.CreateTransactionAsync(userId, transaction);
        }
    }
}
