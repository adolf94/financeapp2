using FinanceApp.Interfaces;
using FinanceApp.Models;

namespace FinanceApp.Services
{
    public class AccountService : IAccountService
    {
        private readonly IAccountRepository _repository;

        public AccountService(IAccountRepository repository)
        {
            _repository = repository;
        }

        public async Task<IEnumerable<Account>> GetAccountsAsync(string userId)
        {
            var accounts = await _repository.GetAccountsAsync(userId);
            foreach (var acc in accounts)
            {
                if (acc.Tags == null)
                {
                    acc.Tags = new List<string>();
                }
            }
            return accounts;
        }

        public async Task<Account?> GetAccountByIdAsync(string userId, string id)
        {
            var account = await _repository.GetAccountByIdAsync(userId, id);
            if (account != null && account.Tags == null)
            {
                account.Tags = new List<string>();
            }
            return account;
        }

        public async Task<Account> CreateAccountAsync(string userId, Account account)
        {
            account.UserId = userId;
            account.CurrentBalance = account.StartingBalance; // Init current balance to starting balance
            account.Tags ??= new List<string>();
            await _repository.AddAccountAsync(account);
            return account;
        }

        public async Task<Account> UpdateAccountAsync(string userId, Account account)
        {
            var existingAccount = await _repository.GetAccountByIdAsync(userId, account.Id);
            if (existingAccount == null)
            {
                throw new KeyNotFoundException("Account not found.");
            }

            // Current balance logic shouldn't be overridden by simple edits;
            // it's adjusted dynamically via transactions.
            // But we can update metadata:
            existingAccount.Name = account.Name;
            existingAccount.Description = account.Description;
            existingAccount.AccountGroupId = account.AccountGroupId;
            existingAccount.AccountType = account.AccountType;
            existingAccount.CreditCardCycleStartDay = account.CreditCardCycleStartDay;
            existingAccount.CreditCardPaymentDueDay = account.CreditCardPaymentDueDay;
            existingAccount.Tags = account.Tags ?? new List<string>();

            await _repository.UpdateAccountAsync(existingAccount);
            return existingAccount;
        }

        public async Task DeleteAccountAsync(string userId, string id)
        {
            await _repository.DeleteAccountAsync(userId, id);
        }

        public async Task<IEnumerable<AccountGroup>> GetAccountGroupsAsync(string userId)
        {
            return await _repository.GetAccountGroupsAsync(userId);
        }

        public async Task<AccountGroup> CreateAccountGroupAsync(string userId, AccountGroup group)
        {
            group.UserId = userId;
            await _repository.AddAccountGroupAsync(group);
            return group;
        }

        public async Task DeleteAccountGroupAsync(string userId, string id)
        {
            await _repository.DeleteAccountGroupAsync(userId, id);
        }
    }
}
