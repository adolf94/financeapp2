using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface IVendorService
    {
        Task<IEnumerable<Vendor>> GetVendorsAsync(string userId);
        Task<Vendor?> GetVendorByNameAsync(string userId, string name);
        Task<Vendor> CreateVendorAsync(string userId, string name);
        Task<Vendor> CreateOrUpdateVendorAsync(string userId, Vendor vendor);
        Task<Vendor> UpdateVendorAsync(string userId, Vendor vendor);
        Task DeleteVendorAsync(string userId, string id);
        Task EnsureVendorAndLookupsAsync(string userId, string vendorName, IEnumerable<string> lookups);
        Task<IEnumerable<VendorLookup>> GetLookupsByVendorIdAsync(string userId, string vendorId);
        Task<VendorLookup> AddLookupAsync(string userId, string vendorId, string lookupValue);
        Task DeleteLookupAsync(string userId, string lookupId);
    }
}
