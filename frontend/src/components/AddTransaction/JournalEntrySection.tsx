import { useState, useRef, useEffect } from 'react'
import { Info, X, MessageSquare, Trash2, Plus, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react'
import { Account, AccountGroup } from '@/hooks/useAccounts'
import Combobox from '@/components/ui/Combobox'
import CalculatorInput from '@/components/ui/CalculatorInput'
import { JournalLine, PendingNewAccountType } from './AddTransactionContext'

interface JournalEntrySectionProps {
  journalLines: JournalLine[]
  setJournalLines: React.Dispatch<React.SetStateAction<JournalLine[]>>
  accountGroups: AccountGroup[]
  accounts: Account[]
  onPendingNewAccount: (acc: PendingNewAccountType) => void
  onAddLine: () => void
  onRemoveLine: (id: string) => void
  onUpdateLine: (id: string, updates: Partial<JournalLine>) => void
  onAutoBalance: () => void
  debitTotal: number
  creditTotal: number
  balanceDiff: number
}

export default function JournalEntrySection({
  journalLines,
  setJournalLines: _setJournalLines,
  accountGroups,
  accounts,
  onPendingNewAccount,
  onAddLine,
  onRemoveLine,
  onUpdateLine,
  onAutoBalance,
  debitTotal,
  creditTotal,
  balanceDiff,
}: JournalEntrySectionProps) {
  const [showJournalGuide, setShowJournalGuide] = useState(false)
  const [expandedMemoLineIds, setExpandedMemoLineIds] = useState<Set<string>>(new Set())
  const journalGuideRef = useRef<HTMLDivElement>(null)

  const toggleMemo = (lineId: string) => {
    setExpandedMemoLineIds((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (journalGuideRef.current && !journalGuideRef.current.contains(event.target as Node)) {
        setShowJournalGuide(false)
      }
    }
    if (showJournalGuide) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showJournalGuide])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center mt-2">
        <div className="relative inline-flex items-center" ref={journalGuideRef}>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Journal Lines
            </label>
            <button
              type="button"
              onClick={() => setShowJournalGuide((prev) => !prev)}
              title="Debit & Credit Guide"
              className={`inline-flex items-center justify-center p-1 rounded-md transition-colors cursor-pointer ${
                showJournalGuide
                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                  : 'text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Short & Simple Popover: Common Patterns */}
          {showJournalGuide && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-72 sm:w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-3 text-xs animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                  Common Transaction Patterns
                </span>
                <button
                  type="button"
                  onClick={() => setShowJournalGuide(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-col gap-1.5 text-[11px]">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex flex-col gap-0.5">
                  <span className="font-medium text-slate-800 dark:text-slate-200">Expense via Cash / Bank</span>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">Debit:</span> Expense
                    <span className="mx-1.5 text-slate-400">|</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Credit:</span> Asset (Bank/Cash)
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex flex-col gap-0.5">
                  <span className="font-medium text-slate-800 dark:text-slate-200">Expense via Credit Card</span>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">Debit:</span> Expense
                    <span className="mx-1.5 text-slate-400">|</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Credit:</span> Liability (Card)
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex flex-col gap-0.5">
                  <span className="font-medium text-slate-800 dark:text-slate-200">Receive Income / Salary</span>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">Debit:</span> Asset (Bank)
                    <span className="mx-1.5 text-slate-400">|</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Credit:</span> Income
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex flex-col gap-0.5">
                  <span className="font-medium text-slate-800 dark:text-slate-200">Pay Credit Card Bill</span>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">Debit:</span> Liability (Card)
                    <span className="mx-1.5 text-slate-400">|</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Credit:</span> Asset (Bank)
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex flex-col gap-0.5">
                  <span className="font-medium text-slate-800 dark:text-slate-200">Transfer between Accounts</span>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300">
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">Debit:</span> To Account (Asset)
                    <span className="mx-1.5 text-slate-400">|</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Credit:</span> From Account (Asset)
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {journalLines.map((line, index) => {
        const selectedAcc = accounts.find((a) => a.id === line.subCategoryId)
        const selectedGrp = accountGroups.find((g) => g.id === line.categoryId)
        const isBalanceSheetAccount =
          selectedGrp?.accountType &&
          selectedGrp.accountType !== 'Expense' &&
          selectedGrp.accountType !== 'Income'
        const currentBal =
          isBalanceSheetAccount && selectedAcc
            ? selectedAcc.currentBalance ?? selectedAcc.startingBalance
            : undefined

        return (
          <div
            key={line.id}
            className="flex flex-col gap-2 p-2.5 bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Line #{index + 1}
              </span>
              {currentBal !== undefined && (
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Bal:{' '}
                  <span
                    className={`font-semibold ${
                      currentBal < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    ₱{currentBal.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
              )}
            </div>

            <div className="flex gap-2">
            <Combobox
              options={accountGroups
                .slice()
                .sort((a, b) => {
                  const typeOrder: Record<string, number> = {
                    Asset: 1,
                    Bank: 2,
                    Cash: 3,
                    CreditCard: 4,
                    Investment: 5,
                    Income: 6,
                    Expense: 7,
                    Liability: 8,
                    Equity: 9,
                  }
                  const orderA = a.accountType ? (typeOrder[a.accountType] || 99) : 99
                  const orderB = b.accountType ? (typeOrder[b.accountType] || 99) : 99
                  if (orderA !== orderB) return orderA - orderB
                  return a.name.localeCompare(b.name)
                })
                .map((g) => ({
                  value: g.id,
                  label: g.name,
                  group: g.accountType,
                }))}
              value={line.categoryId}
              onChange={(val) => onUpdateLine(line.id, { categoryId: val })}
              placeholder="Category..."
              className="flex-1 text-xs sm:text-sm"
            />
            <Combobox
              options={accounts
                .filter((a) => a.accountGroupId === line.categoryId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => ({ value: a.id!, label: a.name }))}
              value={line.subCategoryId}
              onChange={(val) => onUpdateLine(line.id, { subCategoryId: val })}
              placeholder="Account..."
              className="flex-1 text-xs sm:text-sm"
              disabled={!line.categoryId}
              onCreate={(val) => {
                const group = accountGroups.find((g) => g.id === line.categoryId)
                onPendingNewAccount({
                  name: val,
                  categoryId: line.categoryId,
                  type: group?.accountType || 'Expense',
                  splitId: line.id,
                  description: '',
                  tags: [],
                })
              }}
            />
          </div>

          <div className="flex gap-2 items-center w-full">
            {/* Segmented Dr / Cr Pill */}
            <div className="inline-flex p-0.5 bg-slate-200/80 dark:bg-slate-800 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => onUpdateLine(line.id, { type: 'Debit' })}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  line.type === 'Debit'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Dr
              </button>
              <button
                type="button"
                onClick={() => onUpdateLine(line.id, { type: 'Credit' })}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  line.type === 'Credit'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Cr
              </button>
            </div>

            {/* Amount Input */}
            <div className="flex-1 relative">
              <CalculatorInput
                placeholder="0.00"
                value={line.amount}
                onChange={(val) => {
                  const num = parseFloat(val)
                  if (num < 0) {
                    onUpdateLine(line.id, {
                      amount: Math.abs(num).toString(),
                      type: line.type === 'Debit' ? 'Credit' : 'Debit',
                    })
                  } else {
                    onUpdateLine(line.id, { amount: val })
                  }
                }}
                required
                className="w-full min-h-[38px] px-3 pr-8 text-right bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-semibold focus:outline-none focus:border-blue-600 text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Memo / Details Toggle Icon Button */}
            <button
              type="button"
              onClick={() => toggleMemo(line.id)}
              title={line.note || line.referenceNumber ? 'Edit line details (note/ref)' : 'Add line note / ref #'}
              className={`p-2 rounded-lg transition-colors cursor-pointer shrink-0 ${
                line.note || line.referenceNumber || expandedMemoLineIds.has(line.id)
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 border border-transparent'
              }`}
            >
              <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
            </button>

            {/* Delete Line Button */}
            {journalLines.length > 2 && (
              <button
                type="button"
                onClick={() => onRemoveLine(line.id)}
                title="Remove line"
                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" strokeWidth={1.5} />
              </button>
            )}
          </div>

          {/* Collapsible Memo / Note & Reference Field */}
          {(Boolean(line.note) || Boolean(line.referenceNumber) || expandedMemoLineIds.has(line.id)) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <input
                type="text"
                placeholder="Line memo / note (optional)..."
                value={line.note || ''}
                onChange={(e) => onUpdateLine(line.id, { note: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-200 placeholder-slate-400"
              />
              <input
                type="text"
                placeholder="Line ref # (optional)..."
                value={line.referenceNumber || ''}
                onChange={(e) => onUpdateLine(line.id, { referenceNumber: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-200 placeholder-slate-400"
              />
            </div>
          )}
        </div>
        )
      })}

      {/* Actions: Add Line & Auto-Balance */}
      <div className="flex gap-2 mt-1">
        <button
          type="button"
          onClick={onAddLine}
          className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer border border-dashed border-slate-300 dark:border-slate-600"
        >
          <Plus className="w-4 h-4" strokeWidth={1.5} /> Add Line
        </button>

        {Math.abs(balanceDiff) >= 0.01 && (
          <button
            type="button"
            onClick={onAutoBalance}
            className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60 rounded-lg flex items-center justify-center gap-1 text-xs font-semibold transition-colors cursor-pointer shadow-sm"
            title={`Auto-add ${balanceDiff > 0 ? 'Credit' : 'Debit'} ₱${Math.abs(balanceDiff).toFixed(2)}`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Auto-Balance
          </button>
        )}
      </div>

      {/* Live Balance Status Card */}
      <div
        className={`flex flex-col gap-1.5 p-2.5 rounded-xl border transition-all text-xs ${
          Math.abs(balanceDiff) < 0.01 && debitTotal > 0
            ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
            : 'bg-slate-100/90 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
        }`}
      >
        <div className="flex justify-between items-center font-medium">
          <div className="flex items-center gap-1.5">
            {Math.abs(balanceDiff) < 0.01 && debitTotal > 0 ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Balanced
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {debitTotal === 0 && creditTotal === 0
                    ? 'Enter line amounts'
                    : `Diff: ₱${Math.abs(balanceDiff).toFixed(2)} (${balanceDiff > 0 ? 'Need Cr' : 'Need Dr'})`}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 font-semibold">
            <span className="text-blue-600 dark:text-blue-400">
              Dr: ₱{debitTotal.toFixed(2)}
            </span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              Cr: ₱{creditTotal.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
