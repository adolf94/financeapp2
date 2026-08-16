import { createRouter, createRootRoute, createRoute, lazyRouteComponent } from '@tanstack/react-router'
import AppLayout from '@/layouts/AppLayout'

// Root layout route
const rootRoute = createRootRoute({
  component: AppLayout,
})

// Page routes (Lazy loaded to split bundles)
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/pages/Dashboard')),
})

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  component: lazyRouteComponent(() => import('@/pages/Transactions')),
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts',
  component: lazyRouteComponent(() => import('@/pages/Accounts')),
})

const ingestionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ingestions',
  component: lazyRouteComponent(() => import('@/pages/PendingIngestions')),
})

const accountDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts/$accountId',
  component: lazyRouteComponent(() => import('@/pages/AccountDetails')),
})

const categoryDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/categories/$categoryId',
  component: lazyRouteComponent(() => import('@/pages/CategoryDetails')),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('@/pages/Settings')),
})

// Build the route tree
const routeTree = rootRoute.addChildren([
  dashboardRoute,
  transactionsRoute,
  accountsRoute,
  accountDetailsRoute,
  categoryDetailsRoute,
  settingsRoute,
  ingestionsRoute,
])

export const router = createRouter({ routeTree })

// Register router for type-safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
