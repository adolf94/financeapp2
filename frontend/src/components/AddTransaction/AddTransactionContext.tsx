import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react'
import { PendingIngestion, useConfirmIngestion, useLearnIngestion, useReclassifyIngestion } from '@/hooks/useIngestions'
import { useCreateTransaction, useUpdateTransaction, Transaction, LedgerEntry } from '@/hooks/useTransactions'
import { useCreateRecurringTransaction } from '@/hooks/useRecurringTransactions'
import { useCreateVendor, useGetVendors } from '@/hooks/useVendors'
import { useGetAccounts } from '@/hooks/useAccounts'
import { uuidv7 } from 'uuidv7'
import dayjs from 'dayjs'

const generateId = () => uuidv7()

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
}

export interface PendingNewAccountType {
  name: string
  categoryId: string
  type: string
  splitId: string
  description: string
  tags: string[]
}

interface SuggestionData {
  name: string
  account_group: string
  type: string
  description: string
  tags: string[]
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

  // Recurring
  isRecurring: boolean
  setIsRecurring: (rec: boolean) => void
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly'
  setFrequency: (freq: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly') => void
  maxOccurrences: string
  setMaxOccurrences: (occ: string) => void

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

  // Flashing
  isFlashing: boolean

  // Actions
  resetForm: () => void
  handleSubmit: (e: React.FormEvent) => void
  submitTypeRef: React.MutableRefObject<'close' | 'more'>
  reclassifyMutation: ReturnType<typeof useReclassifyIngestion>
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
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' },
  ])
  const [vendor, setVendor] = useState('')
  const [selectedLookups, setSelectedLookups] = useState<string[]>([])
  const [selectedNewLookups, setSelectedNewLookups] = useState<string[]>([])
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [note, setNote] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [userWhy, setUserWhy] = useState('')
  const [skipLearning, setSkipLearning] = useState(false)

  const [isRecurring, setIsRecurring] = useState(false)
  const [frequency, setFrequency] = useState<'Daily' | 'Weekly' | 'Monthly' | 'Yearly'>('Monthly')
  const [maxOccurrences, setMaxOccurrences] = useState('')

  const [pendingNewAccount, setPendingNewAccount] = useState<PendingNewAccountType | null>(null)
  const [editingSuggestion, setEditingSuggestion] = useState<{
    idx: number
    data: SuggestionData
  } | null>(null)
  const [createdSuggestions, setCreatedSuggestions] = useState<Set<number>>(new Set())
  const [suggestedVendorType, setSuggestedVendorType] = useState<'Individual' | 'Business'>(
    'Business'
  )
  const [suggestedVendorTags, setSuggestedVendorTags] = useState('')
  const [isReviewOpen, setIsReviewOpen] = useState(true)
  const [confirmReclassifyOpen, setConfirmReclassifyOpen] = useState(false)
  const [currentOperationId, setCurrentOperationId] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const [isFlashing, setIsFlashing] = useState(false)
  const prevIngestionRef = useRef(ingestion)
  const submitTypeRef = useRef<'close' | 'more'>('close')

  const resetForm = useCallback(() => {
    setMode('Simple')
    setType('Expense')
    setTotalAmount('')
    setSourceAccountId('')
    setToAccountId('')
    setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
    setJournalLines([
      { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
      { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' },
    ])
    setVendor('')
    setNote('')
    setReferenceNumber('')
    setUserWhy('')
    setSkipLearning(false)
    setDate(dayjs().format('YYYY-MM-DDTHH:mm'))
    setIsRecurring(false)
    setFrequency('Monthly')
    setMaxOccurrences('')
  }, [])

  // Flash UI and update form fields when AI re-runs and changes suggestions
  useEffect(() => {
    if (ingestion?.ai_parsed !== prevIngestionRef.current?.ai_parsed) {
      if (prevIngestionRef.current && ingestion) {
        setIsFlashing(true)
        setTimeout(() => setIsFlashing(false), 600)
        
        const parsed = ingestion.ai_parsed
        if (parsed.transaction_type) {
          const t = ['Income', 'Expense', 'Transfer'].includes(parsed.transaction_type) ? (parsed.transaction_type as any) : 'Expense'
          setType(t)
        }
        if (parsed.amount) {
          setTotalAmount(Math.abs(parsed.amount).toString())
        }
        if (parsed.vendor) {
          setVendor(parsed.vendor.name || '')
        }
        if (parsed.summary || parsed.notes) {
          setNote(parsed.summary || parsed.notes || '')
        }
        if (parsed.suggested_rule) {
          setUserWhy(parsed.suggested_rule)
        } else if (parsed.user_why) {
          setUserWhy(parsed.user_why)
        }
        if (parsed.date) {
          setDate(dayjs(parsed.date).format('YYYY-MM-DDTHH:mm'))
        } else if (ingestion.received_at) {
          setDate(dayjs(ingestion.received_at).format('YYYY-MM-DDTHH:mm'))
        }
        if (parsed.reference_number !== undefined) {
          setReferenceNumber(parsed.reference_number || '')
        }

        // Pre-fill accounts based on transaction_type
        if (parsed.transaction_type === 'Transfer') {
          // Transfer: debit = receiving/to, credit = sending/source
          if (parsed.credit_account_id) setSourceAccountId(parsed.credit_account_id)
          if (parsed.debit_account_id) setToAccountId(parsed.debit_account_id)
        } else if (parsed.transaction_type === 'Income') {
          // Income: debit = receiving/source account, credit = income category
          if (parsed.debit_account_id) setSourceAccountId(parsed.debit_account_id)
          if (parsed.credit_account_id) {
            const acc = accountsRef.current.find((a) => a.id === parsed.credit_account_id)
            setSplits([
              {
                id: generateId(),
                categoryId: acc?.accountGroupId || '',
                subCategoryId: parsed.credit_account_id,
                amount: '',
              },
            ])
          }
        } else {
          // Expense: debit = expense category, credit = source payment account
          if (parsed.credit_account_id) setSourceAccountId(parsed.credit_account_id)
          if (parsed.debit_account_id) {
            const acc = accountsRef.current.find((a) => a.id === parsed.debit_account_id)
            setSplits([
              {
                id: generateId(),
                categoryId: acc?.accountGroupId || '',
                subCategoryId: parsed.debit_account_id,
                amount: '',
              },
            ])
          }
        }
      }
      prevIngestionRef.current = ingestion
    }
  }, [ingestion])

  useEffect(() => {
    if (!isOpen) return
    setCreatedSuggestions(new Set())
    setEditingSuggestion(null)
    if (ingestion?.ai_parsed?.vendor) {
      setVendor(ingestion.ai_parsed.vendor.name || '')
      setSelectedLookups(ingestion.ai_parsed.vendor.lookups || [])
      setSelectedNewLookups(ingestion.ai_parsed.vendor.new_lookups || ingestion.ai_parsed.vendor.NewLookups || [])
    } else {
      setVendor('')
      setSelectedLookups([])
      setSelectedNewLookups([])
    }
  }, [isOpen, ingestion?.id, ingestion?.ai_parsed?.vendor])

  useEffect(() => {
    if (ingestion?.ai_parsed?.vendor?.is_recommendation) {
      const type = ingestion.ai_parsed.vendor.type
      if (type === 'Individual' || type === 'Business') {
        setSuggestedVendorType(type)
      } else {
        setSuggestedVendorType('Business')
      }
      const tags = ingestion.ai_parsed.vendor.tags || []
      setSuggestedVendorTags(tags.join(', '))
    } else {
      setSuggestedVendorType('Business')
      setSuggestedVendorTags('')
    }
  }, [ingestion?.id, ingestion?.ai_parsed?.vendor])

  const accountsRef = useRef(accounts)
  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  const formInitializedForRef = useRef<string | null>(null)

  useEffect(() => {
    const dataStr = initialData ? JSON.stringify(initialData) : null
    const justOpened = isOpen && !formInitializedForRef.current

    if (isOpen) {
      if (!justOpened && formInitializedForRef.current === dataStr) {
        return
      }
      formInitializedForRef.current = dataStr

      if (initialData) {
        setMode(initialData.type === 'Journal' ? 'Advanced' : 'Simple')
        setVendor(initialData.vendor || '')
        setDate(dayjs(initialData.date).format('YYYY-MM-DDTHH:mm'))
        setNote(initialData.note || '')
        setReferenceNumber(initialData.referenceNumber || '')
        setIsRecurring(!!initialData.scheduleId)
        setType(initialData.type)
        setToAccountId('')

        if (initialData.type === 'Journal') {
          setJournalLines(
            initialData.entries.map((e) => {
              const acc = accountsRef.current.find((a) => a.id === e.accountId)
              return {
                id: generateId(),
                categoryId: acc?.accountGroupId || '',
                subCategoryId: e.accountId,
                amount: Math.abs(e.amount).toString(),
                type: e.amount > 0 ? 'Debit' : 'Credit',
              }
            })
          )
        } else {
          if (initialData.type === 'Transfer') {
            const srcEntry = initialData.entries.find((e) => e.amount < 0)
            const dstEntry = initialData.entries.find((e) => e.amount > 0)
            if (srcEntry && dstEntry) {
              setSourceAccountId(srcEntry.accountId)
              setToAccountId(dstEntry.accountId)
              setTotalAmount(Math.abs(srcEntry.amount).toString())
            }
          } else {
            const srcEntry = initialData.entries.find((e) =>
              initialData.type === 'Expense' ? e.amount < 0 : e.amount > 0
            )
            const dstEntry = initialData.entries.find((e) =>
              initialData.type === 'Expense' ? e.amount > 0 : e.amount < 0
            )

            if (srcEntry && dstEntry) {
              setSourceAccountId(srcEntry.accountId)
              setTotalAmount(Math.abs(srcEntry.amount).toString())

              const account = accountsRef.current.find((a) => a.id === dstEntry.accountId)
              setSplits([
                {
                  id: generateId(),
                  categoryId: account?.accountGroupId || '',
                  subCategoryId: dstEntry.accountId,
                  amount: '',
                },
              ])
            }
          }
        }
      } else {
        if (justOpened) {
          resetForm()
          const parsed = ingestion?.ai_parsed
          if (parsed) {
            if (parsed.transaction_type) {
              const t = ['Income', 'Expense', 'Transfer'].includes(parsed.transaction_type) ? (parsed.transaction_type as any) : 'Expense'
              setType(t)
            }
            if (parsed.amount) {
              setTotalAmount(Math.abs(parsed.amount).toString())
            }
            if (parsed.vendor) {
              setVendor(parsed.vendor.name || '')
            }
            if (parsed.summary || parsed.notes) {
              setNote(parsed.summary || parsed.notes || '')
            }
            if (parsed.suggested_rule) {
              setUserWhy(parsed.suggested_rule)
            } else if (parsed.user_why) {
              setUserWhy(parsed.user_why)
            }
            if (parsed.date) {
              setDate(dayjs(parsed.date).format('YYYY-MM-DDTHH:mm'))
            } else if (ingestion.received_at) {
              setDate(dayjs(ingestion.received_at).format('YYYY-MM-DDTHH:mm'))
            }
            if (parsed.reference_number !== undefined) {
              setReferenceNumber(parsed.reference_number || '')
            }

            if (parsed.transaction_type === 'Transfer') {
              if (parsed.credit_account_id) setSourceAccountId(parsed.credit_account_id)
              if (parsed.debit_account_id) setToAccountId(parsed.debit_account_id)
            } else if (parsed.transaction_type === 'Income') {
              if (parsed.debit_account_id) setSourceAccountId(parsed.debit_account_id)
              if (parsed.credit_account_id) {
                const acc = accountsRef.current.find((a) => a.id === parsed.credit_account_id)
                setSplits([
                  {
                    id: generateId(),
                    categoryId: acc?.accountGroupId || '',
                    subCategoryId: parsed.credit_account_id,
                    amount: '',
                  },
                ])
              }
            } else {
              if (parsed.credit_account_id) setSourceAccountId(parsed.credit_account_id)
              if (parsed.debit_account_id) {
                const acc = accountsRef.current.find((a) => a.id === parsed.debit_account_id)
                setSplits([
                  {
                    id: generateId(),
                    categoryId: acc?.accountGroupId || '',
                    subCategoryId: parsed.debit_account_id,
                    amount: '',
                  },
                ])
              }
            }
          }
        }
      }
      if (justOpened) {
        setUserWhy(ingestion?.user_confirmed?.user_why || '')
      }
    } else {
      formInitializedForRef.current = null
    }
  }, [isOpen, initialData, ingestion, resetForm])

  // Sync categoryIds when accounts load
  useEffect(() => {
    if (!isOpen || !initialData) return

    setSplits((prev) =>
      prev.map((split) => {
        if (split.subCategoryId && !split.categoryId) {
          const acc = accounts.find((a) => a.id === split.subCategoryId)
          if (acc?.accountGroupId) {
            return { ...split, categoryId: acc.accountGroupId }
          }
        }
        return split
      })
    )

    setJournalLines((prev) =>
      prev.map((line) => {
        if (line.subCategoryId && !line.categoryId) {
          const acc = accounts.find((a) => a.id === line.subCategoryId)
          if (acc?.accountGroupId) {
            return { ...line, categoryId: acc.accountGroupId }
          }
        }
        return line
      })
    )
  }, [accounts, isOpen, initialData])

  const hasMasks = (name?: string) => {
    if (!name) return false
    return name.includes('*') || name.includes('X') || name.includes('x')
  }

  const saveAdvancedTransaction = (entries: LedgerEntry[]) => {
    const transaction: Transaction = {
      ...(initialData?.id ? { id: initialData.id } : {}),
      type: 'Journal',
      entries,
      vendor,
      note,
      referenceNumber,
      date: new Date(date).toISOString(),
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
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' },
          ])
          setVendor('')
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
        const amt = parseFloat(line.amount || '0')
        if (amt === 0) continue

        const roundedAmt = Math.round(amt * 100) / 100

        if (line.type === 'Debit') debitSum += roundedAmt
        else creditSum += roundedAmt

        entries.push({
          accountId: line.subCategoryId,
          amount: line.type === 'Debit' ? roundedAmt : -roundedAmt,
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
        const tags = suggestedVendorTags
          ? suggestedVendorTags.split(',').map((t) => t.trim()).filter(Boolean)
          : []
        createVendorMutation.mutate(
          { name: vendor, type: suggestedVendorType, tags },
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
      createVendorMutation.mutate({ name: vendor })
    }

    const entries: LedgerEntry[] = []
    const parsedTotal = parseFloat(totalAmount)

    if (type === 'Transfer') {
      if (!toAccountId) return
      entries.push({ accountId: sourceAccountId, amount: -parsedTotal })
      entries.push({ accountId: toAccountId, amount: parsedTotal })
    } else {
      entries.push({
        accountId: sourceAccountId,
        amount: type === 'Expense' ? -parsedTotal : parsedTotal,
      })

      const categorySplit = splits[0]
      if (!categorySplit?.subCategoryId) {
        alert('Please select a category.')
        return
      }

      entries.push({
        accountId: categorySplit.subCategoryId,
        amount: type === 'Expense' ? parsedTotal : -parsedTotal,
      })
    }

    let finalScheduleId: string | undefined = undefined

    if (isRecurring && !initialData) {
      finalScheduleId = uuidv7()
      let nextDate = new Date(date)
      if (frequency === 'Daily') nextDate.setDate(nextDate.getDate() + 1)
      else if (frequency === 'Weekly') nextDate.setDate(nextDate.getDate() + 7)
      else if (frequency === 'Monthly') nextDate.setMonth(nextDate.getMonth() + 1)
      else if (frequency === 'Yearly') nextDate.setFullYear(nextDate.getFullYear() + 1)

      createRecurringTxMutation.mutate({
        id: finalScheduleId,
        frequency,
        interval: 1,
        startDate: new Date(date).toISOString(),
        nextOccurrenceDate: nextDate.toISOString(),
        maxOccurrences: maxOccurrences ? parseInt(maxOccurrences) : undefined,
        templateType: type,
        templateNote: note,
        templateVendor: type === 'Transfer' ? undefined : vendor,
        templateEntries: entries.map((e) => ({ accountId: e.accountId, amount: e.amount })),
      })
    }

    if (ingestionId) {
      confirmIngestionMutation.mutate(
        {
          id: ingestionId,
          skipLearning: skipLearning,
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
        date: dayjs(date).format('YYYY-MM-DDTHH:mm:ss[Z]'),
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
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' },
          ])
          setVendor('')
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
      setMode,
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
      isRecurring,
      setIsRecurring,
      frequency,
      setFrequency,
      maxOccurrences,
      setMaxOccurrences,
      pendingNewAccount,
      setPendingNewAccount,
      editingSuggestion,
      setEditingSuggestion,
      createdSuggestions,
      setCreatedSuggestions,
      suggestedVendorType,
      setSuggestedVendorType,
      suggestedVendorTags,
      setSuggestedVendorTags,
      isReviewOpen,
      setIsReviewOpen,
      confirmReclassifyOpen,
      setConfirmReclassifyOpen,
      currentOperationId,
      setCurrentOperationId,
      isDrawerOpen,
      setIsDrawerOpen,
      isFlashing,
      resetForm,
      handleSubmit,
      submitTypeRef,
      reclassifyMutation,
      skipLearning,
      setSkipLearning,
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
      isRecurring,
      frequency,
      maxOccurrences,
      pendingNewAccount,
      editingSuggestion,
      createdSuggestions,
      suggestedVendorType,
      suggestedVendorTags,
      isReviewOpen,
      confirmReclassifyOpen,
      currentOperationId,
      isDrawerOpen,
      isFlashing,
      resetForm,
      handleSubmit,
      reclassifyMutation,
      skipLearning,
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
