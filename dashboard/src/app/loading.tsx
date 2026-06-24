import { Skeleton } from "../components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-lg" />
            <div className="space-y-1">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <nav className="mb-6 grid w-full grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:flex sm:w-fit sm:flex-wrap">
          {["Overview", "Medications", "Bills", "Policy", "Wallet", "Activity", "Settings"].map((tab) => (
            <Skeleton key={tab} className="h-11 rounded-md w-full sm:w-20" />
          ))}
        </nav>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>

        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 bg-slate-50 rounded-lg space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <Skeleton className="h-4 w-28" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 bg-slate-50 rounded-lg space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
