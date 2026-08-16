// Source: Python (Original)
using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace FinanceApp.Models
{
    public class AiParsedData
    {
        [JsonPropertyName("vendor")]
        public AiVendorInfo? Vendor { get; set; }

        [JsonPropertyName("amount")]
        public decimal? Amount { get; set; }

        [JsonPropertyName("transaction_type")]
        public string? TransactionType { get; set; }

        [JsonPropertyName("debit_account_id")]
        public string? DebitAccountId { get; set; }

        [JsonPropertyName("credit_account_id")]
        public string? CreditAccountId { get; set; }

        [JsonPropertyName("suggested_account_creation")]
        public List<SuggestedAccountCreation>? SuggestedAccountCreation { get; set; }

        [JsonPropertyName("notes")]
        public string? Notes { get; set; }

        [JsonPropertyName("summary")]
        public string? Summary { get; set; }

        [JsonPropertyName("confidence")]
        public double? Confidence { get; set; }

        [JsonPropertyName("recipient_account_number")]
        public string? RecipientAccountNumber { get; set; }

        [JsonPropertyName("recipient_account_name")]
        public string? RecipientAccountName { get; set; }

        [JsonPropertyName("sender_account_number")]
        public string? SenderAccountNumber { get; set; }

        [JsonPropertyName("sender_account_name")]
        public string? SenderAccountName { get; set; }

        [JsonPropertyName("reference_number")]
        public string? ReferenceNumber { get; set; }

        [JsonPropertyName("application")]
        public string? Application { get; set; }

        [JsonPropertyName("why")]
        public string? Why { get; set; }

        [JsonPropertyName("is_financial")]
        public bool? IsFinancial { get; set; }

        [JsonPropertyName("user_why")]
        public string? UserWhy { get; set; }

        [JsonPropertyName("is_auto_confirmed")]
        public bool? IsAutoConfirmed { get; set; }

        [JsonPropertyName("ingestion_id")]
        public string? IngestionId { get; set; }

        [JsonPropertyName("date")]
        public DateTime? Date { get; set; }

        [JsonPropertyName("multi_order_items")]
        public List<MultiOrderItem>? MultiOrderItems { get; set; }
    }

    public class MultiOrderItem
    {
        [JsonPropertyName("amount")]
        public decimal Amount { get; set; }

        [JsonPropertyName("reference_number")]
        public string? ReferenceNumber { get; set; }

        [JsonPropertyName("vendor")]
        public AiVendorInfo? Vendor { get; set; }

        [JsonPropertyName("debit_account_id")]
        public string? DebitAccountId { get; set; }

        [JsonPropertyName("notes")]
        public string? Notes { get; set; }
    }

    public class AiVendorInfo
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("type")]
        public string? Type { get; set; }

        [JsonPropertyName("matched")]
        public bool? Matched { get; set; }

        [JsonPropertyName("is_recommendation")]
        public bool? IsRecommendation { get; set; }

        [JsonPropertyName("lookups")]
        public List<string> Lookups { get; set; } = new();

        [JsonPropertyName("new_lookups")]
        public List<string> NewLookups { get; set; } = new();

        [JsonPropertyName("tags")]
        public List<string>? Tags { get; set; }
    }

    public class SuggestedAccountCreation
    {
        [JsonPropertyName("type")]
        public string? Type { get; set; }

        [JsonPropertyName("account_group")]
        public string? AccountGroup { get; set; }

        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("description")]
        public string Description { get; set; } = "";

        [JsonPropertyName("reason")]
        public string Reason { get; set; } = "";
    }
}
