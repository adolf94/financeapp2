using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace FinanceApp.Extensions
{
    public static class FunctionContextExtensions
    {
        private const string ScopeClaimType = "scope";
        private const string ScopePrefix = "api://finance-app-api/";

        public static string? GetUserId(this FunctionContext context)
        {
            if (context.Items.TryGetValue("ArAuthUser", out var userObj) && userObj is ClaimsPrincipal principal)
            {
                return principal.FindFirst("sub")?.Value 
                       ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            }
            return null;
        }

        public static bool HasScope(this FunctionContext context, string scope)
        {
            if (!context.Items.TryGetValue("ArAuthUser", out var userObj) || userObj is not ClaimsPrincipal principal)
            {
                return false;
            }

            var grantedScopes = principal.Claims
                .Where(c => string.Equals(c.Type, ScopeClaimType, StringComparison.OrdinalIgnoreCase))
                .SelectMany(c => (c.Value ?? string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries));

            return grantedScopes.Any(s =>
                string.Equals(s, scope, StringComparison.Ordinal) ||
                string.Equals(s, ScopePrefix + scope, StringComparison.Ordinal));
        }

        public static bool HasAnyScope(this FunctionContext context, params string[] scopes) =>
            scopes.Any(scope => context.HasScope(scope));

        public static IActionResult MissingScopeResult(this FunctionContext context, string scope) => new ObjectResult(new
        {
            error = "insufficient_scope",
            error_description = $"Missing required scope: {scope}"
        })
        {
            StatusCode = StatusCodes.Status403Forbidden
        };
    }
}
