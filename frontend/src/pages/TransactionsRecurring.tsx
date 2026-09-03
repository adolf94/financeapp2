import RecurringTransactionsList from '@/components/RecurringTransactionsList'

export default function TransactionsRecurring() {
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Recurring Transactions</h1>
        <p className="text-slate-500 mt-1 text-sm">Manage your recurring transactions</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <RecurringTransactionsList />
      </div>
    </div>
  )
}
