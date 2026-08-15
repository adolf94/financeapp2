import { useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'

export interface AdjustmentRequest {
  actualBalance: number
  date?: string
  note?: string
}

export function useAdjustBalance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      accountId,
      data,
    }: {
      accountId: string
      data: AdjustmentRequest
    }) => {
      const response = await apiClient.post(`/accounts/${accountId}/adjust`, data)
      return response.data
    },
    onSuccess: (_, { accountId }) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accountGroups'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['account', accountId] })
    },
  })
}
