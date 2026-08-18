interface RecurringScheduleSectionProps {
  isRecurring: boolean
  setIsRecurring: (isRecurring: boolean) => void
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  setFrequency: (freq: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly') => void
  recurringEndDate: string
  handleRecurringEndDateChange: (date: string) => void
  maxOccurrences: string
  handleRecurringOccurrencesChange: (occ: string) => void
}

export default function RecurringScheduleSection({
  isRecurring,
  setIsRecurring,
  frequency,
  setFrequency,
  recurringEndDate,
  handleRecurringEndDateChange,
  maxOccurrences,
  handleRecurringOccurrencesChange,
}: RecurringScheduleSectionProps) {
  return (
    <div className="mt-2 p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/50">
      <label className="flex items-center justify-between cursor-pointer">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Make this recurring
          </span>
          <span className="text-xs text-slate-500">Auto-generate this transaction</span>
        </div>
        <div className="relative inline-flex items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={isRecurring}
            onChange={(e) => setIsRecurring(e.target.checked)}
          />
          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
        </div>
      </label>

      {isRecurring && (
        <div className="space-y-3 mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="recurring-frequency-select" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Frequency
            </label>
            <select
              id="recurring-frequency-select"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as any)}
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
              <option value="Yearly">Yearly</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="recurring-end-date-input" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                End Date <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                id="recurring-end-date-input"
                type="date"
                value={recurringEndDate}
                onChange={(e) => handleRecurringEndDateChange(e.target.value)}
                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="recurring-max-occurrences-input" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Max Times <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                id="recurring-max-occurrences-input"
                type="number"
                min={1}
                placeholder="Unlimited"
                value={maxOccurrences}
                onChange={(e) => handleRecurringOccurrencesChange(e.target.value)}
                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
