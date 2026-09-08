import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { AppRunbookPicker, AppRunbookOption } from '../AppRunbookPicker'

const options: AppRunbookOption[] = [
  { packageId: 'com.example.gcash', label: 'GCash', configured: true },
  { packageId: 'com.example.maya', configured: false },
]

describe('AppRunbookPicker', () => {
  it('renders global option and package options', () => {
    render(
      <AppRunbookPicker selectedPkg="" options={options} onChange={vi.fn()} />
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const texts = Array.from(select.options).map((o) => o.textContent)
    expect(texts).toContain('App Runbook (Global)')
    expect(texts.some((t) => t === 'GCash — com.example.gcash')).toBe(true)
    expect(texts.some((t) => t === 'com.example.maya (no runbook yet)')).toBe(true)
  })

  it('calls onChange with the selected package id', () => {
    const onChange = vi.fn()
    render(
      <AppRunbookPicker selectedPkg="" options={options} onChange={onChange} />
    )
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'com.example.gcash' },
    })
    expect(onChange).toHaveBeenCalledWith('com.example.gcash')
  })

  it('is disabled when an active session exists', () => {
    render(
      <AppRunbookPicker selectedPkg="com.example.gcash" options={options} onChange={vi.fn()} disabled />
    )
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  })
})
