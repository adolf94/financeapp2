using FinanceApp.Interfaces;
using FinanceApp.Models;

namespace FinanceApp.Services
{
    public class TransactionService : ITransactionService
    {
        private readonly ITransactionRepository _transactionRepository;
        private readonly IAccountRepository _accountRepository;

        public TransactionService(
            ITransactionRepository transactionRepository,
            IAccountRepository accountRepository)
        {
            _transactionRepository = transactionRepository;
            _accountRepository = accountRepository;
        }

        public async Task<IEnumerable<Transaction>> GetTransactionsAsync(string userId, DateTime? startDate, DateTime? endDate, string? accountGroupId = null)
        {
            return await _transactionRepository.GetTransactionsAsync(userId, startDate, endDate, accountGroupId);
        }

        public async Task<IEnumerable<Transaction>> GetTransactionsByAccountIdAsync(string userId, string accountId)
        {
            return await _transactionRepository.GetTransactionsByAccountIdAsync(userId, accountId);
        }

        public async Task<Transaction?> GetTransactionByIdAsync(string userId, string id)
        {
            return await _transactionRepository.GetTransactionByIdAsync(userId, id);
        }

        public async Task<Transaction> CreateTransactionAsync(string userId, Transaction transaction)
        {
            transaction.UserId = userId;
            foreach (var entry in transaction.Entries)
            {
                entry.UserId = userId;
                entry.TransactionId = transaction.Id;
            }

            // Apply balance impact
            await ApplyBalanceImpactAsync(userId, transaction);

            await _transactionRepository.AddTransactionAsync(transaction);
            await _transactionRepository.SaveChangesAsync();

            // Link occurrence if ScheduleId is present
            if (!string.IsNullOrEmpty(transaction.ScheduleId))
            {
                await _transactionRepository.LinkRecurringOccurrenceAsync(userId, transaction.ScheduleId, transaction.Id, transaction.Date);
            }

            return transaction;
        }

        public async Task<Transaction> UpdateTransactionAsync(string userId, Transaction transaction)
        {
            var existingTx = await _transactionRepository.GetTransactionByIdAsync(userId, transaction.Id);
            if (existingTx == null)
            {
                throw new KeyNotFoundException("Transaction not found.");
            }

            var oldEntries = existingTx.Entries.ToList();

            // Revert old impact
            await RevertBalanceImpactAsync(userId, existingTx);

            // Apply new impact
            await ApplyBalanceImpactAsync(userId, transaction);

            foreach (var entry in transaction.Entries)
            {
                entry.UserId = userId;
                entry.TransactionId = transaction.Id;
                // Force new ID for new entries to avoid Cosmos DB conflicts
                entry.Id = Guid.CreateVersion7().ToString();
            }

            // Update details
            existingTx.Entries = transaction.Entries;
            existingTx.Date = transaction.Date;
            existingTx.Note = transaction.Note;
            existingTx.Vendor = transaction.Vendor;
            existingTx.Type = transaction.Type;

            await _transactionRepository.UpdateTransactionAsync(existingTx, oldEntries);
            await _transactionRepository.SaveChangesAsync();

            return existingTx;
        }

        public async Task DeleteTransactionAsync(string userId, string id)
        {
            var existingTx = await _transactionRepository.GetTransactionByIdAsync(userId, id);
            if (existingTx == null)
            {
                throw new KeyNotFoundException("Transaction not found.");
            }

            await RevertBalanceImpactAsync(userId, existingTx);
            await _transactionRepository.DeleteTransactionAsync(userId, id);
            await _transactionRepository.SaveChangesAsync();
        }

        private async Task ApplyBalanceImpactAsync(string userId, Transaction transaction)
        {
            if (transaction.Entries == null || transaction.Entries.Count < 2)
            {
                throw new ArgumentException("A transaction must have at least 2 ledger entries.");
            }

            var balance = transaction.Entries.Sum(e => e.Amount);
            var tolerance = 0.00001m;
            if (Math.Abs(balance) > tolerance)
            {
                throw new InvalidOperationException($"Transaction entries must balance to zero. Current balance is {balance}.");
            }

            foreach (var entry in transaction.Entries)
            {
                var account = await _accountRepository.GetAccountByIdAsync(userId, entry.AccountId);
                if (account == null)
                {
                    throw new KeyNotFoundException($"Account with ID '{entry.AccountId}' not found.");
                }

                // Positive amount = Debit (increases asset), Negative amount = Credit (decreases asset)
                account.CurrentBalance += entry.Amount;
                await _accountRepository.UpdateAccountAsync(account);
            }
        }

        private async Task RevertBalanceImpactAsync(string userId, Transaction transaction)
        {
            if (transaction.Entries == null) return;

            foreach (var entry in transaction.Entries)
            {
                var account = await _accountRepository.GetAccountByIdAsync(userId, entry.AccountId);
                if (account == null)
                {
                    throw new KeyNotFoundException($"Account with ID '{entry.AccountId}' not found for reversion.");
                }

                account.CurrentBalance -= entry.Amount;
                await _accountRepository.UpdateAccountAsync(account);
            }
        }
    }
}
