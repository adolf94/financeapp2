import { useState, useMemo } from 'react'
import { X, Pencil, CheckCircle2, Clock, AlertCircle, ExternalLink, ArrowDownRight, ArrowUpRight, ArrowRightLeft, BookOpen, Layers, Building2 } from 'lucide-react'
import dayjs from 'dayjs'
import { RecurringTransaction, useUpdateRecurringTransaction } from '@/hooks/useRecurringTransactions'
import { useGetAccounts } from '@/hooks/useAccounts'

interface Props {
  isOpen: boolean
  onClose: () => void
  recurringTx: RecurringTransaction
}

const STATUS_STYLES: Record<string, string> = {
  Processed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  Failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  Skipped: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  Processed: <CheckCircle2 className="w-3 h-3" />,
  Pending: <Clock className="w-3 h-3" />,
  Failed: <AlertCircle className="w-3 h-3" />,
}

export default function RecurringTransactionModal({ isOpen, onClose, recurringTx }: Props) {
  const updateMutation = useUpdateRecurringTransaction()
  const { data: accounts = [] } = useGetAccounts()

  const [note, setNote] = useState(recurringTx.templateNote ?? '')
  const [endDate, setEndDate] = useState(
    recurringTx.endDate ? dayjs(recurringTx.endDate).format('YYYY-MM-DD') : ''
  )
  const [maxOccurrences, setMaxOccurrences] = useState<string>(
    recurringTx.maxOccurrences != null ? String(recurringTx.maxOccurrences) : ''
  )

  const calcEndDateFromOccurrences = (occurrencesCount: number, startDateStr: string, freq: string, interval: number) => {
    if (!occurrencesCount || occurrencesCount < 1) return ''
    let date = dayjs(startDateStr)
    const units = (occurrencesCount - 1) * (interval || 1)
    if (units <= 0) return date.format('YYYY-MM-DD')
    
    switch (freq) {
      case 'Daily': return date.add(units, 'day').format('YYYY-MM-DD')
      case 'Weekly': return date.add(units, 'week').format('YYYY-MM-DD')
      case 'Monthly': return date.add(units, 'month').format('YYYY-MM-DD')
      case 'Yearly': return date.add(units, 'year').format('YYYY-MM-DD')
      default: return date.add(units, 'month').format('YYYY-MM-DD')
    }
  }

  const calcOccurrencesFromEndDate = (endDateStr: string, startDateStr: string, freq: string, interval: number) => {
    if (!endDateStr) return ''
    const start = dayjs(startDateStr)
    const end = dayjs(endDateStr)
    if (end.isBefore(start, 'day')) return '1'

    const step = interval || 1
    let count = 0
    let curr = start
    while (!curr.isAfter(end, 'day') && count < 1000) {
      count++
      switch (freq) {
        case 'Daily': curr = curr.add(step, 'day'); break
        case 'Weekly': curr = curr.add(step, 'week'); break
        case 'Monthly': curr = curr.add(step, 'month'); break
        case 'Yearly': curr = curr.add(step, 'year'); break
        default: curr = curr.add(step, 'month'); break
      }
    }
    return count > 0 ? String(count) : '1'
  }

  const handleOccurrencesChange = (val: string) => {
    setMaxOccurrences(val)
    if (!val || parseInt(val) < 1) {
      setEndDate('')
    } else {
      const computedEnd = calcEndDateFromOccurrences(
        parseInt(val),
        recurringTx.startDate,
        recurringTx.frequency,
        recurringTx.interval
      )
      setEndDate(computedEnd)
    }
  }

  const handleEndDateChange = (val: string) => {
    setEndDate(val)
    if (!val) {
      setMaxOccurrences('')
    } else {
      const computedOcc = calcOccurrencesFromEndDate(
        val,
        recurringTx.startDate,
        recurringTx.frequency,
        recurringTx.interval
      )
      setMaxOccurrences(computedOcc)
    }
  }

  const getAccountName = (id: string) => {
    return accounts.find((a) => a.id === id)?.name ?? 'Unknown Account'
  }

  const entries = recurringTx.templateEntries ?? []

  const totalAmount = useMemo(() => {
    if (entries.length === 0) return 0
    const positiveSum = entries.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0)
    if (positiveSum > 0) return positiveSum
    return entries.reduce((sum, e) => sum + Math.abs(e.amount), 0) / 2
  }, [entries])

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'Income':
        return <ArrowDownRight className="w-4 h-4 text-emerald-500" />
      case 'Expense':
        return <ArrowUpRight className="w-4 h-4 text-rose-500" />
      case 'Transfer':
        return <ArrowRightLeft className="w-4 h-4 text-blue-500" />
      case 'Journal':
        return <BookOpen className="w-4 h-4 text-purple-500" />
      default:
        return <Layers className="w-4 h-4 text-slate-500" />
    }
  }

  if (!isOpen) return null

  const handleSave = () => {
    updateMutation.mutate(
      {
        ...recurringTx,
        templateNote: note,
        endDate: endDate || undefined,
        maxOccurrences: maxOccurrences ? Number(maxOccurrences) : undefined,
      },
      { onSuccess: onClose }
    )
  }

  const occurrences = recurringTx.occurrences ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Edit Recurring Schedule</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Transaction Template Details Summary */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-white dark:bg-slate-700 shadow-xs border border-slate-200 dark:border-slate-600">
                  {getTypeIcon(recurringTx.templateType)}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {recurringTx.templateType} Template
                </span>
              </div>
              <div
                className={`text-lg font-bold ${
                  recurringTx.templateType === 'Income'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : recurringTx.templateType === 'Expense'
                    ? 'text-rose-600 dark:text-rose-400'
                    : recurringTx.templateType === 'Journal'
                    ? 'text-purple-600 dark:text-purple-400'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {recurringTx.templateType === 'Income' ? '+' : recurringTx.templateType === 'Expense' ? '-' : ''}₱
                {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {recurringTx.templateVendor && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium">Vendor:</span> {recurringTx.templateVendor}
              </div>
            )}

            {/* Template Entries / Account Breakdown */}
            {entries.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Template Account Entries
                </p>
                <div className="space-y-1">
                  {entries.map((entry, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded-md bg-white dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="font-medium text-slate-700 dark:text-slate-300 truncate">
                          {getAccountName(entry.accountId)}
                        </span>
                        {(entry.note || entry.referenceNumber) && (
                          <span className="text-[10px] text-slate-400 truncate italic">
                            {entry.note} {entry.referenceNumber ? `(Ref: ${entry.referenceNumber})` : ''}
                          </span>
                        )}
                      </div>
                      <span
                        className={`font-semibold tabular-nums whitespace-nowrap ${
                          entry.amount > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {entry.amount > 0 ? '+' : ''}₱{Math.abs(entry.amount).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Schedule Info */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-sm">
            <div>
              <p className="text-xs text-slate-400 mb-0.5 uppercase tracking-wider font-medium">Frequency</p>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                Every {recurringTx.interval > 1 ? `${recurringTx.interval} ` : ''}
                {recurringTx.frequency.toLowerCase()}
                {recurringTx.interval > 1 ? 's' : ''}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5 uppercase tracking-wider font-medium">Start Date</p>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {dayjs(recurringTx.startDate).format('MMM D, YYYY')}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5 uppercase tracking-wider font-medium">Next Run</p>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {recurringTx.nextOccurrenceDate
                  ? dayjs(recurringTx.nextOccurrenceDate).format('MMM D, YYYY')
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5 uppercase tracking-wider font-medium">Schedule Status</p>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                {recurringTx.status || 'Active'}
              </span>
            </div>
          </div>

          {/* Editable fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Note
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Monthly rent"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  End Date <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Max Occurrences <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={maxOccurrences}
                  onChange={(e) => handleOccurrencesChange(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>
          </div>

          {/* Occurrence History */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Generated Transactions ({occurrences.length}
              {recurringTx.maxOccurrences ? ` / ${recurringTx.maxOccurrences}` : ''})
            </h3>
            {occurrences.length === 0 ? (
              <p className="text-sm text-slate-400 italic py-2">No transactions generated yet.</p>
            ) : (
              <div className="space-y-1.5">
                {occurrences.map((occ, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-sm"
                  >
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <span className="text-xs text-slate-400 tabular-nums w-6 text-right">#{occ.occurrenceNo}</span>
                      <span>{dayjs(occ.date).format('MMM D, YYYY')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[occ.status] ?? STATUS_STYLES.Skipped}`}>
                        {STATUS_ICONS[occ.status]}
                        {occ.status}
                      </span>
                      {occ.transactionId && (
                        <span className="text-slate-300 dark:text-slate-600" title={`Transaction ID: ${occ.transactionId}`}>
                          <ExternalLink className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
