import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import AddTransactionModal from '../AddTransactionModal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the hooks
const mockAccounts = [
  { id: 'acc-wallet', name: 'GCash', accountGroupId: 'group-asset' },
  { id: 'acc-food', name: 'Dining Out', accountGroupId: 'group-expense' },
]
const mockAccountGroups = [
  { id: 'group-asset', name: 'Cash & Bank', accountType: 'Asset' },
  { id: 'group-expense', name: 'Food & Dining', accountType: 'Expense' },
]
vi.mock('@/hooks/useAccounts', () => ({
  useGetAccounts: () => ({ data: mockAccounts }),
  useGetAccountGroups: () => ({ data: mockAccountGroups }),
  useCreateAccountGroup: () => ({ mutate: vi.fn() }),
  useCreateAccount: () => ({ mutate: vi.fn() }),
  useGenerateAccountDescription: () => ({ isPending: false }),
}))

vi.mock('@/hooks/useVendors', () => ({
  useGetVendors: () => ({ data: [{ id: 'vendor-1', name: 'Test Vendor', type: 'Business', tags: ['tag1'] }] }),
  useCreateVendor: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateVendor: () => ({ mutate: vi.fn(), isPending: false }),
}))

const mockCreateTransactionMutate = vi.fn()
vi.mock('@/hooks/useTransactions', () => ({
  useCreateTransaction: () => ({ mutate: mockCreateTransactionMutate }),
  useUpdateTransaction: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/hooks/useRecurringTransactions', () => ({
  useCreateRecurringTransaction: () => ({ mutate: vi.fn() }),
}))

const mockReclassifyMutate = vi.fn()
vi.mock('@/hooks/useIngestions', () => ({
  useGetIngestionById: () => ({ data: null }),
  useGetPendingIngestions: () => ({ data: [] }),
  useConfirmIngestion: () => ({ mutate: vi.fn() }),
  useReclassifyIngestion: () => ({
    mutate: mockReclassifyMutate,
    isPending: false,
  }),
  useUpdateIngestionVendor: () => ({ mutate: vi.fn() }),
  useLearnIngestion: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/components/AuthenticatedReceiptImage', () => ({
  default: () => <div data-testid="auth-receipt-image" />,
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

describe('AddTransactionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Reclassification', () => {
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
      const reclassifyBtns = screen.getAllByRole('button', { name: /Re-run AI Classification/i })
      expect(reclassifyBtns.length).toBeGreaterThanOrEqual(1)
    })

    it('opens confirmation modal, accepts comments, and triggers reclassify with userCorrections', async () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
          ingestion={mockIngestion}
        />,
        { wrapper: createWrapper() }
      )

      const reclassifyBtns = screen.getAllByRole('button', { name: /Re-run AI Classification/i })
      const sidebarBtn = reclassifyBtns[reclassifyBtns.length - 1]
      fireEvent.click(sidebarBtn)

      // Verify confirmation modal is open
      expect(screen.getByRole('heading', { name: 'Re-run AI Classification' })).toBeDefined()

      // Type a comment in the textarea
      const commentInput = screen.getByPlaceholderText(/Treat this as a Food & Dining expense/i)
      fireEvent.change(commentInput, { target: { value: 'Fix category to Utilities' } })

      // Click confirm inside confirmation modal
      const confirmBtn = screen.getByRole('button', { name: 'Reclassify' })
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockReclassifyMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'ingestion-123',
            userCorrections: expect.objectContaining({
              comment: 'Fix category to Utilities',
            }),
          })
        )
      })
    })
  })

  describe('Vendor Handling', () => {
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

    it('preserves user modifications to form fields when vendor is changed', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
          ingestion={mockIngestion}
        />,
        { wrapper: createWrapper() }
      )

      // Initially amount is 500 from mockIngestion
      const amountInput = screen.getByPlaceholderText('0.00') as HTMLInputElement
      expect(amountInput.value).toBe('500')

      // User modifies amount and note
      fireEvent.change(amountInput, { target: { value: '1250' } })
      expect(amountInput.value).toBe('1250')

      const noteInput = screen.getByPlaceholderText('Note (optional)') as HTMLTextAreaElement
      fireEvent.change(noteInput, { target: { value: 'Dinner with team' } })
      expect(noteInput.value).toBe('Dinner with team')

      // User changes vendor
      const vendorInput = screen.getByPlaceholderText('Select or type vendor...') as HTMLInputElement
      fireEvent.change(vendorInput, { target: { value: 'New Restaurant' } })

      // User's modified amount and note must remain unchanged
      expect(amountInput.value).toBe('1250')
      expect(noteInput.value).toBe('Dinner with team')
      expect(vendorInput.value).toBe('New Restaurant')
    })
  })

  describe('Form Submission', () => {
    it('submits correctly when editing transaction', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
          initialData={{
            id: 'tx-1',
            type: 'Expense',
            date: '2026-08-08T00:00:00Z',
            vendor: 'Test Vendor',
            entries: [
              { accountId: 'acc-wallet', amount: -100 },
              { accountId: 'acc-food', amount: 100 },
            ],
          }}
        />,
        { wrapper: createWrapper() }
      )

      // Edit amount
      const amountInput = screen.getByPlaceholderText('0.00') as HTMLInputElement
      fireEvent.change(amountInput, { target: { value: '205.45' } })

      // Click Save Changes
      const saveBtn = screen.getByRole('button', { name: /Save Changes/i })
      fireEvent.click(saveBtn)

      expect(mockCreateTransactionMutate).toBeDefined()
    })
  })

  describe('Discard & Confirmation', () => {
    it('closes immediately without confirmation when no edits are pending', () => {
      const onCloseMock = vi.fn()
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={onCloseMock}
          ingestion={mockIngestion}
        />,
        { wrapper: createWrapper() }
      )

      const headerCloseBtn = screen.getByRole('button', { name: 'Close modal' })
      fireEvent.click(headerCloseBtn)

      expect(onCloseMock).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Discard Changes?')).toBeNull()
    })

    it('shows confirmation dialog when closing with pending edits and cancels or confirms correctly', () => {
      const onCloseMock = vi.fn()
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={onCloseMock}
          ingestion={mockIngestion}
        />,
        { wrapper: createWrapper() }
      )

      // Edit a field
      const noteInput = screen.getByPlaceholderText('Note (optional)') as HTMLTextAreaElement
      fireEvent.change(noteInput, { target: { value: 'Changed notes' } })

      const headerCloseBtn = screen.getByRole('button', { name: 'Close modal' })
      fireEvent.click(headerCloseBtn)

      // Confirmation dialog should be visible
      expect(screen.getByText('Discard Changes?')).toBeDefined()
      expect(screen.getByText(/You have unsaved changes/i)).toBeDefined()
      expect(onCloseMock).not.toHaveBeenCalled()

      // Click "Keep Editing"
      const cancelBtn = screen.getByRole('button', { name: 'Keep Editing' })
      fireEvent.click(cancelBtn)
      expect(screen.queryByText('Discard Changes?')).toBeNull()
      expect(onCloseMock).not.toHaveBeenCalled()

      // Try closing again and confirm discard
      fireEvent.click(headerCloseBtn)
      expect(screen.getByText('Discard Changes?')).toBeDefined()

      const confirmBtn = screen.getByRole('button', { name: 'Discard Changes' })
      fireEvent.click(confirmBtn)

      expect(onCloseMock).toHaveBeenCalledTimes(1)
    })
  })
})
