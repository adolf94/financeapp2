import React, { useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { Account } from '@/hooks/useAccounts'
import { useAdjustBalance } from '@/hooks/useAdjustment'

interface AdjustBalanceModalProps {
  isOpen: boolean
  account: Account | null
  onClose: () => void
}

export default function AdjustBalanceModal({
  isOpen,
  account,
  onClose,
}: AdjustBalanceModalProps) {
  const adjustMutation = useAdjustBalance()

  const currentBalance = account?.currentBalance ?? account?.startingBalance ?? 0
  const [actualBalanceInput, setActualBalanceInput] = useState<string>('')
  const [noteInput, setNoteInput] = useState<string>('Balance adjustment')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Reset or initialize state when modal opens with account
  React.useEffect(() => {
    if (isOpen && account) {
      setActualBalanceInput(currentBalance.toString())
      setNoteInput('Balance adjustment')
      setErrorMessage(null)
    }
  }, [isOpen, account, currentBalance])

  if (!isOpen || !account) return null

  const parsedActual = parseFloat(actualBalanceInput)
  const isValidNumber = !isNaN(parsedActual)
  const difference = isValidNumber ? parsedActual - currentBalance : 0
  const isZeroDiff = Math.abs(difference) < 0.0001

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidNumber) {
      setErrorMessage('Please enter a valid actual balance number.')
      return
    }

    if (isZeroDiff) {
      setErrorMessage('Actual balance matches the current balance. No adjustment needed.')
      return
    }

    setErrorMessage(null)

    try {
      await adjustMutation.mutateAsync({
        accountId: account.id!,
        data: {
          actualBalance: parsedActual,
          note: noteInput.trim() || 'Balance adjustment',
        },
      })
      onClose()
    } catch (err: any) {
      setErrorMessage(
        err?.response?.data || err?.message || 'Failed to adjust account balance.'
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-xl flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Adjust Balance
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                {account.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleAdjust} className="flex flex-col gap-4">
          {/* Current Balance (Read-Only) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Current Recorded Balance
            </label>
            <div className="px-3 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300">
              ₱{currentBalance.toFixed(2)}
            </div>
          </div>

          {/* Actual Balance Input */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Actual Real-World Balance
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">
                ₱
              </span>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={actualBalanceInput}
                onChange={(e) => {
                  setActualBalanceInput(e.target.value)
                  setErrorMessage(null)
                }}
                required
                autoFocus
                className="w-full pl-7 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Difference Indicator */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Adjustment Difference
            </span>
            <span
              className={`text-sm font-bold px-2 py-0.5 rounded ${
                isZeroDiff
                  ? 'text-slate-500 bg-slate-100 dark:bg-slate-800'
                  : difference > 0
                  ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40'
              }`}
            >
              {isZeroDiff
                ? '₱0.00'
                : `${difference > 0 ? '+' : ''}₱${difference.toFixed(2)}`}
            </span>
          </div>

          {/* Note Input */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Adjustment Note
            </label>
            <input
              type="text"
              placeholder="Balance adjustment"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              className="px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="text-xs text-rose-500 font-medium bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-2.5 rounded-lg">
              {errorMessage}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={adjustMutation.isPending || isZeroDiff || !isValidNumber}
              className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
            >
              {adjustMutation.isPending ? 'Adjusting...' : 'Confirm Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
