// Source: p/models/transaction_vector.py
using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace FinanceApp.Models
{
    public class TransactionVector
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("UserId")]
        public string UserId { get; set; } = "default";

        [JsonPropertyName("transaction_id")]
        public string TransactionId { get; set; } = string.Empty;

        [JsonPropertyName("vendor")]
        public string Vendor { get; set; } = string.Empty;

        [JsonPropertyName("category")]
        public string Category { get; set; } = string.Empty;

        [JsonPropertyName("summary")]
        public string Summary { get; set; } = string.Empty;

        [JsonPropertyName("debit_account_id")]
        public string DebitAccountId { get; set; } = string.Empty;

        [JsonPropertyName("credit_account_id")]
        public string CreditAccountId { get; set; } = string.Empty;

        [JsonPropertyName("debit_account_name")]
        public string DebitAccountName { get; set; } = string.Empty;

        [JsonPropertyName("credit_account_name")]
        public string CreditAccountName { get; set; } = string.Empty;

        [JsonPropertyName("embed_text")]
        public string EmbedText { get; set; } = string.Empty;

        [JsonPropertyName("raw_msg_summary")]
        public string RawMsgSummary { get; set; } = string.Empty;

        [JsonPropertyName("embedding")]
        public List<float> Embedding { get; set; } = new();

        [JsonPropertyName("confirmed_at")]
        public DateTime ConfirmedAt { get; set; } = DateTime.UtcNow;

        [JsonPropertyName("partition_key")]
        public string PartitionKey { get; set; } = "default";
    }
}
