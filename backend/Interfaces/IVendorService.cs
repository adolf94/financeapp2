using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface IVendorService
    {
        Task<IEnumerable<Vendor>> GetVendorsAsync(string userId);
        Task<Vendor?> GetVendorByNameAsync(string userId, string name);
        Task<Vendor> CreateVendorAsync(string userId, string name);
        Task DeleteVendorAsync(string userId, string id);
        Task EnsureVendorAndLookupsAsync(string userId, string vendorName, IEnumerable<string> lookups);
    }
}
