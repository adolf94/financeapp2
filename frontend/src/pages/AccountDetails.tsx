import { useState, useMemo } from 'react'
import { useParams, Link } from '@tanstack/react-router'
import { useGetAccounts, useGetAccountGroups } from '@/hooks/useAccounts'
import { useGetAccountTransactions, Transaction } from '@/hooks/useTransactions'
import { ArrowLeft, ArrowDownRight, ArrowUpRight, ArrowRightLeft, BookOpen, Pencil, Edit3, SlidersHorizontal } from 'lucide-react'
import AddTransactionModal from '@/components/AddTransactionModal'
import EditAccountModal from '@/components/EditAccountModal'
import AdjustBalanceModal from '@/components/AdjustBalanceModal'

export default function AccountDetails() {
  const { accountId } = useParams({ from: '/accounts/$accountId' })
  const { data: accounts = [], isLoading: isLoadingAccounts } = useGetAccounts()
  const { data: groups = [] } = useGetAccountGroups()
  const { data: transactions = [], isLoading: isLoadingTx } = useGetAccountTransactions(accountId)

  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [isEditingAccount, setIsEditingAccount] = useState(false)
  const [isAdjustingBalance, setIsAdjustingBalance] = useState(false)

  const account = accounts.find(a => a.id === accountId)
  const group = groups.find((g: any) => g.id === account?.accountGroupId)

  const getAccountName = (id: string) => {
    return accounts.find(a => a.id === id)?.name ?? 'Unknown Account'
  }

  // Calculate running balances
  const transactionsWithBalance = useMemo(() => {
    if (!account || transactions.length === 0) return []

    // 1. Sort transactions oldest to newest
    const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // 2. Compute running balance starting from account's initial balance
    let currentBalance = account.startingBalance || 0
    const calculated = sorted.map(tx => {
      // Find the entries that affect this specific account
      const accountEntries = tx.entries.filter(e => e.accountId === accountId)
      // Sum the impact on this account
      const impact = accountEntries.reduce((sum, e) => sum + e.amount, 0)
      
      currentBalance += impact

      return {
        ...tx,
        impact,
        runningBalance: currentBalance
      }
    })

    // 3. Reverse to show newest first
    return calculated.reverse()
  }, [account, transactions, accountId])

  // Group transactions by Cycle and then by Day
  const groupedData = useMemo(() => {
    if (!account || transactionsWithBalance.length === 0) return []

    const groups: { cycleLabel: string | null, days: { dateStr: string, transactions: typeof transactionsWithBalance }[] }[] = []

    let currentCycleLabel: string | null = null
    let currentCycleDays: { dateStr: string, transactions: typeof transactionsWithBalance }[] = []
    
    let currentDayStr: string | null = null
    let currentDayTx: typeof transactionsWithBalance = []

    const pushDay = () => {
      if (currentDayStr && currentDayTx.length > 0) {
        currentCycleDays.push({ dateStr: currentDayStr, transactions: currentDayTx })
      }
    }

    const pushCycle = () => {
      if (currentCycleDays.length > 0) {
        groups.push({ cycleLabel: currentCycleLabel, days: currentCycleDays })
      }
    }

    transactionsWithBalance.forEach(tx => {
      const d = new Date(tx.date)
      const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      
      let cycleLabel: string | null = null
      if (account.accountType === 'CreditCard' && account.creditCardCycleStartDay) {
        const startDay = account.creditCardCycleStartDay
        let startDate = new Date(d.getFullYear(), d.getMonth(), startDay)
        if (d.getDate() < startDay) {
          startDate.setMonth(startDate.getMonth() - 1)
        }
        const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, startDay - 1)
        
        cycleLabel = `Statement: ${startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric'})} - ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric'})}`
      }

      if (cycleLabel !== currentCycleLabel) {
        pushDay()
        pushCycle()
        currentCycleLabel = cycleLabel
        currentCycleDays = []
        currentDayStr = dateStr
        currentDayTx = [tx]
      } else if (dateStr !== currentDayStr) {
        pushDay()
        currentDayStr = dateStr
        currentDayTx = [tx]
      } else {
        currentDayTx.push(tx)
      }
    })
    
    pushDay()
    pushCycle()

    return groups
  }, [account, transactionsWithBalance])

  if (isLoadingAccounts || isLoadingTx) {
    return <div className="p-4 text-slate-500">Loading account details...</div>
  }

  if (!account) {
    return <div className="p-4 text-rose-500">Account not found.</div>
  }

  const currentBalance = account.currentBalance || 0;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Link to="/accounts" className="p-1.5 -ml-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">{account.name}</h1>
          <button 
            onClick={() => setIsEditingAccount(true)}
            className="p-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors"
            title="Edit Account"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setIsAdjustingBalance(true)}
            className="p-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors"
            title="Adjust Balance"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
        <div className="flex justify-between items-end mt-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            {group?.name || 'Account'}
          </span>
          <div className="text-right">
            <p className="text-[11px] text-slate-400 mb-0.5">Current Balance</p>
            <p className={`text-lg font-bold ${currentBalance >= 0 ? 'text-slate-900 dark:text-slate-50' : 'text-rose-500'}`}>
              ₱{currentBalance.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto">
        {transactionsWithBalance.length === 0 ? (
          <div className="p-8 text-center text-slate-400 italic">No transactions in this account.</div>
        ) : (
          <div className="bg-white dark:bg-slate-900 shadow-sm border-y border-slate-200 dark:border-slate-800">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase text-slate-500 sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur z-10">
              <div className="col-span-6">Details</div>
              <div className="col-span-3 text-right">Amount</div>
              <div className="col-span-3 text-right">Balance</div>
            </div>

            {/* Rows */}
            <div className="pb-8">
              {groupedData.map((cycleGroup, cycleIndex) => (
                <div key={cycleGroup.cycleLabel || `cycle-${cycleIndex}`}>
                  {cycleGroup.cycleLabel && (
                     <div className="bg-indigo-50/80 dark:bg-indigo-900/30 px-4 py-2 border-y border-indigo-100 dark:border-indigo-800/50 flex items-center justify-center my-4 shadow-sm">
                       <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 tracking-widest uppercase">{cycleGroup.cycleLabel}</span>
                     </div>
                  )}
                  {cycleGroup.days.map((dayGroup) => (
                    <div key={dayGroup.dateStr} className="mb-4">
                      <div className="bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur px-4 py-1.5 border-y border-slate-200 dark:border-slate-800 sticky top-[44px] z-0">
                        <h3 className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{dayGroup.dateStr}</h3>
                      </div>
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800/50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                        {dayGroup.transactions.map((tx) => {
                          // Determine the "other" account for display purposes
                          const otherEntries = tx.entries.filter(e => e.accountId !== accountId)
                          const otherAccountName = otherEntries.length === 1 
                            ? getAccountName(otherEntries[0].accountId)
                            : otherEntries.length > 1 
                            ? 'Split'
                            : 'Self'

                          return (
                            <li key={tx.id} className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                              {/* Details */}
                              <div className="col-span-6 flex items-center gap-3 overflow-hidden">
                                <div
                                  className={`shrink-0 p-1.5 rounded-full ${
                                    tx.type === 'Income'
                                      ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                                      : tx.type === 'Expense'
                                      ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
                                      : tx.type === 'Journal'
                                      ? 'bg-purple-100 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400'
                                      : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                                  }`}
                                >
                                  {tx.type === 'Income' && <ArrowUpRight className="w-4 h-4" />}
                                  {tx.type === 'Expense' && <ArrowDownRight className="w-4 h-4" />}
                                  {tx.type === 'Transfer' && <ArrowRightLeft className="w-4 h-4" />}
                                  {tx.type === 'Journal' && <BookOpen className="w-4 h-4" />}
                                </div>
                                <div className="truncate">
                                  <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                                    {tx.vendor ? tx.vendor : tx.type === 'Journal' ? 'Journal Entry' : otherAccountName}
                                  </p>
                                  {tx.note && <p className="text-xs text-slate-600 dark:text-slate-300 italic truncate mt-0.5">{tx.note}</p>}
                                </div>
                              </div>

                              {/* Amount */}
                              <div className={`col-span-3 text-right text-xs font-medium ${tx.impact > 0 ? 'text-emerald-600 dark:text-emerald-400' : tx.impact < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
                                {tx.impact > 0 ? '+' : ''}{tx.impact === 0 ? '0.00' : tx.impact.toFixed(2)}
                              </div>

                              {/* Running Balance */}
                              <div className="col-span-3 flex items-center justify-end gap-2 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">
                                <span>₱{tx.runningBalance.toFixed(2)}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingTx(tx); }}
                                  className="p-1 text-slate-400 hover:text-blue-500 transition-colors cursor-pointer"
                                  aria-label="Edit transaction"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AddTransactionModal 
        isOpen={!!editingTx} 
        onClose={() => setEditingTx(null)} 
        initialData={editingTx} 
      />
      <EditAccountModal
        isOpen={isEditingAccount}
        onClose={() => setIsEditingAccount(false)}
        account={account}
      />
      <AdjustBalanceModal
        isOpen={isAdjustingBalance}
        onClose={() => setIsAdjustingBalance(false)}
        account={account}
      />
    </div>
  )
}
