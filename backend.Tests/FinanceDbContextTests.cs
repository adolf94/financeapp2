using FinanceApp.Data;
using FinanceApp.Models;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace backend.Tests
{
    public class FinanceDbContextTests
    {
        private DbContextOptions<FinanceDbContext> CreateNewContextOptions()
        {
            return new DbContextOptionsBuilder<FinanceDbContext>()
                .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                .Options;
        }

        [Fact]
        public async Task DbContext_SavesEntitiesWithNullTagsAsEmptySuccessfully()
        {
            // Arrange
            var options = CreateNewContextOptions();

            using var context = new FinanceDbContext(options);

            var account = new Account
            {
                Id = "acc-1",
                UserId = "user-1",
                Name = "Checking",
                AccountType = AccountType.Bank,
                Tags = null // This should now default to empty array internally
            };

            var vendor = new Vendor
            {
                Id = "ven-1",
                UserId = "user-1",
                Name = "MoveIt",
                Type = VendorType.Business,
                Tags = null // This should now default to empty array internally
            };

            var transaction = new Transaction
            {
                Id = "tx-1",
                UserId = "user-1",
                Type = TransactionType.Expense,
                Date = DateTime.UtcNow,
                Vendor = "MoveIt",
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry { AccountId = "acc-1", UserId = "user-1", Amount = -100 },
                    new LedgerEntry { AccountId = "acc-2", UserId = "user-1", Amount = 100 }
                }
            };

            // Act
            context.Accounts.Add(account);
            context.Vendors.Add(vendor);
            context.Transactions.Add(transaction);

            var ex = await Record.ExceptionAsync(async () => await context.SaveChangesAsync());

            // Assert
            Assert.Null(ex); // Ensures no crash occurred

            var savedAccount = await context.Accounts.FindAsync("acc-1");
            Assert.NotNull(savedAccount);
            Assert.Empty(savedAccount.Tags);

            var savedVendor = await context.Vendors.FindAsync("ven-1");
            Assert.NotNull(savedVendor);
            Assert.Empty(savedVendor.Tags);
        }
    }
}
