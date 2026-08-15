// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAdjustBalance, AdjustmentRequest } from '../useAdjustment'
import apiClient from '@/lib/apiClient'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'

vi.mock('@/lib/apiClient')

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useAdjustment hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls adjust endpoint and invalidates caches on success', async () => {
    const mockCreatedTx = {
      id: 'tx-1',
      type: 'Journal',
      note: 'Balance adjustment',
      entries: [
        { accountId: 'acc-1', amount: 150 },
        { accountId: 'acc-adj', amount: -150 },
      ],
    }

    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: mockCreatedTx })

    const { result } = renderHook(() => useAdjustBalance(), {
      wrapper: createWrapper(),
    })

    const payload: AdjustmentRequest = {
      actualBalance: 650,
      note: 'Balance adjustment',
    }

    result.current.mutate({ accountId: 'acc-1', data: payload })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.post).toHaveBeenCalledWith('/accounts/acc-1/adjust', payload)
    expect(result.current.data).toEqual(mockCreatedTx)
  })
})
