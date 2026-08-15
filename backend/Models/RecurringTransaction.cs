// Source: C# (Original)
using System.Text.Json.Serialization;

namespace FinanceApp.Models
{
    public class RecurringTransaction
    {
        public string Id { get; set; } = Guid.CreateVersion7().ToString();
        public string UserId { get; set; } = string.Empty;

        // Scheduling
        public string Frequency { get; set; } = "Monthly"; // Daily, Weekly, Monthly, Yearly
        public int Interval { get; set; } = 1;
        public DateTime StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public int? MaxOccurrences { get; set; }
        public DateTime NextOccurrenceDate { get; set; }
        
        // Transaction Template Fields
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public TransactionType TemplateType { get; set; }
        public string TemplateNote { get; set; } = string.Empty;
        public string? TemplateVendor { get; set; }
        
        // Nested Template Entries
        public List<RecurringLedgerEntry> TemplateEntries { get; set; } = new();

        // Nested Occurrences
        public List<RecurringTransactionOccurrence> Occurrences { get; set; } = new();
    }

    public class RecurringLedgerEntry
    {
        public string AccountId { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string? Comment { get; set; }
    }

    public class RecurringTransactionOccurrence
    {
        public DateTime Date { get; set; }
        public int OccurrenceNo { get; set; }
        public string Status { get; set; } = "Pending"; // Pending, Processed, Skipped, Failed
        public string? TransactionId { get; set; } // Links to the actual Transaction once generated
    }
}
