import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/lib/apiClient'
import { PendingIngestion } from './useIngestions'
import ingesterClient from '@/lib/ingesterClient'

// ── Types ──────────────────────────────────────────────────────────────────

export type AccountDescriptionUpdate = {
  account_id: string
  new_description: string
  new_tags?: string[]
}

export type VendorUpdate = {
  vendor_id: string
  new_tags?: string[]
}

export type ChatMessage = {
  role: 'user' | 'ai'
  text: string
  questions?: string[]
}

/** Shape of the persisted session document returned by the Python backend. */
export type RunbookReviewSession = {
  id: string
  UserId: string
  corrections: PendingIngestion[]
  chat_history: ChatMessage[]
  proposed_runbook: string
  account_description_updates: AccountDescriptionUpdate[]
  vendor_updates: VendorUpdate[]
  created_at: string
  updated_at: string
  partition_key: string
}

// ── Corrections ────────────────────────────────────────────────────────────

export function useGetRunbookCorrections() {
  return useQuery({
    queryKey: ['runbook_corrections'],
    queryFn: async () => {
      const { data } = await ingesterClient.get<PendingIngestion[]>('/runbook/corrections')
      return data
    },
  })
}

// ── Session ────────────────────────────────────────────────────────────────

/**
 * Fetches the current active review session.
 * Returns undefined (not an error) when no session exists (404).
 */
export function useGetRunbookSession() {
  return useQuery<RunbookReviewSession | null>({
    queryKey: ['runbook_session'],
    queryFn: async () => {
      try {
        const { data } = await ingesterClient.get<RunbookReviewSession>('/runbook/review/session')
        return data
      } catch (err: any) {
        if (err?.response?.status === 404) return null
        throw err
      }
    },
    staleTime: 0, // Always re-fetch on mount so modal restores latest state
  })
}

// ── Start ──────────────────────────────────────────────────────────────────

/** Creates (or overwrites) a session with a fresh AI analysis. Returns the new session. */
export function useStartRunbookReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (corrections: PendingIngestion[]) => {
      const { data } = await ingesterClient.post<RunbookReviewSession>('/runbook/review/start', { corrections })
      return data
    },
    onSuccess: (session) => {
      queryClient.setQueryData(['runbook_session'], session)
    },
  })
}

// ── Chat ───────────────────────────────────────────────────────────────────

/** Sends a user message; backend loads session, appends, and returns the updated session. */
export function useChatRunbookReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { user_message: string }) => {
      const { data } = await ingesterClient.post<RunbookReviewSession>('/runbook/review/chat', params)
      return data
    },
    onSuccess: (session) => {
      queryClient.setQueryData(['runbook_session'], session)
    },
  })
}

// ── Approve ────────────────────────────────────────────────────────────────

/** Reads session server-side, applies changes, marks corrections synced, deletes session. */
export function useApproveRunbookReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params?: { account_updates: AccountDescriptionUpdate[], vendor_updates: VendorUpdate[] }) => {
      const { data } = await ingesterClient.post('/runbook/review/approve', params || {})
      return data
    },
    onSuccess: () => {
      queryClient.setQueryData(['runbook_session'], null)
      queryClient.invalidateQueries({ queryKey: ['runbook_corrections'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['runbook_content'] })
    },
  })
}

// ── Discard ────────────────────────────────────────────────────────────────

/** Deletes the session without applying any changes. */
export function useDiscardRunbookReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await ingesterClient.post('/runbook/review/discard')
      return data
    },
    onSuccess: () => {
      queryClient.setQueryData(['runbook_session'], null)
    },
  })
}

// ── Update Session ──────────────────────────────────────────────────────────

/** Updates the active review session state (proposed runbook draft or updates). */
export function useUpdateRunbookSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { 
      proposed_runbook?: string
      account_description_updates?: AccountDescriptionUpdate[]
      vendor_updates?: VendorUpdate[]
    }) => {
      const { data } = await ingesterClient.put<RunbookReviewSession>('/runbook/review/session', params)
      return data
    },
    onSuccess: (session) => {
      queryClient.setQueryData(['runbook_session'], session)
    },
  })
}

// ── Runbook content (C# backend) ───────────────────────────────────────────

/** Legacy: kept for Settings page to fetch raw runbook content from the .NET API. */
export { apiClient }

