import React, { useState } from 'react'
import { Plus, Trash2, Tag, Store, Bell, X, Edit, History, Sparkles, BookOpen } from 'lucide-react'
import dayjs from 'dayjs'
import ConfirmationModal from '@/components/ui/ConfirmationModal'
import AddTransactionModal from '@/components/AddTransactionModal'
import { Transaction } from '@/hooks/useTransactions'
import { useGetPendingIngestions, useRejectIngestion, PendingIngestion } from '@/hooks/useIngestions'
import HistoricalHooksList from '@/components/HistoricalHooksList'
import {
  useGetAccountGroups,
  useCreateAccountGroup,
  useDeleteAccountGroup,
  useGetAccounts,
  useCreateAccount,
  useDeleteAccount,
  useGenerateAccountDescription,
} from '@/hooks/useAccounts'
import {
  useGetVendors,
  useCreateVendor,
  useDeleteVendor,
} from '@/hooks/useVendors'

import { useGetRunbookCorrections, useGetRunbookSession } from '@/hooks/useRunbookReview'
import { RunbookReviewModal } from '@/components/RunbookReviewModal'
import { useQuery } from '@tanstack/react-query'
import ingesterClient from '@/lib/ingesterClient'

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'categories' | 'vendors' | 'notifications' | 'historicalLogs' | 'runbook'>('categories')

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Settings</h1>
        <p className="text-slate-500 mt-1 text-sm">Manage your configuration, categories, and logs</p>
      </div>

      <div className="flex px-4 pt-4 gap-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('categories')}
          className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${
            activeTab === 'categories'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4" /> Categories
          </div>
        </button>
        <button
          onClick={() => setActiveTab('vendors')}
          className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${
            activeTab === 'vendors'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4" /> Vendors
          </div>
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${
            activeTab === 'notifications'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4" /> Notification Log
          </div>
        </button>
        <button
          onClick={() => setActiveTab('historicalLogs')}
          className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${
            activeTab === 'historicalLogs'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4" /> Historical Logs
          </div>
        </button>
        <button
          onClick={() => setActiveTab('runbook')}
          className={`pb-3 px-4 font-semibold text-sm whitespace-nowrap transition-colors border-b-2 ${
            activeTab === 'runbook'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Runbook Review
          </div>
        </button>
      </div>

      <div className="p-4 overflow-y-auto">
        {activeTab === 'categories' && <CategoriesSettings />}
        {activeTab === 'vendors' && <VendorsSettings />}
        {activeTab === 'notifications' && <NotificationLogSettings />}
        {activeTab === 'historicalLogs' && <HistoricalLogsSettings />}
        {activeTab === 'runbook' && <RunbookReviewSettings />}
      </div>
    </div>
  )
}

function CategoriesSettings() {
  const { data: groups = [] } = useGetAccountGroups()
  const { data: accounts = [] } = useGetAccounts()
  
  const createGroup = useCreateAccountGroup()
  const deleteGroup = useDeleteAccountGroup()
  const createAccount = useCreateAccount()
  const deleteAccount = useDeleteAccount()
  const generateDescriptionMutation = useGenerateAccountDescription()

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupType, setNewGroupType] = useState<'Expense' | 'Income'>('Expense')
  const [newAccountNames, setNewAccountNames] = useState<Record<string, string>>({})
  const [newAccountDescriptions, setNewAccountDescriptions] = useState<Record<string, string>>({})
  const [deleteGroupCandidate, setDeleteGroupCandidate] = useState<{ id: string, name: string } | null>(null)
  const [deleteAccountCandidate, setDeleteAccountCandidate] = useState<{ id: string, name: string } | null>(null)

  const categoryGroups = groups.filter((g) => g.accountType === 'Expense' || g.accountType === 'Income')

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    createGroup.mutate(
      { name: newGroupName.trim(), accountType: newGroupType },
      { onSuccess: () => setNewGroupName('') }
    )
  }

  const handleCreateSubCategory = (e: React.FormEvent, groupId: string, type: string) =>
  {
    e.preventDefault()
    const name = newAccountNames[groupId]?.trim()
    const description = newAccountDescriptions[groupId]?.trim() || ''
    if (!name) return
    createAccount.mutate(
      { name, description, accountGroupId: groupId, accountType: type as any, startingBalance: 0 },
      { onSuccess: () => {
          setNewAccountNames((prev) => ({ ...prev, [groupId]: '' }))
          setNewAccountDescriptions((prev) => ({ ...prev, [groupId]: '' }))
        }
      }
    )
  }

  const handleGenerateDescription = async (groupId: string, groupName: string, type: string) => {
    const name = newAccountNames[groupId]?.trim()
    if (!name) return
    const context = newAccountDescriptions[groupId] || ""
    
    try {
      const { description } = await generateDescriptionMutation.mutateAsync({
        name,
        type,
        groupName,
        context
      })
      setNewAccountDescriptions(prev => ({ ...prev, [groupId]: description }))
    } catch (e) {
      console.error(e)
      alert("Failed to generate description.")
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full pb-8">
      <section className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Add Category</h2>
        <form onSubmit={handleCreateGroup} className="flex gap-2">
          <input
            type="text"
            placeholder="Category Name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="flex-1 min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
          <select
            value={newGroupType}
            onChange={(e) => setNewGroupType(e.target.value as any)}
            className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="Expense">Expense</option>
            <option value="Income">Income</option>
          </select>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 flex items-center justify-center transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>
        </form>
      </section>

      <div className="flex flex-col gap-4">
        {categoryGroups.map((group) => {
          const groupAccounts = accounts.filter((a) => a.accountGroupId === group.id)
          const isExpense = group.accountType === 'Expense'

          return (
            <div key={group.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 p-3 px-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                    isExpense ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  }`}>
                    {group.accountType}
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-50">{group.name}</span>
                </div>
                <button
                  onClick={() => setDeleteGroupCandidate({ id: group.id, name: group.name })}
                  className="text-slate-400 hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="p-2 flex flex-col">
                {groupAccounts.map((acc) => (
                  <div key={acc.id} className="flex justify-between items-center p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg group">
                    <span className="text-slate-700 dark:text-slate-300 text-sm">{acc.name}</span>
                    <button
                      onClick={() => setDeleteAccountCandidate({ id: acc.id!, name: acc.name })}
                      className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                <form onSubmit={(e) => handleCreateSubCategory(e, group.id, group.accountType!)} className="flex flex-col gap-2 mt-2 p-2 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
                  <div className="flex items-center">
                    <input
                      type="text"
                      placeholder="Add sub-category..."
                      value={newAccountNames[group.id] || ''}
                      onChange={(e) => setNewAccountNames((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      className="flex-1 text-sm bg-transparent border-none outline-none text-slate-700 dark:text-slate-300 placeholder:text-slate-400 min-h-[32px]"
                    />
                    <button type="submit" className="text-blue-600 hover:text-blue-700 p-1" disabled={!newAccountNames[group.id]?.trim()}>
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  {newAccountNames[group.id]?.trim() && (
                    <div className="flex flex-col gap-1 border-t border-slate-200 dark:border-slate-700 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">Description (helps AI classification)</span>
                        <button
                          type="button"
                          onClick={() => handleGenerateDescription(group.id, group.name, group.accountType!)}
                          disabled={generateDescriptionMutation.isPending}
                          className="text-[10px] flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                        >
                          <Sparkles className="w-3 h-3" />
                          {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Generate'}
                        </button>
                      </div>
                      <input
                        type="text"
                        placeholder="e.g. For daily expenses"
                        value={newAccountDescriptions[group.id] || ''}
                        onChange={(e) => setNewAccountDescriptions((prev) => ({ ...prev, [group.id]: e.target.value }))}
                        className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-slate-700 dark:text-slate-300 placeholder:text-slate-400"
                      />
                    </div>
                  )}
                </form>
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmationModal
        isOpen={!!deleteGroupCandidate}
        title="Delete Category Group"
        message={`Are you sure you want to delete the category group "${deleteGroupCandidate?.name}"? All sub-categories under it will also be deleted.`}
        onConfirm={() => {
          if (deleteGroupCandidate) {
            deleteGroup.mutate(deleteGroupCandidate.id)
            setDeleteGroupCandidate(null)
          }
        }}
        onCancel={() => setDeleteGroupCandidate(null)}
      />

      <ConfirmationModal
        isOpen={!!deleteAccountCandidate}
        title="Delete Sub-category"
        message={`Are you sure you want to delete the sub-category "${deleteAccountCandidate?.name}"?`}
        onConfirm={() => {
          if (deleteAccountCandidate) {
            deleteAccount.mutate(deleteAccountCandidate.id)
            setDeleteAccountCandidate(null)
          }
        }}
        onCancel={() => setDeleteAccountCandidate(null)}
      />
    </div>
  )
}

function VendorsSettings() {
  const { data: vendors = [] } = useGetVendors()
  const createVendor = useCreateVendor()
  const deleteVendor = useDeleteVendor()

  const [newVendorName, setNewVendorName] = useState('')
  const [newVendorType, setNewVendorType] = useState<'Individual' | 'Business'>('Business')
  const [newVendorTags, setNewVendorTags] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string, name: string } | null>(null)

  const handleCreateVendor = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newVendorName.trim()) return
    const tags = newVendorTags ? newVendorTags.split(',').map(t => t.trim()).filter(Boolean) : []
    createVendor.mutate(
      { name: newVendorName.trim(), type: newVendorType, tags },
      { onSuccess: () => {
          setNewVendorName('')
          setNewVendorTags('')
          setNewVendorType('Business')
        }
      }
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full pb-8">
      <section className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Add Vendor</h2>
        <form onSubmit={handleCreateVendor} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Vendor Name"
              value={newVendorName}
              onChange={(e) => setNewVendorName(e.target.value)}
              className="flex-1 min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <select
              value={newVendorType}
              onChange={(e) => setNewVendorType(e.target.value as any)}
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="Business">Business</option>
              <option value="Individual">Individual</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Tags (comma separated)"
              value={newVendorTags}
              onChange={(e) => setNewVendorTags(e.target.value)}
              className="flex-1 min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 flex items-center justify-center transition-colors shrink-0"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </form>
      </section>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="flex justify-between items-center p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 group">
              <div className="flex flex-col">
                <span className="font-medium text-slate-900 dark:text-slate-50">{vendor.name}</span>
                <span className="text-xs text-slate-500">{vendor.type} {vendor.tags?.length ? `• ${vendor.tags.join(', ')}` : ''}</span>
              </div>
              <button
                onClick={() => setDeleteCandidate({ id: vendor.id!, name: vendor.name })}
                className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {vendors.length === 0 && (
            <div className="p-8 text-center text-slate-500">No vendors found.</div>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!deleteCandidate}
        title="Delete Vendor"
        message={`Are you sure you want to delete the vendor "${deleteCandidate?.name}"?`}
        onConfirm={() => {
          if (deleteCandidate) {
            deleteVendor.mutate(deleteCandidate.id)
            setDeleteCandidate(null)
          }
        }}
        onCancel={() => setDeleteCandidate(null)}
      />
    </div>
  )
}

function NotificationLogSettings() {
  const { data: ingestions = [], isLoading } = useGetPendingIngestions('NonFinancial')
  const rejectMutation = useRejectIngestion()
  const [confirmingIngestion, setConfirmingIngestion] = useState<PendingIngestion | null>(null)
  const [processingIds, setProcessingIds] = useState<string[]>([])

  const handleDismiss = (id: string) => {
    if (confirm('Are you sure you want to dismiss this notification log?')) {
      setProcessingIds(prev => [...prev, id])
      rejectMutation.mutate(id, {
        onSettled: () => {
          setProcessingIds(prev => prev.filter(x => x !== id))
        }
      })
    }
  }

  const mappedIngestionTransaction = confirmingIngestion ? {
    type: confirmingIngestion.ai_parsed.transaction_type === 'Income' ? 'Income' : 'Expense',
    vendor: confirmingIngestion.ai_parsed.vendor || '',
    note: confirmingIngestion.ai_parsed.summary || confirmingIngestion.ai_parsed.notes || '',
    date: confirmingIngestion.received_at,
    entries: [
      {
        accountId: confirmingIngestion.ai_parsed.debit_account_id || '',
        amount: confirmingIngestion.ai_parsed.amount || 0
      },
      {
        accountId: confirmingIngestion.ai_parsed.credit_account_id || '',
        amount: -(confirmingIngestion.ai_parsed.amount || 0)
      }
    ]
  } as Transaction : null

  if (isLoading) {
    return (
      <div className="text-center py-8 text-slate-500 flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        Loading notification logs...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full pb-8">
      <div className="flex flex-col gap-3">
        {ingestions.map((ingestion) => (
          <div
            key={ingestion.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-sm relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-slate-300 dark:bg-slate-700" />
            <div className="flex justify-between items-start gap-4">
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">
                    {dayjs(ingestion.received_at).format('MMM DD, YYYY • h:mm A')}
                  </span>
                  {ingestion.ai_parsed.application && (
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-350 px-1.5 py-0.5 rounded font-medium">
                      {ingestion.ai_parsed.application}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-1">
                  "{ingestion.raw_msg}"
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end border-t border-slate-100 dark:border-slate-800/80 pt-3">
              <button
                onClick={() => handleDismiss(ingestion.id)}
                disabled={processingIds.includes(ingestion.id)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20 dark:hover:text-rose-400 transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" /> Dismiss
              </button>
              <button
                onClick={() => setConfirmingIngestion(ingestion)}
                disabled={processingIds.includes(ingestion.id)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer shadow-sm disabled:opacity-50"
              >
                <Edit className="w-3.5 h-3.5" /> Convert to Transaction
              </button>
            </div>
          </div>
        ))}

        {ingestions.length === 0 && (
          <div className="p-8 text-center text-slate-500 italic">No non-financial notifications found.</div>
        )}
      </div>

      <AddTransactionModal
        isOpen={!!confirmingIngestion}
        onClose={() => setConfirmingIngestion(null)}
        initialData={mappedIngestionTransaction}
        ingestionId={confirmingIngestion?.id}
      />
    </div>
  )
}

function HistoricalLogsSettings() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full pb-8">
      <HistoricalHooksList />
    </div>
  )
}

function RunbookReviewSettings() {
  const { data: corrections = [], isLoading } = useGetRunbookCorrections()
  const { data: session } = useGetRunbookSession()
  const hasActiveSession = !!session
  const { data: runbookRes } = useQuery({
    queryKey: ['runbook_content'],
    queryFn: async () => {
      const res = await ingesterClient.get('/runbook')
      return res.data
    }
  })
  const currentRunbook = runbookRes?.content || ""

  const [isModalOpen, setIsModalOpen] = useState(false)

  if (isLoading) return <div className="p-8 text-center text-slate-500">Loading pending corrections...</div>

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full pb-8">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              Pending Runbook Corrections
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Review and apply AI-suggested updates to your Runbook based on recent corrections.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsModalOpen(true)}
              className="relative flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors shadow-sm"
            >
              {hasActiveSession && (
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" title="Active session" />
              )}
              {hasActiveSession ? 'Resume Session' : corrections.length > 0 ? 'Review Changes' : 'Start Ad-hoc Chat'}
            </button>
          </div>
        </div>

        {corrections.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
            No pending corrections to review.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {corrections.map(c => (
              <div key={c.id} className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{c.user_confirmed?.vendor || c.ai_parsed?.vendor || 'Unknown Vendor'}</div>
                  <div className="text-xs text-slate-500">{dayjs(c.received_at).format('MMM D, YYYY h:mm A')}</div>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                  <span className="font-semibold">Original AI:</span> {c.ai_parsed?.transaction_type} • {c.ai_parsed?.category}
                </div>
                <div className="text-sm text-indigo-600 dark:text-indigo-400 mb-2 font-medium">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Your Correction:</span> {c.user_confirmed?.transaction_type} • {c.user_confirmed?.category}
                </div>
                <div className="text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 p-2 rounded flex gap-2">
                  <span className="font-semibold">Reason:</span> {c.user_confirmed?.user_why || 'No reason provided'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <RunbookReviewModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        corrections={corrections}
        currentRunbook={currentRunbook}
      />
    </div>
  )
}

