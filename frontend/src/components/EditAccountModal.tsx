import React, { useState, useEffect } from 'react'
import { Account, useUpdateAccount, useGetAccountGroups, useGenerateAccountDescription } from '@/hooks/useAccounts'
import { X, Sparkles } from 'lucide-react'
import TagInput from '@/components/ui/TagInput'

interface EditAccountModalProps {
  isOpen: boolean
  onClose: () => void
  account: Account | null
}

export default function EditAccountModal({ isOpen, onClose, account }: EditAccountModalProps) {
  const { data: groups = [] } = useGetAccountGroups()
  const updateMutation = useUpdateAccount()
  const generateDescriptionMutation = useGenerateAccountDescription()
  
  const [formData, setFormData] = useState<Account | null>(null)

  const handleGenerateDescription = async () => {
    if (!formData) return
    const groupName = groups.find(g => g.id === formData.accountGroupId)?.name || ''
    const context = formData.description || ""
    
    try {
      const res = await generateDescriptionMutation.mutateAsync({
        name: formData.name,
        type: formData.accountType,
        groupName: groupName,
        context: context
      })
      setFormData({ ...formData, description: res.description, tags: res.tags })
    } catch (e) {
      console.error(e)
      alert("Failed to generate description.")
    }
  }

  useEffect(() => {
    if (isOpen && account) {
      setFormData({ ...account })
    }
  }, [isOpen, account])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData || !formData.id) return
    updateMutation.mutate(formData, {
      onSuccess: () => {
        onClose()
      }
    })
  }

  if (!isOpen || !formData) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 transition-opacity duration-300" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 w-full md:max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-2xl z-55 shadow-2xl p-4 flex flex-col gap-4 border-t border-slate-200 dark:border-slate-800 animate-slide-up pb-safe max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Edit Account</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Account Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Description (optional)</label>
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={generateDescriptionMutation.isPending || !formData.name || !formData.accountGroupId}
                className="text-[10px] flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Generate'}
              </button>
            </div>
            <input
              type="text"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tags</label>
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={generateDescriptionMutation.isPending || !formData.name || !formData.accountGroupId}
                className="text-[10px] flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Generate'}
              </button>
            </div>
            <TagInput
              tags={formData.tags || []}
              onChange={(newTags) => setFormData({ ...formData, tags: newTags })}
              placeholder="Type tag and press Enter"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Account Group</label>
            <select
              value={formData.accountGroupId}
              onChange={(e) => {
                const groupId = e.target.value
                const group = groups.find(g => g.id === groupId)
                setFormData({ 
                  ...formData, 
                  accountGroupId: groupId,
                  accountType: group ? group.accountType as any : 'Bank'
                })
              }}
              required
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              {Array.from(new Set(groups.filter(g => g.accountType !== 'Expense' && g.accountType !== 'Income').map(g => g.accountType))).sort().map(type => (
                <optgroup key={type} label={type}>
                  {groups.filter(g => g.accountType === type).sort((a, b) => a.name.localeCompare(b.name)).map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Starting Balance</label>
            <input
              type="number"
              step="0.01"
              value={formData.startingBalance || ''}
              onChange={(e) => setFormData({ ...formData, startingBalance: parseFloat(e.target.value) || 0 })}
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          {formData.accountType === 'CreditCard' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cycle Start</label>
                <input
                  type="number"
                  value={formData.creditCardCycleStartDay || ''}
                  onChange={(e) => setFormData({ ...formData, creditCardCycleStartDay: parseInt(e.target.value) || null })}
                  className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment Due</label>
                <input
                  type="number"
                  value={formData.creditCardPaymentDueDay || ''}
                  onChange={(e) => setFormData({ ...formData, creditCardPaymentDueDay: parseInt(e.target.value) || null })}
                  className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full min-h-[48px] mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors cursor-pointer text-lg shadow-sm"
          >
            Save Changes
          </button>
        </form>
      </div>
    </>
  )
}
