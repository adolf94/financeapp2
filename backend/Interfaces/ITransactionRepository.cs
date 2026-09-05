using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface ITransactionRepository
    {
        Task<IEnumerable<Transaction>> GetTransactionsAsync(string userId, DateTime? startDate, DateTime? endDate, string? accountGroupId = null);
        Task<IEnumerable<Transaction>> GetTransactionsByAccountIdAsync(string userId, string accountId);
        Task<IEnumerable<Transaction>> GetTransactionsCreatedByAsync(string ownerUserId, string createdBy, DateTime? startDate = null, DateTime? endDate = null);
        Task<Transaction?> GetTransactionByIdAsync(string userId, string id);
        Task<Transaction?> GetTransactionByCreatorAsync(string createdBy, string id);
        Task AddTransactionAsync(Transaction transaction);
        Task UpdateTransactionAsync(Transaction transaction, IEnumerable<LedgerEntry> oldEntries);
        Task DeleteTransactionAsync(string userId, string id);
        Task LinkRecurringOccurrenceAsync(string userId, string scheduleId, string transactionId, DateTime date);
        Task<IEnumerable<LedgerEntry>> SearchLedgerEntriesAsync(string userId, string? referenceNumber, decimal? amount, DateTime? aroundDate, int windowMinutes = 5);
        Task SaveChangesAsync();
    }
}
