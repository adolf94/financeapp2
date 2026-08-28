using FinanceApp.Data;
using FinanceApp.Interfaces;
using FinanceApp.Models;
using Microsoft.EntityFrameworkCore;

namespace FinanceApp.Repositories
{
    public class VendorRepository : IVendorRepository
    {
        private readonly FinanceDbContext _context;

        public VendorRepository(FinanceDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Vendor>> GetVendorsAsync(string userId)
        {
            return await _context.Vendors
                .WithPartitionKey(userId)
                .ToListAsync();
        }

        public async Task<Vendor?> GetVendorByNameAsync(string userId, string name)
        {
            var lowerName = name.Trim().ToLower();
            var vendor = await _context.Vendors
                .WithPartitionKey(userId)
                .FirstOrDefaultAsync(v => v.Name.ToLower() == lowerName);

            if (vendor != null && vendor.Tags == null)
            {
                vendor.Tags = new List<string>();
            }
            return vendor;
        }

        public async Task AddVendorAsync(Vendor vendor)
        {
            await _context.Vendors.AddAsync(vendor);
            await _context.SaveChangesAsync();
        }

        public async Task UpdateVendorAsync(string userId, Vendor vendor)
        {
            var existing = await _context.Vendors
                .WithPartitionKey(userId)
                .FirstOrDefaultAsync(v => v.Id == vendor.Id);
            if (existing != null)
            {
                existing.Name = vendor.Name;
                existing.Type = vendor.Type;
                existing.Tags = vendor.Tags;
                existing.LastUsed = vendor.LastUsed;
                await _context.SaveChangesAsync();
            }
        }

        public async Task UpdateVendorLastUsedAsync(string userId, string vendorName, DateTime? lastUsed = null)
        {
            if (string.IsNullOrWhiteSpace(vendorName)) return;
            var vendor = await GetVendorByNameAsync(userId, vendorName);
            if (vendor != null)
            {
                var timestamp = lastUsed ?? DateTime.UtcNow;
                if (vendor.LastUsed == null || timestamp > vendor.LastUsed)
                {
                    vendor.LastUsed = timestamp;
                    await _context.SaveChangesAsync();
                }
            }
        }

        public async Task DeleteVendorAsync(string userId, string id)
        {
            var vendor = await _context.Vendors
                .WithPartitionKey(userId)
                .FirstOrDefaultAsync(v => v.Id == id);

            if (vendor != null)
            {
                var lookups = await _context.VendorLookups
                    .WithPartitionKey(userId)
                    .Where(vl => vl.VendorId == id)
                    .ToListAsync();

                if (lookups.Any())
                {
                    _context.VendorLookups.RemoveRange(lookups);
                }

                _context.Vendors.Remove(vendor);
                await _context.SaveChangesAsync();
            }
        }
        public async Task EnsureLookupsAsync(string userId, string vendorId, IEnumerable<string> lookups)
        {
            if (lookups == null || !lookups.Any()) return;

            var normalizedLookups = lookups
                .Where(l => !string.IsNullOrWhiteSpace(l))
                .Select(l => l.Trim().ToLowerInvariant())
                .Distinct()
                .ToList();

            if (!normalizedLookups.Any()) return;

            var existingEntities = await _context.VendorLookups
                .WithPartitionKey(userId)
                .Where(vl => vl.VendorId == vendorId && normalizedLookups.Contains(vl.LookupValue))
                .ToListAsync();

            foreach (var entity in existingEntities)
            {
                entity.Hits += 1;
                _context.VendorLookups.Update(entity);
            }

            var existingValues = existingEntities.Select(e => e.LookupValue).ToHashSet();
            var newLookups = normalizedLookups.Except(existingValues).ToList();
            if (newLookups.Any())
            {
                var entities = newLookups.Select(l => new VendorLookup
                {
                    UserId = userId,
                    VendorId = vendorId,
                    LookupValue = l,
                    Hits = 1
                });

                await _context.VendorLookups.AddRangeAsync(entities);
            }
            await _context.SaveChangesAsync();
        }

        public async Task<IEnumerable<VendorLookup>> GetLookupsByVendorIdAsync(string userId, string vendorId)
        {
            return await _context.VendorLookups
                .WithPartitionKey(userId)
                .Where(vl => vl.VendorId == vendorId)
                .ToListAsync();
        }

        public async Task<VendorLookup> AddLookupAsync(string userId, string vendorId, string lookupValue)
        {
            var normalized = lookupValue.Trim().ToLowerInvariant();
            var existing = await _context.VendorLookups
                .WithPartitionKey(userId)
                .FirstOrDefaultAsync(vl => vl.VendorId == vendorId && vl.LookupValue == normalized);

            if (existing != null)
            {
                existing.Hits += 1;
                _context.VendorLookups.Update(existing);
                await _context.SaveChangesAsync();
                return existing;
            }

            var newEntity = new VendorLookup
            {
                UserId = userId,
                VendorId = vendorId,
                LookupValue = normalized,
                Hits = 1
            };
            await _context.VendorLookups.AddAsync(newEntity);
            await _context.SaveChangesAsync();
            return newEntity;
        }

        public async Task DeleteLookupAsync(string userId, string lookupId)
        {
            var lookup = await _context.VendorLookups
                .WithPartitionKey(userId)
                .FirstOrDefaultAsync(vl => vl.Id == lookupId);

            if (lookup != null)
            {
                _context.VendorLookups.Remove(lookup);
                await _context.SaveChangesAsync();
            }
        }
    }
}

