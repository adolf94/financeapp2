using FinanceApp.Models;

namespace FinanceApp.Interfaces
{
    public interface IVendorRepository
    {
        Task<IEnumerable<Vendor>> GetVendorsAsync(string userId);
        Task<Vendor?> GetVendorByNameAsync(string userId, string name);
        Task AddVendorAsync(Vendor vendor);
        Task DeleteVendorAsync(string userId, string id);
        Task EnsureLookupsAsync(string userId, string vendorId, IEnumerable<string> lookups);
    }
}
