import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'

export type Frequency = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'

export interface RecurringTransactionOccurrence {
  date: string
  occurrenceNo: number
  status: string
  transactionId?: string
}

export interface RecurringLedgerEntry {
  accountId: string
  amount: number
  comment?: string
}

export interface RecurringTransaction {
  id?: string
  userId?: string
  frequency: Frequency
  interval: number
  startDate: string
  endDate?: string
  maxOccurrences?: number
  nextOccurrenceDate?: string
  templateType: 'Income' | 'Expense' | 'Transfer' | 'Journal'
  templateNote: string
  templateVendor?: string
  templateEntries: RecurringLedgerEntry[]
  occurrences?: RecurringTransactionOccurrence[]
}

export function useGetRecurringTransactions() {
  return useQuery<RecurringTransaction[]>({
    queryKey: ['recurringTransactions'],
    queryFn: async () => {
      const response = await apiClient.get('/recurring-transactions')
      return response.data
    }
  })
}

export function useCreateRecurringTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tx: RecurringTransaction) => {
      const response = await apiClient.post('/recurring-transactions', tx)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringTransactions'] })
    }
  })
}

export function useUpdateRecurringTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tx: RecurringTransaction) => {
      const response = await apiClient.put(`/recurring-transactions/${tx.id}`, tx)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringTransactions'] })
    }
  })
}

export function useDeleteRecurringTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/recurring-transactions/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringTransactions'] })
    }
  })
}
