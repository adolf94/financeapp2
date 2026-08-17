import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGetRecurringTransactions, useUpdateRecurringTransaction, useDeleteRecurringTransaction } from '../useRecurringTransactions'
import apiClient from '@/lib/apiClient'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/apiClient')

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useRecurringTransactions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('fetches recurring transactions successfully', async () => {
    const mockData = [
      { 
        id: '1', 
        frequency: 'Monthly',
        interval: 1,
        startDate: '2023-01-01',
        templateType: 'Expense',
        templateNote: 'Spotify',
        templateEntries: []
      }
    ]
    
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockData })

    const { result } = renderHook(() => useGetRecurringTransactions(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockData)
    expect(apiClient.get).toHaveBeenCalledWith('/recurring-transactions')
  })
  
  it('handles error when fetching fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Failed to fetch recurring transactions'))

    const { result } = renderHook(() => useGetRecurringTransactions(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('Failed to fetch recurring transactions')
  })

  it('updates a recurring transaction with status', async () => {
    const mockTx = {
      id: '1',
      status: 'Active' as const,
      frequency: 'Monthly' as const,
      interval: 1,
      startDate: '2023-01-01',
      templateType: 'Expense' as const,
      templateNote: 'Updated Spotify',
      templateEntries: []
    }

    vi.mocked(apiClient.put).mockResolvedValueOnce({ data: mockTx })

    const { result } = renderHook(() => useUpdateRecurringTransaction(), { wrapper: createWrapper() })

    result.current.mutate(mockTx)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.put).toHaveBeenCalledWith('/recurring-transactions/1', mockTx)
  })

  it('soft-deletes a recurring transaction via delete mutation', async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({ data: null })

    const { result } = renderHook(() => useDeleteRecurringTransaction(), { wrapper: createWrapper() })

    result.current.mutate('1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.delete).toHaveBeenCalledWith('/recurring-transactions/1')
  })
})
