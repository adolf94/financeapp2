import { useState, useMemo } from 'react'
import { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { Transaction } from '@/hooks/useTransactions'
import { Account } from '@/hooks/useAccounts'
import DayModal from '@/components/DayModal'

interface DaySummary {
  income: number
  expense: number
  net: number
  transactions: Transaction[]
}

interface CalendarViewProps {
  transactions: Transaction[]
  accounts: Account[]
  currentMonth: Dayjs
}

function fmt(n: number) {
  if (n === 0) return null
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function CalendarView({ transactions, accounts, currentMonth }: CalendarViewProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Build a fast account lookup map
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id!, a])), [accounts])

  // Compute per-day summaries using account-type driven logic
  const dayMap = useMemo(() => {
    const map = new Map<string, DaySummary>()

    for (const tx of transactions) {
      const key = dayjs(tx.date).format('YYYY-MM-DD')

      if (!map.has(key)) {
        map.set(key, { income: 0, expense: 0, net: 0, transactions: [] })
      }

      const summary = map.get(key)!
      summary.transactions.push(tx)

      for (const entry of tx.entries) {
        const account = accountMap.get(entry.accountId)
        if (!account) continue

        if (account.accountType === 'Income') {
          summary.income += Math.abs(entry.amount)
        } else if (account.accountType === 'Expense') {
          summary.expense += Math.abs(entry.amount)
        }
      }

      summary.net = summary.income - summary.expense
    }

    return map
  }, [transactions, accountMap])

  // Month summary totals
  const monthTotals = useMemo(() => {
    let income = 0, expense = 0
    dayMap.forEach((s) => { income += s.income; expense += s.expense })
    return { income, expense, net: income - expense }
  }, [dayMap])

  // Build the 42-cell grid
  const cells = useMemo(() => {
    const startOfMonth = currentMonth.startOf('month')
    const endOfMonth = currentMonth.endOf('month')
    const startOffset = startOfMonth.day() // 0=Sun

    const result: Array<{ date: Dayjs | null; key: string | null }> = []

    // Leading empty cells
    for (let i = 0; i < startOffset; i++) {
      result.push({ date: null, key: null })
    }

    // Month days
    for (let d = 1; d <= endOfMonth.date(); d++) {
      const date = currentMonth.date(d)
      result.push({ date, key: date.format('YYYY-MM-DD') })
    }

    // Trailing empty cells to fill 42
    while (result.length < 42) {
      result.push({ date: null, key: null })
    }

    return result
  }, [currentMonth])

  const today = dayjs().format('YYYY-MM-DD')
  const selectedSummary = selectedDate ? dayMap.get(selectedDate) : null

  return (
    <>
      {/* Month Summary Bar */}
      <div className="grid grid-cols-3 gap-2 px-3 py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <div className="flex flex-col items-center bg-emerald-50 dark:bg-emerald-500/10 rounded-xl py-2 px-2">
          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Income</span>
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
            {monthTotals.income > 0
              ? `₱${monthTotals.income.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'}
          </span>
        </div>
        <div className="flex flex-col items-center bg-rose-50 dark:bg-rose-500/10 rounded-xl py-2 px-2">
          <span className="text-[10px] font-semibold text-rose-500 dark:text-rose-400 uppercase tracking-wider">Expenses</span>
          <span className="text-sm font-bold text-rose-500 dark:text-rose-400 mt-0.5">
            {monthTotals.expense > 0
              ? `₱${monthTotals.expense.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'}
          </span>
        </div>
        <div className={`flex flex-col items-center rounded-xl py-2 px-2 ${
          monthTotals.net >= 0 ? 'bg-blue-50 dark:bg-blue-500/10' : 'bg-amber-50 dark:bg-amber-500/10'
        }`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${
            monthTotals.net >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
          }`}>Net</span>
          <span className={`text-sm font-bold mt-0.5 ${
            monthTotals.net >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
          }`}>
            {monthTotals.income === 0 && monthTotals.expense === 0
              ? '—'
              : `${monthTotals.net >= 0 ? '+' : '-'}₱${Math.abs(monthTotals.net).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      </div>

      {/* Day-of-Week Headers */}
      <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 dark:bg-slate-800 flex-1">
        {cells.map((cell, idx) => {
          if (!cell.date || !cell.key) {
            return (
              <div
                key={`empty-${idx}`}
                className="bg-slate-50 dark:bg-slate-950 min-h-[76px]"
              />
            )
          }

          const key = cell.key
          const summary = dayMap.get(key)
          const isToday = key === today
          const hasTx = !!summary && summary.transactions.length > 0
          const isSelected = selectedDate === key

          return (
            <button
              key={key}
              onClick={() => hasTx ? setSelectedDate(key) : undefined}
              className={`relative flex flex-col items-start p-1.5 min-h-[76px] text-left transition-colors duration-150 cursor-default
                ${hasTx ? 'cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-900/20 active:bg-blue-100 dark:active:bg-blue-900/40' : ''}
                ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-white dark:bg-slate-900'}
              `}
            >
              {/* Day number */}
              <span
                className={`text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full mb-1 shrink-0
                  ${isToday
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-700 dark:text-slate-300'
                  }`}
              >
                {cell.date.date()}
              </span>

              {/* Chips */}
              {summary && summary.income > 0 && (
                <span className="w-full text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded px-1 py-0.5 leading-tight truncate mb-0.5">
                  +{fmt(summary.income)}
                </span>
              )}
              {summary && summary.expense > 0 && (
                <span className="w-full text-[9px] font-semibold text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 rounded px-1 py-0.5 leading-tight truncate">
                  {`-${fmt(summary.expense)}`}
                </span>
              )}

              {/* Net dot indicator at bottom */}
              {summary && (summary.income > 0 || summary.expense > 0) && (
                <span className={`mt-auto self-end text-[9px] font-bold leading-none pt-0.5 ${
                  summary.net > 0
                    ? 'text-blue-500 dark:text-blue-400'
                    : summary.net < 0
                    ? 'text-amber-500 dark:text-amber-400'
                    : 'text-slate-400'
                }`}>
                  {summary.net > 0
                    ? `+${fmt(summary.net)}`
                    : summary.net < 0
                    ? `-${fmt(Math.abs(summary.net))}`
                    : '±0'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Day Modal */}
      {selectedDate && selectedSummary && (
        <DayModal
          date={selectedDate}
          transactions={selectedSummary.transactions}
          accounts={accounts}
          summary={{
            income: selectedSummary.income,
            expense: selectedSummary.expense,
            net: selectedSummary.net,
          }}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </>
  )
}
