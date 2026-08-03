import { useState, useMemo } from 'react'
import { useGetPendingIngestions } from '@/hooks/useIngestions'
import PendingIngestionsList from '@/components/PendingIngestionsList'
import AddTransactionModal from '@/components/AddTransactionModal'
import { Transaction } from '@/hooks/useTransactions'

export default function PendingIngestions() {
  const { data: pendingIngestions = [], isLoading } = useGetPendingIngestions('Pending')
  const [confirmingIngestionId, setConfirmingIngestionId] = useState<string | null>(null)
  
  const confirmingIngestion = useMemo(() => {
    return pendingIngestions.find(i => i.id === confirmingIngestionId) || null
  }, [pendingIngestions, confirmingIngestionId])

  const mappedIngestionTransaction = useMemo(() => {
    return confirmingIngestion ? {
      type: ['Income', 'Expense', 'Transfer'].includes(confirmingIngestion.ai_parsed.transaction_type || '') 
        ? confirmingIngestion.ai_parsed.transaction_type 
        : 'Expense',
      vendor: confirmingIngestion.ai_parsed.vendor || '',
      note: confirmingIngestion.ai_parsed.summary || confirmingIngestion.ai_parsed.notes || '',
      date: confirmingIngestion.received_at,
      entries: [
        {
          accountId: confirmingIngestion.ai_parsed.debit_account_id || '',
          amount: confirmingIngestion.ai_parsed.amount || 0
        },
        {
          accountId: confirmingIngestion.ai_parsed.credit_account_id || '',
          amount: -(confirmingIngestion.ai_parsed.amount || 0)
        }
      ]
    } as Transaction : null
  }, [confirmingIngestion])

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Inbox</h1>
        <p className="text-slate-500 mt-1 text-sm">Pending Notifications</p>
      </div>

      <div className="flex-1 overflow-y-auto pb-6">
        {!isLoading && pendingIngestions.length === 0 ? (
          <div className="p-8 text-center text-slate-400 italic">No pending notifications.</div>
        ) : (
          <PendingIngestionsList onEditConfirm={(ing) => setConfirmingIngestionId(ing.id)} />
        )}
      </div>

      <AddTransactionModal
        isOpen={!!confirmingIngestion}
        onClose={() => setConfirmingIngestionId(null)}
        initialData={mappedIngestionTransaction}
        ingestionId={confirmingIngestion?.id}
        ingestion={confirmingIngestion}
      />
    </div>
  )
}
