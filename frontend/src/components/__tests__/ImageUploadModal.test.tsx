import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import ImageUploadModal from '../ImageUploadModal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockMutateAsync = vi.fn()
vi.mock('@/hooks/useIngestions', () => ({
  useUploadImage: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('ImageUploadModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    window.URL.revokeObjectURL = vi.fn()
  })

  it('renders upload modal when open', () => {
    render(<ImageUploadModal isOpen={true} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByText(/Upload Receipt \/ Invoice/i)).toBeDefined()
    expect(screen.getByText(/Click to browse or drop receipt image here/i)).toBeDefined()
  })

  it('handles image selection and shows preview', async () => {
    render(<ImageUploadModal isOpen={true} onClose={vi.fn()} />, {
      wrapper: createWrapper(),
    })

    const file = new File(['dummy-image-content'], 'receipt.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    expect(screen.getByText('receipt.png')).toBeDefined()
    expect(screen.getByRole('button', { name: /Process Receipt/i })).toBeDefined()
  })

  it('triggers upload mutation on Process Receipt click', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      ingestion_id: 'img-ingestion-123',
      status: 'processing',
    })

    const onSuccess = vi.fn()
    const onClose = vi.fn()
    const onStreamReasoningStart = vi.fn()

    render(
      <ImageUploadModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        onStreamReasoningStart={onStreamReasoningStart}
      />,
      { wrapper: createWrapper() }
    )

    const file = new File(['dummy-image-content'], 'invoice.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    const descInput = screen.getByPlaceholderText(/e\.g\., Team lunch at Bistro/i)
    fireEvent.change(descInput, { target: { value: 'Business Lunch with Client' } })

    const processBtn = screen.getByRole('button', { name: /Process Receipt/i })
    fireEvent.click(processBtn)

    await waitFor(() => {
      expect(onStreamReasoningStart).toHaveBeenCalledWith(expect.any(String))
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          file,
          description: 'Business Lunch with Client',
          streamReasoning: true,
        })
      )
      expect(onSuccess).toHaveBeenCalledWith('img-ingestion-123', expect.any(String), true)
      expect(onClose).toHaveBeenCalled()
    })
  })
})

