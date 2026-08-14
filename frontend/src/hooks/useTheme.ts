import { useState, useEffect } from 'react'

export type Theme = 'light' | 'dark' | 'system'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'system'
  })

  useEffect(() => {
    const root = document.documentElement
    
    function applyTheme(t: Theme) {
      if (t === 'dark') {
        root.classList.add('dark')
      } else if (t === 'light') {
        root.classList.remove('dark')
      } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      }
    }

    applyTheme(theme)

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      }
      mediaQuery.addEventListener('change', listener)
      return () => mediaQuery.removeEventListener('change', listener)
    }
  }, [theme])

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem('theme', newTheme)
    setThemeState(newTheme)
  }

  return { theme, setTheme }
}
