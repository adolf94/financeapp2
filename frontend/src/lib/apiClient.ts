import axios from 'axios'
import { getUserManager, refreshAccessToken } from '@adolf94/ar-auth-client'

const apiClient = axios.create({
  baseURL: window.authConfig?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:7071/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Auth interceptor: attach Bearer token to every request
apiClient.interceptors.request.use(async (config) => {
  let token: string | null = null
  try {
    const userManager = getUserManager()
    let user = await userManager.getUser()
    if (user && (user.expired || (user.expires_at && user.expires_at <= Math.floor(Date.now() / 1000) + 30))) {
      user = await refreshAccessToken()
    }
    if (user && user.access_token) {
      token = user.access_token
    }
  } catch (e) {
    // Fallback if userManager is unavailable
  }

  if (!token) {
    token = localStorage.getItem('access_token')
  }

  if (!token) {
    try {
      const authority = window.authConfig?.authority ?? 'https://auth.adolfrey.com/api'
      const clientId = window.authConfig?.clientId ?? 'finance-app2'
      const authorityBase = authority.endsWith('/') ? authority : `${authority}/`
      const keys = [
        `oidc.user:${authorityBase}:${clientId}`,
        `oidc.user:${authority}:${clientId}`
      ]
      for (const key of keys) {
        const oidcData = localStorage.getItem(key)
        if (oidcData) {
          try {
            const parsed = JSON.parse(oidcData)
            if (parsed && parsed.access_token) {
              token = parsed.access_token
              break
            }
          } catch (err) {
            console.error(err)
          }
        }
      }
    } catch {
      // Ignored
    }
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

import toast from 'react-hot-toast'

// Global error response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        const user = await refreshAccessToken()
        if (user?.access_token) {
          originalRequest.headers.Authorization = `Bearer ${user.access_token}`
          return apiClient(originalRequest)
        }
      } catch (refreshErr) {
        console.error('Failed refreshing token on 401:', refreshErr)
      }
      toast.error('Session expired - Please log in again')
      localStorage.removeItem('access_token')
      return Promise.reject(error)
    } else if (error.response?.status >= 500) {
      const msg = error.response?.data?.error || error.response?.data || 'Internal Server Error'
      toast.error(typeof msg === 'string' ? msg : 'Internal Server Error')
    } else if (error.response?.status >= 400 && error.response?.status !== 401) {
      const msg = error.response?.data?.error || error.response?.data || 'Bad Request'
      toast.error(typeof msg === 'string' ? msg : 'Bad Request')
    }
    return Promise.reject(error)
  }
)

export default apiClient
