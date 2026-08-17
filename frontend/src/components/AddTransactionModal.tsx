import { useMemo, useState, useRef, useEffect } from 'react'
import {
  RefreshCw,
  RotateCcw,
  X,
  Trash2,
  Plus,
  Loader2,
  Info,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { uuidv7 } from 'uuidv7'
import { useGetAccounts, useGetAccountGroups } from '@/hooks/useAccounts'
import { useGetVendors, useCreateVendor } from '@/hooks/useVendors'
import { useGetIngestionById } from '@/hooks/useIngestions'
import { Transaction } from '@/hooks/useTransactions'
import { PendingIngestion } from '@/hooks/useIngestions'

import ConfirmationModal from './ui/ConfirmationModal'
import EditVendorModal from './EditVendorModal'
import Combobox from './ui/Combobox'
import CalculatorInput from './ui/CalculatorInput'
import {
  AddTransactionProvider,
  useAddTransaction,
} from './AddTransaction/AddTransactionContext'
import TransactionTypeTabs from './AddTransaction/TransactionTypeTabs'
import InlineAccountCreateForm from './AddTransaction/InlineAccountCreateForm'
import IngestionReviewPanel from './AddTransaction/IngestionReviewPanel'
import ReasoningDrawer from './ReasoningDrawer'

interface AddTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  initialData?: Transaction | null
  ingestionId?: string | null
  ingestion?: PendingIngestion | null
  onSave?: (date: string) => void
}

export default function AddTransactionModal(props: AddTransactionModalProps) {
  const targetIngestionId = props.ingestionId || props.initialData?.ingestionId
  const { data: fetchedIngestion, isLoading: isLoadingIngestion } = useGetIngestionById(targetIngestionId)
  const ingestion = props.ingestion || fetchedIngestion

  if (!props.isOpen) return null

  return (
    <AddTransactionProvider
      isOpen={props.isOpen}
      onClose={props.onClose}
      onSave={props.onSave}
      initialData={props.initialData || null}
      ingestionId={props.ingestionId || null}
      ingestion={ingestion || null}
      isLoadingIngestion={Boolean(targetIngestionId && isLoadingIngestion && !props.ingestion)}
    >
      <AddTransactionModalContent />
    </AddTransactionProvider>
  )
}

