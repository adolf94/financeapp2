import { useState } from 'react'
import { useGetPendingIngestions, useConfirmIngestion, useRejectIngestion, useUpdateIngestionVendor, PendingIngestion } from '@/hooks/useIngestions'
import { BellDot } from 'lucide-react'
import { useGetAccounts, useCreateAccount, useGetAccountGroups, useCreateAccountGroup } from '@/hooks/useAccounts'
import PendingIngestionCard from '@/components/PendingIngestionCard'

interface PendingIngestionsListProps {
  filter: 'all' | 'sms' | 'app' | 'email'
  viewMode?: string
  onEditConfirm: (ingestion: PendingIngestion) => void
  onOpenTransaction?: (transactionId: string) => void
}

export default function PendingIngestionsList({ filter, viewMode = 'Pending', onEditConfirm, onOpenTransaction }: PendingIngestionsListProps) {
  const { data: allIngestions = [], isLoading } = useGetPendingIngestions(viewMode)

  const ingestionsWithTypes = allIngestions.map(i => {
    let type = i.notification_type
    if (!type || type === 'unknown') {
      const action = (i.raw_payload?.action || '').toLowerCase()
      if (action === 'email_received') type = 'email'
      else if (action.includes('sms') || i.raw_payload?.sms_msg || i.raw_payload?.sms_sender) type = 'sms'
      else type = 'app'
    }
    return { ...i, notification_type: type }
  })

  const ingestions = filter === 'all' 
    ? ingestionsWithTypes 
    : ingestionsWithTypes.filter(i => i.notification_type === filter)
  const { data: accounts = [] } = useGetAccounts()
  const { data: groups = [] } = useGetAccountGroups()
  
  const confirmMutation = useConfirmIngestion()
  const rejectMutation = useRejectIngestion()
  const updateVendorMutation = useUpdateIngestionVendor()
  const createAccountMutation = useCreateAccount()
  const createGroupMutation = useCreateAccountGroup()

  const [processingIds, setProcessingIds] = useState<string[]>([])

  const getAccountName = (id?: string | null) => {
    if (!id) return 'Unassigned'
    return accounts.find(a => a.id === id)?.name ?? 'Unknown Account'
  }

  const handleQuickConfirm = (ingestion: PendingIngestion) => {
    setProcessingIds(prev => [...prev, ingestion.id])
    confirmMutation.mutate({
      id: ingestion.id,
      userConfirmed: {
        vendor: ingestion.ai_parsed.vendor,
        amount: ingestion.ai_parsed.amount,
        transaction_type: ingestion.ai_parsed.transaction_type,
        debit_account_id: ingestion.ai_parsed.debit_account_id,
        credit_account_id: ingestion.ai_parsed.credit_account_id,
        notes: ingestion.ai_parsed.summary || ingestion.ai_parsed.notes || ''
      }
    }, {
      onSettled: () => {
        setProcessingIds(prev => prev.filter(id => id !== ingestion.id))
      }
    })
  }

  const handleDismiss = (id: string) => {
    if (confirm('Are you sure you want to dismiss this notification proposal?')) {
      setProcessingIds(prev => [...prev, id])
      rejectMutation.mutate(id, {
        onSettled: () => {
          setProcessingIds(prev => prev.filter(x => x !== id))
        }
      })
    }
  }

  const handleCreateSuggestedAccount = async (data: { type: string, account_group: string, name: string, description?: string }, ingestionId: string) => {
    setProcessingIds(prev => [...prev, ingestionId])
    try {
      let targetGroupId = groups.find(g => g.name === data.account_group && g.accountType === data.type)?.id
      
      if (!targetGroupId) {
        const newGroup = await createGroupMutation.mutateAsync({ name: data.account_group, accountType: data.type })
        targetGroupId = newGroup.id
      }

      await createAccountMutation.mutateAsync({
        name: data.name,
        description: data.description,
        accountGroupId: targetGroupId as string,
        startingBalance: 0,
        accountType: data.type as any,
      })
    } catch (err) {
      console.error('Failed to create suggested account', err)
    } finally {
      setProcessingIds(prev => prev.filter(x => x !== ingestionId))
    }
  }

  const handleUpdateVendor = async (ingestionId: string, vendor: string) => {
    setProcessingIds(prev => [...prev, ingestionId])
    try {
      await updateVendorMutation.mutateAsync({ id: ingestionId, vendor })
    } finally {
      setProcessingIds(prev => prev.filter(x => x !== ingestionId))
    }
  }

  if (isLoading) {
    return (
      <div className="mx-3 mt-3 flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <div className="w-4 h-4 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
          <div className="w-48 h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="flex justify-between items-start gap-4">
                <div className="flex flex-col gap-2 flex-1">
                  <div className="w-24 h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="w-3/4 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="w-1/2 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="w-20 h-5 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="w-16 h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col gap-1.5">
                  <div className="w-16 h-2 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="w-24 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5 bg-slate-100/50 dark:bg-slate-900/30 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800/50">
                  <div className="w-24 h-2 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="w-40 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="w-20 h-2 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="w-32 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="w-20 h-2 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="w-24 h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
              </div>
              <div className="flex gap-2 justify-end items-center border-t border-slate-100 dark:border-slate-800/80 pt-3">
                <div className="w-20 h-8 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
                <div className="w-20 h-8 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
                <div className="w-24 h-8 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (ingestions.length === 0) return null

  return (
    <div className="mx-3 mt-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <BellDot className="w-4 h-4 text-amber-500 animate-pulse" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {viewMode === 'Pending' ? 'Pending' : viewMode === 'AutoConfirmed' ? 'Auto-Confirmed' : 'Confirmed'} Ingested Notifications ({ingestions.length})
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {ingestions.map((ingestion) => {


          return (
            <PendingIngestionCard
              key={ingestion.id}
              ingestion={ingestion}
              getAccountName={getAccountName}
              groups={groups}
              isProcessing={processingIds.includes(ingestion.id)}
              onQuickConfirm={handleQuickConfirm}
              onDismiss={handleDismiss}
              onEditConfirm={onEditConfirm}
              onOpenTransaction={onOpenTransaction}
              onUpdateVendor={handleUpdateVendor}
              onCreateSuggestedAccount={handleCreateSuggestedAccount}
            />
          )
        })}
      </div>
    </div>
  )
}
