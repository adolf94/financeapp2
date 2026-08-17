import { useState, useCallback } from 'react'
import dayjs from 'dayjs'

export function useRecurringScheduleState(baseDate: string) {
  const [isRecurring, setIsRecurring] = useState(false)
  const [frequency, setFrequency] = useState<'Daily' | 'Weekly' | 'Monthly' | 'Yearly'>('Monthly')
  const [maxOccurrences, setMaxOccurrences] = useState('')
  const [recurringEndDate, setRecurringEndDate] = useState('')

  const calcEndDateFromOccurrences = useCallback(
    (occurrencesCount: number, startDateStr: string, freq: string) => {
      if (!occurrencesCount || occurrencesCount < 1) return ''
      const d = dayjs(startDateStr)
      const units = occurrencesCount - 1
      if (units <= 0) return d.format('YYYY-MM-DD')

      switch (freq) {
        case 'Daily':
          return d.add(units, 'day').format('YYYY-MM-DD')
        case 'Weekly':
          return d.add(units, 'week').format('YYYY-MM-DD')
        case 'Monthly':
          return d.add(units, 'month').format('YYYY-MM-DD')
        case 'Yearly':
          return d.add(units, 'year').format('YYYY-MM-DD')
        default:
          return d.add(units, 'month').format('YYYY-MM-DD')
      }
    },
    []
  )

  const calcOccurrencesFromEndDate = useCallback(
    (endDateStr: string, startDateStr: string, freq: string) => {
      if (!endDateStr) return ''
      const start = dayjs(startDateStr)
      const end = dayjs(endDateStr)
      if (end.isBefore(start, 'day')) return '1'

      let count = 0
      let curr = start
      while (!curr.isAfter(end, 'day') && count < 1000) {
        count++
        switch (freq) {
          case 'Daily':
            curr = curr.add(1, 'day')
            break
          case 'Weekly':
            curr = curr.add(1, 'week')
            break
          case 'Monthly':
            curr = curr.add(1, 'month')
            break
          case 'Yearly':
            curr = curr.add(1, 'year')
            break
          default:
            curr = curr.add(1, 'month')
            break
        }
      }
      return count > 0 ? String(count) : '1'
    },
    []
  )

  const handleRecurringOccurrencesChange = useCallback(
    (val: string) => {
      setMaxOccurrences(val)
      if (!val || parseInt(val) < 1) {
        setRecurringEndDate('')
      } else {
        const computedEnd = calcEndDateFromOccurrences(parseInt(val), baseDate, frequency)
        setRecurringEndDate(computedEnd)
      }
    },
    [baseDate, frequency, calcEndDateFromOccurrences]
  )

  const handleRecurringEndDateChange = useCallback(
    (val: string) => {
      setRecurringEndDate(val)
      if (!val) {
        setMaxOccurrences('')
      } else {
        const computedOcc = calcOccurrencesFromEndDate(val, baseDate, frequency)
        setMaxOccurrences(computedOcc)
      }
    },
    [baseDate, frequency, calcOccurrencesFromEndDate]
  )

  const resetRecurringState = useCallback(() => {
    setIsRecurring(false)
    setFrequency('Monthly')
    setMaxOccurrences('')
    setRecurringEndDate('')
  }, [])

  return {
    isRecurring,
    setIsRecurring,
    frequency,
    setFrequency,
    maxOccurrences,
    setMaxOccurrences,
    recurringEndDate,
    setRecurringEndDate,
    handleRecurringOccurrencesChange,
    handleRecurringEndDateChange,
    resetRecurringState,
  }
}
