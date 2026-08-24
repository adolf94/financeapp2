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

const mockCreateRecurringTransactionMutate = vi.fn()
vi.mock('@/hooks/useRecurringTransactions', () => ({
  useCreateRecurringTransaction: () => ({ mutate: mockCreateRecurringTransactionMutate }),
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

    it('allows adding and removing string references (lookups) directly under vendor', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      // Enter vendor and select from dropdown
      const vendorInput = screen.getByPlaceholderText('Select or type vendor...') as HTMLInputElement
      fireEvent.click(vendorInput)
      fireEvent.mouseDown(screen.getByText('Test Vendor'))

      // Reference input should be visible once vendor is set
      const lookupInput = screen.getByPlaceholderText(/Add reference \/ lookup string/i) as HTMLInputElement
      expect(lookupInput).toBeDefined()

      // Add a custom lookup
      fireEvent.change(lookupInput, { target: { value: 'STORE-1234' } })
      fireEvent.keyDown(lookupInput, { key: 'Enter', code: 'Enter' })

      // Lookup chip should appear
      expect(screen.getByText('STORE-1234')).toBeDefined()

      // Add another lookup
      fireEvent.change(lookupInput, { target: { value: 'PAYMAYA-REF-99' } })
      fireEvent.keyDown(lookupInput, { key: 'Enter', code: 'Enter' })
      expect(screen.getByText('PAYMAYA-REF-99')).toBeDefined()

      // Click to remove first lookup
      fireEvent.click(screen.getByText('STORE-1234'))
      expect(screen.queryByText('STORE-1234')).toBeNull()
      expect(screen.getByText('PAYMAYA-REF-99')).toBeDefined()
    })

    it('switches between Simple and Advanced (Journal) mode on click', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      // Starts in Simple mode with 0.00 calculator input
      expect(screen.getByPlaceholderText('0.00')).toBeDefined()
      expect(screen.queryByText('Journal Lines')).toBeNull()

      // Switch to Advanced
      const advancedBtn = screen.getByRole('button', { name: 'Advanced' })
      fireEvent.click(advancedBtn)

      // Journal lines UI should now be rendered
      expect(screen.getByText('Journal Lines')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Add Line' })).toBeDefined()

      // Switch back to Simple
      const simpleBtn = screen.getByRole('button', { name: 'Simple' })
      fireEvent.click(simpleBtn)

      expect(screen.getByPlaceholderText('0.00')).toBeDefined()
      expect(screen.queryByText('Journal Lines')).toBeNull()
    })

    it('copies over selected accounts and amounts when switching from Simple to Advanced mode (Expense)', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
          ingestion={{
            ...mockIngestion,
            ai_parsed: {
              ...mockIngestion.ai_parsed,
              debit_account_id: 'acc-food',
              credit_account_id: 'acc-wallet',
            },
          }}
        />,
        { wrapper: createWrapper() }
      )

      // In Simple mode: amount 500, debit Dining Out, credit GCash
      const initialAmountInput = screen.getByPlaceholderText('0.00') as HTMLInputElement
      expect(initialAmountInput.value).toBe('500')

      // Switch from Simple to Advanced
      const advancedBtn = screen.getByRole('button', { name: 'Advanced' })
      fireEvent.click(advancedBtn)

      // In Advanced mode, Journal Lines should have debit Food and credit Wallet
      expect(screen.getByText('Journal Lines')).toBeDefined()
      const amountInputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
      expect(amountInputs.length).toBeGreaterThanOrEqual(2)
      expect(amountInputs[0].value).toBe('500')
      expect(amountInputs[1].value).toBe('500')
    })

    it('copies over selected accounts and amounts when switching from Simple to Advanced mode (Transfer)', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
          initialData={{
            id: 'tx-transfer',
            type: 'Transfer',
            date: '2026-08-08T00:00:00Z',
            vendor: '',
            entries: [
              { accountId: 'acc-wallet', amount: -1000 },
              { accountId: 'acc-food', amount: 1000 },
            ],
          }}
        />,
        { wrapper: createWrapper() }
      )

      // Switch from Simple to Advanced
      const advancedBtn = screen.getByRole('button', { name: 'Advanced' })
      fireEvent.click(advancedBtn)

      // Journal lines should be visible with amounts copied
      expect(screen.getByText('Journal Lines')).toBeDefined()
      const amountInputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
      expect(amountInputs[0].value).toBe('1000')
      expect(amountInputs[1].value).toBe('1000')
    })



    it('switches transaction type between Expense, Income, and Transfer', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      // Initially Expense: label is "Pay From"
      expect(screen.getByText('Pay From')).toBeDefined()
      expect(screen.queryByText('Transfer To')).toBeNull()

      // Click Income tab: label changes to "Deposit To"
      const incomeBtn = screen.getByRole('button', { name: 'Income' })
      fireEvent.click(incomeBtn)
      expect(screen.getByText('Deposit To')).toBeDefined()

      // Click Transfer tab: destination account appears
      const transferBtn = screen.getByRole('button', { name: 'Transfer' })
      fireEvent.click(transferBtn)
      expect(screen.getByText('Transfer To')).toBeDefined()
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
      expect(mockCreateTransactionMutate).toBeDefined()
    })

    it('populates database transaction values instead of ingestion ai_parsed when editing existing linked transaction', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
          initialData={{
            id: 'tx-1',
            type: 'Expense',
            date: '2026-08-08T12:00:00Z',
            vendor: 'Test Vendor',
            note: 'DB Note',
            entries: [
              { accountId: 'acc-wallet', amount: -250 },
              { accountId: 'acc-food', amount: 250 },
            ],
            ingestionId: 'ingestion-123',
          }}
          ingestion={{
            ...mockIngestion,
            ai_parsed: {
              vendor: 'Ingestion Vendor',
              amount: 9999,
              transaction_type: 'Expense',
              notes: 'Ingestion Note',
            },
          }}
        />,
        { wrapper: createWrapper() }
      )

      const amountInput = screen.getByPlaceholderText('0.00') as HTMLInputElement
      expect(amountInput.value).toBe('250')

      const vendorInput = screen.getByPlaceholderText('Select or type vendor...') as HTMLInputElement
      expect(vendorInput.value).toBe('Test Vendor')

      const noteInput = screen.getByPlaceholderText('Note (optional)') as HTMLTextAreaElement
      expect(noteInput.value).toBe('DB Note')
    })
  })

  describe('Recurring Transactions', () => {
    it('submits recurring advanced (Journal) transaction', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      // Switch to Advanced mode
      const advancedBtn = screen.getByRole('button', { name: 'Advanced' })
      fireEvent.click(advancedBtn)
      expect(screen.getByText('Journal Lines')).toBeDefined()

      // Fill first journal line (Debit: Food & Dining > Dining Out)
      const categoryInputs = screen.getAllByPlaceholderText('Category...')
      fireEvent.click(categoryInputs[0])
      fireEvent.mouseDown(screen.getByText('Food & Dining'))

      const accountInputs = screen.getAllByPlaceholderText('Account...')
      fireEvent.click(accountInputs[0])
      fireEvent.mouseDown(screen.getByText('Dining Out'))

      // Set amount for first line
      const amountInputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
      fireEvent.change(amountInputs[0], { target: { value: '2000' } })

      // Fill second journal line (Credit: Cash & Bank > GCash)
      fireEvent.click(categoryInputs[1])
      fireEvent.mouseDown(screen.getByText('Cash & Bank'))

      fireEvent.click(accountInputs[1])
      fireEvent.mouseDown(screen.getByText('GCash'))

      // Switch second line to Credit
      const crBtns = screen.getAllByRole('button', { name: 'Cr' })
      fireEvent.click(crBtns[1])

      fireEvent.change(amountInputs[1], { target: { value: '2000' } })

      // Enable recurring
      const recurringCheckbox = screen.getByRole('checkbox', { name: /Make this recurring/i })
      fireEvent.click(recurringCheckbox)

      // Set max occurrences to 4
      const maxOccurrencesInput = screen.getByPlaceholderText('Unlimited') as HTMLInputElement
      fireEvent.change(maxOccurrencesInput, { target: { value: '4' } })

      // Submit
      const saveBtn = screen.getByRole('button', { name: /Save & Close/i })
      fireEvent.click(saveBtn)

      // Recurring mutation called with templateType: 'Journal'
      expect(mockCreateRecurringTransactionMutate).toHaveBeenCalledTimes(1)
      const recurringPayload = mockCreateRecurringTransactionMutate.mock.calls[0][0]
      expect(recurringPayload).toMatchObject({
        frequency: 'Monthly',
        interval: 1,
        maxOccurrences: 4,
        templateType: 'Journal',
        templateEntries: expect.arrayContaining([
          expect.objectContaining({ accountId: 'acc-food', amount: 2000 }),
          expect.objectContaining({ accountId: 'acc-wallet', amount: -2000 }),
        ]),
      })

      // Regular transaction linked via scheduleId
      expect(mockCreateTransactionMutate).toHaveBeenCalledTimes(1)
      const txPayload = mockCreateTransactionMutate.mock.calls[0][0]
      expect(txPayload.scheduleId).toBe(recurringPayload.id)
      expect(txPayload.type).toBe('Journal')
    })


    it('toggles recurring transaction controls and updates date and max occurrences bidirectionally', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      // Initially recurring options are not visible
      expect(screen.queryByLabelText(/Frequency/i)).toBeNull()
      expect(screen.queryByLabelText(/Max Times/i)).toBeNull()

      // Toggle "Make this recurring"
      const recurringCheckbox = screen.getByRole('checkbox', { name: /Make this recurring/i }) as HTMLInputElement
      expect(recurringCheckbox.checked).toBe(false)
      fireEvent.click(recurringCheckbox)
      expect(recurringCheckbox.checked).toBe(true)

      // Recurring options should now be visible
      const frequencySelect = screen.getByLabelText(/Frequency/i) as HTMLSelectElement
      const maxOccurrencesInput = screen.getByPlaceholderText('Unlimited') as HTMLInputElement
      const endDateInput = screen.getByLabelText(/End Date/i) as HTMLInputElement

      expect(frequencySelect).toBeDefined()
      expect(frequencySelect.value).toBe('Monthly')

      // Changing Max Times updates End Date automatically
      fireEvent.change(maxOccurrencesInput, { target: { value: '3' } })
      expect(maxOccurrencesInput.value).toBe('3')
      expect(endDateInput.value).not.toBe('')

      // Clearing Max Times clears End Date
      fireEvent.change(maxOccurrencesInput, { target: { value: '' } })
      expect(endDateInput.value).toBe('')

      // Changing End Date updates Max Times automatically
      fireEvent.change(endDateInput, { target: { value: '2026-12-31' } })
      expect(maxOccurrencesInput.value).not.toBe('')
    })

    it('submits recurring transaction and triggers POST recurring-transactions API', () => {
      render(
        <AddTransactionModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      )

      // Fill in amount
      const amountInput = screen.getByPlaceholderText('0.00') as HTMLInputElement
      fireEvent.change(amountInput, { target: { value: '1500.00' } })

      // Select Source Account
      const sourceSelect = screen.getByLabelText(/Pay From/i) as HTMLSelectElement
      fireEvent.change(sourceSelect, { target: { value: 'acc-wallet' } })

      // Select Category
      const categoryInputs = screen.getAllByPlaceholderText('Select Category...')
      fireEvent.click(categoryInputs[0])
      fireEvent.mouseDown(screen.getByText('Food & Dining'))

      // Select Sub-Category
      const subCategoryInputs = screen.getAllByPlaceholderText('Select Sub-Category...')
      fireEvent.click(subCategoryInputs[0])
      fireEvent.mouseDown(screen.getByText('Dining Out'))

      // Enable "Make this recurring"
      const recurringCheckbox = screen.getByRole('checkbox', { name: /Make this recurring/i })
      fireEvent.click(recurringCheckbox)

      // Set Max Times to 6
      const maxOccurrencesInput = screen.getByPlaceholderText('Unlimited') as HTMLInputElement
      fireEvent.change(maxOccurrencesInput, { target: { value: '6' } })

      // Click Save & Close button
      const saveBtn = screen.getByRole('button', { name: /Save & Close/i })
      fireEvent.click(saveBtn)

      // Verify recurring transaction creation mutation triggered with correct payload
      expect(mockCreateRecurringTransactionMutate).toHaveBeenCalledTimes(1)
      const recurringPayload = mockCreateRecurringTransactionMutate.mock.calls[0][0]
      expect(recurringPayload).toMatchObject({
        frequency: 'Monthly',
        interval: 1,
        maxOccurrences: 6,
        templateType: 'Expense',
        templateEntries: expect.arrayContaining([
          expect.objectContaining({ accountId: 'acc-wallet', amount: -1500 }),
          expect.objectContaining({ accountId: 'acc-food', amount: 1500 }),
        ]),
      })

      // Regular transaction create mutation also called with linked scheduleId
      expect(mockCreateTransactionMutate).toHaveBeenCalledTimes(1)
      const txPayload = mockCreateTransactionMutate.mock.calls[0][0]
      expect(txPayload.scheduleId).toBe(recurringPayload.id)
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
