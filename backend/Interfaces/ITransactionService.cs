using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface ITransactionService
    {
        Task<IEnumerable<Transaction>> GetTransactionsAsync(string userId, DateTime? startDate, DateTime? endDate, string? accountGroupId = null);
        Task<IEnumerable<Transaction>> GetTransactionsByAccountIdAsync(string userId, string accountId);
        Task<Transaction?> GetTransactionByIdAsync(string userId, string id);
        Task<Transaction> CreateTransactionAsync(string userId, Transaction transaction);
        Task<Transaction> UpdateTransactionAsync(string userId, Transaction transaction);
        Task DeleteTransactionAsync(string userId, string id);
        Task<IEnumerable<LedgerEntry>> SearchLedgerEntriesAsync(string userId, string? referenceNumber, decimal? amount, DateTime? aroundDate, int windowMinutes = 5);
    }
}
