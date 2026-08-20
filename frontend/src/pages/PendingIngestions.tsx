import { useState, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGetPendingIngestions, useCheckEmails } from '@/hooks/useIngestions'
import { useGetTransactionById } from '@/hooks/useTransactions'
import PendingIngestionsList from '@/components/PendingIngestionsList'
import AddTransactionModal from '@/components/AddTransactionModal'
import ImageUploadModal from '@/components/ImageUploadModal'
import ReasoningDrawer from '@/components/ReasoningDrawer'
import { Transaction } from '@/hooks/useTransactions'
import { RefreshCw, Mail, Image as ImageIcon, Brain } from 'lucide-react'

import { IngestionListSkeleton } from '@/components/ui/Skeleton'

export default function PendingIngestions() {
  const [viewMode, setViewMode] = useState<'Pending' | 'AutoConfirmed' | 'Confirmed'>('Pending')
  const [filter, setFilter] = useState<'all' | 'sms' | 'app' | 'email' | 'image'>('all')
  const { data: pendingIngestions = [], isLoading, isFetching, refetch } = useGetPendingIngestions(viewMode)
  const [confirmingIngestionId, setConfirmingIngestionId] = useState<string | null>(null)
  const [openingTransactionId, setOpeningTransactionId] = useState<string | null>(null)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [reasoningOpId, setReasoningOpId] = useState<string | null>(null)
  const [isReasoningDrawerOpen, setIsReasoningDrawerOpen] = useState(false)
  const [isReasoningPending, setIsReasoningPending] = useState(false)
  const [processingEmailsCount, setProcessingEmailsCount] = useState(0)

  const queryClient = useQueryClient()
  const { data: openedTransaction } = useGetTransactionById(openingTransactionId)

  const checkEmailsMutation = useCheckEmails()

  useEffect(() => {
    const handleReclassifyComplete = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!reasoningOpId || detail?.operationId === reasoningOpId) {
        setIsReasoningPending(false)
        refetch()
        queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
        queryClient.invalidateQueries({ queryKey: ['phoneHooks'] })
      }
      setProcessingEmailsCount((prev) => Math.max(0, prev - 1))
    }

    const handleCheckEmailItem = (e: Event) => {
      const detail = (e as CustomEvent).detail
      refetch()
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
      queryClient.invalidateQueries({ queryKey: ['phoneHooks'] })
      if (detail?.total) {
        setProcessingEmailsCount(Math.max(0, detail.total - detail.count))
      } else {
        setProcessingEmailsCount((prev) => Math.max(0, prev - 1))
      }
    }

    const handleCheckEmailComplete = () => {
      setProcessingEmailsCount(0)
      refetch()
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
      queryClient.invalidateQueries({ queryKey: ['phoneHooks'] })
    }

    window.addEventListener('reclassifyComplete', handleReclassifyComplete)
    window.addEventListener('checkEmailItem', handleCheckEmailItem)
    window.addEventListener('checkEmailComplete', handleCheckEmailComplete)
    return () => {
      window.removeEventListener('reclassifyComplete', handleReclassifyComplete)
      window.removeEventListener('checkEmailItem', handleCheckEmailItem)
      window.removeEventListener('checkEmailComplete', handleCheckEmailComplete)
    }
  }, [reasoningOpId, refetch, queryClient])



  const confirmingIngestion = useMemo(() => {
    return pendingIngestions.find(i => i.id === confirmingIngestionId) || null
  }, [pendingIngestions, confirmingIngestionId])

  const mappedIngestionTransaction = useMemo(() => {
    if (!confirmingIngestion) return null

    let resolvedDate = confirmingIngestion.ai_parsed.date
    if (!resolvedDate && confirmingIngestion.raw_payload?.timestamp) {
      const ts = confirmingIngestion.raw_payload.timestamp
      if (typeof ts === 'number') {
        const ms = ts > 30000000000 ? ts : ts * 1000
        resolvedDate = new Date(ms).toISOString()
      } else {
        resolvedDate = ts
      }
    }
    if (!resolvedDate) {
      resolvedDate = confirmingIngestion.received_at
    }

    const multiOrders = confirmingIngestion.ai_parsed.multi_order_items || []
    if (multiOrders.length > 1) {
      const entries = [
        {
          accountId: confirmingIngestion.ai_parsed.credit_account_id || '',
          amount: -(confirmingIngestion.ai_parsed.amount || 0),
          note: confirmingIngestion.ai_parsed.notes || 'Shopee total'
        },
        ...multiOrders.map((o) => ({
          accountId: o.debit_account_id || confirmingIngestion.ai_parsed.debit_account_id || '',
          amount: o.amount || 0,
          referenceNumber: o.reference_number || '',
          note: o.notes || (typeof o.vendor === 'string' ? o.vendor : o.vendor?.name) || ''
        }))
      ]

      return {
        type: 'Journal',
        vendor: confirmingIngestion.ai_parsed.vendor?.name || '',
        note: confirmingIngestion.ai_parsed.summary || confirmingIngestion.ai_parsed.notes || '',
        date: resolvedDate,
        referenceNumber: confirmingIngestion.ai_parsed.reference_number || '',
        entries
      } as Transaction
    }

    return {
      type: ['Income', 'Expense', 'Transfer'].includes(confirmingIngestion.ai_parsed.transaction_type || '')
        ? confirmingIngestion.ai_parsed.transaction_type
        : 'Expense',
      vendor: confirmingIngestion.ai_parsed.vendor?.name || '',
      note: confirmingIngestion.ai_parsed.summary || confirmingIngestion.ai_parsed.notes || '',
      date: resolvedDate,
      referenceNumber: confirmingIngestion.ai_parsed.reference_number || '',
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
    } as Transaction
  }, [confirmingIngestion])

  const handleCheckEmails = async () => {
    try {
      const res = await checkEmailsMutation.mutateAsync()
      if (res && res.count > 0) {
        setProcessingEmailsCount(res.count)
      }
    } catch (err) {
      console.error('Failed to check emails manually', err)
      setProcessingEmailsCount(0)
    }
  }



  const handleRefetchList = async () => {
    try {
      await refetch()
    } catch (err) {
      console.error('Failed to refetch list', err)
    }
  }

  const isCurrentFetching = isFetching
  const isCheckingOrProcessingEmails = checkEmailsMutation.isPending || processingEmailsCount > 0


  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="pt-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 flex flex-col">
        <div className="px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Inbox</h1>
            </div>
            <p className="text-slate-500 mt-1 text-sm">
              {viewMode === 'Pending'
                ? 'Pending Notifications'
                : viewMode === 'AutoConfirmed'
                ? 'Auto-Confirmed Notifications'
                : 'Confirmed Notifications'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="appearance-none pr-8 pl-3 py-2 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm"
              >
                <option value="all">All Notifications</option>
                <option value="image">Receipt Images</option>
                <option value="email">Email Only</option>
                <option value="sms">SMS Only</option>
                <option value="app">App Push Only</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
              </div>
            </div>

            <div className="hidden sm:block w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
            {reasoningOpId && (
              <button
                type="button"
                onClick={() => setIsReasoningDrawerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 rounded-xl hover:bg-purple-100 dark:hover:bg-purple-900/40 active:scale-95 transition-all shadow-sm cursor-pointer"
                title="Open AI reasoning stream drawer"
              >
                <Brain className={`w-3.5 h-3.5 ${isReasoningPending ? 'animate-pulse text-purple-500' : ''}`} />
                <span>{isReasoningPending ? 'Thinking...' : 'Reasoning'}</span>
              </button>
            )}
            <button
              onClick={handleRefetchList}
              disabled={isCurrentFetching}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all shadow-sm disabled:opacity-50"
              title="Refetch list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCurrentFetching ? 'animate-spin' : ''}`} />
              <span>{isCurrentFetching ? 'Fetching...' : 'Refetch'}</span>
            </button>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 active:scale-95 transition-all rounded-xl shadow-sm cursor-pointer"
              title="Upload Receipt"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Upload</span>
            </button>
            <button
              onClick={handleCheckEmails}
              disabled={isCheckingOrProcessingEmails}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all rounded-xl shadow-sm disabled:opacity-50 disabled:pointer-events-none"
              title="Check Email"
            >
              <Mail className={`w-3.5 h-3.5 ${isCheckingOrProcessingEmails ? 'animate-bounce' : ''}`} />
              <span>
                {checkEmailsMutation.isPending
                  ? 'Checking...'
                  : processingEmailsCount > 0
                  ? `Processing ${processingEmailsCount} email${processingEmailsCount > 1 ? 's' : ''}...`
                  : 'Check Email'}
              </span>
            </button>
          </div>
        </div>

        <div className="flex px-4 mt-4 gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setViewMode('Pending')}
            className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${viewMode === 'Pending'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
          >
            Pending
          </button>
          <button
            onClick={() => setViewMode('AutoConfirmed')}
            className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${viewMode === 'AutoConfirmed'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
          >
            Auto-Confirmed
          </button>
          <button
            onClick={() => setViewMode('Confirmed')}
            className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${viewMode === 'Confirmed'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
          >
            Confirmed
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-6">
        {isLoading ? (
          <IngestionListSkeleton count={4} />
        ) : pendingIngestions.length === 0 ? (
          <div className="p-8 text-center text-slate-400 italic">No {viewMode === 'Pending' ? 'pending' : viewMode === 'AutoConfirmed' ? 'auto-confirmed' : 'confirmed'} notifications.</div>
        ) : (
          <PendingIngestionsList filter={filter} viewMode={viewMode} onEditConfirm={(ing) => setConfirmingIngestionId(ing.id)} onOpenTransaction={(txId) => setOpeningTransactionId(txId)} />
        )}
      </div>


      <ImageUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onStreamReasoningStart={(opId) => {
          setReasoningOpId(opId)
          setIsReasoningPending(true)
          setIsReasoningDrawerOpen(true)
        }}
        onSuccess={(_id, opId, streamReasoning) => {
          if (opId && streamReasoning) {
            setReasoningOpId(opId)
            setIsReasoningPending(true)
            setIsReasoningDrawerOpen(true)
          }
          refetch()
        }}
      />

      <ReasoningDrawer
        isOpen={isReasoningDrawerOpen}
        onClose={() => setIsReasoningDrawerOpen(false)}
        operationId={reasoningOpId || ''}
        isPending={isReasoningPending}
        thinkingEventName="reclassifyThinking"
        progressEventName="reclassifyProgress"
      />
      <AddTransactionModal
        isOpen={!!confirmingIngestionId || !!openedTransaction}
        onClose={() => {
          setConfirmingIngestionId(null)
          setOpeningTransactionId(null)
        }}
        initialData={openedTransaction || mappedIngestionTransaction}
        ingestionId={confirmingIngestion?.id || openedTransaction?.ingestionId}
        ingestion={confirmingIngestion}
      />
    </div>
  )
}

