import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ErrorNotificationsList from '../ErrorNotificationsList'
import { PhoneHookMessage } from '@/hooks/useIngestions'

vi.mock('@/hooks/useIngestions', () => ({
  useRetryPhoneHook: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDismissPhoneHook: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

describe('ErrorNotificationsList', () => {
  it('renders empty message when there are no errors', () => {
    render(<ErrorNotificationsList phoneHooks={[]} errorIngestions={[]} />)
    expect(screen.getByText(/No errored notifications found/i)).toBeDefined()
  })

  it('renders phone hook error items with error details and actions', () => {
    const mockHooks: PhoneHookMessage[] = [
      {
        id: 'hook-1',
        received_at: '2026-08-20T01:00:00Z',
        action: 'sms_received',
        raw_payload: { error: 'Gemini model rate limited' },
        raw_msg: 'Payment of PHP 500 received',
        status: 'error',
        month_key: '2026-08-01',
        partition_key: 'default',
        notification_type: 'sms',
        processing_metadata: { error: 'Gemini model rate limited' }
      }
    ]

    render(<ErrorNotificationsList phoneHooks={mockHooks} errorIngestions={[]} />)
    expect(screen.getByText(/Failed Ingestions & Hooks \(1\)/i)).toBeDefined()
    expect(screen.getByText(/Payment of PHP 500 received/i)).toBeDefined()
    expect(screen.getByText(/Gemini model rate limited/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /Retry Processing/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Dismiss/i })).toBeDefined()
  })
})

