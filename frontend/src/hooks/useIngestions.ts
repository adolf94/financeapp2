import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'
import ingesterClient from '@/lib/ingesterClient'

export interface AiVendorInfo {
  name?: string | null
  type?: string | null
  matched?: boolean | null
  is_recommendation?: boolean | null
  lookups?: string[]
  new_lookups?: string[]
  NewLookups?: string[]
  tags?: string[] | null
}

export interface AiParsedData {
  is_financial?: boolean | null
  vendor?: AiVendorInfo | null
  amount?: number | null
  transaction_type?: string | null
  category?: string | null
  debit_account_id?: string | null
  credit_account_id?: string | null
  date?: string | null
  ingestion_id?: string | null
  suggested_account_creation?: Array<{
    type: string
    account_group: string
    name: string
    description?: string
    reason: string
  }> | null
  notes?: string | null
  summary?: string | null
  confidence?: number | null
  recipient_account_number?: string | null
  recipient_account_name?: string | null
  sender_account_number?: string | null
  sender_account_name?: string | null
  reference_number?: string | null
  application?: string | null
  why?: string | null
  user_why?: string | null
  reason?: string | null
  suggested_rule?: string | null
  is_auto_confirmed?: boolean | null
  multi_order_items?: Array<{
    amount: number
    reference_number?: string | null
    vendor?: AiVendorInfo | string | null
    debit_account_id?: string | null
    notes?: string | null
  }> | null
}

export interface PendingIngestion {
  id: string
  UserId: string
  hook_id: string
  received_at: string
  raw_payload: Record<string, any>
  raw_msg: string
  ai_parsed: AiParsedData
  user_confirmed: Record<string, any>
  similarity_score: number
  top_matches: Array<{ vendor?: string; category?: string; score?: number }>
  status: string
  transaction_id?: string | null
  month_key: string
  partition_key: string
  notification_type: string
  related_ingestion_ids?: string[]
  related_transaction_ids?: string[]
  possible_related_ingestion_ids?: string[]
  possible_related_transaction_ids?: string[]
  has_possible_confirmed_match?: boolean
  RelatedIngestionIds?: string[]
  RelatedTransactionIds?: string[]
  PossibleRelatedIngestionIds?: string[]
  PossibleRelatedTransactionIds?: string[]
  HasPossibleConfirmedMatch?: boolean
  runbook_synced?: boolean
}

export function useGetPendingIngestions(status: string = 'Pending') {
  return useQuery<PendingIngestion[]>({
    queryKey: ['pendingIngestions', status],
    queryFn: async () => {
      // Changed to use python backend directly
      const response = await ingesterClient.get('/ingestions', { params: { status } })
      const data = response.data as PendingIngestion[]
      return [...data].sort((a, b) => {
        const rawA = a.raw_payload?.timestamp;
        const rawB = b.raw_payload?.timestamp;
        
        const timeA = rawA
          ? (typeof rawA === 'number' ? (rawA > 30000000000 ? rawA : rawA * 1000) : Date.parse(rawA))
          : null;
        const timeB = rawB
          ? (typeof rawB === 'number' ? (rawB > 30000000000 ? rawB : rawB * 1000) : Date.parse(rawB))
          : null;

        const valA = (timeA && !isNaN(timeA))
          ? timeA
          : ((a.ai_parsed?.date ? Date.parse(a.ai_parsed.date) : null) || Date.parse(a.received_at));
        const valB = (timeB && !isNaN(timeB))
          ? timeB
          : ((b.ai_parsed?.date ? Date.parse(b.ai_parsed.date) : null) || Date.parse(b.received_at));

        return (valB || 0) - (valA || 0);
      })
    }
  })
}

export function useGetIngestionById(id?: string | null) {
  return useQuery<PendingIngestion>({
    queryKey: ['ingestion', id],
    queryFn: async () => {
      const response = await ingesterClient.get(`/ingestions/${id}`)
      return response.data
    },
    enabled: !!id,
  })
}

export function useConfirmIngestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      userConfirmed,
      transactionId,
      skipLearning,
      dismissRelatedIds,
      dismissStatus = 'Merged'
    }: {
      id: string
      userConfirmed: Partial<AiParsedData>
      transactionId?: string
      skipLearning?: boolean
      dismissRelatedIds?: string[]
      dismissStatus?: 'Duplicate' | 'Merged'
    }) => {
      // Step 1: Create transaction in C#
      let txId = transactionId;
      if (!txId) {
        // Pass ingestionId & merged_ingestion_ids so they get saved in Transaction.cs
        const payload = {
          ...userConfirmed,
          ingestion_id: id,
          merged_ingestion_ids: dismissRelatedIds || [],
          MergedIngestionIds: dismissRelatedIds || [],
        }
        const response = await apiClient.post(`/transactions/from-ingestion`, payload)
        txId = response.data.id
      }
      
      // Step 2: Confirm status in Python
      const pyResponse = await ingesterClient.post(`/ingestions/${id}/confirm-status`, {
        transaction_id: txId,
        user_confirmed: userConfirmed,
        skip_learning: skipLearning || false,
        dismiss_related_ids: dismissRelatedIds || [],
        dismiss_status: dismissStatus
      })
      
      return pyResponse.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    }
  })
}

export function useLearnIngestion() {
  return useMutation({
    mutationFn: async ({ id, userConfirmed }: { id: string; userConfirmed: Partial<AiParsedData> }) => {
      const response = await ingesterClient.post(`/ingestions/${id}/learn`, userConfirmed)
      return response.data
    }
  })
}

