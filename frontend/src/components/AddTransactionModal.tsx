import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Plus, X, Trash2, RefreshCw, RotateCcw, Sparkles, Edit, Check } from 'lucide-react'
import { useGetAccounts, useGetAccountGroups, useCreateAccountGroup, useCreateAccount, useGenerateAccountDescription } from '@/hooks/useAccounts'
import { useGetVendors, useCreateVendor } from '@/hooks/useVendors'
import { useCreateTransaction, useUpdateTransaction, Transaction, LedgerEntry } from '@/hooks/useTransactions'
import { useCreateRecurringTransaction } from '@/hooks/useRecurringTransactions'
import { PendingIngestion, useGetIngestionById, useConfirmIngestion, useReclassifyIngestion, useUpdateIngestionVendor } from '@/hooks/useIngestions'
import { useQueryClient } from '@tanstack/react-query'
import { uuidv7 } from 'uuidv7'
import dayjs from 'dayjs'
import Combobox from './ui/Combobox'
import CalculatorInput from './ui/CalculatorInput'

const generateId = () => uuidv7()

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
  } | null>(null)

  const getIngestionAppName = (ing: PendingIngestion) => {
    if (ing.ai_parsed?.application) return ing.ai_parsed.application

    const payload = ing.raw_payload || {}
    const keys = Object.keys(payload)

    const pkgKey = keys.find(k => k.toLowerCase() === 'notif_pkg' || k.toLowerCase() === 'notifpkg' || k.toLowerCase() === 'package');
    const senderKey = keys.find(k => k.toLowerCase() === 'sms_sender' || k.toLowerCase() === 'smssender' || k.toLowerCase() === 'sender' || k.toLowerCase() === 'from');

    const pkg = (pkgKey ? payload[pkgKey] : null) || (senderKey ? payload[senderKey] : null) || '';
    if (!pkg || typeof pkg !== 'string') return 'Notification'

    const pkgLower = pkg.toLowerCase()
    if (pkgLower.includes('gcash')) return 'GCash'
    if (pkgLower.includes('indivara')) return 'BPI / indivara (Vybe)'
    if (pkgLower.includes('bpi')) return 'BPI'
    if (pkgLower.includes('maya')) return 'Maya'
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
  const [editingSuggestion, setEditingSuggestion] = useState<{ idx: number, data: { name: string, account_group: string, type: string, description: string } } | null>(null)

  const handleCreateSuggestedAccount = async (data: { type: string, account_group: string, name: string, description?: string }) => {
    setIsCreatingAccount(true)
    try {
      let targetGroupId = accountGroups.find(g => g.name === data.account_group && g.accountType === data.type)?.id

      if (!targetGroupId) {
        const newGroup = await createAccountGroupMutation.mutateAsync({ name: data.account_group, accountType: data.type })
        targetGroupId = newGroup.id
      }

      await createAccountMutation.mutateAsync({
        name: data.name,
        description: data.description,
        accountGroupId: targetGroupId as string,
        startingBalance: 0,
        accountType: data.type as any,
      })
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
      const { description } = await generateDescriptionMutation.mutateAsync({
        name: pendingNewAccount.name,
        type: pendingNewAccount.type,
        groupName: groupName,
        context: pendingNewAccount.description
      });
      setPendingNewAccount({ ...pendingNewAccount, description });
    } catch (e) {
      console.error(e);
      alert("Failed to generate description.");
    }
  };

  const handleGenerateSuggestionDescription = async () => {
    if (!editingSuggestion || !editingSuggestion.data.name || !ingestion) return;
    try {
      const { description } = await generateDescriptionMutation.mutateAsync({
        name: editingSuggestion.data.name,
        type: editingSuggestion.data.type || '',
        groupName: editingSuggestion.data.account_group,
        context: ingestion.raw_msg
      });
      setEditingSuggestion({
        ...editingSuggestion,
        data: { ...editingSuggestion.data, description }
      });
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

  const prevInitialDataStr = useRef<string | null>(null)
  const isOpenPrev = useRef<boolean>(false)

  useEffect(() => {
    const dataStr = initialData ? JSON.stringify(initialData) : null
    const justOpened = isOpen && !isOpenPrev.current
    isOpenPrev.current = isOpen

    if (isOpen) {
      if (!justOpened && prevInitialDataStr.current === dataStr) {
        return
      }
      prevInitialDataStr.current = dataStr

      if (initialData) {
        setMode(initialData.type === 'Journal' ? 'Advanced' : 'Simple')
        setType(initialData.type)
        setDate(dayjs(initialData.date).format('YYYY-MM-DDTHH:mm'))
        setNote(initialData.note || '')
        setVendor(initialData.vendor || '')

        if (initialData.type === 'Journal') {
          setJournalLines(initialData.entries.map(e => {
            const acc = accounts.find(a => a.id === e.accountId)
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

              // We need categoryId, we can try to guess it from accounts if possible
              const account = accounts.find(a => a.id === dstEntry.accountId)
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
      if (justOpened || prevInitialDataStr.current !== dataStr) {
        setUserWhy(ingestion?.user_confirmed?.user_why || '')
      }
    } else {
      prevInitialDataStr.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData, accounts])

  // Combine DB Vendors with presets - memoized for performance
  const vendorOptions = useMemo(() => dbVendors.map((v) => v.name), [dbVendors])

  // Payment Source Accounts (Asset / Bank / Cash / CreditCard / Investment)
  const paymentGroupIds = useMemo(() => new Set(
    accountGroups
      .filter((g) => g.accountType !== 'Expense' && g.accountType !== 'Income')
      .map((g) => g.id)
  ), [accountGroups])

  const paymentAccounts = useMemo(() => accounts.filter(
    (a) => !a.accountGroupId || paymentGroupIds.has(a.accountGroupId)
  ), [accounts, paymentGroupIds])

  // Category Account Groups (Strictly Expense or Income)
  const categoryGroups = useMemo(() => accountGroups.filter((g) => {
    if (type === 'Expense') return g.accountType === 'Expense'
    if (type === 'Income') return g.accountType === 'Income'
    return false
  }), [accountGroups, type])


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

    if (finalVendor && !dbVendors.some((v) => v.name.toLowerCase() === finalVendor.toLowerCase())) {
      createVendorMutation.mutate(finalVendor)
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
          debit_account_id: type === 'Transfer' ? toAccountId : splits[0].subCategoryId,
          credit_account_id: sourceAccountId,
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
  }, [mode, date, journalLines, totalAmount, sourceAccountId, type, toAccountId, splits, vendor, dbVendors, note, userWhy, initialData, ingestionId, createTxMutation, updateTxMutation, createVendorMutation, resetForm, onClose, onSave, isRecurring, frequency, maxOccurrences, createRecurringTxMutation, confirmIngestionMutation])

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
              <RefreshCw className="w-4 h-4" />
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
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
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
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{type === 'Income' ? 'Deposit To' : 'Pay From'}</label>
                    <select
                      value={sourceAccountId}
                      onChange={(e) => setSourceAccountId(e.target.value)}
                      required
                      className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="">Select Account...</option>
                      {Array.from(new Set(paymentAccounts.map(a => a.accountGroupId))).map(groupId => {
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
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Transfer To</label>
                      <select
                        value={toAccountId}
                        onChange={(e) => setToAccountId(e.target.value)}
                        required
                        className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Select Destination Account...</option>
                        {Array.from(new Set(paymentAccounts.filter(a => a.id !== sourceAccountId).map(a => a.accountGroupId))).map(groupId => {
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
                        const subCategoryOptions = accounts.filter(a => a.accountGroupId === split.categoryId)
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
                                    description: ''
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
                          options={accountGroups.map(g => ({ value: g.id, label: g.name }))}
                          value={line.categoryId}
                          onChange={(val) => updateJournalLine(line.id, { categoryId: val })}
                          placeholder="Category..."
                          className="flex-1 text-sm"
                        />
                        <Combobox
                          options={accounts.filter(a => a.accountGroupId === line.categoryId).map(a => ({ value: a.id!, label: a.name }))}
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
                            className="p-2 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
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
                    <Plus className="w-4 h-4" /> Add Line
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
                    createVendorMutation.mutate(val, {
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
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</label>
                  <input
                    type="datetime-local"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Note</label>
                  <textarea
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
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Correction Reason / Notes (Why)</label>
                  <textarea
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
            <div className="md:col-span-5 flex flex-col gap-4 md:sticky md:top-0 bg-slate-50/50 dark:bg-slate-900/30 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
              <div className="flex justify-between items-center w-full font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                <span>Notification Review</span>
                <button
                  type="button"
                  onClick={() => setIsReviewOpen(!isReviewOpen)}
                  className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer normal-case"
                >
                  {isReviewOpen ? 'Collapse' : 'Expand'}
                </button>
              </div>

              {isReviewOpen && (
                <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-1">
                  <div className="p-3 bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100/50 dark:border-blue-900/30 rounded-xl">
                    <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Raw Msg</span>
                    <p className="text-slate-700 dark:text-slate-350 italic mt-0.5 font-medium text-[11px]">"{ingestion.raw_msg}"</p>
                  </div>

                  {/* Sender / Recipient / App metadata if present */}
                  <div className="grid grid-cols-2 gap-3 p-3 bg-slate-100/50 dark:bg-slate-950/20 rounded-xl text-xs border border-slate-200/40 dark:border-slate-800/40">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 dark:text-slate-550 uppercase">Source App</span>
                      <p className="text-slate-700 dark:text-slate-300 font-medium text-[11px] truncate">{getIngestionAppName(ingestion)}</p>
                    </div>
                    {(ingestion.ai_parsed.sender_account_name || ingestion.ai_parsed.sender_account_number) && (
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-550 uppercase">Sender Acc</span>
                        <p className="text-slate-700 dark:text-slate-300 font-medium text-[11px] truncate">
                          {ingestion.ai_parsed.sender_account_name || 'N/A'}
                          {ingestion.ai_parsed.sender_account_number ? ` (${ingestion.ai_parsed.sender_account_number})` : ''}
                        </p>
                      </div>
                    )}
                    {(ingestion.ai_parsed.recipient_account_name || ingestion.ai_parsed.recipient_account_number) && (
                      <div className="col-span-2 border-t border-slate-200/40 dark:border-slate-800/40 pt-2">
                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-550 uppercase">Recipient Acc</span>
                        <p className="text-slate-700 dark:text-slate-300 font-medium text-[11px] truncate">
                          {ingestion.ai_parsed.recipient_account_name || 'N/A'}
                          {ingestion.ai_parsed.recipient_account_number ? ` (${ingestion.ai_parsed.recipient_account_number})` : ''}
                        </p>
                      </div>
                    )}
                  </div>

                  {ingestion.ai_parsed.vendor && !ingestion.ai_parsed.vendor_matched && !dbVendors.some(v => v.name.toLowerCase() === ingestion.ai_parsed.vendor?.toLowerCase()) && (
                    <div className="flex flex-col gap-1.5 p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30 rounded-xl mt-2">
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col gap-0.5 flex-1 pr-2">
                          <span className="text-blue-500 uppercase font-semibold text-[9px] flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" /> Suggested Vendor Creation
                          </span>
                          <span className="text-slate-700 dark:text-slate-300 font-medium text-[11px]">
                            {ingestion.ai_parsed.vendor}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            onClick={() => {
                              createVendorMutation.mutate(ingestion.ai_parsed.vendor!, {
                                onSuccess: () => {
                                  setVendor(ingestion.ai_parsed.vendor!)
                                  updateIngestionVendorMutation.mutate({ id: ingestion.id, vendor: ingestion.ai_parsed.vendor! })
                                }
                              })
                            }}
                            disabled={createVendorMutation.isPending}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                          >
                            <Plus className="w-3 h-3" /> Create
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {ingestion.ai_parsed.suggested_account_creation && ingestion.ai_parsed.suggested_account_creation.length > 0 && (
                    <div className="flex flex-col gap-2 mt-2">
                      {ingestion.ai_parsed.suggested_account_creation.map((suggestion, idx) => {
                        const isEditing = editingSuggestion?.idx === idx
                        return (
                          <div key={idx} className="flex flex-col gap-1.5 p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30 rounded-xl">
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col gap-0.5 flex-1 prf-2">
                                <span className="text-blue-500 uppercase font-semibold text-[9px] flex items-center gap-1">
                                  <Sparkles className="w-2.5 h-2.5" /> Suggested Account Creation
                                </span>
                                {isEditing ? (
                                  <div className="flex flex-col gap-1.5 mt-1">
                                    <input
                                      value={editingSuggestion.data.name}
                                      onChange={e => setEditingSuggestion({ ...editingSuggestion, data: { ...editingSuggestion.data, name: e.target.value } })}
                                      className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                                      placeholder="Account Name"
                                    />
                                    <div className="relative">
                                      <input
                                        value={editingSuggestion.data.account_group}
                                        onChange={e => setEditingSuggestion({ ...editingSuggestion, data: { ...editingSuggestion.data, account_group: e.target.value } })}
                                        className={`w-full text-xs px-2 py-1 rounded border bg-white dark:bg-slate-950 text-slate-900 dark:text-white pr-8 ${accountGroups.some(g => g.name.toLowerCase() === editingSuggestion.data.account_group.toLowerCase()) ? 'border-green-400 dark:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-500' : 'border-blue-200 dark:border-blue-800'}`}
                                        placeholder="Account Group"
                                      />
                                      {accountGroups.some(g => g.name.toLowerCase() === editingSuggestion.data.account_group.toLowerCase()) && (
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400 font-bold" title="Group exists">
                                          <Check className="w-3 h-3" />
                                        </div>
                                      )}
                                    </div>
                                    <select
                                      value={editingSuggestion.data.type}
                                      onChange={e => setEditingSuggestion({...editingSuggestion, data: {...editingSuggestion.data, type: e.target.value}})}
                                      className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                                    >
                                      {['Cash', 'Bank', 'CreditCard', 'Investment', 'Asset', 'Liability', 'Equity', 'Income', 'Expense', 'Adjustment'].map(t => (
                                        <option key={t} value={t}>{t}</option>
                                      ))}
                                    </select>
                                    <div className="flex flex-col gap-1 w-full">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Description</span>
                                        <button
                                          type="button"
                                          onClick={handleGenerateSuggestionDescription}
                                          disabled={generateDescriptionMutation.isPending || !editingSuggestion.data.name}
                                          className="text-[9px] flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                                        >
                                          <Sparkles className="w-3 h-3" />
                                          {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Generate'}
                                        </button>
                                      </div>
                                      <input
                                        value={editingSuggestion.data.description || ''}
                                        onChange={e => setEditingSuggestion({ ...editingSuggestion, data: { ...editingSuggestion.data, description: e.target.value } })}
                                        className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white w-full"
                                        placeholder="Description (optional)"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-700 dark:text-slate-300 font-medium text-[11px]">
                                    {suggestion.account_group} - {suggestion.name}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-col gap-1 shrink-0">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleCreateSuggestedAccount(editingSuggestion.data)}
                                      disabled={isCreatingAccount || !editingSuggestion.data.name || !editingSuggestion.data.account_group}
                                      className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                                    >
                                      <Check className="w-3 h-3" /> Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSuggestion(null)}
                                      className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors"
                                    >
                                      <X className="w-3 h-3" /> Cancel
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleCreateSuggestedAccount(suggestion as any)}
                                      disabled={isCreatingAccount}
                                      className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                                    >
                                      <Plus className="w-3 h-3" /> Create
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSuggestion({ idx, data: { name: suggestion.name, account_group: suggestion.account_group, type: suggestion.type, description: (suggestion as any).description || '' } })}
                                      disabled={isCreatingAccount}
                                      className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                                    >
                                      <Edit className="w-3 h-3" /> Edit
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            {!isEditing && (
                              <span className="text-slate-500 dark:text-slate-400 text-[10px] leading-tight mt-1">
                                {suggestion.reason}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {ingestion.ai_parsed.why && (
                    <div className="p-3 bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/20 rounded-xl">
                      <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider">AI Reasoning</span>
                      <p className="text-slate-650 dark:text-slate-400 mt-1 leading-relaxed text-[11px]">{ingestion.ai_parsed.why}</p>
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
