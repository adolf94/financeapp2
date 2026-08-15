using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface IRecurringTransactionService
    {
        Task<IEnumerable<RecurringTransaction>> GetRecurringTransactionsAsync(string userId);
        Task<RecurringTransaction?> GetRecurringTransactionByIdAsync(string userId, string id);
        Task<RecurringTransaction> CreateRecurringTransactionAsync(string userId, RecurringTransaction transaction);
        Task<RecurringTransaction> UpdateRecurringTransactionAsync(string userId, RecurringTransaction transaction);
        Task DeleteRecurringTransactionAsync(string userId, string id);
        Task ProcessDueRecurringTransactionsAsync();
        Task AddOccurrenceAsync(string scheduleId, string transactionId, DateTime date);
    }
}
