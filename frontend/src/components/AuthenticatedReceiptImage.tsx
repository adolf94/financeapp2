import { useState, useEffect } from 'react'
import ingesterClient from '@/lib/ingesterClient'
import { Loader2, AlertCircle } from 'lucide-react'

interface AuthenticatedReceiptImageProps {
  ingestionId: string
  alt?: string
  className?: string
}

export default function AuthenticatedReceiptImage({
  ingestionId,
  alt = 'Receipt Image',
  className = 'max-h-[60vh] max-w-full object-contain rounded-lg shadow-lg'
}: AuthenticatedReceiptImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    async function fetchImage() {
      setLoading(true)
      setError(null)
      try {
        const response = await ingesterClient.get(`/images/${ingestionId}`, {
          responseType: 'blob',
        })
        if (active) {
          objectUrl = URL.createObjectURL(response.data)
          setImageUrl(objectUrl)
          setLoading(false)
        }
      } catch (err: any) {
        if (active) {
          console.error('[AuthenticatedReceiptImage] Failed to load image:', err)
          setError(err?.response?.status === 404 ? 'Image not found' : 'Failed to load receipt image')
          setLoading(false)
        }
      }
    }

    if (ingestionId) {
      fetchImage()
    }

    return () => {
      active = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [ingestionId])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400 gap-2 min-h-[220px]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        <span className="text-xs font-medium">Loading secure receipt preview...</span>
      </div>
    )
  }

  if (error || !imageUrl) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-rose-400 gap-2 min-h-[180px] bg-rose-950/20 rounded-xl border border-rose-900/30">
        <AlertCircle className="w-6 h-6 text-rose-500" />
        <span className="text-xs font-medium">{error || 'Unable to display receipt'}</span>
      </div>
    )
  }

  return <img src={imageUrl} alt={alt} className={className} />
}
