import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Check, X, ExternalLink, AlertCircle, Send, Loader2, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InvoiceCompareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  atekInvoiceId: string
  qbInvoiceId?: string
  validationStatus?: 'pending' | 'ready' | 'blocked' | 'synced'
  onSyncSuccess?: () => void
}

// Quebec tax rates
const GST_RATE = 0.05 // 5%
const QST_RATE = 0.09975 // 9.975%
const TOTAL_TAX_RATE = GST_RATE + QST_RATE // ~14.975%

export function InvoiceCompareDialog({
  open,
  onOpenChange,
  atekInvoiceId,
  qbInvoiceId,
  validationStatus,
  onSyncSuccess,
}: InvoiceCompareDialogProps) {
  const utils = trpc.useUtils()

  // State for customer override
  const [selectedQbCustomerId, setSelectedQbCustomerId] = useState<string | undefined>()

  const { data, isLoading, refetch: refetchCompare } = trpc.invoiceSync.compare.useQuery(
    { atekInvoiceId, qbInvoiceId },
    { enabled: open && !!atekInvoiceId }
  )

  // Fetch QB customers for selector
  const { data: qbCustomers } = trpc.quickbooks.customers.list.useQuery(
    { activeOnly: true },
    { enabled: open }
  )

  // Reset selected customer when dialog opens or data changes
  useEffect(() => {
    if (open && data?.qb?.customerId) {
      setSelectedQbCustomerId(data.qb.customerId)
    } else if (!open) {
      setSelectedQbCustomerId(undefined)
    }
  }, [open, data?.qb?.customerId])

  // Fetch validation status if not provided
  const { data: validationData } = trpc.invoiceSync.getValidationStatus.useQuery(
    { invoiceId: atekInvoiceId },
    { enabled: open && !!atekInvoiceId && !validationStatus }
  )

  const currentStatus = validationStatus || validationData?.validationStatus || 'pending'
  const isSynced = currentStatus === 'synced'
  const isReady = currentStatus === 'ready'

  // Sync mutation
  const syncInvoice = trpc.invoiceSync.sync.useMutation({
    onSuccess: (data) => {
      if (!data.success) return
      utils.invoiceSync.list.invalidate()
      utils.invoiceSync.stats.invalidate()
      utils.invoiceSync.getDashboardStats.invalidate()
      utils.invoiceSync.getValidationStatus.invalidate()
      // Force immediate refetch of this dialog's compare data to show fresh QB values
      refetchCompare()
      onSyncSuccess?.()
    },
  })

  // Build customer options for selector
  const customerOptions = (qbCustomers || []).map((c) => ({
    value: c.Id,
    label: c.DisplayName,
  }))

  const formatCurrency = (amount: number | undefined | null) => {
    if (amount === undefined || amount === null) return '-'
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  const formatQBAddress = (addr: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  } | null) => {
    if (!addr) return '-'
    const parts = [
      addr.line1,
      addr.line2,
      [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '),
      addr.country,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join('\n') : '-'
  }

  // Calculate tax from subtotal (Quebec rates)
  const calculateTaxFromSubtotal = (subtotal: number) => {
    return subtotal * TOTAL_TAX_RATE
  }

  // ATEK link
  const atekUrl = data?.atek?.id
    ? `https://app.atek.io/app?v=1011326#/invoices?id=${data.atek.id}`
    : null

  // QB link
  const qbUrl = data?.qb?.id
    ? `https://qbo.intuit.com/app/invoice?txnId=${data.qb.id}`
    : null

  // Calculate ATEK tax - ALWAYS calculate expected Quebec tax from subtotal
  // This ensures proper comparison with QB even when ATEK shows taxAmount: 0
  const atekSubtotal = data?.atek?.subtotal || 0

  // Always calculate expected tax on ATEK side (Quebec rates: GST 5% + QST 9.975%)
  const atekExpectedTax = calculateTaxFromSubtotal(atekSubtotal)
  const atekReportedTax = data?.atek?.taxAmount || 0
  // Use expected tax for comparison, but show both if different
  const atekTax = atekExpectedTax
  const atekTotal = atekSubtotal + atekTax

  // Format ATEK customer name with org number prefix
  const formatAtekCustomerName = () => {
    if (!data?.atek) return '-'
    const orgNum = data.atek.orgNumber
    const name = data.atek.customerName
    if (orgNum && name) {
      // Check if name already starts with org number
      if (name.startsWith(orgNum)) return name
      return `${orgNum} ${name}`
    }
    return name || '-'
  }

  // Comparison helpers
  const compareStrings = (a: string | null | undefined, b: string | null | undefined) => {
    const normalize = (s: string | null | undefined) => (s || '').toLowerCase().trim()
    return normalize(a) === normalize(b)
  }

  const compareNumbers = (a: number | null | undefined, b: number | null | undefined, tolerance = 0.01) => {
    if (a === null || a === undefined || b === null || b === undefined) return false
    return Math.abs(a - b) <= tolerance
  }

  const compareDates = (a: string | null | undefined, b: string | null | undefined) => {
    if (!a || !b) return false
    return a === b
  }

  // Compare addresses (normalize and compare key parts)
  const compareAddresses = (atekAddr: string | null | undefined, qbAddr: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  } | null) => {
    if (!atekAddr || !qbAddr) return false
    // Normalize ATEK address (remove extra whitespace, lowercase)
    const normalizedAtek = atekAddr.toLowerCase().replace(/\s+/g, ' ').trim()
    // Build QB address string and normalize
    const qbParts = [qbAddr.line1, qbAddr.line2, qbAddr.city, qbAddr.state, qbAddr.postalCode, qbAddr.country]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
    // Check if they share significant content (city + postal code at minimum)
    const atekHasCity = qbAddr.city && normalizedAtek.includes(qbAddr.city.toLowerCase())
    // Remove spaces from BOTH when comparing postal codes (e.g., "H3A 2M7" vs "H3A2M7")
    const atekAddrNoSpaces = normalizedAtek.replace(/\s/g, '')
    const qbPostalNoSpaces = qbAddr.postalCode?.toLowerCase().replace(/\s/g, '')
    const atekHasPostal = qbPostalNoSpaces && atekAddrNoSpaces.includes(qbPostalNoSpaces)
    return atekHasCity && atekHasPostal
  }

  // Compare emails (case insensitive)
  const compareEmails = (a: string | null | undefined, b: string | null | undefined) => {
    if (!a || !b || a === '-' || b === '-') return false
    return a.toLowerCase().trim() === b.toLowerCase().trim()
  }

  // Calculate matching score
  const calculateMatchScore = () => {
    if (!data?.atek || !data?.qb) return 0

    const checks = [
      { match: compareStrings(data.atek.invoiceNumber, data.qb.invoiceNumber), weight: 2 },
      { match: compareStrings(data.atek.customerName, data.qb.customerName), weight: 2 },
      { match: compareEmails(data.atek.billingEmail, data.qb.customerEmail), weight: 1 },
      { match: compareAddresses(data.atek.billingAddress, data.qb.billingAddress), weight: 1 },
      { match: compareAddresses(data.atek.shippingAddresses?.[0]?.address, data.qb.shippingAddress), weight: 1 },
      { match: compareDates(data.atek.issueDate, data.qb.issueDate), weight: 1 },
      { match: compareDates(data.atek.dueDate, data.qb.dueDate), weight: 1 },
      { match: compareNumbers(atekSubtotal, data.qb.subtotal), weight: 2 },
      { match: compareNumbers(atekTax, data.qb.taxAmount, 1), weight: 1 },
      { match: compareNumbers(atekTotal, data.qb.total, 1), weight: 2 },
      { match: (data.atek.lineItems?.length || 0) === (data.qb.lineItems?.length || 0), weight: 1 },
    ]

    const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0)
    const matchedWeight = checks.reduce((sum, c) => sum + (c.match ? c.weight : 0), 0)

    return Math.round((matchedWeight / totalWeight) * 100)
  }

  const matchScore = data?.qb ? calculateMatchScore() : 0

  // Match indicator component
  const MatchIndicator = ({ match }: { match: boolean }) => (
    match ? (
      <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
    ) : (
      <X className="h-4 w-4 text-red-500 flex-shrink-0" />
    )
  )

  // Comparison row component with difference highlighting
  const CompareRow = ({
    label,
    atekValue,
    qbValue,
    match,
    className,
    highlightDiff = true
  }: {
    label: string
    atekValue: React.ReactNode
    qbValue: React.ReactNode
    match?: boolean
    className?: string
    highlightDiff?: boolean
  }) => {
    // Determine cell background based on match status
    const getCellBg = () => {
      if (match === undefined || !highlightDiff) return ''
      return match
        ? 'bg-green-50 dark:bg-green-950/30'
        : 'bg-red-50 dark:bg-red-950/30'
    }

    return (
      <tr className={cn("border-b", className)}>
        <td className="py-2 px-3 font-medium text-sm text-muted-foreground w-[140px]">{label}</td>
        <td className={cn("py-2 px-3 text-sm", getCellBg())}>{atekValue}</td>
        <td className={cn("py-2 px-3 text-sm", getCellBg())}>{qbValue}</td>
        <td className="py-2 px-3 text-center w-[40px]">
          {match !== undefined && <MatchIndicator match={match} />}
        </td>
      </tr>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Invoice Comparison</span>
            {data?.qb && (
              <div className="flex items-center gap-2">
                <Badge
                  variant={matchScore >= 90 ? "default" : matchScore >= 70 ? "secondary" : "destructive"}
                  className={cn(
                    "text-lg px-3 py-1",
                    matchScore >= 90 && "bg-green-500",
                    matchScore >= 70 && matchScore < 90 && "bg-yellow-500",
                    matchScore < 70 && "bg-red-500"
                  )}
                >
                  {matchScore}% Match
                </Badge>
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-8">Loading...</div>
        ) : data?.error ? (
          <div className="text-center py-8 text-red-500">{data.error}</div>
        ) : !data?.atek ? (
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">ATEK invoice not found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* No QB invoice notice */}
            {!data?.qb && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800">No matching QuickBooks invoice found</p>
                  <p className="text-xs text-amber-600">Invoice #{data?.atek?.invoiceNumber} has not been synced to QuickBooks yet.</p>
                </div>
              </div>
            )}

            {/* Main comparison table */}
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="py-2 px-3 text-left text-sm font-semibold">Field</th>
                  <th className="py-2 px-3 text-left text-sm font-semibold">
                    <Badge variant="secondary">ATEK</Badge>
                  </th>
                  <th className="py-2 px-3 text-left text-sm font-semibold">
                    <Badge variant="outline" className="text-green-600 border-green-600">QB</Badge>
                  </th>
                  <th className="py-2 px-3 text-center text-sm font-semibold w-[40px]">✓</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow
                  label="Invoice #"
                  atekValue={
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{data.atek?.invoiceNumber || '-'}</span>
                      {atekUrl && (
                        <a
                          href={atekUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                          title="Open in ATEK"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  }
                  qbValue={
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{data.qb?.invoiceNumber || '-'}</span>
                      {qbUrl && (
                        <a
                          href={qbUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                          title="Open in QuickBooks"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  }
                  match={data.qb ? compareStrings(data.atek?.invoiceNumber, data.qb?.invoiceNumber) : undefined}
                />
                <CompareRow
                  label="Customer"
                  atekValue={<div className="font-medium">{formatAtekCustomerName()}</div>}
                  qbValue={
                    <div className="font-medium">
                      {syncInvoice.isPending ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Updating...</span>
                        </div>
                      ) : !isSynced ? (
                        <Select
                          options={customerOptions}
                          value={selectedQbCustomerId}
                          onChange={setSelectedQbCustomerId}
                          placeholder="Select QB Customer..."
                          searchable
                          className="w-full min-w-[200px]"
                        />
                      ) : (
                        data.qb?.customerName || '-'
                      )}
                    </div>
                  }
                  match={data.qb ? compareStrings(data.atek?.customerName, data.qb?.customerName) : undefined}
                />
                <CompareRow
                  label="Manager"
                  atekValue={
                    data.atek?.contractualManager ? (
                      <div>
                        <div>{data.atek.contractualManager.name}</div>
                      </div>
                    ) : '-'
                  }
                  qbValue="-"
                />
                <CompareRow
                  label="Billing Email"
                  atekValue={data.atek?.billingEmail || '-'}
                  qbValue={data.qb?.customerEmail && data.qb.customerEmail !== '-' ? data.qb.customerEmail : '-'}
                  match={data.qb ? compareEmails(data.atek?.billingEmail, data.qb?.customerEmail) : undefined}
                />
                <CompareRow
                  label="Billing Address"
                  atekValue={<div className="whitespace-pre-line text-xs">{data.atek?.billingAddress || '-'}</div>}
                  qbValue={<div className="whitespace-pre-line text-xs">{data.qb ? formatQBAddress(data.qb?.billingAddress) : '-'}</div>}
                  match={data.qb ? compareAddresses(data.atek?.billingAddress, data.qb?.billingAddress) : undefined}
                />
                <CompareRow
                  label="Shipping Address"
                  atekValue={
                    <div className="whitespace-pre-line text-xs">
                      {data.atek?.shippingAddresses && data.atek.shippingAddresses.length > 0
                        ? data.atek.shippingAddresses.map(a => a.address).join('\n---\n')
                        : '-'}
                    </div>
                  }
                  qbValue={<div className="whitespace-pre-line text-xs">{data.qb ? formatQBAddress(data.qb?.shippingAddress) : '-'}</div>}
                  match={data.qb ? compareAddresses(
                    data.atek?.shippingAddresses?.[0]?.address,
                    data.qb?.shippingAddress
                  ) : undefined}
                />
                <CompareRow
                  label="Issue Date"
                  atekValue={data.atek?.issueDate || '-'}
                  qbValue={data.qb?.issueDate || '-'}
                  match={data.qb ? compareDates(data.atek?.issueDate, data.qb?.issueDate) : undefined}
                />
                <CompareRow
                  label="Due Date"
                  atekValue={data.atek?.dueDate || '-'}
                  qbValue={data.qb?.dueDate || '-'}
                  match={data.qb ? compareDates(data.atek?.dueDate, data.qb?.dueDate) : undefined}
                />
                <CompareRow
                  label="PO Number"
                  atekValue={data.atek?.poNumber || '-'}
                  qbValue="-"
                />
                <CompareRow
                  label="Line Items"
                  atekValue={`${data.atek?.lineItems?.length || 0} items`}
                  qbValue={data.qb ? `${data.qb?.lineItems?.length || 0} items` : '-'}
                  match={data.qb ? (data.atek?.lineItems?.length || 0) === (data.qb?.lineItems?.length || 0) : undefined}
                />
                <CompareRow
                  label="Subtotal"
                  atekValue={formatCurrency(atekSubtotal)}
                  qbValue={data.qb ? formatCurrency(data.qb?.subtotal) : '-'}
                  match={data.qb ? compareNumbers(atekSubtotal, data.qb?.subtotal) : undefined}
                  className="bg-muted/30"
                />
                <CompareRow
                  label="Tax (GST+QST)"
                  atekValue={
                    <div>
                      <span>{formatCurrency(atekTax)}</span>
                      {atekReportedTax === 0 && atekTax > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">(calculated)</span>
                      )}
                    </div>
                  }
                  qbValue={data.qb ? formatCurrency(data.qb?.taxAmount) : '-'}
                  match={data.qb ? compareNumbers(atekTax, data.qb?.taxAmount, 1) : undefined}
                  className="bg-muted/30"
                />
                <CompareRow
                  label="Total"
                  atekValue={<span className="font-bold text-lg">{formatCurrency(atekTotal)}</span>}
                  qbValue={data.qb ? <span className="font-bold text-lg">{formatCurrency(data.qb?.total)}</span> : '-'}
                  match={data.qb ? compareNumbers(atekTotal, data.qb?.total, 1) : undefined}
                  className="bg-muted/30"
                />
              </tbody>
            </table>

            {/* Line Items Comparison */}
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Line Items {data.qb ? 'Comparison' : ''}</h3>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2 w-[80px]">ATEK SKU</th>
                      <th className="text-left p-2">ATEK Description</th>
                      <th className="text-right p-2 w-[40px]">Qty</th>
                      <th className="text-right p-2 w-[70px]">Price</th>
                      <th className="text-right p-2 w-[70px]">Amt</th>
                      <th className="text-left p-2 w-[80px] border-l-2">QB SKU</th>
                      <th className="text-left p-2">QB Description</th>
                      <th className="text-right p-2 w-[40px]">Qty</th>
                      <th className="text-right p-2 w-[70px]">Price</th>
                      <th className="text-right p-2 w-[70px]">Amt</th>
                      <th className="text-center p-2 w-[40px] border-l-2 bg-muted/70">✓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const atekItems = data.atek?.lineItems || []
                      const qbItems = data.qb?.lineItems || []
                      const maxLen = Math.max(atekItems.length, qbItems.length, 1)
                      const rows = []

                      for (let i = 0; i < maxLen; i++) {
                        const atekItem = atekItems[i]
                        const qbItem = qbItems[i]

                        // Check if amounts match (only when both exist)
                        const amountsMatch = data.qb && atekItem && qbItem &&
                          compareNumbers(atekItem.amount, qbItem.amount, 0.01) &&
                          compareNumbers(atekItem.quantity, qbItem.quantity, 0.01)

                        // Extract SKU code from ATEK - only the code
                        const getAtekSku = () => {
                          if (!atekItem) return '-'
                          return atekItem.skuCode || '-'
                        }

                        // Get SKU code from QB item (fetched from Item record)
                        const getQbSku = () => {
                          if (!qbItem) return '-'
                          // Use the actual Sku field from the Item record
                          return qbItem.sku || '-'
                        }

                        // Row background based on match status
                        const rowBg = data.qb && atekItem && qbItem
                          ? amountsMatch
                            ? 'bg-green-50 dark:bg-green-950/30'
                            : 'bg-red-50 dark:bg-red-950/30'
                          : ''

                        rows.push(
                          <tr key={i} className={cn("border-t", rowBg)}>
                            <td className="p-2 text-xs font-mono text-muted-foreground" title={atekItem?.skuCode || atekItem?.skuName || ''}>
                              {getAtekSku()}
                            </td>
                            <td className="p-2 max-w-[150px] truncate" title={atekItem?.description}>
                              {atekItem?.description || '-'}
                            </td>
                            <td className="p-2 text-right">{atekItem?.quantity ?? '-'}</td>
                            <td className="p-2 text-right">{atekItem ? formatCurrency(atekItem.unitPrice) : '-'}</td>
                            <td className="p-2 text-right">{atekItem ? formatCurrency(atekItem.amount) : '-'}</td>
                            <td className="p-2 text-xs font-mono text-muted-foreground border-l-2" title={qbItem?.itemName || ''}>
                              {getQbSku()}
                            </td>
                            <td className="p-2 max-w-[150px] truncate" title={qbItem?.description}>
                              {qbItem?.description || '-'}
                            </td>
                            <td className="p-2 text-right">{qbItem?.quantity ?? '-'}</td>
                            <td className="p-2 text-right">{qbItem ? formatCurrency(qbItem.unitPrice) : '-'}</td>
                            <td className="p-2 text-right">{qbItem ? formatCurrency(qbItem.amount) : '-'}</td>
                            <td className="p-2 text-center border-l-2">
                              {data.qb && atekItem && qbItem && (
                                amountsMatch ? (
                                  <Check className="h-4 w-4 text-green-500 inline" />
                                ) : (
                                  <X className="h-4 w-4 text-red-500 inline" />
                                )
                              )}
                            </td>
                          </tr>
                        )
                      }
                      return rows
                    })()}
                  </tbody>
                  <tfoot className="bg-muted/50 font-medium">
                    <tr>
                      <td colSpan={4} className="p-2 text-right">ATEK Subtotal:</td>
                      <td className="p-2 text-right">{formatCurrency(atekSubtotal)}</td>
                      <td colSpan={4} className="p-2 text-right border-l-2">QB Subtotal:</td>
                      <td className="p-2 text-right">{data.qb ? formatCurrency(data.qb?.subtotal) : '-'}</td>
                      <td className="border-l-2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Notes */}
            {(data.atek?.notes || data.qb?.memo) && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-1">ATEK Notes</h4>
                  <p className="text-sm whitespace-pre-line bg-muted/30 p-2 rounded">{data.atek?.notes || '-'}</p>
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-1">QB Memo</h4>
                  <p className="text-sm bg-muted/30 p-2 rounded">{data.qb?.memo || '-'}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer with actions */}
        <DialogFooter className="gap-2 sm:gap-0 mt-6 pt-4 border-t">
          {/* Synced status badge */}
          {isSynced && (
            <div className="flex items-center gap-2 mr-auto text-sm text-muted-foreground">
              <Lock className="h-4 w-4 text-green-600" />
              <span>This invoice has been synced to QuickBooks</span>
            </div>
          )}

          {/* Error display */}
          {(syncInvoice.isError || (syncInvoice.isSuccess && !syncInvoice.data?.success)) && (
            <div className="mr-auto text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {syncInvoice.error?.message || syncInvoice.data?.error || 'Failed to sync'}
            </div>
          )}

          {/* Success message */}
          {syncInvoice.isSuccess && syncInvoice.data?.success && (
            <div className="mr-auto text-sm text-green-600 flex items-center gap-1">
              <Check className="h-4 w-4" />
              Invoice synced successfully!
            </div>
          )}

          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          {/* Sync/Update button */}
          {/* Show for: not synced invoices, OR synced invoices with QB data (to allow fixing taxes/addresses) */}
          {(!isSynced || data?.qb) && (
            <Button
              onClick={() => syncInvoice.mutate({
                invoiceId: atekInvoiceId,
                qbCustomerId: selectedQbCustomerId,
              })}
              disabled={syncInvoice.isPending || (currentStatus === 'blocked' && !data?.qb)}
              variant={isReady || data?.qb ? 'default' : 'secondary'}
              title={currentStatus === 'blocked' && !data?.qb ? 'Resolve blocking issues before syncing' : undefined}
            >
              {syncInvoice.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isSynced ? 'Updating...' : 'Syncing...'}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {data?.qb ? 'Update in QuickBooks' : 'Push to QuickBooks'}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
