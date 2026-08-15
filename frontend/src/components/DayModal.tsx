import { X, ArrowDownRight, ArrowUpRight, ArrowRightLeft, BookOpen } from 'lucide-react'
import { Transaction } from '@/hooks/useTransactions'
import { Account } from '@/hooks/useAccounts'
import dayjs from 'dayjs'

interface DaySummary {
  income: number
  expense: number
  net: number
}

interface DayModalProps {
  date: string // 'YYYY-MM-DD'
  transactions: Transaction[]
  accounts: Account[]
  summary: DaySummary
  onClose: () => void
}

function fmt(n: number) {
  return `₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function DayModal({ date, transactions, accounts, summary, onClose }: DayModalProps) {
  const accountMap = new Map(accounts.map((a) => [a.id!, a]))

  const getAccountName = (id: string) => accountMap.get(id)?.name ?? 'Unknown Account'

  const formattedDate = dayjs(date).format('dddd, MMMM D, YYYY')

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/50 z-50 transition-opacity duration-200"
        aria-hidden="true"
      />

      {/* Bottom Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Transactions for ${formattedDate}`}
        className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-2xl z-55 shadow-2xl flex flex-col border-t border-slate-200 dark:border-slate-800 max-h-[85vh]"
        style={{ animation: 'slideUp 0.25s cubic-bezier(0.32,0.72,0,1)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-start px-4 pt-2 pb-3 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">{formattedDate}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Day Summary Chips */}
        <div className="grid grid-cols-3 gap-2 px-4 pb-3 shrink-0">
          <div className="flex flex-col items-center bg-emerald-50 dark:bg-emerald-500/10 rounded-xl py-2.5 px-1">
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Income</span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 text-center leading-tight">
              {summary.income > 0 ? fmt(summary.income) : '—'}
            </span>
          </div>
          <div className="flex flex-col items-center bg-rose-50 dark:bg-rose-500/10 rounded-xl py-2.5 px-1">
            <span className="text-[10px] font-semibold text-rose-500 dark:text-rose-400 uppercase tracking-wider mb-1">Expense</span>
            <span className="text-sm font-bold text-rose-500 dark:text-rose-400 text-center leading-tight">
              {summary.expense > 0 ? fmt(summary.expense) : '—'}
            </span>
          </div>
          <div className={`flex flex-col items-center rounded-xl py-2.5 px-1 ${
            summary.net >= 0
              ? 'bg-blue-50 dark:bg-blue-500/10'
              : 'bg-amber-50 dark:bg-amber-500/10'
          }`}>
            <span className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${
              summary.net >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
            }`}>Net</span>
            <span className={`text-sm font-bold text-center leading-tight ${
              summary.net >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {summary.income === 0 && summary.expense === 0 ? '—' : (summary.net >= 0 ? '+' : '-') + fmt(summary.net)}
            </span>
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 shrink-0" />

        {/* Transaction List */}
        <ul className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {transactions.length === 0 ? (
            <li className="p-8 text-center text-slate-400 italic text-sm">No transactions for this day.</li>
          ) : (
            transactions.map((tx) => {
              const amount = tx.entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0)

              const primaryLabel =
                tx.type === 'Transfer'
                  ? 'Transfer'
                  : tx.type === 'Journal'
                  ? 'Journal Entry'
                  : tx.entries
                      .filter((e) => (tx.type === 'Expense' ? e.amount > 0 : e.amount < 0))
                      .map((e) => getAccountName(e.accountId))
                      .join(', ') || 'Uncategorized'

              const secondaryLabel =
                tx.type === 'Transfer'
                  ? (() => {
                      const src = tx.entries.find((e) => e.amount < 0)
                      const dst = tx.entries.find((e) => e.amount > 0)
                      return src && dst
                        ? `${getAccountName(src.accountId)} ➔ ${getAccountName(dst.accountId)}`
                        : tx.entries.map((e) => getAccountName(e.accountId)).join(' ➔ ')
                    })()
                  : tx.type === 'Journal'
                  ? `${tx.entries.length} splits`
                  : getAccountName(
                      tx.entries.find((e) =>
                        tx.type === 'Expense' ? e.amount < 0 : e.amount > 0
                      )?.accountId ?? ''
                    )

              return (
                <li key={tx.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  {/* Type icon */}
                  <div
                    className={`p-2 rounded-full shrink-0 ${
                      tx.type === 'Income'
                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : tx.type === 'Expense'
                        ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                        : tx.type === 'Journal'
                        ? 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'
                        : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                    }`}
                  >
                    {tx.type === 'Income' && <ArrowUpRight className="w-4 h-4" />}
                    {tx.type === 'Expense' && <ArrowDownRight className="w-4 h-4" />}
                    {tx.type === 'Transfer' && <ArrowRightLeft className="w-4 h-4" />}
                    {tx.type === 'Journal' && <BookOpen className="w-4 h-4" />}
                  </div>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{primaryLabel}</p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      {secondaryLabel}
                      {tx.vendor ? ` • ${tx.vendor}` : ''}
                    </p>
                    {tx.note && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic mt-0.5 truncate">{tx.note}</p>
                    )}
                  </div>

                  {/* Amount */}
                  <span
                    className={`text-sm font-semibold shrink-0 ${
                      tx.type === 'Income'
                        ? 'text-emerald-500'
                        : tx.type === 'Expense'
                        ? 'text-rose-500'
                        : tx.type === 'Journal'
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {tx.type === 'Income' ? '+' : tx.type === 'Expense' ? '-' : ''}₱{amount.toFixed(2)}
                  </span>
                </li>
              )
            })
          )}
        </ul>

        {/* Safe area bottom padding */}
        <div className="shrink-0 h-6" />
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
