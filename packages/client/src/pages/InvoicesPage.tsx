import { useState, useMemo } from 'react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Check, RefreshCw, Filter, AlertCircle, Send, ChevronDown, ChevronRight, Eye } from 'lucide-react'
import { InvoiceCompareDialog } from '@/components/InvoiceCompareDialog'

type StatusFilter = 'all' | 'pending' | 'ready' | 'blocked' | 'synced'

export default function InvoicesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set())
  const [compareInvoice, setCompareInvoice] = useState<{ id: string; qbId?: string } | null>(null)
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set())

  // Fetch stats
  const { data: stats, refetch: refetchStats } = trpc.invoiceSync.stats.useQuery()

  // Fetch invoices with validation status
  const {
    data: invoices,
    isLoading,
    refetch: refetchInvoices,
  } = trpc.invoiceSync.list.useQuery(
    statusFilter === 'all' ? { limit: 100 } : { status: statusFilter, limit: 100 }
  )

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

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Invoice Sync</h1>
        <div className="flex items-center gap-2">
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
        <div className="flex-1" />
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
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !invoices?.length ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    No invoices found. Invoices from ATEK will appear here once available.
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => {
                  const isExpanded = expandedInvoices.has(invoice.id)
                  const isSelected = selectedInvoices.has(invoice.id)
                  const blockingIssues = invoice.blockingIssues as Array<{
                    code: string
                    message: string
                  }>

                  return (
                    <>
                      <TableRow
                        key={invoice.id}
                        className={isSelected ? 'bg-muted/50' : undefined}
                      >
                        <TableCell>
                          {invoice.validationStatus === 'ready' && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelected(invoice.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          )}
                          {invoice.validationStatus === 'blocked' && blockingIssues?.length > 0 && (
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setCompareInvoice({
                              id: invoice.id,
                              qbId: invoice.quickbooksInvoiceId || undefined
                            })}
                          >
                            {invoice.matchScore !== null ? (
                              <Badge
                                variant={invoice.matchScore >= 90 ? 'default' : invoice.matchScore >= 70 ? 'secondary' : 'destructive'}
                                className={
                                  invoice.matchScore >= 90 ? 'bg-green-500' :
                                  invoice.matchScore >= 70 ? 'bg-yellow-500' :
                                  'bg-red-500'
                                }
                              >
                                {invoice.matchScore}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">No QB</span>
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCompareInvoice({
                                id: invoice.id,
                                qbId: invoice.quickbooksInvoiceId || undefined
                              })}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {invoice.validationStatus === 'ready' && !invoice.quickbooksInvoiceId && (
                              <Button
                                size="sm"
                                onClick={() => syncInvoice.mutate({ invoiceId: invoice.id })}
                                disabled={syncInvoice.isPending}
                              >
                                <Send className="h-4 w-4 mr-1" />
                                Sync
                              </Button>
                            )}
                            {invoice.validationStatus === 'blocked' && (
                              <AlertCircle className="h-4 w-4 text-red-500" />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded row for blocking issues */}
                      {isExpanded && blockingIssues?.length > 0 && (
                        <TableRow key={`${invoice.id}-issues`}>
                          <TableCell colSpan={9} className="bg-muted/30 py-2">
                            <div className="pl-8 space-y-1">
                              <div className="text-sm font-medium text-red-600">
                                Blocking Issues:
                              </div>
                              <ul className="text-sm text-muted-foreground list-disc pl-4">
                                {blockingIssues.map((issue, idx) => (
                                  <li key={idx}>
                                    <span className="font-mono text-xs bg-muted px-1 rounded">
                                      {issue.code}
                                    </span>
                                    : {issue.message}
                                  </li>
                                ))}
                              </ul>
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
      />
    </div>
  )
}
