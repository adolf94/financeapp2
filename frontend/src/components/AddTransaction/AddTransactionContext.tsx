import { createContext, useContext, useState, useCallback, useMemo, useRef, ReactNode } from 'react'
import { PendingIngestion, useConfirmIngestion, useLearnIngestion, useReclassifyIngestion } from '@/hooks/useIngestions'
import { useCreateTransaction, useUpdateTransaction, Transaction, LedgerEntry } from '@/hooks/useTransactions'
import { useCreateRecurringTransaction } from '@/hooks/useRecurringTransactions'
import { useCreateVendor, useGetVendors } from '@/hooks/useVendors'
import { useGetAccounts } from '@/hooks/useAccounts'
import { uuidv7 } from 'uuidv7'
import dayjs from 'dayjs'

import { useRecurringScheduleState } from './hooks/useRecurringScheduleState'
import { useSuggestionsState, PendingNewAccountType, SuggestionData } from './hooks/useSuggestionsState'
import { useIngestionPrefill } from './hooks/useIngestionPrefill'
import { sanitizeAmount } from '@/components/ui/CalculatorInput'

const generateId = () => uuidv7()

export type { PendingNewAccountType, SuggestionData }

export interface SplitLine {
  id: string
  categoryId: string
  subCategoryId: string
  amount: string
}

export interface JournalLine {
  id: string
  categoryId: string
  subCategoryId: string
  amount: string
  type: 'Debit' | 'Credit'
  note?: string
  referenceNumber?: string
}

interface AddTransactionContextProps {
  // Modal Props
  isOpen: boolean
  onClose: () => void
  onSave?: (date: string) => void
  initialData: Transaction | null
  ingestionId: string | null
  ingestion: PendingIngestion | null
  isLoadingIngestion: boolean

  // Form State
  mode: 'Simple' | 'Advanced'
  setMode: (mode: 'Simple' | 'Advanced') => void
  type: 'Income' | 'Expense' | 'Transfer' | 'Journal'
  setType: (type: 'Income' | 'Expense' | 'Transfer' | 'Journal') => void
  totalAmount: string
  setTotalAmount: (amount: string) => void
  sourceAccountId: string
  setSourceAccountId: (id: string) => void
  toAccountId: string
  setToAccountId: (id: string) => void
  splits: SplitLine[]
  setSplits: (splits: SplitLine[] | ((prev: SplitLine[]) => SplitLine[])) => void
  journalLines: JournalLine[]
  setJournalLines: (lines: JournalLine[] | ((prev: JournalLine[]) => JournalLine[])) => void
  vendor: string
  setVendor: (vendor: string) => void
  selectedLookups: string[]
  setSelectedLookups: (lookups: string[] | ((prev: string[]) => string[])) => void
  selectedNewLookups: string[]
  setSelectedNewLookups: (newLookups: string[] | ((prev: string[]) => string[])) => void
  date: string
  setDate: (date: string) => void
  note: string
  setNote: (note: string) => void
  referenceNumber: string
  setReferenceNumber: (ref: string) => void
  userWhy: string
  setUserWhy: (why: string) => void
  skipLearning: boolean
  setSkipLearning: (skip: boolean) => void

  // Related & Merge Management
  mergeRelatedIds: string[]
  setMergeRelatedIds: (ids: string[] | ((prev: string[]) => string[])) => void
  confirmedMatchTxId: string | null
  linkAndDismissIngestion: () => void

