import axios from 'axios'
import { getUserManager } from '@adolf94/ar-auth-client'

const apiClient = axios.create({
  baseURL: window.authConfig?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:7071/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Auth interceptor: attach Bearer token to every request
apiClient.interceptors.request.use(async (config) => {
  let token = localStorage.getItem('access_token')
  if (!token) {
    try {
      const userManager = getUserManager()
      const user = await userManager.getUser()
      if (user && user.access_token) {
        token = user.access_token
      }
    } catch (e) {
      // Fallback to manual local storage parsing if UserManager is not initialized yet
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
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or unauthorized — redirect to login
      toast.error('Unauthorized - Please log in again')
      localStorage.removeItem('access_token')
      window.location.href = '/login'
    } else if (error.response?.status >= 500) {
      const msg = error.response?.data?.error || error.response?.data || 'Internal Server Error'
      toast.error(typeof msg === 'string' ? msg : 'Internal Server Error')
    } else if (error.response?.status >= 400) {
      const msg = error.response?.data?.error || error.response?.data || 'Bad Request'
      toast.error(typeof msg === 'string' ? msg : 'Bad Request')
    } else {
      toast.error('Network error or unknown issue')
    }
    return Promise.reject(error)
  }
)

export default apiClient
