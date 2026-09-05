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
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            
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

        [Function("GetTransactionsByCreator")]
        public async Task<IActionResult> GetTransactionsByCreator(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "transactions/owner/{userId}")] HttpRequest req, FunctionContext context,
            string userId)
        {
            string? callerId = context.GetUserId();
            if (string.IsNullOrEmpty(callerId)) return new UnauthorizedResult();
            if (!context.HasScope("transactions:read:self")) return context.MissingScopeResult("transactions:read:self");

            DateTime? startDate = null;
            DateTime? endDate = null;
            if (DateTime.TryParse(req.Query["startDate"], out var parsedStart)) startDate = parsedStart;
            if (DateTime.TryParse(req.Query["endDate"], out var parsedEnd)) endDate = parsedEnd;

            // Returns only transactions the caller created for the given owner:
            // UserId == {userId} (partition) AND CreatedBy == {sub}.
            var transactions = await _transactionService.GetTransactionsCreatedByAsync(userId, callerId, startDate, endDate);
            return new OkObjectResult(transactions);
        }

        [Function("GetTransactionById")]
        public async Task<IActionResult> GetTransactionById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "transactions/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasAnyScope("user", "transactions:read:self")) return context.MissingScopeResult("user or transactions:read:self");

            // 'user' scope reads its own transactions; a pure 'transactions:read:self' caller
            // (client_credentials) can only read transactions it created (CreatedBy = sub).
            var transaction = context.HasScope("user")
                ? await _transactionService.GetTransactionByIdAsync(userId, id)
                : await _transactionService.GetTransactionByCreatorAsync(userId, id);
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
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            var transactions = await _transactionService.GetTransactionsByAccountIdAsync(userId, accountId);
            return new OkObjectResult(transactions);
        }

        [Function("CreateTransaction")]
        public async Task<IActionResult> CreateTransaction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "transactions")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasAnyScope("user", "transactions:create")) return context.MissingScopeResult("user or transactions:create");
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var transaction = JsonSerializer.Deserialize<Transaction>(requestBody, _jsonOptions);

            if (transaction == null)
            {
                return new BadRequestObjectResult("Invalid transaction data.");
            }

            // 'user' scope always acts as itself; a 'transactions:create'-only caller
            // must supply the target userId explicitly. CreatedBy is always the caller's sub.
            if (context.HasScope("user"))
            {
                transaction.UserId = userId;
            }
            else if (string.IsNullOrWhiteSpace(transaction.UserId))
            {
                return new BadRequestObjectResult("userId is required when the caller does not have the 'user' scope.");
            }
            transaction.CreatedBy = userId;

            try
            {
                var createdTx = await _transactionService.CreateTransactionAsync(transaction.UserId, transaction);
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
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
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
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
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
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var aiData = JsonSerializer.Deserialize<AiParsedData>(requestBody, _jsonOptions);

            if (aiData == null || !aiData.Amount.HasValue || string.IsNullOrEmpty(aiData.DebitAccountId) || string.IsNullOrEmpty(aiData.CreditAccountId))
            {
                return new BadRequestObjectResult("Invalid ingestion data. Amount, DebitAccountId, and CreditAccountId are required.");
            }

            var entries = new List<LedgerEntry>();
            var txType = Enum.TryParse<TransactionType>(aiData.TransactionType, true, out var typeEnum) ? typeEnum : TransactionType.Expense;

            // 1. Credit Entry for total amount
            entries.Add(new LedgerEntry
            {
                Id = Guid.CreateVersion7().ToString(),
                UserId = userId,
                AccountId = aiData.CreditAccountId,
                Amount = -aiData.Amount.Value, // Negative for credit
                Note = ("Income".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase) || "Transfer".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase)) ? aiData.Notes : null,
                ReferenceNumber = ("Income".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase) || "Transfer".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase)) ? aiData.ReferenceNumber : null
            });

            // 2. Debit Entries (multi-order N entries or standard single entry)
            if (aiData.MultiOrderItems != null && aiData.MultiOrderItems.Count > 1)
            {
                foreach (var order in aiData.MultiOrderItems)
                {
                    var orderAcc = !string.IsNullOrWhiteSpace(order.DebitAccountId) ? order.DebitAccountId : aiData.DebitAccountId;
                    var orderRef = !string.IsNullOrWhiteSpace(order.ReferenceNumber) ? order.ReferenceNumber : aiData.ReferenceNumber;
                    var orderNote = !string.IsNullOrWhiteSpace(order.Notes) ? order.Notes : (order.Vendor?.Name ?? aiData.Notes);
                    entries.Add(new LedgerEntry
                    {
                        Id = Guid.CreateVersion7().ToString(),
                        UserId = userId,
                        AccountId = orderAcc,
                        Amount = order.Amount,
                        Note = orderNote,
                        ReferenceNumber = orderRef
                    });
                }
            }
            else
            {
                entries.Add(new LedgerEntry
                {
                    Id = Guid.CreateVersion7().ToString(),
                    UserId = userId,
                    AccountId = aiData.DebitAccountId,
                    Amount = aiData.Amount.Value, // Positive for debit
                    Note = (!"Income".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase) && !"Transfer".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase)) ? aiData.Notes : null,
                    ReferenceNumber = (!"Income".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase) && !"Transfer".Equals(aiData.TransactionType, StringComparison.OrdinalIgnoreCase)) ? aiData.ReferenceNumber : null
                });
            }

            var transaction = new Transaction
            {
                Id = Guid.CreateVersion7().ToString(),
                UserId = userId,
                CreatedBy = userId,
                Date = aiData.Date ?? DateTime.UtcNow,
                Vendor = aiData.Vendor?.Name,
                Type = txType,
                Note = aiData.Notes ?? string.Empty,
                ReferenceNumber = aiData.ReferenceNumber,
                Entries = entries,
                IsAutoConfirmed = aiData.IsAutoConfirmed ?? false,
                IngestionId = aiData.IngestionId,
                MergedIngestionIds = aiData.MergedIngestionIds ?? new List<string>(),
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

        [Function("SearchLedgerEntries")]
        public async Task<IActionResult> SearchLedgerEntries(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "ledger-entries/search")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");

            string? referenceNumber = req.Query["referenceNumber"];
            decimal? amount = null;
            if (decimal.TryParse(req.Query["amount"], out var parsedAmount))
            {
                amount = parsedAmount;
            }

            DateTime? around = null;
            if (DateTime.TryParse(req.Query["around"], out var parsedAround))
            {
                around = parsedAround;
            }

            int windowMinutes = 5;
            if (int.TryParse(req.Query["windowMinutes"], out var parsedWindow))
            {
                windowMinutes = parsedWindow;
            }

            var entries = await _transactionService.SearchLedgerEntriesAsync(userId, referenceNumber, amount, around, windowMinutes);
            return new OkObjectResult(entries);
        }
    }
}
