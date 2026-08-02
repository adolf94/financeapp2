import { useState } from 'react'
import { useGetPendingIngestions, useConfirmIngestion, useRejectIngestion, useUpdateIngestionVendor, useGenerateAccountDescription, PendingIngestion } from '@/hooks/useIngestions'
import { BellDot, Sparkles } from 'lucide-react'
import { useGetAccounts, useCreateAccount, useGetAccountGroups, useCreateAccountGroup } from '@/hooks/useAccounts'
import PendingIngestionCard from '@/components/PendingIngestionCard'

interface PendingIngestionsListProps {
  onEditConfirm: (ingestion: PendingIngestion) => void
}

export default function PendingIngestionsList({ onEditConfirm }: PendingIngestionsListProps) {
  const { data: ingestions = [], isLoading } = useGetPendingIngestions()
  const { data: accounts = [] } = useGetAccounts()
  const { data: groups = [] } = useGetAccountGroups()
  
  const confirmMutation = useConfirmIngestion()
  const rejectMutation = useRejectIngestion()
  const updateVendorMutation = useUpdateIngestionVendor()
  const createAccountMutation = useCreateAccount()
  const createGroupMutation = useCreateAccountGroup()
  const generateDescMutation = useGenerateAccountDescription()

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
      <div className="mx-3 mt-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-center gap-2 text-sm text-slate-500">
        <Sparkles className="w-4 h-4 animate-spin text-blue-500" />
        Analyzing notification queue...
      </div>
    )
  }

  if (ingestions.length === 0) return null

  return (
    <div className="mx-3 mt-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <BellDot className="w-4 h-4 text-amber-500 animate-pulse" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Pending Ingested Notifications ({ingestions.length})
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
              onUpdateVendor={handleUpdateVendor}
              onCreateSuggestedAccount={handleCreateSuggestedAccount}
              onGenerateDesc={(data, onSuccess) => {
                generateDescMutation.mutate(data, {
                  onSuccess: (res) => onSuccess(res)
                })
              }}
              isGeneratingDesc={generateDescMutation.isPending}
            />
          )
        })}
      </div>
    </div>
  )
}
