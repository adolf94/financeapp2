import React, { useState, useEffect } from 'react'
import { Vendor, useUpdateVendor, useGetVendorLookups, useAddVendorLookup, useDeleteVendorLookup } from '@/hooks/useVendors'
import { X, Trash2, Plus, Loader2 } from 'lucide-react'
import TagInput from '@/components/ui/TagInput'

interface EditVendorModalProps {
  isOpen: boolean
  onClose: () => void
  vendor: Vendor | null
  onSaveSuccess?: (updatedVendor: Vendor) => void
  showLookups?: boolean
}

export default function EditVendorModal({
  isOpen,
  onClose,
  vendor,
  onSaveSuccess,
  showLookups = false,
}: EditVendorModalProps) {
  const updateMutation = useUpdateVendor()
  const [formData, setFormData] = useState<Vendor | null>(null)
  const [newLookup, setNewLookup] = useState('')

  const { data: lookups = [], isLoading: isLoadingLookups } = useGetVendorLookups(
    showLookups && isOpen && vendor?.id ? vendor.id : undefined
  )
  const addLookupMutation = useAddVendorLookup()
  const deleteLookupMutation = useDeleteVendorLookup()

  useEffect(() => {
    if (vendor && isOpen) {
      setFormData({
        ...vendor,
        type: vendor.type || 'Business',
        tags: vendor.tags || [],
      })
      setNewLookup('')
    }
  }, [vendor, isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData) return
    updateMutation.mutate(formData, {
      onSuccess: (data) => {
        if (onSaveSuccess) {
          onSaveSuccess(data)
        }
        onClose()
      },
    })
  }

  const handleAddLookup = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLookup.trim() || !vendor?.id) return
    addLookupMutation.mutate(
      { vendorId: vendor.id, lookup: newLookup.trim() },
      {
        onSuccess: () => {
          setNewLookup('')
        },
      }
    )
  }

  const handleDeleteLookup = (lookupId: string) => {
    if (!vendor?.id) return
    deleteLookupMutation.mutate({ vendorId: vendor.id, lookupId })
  }

  if (!isOpen || !formData) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 transition-opacity duration-300" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 w-full md:max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-2xl z-55 shadow-2xl p-4 flex flex-col gap-4 border-t border-slate-200 dark:border-slate-800 animate-slide-up pb-safe max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Edit Vendor</h2>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vendor Type</label>
            <select
              value={formData.type || 'Business'}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
              required
              className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="Business">Business</option>
              <option value="Individual">Individual</option>
              <option value="Internal">Internal</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tags</label>
            <TagInput
              tags={formData.tags || []}
              onChange={(newTags) => setFormData({ ...formData, tags: newTags })}
              placeholder="Type tag and press Enter"
            />
          </div>

          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-semibold transition-colors disabled:opacity-50 mt-1 cursor-pointer"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </form>

        {showLookups && vendor?.id && (
          <div className="flex flex-col gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Matched Lookups</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Phrases matched by transaction descriptions and receipt text
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                {lookups.length} {lookups.length === 1 ? 'lookup' : 'lookups'}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {isLoadingLookups ? (
                <div className="flex items-center justify-center p-4 text-slate-400 gap-2 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading lookups...
                </div>
              ) : lookups.length === 0 ? (
                <div className="text-xs text-slate-400 dark:text-slate-500 italic p-2 text-center bg-slate-50 dark:bg-slate-950/40 rounded-lg border border-dashed border-slate-200 dark:border-slate-800">
                  No lookups registered for this vendor.
                </div>
              ) : (
                lookups.map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-center px-3 py-2 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <span className="font-mono text-slate-800 dark:text-slate-200 truncate font-medium">
                        {item.lookupValue}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40 shrink-0">
                        {item.hits} {item.hits === 1 ? 'match' : 'matches'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteLookup(item.id)}
                      disabled={deleteLookupMutation.isPending}
                      className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                      title="Delete lookup"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                placeholder="Add lookup phrase (e.g. netflix.com)"
                value={newLookup}
                onChange={(e) => setNewLookup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddLookup(e)
                  }
                }}
                className="flex-1 min-h-[38px] px-3 text-xs border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleAddLookup}
                disabled={!newLookup.trim() || addLookupMutation.isPending}
                className="px-3 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {addLookupMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

