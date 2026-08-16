using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FinanceApp.Interfaces;
using FinanceApp.Models;
using FinanceApp.Services;
using Moq;
using Xunit;

namespace backend.Tests
{
    public class LedgerEntrySearchTests
    {
        private readonly Mock<ITransactionRepository> _mockTxRepo;
        private readonly Mock<IAccountRepository> _mockAccRepo;
        private readonly Mock<IVendorRepository> _mockVendorRepo;
        private readonly TransactionService _service;

        public LedgerEntrySearchTests()
        {
            _mockTxRepo = new Mock<ITransactionRepository>();
            _mockAccRepo = new Mock<IAccountRepository>();
            _mockVendorRepo = new Mock<IVendorRepository>();
            _service = new TransactionService(_mockTxRepo.Object, _mockAccRepo.Object, _mockVendorRepo.Object);
        }

        [Fact]
        public async Task SearchLedgerEntries_CallsRepositoryWithParameters()
        {
            var userId = "user-123";
            var now = DateTime.UtcNow;
            var expectedEntries = new List<LedgerEntry>
            {
                new LedgerEntry { Id = "le-1", UserId = userId, TransactionId = "tx-1", ReferenceNumber = "REF-123" }
            };

            _mockTxRepo.Setup(r => r.SearchLedgerEntriesAsync(userId, "REF-123", 500m, now, 5))
                .ReturnsAsync(expectedEntries);

            var result = await _service.SearchLedgerEntriesAsync(userId, "REF-123", 500m, now, 5);

            Assert.Single(result);
            Assert.Equal("le-1", result.First().Id);
            _mockTxRepo.Verify(r => r.SearchLedgerEntriesAsync(userId, "REF-123", 500m, now, 5), Times.Once);
        }
    }
}