  // Recurring
  isRecurring: boolean
  setIsRecurring: (rec: boolean) => void
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  setFrequency: (freq: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly') => void
  maxOccurrences: string
  setMaxOccurrences: (occ: string) => void
  recurringEndDate: string
  setRecurringEndDate: (date: string) => void
  handleRecurringOccurrencesChange: (occ: string) => void
  handleRecurringEndDateChange: (dateStr: string) => void

  // Suggestions & Sub-forms
  pendingNewAccount: PendingNewAccountType | null
  setPendingNewAccount: (acc: PendingNewAccountType | null) => void
  editingSuggestion: { idx: number; data: SuggestionData } | null
  setEditingSuggestion: (s: { idx: number; data: SuggestionData } | null) => void
  createdSuggestions: Set<number>
  setCreatedSuggestions: (s: Set<number> | ((prev: Set<number>) => Set<number>)) => void
  suggestedVendorType: 'Business' | 'Individual'
  setSuggestedVendorType: (type: 'Business' | 'Individual') => void
  suggestedVendorTags: string
  setSuggestedVendorTags: (tags: string) => void
  isReviewOpen: boolean
  setIsReviewOpen: (open: boolean) => void
  confirmReclassifyOpen: boolean
  setConfirmReclassifyOpen: (open: boolean) => void
  currentOperationId: string
  setCurrentOperationId: (id: string) => void
  isDrawerOpen: boolean
  setIsDrawerOpen: (open: boolean) => void

  // Flashing & Dismiss Confirmation
  isFlashing: boolean
  showDismissConfirm: boolean
  setShowDismissConfirm: (show: boolean) => void
  promptDismiss: () => void
  confirmDismiss: () => void
  isDirty: boolean

  // Actions
  resetForm: () => void
  handleSubmit: (e: React.FormEvent) => void
  submitTypeRef: React.MutableRefObject<'close' | 'more'>
  reclassifyMutation: ReturnType<typeof useReclassifyIngestion>
  isSubmitting: boolean
}

const AddTransactionContext = createContext<AddTransactionContextProps | undefined>(undefined)

export function AddTransactionProvider({
  children,
  isOpen,
  onClose,
  onSave,
  initialData,
  ingestionId,
  ingestion,
  isLoadingIngestion = false,
}: {
  children: ReactNode
  isOpen: boolean
  onClose: () => void
  onSave?: (date: string) => void
  initialData: Transaction | null
  ingestionId: string | null
  ingestion: PendingIngestion | null
  isLoadingIngestion?: boolean
}) {
  const { data: accounts = [] } = useGetAccounts()
  const { data: dbVendors = [] } = useGetVendors()

  const createTxMutation = useCreateTransaction()
  const updateTxMutation = useUpdateTransaction()
  const createVendorMutation = useCreateVendor()
  const createRecurringTxMutation = useCreateRecurringTransaction()
  const confirmIngestionMutation = useConfirmIngestion()
  const learnIngestionMutation = useLearnIngestion()
  const reclassifyMutation = useReclassifyIngestion()

  const [mode, setMode] = useState<'Simple' | 'Advanced'>('Simple')
  const [type, setType] = useState<'Income' | 'Expense' | 'Transfer' | 'Journal'>('Expense')
  const [totalAmount, setTotalAmount] = useState('')
  const [sourceAccountId, setSourceAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [splits, setSplits] = useState<SplitLine[]>([
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '' },
  ])
  const [journalLines, setJournalLines] = useState<JournalLine[]>([
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit', note: '', referenceNumber: '' },
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit', note: '', referenceNumber: '' },
  ])
  const [vendor, setVendor] = useState('')
  const [selectedLookups, setSelectedLookups] = useState<string[]>([])
  const [selectedNewLookups, setSelectedNewLookups] = useState<string[]>([])
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DDTHH:mm'))
  const [note, setNote] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [userWhy, setUserWhy] = useState('')
  const [skipLearning, setSkipLearning] = useState(false)
  const [mergeRelatedIds, setMergeRelatedIds] = useState<string[]>([])
  const [isReviewOpen, setIsReviewOpen] = useState(true)
  const [confirmReclassifyOpen, setConfirmReclassifyOpen] = useState(false)
  const [currentOperationId, setCurrentOperationId] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [showDismissConfirm, setShowDismissConfirm] = useState(false)
  const submitTypeRef = useRef<'close' | 'more'>('close')
  const initialValuesRef = useRef<any>(null)

  // Sub-hooks
  const recurring = useRecurringScheduleState(date)
  const suggestions = useSuggestionsState()

  const confirmedMatchTxId = useMemo(() => {
    if (ingestion?.related_transaction_ids && ingestion.related_transaction_ids.length > 0) {
      return ingestion.related_transaction_ids[0]
    }
    return null
  }, [ingestion])

  const handleSetMode = useCallback(
    (nextMode: 'Simple' | 'Advanced') => {
      if (nextMode === 'Advanced' && mode === 'Simple') {
        const sourceAcc = accounts.find((a) => a.id === sourceAccountId)
        const sourceGroupId = sourceAcc?.accountGroupId || ''
        const sanitizedTotal = totalAmount ? sanitizeAmount(totalAmount) : ''

        if (type === 'Transfer') {
          const toAcc = accounts.find((a) => a.id === toAccountId)
          const toGroupId = toAcc?.accountGroupId || ''

          setJournalLines([
            {
              id: generateId(),
              categoryId: toGroupId,
              subCategoryId: toAccountId || '',
              amount: sanitizedTotal,
              type: 'Debit',
              note: '',
              referenceNumber: '',
            },
            {
              id: generateId(),
              categoryId: sourceGroupId,
              subCategoryId: sourceAccountId || '',
              amount: sanitizedTotal,
              type: 'Credit',
              note: '',
              referenceNumber: '',
            },
          ])
        } else if (type === 'Income') {
          const categorySplit = splits[0]
          const catAcc = accounts.find((a) => a.id === categorySplit?.subCategoryId)
          const catGroupId = categorySplit?.categoryId || catAcc?.accountGroupId || ''

          setJournalLines([
            {
              id: generateId(),
              categoryId: sourceGroupId,
              subCategoryId: sourceAccountId || '',
              amount: sanitizedTotal,
              type: 'Debit',
              note: '',
              referenceNumber: '',
            },
            {
              id: generateId(),
              categoryId: catGroupId,
              subCategoryId: categorySplit?.subCategoryId || '',
              amount: categorySplit?.amount ? sanitizeAmount(categorySplit.amount) : sanitizedTotal,
              type: 'Credit',
              note: '',
              referenceNumber: '',
            },
          ])
        } else {
          // Expense
          const categorySplit = splits[0]
          const catAcc = accounts.find((a) => a.id === categorySplit?.subCategoryId)
          const catGroupId = categorySplit?.categoryId || catAcc?.accountGroupId || ''

          setJournalLines([
            {
              id: generateId(),
              categoryId: catGroupId,
              subCategoryId: categorySplit?.subCategoryId || '',
              amount: categorySplit?.amount ? sanitizeAmount(categorySplit.amount) : sanitizedTotal,
              type: 'Debit',
              note: '',
              referenceNumber: '',
            },
            {
              id: generateId(),
              categoryId: sourceGroupId,
              subCategoryId: sourceAccountId || '',
              amount: sanitizedTotal,
              type: 'Credit',
              note: '',
              referenceNumber: '',
            },
          ])
        }
      }

      setMode(nextMode)
    },
    [mode, accounts, sourceAccountId, toAccountId, totalAmount, type, splits]
  )

  const resetForm = useCallback(() => {
    setMode('Simple')
    setType('Expense')
    setTotalAmount('')
    setSourceAccountId('')
    setToAccountId('')
    setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
    setJournalLines([
      { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit', note: '', referenceNumber: '' },
      { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit', note: '', referenceNumber: '' },
    ])
    setVendor('')
    setSelectedLookups([])
    setSelectedNewLookups([])
    setNote('')
    setReferenceNumber('')
    setUserWhy('')
    setSkipLearning(false)
    setDate(dayjs().format('YYYY-MM-DDTHH:mm'))
    recurring.resetRecurringState()
  }, [recurring])

  const takeCurrentSnapshot = useCallback(() => {
    return JSON.stringify({
      mode,
      type,
      totalAmount,
      sourceAccountId,
      toAccountId,
      splits: splits.map((s) => ({ categoryId: s.categoryId, subCategoryId: s.subCategoryId, amount: s.amount })),
      journalLines: journalLines.map((l) => ({
        categoryId: l.categoryId,
        subCategoryId: l.subCategoryId,
        amount: l.amount,
        type: l.type,
        note: l.note || '',
        referenceNumber: l.referenceNumber || '',
      })),
      vendor,
      selectedLookups,
      selectedNewLookups,
      date,
      note,
      referenceNumber,
      userWhy,
      skipLearning,
      isRecurring: recurring.isRecurring,
      frequency: recurring.frequency,
      maxOccurrences: recurring.maxOccurrences,
      recurringEndDate: recurring.recurringEndDate,
    })
  }, [
    mode,
    type,
    totalAmount,
    sourceAccountId,
    toAccountId,
    splits,
    journalLines,
    vendor,
    selectedLookups,
    selectedNewLookups,
    date,
    note,
    referenceNumber,
    userWhy,
    skipLearning,
    recurring.isRecurring,
    recurring.frequency,
    recurring.maxOccurrences,
    recurring.recurringEndDate,
  ])

  // Ingestion & initialData prefill logic
  useIngestionPrefill({
    isOpen,
    initialData,
    ingestion,
    accounts,
    vendors: dbVendors,
    reclassifyData: reclassifyMutation.data,
    resetForm,
    resetSuggestionsState: suggestions.resetSuggestionsState,
    setIsFlashing,
    setMode,
    setType,
    setTotalAmount,
    setSourceAccountId,
    setToAccountId,
    setSplits,
    setJournalLines,
    setVendor,
    setSelectedLookups,
    setSelectedNewLookups,
    setDate,
    setNote,
    setReferenceNumber,
    setUserWhy,
    setIsRecurring: recurring.setIsRecurring,
    setSuggestedVendorType: suggestions.setSuggestedVendorType,
    setSuggestedVendorTags: suggestions.setSuggestedVendorTags,
  })

  // Snapshot capture: snapshot initialized form values on first render when modal is open
  const snapshotInitializedRef = useRef<string | null>(null)
  const currentKey = isOpen
    ? (initialData ? `init:${initialData.id}` : ingestion ? `ing:${ingestion.id}` : 'new')
    : null

  if (isOpen && currentKey && snapshotInitializedRef.current !== currentKey) {
    snapshotInitializedRef.current = currentKey
    // Construct initial snapshot from props directly to guarantee sync accuracy without waiting for effects
    if (initialData) {
      initialValuesRef.current = JSON.stringify({
        mode: initialData.type === 'Journal' ? 'Advanced' : 'Simple',
        type: initialData.type,
        totalAmount: initialData.type === 'Journal' ? '' : (initialData.entries.find((e) => e.amount > 0)?.amount.toString() || ''),
        sourceAccountId: initialData.type === 'Expense' ? (initialData.entries.find((e) => e.amount < 0)?.accountId || '') : '',
        toAccountId: initialData.type === 'Transfer' ? (initialData.entries.find((e) => e.amount > 0)?.accountId || '') : '',
        splits: initialData.type === 'Expense' ? initialData.entries.filter((e) => e.amount > 0).map((e) => ({ categoryId: accounts.find((a) => a.id === e.accountId)?.accountGroupId || '', subCategoryId: e.accountId, amount: '' })) : [{ categoryId: '', subCategoryId: '', amount: '' }],
        journalLines: initialData.type === 'Journal' ? initialData.entries.map((e) => ({ categoryId: accounts.find((a) => a.id === e.accountId)?.accountGroupId || '', subCategoryId: e.accountId, amount: Math.abs(e.amount).toString(), type: e.amount > 0 ? 'Debit' : 'Credit', note: e.note || '', referenceNumber: e.referenceNumber || '' })) : [{ categoryId: '', subCategoryId: '', amount: '', type: 'Debit', note: '', referenceNumber: '' }, { categoryId: '', subCategoryId: '', amount: '', type: 'Credit', note: '', referenceNumber: '' }],
        vendor: initialData.vendor || '',
        selectedLookups: [],
        selectedNewLookups: [],
        date: dayjs(initialData.date).format('YYYY-MM-DDTHH:mm'),
        note: initialData.note || '',
        referenceNumber: initialData.referenceNumber || '',
        userWhy: '',
        skipLearning: false,
        isRecurring: !!initialData.scheduleId,
        frequency: 'Monthly',
        maxOccurrences: '',
        recurringEndDate: '',
      })
    } else if (ingestion && ingestion.ai_parsed) {
      const parsed = ingestion.ai_parsed
      const rawType = parsed.transaction_type || ''
      const t = (['Income', 'Expense', 'Transfer'].includes(rawType) ? rawType : 'Expense') as 'Income' | 'Expense' | 'Transfer'
      const vendorName = typeof parsed.vendor === 'string' ? parsed.vendor : parsed.vendor?.name || ''
      const debitAcc = parsed.debit_account_id ? accounts.find((a) => a.id === parsed.debit_account_id) : null
      initialValuesRef.current = JSON.stringify({
        mode: 'Simple',
        type: t,
        totalAmount: parsed.amount ? Math.abs(parsed.amount).toString() : '',
        sourceAccountId: parsed.credit_account_id || '',
        toAccountId: t === 'Transfer' ? (parsed.debit_account_id || '') : '',
        splits: [{
          categoryId: debitAcc?.accountGroupId || '',
          subCategoryId: parsed.debit_account_id || '',
          amount: '',
        }],
        journalLines: [
          { categoryId: '', subCategoryId: '', amount: '', type: 'Debit', note: '', referenceNumber: '' },
          { categoryId: '', subCategoryId: '', amount: '', type: 'Credit', note: '', referenceNumber: '' },
        ],
        vendor: vendorName,
        selectedLookups: Array.from(
          new Set([
            ...(parsed.vendor?.lookups || []),
            ...(dbVendors.find((v) => v.name.toLowerCase() === vendorName.toLowerCase())?.lookups || []),
          ])
        ),
        selectedNewLookups: parsed.vendor?.new_lookups || parsed.vendor?.NewLookups || [],
        date: parsed.date ? dayjs(parsed.date).format('YYYY-MM-DDTHH:mm') : (ingestion.received_at ? dayjs(ingestion.received_at).format('YYYY-MM-DDTHH:mm') : dayjs().format('YYYY-MM-DDTHH:mm')),
        note: parsed.summary || parsed.notes || '',
        referenceNumber: parsed.reference_number || '',
        userWhy: ingestion.user_confirmed?.user_why || parsed.suggested_rule || parsed.user_why || '',
        skipLearning: false,
        isRecurring: false,
        frequency: 'Monthly',
        maxOccurrences: '',
        recurringEndDate: '',
      })
    } else {
      initialValuesRef.current = takeCurrentSnapshot()
    }
  } else if (!isOpen && snapshotInitializedRef.current !== null) {
    snapshotInitializedRef.current = null
    initialValuesRef.current = null
  }

  const isDirty = useMemo(() => {
    if (!initialValuesRef.current) return false
    return takeCurrentSnapshot() !== initialValuesRef.current
  }, [takeCurrentSnapshot])

  const promptDismiss = useCallback(() => {
    if (isDirty) {
      setShowDismissConfirm(true)
    } else {
      onClose()
      if (!initialData?.id) resetForm()
    }
  }, [isDirty, onClose, initialData, resetForm])

  const confirmDismiss = useCallback(() => {
    setShowDismissConfirm(false)
    onClose()
    if (!initialData?.id) resetForm()
  }, [onClose, initialData, resetForm])

  const linkAndDismissIngestion = useCallback(() => {
    if (!ingestionId) return
    const targetTxId = confirmedMatchTxId || 'matched-existing'
    confirmIngestionMutation.mutate(
      {
        id: ingestionId,
        transactionId: targetTxId,
        userConfirmed: ingestion?.ai_parsed || {},
        skipLearning: true,
        dismissRelatedIds: mergeRelatedIds,
        dismissStatus: 'Merged',
      },
      {
        onSuccess: () => {
          onClose()
          resetForm()
        },
      }
    )
  }, [ingestionId, confirmedMatchTxId, ingestion, mergeRelatedIds, confirmIngestionMutation, onClose, resetForm])

  const hasMasks = (name?: string) => {
    if (!name) return false
    return name.includes('*') || name.includes('X') || name.includes('x')
  }

  const saveAdvancedTransaction = (entries: LedgerEntry[]) => {
    let finalScheduleId: string | undefined = undefined

    if (recurring.isRecurring && !initialData) {
      finalScheduleId = uuidv7()
      let nextDate = new Date(date)
      if (recurring.frequency === 'Daily') nextDate.setDate(nextDate.getDate() + 1)
      else if (recurring.frequency === 'Weekly') nextDate.setDate(nextDate.getDate() + 7)
      else if (recurring.frequency === 'Monthly') nextDate.setMonth(nextDate.getMonth() + 1)
      else if (recurring.frequency === 'Yearly') nextDate.setFullYear(nextDate.getFullYear() + 1)

      createRecurringTxMutation.mutate({
        id: finalScheduleId,
        frequency: recurring.frequency,
        interval: 1,
        startDate: dayjs(date).toISOString(),
        endDate: recurring.recurringEndDate ? dayjs(recurring.recurringEndDate).toISOString() : undefined,
        nextOccurrenceDate: nextDate.toISOString(),
        maxOccurrences: recurring.maxOccurrences ? parseInt(recurring.maxOccurrences) : undefined,
        templateType: 'Journal',
        templateNote: note,
        templateVendor: vendor || undefined,
        templateEntries: entries.map((e) => ({
          accountId: e.accountId,
          amount: e.amount,
          note: e.note,
          referenceNumber: e.referenceNumber,
        })),
      })
    }

    const transaction: Transaction = {
      ...(initialData?.id ? { id: initialData.id } : {}),
      type: 'Journal',
      scheduleId: finalScheduleId,
      entries,
      vendor,
      note,
      referenceNumber,
      mergedIngestionIds: mergeRelatedIds,
      date: dayjs(date).toISOString(),
    }

    const mutation = initialData?.id ? updateTxMutation : createTxMutation
    mutation.mutate(transaction, {
      onSuccess: (data) => {
        if (ingestionId) {
          confirmIngestionMutation.mutate(
            {
              id: ingestionId,
              transactionId: data.id,
              skipLearning: skipLearning,
              dismissRelatedIds: mergeRelatedIds,
              dismissStatus: 'Merged',
              userConfirmed: {
                vendor: vendor ? {
                  name: vendor,
                  matched: ingestion?.ai_parsed?.vendor?.name === vendor ? ingestion.ai_parsed.vendor.matched : false,
                  lookups: selectedLookups,
                  new_lookups: selectedNewLookups
                } : null,
                amount: entries.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0),
                transaction_type: 'Journal',
                notes: note || null,
                reference_number: referenceNumber || null,
                user_why: userWhy || null,
                date: dayjs(date).toISOString(),
              },
            },
            {
              onSuccess: () => {
                onSave?.(dayjs(date).toISOString())
                onClose()
                resetForm()
              },
            }
          )
          return
        }

        if (submitTypeRef.current === 'more') {
          setTotalAmount('')
          setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
          setJournalLines([
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit', note: '', referenceNumber: '' },
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit', note: '', referenceNumber: '' },
          ])
          setVendor('')
          setSelectedLookups([])
          setSelectedNewLookups([])
          setNote('')
          setReferenceNumber('')
        } else {
          onClose()
          if (!initialData?.id) resetForm()
        }
      },
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (mode === 'Advanced') {
      if (!date) return

      let debitSum = 0
      let creditSum = 0
      const entries: LedgerEntry[] = []

      for (const line of journalLines) {
        if (!line.subCategoryId) continue
        const amt = parseFloat(sanitizeAmount(line.amount || '0'))
        if (amt === 0) continue

        const roundedAmt = Math.round(amt * 100) / 100

        if (line.type === 'Debit') debitSum += roundedAmt
        else creditSum += roundedAmt

        entries.push({
          accountId: line.subCategoryId,
          amount: line.type === 'Debit' ? roundedAmt : -roundedAmt,
          note: line.note?.trim() || undefined,
          referenceNumber: line.referenceNumber?.trim() || undefined,
        })
      }

      if (Math.abs(debitSum - creditSum) > 0.01) {
        alert(`Debits (₱${debitSum.toFixed(2)}) must equal Credits (₱${creditSum.toFixed(2)}).`)
        return
      }

      if (entries.length < 2) {
        alert('At least two ledger entries are required.')
        return
      }

      if (vendor && hasMasks(vendor)) {
        alert('Vendor name contains mask characters (*, xxx, or related). Please select a clean vendor name.')
        return
      }

      if (vendor && !dbVendors.some((v) => v.name.toLowerCase() === vendor.toLowerCase())) {
        const tags = suggestions.suggestedVendorTags
          ? suggestions.suggestedVendorTags.split(',').map((t) => t.trim()).filter(Boolean)
          : []
        const lookups = Array.from(new Set([...selectedLookups, ...selectedNewLookups]))
        createVendorMutation.mutate(
          { name: vendor, type: suggestions.suggestedVendorType, tags, lookups },
          {
            onSettled: () => {
              saveAdvancedTransaction(entries)
            },
          }
        )
        return
      }

      saveAdvancedTransaction(entries)
      return
    }

    if (!totalAmount || !sourceAccountId || !date) return

    if (vendor && hasMasks(vendor)) {
      alert('Vendor name contains mask characters (*, xxx, or related). Please select a clean vendor name.')
      return
    }

    if (vendor && !dbVendors.some((v) => v.name.toLowerCase() === vendor.toLowerCase())) {
      const tags = suggestions.suggestedVendorTags
        ? suggestions.suggestedVendorTags.split(',').map((t) => t.trim()).filter(Boolean)
        : []
      const lookups = Array.from(new Set([...selectedLookups, ...selectedNewLookups]))
      createVendorMutation.mutate({ name: vendor, type: suggestions.suggestedVendorType, tags, lookups })
    }

    const entries: LedgerEntry[] = []
    const parsedTotal = parseFloat(sanitizeAmount(totalAmount))
    const trimmedNote = note.trim() || undefined
    const trimmedRef = referenceNumber.trim() || undefined

    if (type === 'Transfer') {
      if (!toAccountId) return
      entries.push({
        accountId: sourceAccountId,
        amount: -parsedTotal,
        note: trimmedNote,
        referenceNumber: trimmedRef,
      })
      entries.push({
        accountId: toAccountId,
        amount: parsedTotal,
      })
    } else if (type === 'Expense') {
      const categorySplit = splits[0]
      if (!categorySplit?.subCategoryId) {
        alert('Please select a category.')
        return
      }

      entries.push({
        accountId: sourceAccountId,
        amount: -parsedTotal,
      })

      entries.push({
        accountId: categorySplit.subCategoryId,
        amount: parsedTotal,
        note: trimmedNote,
        referenceNumber: trimmedRef,
      })
    } else if (type === 'Income') {
      const categorySplit = splits[0]
      if (!categorySplit?.subCategoryId) {
        alert('Please select a category.')
        return
      }

      entries.push({
        accountId: sourceAccountId,
        amount: parsedTotal,
      })

      entries.push({
        accountId: categorySplit.subCategoryId,
        amount: -parsedTotal,
        note: trimmedNote,
        referenceNumber: trimmedRef,
      })
    }

    let finalScheduleId: string | undefined = undefined

    if (recurring.isRecurring && !initialData) {
      finalScheduleId = uuidv7()
      let nextDate = new Date(date)
      if (recurring.frequency === 'Daily') nextDate.setDate(nextDate.getDate() + 1)
      else if (recurring.frequency === 'Weekly') nextDate.setDate(nextDate.getDate() + 7)
      else if (recurring.frequency === 'Monthly') nextDate.setMonth(nextDate.getMonth() + 1)
      else if (recurring.frequency === 'Yearly') nextDate.setFullYear(nextDate.getFullYear() + 1)

      createRecurringTxMutation.mutate({
        id: finalScheduleId,
        frequency: recurring.frequency,
        interval: 1,
        startDate: dayjs(date).toISOString(),
        endDate: recurring.recurringEndDate ? dayjs(recurring.recurringEndDate).toISOString() : undefined,
        nextOccurrenceDate: nextDate.toISOString(),
        maxOccurrences: recurring.maxOccurrences ? parseInt(recurring.maxOccurrences) : undefined,
        templateType: type,
        templateNote: note,
        templateVendor: type === 'Transfer' ? undefined : vendor,
        templateEntries: entries.map((e) => ({
          accountId: e.accountId,
          amount: e.amount,
          note: e.note,
          referenceNumber: e.referenceNumber,
        })),
      })
    }

    if (ingestionId) {
      confirmIngestionMutation.mutate(
        {
          id: ingestionId,
          skipLearning: skipLearning,
          dismissRelatedIds: mergeRelatedIds,
          dismissStatus: 'Merged',
          userConfirmed: {
            vendor: type === 'Transfer' ? null : (vendor ? {
              name: vendor,
              matched: ingestion?.ai_parsed?.vendor?.name === vendor ? ingestion.ai_parsed.vendor.matched : false,
              lookups: selectedLookups,
              new_lookups: selectedNewLookups
            } : null),
            amount: parsedTotal,
            transaction_type: type,
            debit_account_id:
              type === 'Transfer'
                ? toAccountId
                : type === 'Income'
                  ? sourceAccountId
                  : splits[0].subCategoryId,
            credit_account_id:
              type === 'Transfer'
                ? sourceAccountId
                : type === 'Income'
                  ? splits[0].subCategoryId
                  : sourceAccountId,
            notes: note || null,
            reference_number: referenceNumber || null,
            user_why: userWhy || null,
            date: dayjs(date).toISOString(),
          },
        },
        {
          onSuccess: () => {
            onSave?.(dayjs(date).toISOString())
            onClose()
            resetForm()
          },
        }
      )
      return
    }

    const newTx: Partial<Transaction> = {
      ...(initialData?.id ? { id: initialData.id } : {}),
      type,
      scheduleId: finalScheduleId,
      entries,
      vendor: type === 'Transfer' ? null : vendor.trim() || undefined,
      note: note.trim() || undefined,
      referenceNumber: referenceNumber.trim() || undefined,
      mergedIngestionIds: mergeRelatedIds.length > 0 ? mergeRelatedIds : initialData?.mergedIngestionIds,
      date: dayjs(date).toISOString(),
    }

    const mutation = initialData?.id ? updateTxMutation : createTxMutation

    mutation.mutate(newTx as Transaction, {
      onSuccess: () => {
        if (initialData?.id && ingestionId === undefined && ingestion) {
          const updatedUserConfirmed = {
            ...(ingestion.user_confirmed || {}),
            vendor: type === 'Transfer' ? null : (vendor ? {
              name: vendor,
              matched: ingestion?.ai_parsed?.vendor?.name === vendor ? ingestion.ai_parsed.vendor.matched : false,
              lookups: selectedLookups,
              new_lookups: selectedNewLookups
            } : null),
            amount: parsedTotal,
            transaction_type: type,
            debit_account_id:
              type === 'Transfer'
                ? toAccountId
                : type === 'Income'
                  ? sourceAccountId
                  : splits[0]?.subCategoryId || null,
            credit_account_id:
              type === 'Transfer'
                ? sourceAccountId
                : type === 'Income'
                  ? splits[0]?.subCategoryId || null
                  : sourceAccountId,
            notes: note || null,
            reference_number: referenceNumber || null,
            user_why: userWhy || null,
            date: dayjs(date).toISOString(),
          }

          const currentStringified = JSON.stringify(ingestion.user_confirmed || {})
          const updatedStringified = JSON.stringify(updatedUserConfirmed)

          if (currentStringified !== updatedStringified) {
            learnIngestionMutation.mutate({
              id: ingestion.id,
              userConfirmed: updatedUserConfirmed,
            })
          }
        }

        onSave?.(dayjs(date).toISOString())
        if (submitTypeRef.current === 'more') {
          setTotalAmount('')
          setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
          setJournalLines([
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit', note: '', referenceNumber: '' },
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit', note: '', referenceNumber: '' },
          ])
          setVendor('')
          setSelectedLookups([])
          setSelectedNewLookups([])
          setNote('')
          setReferenceNumber('')
          setUserWhy('')
        } else {
          onClose()
          if (!initialData?.id) resetForm()
        }
      },
    })
  }

  const value = useMemo(
    () => ({
      isOpen,
      onClose,
      onSave,
      initialData,
      ingestionId,
      ingestion,
      isLoadingIngestion,
      mode,
      setMode: handleSetMode,
      type,
      setType,
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
      isRecurring: recurring.isRecurring,
      setIsRecurring: recurring.setIsRecurring,
      frequency: recurring.frequency,
      setFrequency: recurring.setFrequency,
      maxOccurrences: recurring.maxOccurrences,
      setMaxOccurrences: recurring.setMaxOccurrences,
      recurringEndDate: recurring.recurringEndDate,
      setRecurringEndDate: recurring.setRecurringEndDate,
      handleRecurringOccurrencesChange: recurring.handleRecurringOccurrencesChange,
      handleRecurringEndDateChange: recurring.handleRecurringEndDateChange,
      pendingNewAccount: suggestions.pendingNewAccount,
      setPendingNewAccount: suggestions.setPendingNewAccount,
      editingSuggestion: suggestions.editingSuggestion,
      setEditingSuggestion: suggestions.setEditingSuggestion,
      createdSuggestions: suggestions.createdSuggestions,
      setCreatedSuggestions: suggestions.setCreatedSuggestions,
      suggestedVendorType: suggestions.suggestedVendorType,
      setSuggestedVendorType: suggestions.setSuggestedVendorType,
      suggestedVendorTags: suggestions.suggestedVendorTags,
      setSuggestedVendorTags: suggestions.setSuggestedVendorTags,
      isReviewOpen,
      setIsReviewOpen,
      confirmReclassifyOpen,
      setConfirmReclassifyOpen,
      currentOperationId,
      setCurrentOperationId,
      isDrawerOpen,
      setIsDrawerOpen,
      isFlashing,
      showDismissConfirm,
      setShowDismissConfirm,
      promptDismiss,
      confirmDismiss,
      isDirty,
      resetForm,
      handleSubmit,
      submitTypeRef,
      reclassifyMutation,
      skipLearning,
      setSkipLearning,
      mergeRelatedIds,
      setMergeRelatedIds,
      confirmedMatchTxId,
      linkAndDismissIngestion,
      isSubmitting:
        createTxMutation.isPending ||
        updateTxMutation.isPending ||
        confirmIngestionMutation.isPending ||
        createVendorMutation.isPending ||
        createRecurringTxMutation.isPending,
    }),
    [
      isOpen,
      onClose,
      onSave,
      initialData,
      ingestionId,
      ingestion,
      isLoadingIngestion,
      mode,
      handleSetMode,
      type,
      totalAmount,
      sourceAccountId,
      toAccountId,
      splits,
      journalLines,
      vendor,
      selectedLookups,
      selectedNewLookups,
      date,
      note,
      referenceNumber,
      userWhy,
      recurring.isRecurring,
      recurring.frequency,
      recurring.maxOccurrences,
      recurring.recurringEndDate,
      recurring.handleRecurringOccurrencesChange,
      recurring.handleRecurringEndDateChange,
      suggestions.pendingNewAccount,
      suggestions.editingSuggestion,
      suggestions.createdSuggestions,
      suggestions.suggestedVendorType,
      suggestions.suggestedVendorTags,
      isReviewOpen,
      confirmReclassifyOpen,
      currentOperationId,
      isDrawerOpen,
      isFlashing,
      showDismissConfirm,
      promptDismiss,
      confirmDismiss,
      isDirty,
      resetForm,
      handleSubmit,
      reclassifyMutation,
      skipLearning,
      mergeRelatedIds,
      confirmedMatchTxId,
      linkAndDismissIngestion,
      createTxMutation.isPending,
      updateTxMutation.isPending,
      confirmIngestionMutation.isPending,
      createVendorMutation.isPending,
      createRecurringTxMutation.isPending,
      recurring.setIsRecurring,
      recurring.setFrequency,
      recurring.setMaxOccurrences,
      recurring.setRecurringEndDate,
      suggestions.setPendingNewAccount,
      suggestions.setEditingSuggestion,
      suggestions.setCreatedSuggestions,
      suggestions.setSuggestedVendorType,
      suggestions.setSuggestedVendorTags,
    ]
  )

  return <AddTransactionContext.Provider value={value}>{children}</AddTransactionContext.Provider>
}

export function useAddTransaction() {
  const context = useContext(AddTransactionContext)
  if (!context) {
    throw new Error('useAddTransaction must be used within an AddTransactionProvider')
  }
  return context
}
