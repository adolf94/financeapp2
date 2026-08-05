import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Plus, X, Trash2, RefreshCw, RotateCcw, Sparkles, Edit, Check } from 'lucide-react'
import { useGetAccounts, useGetAccountGroups, useCreateAccountGroup, useCreateAccount, useGenerateAccountDescription } from '@/hooks/useAccounts'
import { useGetVendors, useCreateVendor } from '@/hooks/useVendors'
import { useCreateTransaction, useUpdateTransaction, Transaction, LedgerEntry } from '@/hooks/useTransactions'
import { useCreateRecurringTransaction } from '@/hooks/useRecurringTransactions'
import { PendingIngestion, useGetIngestionById, useConfirmIngestion, useReclassifyIngestion, useUpdateIngestionVendor, useLearnIngestion } from '@/hooks/useIngestions'
import { useQueryClient } from '@tanstack/react-query'
import { uuidv7 } from 'uuidv7'
import dayjs from 'dayjs'
import Combobox from './ui/Combobox'
import CalculatorInput from './ui/CalculatorInput'
import TagInput from './ui/TagInput'

const generateId = () => uuidv7()

function hasMasks(name?: string | null): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  if (name.includes('*')) return true
  if (lower.includes('xxx')) return true
  if (/x{2,}/.test(lower)) return true
  if (/\d{4,}/.test(name)) return true
  return false
}

interface SplitLine {
  id: string
  categoryId: string // AccountGroup ID
  subCategoryId: string // Account ID
  amount: string
}

interface JournalLine {
  id: string
  categoryId: string
  subCategoryId: string
  amount: string
  type: 'Debit' | 'Credit'
}

interface AddTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  initialData?: Transaction | null
  ingestionId?: string | null
  ingestion?: PendingIngestion | null
  onSave?: (date: string) => void
}

