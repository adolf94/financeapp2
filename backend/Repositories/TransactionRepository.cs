using FinanceApp.Data;
using FinanceApp.Interfaces;
using FinanceApp.Models;
using Microsoft.EntityFrameworkCore;

namespace FinanceApp.Repositories
{
    public class TransactionRepository : ITransactionRepository
    {
        private readonly FinanceDbContext _context;

        public TransactionRepository(FinanceDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Transaction>> GetTransactionsAsync(string userId, DateTime? startDate, DateTime? endDate, string? accountGroupId = null)
        {
            var query = _context.Transactions
                .WithPartitionKey(userId)
                .AsQueryable();

            if (startDate.HasValue)
            {
                query = query.Where(t => t.Date >= startDate.Value);
            }

            if (endDate.HasValue)
            {
                query = query.Where(t => t.Date < endDate.Value);
            }

            if (!string.IsNullOrEmpty(accountGroupId))
            {
                var accountIds = await _context.Accounts
                    .WithPartitionKey(userId)
                    .Where(a => a.AccountGroupId == accountGroupId)
                    .Select(a => a.Id)
                    .ToListAsync();

                if (!accountIds.Any())
                {
                    return new List<Transaction>();
                }

                var ledgerEntriesForGroup = await _context.LedgerEntries
                    .WithPartitionKey(userId)
                    .Where(e => accountIds.Contains(e.AccountId))
                    .ToListAsync();

                if (!ledgerEntriesForGroup.Any())
                {
                    return new List<Transaction>();
                }

                var transactionIds = ledgerEntriesForGroup.Select(e => e.TransactionId).Distinct().ToList();
                query = query.Where(t => transactionIds.Contains(t.Id));
            }

            var transactions = await query.OrderByDescending(t => t.Date).ToListAsync();
            
            var allTxIds = transactions.Select(t => t.Id).ToList();
            if (allTxIds.Any())
            {
                var entries = await _context.LedgerEntries
                    .WithPartitionKey(userId)
                    .Where(e => allTxIds.Contains(e.TransactionId))
                    .ToListAsync();
                    
                foreach (var t in transactions)
                {
                    t.Entries = entries.Where(e => e.TransactionId == t.Id).ToList();
                }
            }

            return transactions;
        }

        public async Task<IEnumerable<Transaction>> GetTransactionsCreatedByAsync(string ownerUserId, string createdBy, DateTime? startDate = null, DateTime? endDate = null)
        {
            var query = _context.Transactions
                .WithPartitionKey(ownerUserId)
                .Where(t => t.CreatedBy == createdBy);

            if (startDate.HasValue)
            {
                query = query.Where(t => t.Date >= startDate.Value);
            }

            if (endDate.HasValue)
            {
                query = query.Where(t => t.Date < endDate.Value);
            }

            var transactions = await query.OrderByDescending(t => t.Date).ToListAsync();

            var allTxIds = transactions.Select(t => t.Id).ToList();
            if (allTxIds.Any())
            {
                var entries = await _context.LedgerEntries
                    .WithPartitionKey(ownerUserId)
                    .Where(e => allTxIds.Contains(e.TransactionId))
                    .ToListAsync();

                foreach (var t in transactions)
                {
                    t.Entries = entries.Where(e => e.TransactionId == t.Id).ToList();
                }
            }

            return transactions;
        }

        public async Task<IEnumerable<Transaction>> GetTransactionsByAccountIdAsync(string userId, string accountId)
        {
            var entries = await _context.LedgerEntries
                .WithPartitionKey(userId)
                .Where(e => e.AccountId == accountId)
                .ToListAsync();

            if (!entries.Any())
                return new List<Transaction>();

            var transactionIds = entries.Select(e => e.TransactionId).Distinct().ToList();

            var transactions = await _context.Transactions
                .WithPartitionKey(userId)
                .Where(t => transactionIds.Contains(t.Id))
                .OrderByDescending(t => t.Date)
                .ToListAsync();

            var allEntriesForTransactions = await _context.LedgerEntries
                .WithPartitionKey(userId)
                .Where(e => transactionIds.Contains(e.TransactionId))
                .ToListAsync();

            foreach (var t in transactions)
            {
                t.Entries = allEntriesForTransactions.Where(e => e.TransactionId == t.Id).ToList();
            }

            return transactions;
        }

        public async Task<Transaction?> GetTransactionByIdAsync(string userId, string id)
        {
            var transaction = await _context.Transactions
                .WithPartitionKey(userId)
                .FirstOrDefaultAsync(t => t.Id == id);
                
            if (transaction != null)
            {
                transaction.Entries = await _context.LedgerEntries
                    .WithPartitionKey(userId)
                    .Where(e => e.TransactionId == id)
                    .ToListAsync();
            }
            
            return transaction;
        }

        public async Task<Transaction?> GetTransactionByCreatorAsync(string createdBy, string id)
        {
            // Cross-partition lookup: transactions created by a client_credentials app
            // live in the target user's partition, keyed by CreatedBy.
            var transaction = await _context.Transactions
                .FirstOrDefaultAsync(t => t.Id == id && t.CreatedBy == createdBy);

            if (transaction != null)
            {
                transaction.Entries = await _context.LedgerEntries
                    .WithPartitionKey(transaction.UserId)
                    .Where(e => e.TransactionId == id)
                    .ToListAsync();
            }

            return transaction;
        }

        public async Task AddTransactionAsync(Transaction transaction)
        {
            await _context.Transactions.AddAsync(transaction);
            // We do not save changes automatically so services can batch it
        }

        public async Task UpdateTransactionAsync(Transaction transaction, IEnumerable<LedgerEntry> oldEntries)
        {
            _context.LedgerEntries.RemoveRange(oldEntries);
            _context.Transactions.Update(transaction);
            await Task.CompletedTask;
        }

        public async Task DeleteTransactionAsync(string userId, string id)
        {
            var transaction = await GetTransactionByIdAsync(userId, id);
            if (transaction != null)
            {
                _context.Transactions.Remove(transaction);
            }
        }

        public async Task LinkRecurringOccurrenceAsync(string userId, string scheduleId, string transactionId, DateTime date)
        {
            try
            {
                var schedule = await _context.RecurringTransactions
                    .FirstOrDefaultAsync(rt => rt.Id == scheduleId && rt.UserId == userId);

                if (schedule != null && !schedule.Occurrences.Any(o => o.TransactionId == transactionId))
                {
                    schedule.Occurrences.Add(new RecurringTransactionOccurrence
                    {
                        Date = date,
                        OccurrenceNo = schedule.Occurrences.Count + 1,
                        Status = "Processed",
                        TransactionId = transactionId
                    });
                    _context.RecurringTransactions.Update(schedule);
                    await _context.SaveChangesAsync();
                }
            }
            catch
            {
                // Fail silently per AC3
            }
        }

        public async Task<IEnumerable<LedgerEntry>> SearchLedgerEntriesAsync(string userId, string? referenceNumber, decimal? amount, DateTime? aroundDate, int windowMinutes = 5)
        {
            if (string.IsNullOrWhiteSpace(referenceNumber) && (!amount.HasValue || !aroundDate.HasValue))
            {
                return Enumerable.Empty<LedgerEntry>();
            }

            var query = _context.LedgerEntries
                .WithPartitionKey(userId)
                .AsQueryable();

            if (!string.IsNullOrWhiteSpace(referenceNumber))
            {
                // Reference number match in last 30 days
                var thirtyDaysAgo = DateTime.UtcNow.AddDays(-30);
                var recentTxIds = await _context.Transactions
                    .WithPartitionKey(userId)
                    .Where(t => t.Date >= thirtyDaysAgo)
                    .Select(t => t.Id)
                    .ToListAsync();

                if (!recentTxIds.Any())
                    return Enumerable.Empty<LedgerEntry>();

                return await query
                    .Where(e => recentTxIds.Contains(e.TransactionId) && e.ReferenceNumber == referenceNumber)
                    .ToListAsync();
            }

            if (amount.HasValue && aroundDate.HasValue)
            {
                var minDate = aroundDate.Value.AddMinutes(-windowMinutes);
                var maxDate = aroundDate.Value.AddMinutes(windowMinutes);

                var targetAbsAmount = Math.Abs(amount.Value);

                var candidateTxIds = await _context.Transactions
                    .WithPartitionKey(userId)
                    .Where(t => t.Date >= minDate && t.Date <= maxDate)
                    .Select(t => t.Id)
                    .ToListAsync();

                if (!candidateTxIds.Any())
                    return Enumerable.Empty<LedgerEntry>();

                var entries = await query
                    .Where(e => candidateTxIds.Contains(e.TransactionId))
                    .ToListAsync();

                return entries.Where(e => Math.Abs(e.Amount) == targetAbsAmount).ToList();
            }

            return Enumerable.Empty<LedgerEntry>();
        }

        public async Task SaveChangesAsync()
        {
            await _context.SaveChangesAsync();
        }
    }
}
