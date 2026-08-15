import { useMemo, useState } from 'react'
import { RefreshCw, RotateCcw, X, Trash2, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { uuidv7 } from 'uuidv7'
import { useGetAccounts, useGetAccountGroups } from '@/hooks/useAccounts'
import { useGetVendors, useCreateVendor } from '@/hooks/useVendors'
import { useGetIngestionById, useUpdateIngestionVendor } from '@/hooks/useIngestions'
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
    setMaxOccurrences,
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
  } = useAddTransaction()

  const [streamReasoning, setStreamReasoning] = useState(false)
  const [reclassifyComment, setReclassifyComment] = useState('')

  const queryClient = useQueryClient()
  const { data: accounts = [] } = useGetAccounts()
  const { data: accountGroups = [] } = useGetAccountGroups()
  const { data: dbVendors = [] } = useGetVendors()

  const createVendorMutation = useCreateVendor()
  const updateIngestionVendorMutation = useUpdateIngestionVendor()

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
      { id: uuidv7(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
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
        className={`fixed bottom-0 left-0 right-0 w-full ${ingestion || isLoadingIngestion ? 'md:max-w-3xl' : 'md:max-w-md'
          } mx-auto bg-white dark:bg-slate-900 rounded-t-2xl z-55 shadow-2xl p-4 flex flex-col gap-4 border-t border-slate-200 dark:border-slate-800 animate-slide-up pb-safe max-h-[90vh] overflow-y-auto transition-all duration-500 ${isFlashing
            ? 'ring-4 ring-indigo-500/50 scale-[1.02] bg-indigo-50 dark:bg-indigo-950/20'
            : ''
          }`}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Log Transaction</h2>
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
                    // Drawer won't open automatically anymore
                    reclassifyMutation.mutate({ id: ingestion.id, operationId: opId })
                  }
                }}
                disabled={reclassifyMutation.isPending}
                title="Re-run AI classification"
                className={`p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${reclassifyMutation.isPending ? 'animate-spin' : ''
                  }`}
              >
                <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div
          className={
            ingestion || isLoadingIngestion ? 'grid grid-cols-1 md:grid-cols-12 gap-4 items-start' : 'flex flex-col gap-4'
          }
        >
          {/* Form and Toggles Column */}
          <div className={ingestion || isLoadingIngestion ? 'md:col-span-7 flex flex-col gap-4' : 'flex flex-col gap-4'}>
            <TransactionTypeTabs />

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {mode === 'Simple' ? (
                <>
                  {/* Total Amount */}
                  <div className="flex flex-col gap-1">
                    <CalculatorInput
                      placeholder="0.00"
                      value={totalAmount}
                      onChange={setTotalAmount}
                      required
                      className="w-full text-3xl font-bold text-center py-2 border-b border-slate-200 dark:border-slate-800 bg-transparent text-slate-900 dark:text-slate-50 focus:outline-none focus:border-blue-600"
                    />
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

                  {/* Splits (Category & SubCategory) */}
                  {type !== 'Transfer' && (
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between items-center mt-2">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Category
                        </label>
                      </div>

                      {splits.map((split) => {
                        const subCategoryOptions = accounts
                          .filter((a) => a.accountGroupId === split.categoryId)
                          .sort((a, b) => a.name.localeCompare(b.name))
                        return (
                          <div
                            key={split.id}
                            className="flex flex-col gap-2 p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800"
                          >
                            <div className="flex gap-2">
                              <Combobox
                                options={categoryGroups.map((g) => ({ value: g.id, label: g.name }))}
                                value={split.categoryId}
                                onChange={(val) => updateSplit(split.id, { categoryId: val })}
                                placeholder="Select Category..."
                                className="flex-1"
                              />
                            </div>

                            <div className="flex gap-2">
                              <Combobox
                                options={subCategoryOptions.map((a) => ({
                                  value: a.id!,
                                  label: a.name,
                                }))}
                                value={split.subCategoryId}
                                onChange={(val) => updateSplit(split.id, { subCategoryId: val })}
                                placeholder="Select Sub-Category..."
                                className="flex-1"
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
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Journal Lines
                    </label>
                  </div>

                  {journalLines.map((line) => (
                    <div
                      key={line.id}
                      className="flex flex-col gap-2 p-2 border border-slate-200 dark:border-slate-800 rounded-lg"
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
                          className="flex-1 text-sm"
                        />
                        <Combobox
                          options={accounts
                            .filter((a) => a.accountGroupId === line.categoryId)
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((a) => ({ value: a.id!, label: a.name }))}
                          value={line.subCategoryId}
                          onChange={(val) => updateJournalLine(line.id, { subCategoryId: val })}
                          placeholder="Account..."
                          className="flex-1 text-sm"
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
                        <div className="flex flex-col flex-1 border border-slate-200 dark:border-slate-800 rounded-lg focus-within:border-blue-600 bg-white dark:bg-slate-950">
                          <div className="flex text-[10px] uppercase font-bold text-slate-400 bg-slate-100 dark:bg-slate-900 rounded-t-lg">
                            <button
                              type="button"
                              onClick={() => updateJournalLine(line.id, { type: 'Debit' })}
                              className={`flex-1 py-1 text-center transition-colors ${line.type === 'Debit'
                                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
                                  : 'hover:bg-slate-200/50 dark:hover:bg-slate-800'
                                }`}
                            >
                              Dr
                            </button>
                            <button
                              type="button"
                              onClick={() => updateJournalLine(line.id, { type: 'Credit' })}
                              className={`flex-1 py-1 text-center transition-colors ${line.type === 'Credit'
                                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
                                  : 'hover:bg-slate-200/50 dark:hover:bg-slate-800'
                                }`}
                            >
                              Cr
                            </button>
                          </div>
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
                            className="w-full min-h-[30px] px-2 pr-8 text-right bg-transparent text-sm focus:outline-none text-slate-900 dark:text-slate-100"
                          />
                        </div>

                        {journalLines.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeJournalLine(line.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addJournalLine}
                    className="mt-1 w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-colors cursor-pointer border border-dashed border-slate-300 dark:border-slate-600"
                  >
                    <Plus className="w-4 h-4" strokeWidth={1.5} /> Add Line
                  </button>

                  <div className="flex justify-between items-center text-sm font-medium mt-2 p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <span className="text-slate-500">Totals:</span>
                    <div className="flex gap-4">
                      <span className="text-blue-600 dark:text-blue-400">
                        Dr: ₱
                        {journalLines
                          .filter((l) => l.type === 'Debit')
                          .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
                          .toFixed(2)}
                      </span>
                      <span className="text-rose-600 dark:text-rose-400 font-semibold bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded">
                        Cr: ₱
                        {journalLines
                          .filter((l) => l.type === 'Credit')
                          .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
                          .toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Shared Vendor, Date, and Note for both modes */}
              <div className="flex flex-col gap-1 mt-2">
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
                    if (ingestion) updateIngestionVendorMutation.mutate({ id: ingestion.id, vendor: val })
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
                          if (ingestion) updateIngestionVendorMutation.mutate({ id: ingestion.id, vendor: val })
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
              <div className="grid grid-cols-2 gap-2 mt-2">
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
                    className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full"
                  />
                </div>
                <div className="flex flex-col gap-1">
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
                    className="min-h-[44px] p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-sm resize-y"
                    rows={2}
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
                    className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full"
                  />
                </div>
              </div>

              {ingestion && (
                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex items-center justify-between">
                    {!skipLearning ? (
                      <label
                        htmlFor="correction-reason-textarea"
                        className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                      >
                        Correction Reason / Notes (Why)
                      </label>
                    ) : (
                      <div />
                    )}
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-500 uppercase tracking-wider select-none">
                      <span>Skip AI Learning</span>
                      <input
                        type="checkbox"
                        checked={skipLearning}
                        onChange={(e) => setSkipLearning(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer dark:bg-slate-950 dark:border-slate-800"
                      />
                    </label>
                  </div>
                  {!skipLearning && (
                    <textarea
                      id="correction-reason-textarea"
                      placeholder="Describe adjustments or rules to be set against the AI reasoning..."
                      value={userWhy}
                      onChange={(e) => setUserWhy(e.target.value)}
                      className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-sm focus:outline-none focus:border-blue-600 resize-y"
                      rows={2}
                    />
                  )}
                </div>
              )}

              {!initialData && (
                <div className="mt-4 p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/50">
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
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Frequency
                        </label>
                        <select
                          value={frequency}
                          onChange={(e) => setFrequency(e.target.value as any)}
                          className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full"
                        >
                          <option value="Daily">Daily</option>
                          <option value="Weekly">Weekly</option>
                          <option value="Monthly">Monthly</option>
                          <option value="Yearly">Yearly</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Max Times (Optional)
                        </label>
                        <input
                          type="number"
                          placeholder="Unlimited"
                          value={maxOccurrences}
                          onChange={(e) => setMaxOccurrences(e.target.value)}
                          className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {initialData ? (
                <button
                  type="submit"
                  onClick={() => {
                    submitTypeRef.current = 'close'
                  }}
                  className="w-full min-h-[48px] mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors cursor-pointer text-lg shadow-sm"
                >
                  Save Changes
                </button>
              ) : (
                <div className="flex gap-2 mt-4">
                  <button
                    type="submit"
                    onClick={() => {
                      submitTypeRef.current = 'close'
                    }}
                    className="flex-[2] min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors cursor-pointer shadow-sm text-sm"
                  >
                    Save & Close
                  </button>
                  <button
                    type="submit"
                    onClick={() => {
                      submitTypeRef.current = 'more'
                    }}
                    className="flex-[1.5] min-h-[48px] bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold rounded-lg transition-colors cursor-pointer shadow-sm text-sm"
                  >
                    Save & Add Another
                  </button>
                </div>
              )}
            </form>
          </div>
          <IngestionReviewPanel />
        </div>
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
        const originalType = ingestion.ai_parsed?.transaction_type
        const originalVendor = ingestion.ai_parsed?.vendor?.name || ''
        const originalDebit = ingestion.ai_parsed?.debit_account_id || null
        const originalCredit = ingestion.ai_parsed?.credit_account_id || null

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
