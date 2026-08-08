import { Sparkles } from 'lucide-react'
import TagInput from '../ui/TagInput'
import { useAddTransaction } from './AddTransactionContext'
import { useCreateAccount, useGetAccountGroups, useGenerateAccountDescription } from '@/hooks/useAccounts'

export default function InlineAccountCreateForm() {
  const { pendingNewAccount, setPendingNewAccount, setSplits } = useAddTransaction()
  const { data: accountGroups = [] } = useGetAccountGroups()
  
  const createAccountMutation = useCreateAccount()
  const generateDescriptionMutation = useGenerateAccountDescription()

  if (!pendingNewAccount) return null

  const handleGeneratePendingAccountDescription = async () => {
    const groupName = accountGroups.find((g) => g.id === pendingNewAccount.categoryId)?.name || ''

    try {
      const { description, tags } = await generateDescriptionMutation.mutateAsync({
        name: pendingNewAccount.name,
        type: pendingNewAccount.type,
        groupName,
        context: pendingNewAccount.description,
      })
      setPendingNewAccount({ ...pendingNewAccount, description, tags: tags || [] })
    } catch (e) {
      console.error(e)
    }
  }

  const handleSavePendingAccount = () => {
    createAccountMutation.mutate(
      {
        name: pendingNewAccount.name,
        description: pendingNewAccount.description,
        tags: pendingNewAccount.tags || [],
        accountGroupId: pendingNewAccount.categoryId,
        accountType: pendingNewAccount.type as any,
        startingBalance: 0,
      },
      {
        onSuccess: (data) => {
          if (data && data.id) {
            setSplits((prev) =>
              prev.map((s) =>
                s.id === pendingNewAccount.splitId ? { ...s, subCategoryId: data.id } : s
              )
            )
          }
          setPendingNewAccount(null)
        },
      }
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={() => setPendingNewAccount(null)}
      />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4 border border-slate-200 dark:border-slate-800 animate-slide-up">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">
          New Account Details
        </h3>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Account Name
            </label>
            <input
              type="text"
              value={pendingNewAccount.name}
              onChange={(e) =>
                setPendingNewAccount({ ...pendingNewAccount, name: e.target.value })
              }
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Description
              </label>
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
              onChange={(e) =>
                setPendingNewAccount({
                  ...pendingNewAccount,
                  description: e.target.value,
                })
              }
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-full"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Tags
              </label>
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
              onChange={(newTags) =>
                setPendingNewAccount({ ...pendingNewAccount, tags: newTags })
              }
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
  )
}
