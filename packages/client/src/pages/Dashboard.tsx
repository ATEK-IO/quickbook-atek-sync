import { trpc } from '../lib/trpc'

export default function Dashboard() {
  const health = trpc.health.ping.useQuery()

  // Check for QuickBooks auth status from URL params
  const urlParams = new URLSearchParams(window.location.search)
  const qbAuth = urlParams.get('qb_auth')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">ATEK-QuickBooks Synchronization System</p>
      </div>

      {qbAuth === 'success' && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          QuickBooks connected successfully!
        </div>
      )}

      {qbAuth === 'error' && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          QuickBooks connection failed. Please try again.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {/* Server Status Card */}
        <div className="p-6 border rounded-lg">
          <h3 className="font-semibold mb-2">Server Status</h3>
          {health.isLoading ? (
            <p className="text-muted-foreground">Checking...</p>
          ) : health.isError ? (
            <p className="text-red-500">Offline</p>
          ) : (
            <p className="text-green-500">Online</p>
          )}
        </div>

        {/* QuickBooks Connection Card */}
        <div className="p-6 border rounded-lg">
          <h3 className="font-semibold mb-2">QuickBooks</h3>
          <a
            href="/api/quickbooks/auth"
            className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Connect QuickBooks
          </a>
        </div>

        {/* Sync Status Card */}
        <div className="p-6 border rounded-lg">
          <h3 className="font-semibold mb-2">Sync Status</h3>
          <p className="text-muted-foreground">No active syncs</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Phase 1: Customers */}
        <div className="p-6 border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 bg-muted rounded-full flex items-center justify-center text-xs font-bold">
              1
            </span>
            <h3 className="font-semibold">Customer Mapping</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Map ATEK organizations to QuickBooks customers
          </p>
          <div className="text-sm">
            <p>
              Mapped: <span className="font-mono">0 / 0</span>
            </p>
            <p>
              Pending Review: <span className="font-mono">0</span>
            </p>
          </div>
        </div>

        {/* Phase 2: SKUs */}
        <div className="p-6 border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 bg-muted rounded-full flex items-center justify-center text-xs font-bold">
              2
            </span>
            <h3 className="font-semibold">SKU Mapping</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Map ATEK SKUs to QuickBooks items
          </p>
          <div className="text-sm">
            <p>
              Mapped: <span className="font-mono">0 / 0</span>
            </p>
            <p>
              Needs Creation: <span className="font-mono">0</span>
            </p>
          </div>
        </div>

        {/* Phase 3: Invoices */}
        <div className="p-6 border rounded-lg">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 bg-muted rounded-full flex items-center justify-center text-xs font-bold">
              3
            </span>
            <h3 className="font-semibold">Invoice Sync</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Sync validated invoices to QuickBooks
          </p>
          <div className="text-sm">
            <p>
              Ready: <span className="font-mono">0</span>
            </p>
            <p>
              Synced: <span className="font-mono">0</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
