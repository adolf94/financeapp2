import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeAll } from 'vitest'
import { RunbookChatPanel } from '../RunbookChatPanel'
import { ChatMessage } from '@/hooks/useRunbookReview'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

function renderPanel({
  chatHistory = [] as ChatMessage[],
  pendingAnswers = [] as { key: string; qNum: string; answer: string }[],
  onAnswerChange = vi.fn(),
  onSendMessage = vi.fn(),
  isThinking = false,
  sessionActive = true,
} = {}) {
  const result = render(
    <RunbookChatPanel
      chatHistory={chatHistory}
      isThinking={isThinking}
      onSendMessage={onSendMessage}
      sessionActive={sessionActive}
      pendingAnswers={pendingAnswers}
      onAnswerChange={onAnswerChange}
    />
  )
  return result
}

describe('RunbookChatPanel', () => {
  it('renders AI and user messages with their text', () => {
    renderPanel({
      chatHistory: [
        { role: 'ai', text: 'Here are some questions for you.', questions: [] },
        { role: 'user', text: 'My reply here.', questions: [] },
      ],
    })

    expect(screen.getByText('Here are some questions for you.')).toBeDefined()
    expect(screen.getByText('My reply here.')).toBeDefined()
  })

  it('renders each question with its Qid number and text', () => {
    renderPanel({
      chatHistory: [
        {
          role: 'ai',
          text: 'Clarifications',
          questions: [
            { Qid: 'Q1', Q: 'What bank is this?' },
            { Qid: 'Q2', Q: 'Was this an expense?' },
          ],
        },
      ],
    })

    expect(screen.getByText('What bank is this?')).toBeDefined()
    expect(screen.getByText('Was this an expense?')).toBeDefined()
    expect(screen.getByText('Q1')).toBeDefined()
    expect(screen.getByText('Q2')).toBeDefined()
  })

  it('keeps Qt continuous numbering beyond 9 from Qid', () => {
    renderPanel({
      chatHistory: [
        {
          role: 'ai',
          text: 'Clarifications',
          questions: [{ Qid: 'Q10', Q: 'Continue?' }],
        },
      ],
    })

    expect(screen.getByText('Q10')).toBeDefined()
  })

  it('calls onAnswerChange with key, qNum, and value when typing', () => {
    const onAnswerChange = vi.fn()
    renderPanel({
      chatHistory: [
        {
          role: 'ai',
          text: 'Clarifications',
          questions: [{ Qid: 'Q1', Q: 'What bank is this?' }],
        },
      ],
      onAnswerChange,
    })

    const textarea = screen.getByPlaceholderText('Your answer...')
    fireEvent.change(textarea, { target: { value: 'BPI' } })

    expect(onAnswerChange).toHaveBeenCalledWith('0-0', '1', 'BPI')
  })

  it('makes the answer textarea readonly once an answer is provided', () => {
    renderPanel({
      chatHistory: [
        {
          role: 'ai',
          text: 'Clarifications',
          questions: [{ Qid: 'Q1', Q: 'What bank is this?' }],
        },
      ],
      pendingAnswers: [{ key: '0-0', qNum: '1', answer: 'BPI' }],
    })

    const textarea = screen.getByPlaceholderText('Your answer...') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)
    expect(textarea.value).toBe('BPI')
  })

  it('leaves the answer textarea editable while empty', () => {
    renderPanel({
      chatHistory: [
        {
          role: 'ai',
          text: 'Clarifications',
          questions: [{ Qid: 'Q1', Q: 'What bank is this?' }],
        },
      ],
    })

    const textarea = screen.getByPlaceholderText('Your answer...') as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(false)
  })

  it('sends the typed message and clears the input', () => {
    const onSendMessage = vi.fn()
    renderPanel({ onSendMessage })

    const input = screen.getByPlaceholderText('Ask for tweaks or general comments... (Shift+Enter for new line)')
    fireEvent.change(input, { target: { value: 'Sounds good' } })

    fireEvent.click(screen.getByRole('button'))

    expect(onSendMessage).toHaveBeenCalledWith('Sounds good')
    expect((input as HTMLTextAreaElement).value).toBe('')
  })

  it('sends on Enter press without shift', () => {
    const onSendMessage = vi.fn()
    renderPanel({ onSendMessage })

    const input = screen.getByPlaceholderText('Ask for tweaks or general comments... (Shift+Enter for new line)')
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSendMessage).toHaveBeenCalledWith('Hello')
  })

  it('shows thinking indicator while isThinking', () => {
    renderPanel({
      chatHistory: [{ role: 'ai', text: 'Hello', questions: [] }],
      isThinking: true,
    })
    expect(screen.getByText('AI is thinking...')).toBeDefined()
  })
})