function AddTransactionModalContent() {
  const {
    onClose,
    initialData,
    ingestion,
    isLoadingIngestion,
    mode,
    setMode,
    type,
    totalAmount,
    setTotalAmount,
    sourceAccountId,
    setSourceAccountId,
    toAccountId,
    setToAccountId,
    splits,
    setSplits,
    journalLines,
    setJournalLines,
    vendor,
    setVendor,
    selectedLookups,
    setSelectedLookups,
    selectedNewLookups,
    setSelectedNewLookups,
    date,
    setDate,
    note,
    setNote,
    referenceNumber,
    setReferenceNumber,
    userWhy,
    setUserWhy,
    isRecurring,
    setIsRecurring,
    frequency,
    setFrequency,
    maxOccurrences,
    recurringEndDate,
    handleRecurringOccurrencesChange,
    handleRecurringEndDateChange,
    suggestedVendorTags,
    suggestedVendorType,
    confirmReclassifyOpen,
    setConfirmReclassifyOpen,
    isFlashing,
    handleSubmit,
    submitTypeRef,
    reclassifyMutation,
    skipLearning,
    setSkipLearning,
    setPendingNewAccount,
    setCurrentOperationId,
    currentOperationId,
    isDrawerOpen,
    setIsDrawerOpen,
    isSubmitting,
  } = useAddTransaction()

  const [streamReasoning, setStreamReasoning] = useState(false)
  const [reclassifyComment, setReclassifyComment] = useState('')
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

  const { debitTotal, creditTotal, balanceDiff } = useMemo(() => {
    const dr = journalLines
      .filter((l) => l.type === 'Debit')
      .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
    const cr = journalLines
      .filter((l) => l.type === 'Credit')
      .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
    return {
      debitTotal: dr,
      creditTotal: cr,
      balanceDiff: Math.round((dr - cr) * 100) / 100,
    }
  }, [journalLines])

  const handleAutoBalance = () => {
    if (Math.abs(balanceDiff) < 0.001) return
    const targetType = balanceDiff > 0 ? 'Credit' : 'Debit'
    const targetAmount = Math.abs(balanceDiff).toFixed(2)

    // Check if there is an empty line or line with 0 amount to fill
    const emptyLineIndex = journalLines.findIndex(
      (l) => (!l.amount || parseFloat(l.amount) === 0)
    )

    if (emptyLineIndex >= 0) {
      setJournalLines((prev) =>
        prev.map((line, idx) =>
          idx === emptyLineIndex
            ? { ...line, type: targetType, amount: targetAmount }
            : line
        )
      )
    } else {
      setJournalLines((prev) => [
        ...prev,
        {
          id: uuidv7(),
          categoryId: '',
          subCategoryId: '',
          amount: targetAmount,
          type: targetType,
          note: '',
          referenceNumber: '',
        },
      ])
    }
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

  const queryClient = useQueryClient()
  const { data: accounts = [] } = useGetAccounts()
  const { data: accountGroups = [] } = useGetAccountGroups()
  const { data: dbVendors = [] } = useGetVendors()

  const createVendorMutation = useCreateVendor()

  const [isEditVendorOpen, setIsEditVendorOpen] = useState(false)

  // Combine DB Vendors with presets
  const vendorOptions = useMemo(
    () => dbVendors.map((v) => v.name).sort((a, b) => a.localeCompare(b)),
    [dbVendors]
  )

  // Payment Source Accounts (Asset / Bank / Cash / CreditCard / Investment)
  const paymentGroupIds = useMemo(
    () =>
      new Set(
        accountGroups
          .filter((g) => g.accountType !== 'Expense' && g.accountType !== 'Income')
          .map((g) => g.id)
      ),
    [accountGroups]
  )

  const paymentAccounts = useMemo(
    () =>
      accounts
        .filter((a) => !a.accountGroupId || paymentGroupIds.has(a.accountGroupId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accounts, paymentGroupIds]
  )

  // Category Account Groups (Strictly Expense or Income)
  const categoryGroups = useMemo(
    () =>
      accountGroups
        .filter((g) => {
          if (type === 'Expense') return g.accountType === 'Expense'
          if (type === 'Income') return g.accountType === 'Income'
          return false
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accountGroups, type]
  )

  const updateSplit = (id: string, updates: Partial<typeof splits[0]>) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const updated = { ...s, ...updates }
          if (updates.categoryId) updated.subCategoryId = ''
          return updated
        }
        return s
      })
    )
  }

  const addJournalLine = () => {
    setJournalLines((prev) => [
      ...prev,
      { id: uuidv7(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit', note: '', referenceNumber: '' },
    ])
  }

  const removeJournalLine = (id: string) => {
    setJournalLines((prev) => prev.filter((l) => l.id !== id))
  }

  const updateJournalLine = (id: string, updates: Partial<typeof journalLines[0]>) => {
    setJournalLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)))
  }



  const selectedVendorObj = useMemo(() => {
    return dbVendors.find((v) => v.name.toLowerCase() === vendor.toLowerCase())
  }, [dbVendors, vendor])

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-50 transition-opacity duration-300"
      />
      {/* Bottom Sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 w-full ${
          ingestion || isLoadingIngestion ? 'md:max-w-4xl' : 'md:max-w-md'
        } mx-auto bg-white dark:bg-slate-900 rounded-t-2xl z-55 shadow-2xl flex flex-col border-t border-slate-200 dark:border-slate-800 animate-slide-up max-h-[92vh] overflow-hidden transition-all duration-500 ${
          isFlashing
            ? 'ring-4 ring-indigo-500/50 scale-[1.02] bg-indigo-50 dark:bg-indigo-950/20'
            : ''
        }`}
      >
        <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[92vh] overflow-hidden">
          {/* Mobile Sheet Drag Handle */}
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mt-2.5 mb-1 sm:hidden shrink-0 select-none" />

          {/* Modal Header */}
          <div className="flex justify-between items-center px-4 py-2.5 border-b border-slate-150 dark:border-slate-800/80 shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50">
                {initialData ? 'Edit Transaction' : 'Log Transaction'}
              </h2>
              <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setMode('Simple')}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide transition-all cursor-pointer ${
                    mode === 'Simple'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Simple
                </button>
                <button
                  type="button"
                  onClick={() => setMode('Advanced')}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide transition-all cursor-pointer ${
                    mode === 'Advanced'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Advanced
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['accounts'] })
                  queryClient.invalidateQueries({ queryKey: ['accountGroups'] })
                }}
                title="Refresh accounts"
                className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
              </button>
              {ingestion && (
                <button
                  type="button"
                  onClick={() => {
                    if (reclassifyMutation.isPending) {
                      setIsDrawerOpen(true)
                    } else {
                      const opId = uuidv7()
                      setCurrentOperationId(opId)
                      reclassifyMutation.mutate({ id: ingestion.id, operationId: opId })
                    }
                  }}
                  disabled={reclassifyMutation.isPending}
                  title="Re-run AI classification"
                  className={`p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    reclassifyMutation.isPending ? 'animate-spin' : ''
                  }`}
                >
                  <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Modal Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div
              className={
                ingestion || isLoadingIngestion ? 'grid grid-cols-1 md:grid-cols-12 gap-4 items-start' : 'flex flex-col gap-4'
              }
            >
              {/* Form Column */}
              <div className={ingestion || isLoadingIngestion ? 'md:col-span-7 flex flex-col gap-3.5' : 'flex flex-col gap-3.5'}>
                <TransactionTypeTabs />

                <div className="flex flex-col gap-3">
                  {mode === 'Simple' ? (
                    <>
                      {/* Total Amount Hero Display */}
                      <div className="flex flex-col gap-1 items-center justify-center py-1">
                        <div className="relative flex items-center justify-center w-full max-w-xs border-b-2 border-slate-200 dark:border-slate-800 focus-within:border-blue-600 dark:focus-within:border-blue-500 pb-1 transition-colors">
                          <span className="text-2xl sm:text-3xl font-extrabold text-slate-400 dark:text-slate-500 mr-1 select-none">
                            ₱
                          </span>
                          <CalculatorInput
                            placeholder="0.00"
                            value={totalAmount}
                            onChange={setTotalAmount}
                            required
                            className="w-full text-3xl sm:text-4xl font-extrabold text-center py-0.5 bg-transparent text-slate-900 dark:text-slate-50 focus:outline-none tracking-tight"
                          />
                        </div>
                      </div>

                      {/* Source Account (Payment Account) */}
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="source-account-select"
                          className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                        >
                          {type === 'Income' ? 'Deposit To' : 'Pay From'}
                        </label>
                        <select
                          id="source-account-select"
                          value={sourceAccountId}
                          onChange={(e) => setSourceAccountId(e.target.value)}
                          required
                          className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                        >
                          <option value="">Select Account...</option>
                          {Array.from(new Set(paymentAccounts.map((a) => a.accountGroupId)))
                            .sort((a, b) => {
                              const gA = accountGroups.find((g) => g.id === a)?.name || ''
                              const gB = accountGroups.find((g) => g.id === b)?.name || ''
                              return gA.localeCompare(gB)
                            })
                            .map((groupId) => {
                              const group = accountGroups.find((g) => g.id === groupId)
                              const groupAccounts = paymentAccounts.filter(
                                (a) => a.accountGroupId === groupId
                              )
                              if (!group || groupAccounts.length === 0) return null
                              return (
                                <optgroup key={group.id} label={group.name}>
                                  {groupAccounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )
                            })}
                        </select>
                      </div>

                      {/* Destination Account (Only for Transfer) */}
                      {type === 'Transfer' && (
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="destination-account-select"
                            className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                          >
                            Transfer To
                          </label>
                          <select
                            id="destination-account-select"
                            value={toAccountId}
                            onChange={(e) => setToAccountId(e.target.value)}
                            required
                            className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                          >
                            <option value="">Select Destination Account...</option>
                            {Array.from(
                              new Set(
                                paymentAccounts
                                  .filter((a) => a.id !== sourceAccountId)
                                  .map((a) => a.accountGroupId)
                              )
                            )
                              .sort((a, b) => {
                                const gA = accountGroups.find((g) => g.id === a)?.name || ''
                                const gB = accountGroups.find((g) => g.id === b)?.name || ''
                                return gA.localeCompare(gB)
                              })
                              .map((groupId) => {
                                const group = accountGroups.find((g) => g.id === groupId)
                                const groupAccounts = paymentAccounts.filter(
                                  (a) => a.accountGroupId === groupId && a.id !== sourceAccountId
                                )
                                if (!group || groupAccounts.length === 0) return null
                                return (
                                  <optgroup key={group.id} label={group.name}>
                                    {groupAccounts.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )
                              })}
                          </select>
                        </div>
                      )}

                      {/* Splits (Category & SubCategory in Unified 2-Col Grid) */}
                      {type !== 'Transfer' && (
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              Category & Subcategory
                            </label>
                          </div>

                          {splits.map((split) => {
                            const subCategoryOptions = accounts
                              .filter((a) => a.accountGroupId === split.categoryId)
                              .sort((a, b) => a.name.localeCompare(b.name))
                            return (
                              <div
                                key={split.id}
                                className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                              >
                                <Combobox
                                  options={categoryGroups.map((g) => ({ value: g.id, label: g.name }))}
                                  value={split.categoryId}
                                  onChange={(val) => updateSplit(split.id, { categoryId: val })}
                                  placeholder="Select Category..."
                                  className="w-full"
                                />

                                <Combobox
                                  options={subCategoryOptions.map((a) => ({
                                    value: a.id!,
                                    label: a.name,
                                  }))}
                                  value={split.subCategoryId}
                                  onChange={(val) => updateSplit(split.id, { subCategoryId: val })}
                                  placeholder="Select Sub-Category..."
                                  className="w-full"
                                  disabled={!split.categoryId}
                                  onCreate={(val) => {
                                    const group = accountGroups.find((g) => g.id === split.categoryId)
                                    setPendingNewAccount({
                                      name: val,
                                      categoryId: split.categoryId,
                                      type: group?.accountType || 'Expense',
                                      splitId: split.id,
                                      description: '',
                                      tags: [],
                                    })
                                  }}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Advanced Mode: Journal Entry */
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

                      {journalLines.map((line) => (
                        <div
                          key={line.id}
                          className="flex flex-col gap-2 p-2.5 bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl transition-all"
                        >
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
                              onChange={(val) => updateJournalLine(line.id, { categoryId: val })}
                              placeholder="Category..."
                              className="flex-1 text-xs sm:text-sm"
                            />
                            <Combobox
                              options={accounts
                                .filter((a) => a.accountGroupId === line.categoryId)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((a) => ({ value: a.id!, label: a.name }))}
                              value={line.subCategoryId}
                              onChange={(val) => updateJournalLine(line.id, { subCategoryId: val })}
                              placeholder="Account..."
                              className="flex-1 text-xs sm:text-sm"
                              disabled={!line.categoryId}
                              onCreate={(val) => {
                                const group = accountGroups.find((g) => g.id === line.categoryId)
                                setPendingNewAccount({
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
                                onClick={() => updateJournalLine(line.id, { type: 'Debit' })}
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
                                onClick={() => updateJournalLine(line.id, { type: 'Credit' })}
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
                                    updateJournalLine(line.id, {
                                      amount: Math.abs(num).toString(),
                                      type: line.type === 'Debit' ? 'Credit' : 'Debit',
                                    })
                                  } else {
                                    updateJournalLine(line.id, { amount: val })
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
                                onClick={() => removeJournalLine(line.id)}
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
                                onChange={(e) => updateJournalLine(line.id, { note: e.target.value })}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-200 placeholder-slate-400"
                              />
                              <input
                                type="text"
                                placeholder="Line ref # (optional)..."
                                value={line.referenceNumber || ''}
                                onChange={(e) => updateJournalLine(line.id, { referenceNumber: e.target.value })}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-200 placeholder-slate-400"
                              />
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Actions: Add Line & Auto-Balance */}
                      <div className="flex gap-2 mt-1">
                        <button
                          type="button"
                          onClick={addJournalLine}
                          className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer border border-dashed border-slate-300 dark:border-slate-600"
                        >
                          <Plus className="w-4 h-4" strokeWidth={1.5} /> Add Line
                        </button>

                        {Math.abs(balanceDiff) >= 0.01 && (
                          <button
                            type="button"
                            onClick={handleAutoBalance}
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
                  )}

                  {/* Shared Vendor, Date, and Note for both modes */}
                  <div className="flex flex-col gap-1 mt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Vendor / Payer
                      </label>
                      {selectedVendorObj && (
                        <button
                          type="button"
                          onClick={() => setIsEditVendorOpen(true)}
                          title="Edit selected vendor"
                          className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer"
                        >
                          Edit Vendor Details
                        </button>
                      )}
                    </div>
                    <Combobox
                      options={vendorOptions
                        .filter((v) => v !== 'Other / Custom')
                        .map((v) => ({ value: v, label: v }))}
                      value={vendor}
                      onChange={(val) => {
                        setVendor(val)
                      }}
                      onCreate={(val) => {
                        const tags = suggestedVendorTags
                          ? suggestedVendorTags.split(',').map((t) => t.trim()).filter(Boolean)
                          : []
                        createVendorMutation.mutate(
                          { name: val, type: suggestedVendorType, tags },
                          {
                            onSuccess: () => {
                              setVendor(val)
                            },
                          }
                        )
                      }}
                      placeholder="Select or type vendor..."
                      className="w-full"
                    />
                    {ingestion && (selectedLookups.length > 0 || selectedNewLookups.length > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 animate-fade-in">
                        {selectedLookups.map((l, i) => (
                          <span
                            key={`matched-${i}`}
                            onClick={() => setSelectedLookups(prev => prev.filter(x => x !== l))}
                            className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/40 px-2 py-0.5 rounded-full shadow-sm cursor-pointer hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-450 dark:hover:border-rose-800 transition-colors"
                            title="Click to exclude matched lookup"
                          >
                            {l}
                            <X className="w-2.5 h-2.5" />
                          </span>
                        ))}
                        {selectedNewLookups.map((l, i) => (
                          <span
                            key={`suggested-${i}`}
                            onClick={() => setSelectedNewLookups(prev => prev.filter(x => x !== l))}
                            className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-900/40 px-2 py-0.5 rounded-full shadow-sm cursor-pointer hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-400 dark:hover:border-rose-800 transition-colors"
                            title="Click to exclude suggested lookup"
                          >
                            {l}
                            <X className="w-2.5 h-2.5" />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Date & Reference in clean responsive 2-col row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="transaction-date-input"
                        className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                      >
                        Date
                      </label>
                      <input
                        id="transaction-date-input"
                        type="datetime-local"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        className="min-h-[42px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="transaction-reference-input"
                        className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                      >
                        Reference Number
                      </label>
                      <input
                        id="transaction-reference-input"
                        type="text"
                        placeholder="Reference Number (optional)"
                        value={referenceNumber}
                        onChange={(e) => setReferenceNumber(e.target.value)}
                        className="min-h-[42px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
                      />
                    </div>
                  </div>

                  {/* Full Width Note textarea */}
                  <div className="flex flex-col gap-1 mt-1">
                    <label
                      htmlFor="transaction-note-textarea"
                      className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                    >
                      Note
                    </label>
                    <textarea
                      id="transaction-note-textarea"
                      placeholder="Note (optional)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="min-h-[42px] p-2.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm resize-y"
                      rows={2}
                    />
                  </div>

                  {/* Unified AI Learning & Correction Notes */}
                  {ingestion && (
                    <div className="flex flex-col gap-1.5 mt-1 border border-slate-200 dark:border-slate-800/80 rounded-xl p-2.5 bg-slate-50/60 dark:bg-slate-950/40">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={!skipLearning}
                            onChange={(e) => {
                              const learning = e.target.checked
                              setSkipLearning(!learning)
                              if (!learning) setUserWhy('')
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer dark:bg-slate-950 dark:border-slate-800"
                          />
                          <span className="flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                            <span>Help AI learn from edits (Optional)</span>
                          </span>
                        </label>
                      </div>

                      {!skipLearning && (
                        <textarea
                          id="correction-reason-textarea"
                          placeholder="Describe adjustments or rules to teach the AI reasoning (optional)..."
                          value={userWhy}
                          onChange={(e) => setUserWhy(e.target.value)}
                          className="mt-1 p-2.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm focus:outline-none focus:border-blue-600 resize-y animate-in fade-in slide-in-from-top-1"
                          rows={2}
                        />
                      )}
                    </div>
                  )}

                  {!initialData && (
                    <div className="mt-2 p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/50">
                      <label className="flex items-center justify-between cursor-pointer">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Make this recurring
                          </span>
                          <span className="text-xs text-slate-500">Auto-generate this transaction</span>
                        </div>
                        <div className="relative inline-flex items-center">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isRecurring}
                            onChange={(e) => setIsRecurring(e.target.checked)}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
                        </div>
                      </label>

                      {isRecurring && (
                        <div className="space-y-3 mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              Frequency
                            </label>
                            <select
                              value={frequency}
                              onChange={(e) => setFrequency(e.target.value as any)}
                              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
                            >
                              <option value="Daily">Daily</option>
                              <option value="Weekly">Weekly</option>
                              <option value="Monthly">Monthly</option>
                              <option value="Yearly">Yearly</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                End Date <span className="text-slate-400 font-normal lowercase">(optional)</span>
                              </label>
                              <input
                                type="date"
                                value={recurringEndDate}
                                onChange={(e) => handleRecurringEndDateChange(e.target.value)}
                                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                Max Times <span className="text-slate-400 font-normal lowercase">(optional)</span>
                              </label>
                              <input
                                type="number"
                                min={1}
                                placeholder="Unlimited"
                                value={maxOccurrences}
                                onChange={(e) => handleRecurringOccurrencesChange(e.target.value)}
                                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full text-xs sm:text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Desktop AI Notification Review Panel */}
              <IngestionReviewPanel />
            </div>
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="p-3 sm:p-4 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 shrink-0 pb-safe">
            {initialData ? (
              <button
                type="submit"
                disabled={isSubmitting}
                onClick={() => {
                  submitTypeRef.current = 'close'
                }}
                className="w-full min-h-[44px] sm:min-h-[48px] bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors cursor-pointer text-base sm:text-lg shadow-sm flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Saving...</>
                ) : (
                  'Save Changes'
                )}
              </button>
            ) : (
              <div className="flex gap-2">
                {ingestion && (ingestion.related_ingestion_ids?.length || (ingestion as any).RelatedIngestionIds?.length || ingestion.possible_related_ingestion_ids?.length || (ingestion as any).PossibleRelatedIngestionIds?.length) ? (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    onClick={() => {
                      submitTypeRef.current = 'close'
                    }}
                    className="flex-[2] min-h-[44px] sm:min-h-[48px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors cursor-pointer shadow-sm text-sm sm:text-base flex items-center justify-center gap-2"
                  >
                    {isSubmitting && submitTypeRef.current === 'close' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Merging & Saving...</>
                    ) : (
                      'Merge & Save'
                    )}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    onClick={() => {
                      submitTypeRef.current = 'close'
                    }}
                    className="flex-[2] min-h-[44px] sm:min-h-[48px] bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors cursor-pointer shadow-sm text-sm sm:text-base flex items-center justify-center gap-2"
                  >
                    {isSubmitting && submitTypeRef.current === 'close' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                    ) : (
                      'Save & Close'
                    )}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  onClick={() => {
                    submitTypeRef.current = 'more'
                  }}
                  className="flex-[1.5] min-h-[44px] sm:min-h-[48px] bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 dark:text-white font-semibold rounded-lg transition-colors cursor-pointer shadow-sm text-xs sm:text-sm flex items-center justify-center gap-2"
                >
                  {isSubmitting && submitTypeRef.current === 'more' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                  ) : (
                    'Save & Add Another'
                  )}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>

      <InlineAccountCreateForm />

      {confirmReclassifyOpen && ingestion && (() => {
        const debitAccId =
          mode === 'Advanced'
            ? journalLines.find((l) => l.type === 'Debit')?.subCategoryId || null
            : type === 'Transfer'
            ? toAccountId || null
            : type === 'Income'
            ? sourceAccountId || null
            : splits[0]?.subCategoryId || null

        const creditAccId =
          mode === 'Advanced'
            ? journalLines.find((l) => l.type === 'Credit')?.subCategoryId || null
            : type === 'Transfer'
            ? sourceAccountId || null
            : type === 'Income'
            ? splits[0]?.subCategoryId || null
            : sourceAccountId || null

        const debitAccName = accounts.find((a) => a.id === debitAccId)?.name || (debitAccId ? 'Selected' : 'None')
        const creditAccName = accounts.find((a) => a.id === creditAccId)?.name || (creditAccId ? 'Selected' : 'None')

        const commentText = reclassifyComment.trim()
        const hasComment = Boolean(commentText)

        // When user provides a comment/instruction text, send all current active modal values
        const corrections = hasComment ? {
          comment: commentText,
          type,
          vendor: vendor.trim() || undefined,
          debit_account_id: debitAccId,
          credit_account_id: creditAccId,
        } : undefined

        return (
          <ConfirmationModal
            isOpen={confirmReclassifyOpen}
            title="Re-run AI Classification"
            confirmLabel="Reclassify"
            confirmVariant="primary"
            onConfirm={() => {
              setConfirmReclassifyOpen(false)
              const opId = uuidv7()
              setCurrentOperationId(opId)

              reclassifyMutation.mutate({
                id: ingestion.id,
                operationId: opId,
                streamReasoning,
                userCorrections: corrections,
              })
              setReclassifyComment('')
            }}
            onCancel={() => {
              setConfirmReclassifyOpen(false)
              setReclassifyComment('')
            }}
          >
            <div className="flex flex-col gap-3.5">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Re-run AI classification on this ingestion.{hasComment ? ' The AI will use your instructions and current values as context to refine suggestions and propose a runbook rule.' : ''}
              </p>

              {/* Current values context preview if comment is provided */}
              {hasComment && (
                <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs flex flex-col gap-1.5">
                  <span className="font-bold text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Values Being Sent to AI:
                  </span>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700 dark:text-slate-300">
                    <div className="col-span-2">
                      <span className="text-slate-400">Instruction:</span> <span className="font-semibold italic">"{commentText}"</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Type:</span> <span className="font-semibold">{type}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Vendor:</span> <span className="font-semibold">{vendor || '(None)'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Debit (Dr / To):</span> <span className="font-semibold truncate">{debitAccName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Credit (Cr / From):</span> <span className="font-semibold truncate">{creditAccName}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Optional comments/instructions textarea */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="reclassify-comment-input"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Optional Comments / Instructions for AI
                </label>
                <textarea
                  id="reclassify-comment-input"
                  rows={3}
                  value={reclassifyComment}
                  onChange={(e) => setReclassifyComment(e.target.value)}
                  placeholder="e.g. Treat this as a Food & Dining expense, and suggest a runbook rule for GrabFood..."
                  className="p-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/50 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
                <input
                  type="checkbox"
                  checked={streamReasoning}
                  onChange={(e) => setStreamReasoning(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 dark:border-slate-600 dark:bg-slate-700"
                />
                <div className="flex flex-col">
                  <span className="font-semibold text-xs text-slate-900 dark:text-slate-50">Stream AI Reasoning</span>
                </div>
              </label>
            </div>
          </ConfirmationModal>
        )
      })()}

      <ReasoningDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        operationId={currentOperationId}
        isPending={reclassifyMutation.isPending}
        thinkingEventName="reclassifyThinking"
        progressEventName="reclassifyProgress"
        finalContent={reclassifyMutation.data ? JSON.stringify(reclassifyMutation.data.ai_parsed, null, 2) : undefined}
      />

      {isEditVendorOpen && selectedVendorObj && (
        <EditVendorModal
          isOpen={isEditVendorOpen}
          onClose={() => setIsEditVendorOpen(false)}
          vendor={selectedVendorObj}
          onSaveSuccess={(updatedVendor) => {
            setVendor(updatedVendor.name)
          }}
        />
      )}
    </>
  )
}
