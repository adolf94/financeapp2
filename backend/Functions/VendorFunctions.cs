using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using FinanceApp.Interfaces;
using FinanceApp.Models;
using System.Text.Json;
using FinanceApp.Extensions;

namespace FinanceApp.Functions
{
    public class VendorFunctions
    {
        private readonly IVendorService _vendorService;
        private readonly ILogger<VendorFunctions> _logger;

        private static readonly JsonSerializerOptions _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };

        public VendorFunctions(IVendorService vendorService, ILogger<VendorFunctions> logger)
        {
            _vendorService = vendorService;
            _logger = logger;
        }

        [Function("GetVendors")]
        public async Task<IActionResult> GetVendors(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "vendors")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            var vendors = await _vendorService.GetVendorsAsync(userId);
            return new OkObjectResult(vendors);
        }

        [Function("CreateVendor")]
        public async Task<IActionResult> CreateVendor(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "vendors")] HttpRequest req, FunctionContext context)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            using var doc = JsonDocument.Parse(requestBody);
            
            if (!doc.RootElement.TryGetProperty("name", out var nameProp) || string.IsNullOrWhiteSpace(nameProp.GetString()))
            {
                return new BadRequestObjectResult("Vendor name is required.");
            }

            VendorType? type = null;
            if (doc.RootElement.TryGetProperty("type", out var typeProp) && typeProp.ValueKind == JsonValueKind.String)
            {
                type = Enum.TryParse<VendorType>(typeProp.GetString(), ignoreCase: true, out var parsedType) ? parsedType : null;
            }

            List<string> tags = new();
            if (doc.RootElement.TryGetProperty("tags", out var tagsProp) && tagsProp.ValueKind == JsonValueKind.Array)
            {
                tags = tagsProp.EnumerateArray()
                    .Select(t => t.GetString()?.Trim())
                    .Where(t => !string.IsNullOrWhiteSpace(t))
                    .Cast<string>()
                    .ToList();
            }

            var vendor = new Models.Vendor
            {
                UserId = userId,
                Name = nameProp.GetString()!.Trim(),
                Type = type,
                Tags = tags.Any() ? tags : new List<string>()
            };

            var createdVendor = await _vendorService.CreateOrUpdateVendorAsync(userId, vendor);
            return new CreatedResult($"/api/vendors/{createdVendor.Id}", createdVendor);
        }

        [Function("UpdateVendor")]
        public async Task<IActionResult> UpdateVendor(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "vendors/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            
            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var vendor = JsonSerializer.Deserialize<Models.Vendor>(requestBody, _jsonOptions);
            
            if (vendor == null || string.IsNullOrWhiteSpace(vendor.Name))
            {
                return new BadRequestObjectResult("Invalid vendor data.");
            }

            if (string.IsNullOrEmpty(vendor.Id))
            {
                vendor.Id = id;
            }

            if (!vendor.Type.HasValue)
            {
                vendor.Type = VendorType.Business;
            }

            var updatedVendor = await _vendorService.UpdateVendorAsync(userId, vendor);
            return new OkObjectResult(updatedVendor);
        }

        [Function("DeleteVendor")]
        public async Task<IActionResult> DeleteVendor(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "vendors/{id}")] HttpRequest req, FunctionContext context,
            string id)
        {
            string? userId = context.GetUserId();
            if (string.IsNullOrEmpty(userId)) return new UnauthorizedResult();
            await _vendorService.DeleteVendorAsync(userId, id);
            return new NoContentResult();
        }
    }
}

