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
    public class AccountFunctions
    {
        private readonly IAccountService _accountService;
        private readonly ILogger<AccountFunctions> _logger;

        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            Converters = { new JsonStringEnumConverter() }
        };

        public AccountFunctions(IAccountService accountService, ILogger<AccountFunctions> logger)
        {
            _accountService = accountService;
            _logger = logger;
        }

        [Function("GetAccounts")]
        public async Task<IActionResult> GetAccounts(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accounts")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasAnyScope("user", "accounts:read")) return context.MissingScopeResult("user or accounts:read");
            var accounts = await _accountService.GetAccountsAsync(userId);
            return new OkObjectResult(accounts);
        }

        [Function("GetAccountById")]
        public async Task<IActionResult> GetAccountById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accounts/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasAnyScope("user", "accounts:read")) return context.MissingScopeResult("user or accounts:read");
            var account = await _accountService.GetAccountByIdAsync(userId, id);
            if (account == null)
            {
                return new NotFoundResult();
            }
            return new OkObjectResult(account);
        }

        [Function("CreateAccount")]
        public async Task<IActionResult> CreateAccount(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "accounts")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var account = JsonSerializer.Deserialize<Account>(requestBody, _jsonOptions);

            if (account == null)
            {
                return new BadRequestObjectResult("Invalid account data.");
            }

            var createdAccount = await _accountService.CreateAccountAsync(userId, account);
            return new CreatedResult($"/api/accounts/{createdAccount.Id}", createdAccount);
        }

        [Function("UpdateAccount")]
        public async Task<IActionResult> UpdateAccount(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "accounts/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var account = JsonSerializer.Deserialize<Account>(requestBody, _jsonOptions);

            if (account == null)
            {
                return new BadRequestObjectResult("Invalid account data.");
            }

            account.Id = id;
            try
            {
                var updatedAccount = await _accountService.UpdateAccountAsync(userId, account);
                return new OkObjectResult(updatedAccount);
            }
            catch (KeyNotFoundException)
            {
                return new NotFoundResult();
            }
        }

        [Function("DeleteAccount")]
        public async Task<IActionResult> DeleteAccount(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "accounts/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            await _accountService.DeleteAccountAsync(userId, id);
            return new NoContentResult();
        }

        // Account Groups
        [Function("GetAccountGroups")]
        public async Task<IActionResult> GetAccountGroups(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "account-groups")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasAnyScope("user", "accounts:read")) return context.MissingScopeResult("user or accounts:read");
            var groups = await _accountService.GetAccountGroupsAsync(userId);
            return new OkObjectResult(groups);
        }

        [Function("CreateAccountGroup")]
        public async Task<IActionResult> CreateAccountGroup(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "account-groups")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var groupPayload = JsonSerializer.Deserialize<AccountGroup>(requestBody, _jsonOptions);

            if (groupPayload == null || string.IsNullOrWhiteSpace(groupPayload.Name))
            {
                return new BadRequestObjectResult("Name is required.");
            }

            var group = await _accountService.CreateAccountGroupAsync(userId, groupPayload);
            return new CreatedResult($"/api/account-groups/{group.Id}", group);
        }

        [Function("DeleteAccountGroup")]
        public async Task<IActionResult> DeleteAccountGroup(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "account-groups/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            await _accountService.DeleteAccountGroupAsync(userId, id);
            return new NoContentResult();
        }
        [Function("GenerateAccountDescription")]
        public async Task<IActionResult> GenerateAccountDescription(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "accounts/generate-description")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            if (!context.HasScope("user")) return context.MissingScopeResult("user");
            
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            
            // Proxy the request to python notif-ingester
            var ingesterUrl = Environment.GetEnvironmentVariable("INGESTER_API_URL");
            var ingesterKey = Environment.GetEnvironmentVariable("INGESTER_API_KEY");
            
            if (string.IsNullOrEmpty(ingesterUrl) || string.IsNullOrEmpty(ingesterKey))
            {
                return new StatusCodeResult(500);
            }
            
            using var httpClient = new HttpClient();
            httpClient.DefaultRequestHeaders.Add("x-api-key", ingesterKey);
            httpClient.DefaultRequestHeaders.Add("x-user-id", userId);
            
            var content = new StringContent(requestBody, System.Text.Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync($"{ingesterUrl}/api/accounts/generate-description", content);
            
            if (response.IsSuccessStatusCode)
            {
                var responseContent = await response.Content.ReadAsStringAsync();
                return new ContentResult { Content = responseContent, ContentType = "application/json", StatusCode = 200 };
            }
            
            return new StatusCodeResult((int)response.StatusCode);
        }
    }
}

