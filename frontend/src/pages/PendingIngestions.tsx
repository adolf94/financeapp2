import { useState, useMemo } from 'react'
import { useGetPendingIngestions, useCheckEmails } from '@/hooks/useIngestions'
import PendingIngestionsList from '@/components/PendingIngestionsList'
import AddTransactionModal from '@/components/AddTransactionModal'
import { Transaction } from '@/hooks/useTransactions'
import { RefreshCw, Mail } from 'lucide-react'

export default function PendingIngestions() {
  const [filter, setFilter] = useState<'all' | 'sms' | 'app' | 'email'>('all')
  const { data: pendingIngestions = [], isLoading, refetch } = useGetPendingIngestions('Pending')
  const [confirmingIngestionId, setConfirmingIngestionId] = useState<string | null>(null)

  const checkEmailsMutation = useCheckEmails()

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

  const handleCheckEmails = async () => {
    try {
      await checkEmailsMutation.mutateAsync()
    } catch (err) {
      console.error('Failed to check emails manually', err)
    }
  }

  const handleRefetchList = async () => {
    try {
      await refetch()
    } catch (err) {
      console.error('Failed to refetch list', err)
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Inbox</h1>
          <p className="text-slate-500 mt-1 text-sm">Pending Notifications</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="appearance-none pr-8 pl-3 py-2 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm"
            >
              <option value="all">All Notifications</option>
              <option value="email">Email Only</option>
              <option value="sms">SMS Only</option>
              <option value="app">App Push Only</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
            </div>
          </div>

          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
          <button
            onClick={handleRefetchList}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refetch</span>
          </button>
          <button
            onClick={handleCheckEmails}
            disabled={checkEmailsMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all rounded-xl shadow-sm disabled:opacity-50 disabled:pointer-events-none"
          >
            <Mail className={`w-3.5 h-3.5 ${checkEmailsMutation.isPending ? 'animate-bounce' : ''}`} />
            <span>{checkEmailsMutation.isPending ? 'Checking...' : 'Check Email'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-6">
        {!isLoading && pendingIngestions.length === 0 ? (
          <div className="p-8 text-center text-slate-400 italic">No pending notifications.</div>
        ) : (
          <PendingIngestionsList filter={filter} onEditConfirm={(ing) => setConfirmingIngestionId(ing.id)} />
        )}
      </div>

      <AddTransactionModal
        isOpen={!!confirmingIngestion}
        onClose={() => setConfirmingIngestionId(null)}
        initialData={mappedIngestionTransaction}
        ingestionId={confirmingIngestion?.id}
        ingestion={confirmingIngestion}
      />
    </div >
  )
}
