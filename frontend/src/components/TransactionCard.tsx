import { ArrowUpRight, ArrowDownRight, ArrowRightLeft, BookOpen, Smartphone, Bot, Pencil, Trash2 } from 'lucide-react'
import { Transaction } from '@/hooks/useTransactions'

interface TransactionCardProps {
  tx: Transaction
  getAccountName: (id: string) => string
  onEdit: (tx: Transaction) => void
  onDelete: (id: string) => void
}

export default function TransactionCard({ tx, getAccountName, onEdit, onDelete }: TransactionCardProps) {
  return (
    <li className="flex flex-col transition-colors duration-200">
      <div className="p-3 px-4 min-h-[60px] flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-full ${
              tx.type === 'Income'
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                : tx.type === 'Expense'
                ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                : tx.type === 'Journal'
                ? 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'
                : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
            }`}
          >
            {tx.type === 'Income' && <ArrowUpRight className="w-5 h-5" />}
            {tx.type === 'Expense' && <ArrowDownRight className="w-5 h-5" />}
            {tx.type === 'Transfer' && <ArrowRightLeft className="w-5 h-5" />}
            {tx.type === 'Journal' && <BookOpen className="w-5 h-5" />}
          </div>
          <div>
            <div className="text-base font-medium text-slate-900 dark:text-slate-50 leading-tight">
              {tx.type === 'Transfer' ? (
                'Transfer'
              ) : tx.type === 'Journal' ? (
                'Journal Entry'
              ) : (
                tx.entries
                  .filter(e => (tx.type === 'Expense' ? e.amount > 0 : e.amount < 0))
                  .map(e => getAccountName(e.accountId))
                  .join(', ') || 'Uncategorized'
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              {
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
                : getAccountName(tx.entries.find(e => tx.type === 'Expense' ? e.amount < 0 : e.amount > 0)?.accountId ?? '')
              }
              {tx.vendor && ` • Vendor: ${tx.vendor}`}
              {tx.ingestionId && !tx.isAutoConfirmed && <span className="ml-2 inline-flex items-center gap-0.5 text-[9px] uppercase font-bold tracking-wider text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded" title="Created from a notification"><Smartphone className="w-3 h-3" /> Linked</span>}
              {tx.isAutoConfirmed && <span className="ml-2 inline-flex items-center gap-0.5 text-[9px] uppercase font-bold tracking-wider text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded" title="Auto-confirmed from notification"><Bot className="w-3 h-3" /> Auto</span>}
            </p>
            {tx.note && <p className="text-sm text-slate-600 dark:text-slate-300 italic mt-0.5">{tx.note}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-base font-semibold mr-2 ${
              tx.type === 'Income'
                ? 'text-emerald-500'
                : tx.type === 'Expense'
                ? 'text-rose-500'
                : tx.type === 'Journal'
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-slate-700 dark:text-slate-350'
            }`}
          >
            {tx.type === 'Income' ? '+' : tx.type === 'Expense' ? '-' : ''}₱{
              (tx.entries.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0)).toFixed(2)
            }
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(tx); }}
            className="p-2 text-slate-400 hover:text-blue-500 transition-colors cursor-pointer"
            aria-label="Edit transaction"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (tx.id) onDelete(tx.id);
            }}
            className="p-2 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
            aria-label="Delete transaction"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Journal Entries */}
      {tx.type === 'Journal' && (
        <div className="bg-slate-50 dark:bg-slate-800/30 px-12 py-3 border-t border-slate-100 dark:border-slate-800">
          <div className="grid grid-cols-12 text-xs font-semibold uppercase text-slate-500 mb-2 px-2">
            <div className="col-span-6">Account</div>
            <div className="col-span-3 text-right">Debit</div>
            <div className="col-span-3 text-right">Credit</div>
          </div>
          <div className="flex flex-col gap-1">
            {tx.entries.map((entry, idx) => (
              <div key={idx} className="grid grid-cols-12 text-sm text-slate-700 dark:text-slate-300 px-2 py-1.5 bg-white dark:bg-slate-800 rounded items-center">
                <div className="col-span-6 overflow-hidden">
                  <div className="font-medium truncate">{getAccountName(entry.accountId)}</div>
                  {entry.comment && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 italic truncate">
                      {entry.comment}
                    </div>
                  )}
                </div>
                <div className="col-span-3 text-right text-slate-900 dark:text-slate-100">
                  {entry.amount > 0 ? `₱${entry.amount.toFixed(2)}` : ''}
                </div>
                <div className="col-span-3 text-right text-slate-900 dark:text-slate-100">
                  {entry.amount < 0 ? `₱${Math.abs(entry.amount).toFixed(2)}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}
