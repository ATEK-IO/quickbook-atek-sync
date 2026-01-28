import { useState, useMemo } from 'react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Check, RefreshCw, Filter, AlertCircle, Send, ChevronDown, ChevronRight, Eye, Lock, ExternalLink, UserPlus, Package, Search, X } from 'lucide-react'
import { InvoiceCompareDialog } from '@/components/InvoiceCompareDialog'
import { InvoiceDashboard } from '@/components/InvoiceDashboard'
import { InlineCustomerCreateDialog } from '@/components/InlineCustomerCreateDialog'
import { InlineSkuCreateDialog } from '@/components/InlineSkuCreateDialog'
import { InvoiceMatchPreview } from '@/components/InvoiceMatchPreview'

type StatusFilter = 'all' | 'pending' | 'ready' | 'blocked' | 'synced'

interface BlockingIssue {
  type: string
  severity: string
  code: string
  message: string
  details?: Record<string, unknown>
}

export default function InvoicesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set())
  const [compareInvoice, setCompareInvoice] = useState<{
    id: string
    qbId?: string
    status?: 'pending' | 'ready' | 'blocked' | 'synced'
  } | null>(null)
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set())
  const [showDashboard, setShowDashboard] = useState(false)

  // State for inline dialogs
  const [createCustomerFor, setCreateCustomerFor] = useState<{
    invoiceId: string
    organizationName: string
    organizationNumber?: string
    managerName?: string
    managerEmail?: string
  } | null>(null)
  const [createSkusFor, setCreateSkusFor] = useState<string | null>(null)

  // Fetch stats
  const { data: stats, refetch: refetchStats } = trpc.invoiceSync.stats.useQuery()

  // Fetch invoices with validation status
  const {
    data: invoices,
    isLoading,
    refetch: refetchInvoices,
  } = trpc.invoiceSync.list.useQuery({
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: searchQuery.trim() || undefined,
    limit: 100,
  })

  // Validate all pending mutation
  const validateAllPending = trpc.invoiceSync.validateAllPending.useMutation({
    onSuccess: () => {
      refetchStats()
      refetchInvoices()
    },
  })

  // Sync single invoice mutation
  const syncInvoice = trpc.invoiceSync.sync.useMutation({
    onSuccess: () => {
      refetchStats()
      refetchInvoices()
    },
  })

  // Sync batch mutation
  const syncBatch = trpc.invoiceSync.syncBatch.useMutation({
    onSuccess: () => {
      refetchStats()
      refetchInvoices()
      setSelectedInvoices(new Set())
    },
  })

  // Toggle invoice expansion
  const toggleExpanded = (invoiceId: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev)
      if (next.has(invoiceId)) {
        next.delete(invoiceId)
      } else {
        next.add(invoiceId)
      }
      return next
    })
  }

  // Toggle invoice selection
  const toggleSelected = (invoiceId: string) => {
    setSelectedInvoices((prev) => {
      const next = new Set(prev)
      if (next.has(invoiceId)) {
        next.delete(invoiceId)
      } else {
        next.add(invoiceId)
      }
      return next
    })
  }

  // Select all ready invoices
  const selectAllReady = () => {
    const readyIds =
      invoices?.filter((inv) => inv.validationStatus === 'ready').map((inv) => inv.id) || []
    setSelectedInvoices(new Set(readyIds))
  }

  // Format currency
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: currency || 'CAD',
    }).format(amount)
  }

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-CA')
  }

  // Count selected ready invoices
  const selectedReadyCount = useMemo(() => {
    if (!invoices) return 0
    return invoices.filter(
      (inv) => selectedInvoices.has(inv.id) && inv.validationStatus === 'ready'
    ).length
  }, [invoices, selectedInvoices])

  // QB Invoice URL
  const getQBInvoiceUrl = (qbInvoiceId: string) => {
    if (qbInvoiceId.startsWith('DUPLICATE:')) {
      const id = qbInvoiceId.replace('DUPLICATE:', '')
      return `https://qbo.intuit.com/app/invoice?txnId=${id}`
    }
    return `https://qbo.intuit.com/app/invoice?txnId=${qbInvoiceId}`
  }

  // Handle inline dialog success
  const handleInlineSuccess = () => {
    refetchStats()
    refetchInvoices()
  }

  // Check if blocking issue is for customer
  const hasCustomerMappingIssue = (issues: BlockingIssue[]) => {
    return issues.some((issue) => issue.code === 'CUSTOMER_NO_MAPPING')
  }

  // Check if blocking issue is for SKU
  const hasSkuMappingIssue = (issues: BlockingIssue[]) => {
    return issues.some((issue) => issue.code === 'SKU_NO_MAPPING' || issue.code === 'SKU_NOT_APPROVED')
  }

  // Get missing SKU count from blocking issues
  const getMissingSkuCount = (issues: BlockingIssue[]) => {
    const skuIssue = issues.find((issue) => issue.code === 'SKU_NO_MAPPING')
    return (skuIssue?.details?.count as number) || 0
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Invoice Sync</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDashboard(!showDashboard)}
          >
            {showDashboard ? 'Hide' : 'Show'} Dashboard
          </Button>
          {selectedReadyCount > 0 && (
            <Button
              onClick={() => syncBatch.mutate({ invoiceIds: Array.from(selectedInvoices) })}
              disabled={syncBatch.isPending}
            >
              <Send className="h-4 w-4 mr-2" />
              Sync Selected ({selectedReadyCount})
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => validateAllPending.mutate({})}
            disabled={validateAllPending.isPending}
          >
            <RefreshCw className={validateAllPending.isPending ? 'animate-spin mr-2' : 'mr-2'} />
            {validateAllPending.isPending ? 'Validating...' : 'Validate All'}
          </Button>
        </div>
      </div>

      {/* Dashboard Section */}
      {showDashboard && (
        <InvoiceDashboard className="mb-4" />
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats?.pending || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.ready || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Blocked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats?.blocked || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Synced</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats?.synced || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex items-center gap-4">
        {/* Search Input */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search invoice #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              onClick={() => setSearchQuery('')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filter:</span>
          {(['all', 'pending', 'ready', 'blocked', 'synced'] as const).map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Search results count */}
        {searchQuery && (
          <span className="text-sm text-muted-foreground">
            {invoices?.length || 0} result{(invoices?.length || 0) !== 1 ? 's' : ''}
          </span>
        )}

        {statusFilter === 'ready' && (
          <Button variant="outline" size="sm" onClick={selectAllReady}>
            Select All Ready
          </Button>
        )}
      </div>

      {/* Invoices Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Contractual Manager</TableHead>
                <TableHead>QB Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Match</TableHead>
                <TableHead className="text-center">Synced</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !invoices?.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    {searchQuery
                      ? `No invoices found matching "${searchQuery}"`
                      : 'No invoices found. Invoices from ATEK will appear here once available.'}
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => {
                  const isExpanded = expandedInvoices.has(invoice.id)
                  const isSelected = selectedInvoices.has(invoice.id)
                  const blockingIssues = (invoice.blockingIssues || []) as BlockingIssue[]
                  const isSynced = invoice.validationStatus === 'synced'
                  const isReady = invoice.validationStatus === 'ready'
                  const isBlocked = invoice.validationStatus === 'blocked'

                  return (
                    <>
                      <TableRow
                        key={invoice.id}
                        className={isSelected ? 'bg-muted/50' : undefined}
                      >
                        <TableCell>
                          {isReady && !isSynced && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelected(invoice.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          )}
                          {isBlocked && blockingIssues?.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => toggleExpanded(invoice.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {invoice.organizationNumber && (
                              <span className="text-muted-foreground">{invoice.organizationNumber} </span>
                            )}
                            {invoice.organizationName || '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {invoice.contractualManagerName || invoice.contractualManagerId || '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          {invoice.quickbooksCustomerName ? (
                            <div className="text-sm font-medium text-green-600">
                              {invoice.quickbooksCustomerName}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">Not Mapped</div>
                          )}
                        </TableCell>
                        <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(invoice.totalAmount, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-center">
                          <InvoiceMatchPreview
                            matchScore={invoice.matchScore}
                            onClick={() =>
                              setCompareInvoice({
                                id: invoice.id,
                                qbId: invoice.quickbooksInvoiceId || undefined,
                                status: invoice.validationStatus as 'pending' | 'ready' | 'blocked' | 'synced',
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          {isSynced && invoice.quickbooksInvoiceId ? (
                            <div className="flex items-center justify-center gap-1">
                              <Lock className="h-4 w-4 text-green-600" />
                              <a
                                href={getQBInvoiceUrl(invoice.quickbooksInvoiceId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800"
                                title="Open in QuickBooks"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setCompareInvoice({
                                  id: invoice.id,
                                  qbId: invoice.quickbooksInvoiceId || undefined,
                                  status: invoice.validationStatus as 'pending' | 'ready' | 'blocked' | 'synced',
                                })
                              }
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {isReady && !invoice.quickbooksInvoiceId && (
                              <Button
                                size="sm"
                                onClick={() => syncInvoice.mutate({ invoiceId: invoice.id })}
                                disabled={syncInvoice.isPending || isSynced}
                              >
                                <Send className="h-4 w-4 mr-1" />
                                Sync
                              </Button>
                            )}
                            {isBlocked && (
                              <AlertCircle className="h-4 w-4 text-red-500" />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded row for blocking issues */}
                      {isExpanded && blockingIssues?.length > 0 && (
                        <TableRow key={`${invoice.id}-issues`}>
                          <TableCell colSpan={10} className="bg-muted/30 py-3">
                            <div className="pl-8 space-y-3">
                              <div className="text-sm font-medium text-red-600">
                                Blocking Issues:
                              </div>
                              <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
                                {blockingIssues.map((issue, idx) => (
                                  <li key={idx}>
                                    <span className="font-mono text-xs bg-muted px-1 rounded">
                                      {issue.code}
                                    </span>
                                    : {issue.message}
                                  </li>
                                ))}
                              </ul>

                              {/* Inline action buttons */}
                              <div className="flex items-center gap-2 pt-2">
                                {hasCustomerMappingIssue(blockingIssues) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setCreateCustomerFor({
                                        invoiceId: invoice.id,
                                        organizationName: invoice.organizationName || '',
                                        organizationNumber: invoice.organizationNumber || undefined,
                                        managerName: invoice.contractualManagerName || undefined,
                                        managerEmail: undefined, // We don't have this in the list
                                      })
                                    }
                                  >
                                    <UserPlus className="h-4 w-4 mr-1" />
                                    Create QB Customer
                                  </Button>
                                )}
                                {hasSkuMappingIssue(blockingIssues) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setCreateSkusFor(invoice.id)}
                                  >
                                    <Package className="h-4 w-4 mr-1" />
                                    Create Missing SKUs ({getMissingSkuCount(blockingIssues)})
                                  </Button>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invoice Compare Dialog */}
      <InvoiceCompareDialog
        open={!!compareInvoice}
        onOpenChange={(open) => !open && setCompareInvoice(null)}
        atekInvoiceId={compareInvoice?.id || ''}
        qbInvoiceId={compareInvoice?.qbId}
        validationStatus={compareInvoice?.status}
        onSyncSuccess={handleInlineSuccess}
      />

      {/* Inline Customer Create Dialog */}
      <InlineCustomerCreateDialog
        open={!!createCustomerFor}
        onOpenChange={(open) => !open && setCreateCustomerFor(null)}
        invoiceId={createCustomerFor?.invoiceId || ''}
        organizationName={createCustomerFor?.organizationName || ''}
        organizationNumber={createCustomerFor?.organizationNumber}
        managerName={createCustomerFor?.managerName}
        managerEmail={createCustomerFor?.managerEmail}
        onSuccess={handleInlineSuccess}
      />

      {/* Inline SKU Create Dialog */}
      <InlineSkuCreateDialog
        open={!!createSkusFor}
        onOpenChange={(open) => !open && setCreateSkusFor(null)}
        invoiceId={createSkusFor || ''}
        onSuccess={handleInlineSuccess}
      />
    </div>
  )
}
