using FinanceApp.Interfaces;
using FinanceApp.Models;

namespace FinanceApp.Services
{
    public class VendorService : IVendorService
    {
        private readonly IVendorRepository _repository;

        public VendorService(IVendorRepository repository)
        {
            _repository = repository;
        }

        public async Task<IEnumerable<Vendor>> GetVendorsAsync(string userId)
        {
            var vendors = await _repository.GetVendorsAsync(userId);
            foreach (var v in vendors)
            {
                if (v.Tags == null)
                {
                    v.Tags = new List<string>();
                }
            }
            return vendors;
        }

        public async Task<Vendor?> GetVendorByNameAsync(string userId, string name)
        {
            return await _repository.GetVendorByNameAsync(userId, name);
        }

        public async Task<Vendor> CreateVendorAsync(string userId, string name)
        {
            var existing = await GetVendorByNameAsync(userId, name);
            if (existing != null)
            {
                return existing;
            }

            var vendor = new Vendor
            {
                UserId = userId,
                Name = name.Trim(),
                Tags = new List<string>()
            };
            await _repository.AddVendorAsync(vendor);
            return vendor;
        }

        public async Task DeleteVendorAsync(string userId, string id)
        {
            await _repository.DeleteVendorAsync(userId, id);
        }

        public async Task EnsureVendorAndLookupsAsync(string userId, string vendorName, IEnumerable<string> lookups)
        {
            if (string.IsNullOrWhiteSpace(vendorName))
                return;

            var vendor = await CreateVendorAsync(userId, vendorName);
            await _repository.EnsureLookupsAsync(userId, vendor.Id, lookups);
        }
    }
}
