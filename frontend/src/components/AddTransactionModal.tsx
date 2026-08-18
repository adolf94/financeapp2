import { useMemo, useState } from 'react'
import {
  RefreshCw,
  RotateCcw,
  X,
  Loader2,
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
import AccountSelectField from './AddTransaction/AccountSelectField'
import CategorySplitGrid from './AddTransaction/CategorySplitGrid'
import JournalEntrySection from './AddTransaction/JournalEntrySection'
import RecurringScheduleSection from './AddTransaction/RecurringScheduleSection'
import ReclassifyConfirmModal from './AddTransaction/ReclassifyConfirmModal'
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
    showDismissConfirm,
    setShowDismissConfirm,
    promptDismiss,
    confirmDismiss,
  } = useAddTransaction()

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
        onClick={promptDismiss}
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
                onClick={promptDismiss}
                aria-label="Close modal"
                title="Close modal"
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
                      <AccountSelectField
                        id="source-account-select"
                        label={type === 'Income' ? 'Deposit To' : 'Pay From'}
                        value={sourceAccountId}
                        onChange={setSourceAccountId}
                        accounts={paymentAccounts}
                        accountGroups={accountGroups}
                        required
                      />

                      {/* Destination Account (Only for Transfer) */}
                      {type === 'Transfer' && (
                        <AccountSelectField
                          id="destination-account-select"
                          label="Transfer To"
                          value={toAccountId}
                          onChange={setToAccountId}
                          accounts={paymentAccounts}
                          accountGroups={accountGroups}
                          excludeAccountId={sourceAccountId}
                          placeholder="Select Destination Account..."
                          required
                        />
                      )}                      {/* Splits (Category & SubCategory in Unified 2-Col Grid) */}
                      {type !== 'Transfer' && (
                        <CategorySplitGrid
                          splits={splits}
                          categoryGroups={categoryGroups}
                          accounts={accounts}
                          accountGroups={accountGroups}
                          onUpdateSplit={updateSplit}
                          onPendingNewAccount={setPendingNewAccount}
                        />
                      )}
                    </>
                  ) : (
                    /* Advanced Mode: Journal Entry */
                    <JournalEntrySection
                      journalLines={journalLines}
                      setJournalLines={setJournalLines}
                      accountGroups={accountGroups}
                      accounts={accounts}
                      onPendingNewAccount={setPendingNewAccount}
                      onAddLine={addJournalLine}
                      onRemoveLine={removeJournalLine}
                      onUpdateLine={updateJournalLine}
                      onAutoBalance={handleAutoBalance}
                      debitTotal={debitTotal}
                      creditTotal={creditTotal}
                      balanceDiff={balanceDiff}
                    />
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
                    <RecurringScheduleSection
                      isRecurring={isRecurring}
                      setIsRecurring={setIsRecurring}
                      frequency={frequency}
                      setFrequency={setFrequency}
                      recurringEndDate={recurringEndDate}
                      handleRecurringEndDateChange={handleRecurringEndDateChange}
                      maxOccurrences={maxOccurrences}
                      handleRecurringOccurrencesChange={handleRecurringOccurrencesChange}
                    />
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

      <ReclassifyConfirmModal
        isOpen={confirmReclassifyOpen}
        onClose={() => setConfirmReclassifyOpen(false)}
        ingestion={ingestion}
        mode={mode}
        type={type}
        vendor={vendor}
        sourceAccountId={sourceAccountId}
        toAccountId={toAccountId}
        splits={splits}
        journalLines={journalLines}
        accounts={accounts}
        reclassifyMutation={reclassifyMutation}
        setCurrentOperationId={setCurrentOperationId}
      />

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

      {showDismissConfirm && (
        <ConfirmationModal
          isOpen={showDismissConfirm}
          title="Discard Changes?"
          message="You have unsaved changes. Are you sure you want to dismiss and lose these changes?"
          confirmLabel="Discard Changes"
          cancelLabel="Keep Editing"
          confirmVariant="danger"
          onConfirm={confirmDismiss}
          onCancel={() => setShowDismissConfirm(false)}
        />
      )}
    </>
  )
}
