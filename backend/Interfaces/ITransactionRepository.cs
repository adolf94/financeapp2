using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface ITransactionRepository
    {
        Task<IEnumerable<Transaction>> GetTransactionsAsync(string userId, DateTime? startDate, DateTime? endDate, string? accountGroupId = null);
        Task<IEnumerable<Transaction>> GetTransactionsByAccountIdAsync(string userId, string accountId);
        Task<Transaction?> GetTransactionByIdAsync(string userId, string id);
        Task AddTransactionAsync(Transaction transaction);
        Task UpdateTransactionAsync(Transaction transaction, IEnumerable<LedgerEntry> oldEntries);
        Task DeleteTransactionAsync(string userId, string id);
        Task LinkRecurringOccurrenceAsync(string userId, string scheduleId, string transactionId, DateTime date);
        Task SaveChangesAsync();
    }
}
