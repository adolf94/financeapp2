import { useEffect, useRef } from 'react'
import { HubConnectionBuilder, HubConnection } from '@microsoft/signalr'
import { getUserManager } from '@adolf94/ar-auth-client'
import toast from 'react-hot-toast'

async function getAccessToken(): Promise<string> {
  // 1. Simple key
  let token = localStorage.getItem('access_token')
  if (token) return token

  // 2. Via OIDC UserManager
  try {
    const userManager = getUserManager()
    const user = await userManager.getUser()
    if (user?.access_token) return user.access_token
  } catch {
    // fall through to localStorage scan
  }

  // 3. Scan oidc.user:* keys in localStorage
  const authority =
    (window as any).authConfig?.authority ?? 'https://auth.adolfrey.com/api'
  const clientId = (window as any).authConfig?.clientId ?? 'finance-app2'
  const authorityBase = authority.endsWith('/') ? authority : `${authority}/`
  for (const key of [
    `oidc.user:${authorityBase}:${clientId}`,
    `oidc.user:${authority}:${clientId}`,
  ]) {
    const raw = localStorage.getItem(key)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.access_token) return parsed.access_token
      } catch { /* ignore */ }
    }
  }

  return ''
}

export const useSignalR = (enabled: boolean = true) => {
  const connectionRef = useRef<HubConnection | null>(null)

  useEffect(() => {
    if (!enabled) return

    const ingesterBaseUrl =
      (window as any).authConfig?.ingesterBaseUrl ??
      import.meta.env.VITE_INGESTER_BASE_URL ??
      'http://localhost:7072'

    // The SignalR SDK appends /negotiate to this URL automatically.
    // This function app has an empty routePrefix, so the negotiate route is at
    // http://localhost:7072/negotiate (not /api/negotiate).
    // We pass the base URL directly so the SDK calls {base}/negotiate.
    const hubUrl = ingesterBaseUrl

    console.log('[SignalR] Initializing connection to:', hubUrl)

    const connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: getAccessToken
      })
      .withAutomaticReconnect()
      .build()

    connection.on('announcement', (message: string) => {
      console.log('[SignalR] Announcement received:', message)
      toast.success(message, {
        duration: 4000,
        position: 'bottom-right'
      })
    })

    connection.on('reclassifyProgress', (chunk: string, operationId: string, debounceDelay?: number) => {
      window.dispatchEvent(new CustomEvent(`reclassifyProgress_${operationId}`, { detail: { chunk, debounceDelay } }))
    })

    connection.on('reclassifyThinking', (chunk: string, operationId: string, debounceDelay?: number) => {
      window.dispatchEvent(new CustomEvent(`reclassifyThinking_${operationId}`, { detail: { chunk, debounceDelay } }))
    })

    connection.on('chatProgress', (chunk: string, _operationId?: string, debounceDelay?: number) => {
      window.dispatchEvent(new CustomEvent('chatProgress', { detail: { chunk, debounceDelay } }))
    })

    connection.on('reclassifyComplete', (ingestion: any, operationId: string) => {
      console.log('[SignalR] Reclassify complete:', operationId, ingestion)
      window.dispatchEvent(new CustomEvent('reclassifyComplete', { detail: { ingestion, operationId } }))
      if (operationId) {
        window.dispatchEvent(new CustomEvent(`reclassifyComplete_${operationId}`, { detail: { ingestion, operationId } }))
      }
    })

    connection.on('checkEmailItem', (ingestion: any, count: number, total: number) => {
      console.log('[SignalR] checkEmailItem:', count, 'of', total, ingestion)
      window.dispatchEvent(new CustomEvent('checkEmailItem', { detail: { ingestion, count, total } }))
    })

    connection.on('checkEmailComplete', (total: number) => {
      console.log('[SignalR] checkEmailComplete:', total)
      window.dispatchEvent(new CustomEvent('checkEmailComplete', { detail: { total } }))
    })


    connection.start()
      .then(() => {
        console.log('[SignalR] Connected successfully!')
        ;(window as any).signalRConnectionId = connection.connectionId
      })
      .catch((err) => {
        console.error('[SignalR] Connection failed:', err)
      })

    connectionRef.current = connection

    return () => {
      if (connectionRef.current) {
        console.log('[SignalR] Disconnecting...')
        connectionRef.current.stop()
      }
    }
  }, [enabled])
}
