using FinanceApp.Data;
using FinanceApp.Interfaces;
using FinanceApp.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FinanceApp.Services
{
    public class RecurringTransactionService : IRecurringTransactionService
    {
        private readonly FinanceDbContext _context;
        private readonly ITransactionService _transactionService;
        private readonly ILogger<RecurringTransactionService> _logger;

        public RecurringTransactionService(
            FinanceDbContext context,
            ITransactionService transactionService,
            ILogger<RecurringTransactionService> logger)
        {
            _context = context;
            _transactionService = transactionService;
            _logger = logger;
        }

        public async Task<IEnumerable<RecurringTransaction>> GetRecurringTransactionsAsync(string userId)
        {
            return await _context.RecurringTransactions
                .Where(rt => rt.UserId == userId)
                .ToListAsync();
        }

        public async Task<RecurringTransaction?> GetRecurringTransactionByIdAsync(string userId, string id)
        {
            return await _context.RecurringTransactions
                .FirstOrDefaultAsync(rt => rt.Id == id && rt.UserId == userId);
        }

        public async Task<RecurringTransaction> CreateRecurringTransactionAsync(string userId, RecurringTransaction transaction)
        {
            transaction.UserId = userId;
            
            // Initial setup for occurrences and next date if not set
            if (transaction.NextOccurrenceDate == default)
            {
                transaction.NextOccurrenceDate = transaction.StartDate;
            }

            _context.RecurringTransactions.Add(transaction);
            await _context.SaveChangesAsync();

            // If the start date is today or in the past, immediately process so the
            // first occurrence is created AND linked as an Occurrence record.
            if (transaction.NextOccurrenceDate.Date <= DateTime.UtcNow.Date)
            {
                await ProcessDueRecurringTransactionsAsync();
            }

            // Reload to return the updated occurrence list
            return await _context.RecurringTransactions
                .FirstAsync(rt => rt.Id == transaction.Id);
        }

        public async Task<RecurringTransaction> UpdateRecurringTransactionAsync(string userId, RecurringTransaction transaction)
        {
            var existing = await _context.RecurringTransactions
                .FirstOrDefaultAsync(rt => rt.Id == transaction.Id && rt.UserId == userId);
                
            if (existing == null)
                throw new KeyNotFoundException($"Recurring transaction with ID {transaction.Id} not found.");

            _context.Entry(existing).CurrentValues.SetValues(transaction);
            existing.TemplateEntries = transaction.TemplateEntries;
            existing.Occurrences = transaction.Occurrences;

            await _context.SaveChangesAsync();
            return existing;
        }

        public async Task DeleteRecurringTransactionAsync(string userId, string id)
        {
            var existing = await _context.RecurringTransactions
                .FirstOrDefaultAsync(rt => rt.Id == id && rt.UserId == userId);
                
            if (existing != null)
            {
                _context.RecurringTransactions.Remove(existing);
                await _context.SaveChangesAsync();
            }
        }

        public async Task ProcessDueRecurringTransactionsAsync()
        {
            var now = DateTime.UtcNow.Date;
            
            var dueSchedules = await _context.RecurringTransactions
                .Where(rt => rt.NextOccurrenceDate <= now)
                .ToListAsync();

            foreach (var schedule in dueSchedules)
            {
                // Check if we reached the max occurrences
                if (schedule.MaxOccurrences.HasValue && schedule.Occurrences.Count >= schedule.MaxOccurrences.Value)
                    continue;

                // Check if we passed the end date
                if (schedule.EndDate.HasValue && schedule.NextOccurrenceDate > schedule.EndDate.Value)
                    continue;

                try
                {
                    // Generate new transaction
                    var newTransaction = new Transaction
                    {
                        UserId = schedule.UserId,
                        ScheduleId = schedule.Id,
                        Date = schedule.NextOccurrenceDate,
                        Note = schedule.TemplateNote,
                        Vendor = schedule.TemplateVendor,
                        Type = schedule.TemplateType,
                        Entries = schedule.TemplateEntries.Select(te => new LedgerEntry
                        {
                            UserId = schedule.UserId,
                            AccountId = te.AccountId,
                            Amount = te.Amount,
                            Note = te.Note,
                            ReferenceNumber = te.ReferenceNumber
                        }).ToList()
                    };

                    // Save the transaction using the regular service to ensure balances are updated
                    var createdTx = await _transactionService.CreateTransactionAsync(schedule.UserId, newTransaction);

                    // Add occurrence record
                    schedule.Occurrences.Add(new RecurringTransactionOccurrence
                    {
                        Date = schedule.NextOccurrenceDate,
                        OccurrenceNo = schedule.Occurrences.Count + 1,
                        Status = "Processed",
                        TransactionId = createdTx.Id
                    });

                    // Calculate next date
                    schedule.NextOccurrenceDate = CalculateNextDate(schedule.NextOccurrenceDate, schedule.Frequency, schedule.Interval);

                    _context.RecurringTransactions.Update(schedule);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"Failed to process recurring transaction {schedule.Id}");
                    
                    schedule.Occurrences.Add(new RecurringTransactionOccurrence
                    {
                        Date = schedule.NextOccurrenceDate,
                        OccurrenceNo = schedule.Occurrences.Count + 1,
                        Status = "Failed",
                        TransactionId = null
                    });
                    
                    // Advance date so we don't get stuck in an infinite failure loop on the same day, 
                    // though realistically we might want a different retry mechanism.
                    schedule.NextOccurrenceDate = CalculateNextDate(schedule.NextOccurrenceDate, schedule.Frequency, schedule.Interval);
                    _context.RecurringTransactions.Update(schedule);
                }
            }

            await _context.SaveChangesAsync();
        }

        public async Task AddOccurrenceAsync(string scheduleId, string transactionId, DateTime date)
        {
            var schedule = await _context.RecurringTransactions
                .FirstOrDefaultAsync(rt => rt.Id == scheduleId);

            if (schedule == null)
                return;

            // Avoid duplicate occurrence for same transactionId
            if (schedule.Occurrences.Any(o => o.TransactionId == transactionId))
                return;

            schedule.Occurrences.Add(new RecurringTransactionOccurrence
            {
                Date = date,
                OccurrenceNo = schedule.Occurrences.Count + 1,
                Status = "Processed",
                TransactionId = transactionId
            });

            _context.RecurringTransactions.Update(schedule);
            await _context.SaveChangesAsync();
        }

        private DateTime CalculateNextDate(DateTime currentDate, string frequency, int interval)
        {
            return frequency.ToLower() switch
            {
                "daily" => currentDate.AddDays(interval),
                "weekly" => currentDate.AddDays(7 * interval),
                "monthly" => currentDate.AddMonths(interval),
                "yearly" => currentDate.AddYears(interval),
                _ => currentDate.AddMonths(interval) // Default to monthly
            };
        }
    }
}
