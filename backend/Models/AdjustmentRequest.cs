using System.Text.Json.Serialization;

namespace FinanceApp.Models
{
    public class AdjustmentRequest
    {
        public decimal ActualBalance { get; set; }
        public DateTime? Date { get; set; }
        public string? Note { get; set; }
    }
}
