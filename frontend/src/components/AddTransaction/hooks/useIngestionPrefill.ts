import { useEffect, useRef, useCallback } from 'react'
import dayjs from 'dayjs'
import { uuidv7 } from 'uuidv7'
import { PendingIngestion } from '@/hooks/useIngestions'
import { Transaction } from '@/hooks/useTransactions'
import { Account } from '@/hooks/useAccounts'
import { SplitLine, JournalLine } from '../AddTransactionContext'

const generateId = () => uuidv7()

interface UseIngestionPrefillParams {
  isOpen: boolean
  initialData: Transaction | null
  ingestion: PendingIngestion | null
  accounts: Account[]
  reclassifyData: any
  resetForm: () => void
  resetSuggestionsState: () => void
  setIsFlashing: (flashing: boolean) => void
  setMode: (mode: 'Simple' | 'Advanced') => void
  setType: (type: 'Income' | 'Expense' | 'Transfer' | 'Journal') => void
  setTotalAmount: (amount: string) => void
  setSourceAccountId: (id: string) => void
  setToAccountId: (id: string) => void
  setSplits: (splits: SplitLine[] | ((prev: SplitLine[]) => SplitLine[])) => void
  setJournalLines: (lines: JournalLine[] | ((prev: JournalLine[]) => JournalLine[])) => void
  setVendor: (vendor: string) => void
  setSelectedLookups: (lookups: string[]) => void
  setSelectedNewLookups: (lookups: string[]) => void
  setDate: (date: string) => void
  setNote: (note: string) => void
  setReferenceNumber: (ref: string) => void
  setUserWhy: (why: string) => void
  setIsRecurring: (rec: boolean) => void
  setSuggestedVendorType: (type: 'Individual' | 'Business') => void
  setSuggestedVendorTags: (tags: string) => void
  onSnapshot?: (snapshot: any) => void
}

export function useIngestionPrefill({
  isOpen,
  initialData,
  ingestion,
  accounts,
  reclassifyData,
  resetForm,
  resetSuggestionsState,
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
  setIsRecurring,
  setSuggestedVendorType,
  setSuggestedVendorTags,
  onSnapshot,
}: UseIngestionPrefillParams) {
  const accountsRef = useRef(accounts)
  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  const applyAiParsed = useCallback(
    (parsed: any, receivedAt?: string) => {
      if (!parsed) return
      setIsFlashing(true)
      setTimeout(() => setIsFlashing(false), 600)

      if (parsed.transaction_type) {
        const t = ['Income', 'Expense', 'Transfer'].includes(parsed.transaction_type)
          ? (parsed.transaction_type as any)
          : 'Expense'
        setType(t)
      }
      if (parsed.amount) {
        setTotalAmount(Math.abs(parsed.amount).toString())
      }
      if (parsed.vendor) {
        const vendorName = typeof parsed.vendor === 'string' ? parsed.vendor : parsed.vendor.name || ''
        setVendor(vendorName)
        setSelectedLookups(parsed.vendor.lookups || [])
        setSelectedNewLookups(parsed.vendor.new_lookups || parsed.vendor.NewLookups || [])
        if (parsed.vendor.is_recommendation) {
          setSuggestedVendorType(parsed.vendor.type === 'Individual' ? 'Individual' : 'Business')
          setSuggestedVendorTags((parsed.vendor.tags || []).join(', '))
        }
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
      } else if (receivedAt) {
        setDate(dayjs(receivedAt).format('YYYY-MM-DDTHH:mm'))
      }
      if (parsed.reference_number !== undefined) {
        setReferenceNumber(parsed.reference_number || '')
      }

      // Multi-order pre-fill support
      if (parsed.multi_order_items && parsed.multi_order_items.length > 1) {
        setMode('Advanced')
        setType('Expense')
        const lines: JournalLine[] = []
        // 1. Credit line (full amount, credit account if available)
        const creditAcc = parsed.credit_account_id
          ? accountsRef.current.find((a) => a.id === parsed.credit_account_id)
          : null
        lines.push({
          id: generateId(),
          categoryId: creditAcc?.accountGroupId || '',
          subCategoryId: parsed.credit_account_id || '',
          amount: Math.abs(parsed.amount || 0).toString(),
          type: 'Credit',
          note: parsed.notes || 'Shopee total',
          referenceNumber: '',
        })

        // 2. N Debit lines (one per order)
        for (const order of parsed.multi_order_items) {
          const orderDebitAccId = order.debit_account_id || parsed.debit_account_id || ''
          const debitAcc = orderDebitAccId
            ? accountsRef.current.find((a) => a.id === orderDebitAccId)
            : null
          const orderVendorName =
            typeof order.vendor === 'string' ? order.vendor : order.vendor?.name || ''
          const orderNote = order.notes || orderVendorName || ''
          lines.push({
            id: generateId(),
            categoryId: debitAcc?.accountGroupId || '',
            subCategoryId: orderDebitAccId,
            amount: Math.abs(order.amount || 0).toString(),
            type: 'Debit',
            note: orderNote,
            referenceNumber: order.reference_number || '',
          })
        }
        setJournalLines(lines)
        return
      }

      // Pre-fill accounts based on transaction_type
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
    },
    [
      setIsFlashing,
      setType,
      setTotalAmount,
      setVendor,
      setSelectedLookups,
      setSelectedNewLookups,
      setSuggestedVendorType,
      setSuggestedVendorTags,
      setNote,
      setUserWhy,
      setDate,
      setReferenceNumber,
      setMode,
      setJournalLines,
      setSourceAccountId,
      setToAccountId,
      setSplits,
    ]
  )

  // Update form fields when reclassification succeeds
  const prevReclassifyDataRef = useRef<any>(null)
  useEffect(() => {
    if (reclassifyData && reclassifyData !== prevReclassifyDataRef.current) {
      prevReclassifyDataRef.current = reclassifyData
      applyAiParsed(reclassifyData.ai_parsed, reclassifyData.received_at)
      if (onSnapshot) {
        onSnapshot(reclassifyData.ai_parsed)
      }
    }
  }, [reclassifyData, applyAiParsed, onSnapshot])

  const formInitializedForRef = useRef<string | null>(null)

  // Only run initialization when modal opens or initialData / ingestion target changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

        if (ingestion && ingestion.ai_parsed) {
          applyAiParsed(ingestion.ai_parsed, ingestion.received_at)
        } else if (initialData.type === 'Journal') {
          setJournalLines(
            initialData.entries.map((e) => {
              const acc = accountsRef.current.find((a) => a.id === e.accountId)
              return {
                id: generateId(),
                categoryId: acc?.accountGroupId || '',
                subCategoryId: e.accountId,
                amount: Math.abs(e.amount).toString(),
                type: e.amount > 0 ? 'Debit' : 'Credit',
                note: e.note || '',
                referenceNumber: e.referenceNumber || '',
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
          resetSuggestionsState()
          const parsed = ingestion?.ai_parsed
          if (parsed) {
            applyAiParsed(parsed, ingestion?.received_at)
          }
        }
      }
      if (justOpened) {
        setUserWhy(ingestion?.user_confirmed?.user_why || '')
      }
      if (onSnapshot) {
        onSnapshot(initialData || ingestion?.ai_parsed || null)
      }
    } else {
      formInitializedForRef.current = null
    }
  }, [isOpen, initialData, ingestion, onSnapshot])

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
  }, [accounts, isOpen, initialData, setSplits, setJournalLines])
}
