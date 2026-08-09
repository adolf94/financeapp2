// Source: C# (Original)
using System.Text.Json.Serialization;

namespace FinanceApp.Models
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum TransactionType
    {
        Income,
        Expense,
        Transfer,
        Journal
    }

    public class Transaction
    {
        public string Id { get; set; } = Guid.CreateVersion7().ToString();
        public string UserId { get; set; } = string.Empty;
        public string? ScheduleId { get; set; }
        public DateTime Date { get; set; }
        public string Note { get; set; } = string.Empty;
        public string? ReferenceNumber { get; set; }
        public string? Vendor { get; set; }
        
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public TransactionType Type { get; set; }
        
        public List<LedgerEntry> Entries { get; set; } = new();
        public bool IsAutoConfirmed { get; set; } = false;
        public string? IngestionId { get; set; }
    }
}
