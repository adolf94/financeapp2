using FinanceApp.Data;
using FinanceApp.Interfaces;
using FinanceApp.Models;
using FinanceApp.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace backend.Tests
{
    public class RecurringTransactionServiceTests
    {
        private readonly Mock<ITransactionService> _mockTransactionService;
        private readonly Mock<ILogger<RecurringTransactionService>> _mockLogger;

        public RecurringTransactionServiceTests()
        {
            _mockTransactionService = new Mock<ITransactionService>();
            _mockLogger = new Mock<ILogger<RecurringTransactionService>>();
        }

        private FinanceDbContext GetInMemoryDbContext()
        {
            var options = new DbContextOptionsBuilder<FinanceDbContext>()
                .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                .Options;

            return new FinanceDbContext(options);
        }

        [Fact]
        public async Task ProcessDueRecurringTransactionsAsync_CreatesTransaction_WhenDue()
        {
            // Arrange
            var dbContext = GetInMemoryDbContext();
            var service = new RecurringTransactionService(dbContext, _mockTransactionService.Object, _mockLogger.Object);

            var recurringTx = new RecurringTransaction
            {
                Id = "rt-1",
                UserId = "user-1",
                Frequency = "Monthly",
                Interval = 1,
                StartDate = DateTime.UtcNow.AddMonths(-1),
                NextOccurrenceDate = DateTime.UtcNow.AddDays(-1), // Due!
                TemplateType = TransactionType.Expense,
                TemplateNote = "Netflix",
                TemplateEntries = new List<RecurringLedgerEntry>
                {
                    new RecurringLedgerEntry { AccountId = "acc-1", Amount = -15 },
                    new RecurringLedgerEntry { AccountId = "acc-2", Amount = 15 }
                },
                Occurrences = new List<RecurringTransactionOccurrence>()
            };

            dbContext.RecurringTransactions.Add(recurringTx);
            await dbContext.SaveChangesAsync();

            _mockTransactionService
                .Setup(s => s.CreateTransactionAsync("user-1", It.IsAny<Transaction>()))
                .ReturnsAsync(new Transaction { Id = "new-tx-1" });

            // Act
            await service.ProcessDueRecurringTransactionsAsync();

            // Assert
            var updatedRt = await dbContext.RecurringTransactions.FirstAsync();
            
            // Should have recorded the occurrence
            Assert.Single(updatedRt.Occurrences);
            Assert.Equal("Processed", updatedRt.Occurrences.First().Status);
            Assert.Equal("new-tx-1", updatedRt.Occurrences.First().TransactionId);

            // Should have advanced the next occurrence date (by 1 month)
            Assert.True(updatedRt.NextOccurrenceDate > DateTime.UtcNow);

            // Verify transaction service was called to create it
            _mockTransactionService.Verify(
                s => s.CreateTransactionAsync("user-1", It.Is<Transaction>(t => 
                    t.Note == "Netflix" && 
                    t.Type == TransactionType.Expense &&
                    t.Entries.Count == 2)),
                Times.Once);
        }

        [Fact]
        public async Task ProcessDueRecurringTransactionsAsync_Skips_WhenMaxOccurrencesReached()
        {
            // Arrange
            var dbContext = GetInMemoryDbContext();
            var service = new RecurringTransactionService(dbContext, _mockTransactionService.Object, _mockLogger.Object);

            var recurringTx = new RecurringTransaction
            {
                Id = "rt-2",
                UserId = "user-1",
                Frequency = "Monthly",
                Interval = 1,
                NextOccurrenceDate = DateTime.UtcNow.AddDays(-1), // Due
                MaxOccurrences = 2,
                Occurrences = new List<RecurringTransactionOccurrence>
                {
                    new RecurringTransactionOccurrence { Status = "Processed" },
                    new RecurringTransactionOccurrence { Status = "Processed" }
                }
            };

            dbContext.RecurringTransactions.Add(recurringTx);
            await dbContext.SaveChangesAsync();

            // Act
            await service.ProcessDueRecurringTransactionsAsync();

            // Assert
            _mockTransactionService.Verify(s => s.CreateTransactionAsync(It.IsAny<string>(), It.IsAny<Transaction>()), Times.Never);
        }

        [Fact]
        public async Task ProcessDueRecurringTransactionsAsync_HandlesFailureAndAdvancesDate()
        {
            // Arrange
            var dbContext = GetInMemoryDbContext();
            var service = new RecurringTransactionService(dbContext, _mockTransactionService.Object, _mockLogger.Object);

            var oldNextDate = DateTime.UtcNow.AddDays(-1);
            var recurringTx = new RecurringTransaction
            {
                Id = "rt-3",
                UserId = "user-1",
                Frequency = "Daily",
                Interval = 1,
                NextOccurrenceDate = oldNextDate,
                Occurrences = new List<RecurringTransactionOccurrence>()
            };

            dbContext.RecurringTransactions.Add(recurringTx);
            await dbContext.SaveChangesAsync();

            _mockTransactionService
                .Setup(s => s.CreateTransactionAsync("user-1", It.IsAny<Transaction>()))
                .ThrowsAsync(new Exception("Database error"));

            // Act
            await service.ProcessDueRecurringTransactionsAsync();

            // Assert
            var updatedRt = await dbContext.RecurringTransactions.FirstAsync();
            Assert.Single(updatedRt.Occurrences);
            Assert.Equal("Failed", updatedRt.Occurrences.First().Status);
            
            // Next occurrence date should still be advanced to avoid infinite loop on same day
            Assert.True(updatedRt.NextOccurrenceDate > oldNextDate);
        }

        [Fact]
        public async Task DeleteRecurringTransactionAsync_SoftDeletes_SetsStatusToDeleted()
        {
            // Arrange
            var dbContext = GetInMemoryDbContext();
            var service = new RecurringTransactionService(dbContext, _mockTransactionService.Object, _mockLogger.Object);

            var recurringTx = new RecurringTransaction
            {
                Id = "rt-delete-1",
                UserId = "user-1",
                Status = "Active",
                Frequency = "Monthly",
                Interval = 1,
                StartDate = DateTime.UtcNow
            };

            dbContext.RecurringTransactions.Add(recurringTx);
            await dbContext.SaveChangesAsync();

            // Act
            await service.DeleteRecurringTransactionAsync("user-1", "rt-delete-1");

            // Assert
            var scheduleInDb = await dbContext.RecurringTransactions.FirstOrDefaultAsync(rt => rt.Id == "rt-delete-1");
            Assert.NotNull(scheduleInDb);
            Assert.Equal("Deleted", scheduleInDb.Status);

            // GetRecurringTransactionsAsync should exclude soft-deleted items
            var activeSchedules = await service.GetRecurringTransactionsAsync("user-1");
            Assert.Empty(activeSchedules);

            // GetRecurringTransactionByIdAsync should return null for soft-deleted items
            var singleSchedule = await service.GetRecurringTransactionByIdAsync("user-1", "rt-delete-1");
            Assert.Null(singleSchedule);
        }

        [Fact]
        public async Task ProcessDueRecurringTransactionsAsync_Skips_WhenStatusDeletedOrArchived()
        {
            // Arrange
            var dbContext = GetInMemoryDbContext();
            var service = new RecurringTransactionService(dbContext, _mockTransactionService.Object, _mockLogger.Object);

            var deletedTx = new RecurringTransaction
            {
                Id = "rt-del",
                UserId = "user-1",
                Status = "Deleted",
                Frequency = "Monthly",
                Interval = 1,
                NextOccurrenceDate = DateTime.UtcNow.AddDays(-1),
                Occurrences = new List<RecurringTransactionOccurrence>()
            };

            var archivedTx = new RecurringTransaction
            {
                Id = "rt-arch",
                UserId = "user-1",
                Status = "Archived",
                Frequency = "Monthly",
                Interval = 1,
                NextOccurrenceDate = DateTime.UtcNow.AddDays(-1),
                Occurrences = new List<RecurringTransactionOccurrence>()
            };

            dbContext.RecurringTransactions.AddRange(deletedTx, archivedTx);
            await dbContext.SaveChangesAsync();

            // Act
            await service.ProcessDueRecurringTransactionsAsync();

            // Assert
            _mockTransactionService.Verify(s => s.CreateTransactionAsync(It.IsAny<string>(), It.IsAny<Transaction>()), Times.Never);
        }
    }
}