export function useRejectIngestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // Changed to use python backend directly
      const response = await ingesterClient.post(`/ingestions/${id}/reject`)
      return response.data
    },
    onSuccess: (_, id) => {
      queryClient.setQueriesData<PendingIngestion[]>({ queryKey: ['pendingIngestions'] }, (old) => {
        return old ? old.filter((item) => item.id !== id) : []
      })
    }
  })
}

export interface ReclassifyCorrections {
  comment?: string
  type?: string
  vendor?: string
  debit_account_id?: string | null
  credit_account_id?: string | null
}

export function useReclassifyIngestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      operationId,
      streamReasoning,
      userCorrections,
    }: {
      id: string
      operationId: string
      streamReasoning?: boolean
      userCorrections?: ReclassifyCorrections
    }) => {
      // Goes directly to Python ingester (JWT Bearer, no .NET proxy)
      const connId = (window as any).signalRConnectionId || ''
      const response = await ingesterClient.post(
        `/ingestions/${id}/reclassify?operationId=${operationId}&connectionId=${connId}&streamReasoning=${!!streamReasoning}`,
        userCorrections ? { user_corrections: userCorrections } : {}
      )
      return response.data as PendingIngestion
    },
    onSuccess: (data, variables) => {
      // Update specific ingestion cache if modal is opened from transactions view
      queryClient.setQueryData(['ingestion', variables.id], data)
      // Update pending ingestions list cache
      queryClient.setQueriesData<PendingIngestion[]>({ queryKey: ['pendingIngestions'] }, (old) => {
        if (!old) return old
        return old.map((ing) => (ing.id === variables.id ? data : ing))
      })
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
    }
  })
}

export function useUpdateIngestionVendor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, vendor }: { id: string; vendor: string }) => {
      const response = await ingesterClient.patch(`/ingestions/${id}/vendor`, { vendor })
      return response.data as PendingIngestion
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
    }
  })
}

export interface HistoricalHook {
  id: string
  Date: string
  Type: string
  RawMsg: string
  Status?: string
  JsonData?: Record<string, any>
  ExtractedData?: {
    amount?: string
    recipientName?: string
    senderName?: string
    [key: string]: any
  }
}

export function useGetHistoricalHooks() {
  return useQuery<HistoricalHook[]>({
    queryKey: ['historicalHooks'],
    queryFn: async () => {
      // Served directly from Python ingester
      const response = await ingesterClient.get('/historical-hooks')
      return response.data
    }
  })
}

export function useImportHistoricalHook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // Served directly from Python ingester
      const response = await ingesterClient.post(`/historical-hooks/${id}/import`)
      return response.data as PendingIngestion
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historicalHooks'] })
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
    }
  })
}

export function useIgnoreHistoricalHook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // Served directly from Python ingester
      const response = await ingesterClient.post(`/historical-hooks/${id}/ignore`)
      return response.data
    },
    onSuccess: (_, id) => {
      queryClient.setQueriesData<HistoricalHook[]>({ queryKey: ['historicalHooks'] }, (old) => {
        return old ? old.filter((item) => item.id !== id) : []
      })
    }
  })
}

export function useGenerateAccountDescription() {
  return useMutation({
    mutationFn: async ({ accountName, accountType, groupName, context }: { accountName: string, accountType: string, groupName: string, context?: string }) => {
      const response = await ingesterClient.post('/accounts/generate-description', {
        account_name: accountName,
        account_type: accountType,
        group_name: groupName,
        context: context || ""
      })
      return response.data as { description: string }
    }
  })
}

export function useCheckEmails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await ingesterClient.post('/email/check')
      return response.data as { success: boolean; count: number }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
    }
  })
}

export function useUploadImage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      operationId,
      description,
      streamReasoning = true,
    }: {
      file: File
      operationId?: string
      description?: string
      streamReasoning?: boolean
    }) => {
      const connId = (window as any).signalRConnectionId || ''
      const formData = new FormData()
      formData.append('image', file)
      if (operationId) {
        formData.append('operation_id', operationId)
      }
      if (connId) {
        formData.append('connection_id', connId)
      }
      if (description) {
        formData.append('description', description)
      }

      const response = await ingesterClient.post('/image_hook', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        params: {
          ...(operationId ? { operationId } : {}),
          ...(connId ? { connectionId: connId } : {}),
          ...(description ? { description } : {}),
          streamReasoning: !!streamReasoning,
        },
      })
      return response.data as { ingestion_id: string; status: string; message: string }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
    },
  })
}

export interface PhoneHookMessage {
  id: string
  UserId?: string
  received_at: string
  action: string
  raw_payload: Record<string, any>
  raw_msg: string
  status: string
  month_key: string
  partition_key: string
  notification_type: string
  processing_metadata?: Record<string, any>
}

export function useGetPhoneHooks(status: string = 'error') {
  return useQuery<PhoneHookMessage[]>({
    queryKey: ['phoneHooks', status],
    queryFn: async () => {
      const response = await ingesterClient.get('/phone-hooks', { params: { status } })
      return response.data as PhoneHookMessage[]
    }
  })
}

export function useRetryPhoneHook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await ingesterClient.post(`/phone-hooks/${id}/retry`)
      return response.data as PendingIngestion
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phoneHooks'] })
      queryClient.invalidateQueries({ queryKey: ['pendingIngestions'] })
    }
  })
}

export function useDismissPhoneHook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await ingesterClient.post(`/phone-hooks/${id}/dismiss`)
      return response.data
    },
    onSuccess: (_, id) => {
      queryClient.setQueriesData<PhoneHookMessage[]>({ queryKey: ['phoneHooks'] }, (old) => {
        return old ? old.filter((item) => item.id !== id) : []
      })
      queryClient.invalidateQueries({ queryKey: ['phoneHooks'] })
    }
  })
}
