using System.Security.Claims;
using FinanceApp.Functions;
using FinanceApp.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace backend.Tests
{
    public class RecurringTransactionFunctionsTests
    {
        private readonly Mock<IRecurringTransactionService> _mockRecurringTransactionService;
        private readonly Mock<ILogger<RecurringTransactionFunctions>> _mockLogger;
        private readonly RecurringTransactionFunctions _functions;

        public RecurringTransactionFunctionsTests()
        {
            _mockRecurringTransactionService = new Mock<IRecurringTransactionService>();
            _mockLogger = new Mock<ILogger<RecurringTransactionFunctions>>();
            _functions = new RecurringTransactionFunctions(_mockRecurringTransactionService.Object, _mockLogger.Object);
        }

        /// <summary>
        /// Builds a FunctionContext mimicking the ArAuth middleware, which stores the
        /// validated ClaimsPrincipal in FunctionContext.Items under the "ArAuthUser" key.
        /// </summary>
        private static FunctionContext CreateContext(params Claim[] claims)
        {
            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims));
            var items = new Dictionary<object, object> { ["ArAuthUser"] = principal };
            var context = new Mock<FunctionContext>();
            context.SetupGet(c => c.Items).Returns(items);
            return context.Object;
        }

        private static HttpRequest CreateHttpRequest()
        {
            // The job trigger never reads the request body; a default context request is sufficient.
            return new DefaultHttpContext().Request;
        }

        [Fact]
        public async Task RunScheduledTransactionJob_MissingScope_Returns403_AndDoesNotProcess()
        {
            // Arrange — caller authenticated but without the cron:execute scope
            var context = CreateContext(new Claim("scope", "api://finance-app-api/user"));

            // Act
            var result = await _functions.RunScheduledTransactionJob(CreateHttpRequest(), context);

            // Assert
            var objectResult = Assert.IsType<ObjectResult>(result);
            Assert.Equal(StatusCodes.Status403Forbidden, objectResult.StatusCode);

            _mockRecurringTransactionService.Verify(
                s => s.ProcessDueRecurringTransactionsAsync(), Times.Never);
        }

        [Fact]
        public async Task RunScheduledTransactionJob_NoPrincipal_Returns403()
        {
            // Arrange — empty Items (no "ArAuthUser" entry)
            var context = CreateContext();

            // Act
            var result = await _functions.RunScheduledTransactionJob(CreateHttpRequest(), context);

            // Assert
            var objectResult = Assert.IsType<ObjectResult>(result);
            Assert.Equal(StatusCodes.Status403Forbidden, objectResult.StatusCode);

            _mockRecurringTransactionService.Verify(
                s => s.ProcessDueRecurringTransactionsAsync(), Times.Never);
        }

        [Fact]
        public async Task RunScheduledTransactionJob_WithPrefixedScope_Returns200_AndProcesses()
        {
            // Arrange — client_credentials token carrying the fully-qualified scope
            var context = CreateContext(
                new Claim("scope", "api://finance-app-api/cron:execute"),
                new Claim("sub", "third-party-client"));

            // Act
            var result = await _functions.RunScheduledTransactionJob(CreateHttpRequest(), context);

            // Assert
            var okResult = Assert.IsType<OkObjectResult>(result);
            Assert.Equal(StatusCodes.Status200OK, okResult.StatusCode);

            _mockRecurringTransactionService.Verify(
                s => s.ProcessDueRecurringTransactionsAsync(), Times.Once);
        }

        [Fact]
        public async Task RunScheduledTransactionJob_WithBareScope_Returns200_AndProcesses()
        {
            // Arrange — scope claim without the api:// prefix
            var context = CreateContext(new Claim("scope", "cron:execute"));

            // Act
            var result = await _functions.RunScheduledTransactionJob(CreateHttpRequest(), context);

            // Assert
            var okResult = Assert.IsType<OkObjectResult>(result);
            Assert.Equal(StatusCodes.Status200OK, okResult.StatusCode);

            _mockRecurringTransactionService.Verify(
                s => s.ProcessDueRecurringTransactionsAsync(), Times.Once);
        }

        [Fact]
        public async Task RunScheduledTransactionJob_WhenServiceThrows_Returns500()
        {
            // Arrange
            var context = CreateContext(new Claim("scope", "api://finance-app-api/cron:execute"));
            _mockRecurringTransactionService
                .Setup(s => s.ProcessDueRecurringTransactionsAsync())
                .ThrowsAsync(new Exception("Cosmos unavailable"));

            // Act
            var result = await _functions.RunScheduledTransactionJob(CreateHttpRequest(), context);

            // Assert
            var objectResult = Assert.IsType<ObjectResult>(result);
            Assert.Equal(StatusCodes.Status500InternalServerError, objectResult.StatusCode);
        }
    }
}
