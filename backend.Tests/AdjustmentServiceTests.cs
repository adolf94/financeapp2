using FinanceApp.Interfaces;
using FinanceApp.Models;
using FinanceApp.Services;
using Moq;
using Xunit;

namespace backend.Tests
{
    public class AdjustmentServiceTests
    {
        private readonly Mock<IAccountRepository> _mockAccountRepo;
        private readonly Mock<ITransactionService> _mockTransactionService;
        private readonly AdjustmentService _service;

        public AdjustmentServiceTests()
        {
            _mockAccountRepo = new Mock<IAccountRepository>();
            _mockTransactionService = new Mock<ITransactionService>();
            _service = new AdjustmentService(_mockAccountRepo.Object, _mockTransactionService.Object);
        }

        [Fact]
        public async Task AdjustAccountBalance_ThrowsKeyNotFoundException_WhenAccountDoesNotExist()
        {
            _mockAccountRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-missing"))
                .ReturnsAsync((Account?)null);

            var req = new AdjustmentRequest { ActualBalance = 1000m };

            await Assert.ThrowsAsync<KeyNotFoundException>(() =>
                _service.AdjustAccountBalanceAsync("user-1", "acc-missing", req));
        }

        [Fact]
        public async Task AdjustAccountBalance_ThrowsInvalidOperationException_WhenDeltaIsZero()
        {
            var targetAccount = new Account
            {
                Id = "acc-1",
                UserId = "user-1",
                CurrentBalance = 500m
            };

            _mockAccountRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-1"))
                .ReturnsAsync(targetAccount);

            var req = new AdjustmentRequest { ActualBalance = 500m };

            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                _service.AdjustAccountBalanceAsync("user-1", "acc-1", req));
        }

        [Fact]
        public async Task AdjustAccountBalance_AutoCreatesAdjustmentGroupAndAccount_WhenMissing()
        {
            var targetAccount = new Account
            {
                Id = "acc-1",
                UserId = "user-1",
                CurrentBalance = 400m
            };

            _mockAccountRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-1"))
                .ReturnsAsync(targetAccount);

            _mockAccountRepo.Setup(r => r.GetAccountGroupsAsync("user-1"))
                .ReturnsAsync(new List<AccountGroup>());

            _mockAccountRepo.Setup(r => r.GetAccountsAsync("user-1"))
                .ReturnsAsync(new List<Account>());

            Transaction? createdTx = null;
            _mockTransactionService.Setup(s => s.CreateTransactionAsync("user-1", It.IsAny<Transaction>()))
                .Callback<string, Transaction>((u, tx) => createdTx = tx)
                .ReturnsAsync((string u, Transaction tx) => tx);

            var req = new AdjustmentRequest
            {
                ActualBalance = 500m,
                Note = "Reconcile mismatch"
            };

            var result = await _service.AdjustAccountBalanceAsync("user-1", "acc-1", req);

            _mockAccountRepo.Verify(r => r.AddAccountGroupAsync(It.Is<AccountGroup>(g =>
                g.Name == "Adjustments" && g.AccountType == AccountType.Adjustment)), Times.Once);

            _mockAccountRepo.Verify(r => r.AddAccountAsync(It.Is<Account>(a =>
                a.Name == "Balance Adjustments" && a.AccountType == AccountType.Adjustment)), Times.Once);

            Assert.NotNull(result);
            Assert.Equal(TransactionType.Journal, result.Type);
            Assert.Equal("Reconcile mismatch", result.Note);
            Assert.Equal(2, result.Entries.Count);

            var targetEntry = result.Entries.First(e => e.AccountId == "acc-1");
            Assert.Equal(100m, targetEntry.Amount);

            var adjEntry = result.Entries.First(e => e.AccountId != "acc-1");
            Assert.Equal(-100m, adjEntry.Amount);
        }

        [Fact]
        public async Task AdjustAccountBalance_CreatesNegativeDeltaLeg_WhenActualIsLower()
        {
            var targetAccount = new Account
            {
                Id = "acc-1",
                UserId = "user-1",
                CurrentBalance = 1000m
            };

            var existingGroup = new AccountGroup
            {
                Id = "grp-adj",
                UserId = "user-1",
                Name = "Adjustments",
                AccountType = AccountType.Adjustment
            };

            var existingAdjAcc = new Account
            {
                Id = "acc-adj",
                UserId = "user-1",
                AccountGroupId = "grp-adj",
                Name = "Balance Adjustments",
                AccountType = AccountType.Adjustment
            };

            _mockAccountRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-1"))
                .ReturnsAsync(targetAccount);

            _mockAccountRepo.Setup(r => r.GetAccountGroupsAsync("user-1"))
                .ReturnsAsync(new List<AccountGroup> { existingGroup });

            _mockAccountRepo.Setup(r => r.GetAccountsAsync("user-1"))
                .ReturnsAsync(new List<Account> { existingAdjAcc });

            _mockTransactionService.Setup(s => s.CreateTransactionAsync("user-1", It.IsAny<Transaction>()))
                .ReturnsAsync((string u, Transaction tx) => tx);

            var req = new AdjustmentRequest
            {
                ActualBalance = 850m
            };

            var result = await _service.AdjustAccountBalanceAsync("user-1", "acc-1", req);

            _mockAccountRepo.Verify(r => r.AddAccountGroupAsync(It.IsAny<AccountGroup>()), Times.Never);
            _mockAccountRepo.Verify(r => r.AddAccountAsync(It.IsAny<Account>()), Times.Never);

            Assert.NotNull(result);
            Assert.Equal("Balance adjustment", result.Note);

            var targetEntry = result.Entries.First(e => e.AccountId == "acc-1");
            Assert.Equal(-150m, targetEntry.Amount);

            var adjEntry = result.Entries.First(e => e.AccountId == "acc-adj");
            Assert.Equal(150m, adjEntry.Amount);
        }
    }
}
