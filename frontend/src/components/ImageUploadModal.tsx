import React, { useState, useRef } from 'react'
import { X, Upload, Image as ImageIcon, Sparkles, AlertCircle, Loader2, FileText } from 'lucide-react'
import { uuidv7 } from 'uuidv7'
import { useUploadImage } from '@/hooks/useIngestions'
import toast from 'react-hot-toast'

interface ImageUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (ingestionId: string, operationId?: string, streamReasoning?: boolean) => void
  onStreamReasoningStart?: (operationId: string) => void
}

export default function ImageUploadModal({
  isOpen,
  onClose,
  onSuccess,
  onStreamReasoningStart,
}: ImageUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [streamReasoning, setStreamReasoning] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadImageMutation = useUploadImage()

  if (!isOpen) return null

  const handleFile = (file: File) => {
    setErrorMsg(null)
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      setErrorMsg('Please upload a PNG, JPEG, or WEBP image.')
      return
    }

    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg('File size must be under 20MB.')
      return
    }

    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setIsProcessing(true)
    setErrorMsg(null)

    const opId = uuidv7()

    if (streamReasoning) {
      onStreamReasoningStart?.(opId)
    }

    try {
      const res = await uploadImageMutation.mutateAsync({
        file: selectedFile,
        operationId: opId,
        description: description.trim() || undefined,
        streamReasoning,
      })

      toast.success('Receipt image queued for AI extraction!', { id: 'img-upload-toast' })
      if (onSuccess && res.ingestion_id) {
        onSuccess(res.ingestion_id, opId, streamReasoning)
      }
      handleClose()
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to upload image'
      setErrorMsg(msg)
      toast.error(`Upload error: ${msg}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setSelectedFile(null)
    setPreviewUrl(null)
    setDescription('')
    setErrorMsg(null)
    setIsProcessing(false)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
        <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col animate-scale-up">
          {/* Modal Header */}
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-800/50">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Upload Receipt / Invoice</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Extract financial transactions with Multimodal AI</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isProcessing}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
            {errorMsg && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {!selectedFile ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30'
                    : 'border-slate-300 dark:border-slate-700 hover:border-purple-400 dark:hover:border-purple-500 bg-slate-50/50 dark:bg-slate-950/40'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 flex items-center justify-center shadow-inner">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="font-bold text-sm text-slate-800 dark:text-slate-200">
                    Click to browse or drop receipt image here
                  </p>
                  <p className="text-xs text-slate-400">
                    Supports PNG, JPEG, WEBP up to 20MB
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 max-h-[260px] flex items-center justify-center group">
                  <img
                    src={previewUrl!}
                    alt="Receipt Preview"
                    className="max-h-[260px] w-auto object-contain rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (previewUrl) URL.revokeObjectURL(previewUrl)
                      setSelectedFile(null)
                      setPreviewUrl(null)
                    }}
                    disabled={isProcessing}
                    className="absolute top-3 right-3 bg-black/70 hover:bg-black text-white p-2 rounded-xl backdrop-blur-md transition-all shadow-md cursor-pointer opacity-90 group-hover:opacity-100"
                    title="Remove image"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex justify-between items-center px-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold truncate max-w-[240px] text-slate-700 dark:text-slate-300">
                    {selectedFile.name}
                  </span>
                  <span>{(selectedFile.size / 1024).toFixed(1)} KB</span>
                </div>
              </div>
            )}

            {/* Description input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                <span>Description of Transaction (Optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Team lunch at Bistro, Client meeting dinner, Groceries"
                disabled={isProcessing}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
              />
            </div>

            {/* AI Feature Info */}
            <div className="p-3.5 bg-gradient-to-r from-purple-50/70 to-indigo-50/70 dark:from-purple-950/20 dark:to-indigo-950/20 border border-purple-200/50 dark:border-purple-900/30 rounded-2xl flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Multimodal AI extracts vendor, items, total amount, taxes, date, and accounts automatically. Review and confirm right in your Inbox.
              </p>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={streamReasoning}
                  onChange={(e) => setStreamReasoning(e.target.checked)}
                  disabled={isProcessing}
                  className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Stream Reasoning
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!selectedFile || isProcessing}
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 active:scale-95 transition-all rounded-xl shadow-md disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Process Receipt</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
