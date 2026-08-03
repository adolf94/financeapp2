// Source: C# (Original)
using System.Text.Json.Serialization;
using System.Collections.Generic;

namespace FinanceApp.Models
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum VendorType
    {
        Individual,
        Business,
        Internal
    }

    public class Vendor
    {
        public string Id { get; set; } = Guid.CreateVersion7().ToString();
        public string UserId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public VendorType? Type { get; set; }
        private List<string>? _tags = new();
        public List<string> Tags 
        { 
            get => _tags ??= new(); 
            set => _tags = value ?? new(); 
        }
    }
}
