import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useGetTransactions, useDeleteTransaction } from '@/hooks/useTransactions'
import { useGetAccounts } from '@/hooks/useAccounts'
import TransactionCard from '@/components/TransactionCard'
import { TransactionListSkeleton } from '@/components/ui/Skeleton'
import ConfirmationModal from '@/components/ui/ConfirmationModal'
import AddTransactionModal from '@/components/AddTransactionModal'
import dayjs from 'dayjs'

export default function TransactionsDaily() {
  const { month } = useParams({ from: '/transactions/$month/daily' })
  const currentMonth = dayjs(month, 'YYYY-MM')
  const startDate = currentMonth.format('YYYY-MM-DD')
  const endDate = currentMonth.add(1, 'month').startOf('month').format('YYYY-MM-DD')

  const { data: transactions = [], isLoading } = useGetTransactions(startDate, endDate)
  const { data: accounts = [] } = useGetAccounts()
  const deleteMutation = useDeleteTransaction()

  const [editingTx, setEditingTx] = useState<any>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)

  const getAccountName = (id: string) => {
    return accounts.find(a => a.id === id)?.name ?? 'Unknown Account'
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Daily Transactions</h1>
        <p className="text-slate-500 mt-1 text-sm">{currentMonth.format('MMMM YYYY')}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <TransactionListSkeleton count={6} />
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center text-slate-400 italic">No transactions recorded yet.</div>
        ) : (
          <div className="pb-8">
            {Object.entries(
              transactions.reduce((groups, tx) => {
                const dateStr = new Date(tx.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                if (!groups[dateStr]) groups[dateStr] = []
                groups[dateStr].push(tx)
                return groups
              }, {} as Record<string, typeof transactions>)
            ).map(([dateStr, dayTransactions]) => (
              <div key={dateStr} className="mb-6">
                <div className="sticky top-0 z-0 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur px-4 py-2 border-y border-slate-200 dark:border-slate-800">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{dateStr}</h3>
                </div>
                <ul className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                  {dayTransactions.map((tx) => (
                    <TransactionCard
                      key={tx.id}
                      tx={tx}
                      getAccountName={getAccountName}
                      onEdit={(tx) => setEditingTx(tx)}
                      onDelete={(id) => setDeleteCandidate(id)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddTransactionModal
        isOpen={!!editingTx}
        onClose={() => setEditingTx(null)}
        onSave={() => {}}
        initialData={editingTx}
      />

      <ConfirmationModal
        isOpen={!!deleteCandidate}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction? This action is permanent and cannot be undone."
        onConfirm={() => {
          if (deleteCandidate) {
            deleteMutation.mutate(deleteCandidate)
            setDeleteCandidate(null)
          }
        }}
        onCancel={() => setDeleteCandidate(null)}
      />
    </div>
  )
}
