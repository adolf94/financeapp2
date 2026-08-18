import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CalculatorInput from '../CalculatorInput'

describe('CalculatorInput', () => {
  it('updates value when typed or pasted without calculator popup', () => {
    const handleChange = vi.fn()
    render(<CalculatorInput value="" onChange={handleChange} placeholder="0.00" />)

    const input = screen.getByPlaceholderText('0.00') as HTMLInputElement
    fireEvent.change(input, { target: { value: '205.45' } })

    expect(handleChange).toHaveBeenCalledWith('205.45')
  })

  it('sanitizes pasted formatted amounts with currency symbols and commas', () => {
    const handleChange = vi.fn()
    render(<CalculatorInput value="" onChange={handleChange} placeholder="0.00" />)

    const input = screen.getByPlaceholderText('0.00') as HTMLInputElement
    fireEvent.paste(input, {
      clipboardData: {
        getData: (format: string) => (format === 'text' ? '₱ 205.45' : ''),
      },
    })

    expect(handleChange).toHaveBeenCalledWith('205.45')
  })

  it('sanitizes pasted amounts with thousand commas and decimal comma if needed', () => {
    const handleChange = vi.fn()
    render(<CalculatorInput value="" onChange={handleChange} placeholder="0.00" />)

    const input = screen.getByPlaceholderText('0.00') as HTMLInputElement
    fireEvent.paste(input, {
      clipboardData: {
        getData: (format: string) => (format === 'text' ? '205,45' : ''),
      },
    })

    expect(handleChange).toHaveBeenCalledWith('205.45')
  })

  it('evaluates expression on Enter', () => {
    const handleChange = vi.fn()
    render(<CalculatorInput value="100+50" onChange={handleChange} placeholder="0.00" />)

    const input = screen.getByPlaceholderText('0.00') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(handleChange).toHaveBeenCalledWith('150.00')
  })
})
