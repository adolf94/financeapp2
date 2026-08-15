using FinanceApp.Interfaces;
using FinanceApp.Models;
using FinanceApp.Services;
using Moq;
using Xunit;

namespace backend.Tests
{
    public class TransactionServiceTests
    {
        private readonly Mock<ITransactionRepository> _mockTxRepo;
        private readonly Mock<IAccountRepository> _mockAccRepo;
        private readonly Mock<IVendorRepository> _mockVendorRepo;
        private readonly TransactionService _service;

        public TransactionServiceTests()
        {
            _mockTxRepo = new Mock<ITransactionRepository>();
            _mockAccRepo = new Mock<IAccountRepository>();
            _mockVendorRepo = new Mock<IVendorRepository>();
            _service = new TransactionService(_mockTxRepo.Object, _mockAccRepo.Object, _mockVendorRepo.Object);
        }

        [Fact]
        public async Task CreateTransaction_ThrowsArgumentException_IfLessThanTwoEntries()
        {
            var tx = new Transaction
            {
                Entries = new List<LedgerEntry> { new LedgerEntry { AccountId = "acc-1", Amount = 100 } }
            };

            await Assert.ThrowsAsync<ArgumentException>(() => _service.CreateTransactionAsync("user-1", tx));
        }

        [Fact]
        public async Task CreateTransaction_ThrowsInvalidOperationException_IfNotZeroSum()
        {
            var tx = new Transaction
            {
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry { AccountId = "acc-1", Amount = 100 },
                    new LedgerEntry { AccountId = "acc-2", Amount = -50 } // Unbalanced!
                }
            };

            await Assert.ThrowsAsync<InvalidOperationException>(() => _service.CreateTransactionAsync("user-1", tx));
        }

        [Fact]
        public async Task CreateTransaction_AppliesBalanceImpactsAndSaves()
        {
            var acc1 = new Account { Id = "acc-1", CurrentBalance = 500 };
            var acc2 = new Account { Id = "acc-2", CurrentBalance = 100 };

            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-1")).ReturnsAsync(acc1);
            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-2")).ReturnsAsync(acc2);

            var tx = new Transaction
            {
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry { AccountId = "acc-1", Amount = -50 }, // Credit 50
                    new LedgerEntry { AccountId = "acc-2", Amount = 50 }   // Debit 50
                }
            };

            await _service.CreateTransactionAsync("user-1", tx);

            Assert.Equal(450, acc1.CurrentBalance);
            Assert.Equal(150, acc2.CurrentBalance);

            _mockAccRepo.Verify(r => r.UpdateAccountAsync(It.Is<Account>(a => a.Id == "acc-1" && a.CurrentBalance == 450)), Times.Once);
            _mockAccRepo.Verify(r => r.UpdateAccountAsync(It.Is<Account>(a => a.Id == "acc-2" && a.CurrentBalance == 150)), Times.Once);
            _mockTxRepo.Verify(r => r.AddTransactionAsync(tx), Times.Once);
            _mockTxRepo.Verify(r => r.SaveChangesAsync(), Times.Once);
        }

        [Fact]
        public async Task UpdateTransaction_RevertsOldImpactAndAppliesNew()
        {
            var acc1 = new Account { Id = "acc-1", CurrentBalance = 500 };
            var acc2 = new Account { Id = "acc-2", CurrentBalance = 100 };

            var oldTx = new Transaction
            {
                Id = "tx-1",
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry { AccountId = "acc-1", Amount = -50 },
                    new LedgerEntry { AccountId = "acc-2", Amount = 50 }
                }
            };

            var newTx = new Transaction
            {
                Id = "tx-1",
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry { AccountId = "acc-1", Amount = -100 },
                    new LedgerEntry { AccountId = "acc-2", Amount = 100 }
                }
            };

            _mockTxRepo.Setup(r => r.GetTransactionByIdAsync("user-1", "tx-1")).ReturnsAsync(oldTx);
            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-1")).ReturnsAsync(acc1);
            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-2")).ReturnsAsync(acc2);

            await _service.UpdateTransactionAsync("user-1", newTx);

            // Old: acc1=-50, acc2=50 -> Revert: acc1 receives +50 (becomes 550), acc2 receives -50 (becomes 50)
            // New: acc1=-100, acc2=100 -> Apply: acc1 receives -100 (becomes 450), acc2 receives +100 (becomes 150)
            Assert.Equal(450, acc1.CurrentBalance);
            Assert.Equal(150, acc2.CurrentBalance);

            _mockTxRepo.Verify(r => r.UpdateTransactionAsync(oldTx, It.IsAny<IEnumerable<LedgerEntry>>()), Times.Once);
            _mockTxRepo.Verify(r => r.SaveChangesAsync(), Times.Once);
        }

        [Fact]
        public async Task CreateTransaction_CallsLinkRecurringOccurrence_WhenScheduleIdProvided()
        {
            var acc1 = new Account { Id = "acc-1", CurrentBalance = 500 };
            var acc2 = new Account { Id = "acc-2", CurrentBalance = 100 };
            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-1")).ReturnsAsync(acc1);
            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-2")).ReturnsAsync(acc2);

            var txDate = DateTime.UtcNow;
            var tx = new Transaction
            {
                Id = "tx-created-1",
                ScheduleId = "sched-1",
                Date = txDate,
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry { AccountId = "acc-1", Amount = -50 },
                    new LedgerEntry { AccountId = "acc-2", Amount = 50 }
                }
            };

            await _service.CreateTransactionAsync("user-1", tx);

            _mockTxRepo.Verify(r => r.LinkRecurringOccurrenceAsync("user-1", "sched-1", "tx-created-1", txDate), Times.Once);
        }

        [Fact]
        public async Task CreateTransaction_DoesNotCallLinkRecurringOccurrence_WhenScheduleIdEmpty()
        {
            var acc1 = new Account { Id = "acc-1", CurrentBalance = 500 };
            var acc2 = new Account { Id = "acc-2", CurrentBalance = 100 };
            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-1")).ReturnsAsync(acc1);
            _mockAccRepo.Setup(r => r.GetAccountByIdAsync("user-1", "acc-2")).ReturnsAsync(acc2);

            var tx = new Transaction
            {
                Id = "tx-created-2",
                ScheduleId = null,
                Date = DateTime.UtcNow,
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry { AccountId = "acc-1", Amount = -50 },
                    new LedgerEntry { AccountId = "acc-2", Amount = 50 }
                }
            };

            await _service.CreateTransactionAsync("user-1", tx);

            _mockTxRepo.Verify(r => r.LinkRecurringOccurrenceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<DateTime>()), Times.Never);
        }
    }
}
