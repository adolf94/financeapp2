using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Azure.Cosmos;
using FinanceApp.Data;
using FinanceApp.Interfaces;
using FinanceApp.Repositories;
using FinanceApp.Services;
using Ar.Auth.OpenId;
using Ar.Auth.OpenId.AzureFunctions;
using Microsoft.Extensions.Configuration;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();
var config = builder.Configuration;

builder.Services.AddHttpClient();
builder.Services.AddArAuth(config.GetSection("ArAuth").Get<ArAuthOptions>()!);
builder.UseArAuth();

// Register DbContext with Cosmos DB provider using the ServiceProvider to get IConfiguration
builder.Services.AddDbContext<FinanceDbContext>((provider, options) =>
{
    var configuration = provider.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>();
    var connectionString = configuration["CosmosConnectionString"]
        ?? "AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";
    var databaseName = configuration["CosmosDatabaseName"] ?? "FinanceDb";
    options.UseCosmos(connectionString, databaseName);
});

// Register Repositories
builder.Services.AddScoped<IAccountRepository, AccountRepository>();
builder.Services.AddScoped<ITransactionRepository, TransactionRepository>();
builder.Services.AddScoped<IVendorRepository, VendorRepository>();

// Register Services
builder.Services.AddScoped<IAccountService, AccountService>();
builder.Services.AddScoped<ITransactionService, TransactionService>();
builder.Services.AddScoped<IVendorService, VendorService>();
builder.Services.AddScoped<IRecurringTransactionService, RecurringTransactionService>();

var host = builder.Build();

using (var scope = host.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<FinanceDbContext>();
    await dbContext.Database.EnsureCreatedAsync();
}

host.Run();
