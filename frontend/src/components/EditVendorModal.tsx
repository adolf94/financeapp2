import React, { useState, useEffect } from 'react'
import { Vendor, useUpdateVendor } from '@/hooks/useVendors'
import { X } from 'lucide-react'
import TagInput from '@/components/ui/TagInput'

interface EditVendorModalProps {
  isOpen: boolean
  onClose: () => void
  vendor: Vendor | null
}

export default function EditVendorModal({ isOpen, onClose, vendor }: EditVendorModalProps) {
  const updateMutation = useUpdateVendor()
  const [formData, setFormData] = useState<Vendor | null>(null)

  useEffect(() => {
    if (vendor && isOpen) {
      setFormData({
        ...vendor,
        type: vendor.type || 'Business',
        tags: vendor.tags || [],
      })
    }
  }, [vendor, isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData) return
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
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-semibold transition-colors disabled:opacity-50 mt-2"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </>
  )
}
