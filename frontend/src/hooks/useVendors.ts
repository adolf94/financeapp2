import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'

export interface Vendor {
  id?: string
  userId?: string
  name: string
  type?: 'Individual' | 'Business' | 'Internal'
  tags?: string[]
}

export function useGetVendors() {
  return useQuery<Vendor[]>({
    queryKey: ['vendors'],
    queryFn: async () => {
      const response = await apiClient.get('/vendors')
      return response.data
    },
  })
}

export function useCreateVendor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vendor: Partial<Vendor>) => {
      const response = await apiClient.post('/vendors', vendor)
      return response.data as Vendor
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}

export function useDeleteVendor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/vendors/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}

export function useUpdateVendor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vendor: Vendor) => {
      const response = await apiClient.put(`/vendors/${vendor.id}`, vendor)
      return response.data as Vendor
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}
