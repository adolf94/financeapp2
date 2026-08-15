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
    public class AdjustmentFunctions
    {
        private readonly IAdjustmentService _adjustmentService;
        private readonly ILogger<AdjustmentFunctions> _logger;

        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            Converters = { new JsonStringEnumConverter() }
        };

        public AdjustmentFunctions(IAdjustmentService adjustmentService, ILogger<AdjustmentFunctions> logger)
        {
            _adjustmentService = adjustmentService;
            _logger = logger;
        }

        [Function("AdjustAccountBalance")]
        public async Task<IActionResult> AdjustAccountBalance(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "accounts/{id}/adjust")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();

            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            if (string.IsNullOrWhiteSpace(requestBody))
            {
                return new BadRequestObjectResult("Request body cannot be empty.");
            }

            try
            {
                var adjustmentRequest = JsonSerializer.Deserialize<AdjustmentRequest>(requestBody, _jsonOptions);
                if (adjustmentRequest == null)
                {
                    return new BadRequestObjectResult("Invalid adjustment data.");
                }

                var transaction = await _adjustmentService.AdjustAccountBalanceAsync(userId, id, adjustmentRequest);
                return new OkObjectResult(transaction);
            }
            catch (KeyNotFoundException ex)
            {
                return new NotFoundObjectResult(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return new BadRequestObjectResult(ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error adjusting balance for account {AccountId}", id);
                return new StatusCodeResult(StatusCodes.Status500InternalServerError);
            }
        }
    }
}
