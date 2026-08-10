using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using FinanceApp.Interfaces;
using FinanceApp.Models;
using System.Text.Json;
using FinanceApp.Extensions;
using System.Text.Json.Serialization;

namespace FinanceApp.Functions
{
    public class TransactionFunctions
    {
        private readonly ITransactionService _transactionService;
        private readonly IVendorService _vendorService;
        private readonly ILogger<TransactionFunctions> _logger;

        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            Converters = { new JsonStringEnumConverter() }
        };

        public TransactionFunctions(ITransactionService transactionService, IVendorService vendorService, ILogger<TransactionFunctions> logger)
        {
            _transactionService = transactionService;
            _vendorService = vendorService;
            _logger = logger;
        }

        [Function("GetTransactions")]
        public async Task<IActionResult> GetTransactions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "transactions")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            
            DateTime? startDate = null;
            DateTime? endDate = null;

            if (DateTime.TryParse(req.Query["startDate"], out var parsedStart))
            {
                startDate = parsedStart;
            }
            if (DateTime.TryParse(req.Query["endDate"], out var parsedEnd))
            {
                endDate = parsedEnd;
            }

            string? accountGroupId = req.Query["accountGroupId"];

            var transactions = await _transactionService.GetTransactionsAsync(userId, startDate, endDate, accountGroupId);
            return new OkObjectResult(transactions);
        }

        [Function("GetTransactionById")]
        public async Task<IActionResult> GetTransactionById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "transactions/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            var transaction = await _transactionService.GetTransactionByIdAsync(userId, id);
            if (transaction == null)
            {
                return new NotFoundResult();
            }
            return new OkObjectResult(transaction);
        }

        [Function("GetTransactionsByAccountId")]
        public async Task<IActionResult> GetTransactionsByAccountId(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accounts/{accountId}/transactions")] HttpRequest req, FunctionContext context,
            string accountId)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            var transactions = await _transactionService.GetTransactionsByAccountIdAsync(userId, accountId);
            return new OkObjectResult(transactions);
        }

        [Function("CreateTransaction")]
        public async Task<IActionResult> CreateTransaction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "transactions")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var transaction = JsonSerializer.Deserialize<Transaction>(requestBody, _jsonOptions);

            if (transaction == null)
            {
                return new BadRequestObjectResult("Invalid transaction data.");
            }

            try
            {
                var createdTx = await _transactionService.CreateTransactionAsync(userId, transaction);
                return new CreatedResult($"/api/transactions/{createdTx.Id}", createdTx);
            }
            catch (KeyNotFoundException ex)
            {
                return new NotFoundObjectResult(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return new BadRequestObjectResult(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return new BadRequestObjectResult(ex.Message);
            }
        }

        [Function("UpdateTransaction")]
        public async Task<IActionResult> UpdateTransaction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "transactions/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var transaction = JsonSerializer.Deserialize<Transaction>(requestBody, _jsonOptions);

            if (transaction == null)
            {
                return new BadRequestObjectResult("Invalid transaction data.");
            }

            transaction.Id = id;
            try
            {
                var updatedTx = await _transactionService.UpdateTransactionAsync(userId, transaction);
                return new OkObjectResult(updatedTx);
            }
            catch (KeyNotFoundException ex)
            {
                return new NotFoundObjectResult(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return new BadRequestObjectResult(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return new BadRequestObjectResult(ex.Message);
            }
        }

        [Function("DeleteTransaction")]
        public async Task<IActionResult> DeleteTransaction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "transactions/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            try
            {
                await _transactionService.DeleteTransactionAsync(userId, id);
                return new NoContentResult();
            }
            catch (KeyNotFoundException ex)
            {
                return new NotFoundObjectResult(ex.Message);
            }
        }
        [Function("CreateTransactionFromIngestion")]
        public async Task<IActionResult> CreateTransactionFromIngestion(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "transactions/from-ingestion")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var aiData = JsonSerializer.Deserialize<AiParsedData>(requestBody, _jsonOptions);

            if (aiData == null || !aiData.Amount.HasValue || string.IsNullOrEmpty(aiData.DebitAccountId) || string.IsNullOrEmpty(aiData.CreditAccountId))
            {
                return new BadRequestObjectResult("Invalid ingestion data. Amount, DebitAccountId, and CreditAccountId are required.");
            }

            var transaction = new Transaction
            {
                Id = Guid.CreateVersion7().ToString(),
                UserId = userId,
                Date = aiData.Date ?? DateTime.UtcNow,
                Vendor = aiData.Vendor?.Name,
                Type = Enum.TryParse<TransactionType>(aiData.TransactionType, true, out var typeEnum) ? typeEnum : TransactionType.Expense,
                Note = aiData.Notes,
                Entries = new List<LedgerEntry>
                {
                    new LedgerEntry
                    {
                        Id = Guid.CreateVersion7().ToString(),
                        UserId = userId,
                        AccountId = aiData.DebitAccountId,
                        Amount = aiData.Amount.Value // Positive for debit
                    },
                    new LedgerEntry
                    {
                        Id = Guid.CreateVersion7().ToString(),
                        UserId = userId,
                        AccountId = aiData.CreditAccountId,
                        Amount = -aiData.Amount.Value // Negative for credit
                    }
                },
                IsAutoConfirmed = aiData.IsAutoConfirmed ?? false,
                IngestionId = aiData.IngestionId,
                MatchedVendorLookups = (aiData.Vendor?.Lookups ?? new List<string>())
                    .Concat(aiData.Vendor?.NewLookups ?? new List<string>())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList(),
                NewVendorLookups = new List<string>()
            };

            try
            {
                var createdTx = await _transactionService.CreateTransactionAsync(userId, transaction);

                var lookups = new List<string>();
                if (!string.IsNullOrWhiteSpace(aiData.RecipientAccountName)) lookups.Add(aiData.RecipientAccountName);
                if (!string.IsNullOrWhiteSpace(aiData.RecipientAccountNumber)) lookups.Add(aiData.RecipientAccountNumber);
                if (!string.IsNullOrWhiteSpace(aiData.SenderAccountName)) lookups.Add(aiData.SenderAccountName);
                if (!string.IsNullOrWhiteSpace(aiData.SenderAccountNumber)) lookups.Add(aiData.SenderAccountNumber);
                if (aiData.Vendor != null && !string.IsNullOrWhiteSpace(aiData.Vendor.Name)) lookups.Add(aiData.Vendor.Name);
                if (!string.IsNullOrWhiteSpace(aiData.Application)) lookups.Add(aiData.Application);

                // Add all confirm-payload lookups to the upsert list
                if (transaction.MatchedVendorLookups != null)
                {
                    lookups.AddRange(transaction.MatchedVendorLookups);
                }

                if (aiData.Vendor != null && !string.IsNullOrWhiteSpace(aiData.Vendor.Name))
                {
                    await _vendorService.EnsureVendorAndLookupsAsync(userId, aiData.Vendor.Name, lookups.Distinct(StringComparer.OrdinalIgnoreCase).ToList());
                }

                return new OkObjectResult(createdTx);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating transaction from ingestion");
                return new BadRequestObjectResult(ex.Message);
            }
        }
    }
}
