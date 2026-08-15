using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface IAdjustmentService
    {
        Task<Transaction> AdjustAccountBalanceAsync(string userId, string accountId, AdjustmentRequest request);
    }
}
