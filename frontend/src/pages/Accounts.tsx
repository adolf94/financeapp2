import React, { useState } from 'react'
import {
  useGetAccounts,
  useGetAccountGroups,
  useCreateAccount,
  useCreateAccountGroup,
  useDeleteAccount,
  useGenerateAccountDescription,
  Account,
} from '@/hooks/useAccounts'
import { Building2, CreditCard, Landmark, Plus, Trash2, Sparkles } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import ConfirmationModal from '@/components/ui/ConfirmationModal'
import { AccountListSkeleton } from '@/components/ui/Skeleton'

export default function Accounts() {
  const { data: accounts = [], isLoading: isLoadingAccounts } = useGetAccounts()
  const { data: groups = [], isLoading: isLoadingGroups } = useGetAccountGroups()

  const createAccountMutation = useCreateAccount()
  const createGroupMutation = useCreateAccountGroup()
  const deleteAccountMutation = useDeleteAccount()
  const generateDescriptionMutation = useGenerateAccountDescription()

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupType, setNewGroupType] = useState('Asset')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccount, setNewAccount] = useState<Account>({
    name: '',
    description: '',
    accountGroupId: '',
    startingBalance: 0,
    accountType: 'Bank',
    creditCardCycleStartDay: null,
    creditCardPaymentDueDay: null,
    tags: [],
  })
  const [tagsInput, setTagsInput] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string, name: string } | null>(null)

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    createGroupMutation.mutate({ name: newGroupName.trim(), accountType: newGroupType }, {
      onSuccess: () => setNewGroupName(''),
    })
  }

  const handleGenerateDescription = async () => {
    if (!newAccount.name.trim() || !newAccount.accountGroupId) return
    const groupName = groups.find(g => g.id === newAccount.accountGroupId)?.name || ''
    const context = newAccount.description || ""
    
    try {
      const { description, tags } = await generateDescriptionMutation.mutateAsync({
        name: newAccount.name,
        type: newAccount.accountType as string,
        groupName: groupName,
        context: context
      })
      setNewAccount({ ...newAccount, description, tags })
      if (tags && tags.length > 0) {
        setTagsInput(tags.join(', '))
      }
    } catch (e) {
      console.error(e)
      alert("Failed to generate description.")
    }
  }

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAccount.name.trim() || !newAccount.accountGroupId) return
    const finalAccount = { 
        ...newAccount, 
        tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean) 
    }
    createAccountMutation.mutate(finalAccount, {
      onSuccess: () => {
        setShowAddAccount(false)
        setNewAccount({
          name: '',
          description: '',
          accountGroupId: '',
          startingBalance: 0,
          accountType: 'Bank',
          creditCardCycleStartDay: null,
          creditCardPaymentDueDay: null,
          tags: [],
        })
        setTagsInput('')
      },
    })
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'Bank':
        return Landmark
      case 'CreditCard':
        return CreditCard
      case 'Investment':
        return Building2
      default:
        return Landmark
    }
  }

  if (isLoadingAccounts || isLoadingGroups) {
    return (
      <div className="flex flex-col min-h-full bg-slate-50 dark:bg-slate-950">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Accounts</h1>
        </div>
        <AccountListSkeleton count={3} />
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Accounts</h1>
      </div>

      <div className="p-4 flex flex-col gap-6 max-w-md mx-auto w-full">
        {/* Create Account Group */}
        <section className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Add Account Group</h2>
          <form onSubmit={handleCreateGroup} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Food & Dining, Bank Accounts"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="flex-1 min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <select
                value={newGroupType}
                onChange={(e) => setNewGroupType(e.target.value)}
                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="Adjustment">Adjustment</option>
                <option value="Asset">Asset</option>
                <option value="Bank">Bank</option>
                <option value="Cash">Cash</option>
                <option value="CreditCard">Credit Card</option>
                <option value="Equity">Equity</option>
                <option value="Investment">Investment</option>
                <option value="Liability">Liability</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg min-h-[44px] flex items-center justify-center gap-1 font-medium transition-colors"
            >
              <Plus className="w-5 h-5" /> Add Account Group
            </button>
          </form>
        </section>

        {/* Add Account Panel Toggle */}
        {!showAddAccount ? (
          <button
            onClick={() => setShowAddAccount(true)}
            className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-5 h-5" /> Create New Account
          </button>
        ) : (
          <section className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">New Account Details</h2>
              <button onClick={() => setShowAddAccount(false)} className="text-xs text-rose-500 font-medium">Cancel</button>
            </div>
            <form onSubmit={handleCreateAccount} className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Account Name (e.g. Chase checking)"
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                required
                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Description (helps AI classification)</span>
                  <button
                    type="button"
                    onClick={handleGenerateDescription}
                    disabled={generateDescriptionMutation.isPending || !newAccount.name || !newAccount.accountGroupId}
                    className="text-[10px] flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3" />
                    {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Generate'}
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. For daily expenses"
                  value={newAccount.description || ''}
                  onChange={(e) => setNewAccount({ ...newAccount, description: e.target.value })}
                  className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-400">Tags (comma separated)</span>
                <input
                  type="text"
                  placeholder="e.g. food, grab, daily"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                value={newAccount.accountGroupId}
                onChange={(e) => {
                  const groupId = e.target.value
                  const group = groups.find(g => g.id === groupId)
                  setNewAccount({ 
                    ...newAccount, 
                    accountGroupId: groupId,
                    accountType: group ? group.accountType as any : 'Bank'
                  })
                }}
                required
                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="">Select Account Group...</option>
                {Array.from(new Set(groups.filter(g => g.accountType !== 'Expense' && g.accountType !== 'Income').map(g => g.accountType))).sort().map(type => (
                  <optgroup key={type} label={type}>
                    {groups.filter(g => g.accountType === type).sort((a, b) => a.name.localeCompare(b.name)).map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <input
                type="number"
                step="0.01"
                placeholder="Starting Balance"
                value={newAccount.startingBalance || ''}
                onChange={(e) => setNewAccount({ ...newAccount, startingBalance: parseFloat(e.target.value) || 0 })}
                className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />

              {newAccount.accountType === 'CreditCard' && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Billing Cycle Start Day"
                    value={newAccount.creditCardCycleStartDay || ''}
                    onChange={(e) => setNewAccount({ ...newAccount, creditCardCycleStartDay: parseInt(e.target.value) || null })}
                    className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="number"
                    placeholder="Payment Due Day"
                    value={newAccount.creditCardPaymentDueDay || ''}
                    onChange={(e) => setNewAccount({ ...newAccount, creditCardPaymentDueDay: parseInt(e.target.value) || null })}
                    className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}

              <button
                type="submit"
                className="w-full min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Save Account
              </button>
            </form>
          </section>
        )}

        {/* Display Accounts grouped by AccountGroups */}
        {groups.filter(g => g.accountType !== 'Expense' && g.accountType !== 'Income').sort((a, b) => a.name.localeCompare(b.name)).map((group) => {
          const groupAccounts = accounts.filter((a) => a.accountGroupId === group.id).sort((a, b) => a.name.localeCompare(b.name))
          return (
            <div key={group.id} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{group.name}</h3>
              <div className="flex flex-col gap-2">
                {groupAccounts.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No accounts in this group.</p>
                ) : (
                  groupAccounts.map((acc) => {
                    const Icon = getIcon(acc.accountType)
                    return (
                      <div
                        key={acc.id}
                        className="bg-white dark:bg-slate-900 p-3 px-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between min-h-[64px] hover:border-blue-500 dark:hover:border-blue-500 transition-colors group relative overflow-hidden"
                      >
                        <Link 
                          to="/accounts/$accountId" 
                          params={{ accountId: acc.id! }} 
                          className="absolute inset-0 z-0"
                          aria-label={`View details for ${acc.name}`}
                        />
                        <div className="flex items-center gap-3 relative z-10 pointer-events-none">
                          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-blue-600 dark:text-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 transition-colors">
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-base font-semibold text-slate-900 dark:text-slate-50 leading-tight">
                              {acc.name}
                            </p>
                            {acc.description && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[200px]">
                                {acc.description}
                              </p>
                            )}
                            {acc.tags && acc.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {acc.tags.map((tag, i) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-medium leading-none">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 relative z-10">
                          <span
                            className={`text-base font-bold ${
                              (acc.currentBalance ?? 0) < 0 ? 'text-rose-500' : 'text-slate-900 dark:text-slate-50'
                            }`}
                          >
                            ₱{(acc.currentBalance ?? acc.startingBalance).toFixed(2)}
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setDeleteCandidate({ id: acc.id!, name: acc.name });
                            }}
                            className="p-2 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                            aria-label={`Delete ${acc.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmationModal
        isOpen={!!deleteCandidate}
        title="Delete Account"
        message={`Are you sure you want to delete the account "${deleteCandidate?.name}"? All transaction logs associated with this account may be impacted.`}
        onConfirm={() => {
          if (deleteCandidate) {
            deleteAccountMutation.mutate(deleteCandidate.id)
            setDeleteCandidate(null)
          }
        }}
        onCancel={() => setDeleteCandidate(null)}
      />
    </div>
  )
}