export default function AddTransactionModal({ isOpen, onClose, initialData, ingestionId, ingestion: ingestionProp, onSave }: AddTransactionModalProps) {
  const { data: accounts = [] } = useGetAccounts()
  const { data: accountGroups = [] } = useGetAccountGroups()
  const { data: dbVendors = [] } = useGetVendors()
  const createTxMutation = useCreateTransaction()
  const updateTxMutation = useUpdateTransaction()
  const createVendorMutation = useCreateVendor()
  const createRecurringTxMutation = useCreateRecurringTransaction()
  const createAccountGroupMutation = useCreateAccountGroup()
  const createAccountMutation = useCreateAccount()
  const generateDescriptionMutation = useGenerateAccountDescription()
  const confirmIngestionMutation = useConfirmIngestion()
  const reclassifyMutation = useReclassifyIngestion()
  const updateIngestionVendorMutation = useUpdateIngestionVendor()
  const learnIngestionMutation = useLearnIngestion()

  const queryClient = useQueryClient()

  const targetIngestionId = ingestionId || initialData?.ingestionId
  const { data: fetchedIngestion } = useGetIngestionById(targetIngestionId)

  const ingestion = ingestionProp || fetchedIngestion

  const [pendingNewAccount, setPendingNewAccount] = useState<{
    name: string;
    categoryId: string;
    type: string;
    splitId: string;
    description: string;
    tags: string[];
  } | null>(null)

  const getIngestionAppName = (ing: PendingIngestion) => {
    if (ing.ai_parsed?.application) return ing.ai_parsed.application

    const payload = ing.raw_payload || {}
    const keys = Object.keys(payload)

    const pkgKey = keys.find(k => k.toLowerCase() === 'notif_pkg' || k.toLowerCase() === 'notifpkg' || k.toLowerCase() === 'package');
    const senderKey = keys.find(k => k.toLowerCase() === 'sms_rcv_sender' || k.toLowerCase() === 'smssender' || k.toLowerCase() === 'sender' || k.toLowerCase() === 'from');

    const pkg = (pkgKey ? payload[pkgKey] : null) || (senderKey ? payload[senderKey] : null) || '';
    if (!pkg || typeof pkg !== 'string') return 'Notification'

    return pkg
  }

  const [mode, setMode] = useState<'Simple' | 'Advanced'>('Simple')
  const [isReviewOpen, setIsReviewOpen] = useState(true)
  const submitTypeRef = useRef<'close' | 'more'>('close')
  const [type, setType] = useState<'Income' | 'Expense' | 'Transfer' | 'Journal'>('Expense')

  const [totalAmount, setTotalAmount] = useState('')
  const [sourceAccountId, setSourceAccountId] = useState('') // The payment account
  const [toAccountId, setToAccountId] = useState('') // Only used for Transfer

  // Splits
  const [splits, setSplits] = useState<SplitLine[]>([
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '' }
  ])

  // Journal Lines
  const [journalLines, setJournalLines] = useState<JournalLine[]>([
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
    { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' }
  ])

  const [vendor, setVendor] = useState('')
  const [date, setDate] = useState(
    initialData
      ? dayjs(initialData.date).format('YYYY-MM-DDTHH:mm')
      : (ingestion ? dayjs(ingestion.received_at || undefined).format('YYYY-MM-DDTHH:mm') : dayjs().format('YYYY-MM-DDTHH:mm'))
  )
  const [note, setNote] = useState('')
  const [userWhy, setUserWhy] = useState('')

  // Recurring options
  const [isRecurring, setIsRecurring] = useState(false)
  const [frequency, setFrequency] = useState<'Daily' | 'Weekly' | 'Monthly' | 'Yearly'>('Monthly')
  const [maxOccurrences, setMaxOccurrences] = useState('')

  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [editingSuggestion, setEditingSuggestion] = useState<{ idx: number, data: { name: string, account_group: string, type: string, description: string, tags: string[] } } | null>(null)
  const [createdSuggestions, setCreatedSuggestions] = useState<Set<number>>(new Set())
  const [suggestedVendorType, setSuggestedVendorType] = useState<'Individual' | 'Business'>('Business')
  const [suggestedVendorTags, setSuggestedVendorTags] = useState('')

  const handleCreateSuggestedAccount = async (data: { type: string, account_group: string, name: string, description?: string, tags?: string[] }, idx?: number) => {
    setIsCreatingAccount(true)
    try {
      let targetGroupId = accountGroups.find(g => g.name === data.account_group && g.accountType === data.type)?.id

      if (!targetGroupId) {
        const newGroup = await createAccountGroupMutation.mutateAsync({ name: data.account_group, accountType: data.type })
        targetGroupId = newGroup.id
      }

      const newAccount = await createAccountMutation.mutateAsync({
        name: data.name,
        description: data.description,
        tags: data.tags || [],
        accountGroupId: targetGroupId as string,
        startingBalance: 0,
        accountType: data.type as any,
      })

      if (newAccount && newAccount.id) {
        if (data.type === 'Expense' || data.type === 'Income') {
          setSplits([{
            id: splits[0]?.id || generateId(),
            categoryId: targetGroupId || '',
            subCategoryId: newAccount.id,
            amount: splits[0]?.amount || ''
          }])
        } else {
          setSourceAccountId(newAccount.id)
        }
      }

      if (idx !== undefined) {
        setCreatedSuggestions(prev => new Set(prev).add(idx))
      }
      setEditingSuggestion(null)
    } catch (err) {
      console.error('Failed to create suggested account', err)
    } finally {
      setIsCreatingAccount(false)
    }
  }

  const handleGeneratePendingAccountDescription = async () => {
    if (!pendingNewAccount) return;
    const group = accountGroups.find(g => g.id === pendingNewAccount.categoryId);
    const groupName = group?.name || '';

    try {
      const { description, tags } = await generateDescriptionMutation.mutateAsync({
        name: pendingNewAccount.name,
        type: pendingNewAccount.type,
        groupName: groupName,
        context: pendingNewAccount.description
      });
      setPendingNewAccount({ ...pendingNewAccount, description, tags: tags || [] });
    } catch (e) {
      console.error(e);
      alert("Failed to generate description.");
    }
  };

  const handleSavePendingAccount = () => {
    if (!pendingNewAccount) return;
    createAccountMutation.mutate({
      name: pendingNewAccount.name,
      description: pendingNewAccount.description,
      tags: pendingNewAccount.tags || [],
      accountGroupId: pendingNewAccount.categoryId,
      accountType: pendingNewAccount.type as any,
      startingBalance: 0
    }, {
      onSuccess: (data) => {
        if (data && data.id) {
          updateSplit(pendingNewAccount.splitId, { subCategoryId: data.id })
        }
        setPendingNewAccount(null)
      }
    })
  };

  const resetForm = useCallback(() => {
    setMode('Simple')
    setType('Expense')
    setTotalAmount('')
    setSourceAccountId('')
    setToAccountId('')
    setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
    setJournalLines([
      { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
      { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' }
    ])
    setVendor('')
    setNote('')
    setUserWhy('')
    setDate(dayjs().format('YYYY-MM-DDTHH:mm'))
    setIsRecurring(false)
    setFrequency('Monthly')
    setMaxOccurrences('')
  }, [])

  const [isFlashing, setIsFlashing] = useState(false)
  const prevIngestionRef = useRef(ingestion)

  useEffect(() => {
    if (ingestion?.ai_parsed !== prevIngestionRef.current?.ai_parsed) {
      if (prevIngestionRef.current && ingestion) {
        setIsFlashing(true)
        setTimeout(() => setIsFlashing(false), 600)
      }
      prevIngestionRef.current = ingestion
    }
  }, [ingestion])

  useEffect(() => {
    setCreatedSuggestions(new Set())
    setEditingSuggestion(null)
  }, [ingestion?.id])

  useEffect(() => {
    if (ingestion?.ai_parsed?.suggested_vendor) {
      const type = ingestion.ai_parsed.suggested_vendor.type;
      if (type === 'Individual' || type === 'Business') {
        setSuggestedVendorType(type);
      } else {
        setSuggestedVendorType('Business');
      }
      const tags = ingestion.ai_parsed.suggested_vendor.tags || [];
      setSuggestedVendorTags(tags.join(', '));
    } else {
      setSuggestedVendorType('Business');
      setSuggestedVendorTags('');
    }
  }, [ingestion?.id, ingestion?.ai_parsed?.suggested_vendor])

  useEffect(() => {
    if (isOpen && ingestion?.ai_parsed?.vendor) {
      const vendorName = ingestion.ai_parsed.vendor;
      const isCreated = ingestion.ai_parsed.vendor_matched || ingestion.ai_parsed.suggested_vendor?.is_created;
      if (isCreated && !dbVendors.some(v => v.name.toLowerCase() === vendorName.toLowerCase())) {
        queryClient.invalidateQueries({ queryKey: ['vendors'] });
      }
    }
  }, [isOpen, ingestion?.ai_parsed?.vendor, ingestion?.ai_parsed?.vendor_matched, ingestion?.ai_parsed?.suggested_vendor?.is_created, dbVendors, queryClient])

  const prevInitialDataStr = useRef<string | null>(null)
  const isOpenPrev = useRef<boolean>(false)
  // Keep a ref to accounts so we can use the latest value inside useEffect
  // without adding accounts to the dependency array (which would cause the effect
  // to re-run whenever accounts refetches and potentially overwrite user edits).
  const accountsRef = useRef(accounts)
  useEffect(() => { accountsRef.current = accounts }, [accounts])

  // Track which initialData the form is currently populated for, so we never
  // re-populate while the user is actively editing (e.g., after accounts refetch).
  const formInitializedForRef = useRef<string | null>(null)

  useEffect(() => {
    const dataStr = initialData ? JSON.stringify(initialData) : null
    const justOpened = isOpen && !isOpenPrev.current
    isOpenPrev.current = isOpen

    if (isOpen) {
      // Skip re-population if the form is already populated for this exact initialData
      // AND this is not the first open. This prevents overwriting user edits.
      if (!justOpened && formInitializedForRef.current === dataStr) {
        return
      }
      prevInitialDataStr.current = dataStr
      formInitializedForRef.current = dataStr

      if (initialData) {
        setMode(initialData.type === 'Journal' ? 'Advanced' : 'Simple')
        setType(initialData.type)
        setDate(dayjs(initialData.date).format('YYYY-MM-DDTHH:mm'))
        setNote(initialData.note || '')
        setVendor(initialData.vendor || '')
        setToAccountId('') // Always reset toAccountId; will be set below if Transfer

        if (initialData.type === 'Journal') {
          // Use accountsRef.current to get the latest accounts without dependency
          setJournalLines(initialData.entries.map(e => {
            const acc = accountsRef.current.find(a => a.id === e.accountId)
            return {
              id: generateId(),
              categoryId: acc?.accountGroupId || '',
              subCategoryId: e.accountId,
              amount: Math.abs(e.amount).toString(),
              type: e.amount > 0 ? 'Debit' : 'Credit'
            }
          }))
        } else {
          // Simple mode decode
          if (initialData.type === 'Transfer') {
            const srcEntry = initialData.entries.find(e => e.amount < 0)
            const dstEntry = initialData.entries.find(e => e.amount > 0)
            if (srcEntry && dstEntry) {
              setSourceAccountId(srcEntry.accountId)
              setToAccountId(dstEntry.accountId)
              setTotalAmount(Math.abs(srcEntry.amount).toString())
            }
          } else {
            const srcEntry = initialData.entries.find(e => initialData.type === 'Expense' ? e.amount < 0 : e.amount > 0)
            const dstEntry = initialData.entries.find(e => initialData.type === 'Expense' ? e.amount > 0 : e.amount < 0)

            if (srcEntry && dstEntry) {
              setSourceAccountId(srcEntry.accountId)
              setTotalAmount(Math.abs(srcEntry.amount).toString())

              // Use accountsRef to get the latest accounts (not a stale snapshot)
              const account = accountsRef.current.find(a => a.id === dstEntry.accountId)
              setSplits([{
                id: generateId(),
                categoryId: account?.accountGroupId || '',
                subCategoryId: dstEntry.accountId,
                amount: ''
              }])
            }
          }
        }
      } else {
        if (justOpened) resetForm()
      }
      if (justOpened) {
        setUserWhy(ingestion?.user_confirmed?.user_why || '')
      }
    } else {
      // Modal closed — reset tracking so next open re-populates fresh
      prevInitialDataStr.current = null
      formInitializedForRef.current = null
    }
    // accounts intentionally excluded from deps — accessed via accountsRef to avoid
    // re-populating the form when accounts data refetches during active editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData])

  // Supplementary effect: back-fill missing categoryId in splits/journal lines when
  // accounts data arrives after form initialization. This handles the case where the
  // modal opened before accounts were loaded from the server.
  useEffect(() => {
    if (!isOpen || !initialData) return

    // Fix splits that have a subCategoryId but missing categoryId (accounts weren't loaded yet)
    setSplits(prev => prev.map(split => {
      if (split.subCategoryId && !split.categoryId) {
        const acc = accounts.find(a => a.id === split.subCategoryId)
        if (acc?.accountGroupId) {
          return { ...split, categoryId: acc.accountGroupId }
        }
      }
      return split
    }))

    // Fix journal lines that have a subCategoryId but missing categoryId
    setJournalLines(prev => prev.map(line => {
      if (line.subCategoryId && !line.categoryId) {
        const acc = accounts.find(a => a.id === line.subCategoryId)
        if (acc?.accountGroupId) {
          return { ...line, categoryId: acc.accountGroupId }
        }
      }
      return line
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, isOpen])

  // Combine DB Vendors with presets - memoized for performance
  const vendorOptions = useMemo(() => dbVendors.map((v) => v.name).sort((a, b) => a.localeCompare(b)), [dbVendors])

  // Payment Source Accounts (Asset / Bank / Cash / CreditCard / Investment)
  const paymentGroupIds = useMemo(() => new Set(
    accountGroups
      .filter((g) => g.accountType !== 'Expense' && g.accountType !== 'Income')
      .map((g) => g.id)
  ), [accountGroups])

  const paymentAccounts = useMemo(() => accounts.filter(
    (a) => !a.accountGroupId || paymentGroupIds.has(a.accountGroupId)
  ).sort((a, b) => a.name.localeCompare(b.name)), [accounts, paymentGroupIds])

  // Category Account Groups (Strictly Expense or Income)
  const categoryGroups = useMemo(() => accountGroups.filter((g) => {
    if (type === 'Expense') return g.accountType === 'Expense'
    if (type === 'Income') return g.accountType === 'Income'
    return false
  }).sort((a, b) => a.name.localeCompare(b.name)), [accountGroups, type])


  const updateSplit = useCallback((id: string, updates: Partial<SplitLine>) => {
    setSplits(prev => prev.map(s => {
      if (s.id === id) {
        const updated = { ...s, ...updates }
        if (updates.categoryId) updated.subCategoryId = ''
        return updated
      }
      return s
    }))
  }, [])

  const addJournalLine = useCallback(() => {
    setJournalLines(prev => [...prev, { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' }])
  }, [])

  const removeJournalLine = useCallback((id: string) => {
    setJournalLines(prev => prev.filter(l => l.id !== id))
  }, [])

  const updateJournalLine = useCallback((id: string, updates: Partial<JournalLine>) => {
    setJournalLines(prev => prev.map(l => (l.id === id ? { ...l, ...updates } : l)))
  }, [])

  const handleSubmit = useCallback((e: React.FormEvent) => {
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

        if (line.type === 'Debit') debitSum += amt
        else creditSum += amt

        entries.push({
          accountId: line.subCategoryId,
          amount: line.type === 'Debit' ? amt : -amt
        })
      }

      if (Math.abs(debitSum - creditSum) > 0.01) {
        alert(`Debits (₱${debitSum.toFixed(2)}) must equal Credits (₱${creditSum.toFixed(2)}).`)
        return
      }

      if (entries.length < 2) {
        alert("At least two ledger entries are required.")
        return
      }

      const transaction: Transaction = {
        ...(initialData ? { id: initialData.id } : {}),
        type: 'Journal',
        entries,
        vendor: null,
        note,
        date: new Date(date).toISOString(),
      }

      const mutation = initialData ? updateTxMutation : createTxMutation
      mutation.mutate(transaction, {
        onSuccess: () => {
          if (submitTypeRef.current === 'more') {
            setTotalAmount('')
            setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
            setJournalLines([
              { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
              { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' }
            ])
            setVendor('')
            setNote('')
          } else {
            onClose()
            if (!initialData) resetForm()
          }
        },
      })
      return
    }

    // Simple Mode handling
    if (!totalAmount || !sourceAccountId || !date) return

    const finalVendor = vendor

    if (finalVendor && hasMasks(finalVendor)) {
      alert("Vendor name contains mask characters (*, xxx, or related). Please select or create a clean vendor name.");
      return;
    }

    if (finalVendor && !dbVendors.some((v) => v.name.toLowerCase() === finalVendor.toLowerCase())) {
      createVendorMutation.mutate({ name: finalVendor })
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
        amount: type === 'Expense' ? -parsedTotal : parsedTotal
      })

      const categorySplit = splits[0]
      if (!categorySplit?.subCategoryId) {
        alert("Please select a category.")
        return
      }

      entries.push({
        accountId: categorySplit.subCategoryId,
        amount: type === 'Expense' ? parsedTotal : -parsedTotal
      })
    }

    let finalScheduleId: string | undefined = undefined;

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
        templateVendor: type === 'Transfer' ? undefined : finalVendor,
        templateEntries: entries.map(e => ({ accountId: e.accountId, amount: e.amount }))
      })
      // Do NOT return here. We want execution to continue and create the immediate transaction!
    }

    if (ingestionId) {
      confirmIngestionMutation.mutate({
        id: ingestionId,
        userConfirmed: {
          vendor: finalVendor || null,
          amount: parsedTotal,
          transaction_type: type,
          debit_account_id: type === 'Transfer' ? toAccountId : (type === 'Income' ? sourceAccountId : splits[0].subCategoryId),
          credit_account_id: type === 'Transfer' ? sourceAccountId : (type === 'Income' ? splits[0].subCategoryId : sourceAccountId),
          notes: note || null,
          user_why: userWhy || null,
          date: dayjs(date).toISOString()
        }
      }, {
        onSuccess: () => {
          onSave?.(dayjs(date).toISOString())
          onClose()
          resetForm()
        }
      })
      return
    }

    const transaction: Transaction = {
      ...(initialData ? { id: initialData.id } : {}),
      type,
      scheduleId: finalScheduleId,
      entries,
      vendor: type === 'Transfer' ? null : finalVendor,
      note,
      date: dayjs(date).toISOString(),
    }

    const mutation = initialData ? updateTxMutation : createTxMutation

    mutation.mutate(transaction, {
      onSuccess: () => {
        if (initialData && ingestionId === undefined && ingestion) {
          const updatedUserConfirmed = {
            ...(ingestion.user_confirmed || {}),
            vendor: type === 'Transfer' ? null : (finalVendor || null),
            amount: parsedTotal,
            transaction_type: type,
            debit_account_id: type === 'Transfer' ? toAccountId : (type === 'Income' ? sourceAccountId : (splits[0]?.subCategoryId || null)),
            credit_account_id: type === 'Transfer' ? sourceAccountId : (type === 'Income' ? (splits[0]?.subCategoryId || null) : sourceAccountId),
            notes: note || null,
            user_why: userWhy || null,
            date: dayjs(date).toISOString()
          }

          // Only learn if the userWhy or core details changed (rudimentary check by stringifying)
          const currentStringified = JSON.stringify(ingestion.user_confirmed || {})
          const updatedStringified = JSON.stringify(updatedUserConfirmed)

          if (currentStringified !== updatedStringified) {
            learnIngestionMutation.mutate({
              id: ingestion.id,
              userConfirmed: updatedUserConfirmed
            })
          }
        }

        onSave?.(dayjs(date).toISOString())
        if (submitTypeRef.current === 'more') {
          setTotalAmount('')
          setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
          setJournalLines([
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Debit' },
            { id: generateId(), categoryId: '', subCategoryId: '', amount: '', type: 'Credit' }
          ])
          setVendor('')
          setNote('')
          setUserWhy('')
        } else {
          onClose()
          if (!initialData) resetForm()
        }
      },
    })
  }, [mode, date, journalLines, totalAmount, sourceAccountId, type, toAccountId, splits, vendor, dbVendors, note, userWhy, initialData, ingestionId, createTxMutation, updateTxMutation, createVendorMutation, resetForm, onClose, onSave, isRecurring, frequency, maxOccurrences, createRecurringTxMutation, confirmIngestionMutation, learnIngestionMutation, ingestion])

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-50 transition-opacity duration-300"
      />
      {/* Bottom Sheet */}
      <div className={`fixed bottom-0 left-0 right-0 w-full ${ingestion ? 'md:max-w-3xl' : 'md:max-w-md'
        } mx-auto bg-white dark:bg-slate-900 rounded-t-2xl z-55 shadow-2xl p-4 flex flex-col gap-4 border-t border-slate-200 dark:border-slate-800 animate-slide-up pb-safe max-h-[90vh] overflow-y-auto transition-all duration-500 ${isFlashing ? 'ring-4 ring-indigo-500/50 scale-[1.02] bg-indigo-50 dark:bg-indigo-950/20' : ''}`}>
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
                onClick={() => reclassifyMutation.mutate(ingestion.id)}
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

        <div className={ingestion ? "grid grid-cols-1 md:grid-cols-12 gap-4 items-start" : "flex flex-col gap-4"}>
          {/* Form and Toggles Column */}
          <div className={ingestion ? "md:col-span-7 flex flex-col gap-4" : "flex flex-col gap-4"}>

            {/* Mode Toggle (Simple / Advanced) */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setMode('Simple')}
                className={`flex-1 py-1.5 rounded-lg font-semibold text-xs uppercase tracking-wide transition-all cursor-pointer ${mode === 'Simple'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
              >
                Simple
              </button>
              <button
                type="button"
                onClick={() => setMode('Advanced')}
                className={`flex-1 py-1.5 rounded-lg font-semibold text-xs uppercase tracking-wide transition-all cursor-pointer ${mode === 'Advanced'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
              >
                Advanced
              </button>
            </div>

            {mode === 'Simple' && (
              <div className="grid grid-cols-3 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                {(['Expense', 'Income', 'Transfer'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setType(t)
                      setSplits([{ id: generateId(), categoryId: '', subCategoryId: '', amount: '' }])
                      // Clear toAccountId when switching away from Transfer
                      if (t !== 'Transfer') setToAccountId('')
                    }}
                    className={`py-2 rounded-lg font-medium text-sm transition-all cursor-pointer ${type === t
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

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
                    <label htmlFor="source-account-select" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{type === 'Income' ? 'Deposit To' : 'Pay From'}</label>
                    <select
                      id="source-account-select"
                      value={sourceAccountId}
                      onChange={(e) => setSourceAccountId(e.target.value)}
                      required
                      className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="">Select Account...</option>
                      {Array.from(new Set(paymentAccounts.map(a => a.accountGroupId))).sort((a, b) => {
                        const gA = accountGroups.find(g => g.id === a)?.name || '';
                        const gB = accountGroups.find(g => g.id === b)?.name || '';
                        return gA.localeCompare(gB);
                      }).map(groupId => {
                        const group = accountGroups.find(g => g.id === groupId)
                        const groupAccounts = paymentAccounts.filter(a => a.accountGroupId === groupId)
                        if (!group || groupAccounts.length === 0) return null
                        return (
                           <optgroup key={group.id} label={group.name}>
                            {groupAccounts.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </optgroup>
                        )
                      })}
                    </select>
                  </div>

                  {/* Destination Account (Only for Transfer) */}
                  {type === 'Transfer' && (
                    <div className="flex flex-col gap-1">
                      <label htmlFor="destination-account-select" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Transfer To</label>
                      <select
                        id="destination-account-select"
                        value={toAccountId}
                        onChange={(e) => setToAccountId(e.target.value)}
                        required
                        className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Select Destination Account...</option>
                        {Array.from(new Set(paymentAccounts.filter(a => a.id !== sourceAccountId).map(a => a.accountGroupId))).sort((a, b) => {
                          const gA = accountGroups.find(g => g.id === a)?.name || '';
                          const gB = accountGroups.find(g => g.id === b)?.name || '';
                          return gA.localeCompare(gB);
                        }).map(groupId => {
                          const group = accountGroups.find(g => g.id === groupId)
                          const groupAccounts = paymentAccounts.filter(a => a.accountGroupId === groupId && a.id !== sourceAccountId)
                          if (!group || groupAccounts.length === 0) return null
                          return (
                            <optgroup key={group.id} label={group.name}>
                              {groupAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
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
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</label>
                      </div>

                      {splits.map((split) => {
                        const subCategoryOptions = accounts.filter(a => a.accountGroupId === split.categoryId).sort((a, b) => a.name.localeCompare(b.name))
                        return (
                          <div key={split.id} className="flex flex-col gap-2 p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                            <div className="flex gap-2">
                              <Combobox
                                options={categoryGroups.map(g => ({ value: g.id, label: g.name }))}
                                value={split.categoryId}
                                onChange={(val) => updateSplit(split.id, { categoryId: val })}
                                onCreate={(val) => {
                                  createAccountGroupMutation.mutate({ name: val, accountType: type }, {
                                    onSuccess: (data) => {
                                      if (data && data.id) {
                                        updateSplit(split.id, { categoryId: data.id })
                                      }
                                    }
                                  })
                                }}
                                placeholder="Select Category..."
                                className="flex-1"
                              />
                            </div>

                            <div className="flex gap-2">
                              <Combobox
                                options={subCategoryOptions.map(a => ({ value: a.id!, label: a.name }))}
                                value={split.subCategoryId}
                                onChange={(val) => updateSplit(split.id, { subCategoryId: val })}
                                onCreate={(val) => {
                                  if (!split.categoryId) {
                                    alert('Please select a Category first.')
                                    return
                                  }
                                  setPendingNewAccount({
                                    name: val,
                                    categoryId: split.categoryId,
                                    type,
                                    splitId: split.id,
                                    description: '',
                                    tags: []
                                  })
                                }}
                                placeholder="Select Sub-Category..."
                                className="flex-1"
                                disabled={!split.categoryId}
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
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Journal Lines</label>
                  </div>

                  {journalLines.map((line) => (
                    <div key={line.id} className="flex flex-col gap-2 p-2 border border-slate-200 dark:border-slate-800 rounded-lg">
                      <div className="flex gap-2">
                        <Combobox
                          options={accountGroups.slice().sort((a, b) => a.name.localeCompare(b.name)).map(g => ({ value: g.id, label: g.name }))}
                          value={line.categoryId}
                          onChange={(val) => updateJournalLine(line.id, { categoryId: val })}
                          placeholder="Category..."
                          className="flex-1 text-sm"
                        />
                        <Combobox
                          options={accounts.filter(a => a.accountGroupId === line.categoryId).sort((a, b) => a.name.localeCompare(b.name)).map(a => ({ value: a.id!, label: a.name }))}
                          value={line.subCategoryId}
                          onChange={(val) => updateJournalLine(line.id, { subCategoryId: val })}
                          placeholder="Account..."
                          className="flex-1 text-sm"
                          disabled={!line.categoryId}
                        />
                      </div>

                      <div className="flex gap-2 items-center w-full">
                        <div className="flex flex-col flex-1 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden focus-within:border-blue-600 bg-white dark:bg-slate-950">
                          <div className="flex text-[10px] uppercase font-bold text-slate-400 bg-slate-100 dark:bg-slate-900">
                            <button
                              type="button"
                              onClick={() => updateJournalLine(line.id, { type: 'Debit' })}
                              className={`flex-1 py-1 text-center transition-colors ${line.type === 'Debit' ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100' : 'hover:bg-slate-200/50 dark:hover:bg-slate-800'}`}
                            >
                              Dr
                            </button>
                            <button
                              type="button"
                              onClick={() => updateJournalLine(line.id, { type: 'Credit' })}
                              className={`flex-1 py-1 text-center transition-colors ${line.type === 'Credit' ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100' : 'hover:bg-slate-200/50 dark:hover:bg-slate-800'}`}
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
                                  type: line.type === 'Debit' ? 'Credit' : 'Debit'
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
                        Dr: ₱{journalLines.filter(l => l.type === 'Debit').reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0).toFixed(2)}
                      </span>
                      <span className="text-rose-600 dark:text-rose-400 font-semibold bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded">
                        Cr: ₱{journalLines.filter(l => l.type === 'Credit').reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Shared Vendor, Date, and Note for both modes */}
              <div className="flex flex-col gap-1 mt-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor / Payer</label>
                <Combobox
                  options={vendorOptions.filter(v => v !== 'Other / Custom').map(v => ({ value: v, label: v }))}
                  value={vendor}
                  onChange={(val) => {
                    setVendor(val)
                    if (ingestion) updateIngestionVendorMutation.mutate({ id: ingestion.id, vendor: val })
                  }}
                  onCreate={(val) => {
                    const tags = suggestedVendorTags ? suggestedVendorTags.split(',').map(t => t.trim()).filter(Boolean) : []
                    createVendorMutation.mutate({ name: val, type: suggestedVendorType, tags }, {
                      onSuccess: () => {
                        setVendor(val)
                        if (ingestion) updateIngestionVendorMutation.mutate({ id: ingestion.id, vendor: val })
                      }
                    })
                  }}
                  placeholder="Select Vendor / Payer (optional)..."
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="transaction-date-input" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</label>
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
                  <label htmlFor="transaction-note-textarea" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Note</label>
                  <textarea
                    id="transaction-note-textarea"
                    placeholder="Note (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="min-h-[44px] p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-sm resize-y"
                    rows={2}
                  />
                </div>
              </div>

              {ingestion && (
                <div className="flex flex-col gap-1 mt-2">
                  <label htmlFor="correction-reason-textarea" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Correction Reason / Notes (Why)</label>
                  <textarea
                    id="correction-reason-textarea"
                    placeholder="Describe adjustments or rules to be set against the AI reasoning..."
                    value={userWhy}
                    onChange={(e) => setUserWhy(e.target.value)}
                    className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full text-sm focus:outline-none focus:border-blue-600 resize-y"
                    rows={2}
                  />
                </div>
              )}

              {!initialData && (
                <div className="mt-4 p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/50">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Make this recurring</span>
                      <span className="text-xs text-slate-500">Auto-generate this transaction</span>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input type="checkbox" className="sr-only peer" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
                    </div>
                  </label>

                  {isRecurring && (
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Frequency</label>
                        <select
                          value={frequency}
                          onChange={e => setFrequency(e.target.value as any)}
                          className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full"
                        >
                          <option value="Daily">Daily</option>
                          <option value="Weekly">Weekly</option>
                          <option value="Monthly">Monthly</option>
                          <option value="Yearly">Yearly</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Max Times (Optional)</label>
                        <input
                          type="number"
                          placeholder="Unlimited"
                          value={maxOccurrences}
                          onChange={e => setMaxOccurrences(e.target.value)}
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
                  onClick={() => { submitTypeRef.current = 'close' }}
                  className="w-full min-h-[48px] mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors cursor-pointer text-lg shadow-sm"
                >
                  Save Changes
                </button>
              ) : (
                <div className="flex gap-2 mt-4">
                  <button
                    type="submit"
                    onClick={() => { submitTypeRef.current = 'close' }}
                    className="flex-[2] min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors cursor-pointer shadow-sm text-sm"
                  >
                    Save & Close
                  </button>
                  <button
                    type="submit"
                    onClick={() => { submitTypeRef.current = 'more' }}
                    className="flex-[1.5] min-h-[48px] bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold rounded-lg transition-colors cursor-pointer shadow-sm text-sm"
                  >
                    Save & Add Another
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* Sidebar Review Column */}
          {ingestion && (
            <div className="md:col-span-5 flex flex-col gap-3 md:sticky md:top-0 bg-slate-100 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-center w-full font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider text-[11px]">
                <span>Notification Review</span>
                <button
                  type="button"
                  onClick={() => setIsReviewOpen(!isReviewOpen)}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-bold cursor-pointer normal-case text-[11px]"
                  aria-expanded={isReviewOpen}
                >
                  {isReviewOpen ? 'Collapse' : 'Expand'}
                </button>
              </div>

              {isReviewOpen && (
                <div className="flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-1">
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/60 rounded-xl">
                    <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Raw Msg</span>
                    <p className="text-slate-800 dark:text-slate-200 italic mt-0.5 font-semibold text-xs leading-snug">"{ingestion.raw_msg}"</p>
                  </div>

                  {/* Sender / Recipient / App metadata if present */}
                  <div className="grid grid-cols-2 gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Source App</span>
                      <p className="text-slate-800 dark:text-slate-200 font-bold text-xs mt-0.5 truncate">{getIngestionAppName(ingestion)}</p>
                    </div>
                    {(ingestion.ai_parsed.sender_account_name || ingestion.ai_parsed.sender_account_number) && (
                      <div>
                        <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Sender Acc</span>
                        <p className="text-slate-800 dark:text-slate-200 font-bold text-xs mt-0.5 truncate">
                          {ingestion.ai_parsed.sender_account_name || 'N/A'}
                          {ingestion.ai_parsed.sender_account_number ? ` (${ingestion.ai_parsed.sender_account_number})` : ''}
                        </p>
                      </div>
                    )}
                    {(ingestion.ai_parsed.recipient_account_name || ingestion.ai_parsed.recipient_account_number) && (
                      <div className="col-span-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                        <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Recipient Acc</span>
                        <p className="text-slate-800 dark:text-slate-200 font-bold text-xs mt-0.5 truncate">
                          {ingestion.ai_parsed.recipient_account_name || 'N/A'}
                          {ingestion.ai_parsed.recipient_account_number ? ` (${ingestion.ai_parsed.recipient_account_number})` : ''}
                        </p>
                      </div>
                    )}
                  </div>

                  {ingestion.ai_parsed.vendor && ingestionId && !ingestion.ai_parsed.vendor_matched && !dbVendors.some(v => v.name.toLowerCase() === ingestion.ai_parsed.vendor?.toLowerCase()) && (
                    <div key={`${ingestion.id}-suggested-vendor`} className="flex flex-col gap-2.5 p-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/60 rounded-xl">
                      <div className="flex flex-col gap-1">
                        <span className="text-blue-600 dark:text-blue-400 uppercase tracking-wider font-bold text-[9px] flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5" strokeWidth={2} /> Suggested Vendor
                        </span>
                        <span className="text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 flex-wrap">
                          {ingestion.ai_parsed.vendor}
                          {ingestion.ai_parsed.suggested_vendor?.type === 'Individual' && (
                            <span className="text-[10px] text-slate-500 font-bold" title="Individual">(I)</span>
                          )}
                          {ingestion.ai_parsed.suggested_vendor?.type === 'Business' && (
                            <span className="text-[10px] text-slate-500 font-bold" title="Business">(B)</span>
                          )}
                        </span>
                        {ingestion.ai_parsed.suggested_vendor?.tags && ingestion.ai_parsed.suggested_vendor.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {ingestion.ai_parsed.suggested_vendor.tags.map(tag => (
                              <span key={tag} className="px-1.5 py-0.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md text-[10px] font-bold shadow-sm border border-slate-200 dark:border-slate-700">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 mt-0.5">
                        {hasMasks(ingestion.ai_parsed.vendor) ? (
                          <span className="text-[10px] text-amber-500 font-medium">
                            Name contains masks (please edit via form Vendor dropdown to add a clean vendor name)
                          </span>
                        ) : (
                          <>
                            <div className="flex gap-2 items-center">
                              <select
                                value={suggestedVendorType}
                                onChange={e => setSuggestedVendorType(e.target.value as any)}
                                className="text-[10px] px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                                aria-label="Suggested Vendor Type"
                              >
                                <option value="Business">Business</option>
                                <option value="Individual">Individual</option>
                              </select>
                              <input
                                value={suggestedVendorTags}
                                onChange={e => setSuggestedVendorTags(e.target.value)}
                                className="flex-1 text-[10px] px-1.5 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                                placeholder="Tags (comma separated)"
                                aria-label="Suggested Vendor Tags"
                              />
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                  const tags = suggestedVendorTags ? suggestedVendorTags.split(',').map(t => t.trim()).filter(Boolean) : []
                                  createVendorMutation.mutate({ name: ingestion.ai_parsed.vendor!, type: suggestedVendorType, tags }, {
                                    onSuccess: () => {
                                      setVendor(ingestion.ai_parsed.vendor!)
                                      updateIngestionVendorMutation.mutate({ id: ingestion.id, vendor: ingestion.ai_parsed.vendor! })
                                    }
                                  })
                                }}
                                disabled={createVendorMutation.isPending}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors shadow-sm disabled:opacity-50 w-full"
                              >
                                <Plus className="w-3.5 h-3.5" strokeWidth={2} /> Create Vendor
                              </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {ingestion.ai_parsed.suggested_account_creation && ingestionId && ingestion.ai_parsed.suggested_account_creation.length > 0 && (
                    <div className="flex flex-col gap-2 mt-1">
                      {ingestion.ai_parsed.suggested_account_creation.map((suggestion, idx) => {
                        const isEditing = editingSuggestion?.idx === idx
                        const targetGroup = accountGroups.find(g => g.name.toLowerCase() === suggestion.account_group.toLowerCase())
                        const isCreated = createdSuggestions.has(idx) || (targetGroup && accounts.some(a => a.name.toLowerCase() === suggestion.name.toLowerCase() && a.accountGroupId === targetGroup.id))
                        const existingAccount = accounts.find(a => 
                          a.name.toLowerCase() === suggestion.name.toLowerCase() && 
                          targetGroup && a.accountGroupId === targetGroup.id
                        )
                        const isSelected = existingAccount && (
                          (suggestion.type === 'Expense' || suggestion.type === 'Income')
                            ? splits.some(s => s.subCategoryId === existingAccount.id)
                            : (sourceAccountId === existingAccount.id || toAccountId === existingAccount.id)
                        )

                        return (
                          <div key={`${ingestion.id}-suggested-acc-${idx}`} className="flex flex-col gap-2 p-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/60 rounded-xl shadow-sm">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-blue-600 dark:text-blue-400 uppercase tracking-wider font-bold text-[9px] flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5" strokeWidth={2} /> Suggested Account
                              </span>
                              {isEditing ? (
                                <div className="flex flex-col gap-1.5 mt-0.5">
                                  <input
                                    value={editingSuggestion.data.name}
                                    onChange={e => setEditingSuggestion({ ...editingSuggestion, data: { ...editingSuggestion.data, name: e.target.value } })}
                                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                                    placeholder="Account Name"
                                    aria-label="Account Name"
                                  />
                                  <div className="relative">
                                    <input
                                      value={editingSuggestion.data.account_group}
                                      onChange={e => setEditingSuggestion({ ...editingSuggestion, data: { ...editingSuggestion.data, account_group: e.target.value } })}
                                      className={`w-full text-xs px-2 py-1 rounded border bg-white dark:bg-slate-950 text-slate-900 dark:text-white pr-8 ${accountGroups.some(g => g.name.toLowerCase() === editingSuggestion.data.account_group.toLowerCase()) ? 'border-green-400 dark:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-500' : 'border-blue-200 dark:border-blue-800'}`}
                                      placeholder="Account Group"
                                      aria-label="Account Group"
                                    />
                                    {accountGroups.some(g => g.name.toLowerCase() === editingSuggestion.data.account_group.toLowerCase()) && (
                                      <div className="absolute right-2 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400 font-bold" title="Group exists">
                                        <Check className="w-3.5 h-3.5" strokeWidth={1.5} />
                                      </div>
                                    )}
                                  </div>
                                  <select
                                    value={editingSuggestion.data.type}
                                    onChange={e => setEditingSuggestion({ ...editingSuggestion, data: { ...editingSuggestion.data, type: e.target.value } })}
                                    className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                                    aria-label="Account Type"
                                  >
                                    {['Adjustment', 'Asset', 'Bank', 'Cash', 'CreditCard', 'Equity', 'Expense', 'Income', 'Investment', 'Liability'].map(t => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                    <TagInput
                                      tags={editingSuggestion.data.tags || []}
                                      onChange={(newTags) => setEditingSuggestion({ ...editingSuggestion, data: { ...editingSuggestion.data, tags: newTags } })}
                                      placeholder="Type tag and press Enter"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-slate-800 dark:text-slate-200 font-bold text-xs">
                                    <span className="text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">{suggestion.type}</span> &bull; {suggestion.account_group} - {suggestion.name}
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-2 mt-1">
                                {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleCreateSuggestedAccount(editingSuggestion.data, idx)}
                                    disabled={isCreatingAccount || !editingSuggestion.data.name || !editingSuggestion.data.account_group}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-50 shadow-sm"
                                  >
                                    <Check className="w-3.5 h-3.5" strokeWidth={2} /> Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingSuggestion(null)}
                                    className="flex-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" strokeWidth={2} /> Cancel
                                  </button>
                                </>
                              ) : isCreated ? (
                                isSelected ? (
                                  <div className="w-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 border border-green-300 dark:border-green-800/60">
                                    <Check className="w-3.5 h-3.5" strokeWidth={2} /> Selected
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (existingAccount) {
                                        if (suggestion.type === 'Expense' || suggestion.type === 'Income') {
                                          setSplits([{
                                            id: splits[0]?.id || generateId(),
                                            categoryId: existingAccount.accountGroupId,
                                            subCategoryId: existingAccount.id || '',
                                            amount: splits[0]?.amount || ''
                                          }])
                                        } else {
                                          setSourceAccountId(existingAccount.id || '')
                                        }
                                      }
                                    }}
                                    className="w-full bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 border border-blue-200 dark:border-blue-800/60 cursor-pointer shadow-sm transition-colors"
                                  >
                                    Use Account
                                  </button>
                                )
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleCreateSuggestedAccount(suggestion as any, idx)}
                                    disabled={isCreatingAccount}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-50 shadow-sm"
                                  >
                                    <Plus className="w-3.5 h-3.5" strokeWidth={2} /> Create
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingSuggestion({ idx, data: { name: suggestion.name, account_group: suggestion.account_group, type: suggestion.type, description: (suggestion as any).description || '', tags: (suggestion as any).tags || [] } })}
                                    disabled={isCreatingAccount}
                                    className="flex-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-50 shadow-sm"
                                  >
                                    <Edit className="w-3.5 h-3.5" strokeWidth={2} /> Edit
                                  </button>
                                </>
                              )}
                            </div>
                            {!isEditing && (
                              <span className="text-slate-600 dark:text-slate-400 text-[10px] mt-0.5 leading-snug">
                                {suggestion.reason}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {ingestion.ai_parsed.why && (
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 rounded-xl mt-1">
                      <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">AI Reasoning</span>
                      <p className="text-slate-800 dark:text-slate-200 mt-0.5 leading-snug text-xs font-medium">{ingestion.ai_parsed.why}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pending Account Creation Modal */}
      {pendingNewAccount && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => setPendingNewAccount(null)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4 border border-slate-200 dark:border-slate-800 animate-slide-up">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">New Account Details</h3>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Account Name</label>
                <input
                  type="text"
                  value={pendingNewAccount.name}
                  onChange={(e) => setPendingNewAccount({ ...pendingNewAccount, name: e.target.value })}
                  className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</label>
                  <button
                    type="button"
                    onClick={handleGeneratePendingAccountDescription}
                    disabled={generateDescriptionMutation.isPending || !pendingNewAccount.name}
                    className="text-[10px] flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3" />
                    {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Generate'}
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. For daily expenses"
                  value={pendingNewAccount.description}
                  onChange={(e) => setPendingNewAccount({ ...pendingNewAccount, description: e.target.value })}
                  className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tags</label>
                  <button
                    type="button"
                    onClick={handleGeneratePendingAccountDescription}
                    disabled={generateDescriptionMutation.isPending || !pendingNewAccount.name}
                    className="text-[10px] flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
                    {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Generate'}
                  </button>
                </div>
                <TagInput
                  tags={pendingNewAccount.tags || []}
                  onChange={(newTags) => setPendingNewAccount({ ...pendingNewAccount, tags: newTags })}
                  placeholder="Type tag and press Enter"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-2">
              <button
                type="button"
                onClick={() => setPendingNewAccount(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePendingAccount}
                disabled={!pendingNewAccount.name.trim() || createAccountMutation.isPending}
                className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {createAccountMutation.isPending ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
