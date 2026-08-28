import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'

export interface Vendor {
  id?: string
  userId?: string
  name: string
  type?: 'Individual' | 'Business' | 'Internal'
  tags?: string[]
  lookups?: string[]
  lastUsed?: string
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

export interface VendorLookupItem {
  id: string
  userId: string
  vendorId: string
  lookupValue: string
  hits: number
}

export function useGetVendorLookups(vendorId?: string) {
  return useQuery<VendorLookupItem[]>({
    queryKey: ['vendorLookups', vendorId],
    queryFn: async () => {
      if (!vendorId) return []
      const response = await apiClient.get(`/vendors/${vendorId}/lookups`)
      return response.data
    },
    enabled: !!vendorId,
  })
}

export function useAddVendorLookup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ vendorId, lookup }: { vendorId: string; lookup: string }) => {
      const response = await apiClient.post(`/vendors/${vendorId}/lookups`, { lookup })
      return response.data as VendorLookupItem
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vendorLookups', variables.vendorId] })
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}

export function useDeleteVendorLookup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ lookupId }: { vendorId: string; lookupId: string }) => {
      await apiClient.delete(`/vendors/lookups/${lookupId}`)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vendorLookups', variables.vendorId] })
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}

