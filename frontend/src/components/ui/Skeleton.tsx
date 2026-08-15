import React from 'react'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Skeleton({ className = '', ...props }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-200 dark:bg-slate-800 ${className}`}
      {...props}
    />
  )
}

export function TransactionListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4 p-4 max-w-md mx-auto w-full">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 flex-1">
            <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-4 w-16 rounded" />
            <Skeleton className="h-3 w-10 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AccountListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="p-4 flex flex-col gap-6 max-w-md mx-auto w-full">
      {/* Create form placeholder */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-3">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>

      {/* Account group cards */}
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-3 shadow-sm"
        >
          <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
            <Skeleton className="h-5 w-32 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center gap-2.5">
                <Skeleton className="w-4 h-4 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
              </div>
              <Skeleton className="h-4 w-20 rounded" />
            </div>
            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center gap-2.5">
                <Skeleton className="w-4 h-4 rounded" />
                <Skeleton className="h-4 w-28 rounded" />
              </div>
              <Skeleton className="h-4 w-16 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function TableListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center gap-4 shadow-sm"
        >
          <div className="flex flex-col gap-1.5 flex-1">
            <Skeleton className="h-4 w-1/3 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function IngestionReviewSkeleton() {
  return (
    <div className="md:col-span-5 flex flex-col gap-3 bg-slate-100 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm animate-pulse">
      <div className="flex justify-between items-center">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-4 w-12 rounded" />
      </div>
      <Skeleton className="h-8 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-4 w-24 rounded" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-4 w-20 rounded" />
        </div>
      </div>
    </div>
  )
}

export default Skeleton
