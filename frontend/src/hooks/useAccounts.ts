import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'
import ingesterClient from '@/lib/ingesterClient'

export interface AccountGroup {
  id: string
  name: string
  accountType?: 'Cash' | 'Bank' | 'CreditCard' | 'Investment' | string
}

export interface Account {
  id?: string
  name: string
  description?: string
  tags?: string[]
  accountGroupId: string
  startingBalance: number
  currentBalance?: number
  accountType: 'Cash' | 'Bank' | 'CreditCard' | 'Investment' | 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense' | 'Adjustment'
  creditCardCycleStartDay?: number | null
  creditCardPaymentDueDay?: number | null
}

export function useGetAccounts() {
  return useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const response = await apiClient.get('/accounts')
      return response.data
    },
  })
}

export function useCreateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (account: Account) => {
      const response = await apiClient.post('/accounts', account)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (account: Account) => {
      const response = await apiClient.put(`/accounts/${account.id}`, account)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/accounts/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useGetAccountGroups() {
  return useQuery<AccountGroup[]>({
    queryKey: ['accountGroups'],
    queryFn: async () => {
      const response = await apiClient.get('/account-groups')
      return response.data
    },
  })
}

export function useCreateAccountGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (group: { name: string; accountType?: string }) => {
      const response = await apiClient.post('/account-groups', group)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountGroups'] })
    },
  })
}

export function useGenerateAccountDescription() {
  return useMutation({
    mutationFn: async (data: { name: string, type: string, groupName: string, context?: string }) => {
      // Goes directly to Python ingester (JWT Bearer, no .NET proxy)
      const response = await ingesterClient.post<any>('/accounts/generate-description', {
        account_name: data.name,
        account_type: data.type,
        group_name: data.groupName,
        context: data.context
      })
      let resData = response.data
      if (typeof resData === 'string') {
        try {
          resData = JSON.parse(resData)
        } catch (e) {
          console.error('Failed to parse generate-description response:', e)
        }
      }
      return resData as { description: string; tags: string[] }
    }
  })
}

export function useDeleteAccountGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/account-groups/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountGroups'] })
    },
  })
}
