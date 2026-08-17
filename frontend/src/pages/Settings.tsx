import React, { useState, useMemo } from 'react'
import {
  Plus,
  Trash2,
  Tag,
  Store,
  Bell,
  X,
  Edit,
  History,
  Sparkles,
  BookOpen,
  SunMoon,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  ChevronUp,
  Search,
  Layers,
  Check
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import dayjs from 'dayjs'
import ConfirmationModal from '@/components/ui/ConfirmationModal'
import AddTransactionModal from '@/components/AddTransactionModal'
import { Transaction } from '@/hooks/useTransactions'
import { useGetPendingIngestions, useRejectIngestion, PendingIngestion } from '@/hooks/useIngestions'
import HistoricalHooksList from '@/components/HistoricalHooksList'
import TagInput from '@/components/ui/TagInput'
import EditAccountModal from '@/components/EditAccountModal'
import {
  useGetAccountGroups,
  useCreateAccountGroup,
  useDeleteAccountGroup,
  useGetAccounts,
  useCreateAccount,
  useDeleteAccount,
  useGenerateAccountDescription,
  Account,
} from '@/hooks/useAccounts'
import {
  useGetVendors,
  useCreateVendor,
  useDeleteVendor,
  Vendor,
} from '@/hooks/useVendors'
import EditVendorModal from '@/components/EditVendorModal'

import { useGetRunbookCorrections, useGetRunbookSession } from '@/hooks/useRunbookReview'
import { RunbookReviewModal } from '@/components/RunbookReviewModal'
import { useQuery } from '@tanstack/react-query'
import ingesterClient from '@/lib/ingesterClient'
import { TableListSkeleton } from '@/components/ui/Skeleton'

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'general' | 'categories' | 'vendors' | 'notifications' | 'historicalLogs' | 'runbook'>('general')

  // Badges for tabs
  const { data: nonFinancial = [] } = useGetPendingIngestions('NonFinancial')
  const { data: runbookSession } = useGetRunbookSession()
  const { data: appCorrections = [] } = useGetRunbookCorrections('app')
  const { data: smsCorrections = [] } = useGetRunbookCorrections('sms')
  const { data: emailCorrections = [] } = useGetRunbookCorrections('email')
  const { data: imageCorrections = [] } = useGetRunbookCorrections('image')
  const totalCorrections = appCorrections.length + smsCorrections.length + emailCorrections.length + imageCorrections.length

  const tabs = [
    { id: 'general', label: 'General', icon: SunMoon, badge: null },
    { id: 'categories', label: 'Categories', icon: Tag, badge: null },
    { id: 'vendors', label: 'Vendors', icon: Store, badge: null },
    { id: 'notifications', label: 'Notification Log', icon: Bell, badge: nonFinancial.length > 0 ? nonFinancial.length : null },
    { id: 'historicalLogs', label: 'Historical Logs', icon: History, badge: null },
    { id: 'runbook', label: 'Runbook Review', icon: BookOpen, badge: runbookSession ? 'Active' : (totalCorrections > 0 ? totalCorrections : null) },
  ] as const

  return (
    <div className="flex flex-col min-h-full bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-20">
        <div className="px-4 sm:px-6 pt-5 pb-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Settings</h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Manage your visual preferences, categories, vendors, and AI classification rules.
          </p>
        </div>

        {/* Tab Navigation Bar */}
        <div className="flex px-4 sm:px-6 gap-1.5 overflow-x-auto no-scrollbar scroll-smooth">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`relative flex items-center gap-2 py-2.5 px-3 sm:px-4 text-xs sm:text-sm font-semibold rounded-t-lg transition-all duration-150 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 border-b-2 border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 transition-transform ${isActive ? 'scale-110' : ''}`} />
                <span>{tab.label}</span>
                {tab.badge !== null && (
                  <span
                    className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-full font-bold leading-tight ${
                      tab.badge === 'Active'
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 animate-pulse'
                        : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full">
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'categories' && <CategoriesSettings />}
        {activeTab === 'vendors' && <VendorsSettings />}
        {activeTab === 'notifications' && <NotificationLogSettings />}
        {activeTab === 'historicalLogs' && <HistoricalLogsSettings />}
        {activeTab === 'runbook' && <RunbookReviewSettings />}
      </div>
    </div>
  )
}

function GeneralSettings() {
  const { theme, setTheme } = useTheme()

  const themeOptions = [
    {
      id: 'light',
      label: 'Light Mode',
      desc: 'High-contrast, crisp day styling',
      icon: Sun,
      colorClass: 'text-amber-500 bg-amber-50 dark:bg-amber-950/30'
    },
    {
      id: 'dark',
      label: 'Dark Mode',
      desc: 'OLED-optimized, easy on the eyes',
      icon: Moon,
      colorClass: 'text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
    },
    {
      id: 'system',
      label: 'System Theme',
      desc: 'Automatically synchronizes with OS',
      icon: Monitor,
      colorClass: 'text-slate-500 bg-slate-100 dark:bg-slate-800'
    }
  ] as const

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-7 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <SunMoon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50">
              Appearance Preferences
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Choose your preferred visual theme across all devices.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-6">
          {themeOptions.map((opt) => {
            const Icon = opt.icon
            const isSelected = theme === opt.id

            return (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
                className={`relative flex flex-col items-start p-4.5 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                  isSelected
                    ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/50 hover:bg-slate-50/80 dark:hover:bg-slate-850/50'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <div className={`p-2.5 rounded-xl ${opt.colorClass}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </div>
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  {opt.label}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  {opt.desc}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CategoriesSettings() {
  const { data: groups = [], isLoading: isLoadingGroups } = useGetAccountGroups()
  const { data: accounts = [], isLoading: isLoadingAccounts } = useGetAccounts()

  const createGroup = useCreateAccountGroup()
  const deleteGroup = useDeleteAccountGroup()
  const createAccount = useCreateAccount()
  const deleteAccount = useDeleteAccount()
  const generateDescriptionMutation = useGenerateAccountDescription()

  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'All' | 'Expense' | 'Income'>('All')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupType, setNewGroupType] = useState<'Expense' | 'Income'>('Expense')
  const [newAccountNames, setNewAccountNames] = useState<Record<string, string>>({})
  const [newAccountDescriptions, setNewAccountDescriptions] = useState<Record<string, string>>({})
  const [newAccountTags, setNewAccountTags] = useState<Record<string, string[]>>({})
  const [deleteGroupCandidate, setDeleteGroupCandidate] = useState<{ id: string; name: string } | null>(null)
  const [deleteAccountCandidate, setDeleteAccountCandidate] = useState<{ id: string; name: string } | null>(null)
  const [editAccountCandidate, setEditAccountCandidate] = useState<Account | null>(null)

  const toggleGroupCollapse = (id: string) => {
    setCollapsedGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const categoryGroups = useMemo(() => {
    return groups
      .filter((g) => g.accountType === 'Expense' || g.accountType === 'Income')
      .filter((g) => filterType === 'All' || g.accountType === filterType)
      .filter((g) => {
        if (!searchQuery.trim()) return true
        const query = searchQuery.toLowerCase()
        const matchGroup = g.name.toLowerCase().includes(query)
        const matchAccounts = accounts.some(
          (a) =>
            a.accountGroupId === g.id &&
            (a.name.toLowerCase().includes(query) ||
              a.description?.toLowerCase().includes(query) ||
              a.tags?.some((t) => t.toLowerCase().includes(query)))
        )
        return matchGroup || matchAccounts
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [groups, accounts, filterType, searchQuery])

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    createGroup.mutate(
      { name: newGroupName.trim(), accountType: newGroupType },
      { onSuccess: () => setNewGroupName('') }
    )
  }

  const handleCreateSubCategory = (e: React.FormEvent, groupId: string, type: string) => {
    e.preventDefault()
    const name = newAccountNames[groupId]?.trim()
    const description = newAccountDescriptions[groupId]?.trim() || ''
    const tags = newAccountTags[groupId] || []
    if (!name) return
    createAccount.mutate(
      { name, description, tags, accountGroupId: groupId, accountType: type as any, startingBalance: 0 },
      {
        onSuccess: () => {
          setNewAccountNames((prev) => ({ ...prev, [groupId]: '' }))
          setNewAccountDescriptions((prev) => ({ ...prev, [groupId]: '' }))
          setNewAccountTags((prev) => ({ ...prev, [groupId]: [] }))
        },
      }
    )
  }

  const handleGenerateDescription = async (groupId: string, groupName: string, type: string) => {
    const name = newAccountNames[groupId]?.trim()
    if (!name) return
    const context = newAccountDescriptions[groupId] || ''

    try {
      const { description, tags } = await generateDescriptionMutation.mutateAsync({
        name,
        type,
        groupName,
        context,
      })
      if (description) {
        setNewAccountDescriptions((prev) => ({ ...prev, [groupId]: description }))
      }
      if (tags && tags.length > 0) {
        setNewAccountTags((prev) => ({ ...prev, [groupId]: tags }))
      }
    } catch (e) {
      console.error(e)
      alert('Failed to generate description.')
    }
  }

  if (isLoadingGroups || isLoadingAccounts) {
    return (
      <div className="flex flex-col gap-6 w-full pb-8">
        <TableListSkeleton count={4} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 w-full pb-8">
      {/* Add New Category Header Card */}
      <section className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Create Category Group
          </h2>
        </div>
        <form onSubmit={handleCreateGroup} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            placeholder="e.g. Utilities, Dining, Subscriptions..."
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="flex-1 min-h-[42px] px-3.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
          <div className="flex gap-2">
            <select
              value={newGroupType}
              onChange={(e) => setNewGroupType(e.target.value as any)}
              className="min-h-[42px] px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
            >
              <option value="Expense">Expense</option>
              <option value="Income">Income</option>
            </select>
            <button
              type="submit"
              disabled={!newGroupName.trim() || createGroup.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl px-4 min-h-[42px] flex items-center justify-center gap-1.5 text-sm font-semibold transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Add Group</span>
            </button>
          </div>
        </form>
      </section>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search categories, sub-categories, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 shrink-0">
          {(['All', 'Expense', 'Income'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                filterType === type
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Category Groups List */}
      <div className="flex flex-col gap-3.5">
        {categoryGroups.map((group) => {
          const groupAccounts = accounts
            .filter((a) => a.accountGroupId === group.id)
            .sort((a, b) => a.name.localeCompare(b.name))
          const isExpense = group.accountType === 'Expense'
          const isCollapsed = !!collapsedGroups[group.id]

          return (
            <div
              key={group.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col transition-all"
            >
              {/* Card Header */}
              <div className="flex justify-between items-center bg-slate-50/80 dark:bg-slate-850/50 p-3.5 px-4 border-b border-slate-100 dark:border-slate-800/80">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      isExpense
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50'
                    }`}
                  >
                    {group.accountType}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-50 text-sm truncate">
                    {group.name}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                    ({groupAccounts.length})
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => toggleGroupCollapse(group.id)}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                    title={isCollapsed ? 'Expand group' : 'Collapse group'}
                  >
                    {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setDeleteGroupCandidate({ id: group.id, name: group.name })}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    title="Delete group"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card Body / Sub-categories */}
              {!isCollapsed && (
                <div className="p-3 sm:p-4 flex flex-col gap-2">
                  <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800/60">
                    {groupAccounts.map((acc) => (
                      <div
                        key={acc.id}
                        className="py-2.5 px-2 flex items-start justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 rounded-xl transition-colors group"
                      >
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                              {acc.name}
                            </span>
                          </div>

                          {acc.description && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                              {acc.description}
                            </p>
                          )}

                          {acc.tags && acc.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {acc.tags.map((t) => (
                                <span
                                  key={t}
                                  className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => setEditAccountCandidate(acc as Account)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                            title="Edit sub-category"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteAccountCandidate({ id: acc.id!, name: acc.name })}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                            title="Delete sub-category"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {groupAccounts.length === 0 && (
                      <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-500 italic">
                        No sub-categories added yet.
                      </div>
                    )}
                  </div>

                  {/* Add Sub-category Inline Form */}
                  <form
                    onSubmit={(e) => handleCreateSubCategory(e, group.id, group.accountType!)}
                    className="flex flex-col gap-2 mt-2 p-3 bg-slate-50/70 dark:bg-slate-800/30 border border-slate-200/70 dark:border-slate-800 rounded-xl"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Add new sub-category..."
                        value={newAccountNames[group.id] || ''}
                        onChange={(e) =>
                          setNewAccountNames((prev) => ({ ...prev, [group.id]: e.target.value }))
                        }
                        className="flex-1 text-xs sm:text-sm bg-transparent border-none outline-none text-slate-800 dark:text-slate-200 placeholder:text-slate-400 min-h-[34px]"
                      />
                      <button
                        type="submit"
                        disabled={!newAccountNames[group.id]?.trim()}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg px-2.5 py-1 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    </div>

                    {newAccountNames[group.id]?.trim() && (
                      <div className="flex flex-col gap-2 border-t border-slate-200/80 dark:border-slate-700/80 pt-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-slate-500">
                            Description & AI Guidance
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleGenerateDescription(group.id, group.name, group.accountType!)
                            }
                            disabled={generateDescriptionMutation.isPending}
                            className="text-[11px] flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3" />
                            {generateDescriptionMutation.isPending ? 'Generating...' : 'AI Auto-generate'}
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="e.g. Grocery supplies, supermarket bills..."
                          value={newAccountDescriptions[group.id] || ''}
                          onChange={(e) =>
                            setNewAccountDescriptions((prev) => ({
                              ...prev,
                              [group.id]: e.target.value,
                            }))
                          }
                          className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <div className="flex flex-col gap-1 mt-0.5">
                          <span className="text-[11px] font-medium text-slate-500">Tags</span>
                          <TagInput
                            tags={newAccountTags[group.id] || []}
                            onChange={(newTags) =>
                              setNewAccountTags((prev) => ({ ...prev, [group.id]: newTags }))
                            }
                            placeholder="Type tag and press Enter"
                          />
                        </div>
                      </div>
                    )}
                  </form>
                </div>
              )}
            </div>
          )
        })}

        {categoryGroups.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            No categories match the criteria.
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={!!deleteGroupCandidate}
        title="Delete Category Group"
        message={`Are you sure you want to delete the category group "${deleteGroupCandidate?.name}"? All sub-categories under it will also be removed.`}
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

      <EditAccountModal
        isOpen={!!editAccountCandidate}
        onClose={() => setEditAccountCandidate(null)}
        account={editAccountCandidate}
      />
    </div>
  )
}

function VendorsSettings() {
  const { data: vendors = [], isLoading } = useGetVendors()
  const createVendor = useCreateVendor()
  const deleteVendor = useDeleteVendor()

  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'All' | 'Business' | 'Individual'>('All')

  const [newVendorName, setNewVendorName] = useState('')
  const [newVendorType, setNewVendorType] = useState<'Individual' | 'Business'>('Business')
  const [newVendorTags, setNewVendorTags] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string } | null>(null)
  const [editCandidate, setEditCandidate] = useState<Vendor | null>(null)

  const filteredVendors = useMemo(() => {
    return vendors
      .filter((v) => filterType === 'All' || v.type === filterType)
      .filter((v) => {
        if (!searchQuery.trim()) return true
        const query = searchQuery.toLowerCase()
        const matchName = v.name.toLowerCase().includes(query)
        const matchTags = v.tags?.some((t) => t.toLowerCase().includes(query))
        return matchName || matchTags
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [vendors, filterType, searchQuery])

  const handleCreateVendor = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newVendorName.trim()) return
    const tags = newVendorTags
      ? newVendorTags.split(',').map((t) => t.trim()).filter(Boolean)
      : []
    createVendor.mutate(
      { name: newVendorName.trim(), type: newVendorType, tags },
      {
        onSuccess: () => {
          setNewVendorName('')
          setNewVendorTags('')
          setNewVendorType('Business')
        },
      }
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 w-full pb-8">
        <TableListSkeleton count={5} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 w-full pb-8">
      {/* Create Vendor Section */}
      <section className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Store className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Register Vendor
          </h2>
        </div>
        <form onSubmit={handleCreateVendor} className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              placeholder="Vendor Name (e.g. Meralco, Grab, Shopee)"
              value={newVendorName}
              onChange={(e) => setNewVendorName(e.target.value)}
              className="flex-1 min-h-[42px] px-3.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            <select
              value={newVendorType}
              onChange={(e) => setNewVendorType(e.target.value as any)}
              className="min-h-[42px] px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
            >
              <option value="Business">Business</option>
              <option value="Individual">Individual</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Tags separated by commas (e.g. electric, bills, utility)"
              value={newVendorTags}
              onChange={(e) => setNewVendorTags(e.target.value)}
              className="flex-1 min-h-[42px] px-3.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!newVendorName.trim() || createVendor.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl px-4 min-h-[42px] flex items-center justify-center gap-1.5 text-sm font-semibold transition-colors shrink-0 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Vendor</span>
            </button>
          </div>
        </form>
      </section>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search vendors or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 shrink-0">
          {(['All', 'Business', 'Individual'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                filterType === type
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Vendors List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {filteredVendors.map((vendor) => (
            <div
              key={vendor.id}
              className="flex justify-between items-center p-3.5 sm:p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group"
            >
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-50 text-sm">
                    {vendor.name}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold px-1.5 py-0.2 rounded-md ${
                      vendor.type === 'Business'
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/40'
                    }`}
                  >
                    {vendor.type}
                  </span>
                </div>
                {vendor.tags && vendor.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {vendor.tags.map((tag) => (
                      <span
                        key={tag}
                        className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => setEditCandidate(vendor as Vendor)}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                  title="Edit vendor"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteCandidate({ id: vendor.id!, name: vendor.name })}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                  title="Delete vendor"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {filteredVendors.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500 italic">No vendors found.</div>
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

      <EditVendorModal
        isOpen={!!editCandidate}
        onClose={() => setEditCandidate(null)}
        vendor={editCandidate}
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
      setProcessingIds((prev) => [...prev, id])
      rejectMutation.mutate(id, {
        onSettled: () => {
          setProcessingIds((prev) => prev.filter((x) => x !== id))
        },
      })
    }
  }

  const mappedIngestionTransaction = confirmingIngestion
    ? ({
        type:
          confirmingIngestion.ai_parsed.transaction_type === 'Income' ? 'Income' : 'Expense',
        vendor: confirmingIngestion.ai_parsed.vendor?.name || '',
        note: confirmingIngestion.ai_parsed.summary || confirmingIngestion.ai_parsed.notes || '',
        date: confirmingIngestion.received_at,
        entries: [
          {
            accountId: confirmingIngestion.ai_parsed.debit_account_id || '',
            amount: confirmingIngestion.ai_parsed.amount || 0,
          },
          {
            accountId: confirmingIngestion.ai_parsed.credit_account_id || '',
            amount: -(confirmingIngestion.ai_parsed.amount || 0),
          },
        ],
      } as Transaction)
    : null

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 w-full pb-8">
        <TableListSkeleton count={3} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 w-full pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Non-Financial Notification Stream
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Notifications ingested but classified as non-financial. Convert any missed transactions.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {ingestions.map((ingestion) => (
          <div
            key={ingestion.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-3 shadow-sm relative overflow-hidden"
          >
            <div className="flex justify-between items-start gap-3">
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {dayjs(ingestion.received_at).format('MMM DD, YYYY • h:mm A')}
                  </span>
                  {ingestion.ai_parsed.application && (
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full font-semibold">
                      {ingestion.ai_parsed.application}
                    </span>
                  )}
                  {ingestion.ai_parsed.reason && (
                    <span className="text-[10px] bg-slate-50 dark:bg-slate-850 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-800">
                      {ingestion.ai_parsed.reason}
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm font-normal text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850 leading-relaxed font-mono">
                  {ingestion.raw_msg}
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end border-t border-slate-100 dark:border-slate-800/80 pt-3">
              <button
                onClick={() => handleDismiss(ingestion.id)}
                disabled={processingIds.includes(ingestion.id)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20 dark:hover:text-rose-400 transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" /> Dismiss
              </button>
              <button
                onClick={() => setConfirmingIngestion(ingestion)}
                disabled={processingIds.includes(ingestion.id)}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer shadow-sm disabled:opacity-50"
              >
                <Edit className="w-3.5 h-3.5" /> Convert to Transaction
              </button>
            </div>
          </div>
        ))}

        {ingestions.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            No non-financial notifications pending.
          </div>
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
    <div className="flex flex-col gap-4 w-full pb-8">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Historical Ingestions Archive
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Review and import legacy webhook entries from your previous database.
          </p>
        </div>
      </div>
      <HistoricalHooksList />
    </div>
  )
}

function RunbookReviewSettings() {
  const [runbookType, setRunbookType] = useState<'app' | 'sms' | 'email' | 'image'>('app')
  const { data: session } = useGetRunbookSession()
  const hasActiveSession = !!session
  const activeRunbookType = session?.runbook_type || runbookType

  const { data: corrections = [], isLoading } = useGetRunbookCorrections(activeRunbookType)
  const { data: runbookRes } = useQuery({
    queryKey: ['runbook_content', activeRunbookType],
    queryFn: async () => {
      const res = await ingesterClient.get(`/runbook?type=${activeRunbookType}`)
      return res.data
    },
  })
  const currentRunbook = runbookRes?.content || ''

  const [isModalOpen, setIsModalOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 w-full pb-8">
        <TableListSkeleton count={3} />
      </div>
    )
  }

  const runbookLabel =
    activeRunbookType === 'sms'
      ? 'SMS'
      : activeRunbookType === 'email'
      ? 'Email'
      : activeRunbookType === 'image'
      ? 'Image'
      : 'App'

  const runbookTabs = [
    { id: 'app', label: 'App Notifications' },
    { id: 'sms', label: 'SMS Texts' },
    { id: 'email', label: 'Email Messages' },
    { id: 'image', label: 'Image OCR' },
  ] as const

  return (
    <div className="flex flex-col gap-6 w-full pb-8">
      {/* Type Switcher */}
      <div className="flex bg-slate-100 dark:bg-slate-800/80 rounded-xl p-1 max-w-lg border border-slate-200/80 dark:border-slate-700/80">
        {runbookTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setRunbookType(tab.id as any)}
            disabled={hasActiveSession}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
              activeRunbookType === tab.id
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {hasActiveSession && (
        <div className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/30 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/50 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>
            Active review session in progress for <strong>{runbookLabel} Runbook</strong>. Finish or
            discard it to switch channels.
          </span>
        </div>
      )}

      {/* Main Review Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Pending {runbookLabel} Rule Corrections
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Review user corrections to train and update prompt classification guides.
            </p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors shadow-sm cursor-pointer shrink-0"
          >
            {hasActiveSession && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
            {hasActiveSession
              ? 'Resume Session'
              : corrections.length > 0
              ? 'Review Changes'
              : 'Start Ad-hoc Chat'}
          </button>
        </div>

        {corrections.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-slate-50/50 dark:bg-slate-850/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs sm:text-sm">
            No pending {runbookLabel} corrections to review.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {corrections.map((c) => (
              <div
                key={c.id}
                className="bg-slate-50/70 dark:bg-slate-850/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col gap-2.5"
              >
                <div className="flex justify-between items-start">
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    {c.user_confirmed?.vendor || c.ai_parsed?.vendor || 'Unknown Vendor'}
                  </div>
                  <div className="text-[11px] text-slate-400 font-medium">
                    {dayjs(c.received_at).format('MMM D, YYYY h:mm A')}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 font-semibold block text-[10px] uppercase mb-0.5">
                      Original AI Prediction
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {c.ai_parsed?.transaction_type} • {c.ai_parsed?.category || 'Uncategorized'}
                    </span>
                  </div>

                  <div className="bg-indigo-50/50 dark:bg-indigo-950/30 p-2.5 rounded-lg border border-indigo-100 dark:border-indigo-900/40">
                    <span className="text-indigo-500 dark:text-indigo-400 font-semibold block text-[10px] uppercase mb-0.5">
                      Your Correction
                    </span>
                    <span className="text-indigo-700 dark:text-indigo-300 font-medium">
                      {c.user_confirmed?.transaction_type} •{' '}
                      {c.user_confirmed?.category || 'Uncategorized'}
                    </span>
                  </div>
                </div>

                {c.user_confirmed?.user_why && (
                  <div className="text-xs bg-amber-50/70 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 p-2.5 rounded-lg border border-amber-200/60 dark:border-amber-900/40">
                    <span className="font-semibold mr-1">User Reason:</span>
                    {c.user_confirmed.user_why}
                  </div>
                )}
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
        runbookType={activeRunbookType}
      />
    </div>
  )
}

