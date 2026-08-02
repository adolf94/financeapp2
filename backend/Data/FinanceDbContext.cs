using Microsoft.EntityFrameworkCore;
using FinanceApp.Models;

namespace FinanceApp.Data
{
    public class FinanceDbContext : DbContext
    {
        public FinanceDbContext(DbContextOptions<FinanceDbContext> options) : base(options) { }

        public DbSet<AccountGroup> AccountGroups { get; set; } = null!;
        public DbSet<Account> Accounts { get; set; } = null!;
        public DbSet<Transaction> Transactions { get; set; } = null!;
        public DbSet<LedgerEntry> LedgerEntries { get; set; } = null!;
        public DbSet<Vendor> Vendors { get; set; } = null!;
        public DbSet<VendorLookup> VendorLookups { get; set; } = null!;
        public DbSet<RecurringTransaction> RecurringTransactions { get; set; } = null!;

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<RecurringTransaction>()
                .ToContainer("RecurringTransactions")
                .HasPartitionKey(x => x.UserId)
                .HasNoDiscriminator();
            modelBuilder.Entity<RecurringTransaction>()
                .Property(x => x.TemplateType)
                .HasConversion<string>();
            modelBuilder.Entity<RecurringTransaction>()
                .OwnsMany(rt => rt.TemplateEntries);
            modelBuilder.Entity<RecurringTransaction>()
                .OwnsMany(rt => rt.Occurrences);

            modelBuilder.Entity<AccountGroup>()
                .ToContainer("AccountGroups")
                .HasPartitionKey(x => x.UserId)
                .HasNoDiscriminator();
            modelBuilder.Entity<AccountGroup>()
                .Property(x => x.AccountType)
                .HasConversion<string>();

            modelBuilder.Entity<Account>()
                .ToContainer("Accounts")
                .HasPartitionKey(x => x.UserId)
                .HasNoDiscriminator();
            modelBuilder.Entity<Account>()
                .Property(x => x.AccountType)
                .HasConversion<string>();

            // Transactions Container - using Discriminator for Transaction and LedgerEntry
            modelBuilder.Entity<Transaction>()
                .ToContainer("Transactions")
                .HasPartitionKey(x => x.UserId);
            modelBuilder.Entity<Transaction>()
                .Property(x => x.Type)
                .HasConversion<string>();
            modelBuilder.Entity<Transaction>()
                .HasMany(t => t.Entries)
                .WithOne(e => e.Transaction)
                .HasForeignKey(e => new { e.TransactionId, e.UserId })
                .HasPrincipalKey(t => new { t.Id, t.UserId });

            modelBuilder.Entity<LedgerEntry>()
                .ToContainer("Transactions")
                .HasPartitionKey(x => x.UserId);

            modelBuilder.Entity<Vendor>()
                .ToContainer("Vendors")
                .HasPartitionKey(x => x.UserId)
                .HasNoDiscriminator();
            modelBuilder.Entity<Vendor>()
                .Property(x => x.Type)
                .HasConversion<string>();

            modelBuilder.Entity<VendorLookup>()
                .ToContainer("VendorLookups")
                .HasPartitionKey(x => x.UserId)
                .HasNoDiscriminator();

        }
    }
}
