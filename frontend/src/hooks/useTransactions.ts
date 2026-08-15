import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'

export interface LedgerEntry {
  id?: string
  accountId: string
  amount: number
  comment?: string
}

export interface Transaction {
  id?: string
  scheduleId?: string
  vendor?: string | null
  date: string
  note?: string
  referenceNumber?: string | null
  type: 'Income' | 'Expense' | 'Transfer' | 'Journal'
  entries: LedgerEntry[]
  isAutoConfirmed?: boolean
  ingestionId?: string | null
}

export function useGetTransactions(startDate?: string, endDate?: string, accountGroupId?: string) {
  return useQuery<Transaction[]>({
    queryKey: ['transactions', startDate, endDate, accountGroupId],
    queryFn: async () => {
      const response = await apiClient.get('/transactions', {
        params: { startDate, endDate, accountGroupId },
      })
      return response.data
    },
  })
}

export function useGetAccountTransactions(accountId: string) {
  return useQuery<Transaction[]>({
    queryKey: ['transactions', 'account', accountId],
    queryFn: async () => {
      const response = await apiClient.get(`/accounts/${accountId}/transactions`)
      return response.data
    },
    enabled: !!accountId
  })
}

export function useGetTransactionById(id?: string | null) {
  return useQuery<Transaction>({
    queryKey: ['transaction', id],
    queryFn: async () => {
      const response = await apiClient.get(`/transactions/${id}`)
      return response.data
    },
    enabled: !!id
  })
}

export function useCreateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (transaction: Transaction) => {
      const response = await apiClient.post('/transactions', transaction)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] }) // Accounts balance is updated
    },
  })
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (transaction: Transaction) => {
      const response = await apiClient.put(`/transactions/${transaction.id}`, transaction)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] }) // Accounts balance is updated
    },
  })
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/transactions/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] }) // Accounts balance is updated
    },
  })
}
