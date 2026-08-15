// Source: C# (Original)
using System.Text.Json.Serialization;

namespace FinanceApp.Models
{
    public class LedgerEntry
    {
        public string Id { get; set; } = Guid.CreateVersion7().ToString();
        public string UserId { get; set; } = string.Empty;
        public string TransactionId { get; set; } = string.Empty;
        public string AccountId { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string? Note { get; set; } = "";
        public string? ReferenceNumber { get; set; }

        [JsonIgnore]
        public Transaction? Transaction { get; set; }
    }
}
