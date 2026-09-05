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
    public class RecurringTransactionFunctions
    {
        private readonly IRecurringTransactionService _recurringTransactionService;
        private readonly ILogger<RecurringTransactionFunctions> _logger;

        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            Converters = { new JsonStringEnumConverter() }
        };

        public RecurringTransactionFunctions(IRecurringTransactionService recurringTransactionService, ILogger<RecurringTransactionFunctions> logger)
        {
            _recurringTransactionService = recurringTransactionService;
            _logger = logger;
        }

        [Function("GetRecurringTransactions")]
        public async Task<IActionResult> GetRecurringTransactions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "recurring-transactions")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            var transactions = await _recurringTransactionService.GetRecurringTransactionsAsync(userId);
            return new OkObjectResult(transactions);
        }

        [Function("GetRecurringTransactionById")]
        public async Task<IActionResult> GetRecurringTransactionById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "recurring-transactions/{id}")] HttpRequest req, FunctionContext context, string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            var transaction = await _recurringTransactionService.GetRecurringTransactionByIdAsync(userId, id);
            
            if (transaction == null)
                return new NotFoundResult();

            return new OkObjectResult(transaction);
        }

        [Function("CreateRecurringTransaction")]
        public async Task<IActionResult> CreateRecurringTransaction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "recurring-transactions")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            
            try
            {
                var transaction = JsonSerializer.Deserialize<RecurringTransaction>(requestBody, _jsonOptions);
                if (transaction == null) return new BadRequestResult();

                var created = await _recurringTransactionService.CreateRecurringTransactionAsync(userId, transaction);
                return new OkObjectResult(created);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create recurring transaction");
                return new BadRequestObjectResult(ex.Message);
            }
        }

        [Function("UpdateRecurringTransaction")]
        public async Task<IActionResult> UpdateRecurringTransaction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "recurring-transactions/{id}")] HttpRequest req, FunctionContext context, string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            
            try
            {
                var transaction = JsonSerializer.Deserialize<RecurringTransaction>(requestBody, _jsonOptions);
                if (transaction == null || transaction.Id != id) return new BadRequestResult();

                var updated = await _recurringTransactionService.UpdateRecurringTransactionAsync(userId, transaction);
                return new OkObjectResult(updated);
            }
            catch (KeyNotFoundException)
            {
                return new NotFoundResult();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to update recurring transaction");
                return new BadRequestObjectResult(ex.Message);
            }
        }

        [Function("DeleteRecurringTransaction")]
        public async Task<IActionResult> DeleteRecurringTransaction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "recurring-transactions/{id}")] HttpRequest req, FunctionContext context, string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            await _recurringTransactionService.DeleteRecurringTransactionAsync(userId, id);
            return new NoContentResult();
        }

        // Timer Trigger to process due recurring transactions
        [Function("ProcessRecurringTransactionsTimer")]
        public async Task Run([TimerTrigger("0 0 0 * * *")] TimerInfo myTimer) // Runs every day at midnight
        {
            _logger.LogInformation($"C# Timer trigger function executed at: {DateTime.Now}");
            
            if (myTimer.ScheduleStatus is not null)
            {
                _logger.LogInformation($"Next timer schedule at: {myTimer.ScheduleStatus.Next}");
            }

            try
            {
                await _recurringTransactionService.ProcessDueRecurringTransactionsAsync();
                _logger.LogInformation("Successfully processed due recurring transactions.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing recurring transactions in timer trigger.");
            }
        }
    }
}

