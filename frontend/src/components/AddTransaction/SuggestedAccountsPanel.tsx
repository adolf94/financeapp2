import { useState } from 'react'
import { Plus, Edit, X, Check, Sparkles } from 'lucide-react'
import TagInput from '../ui/TagInput'
import { useAddTransaction } from './AddTransactionContext'
import { useGetAccountGroups, useGetAccounts, useCreateAccountGroup, useCreateAccount } from '@/hooks/useAccounts'
import { uuidv7 } from 'uuidv7'

export default function SuggestedAccountsPanel() {
  const {
    ingestion,
    ingestionId,
    splits,
    setSplits,
    sourceAccountId,
    setSourceAccountId,
    toAccountId,
    createdSuggestions,
    setCreatedSuggestions,
    editingSuggestion,
    setEditingSuggestion,
  } = useAddTransaction()

  const { data: accounts = [] } = useGetAccounts()
  const { data: accountGroups = [] } = useGetAccountGroups()
  const createAccountGroupMutation = useCreateAccountGroup()
  const createAccountMutation = useCreateAccount()

  const [isCreatingAccount, setIsCreatingAccount] = useState(false)

  if (
    !ingestion?.ai_parsed?.suggested_account_creation ||
    !ingestionId ||
    ingestion.ai_parsed.suggested_account_creation.length === 0
  ) {
    return null
  }

  const handleCreateSuggestedAccount = async (
    data: { type: string; account_group: string; name: string; description?: string; tags?: string[] },
    idx?: number
  ) => {
    setIsCreatingAccount(true)
    try {
      let targetGroupId = accountGroups.find(
        (g) => g.name === data.account_group && g.accountType === data.type
      )?.id

      if (!targetGroupId) {
        const newGroup = await createAccountGroupMutation.mutateAsync({
          name: data.account_group,
          accountType: data.type,
        })
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
          setSplits([
            {
              id: splits[0]?.id || uuidv7(),
              categoryId: targetGroupId || '',
              subCategoryId: newAccount.id,
              amount: splits[0]?.amount || '',
            },
          ])
        } else {
          setSourceAccountId(newAccount.id)
        }
      }

      if (idx !== undefined) {
        setCreatedSuggestions((prev) => new Set(prev).add(idx))
      }
      setEditingSuggestion(null)
    } catch (err) {
      console.error('Failed to create suggested account', err)
    } finally {
      setIsCreatingAccount(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      {ingestion.ai_parsed.suggested_account_creation.map((suggestion, idx) => {
        const isEditing = editingSuggestion?.idx === idx
        const targetGroup = accountGroups.find(
          (g) => g.name.toLowerCase() === suggestion.account_group.toLowerCase()
        )
        const isCreated =
          createdSuggestions.has(idx) ||
          (targetGroup &&
            accounts.some(
              (a) =>
                a.name.toLowerCase() === suggestion.name.toLowerCase() &&
                a.accountGroupId === targetGroup.id
            ))
        const existingAccount = accounts.find(
          (a) =>
            a.name.toLowerCase() === suggestion.name.toLowerCase() &&
            targetGroup &&
            a.accountGroupId === targetGroup.id
        )
        const isSelected =
          existingAccount &&
          ((suggestion.type === 'Expense' || suggestion.type === 'Income')
            ? splits.some((s) => s.subCategoryId === existingAccount.id)
            : sourceAccountId === existingAccount.id || toAccountId === existingAccount.id)

        return (
          <div
            key={`${ingestion.id}-suggested-acc-${idx}`}
            className="flex flex-col gap-2 p-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/60 rounded-xl shadow-sm"
          >
            <div className="flex flex-col gap-1.5">
              <span className="text-blue-600 dark:text-blue-400 uppercase tracking-wider font-bold text-[9px] flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2} /> Suggested Account
              </span>
              {isEditing ? (
                <div className="flex flex-col gap-1.5 mt-0.5">
                  <input
                    value={editingSuggestion.data.name}
                    onChange={(e) =>
                      setEditingSuggestion({
                        ...editingSuggestion,
                        data: { ...editingSuggestion.data, name: e.target.value },
                      })
                    }
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                    placeholder="Account Name"
                    aria-label="Account Name"
                  />
                  <div className="relative">
                    <input
                      value={editingSuggestion.data.account_group}
                      onChange={(e) =>
                        setEditingSuggestion({
                          ...editingSuggestion,
                          data: { ...editingSuggestion.data, account_group: e.target.value },
                        })
                      }
                      className={`w-full text-xs px-2 py-1 rounded border bg-white dark:bg-slate-950 text-slate-900 dark:text-white pr-8 ${
                        accountGroups.some(
                          (g) =>
                            g.name.toLowerCase() ===
                            editingSuggestion.data.account_group.toLowerCase()
                        )
                          ? 'border-green-400 dark:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-500'
                          : 'border-blue-200 dark:border-blue-800'
                      }`}
                      placeholder="Account Group"
                      aria-label="Account Group"
                    />
                    {accountGroups.some(
                      (g) =>
                        g.name.toLowerCase() ===
                        editingSuggestion.data.account_group.toLowerCase()
                    ) && (
                      <div
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400 font-bold"
                        title="Group exists"
                      >
                        <Check className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <select
                    value={editingSuggestion.data.type}
                    onChange={(e) =>
                      setEditingSuggestion({
                        ...editingSuggestion,
                        data: { ...editingSuggestion.data, type: e.target.value },
                      })
                    }
                    className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                    aria-label="Account Type"
                  >
                    {[
                      'Adjustment',
                      'Asset',
                      'Bank',
                      'Cash',
                      'CreditCard',
                      'Equity',
                      'Expense',
                      'Income',
                      'Investment',
                      'Liability',
                    ].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <TagInput
                    tags={editingSuggestion.data.tags || []}
                    onChange={(newTags) =>
                      setEditingSuggestion({
                        ...editingSuggestion,
                        data: { ...editingSuggestion.data, tags: newTags },
                      })
                    }
                    placeholder="Type tag and press Enter"
                  />
                </div>
              ) : (
                <span className="text-slate-800 dark:text-slate-200 font-bold text-xs">
                  <span className="text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                    {suggestion.type}
                  </span>{' '}
                  &bull; {suggestion.account_group} - {suggestion.name}
                </span>
              )}
            </div>
            <div className="flex gap-2 mt-1">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleCreateSuggestedAccount(editingSuggestion.data, idx)}
                    disabled={
                      isCreatingAccount ||
                      !editingSuggestion.data.name ||
                      !editingSuggestion.data.account_group
                    }
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-50 shadow-sm"
                  >
                    {isCreatingAccount ? (
                      <>
                        <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" strokeWidth={2} /> Save
                      </>
                    )}
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
                          setSplits([
                            {
                              id: splits[0]?.id || uuidv7(),
                              categoryId: existingAccount.accountGroupId,
                              subCategoryId: existingAccount.id || '',
                              amount: splits[0]?.amount || '',
                            },
                          ])
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
                    {isCreatingAccount ? (
                      <>
                        <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" strokeWidth={2} /> Create
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSuggestion({
                        idx,
                        data: {
                          name: suggestion.name,
                          account_group: suggestion.account_group,
                          type: suggestion.type,
                          description: (suggestion as any).description || '',
                          tags: (suggestion as any).tags || [],
                        },
                      })
                    }
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
  )
}
