using FinanceApp.Interfaces;
using FinanceApp.Models;

namespace FinanceApp.Services
{
    public class TransactionService : ITransactionService
    {
        private readonly ITransactionRepository _transactionRepository;
        private readonly IAccountRepository _accountRepository;
        private readonly IVendorRepository _vendorRepository;

        public TransactionService(
            ITransactionRepository transactionRepository,
            IAccountRepository accountRepository,
            IVendorRepository vendorRepository)
        {
            _transactionRepository = transactionRepository;
            _accountRepository = accountRepository;
            _vendorRepository = vendorRepository;
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
            CopyNoteAndReferenceNumberToEntries(transaction);

            foreach (var entry in transaction.Entries)
            {
                entry.UserId = userId;
                entry.TransactionId = transaction.Id;
            }

            // Apply balance impact
            await ApplyBalanceImpactAsync(userId, transaction);

            if (!string.IsNullOrWhiteSpace(transaction.Vendor))
            {
                await _vendorRepository.UpdateVendorLastUsedAsync(userId, transaction.Vendor, transaction.Date);
            }

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

            CopyNoteAndReferenceNumberToEntries(transaction);

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
            existingTx.ReferenceNumber = transaction.ReferenceNumber;
            existingTx.Vendor = transaction.Vendor;
            existingTx.Type = transaction.Type;

            if (!string.IsNullOrWhiteSpace(transaction.Vendor))
            {
                await _vendorRepository.UpdateVendorLastUsedAsync(userId, transaction.Vendor, transaction.Date);
            }

            await _transactionRepository.UpdateTransactionAsync(existingTx, oldEntries);
            await _transactionRepository.SaveChangesAsync();

            return existingTx;
        }

        private static void CopyNoteAndReferenceNumberToEntries(Transaction transaction)
        {
            if (transaction.Entries == null || transaction.Entries.Count == 0) return;

            if (transaction.Type == TransactionType.Expense)
            {
                // For Expenses: copy transaction note & referenceNumber to Debit entry (Amount > 0)
                var debitEntry = transaction.Entries.FirstOrDefault(e => e.Amount > 0);
                if (debitEntry != null)
                {
                    if (string.IsNullOrWhiteSpace(debitEntry.Note)) debitEntry.Note = transaction.Note;
                    if (string.IsNullOrWhiteSpace(debitEntry.ReferenceNumber)) debitEntry.ReferenceNumber = transaction.ReferenceNumber;
                }
            }
            else if (transaction.Type == TransactionType.Income)
            {
                // For Income: copy transaction note & referenceNumber to Credit entry (Amount < 0)
                var creditEntry = transaction.Entries.FirstOrDefault(e => e.Amount < 0);
                if (creditEntry != null)
                {
                    if (string.IsNullOrWhiteSpace(creditEntry.Note)) creditEntry.Note = transaction.Note;
                    if (string.IsNullOrWhiteSpace(creditEntry.ReferenceNumber)) creditEntry.ReferenceNumber = transaction.ReferenceNumber;
                }
            }
            else if (transaction.Type == TransactionType.Transfer)
            {
                // For Transfer: copy transaction note & referenceNumber to Credit entry (Amount < 0, source account)
                var creditEntry = transaction.Entries.FirstOrDefault(e => e.Amount < 0);
                if (creditEntry != null)
                {
                    if (string.IsNullOrWhiteSpace(creditEntry.Note)) creditEntry.Note = transaction.Note;
                    if (string.IsNullOrWhiteSpace(creditEntry.ReferenceNumber)) creditEntry.ReferenceNumber = transaction.ReferenceNumber;
                }
            }
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
