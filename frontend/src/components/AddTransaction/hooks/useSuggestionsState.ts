import { useState, useCallback } from 'react'

export interface PendingNewAccountType {
  name: string
  categoryId: string
  type: string
  splitId: string
  description: string
  tags: string[]
}

export interface SuggestionData {
  name: string
  account_group: string
  type: string
  description: string
  tags: string[]
}

export function useSuggestionsState() {
  const [pendingNewAccount, setPendingNewAccount] = useState<PendingNewAccountType | null>(null)
  const [editingSuggestion, setEditingSuggestion] = useState<{
    idx: number
    data: SuggestionData
  } | null>(null)
  const [createdSuggestions, setCreatedSuggestions] = useState<Set<number>>(new Set())
  const [suggestedVendorType, setSuggestedVendorType] = useState<'Individual' | 'Business'>('Business')
  const [suggestedVendorTags, setSuggestedVendorTags] = useState('')

  const resetSuggestionsState = useCallback(() => {
    setPendingNewAccount(null)
    setEditingSuggestion(null)
    setCreatedSuggestions(new Set())
    setSuggestedVendorType('Business')
    setSuggestedVendorTags('')
  }, [])

  return {
    pendingNewAccount,
    setPendingNewAccount,
    editingSuggestion,
    setEditingSuggestion,
    createdSuggestions,
    setCreatedSuggestions,
    suggestedVendorType,
    setSuggestedVendorType,
    suggestedVendorTags,
    setSuggestedVendorTags,
    resetSuggestionsState,
  }
}
