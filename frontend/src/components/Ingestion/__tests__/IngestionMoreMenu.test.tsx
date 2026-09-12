import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import IngestionMoreMenu from '../IngestionMoreMenu'

const mockMutate = vi.fn()

vi.mock('@/hooks/useIngestions', () => ({
  useReclassifyIngestion: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}))

describe('IngestionMoreMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Reclassify and Loans App options in the more menu', () => {
    render(<IngestionMoreMenu ingestionId="ing-1" />)
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    expect(screen.getByRole('menuitem', { name: /reclassify/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /integration: loans app/i })).toBeDefined()
  })

  it('triggers the reclassify mutation with an operationId and emits reclassifyStarted', () => {
    const startedListener = vi.fn()
    window.addEventListener('reclassifyStarted', startedListener)

    render(<IngestionMoreMenu ingestionId="ing-2" />)
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /reclassify/i }))

    expect(mockMutate).toHaveBeenCalledTimes(1)
    const args = mockMutate.mock.calls[0][0]
    expect(args.id).toBe('ing-2')
    expect(typeof args.operationId).toBe('string')
    expect(startedListener).toHaveBeenCalledTimes(1)

    window.removeEventListener('reclassifyStarted', startedListener)
  })

  it('opens the Loans App with ingestion_id in a new tab', () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    render(<IngestionMoreMenu ingestionId="ing-3" />)
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /integration: loans app/i }))

    expect(openSpy).toHaveBeenCalledTimes(1)
    const [url, target] = openSpy.mock.calls[0]
    expect(url).toContain('ingestion_id=ing-3')
    expect(target).toBe('_blank')
    vi.unstubAllGlobals()
  })
})
