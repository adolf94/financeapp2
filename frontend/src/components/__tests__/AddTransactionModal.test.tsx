import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AddTransactionModal from '../AddTransactionModal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the hooks
vi.mock('@/hooks/useAccounts', () => ({
  useGetAccounts: () => ({ data: [] }),
  useGetAccountGroups: () => ({ data: [] }),
  useCreateAccountGroup: () => ({ mutate: vi.fn() }),
  useCreateAccount: () => ({ mutate: vi.fn() }),
  useGenerateAccountDescription: () => ({ isPending: false }),
}))

vi.mock('@/hooks/useVendors', () => ({
  useGetVendors: () => ({ data: [{ id: 'vendor-1', name: 'Test Vendor', type: 'Business', tags: ['tag1'] }] }),
  useCreateVendor: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateVendor: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useTransactions', () => ({
  useCreateTransaction: () => ({ mutate: vi.fn() }),
  useUpdateTransaction: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/hooks/useRecurringTransactions', () => ({
  useCreateRecurringTransaction: () => ({ mutate: vi.fn() }),
}))

const mockReclassifyMutate = vi.fn()
vi.mock('@/hooks/useIngestions', () => ({
  useGetIngestionById: () => ({ data: null }),
  useConfirmIngestion: () => ({ mutate: vi.fn() }),
  useReclassifyIngestion: () => ({
    mutate: mockReclassifyMutate,
    isPending: false,
  }),
  useUpdateIngestionVendor: () => ({ mutate: vi.fn() }),
  useLearnIngestion: () => ({ mutate: vi.fn() }),
}))

const mockIngestion = {
  id: 'ingestion-123',
  UserId: 'user-123',
  action: 'test',
  raw_msg: 'Spent 500 PHP at Test Vendor',
  raw_payload: {},
  status: 'Pending',
  month_key: '2026-08',
  partition_key: 'user-123',
  received_at: '2026-08-08T09:19:17Z',
  ai_parsed: {
    vendor: 'Test Vendor',
    amount: 500,
    transaction_type: 'Expense',
    confidence: 0.95,
  },
} as any

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('AddTransactionModal Reclassify Button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders reclassify buttons when ingestion exists', () => {
    render(
      <AddTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        ingestion={mockIngestion}
      />,
      { wrapper: createWrapper() }
    )

    // The header button has the tooltip title
    const headerBtn = screen.getByTitle(/Re-run AI classification/)
    expect(headerBtn).toBeDefined()

    // The sidebar button has the text
    const sidebarBtn = screen.getByRole('button', { name: /Re-run AI Classification/i })
    expect(sidebarBtn).toBeDefined()
  })

  it('opens confirmation modal and triggers reclassify on confirm', async () => {
    render(
      <AddTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        ingestion={mockIngestion}
      />,
      { wrapper: createWrapper() }
    )

    const sidebarBtn = screen.getByRole('button', { name: /Re-run AI Classification/i })
    fireEvent.click(sidebarBtn)

    // Verify confirmation modal is open
    expect(screen.getByText('Re-run AI Classification')).toBeDefined()
    expect(
      screen.getByText(/Are you sure you want to re-run AI classification/)
    ).toBeDefined()

    // Click confirm inside confirmation modal
    const confirmBtn = screen.getByRole('button', { name: 'Reclassify' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockReclassifyMutate).toHaveBeenCalledWith('ingestion-123')
    })
  })

  it('renders edit vendor button when a matching vendor is selected', () => {
    render(
      <AddTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        initialData={{
          id: 'tx-1',
          type: 'Expense',
          date: '2026-08-08T00:00:00Z',
          vendor: 'Test Vendor',
          entries: []
        }}
      />,
      { wrapper: createWrapper() }
    )

    const editBtn = screen.getByTitle('Edit selected vendor')
    expect(editBtn).toBeDefined()
  })

  it('opens EditVendorModal when edit button is clicked', () => {
    render(
      <AddTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        initialData={{
          id: 'tx-1',
          type: 'Expense',
          date: '2026-08-08T00:00:00Z',
          vendor: 'Test Vendor',
          entries: []
        }}
      />,
      { wrapper: createWrapper() }
    )

    const editBtn = screen.getByTitle('Edit selected vendor')
    fireEvent.click(editBtn)

    expect(screen.getByText('Edit Vendor')).toBeDefined()
  })
})
