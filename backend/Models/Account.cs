// Source: C# (Original)
using System.Text.Json.Serialization;

namespace FinanceApp.Models
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum AccountType
    {
        Cash,
        Bank,
        CreditCard,
        Investment,
        Asset,
        Liability,
        Equity,
        Income,
        Expense,
        Adjustment
    }

    public class Account
    {
        public string Id { get; set; } = Guid.CreateVersion7().ToString();
        public string UserId { get; set; } = string.Empty;
        public string AccountGroupId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        private List<string>? _tags = new();
        public List<string> Tags 
        { 
            get => _tags ??= new(); 
            set => _tags = value ?? new(); 
        }
        public decimal StartingBalance { get; set; }
        public decimal CurrentBalance { get; set; }
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public AccountType AccountType { get; set; }
        public int? CreditCardCycleStartDay { get; set; }
        public int? CreditCardPaymentDueDay { get; set; }
    }
}
