import { trpc } from '@/lib/trpc'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Check, X, ExternalLink, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InvoiceCompareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  atekInvoiceId: string
  qbInvoiceId?: string
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
}: InvoiceCompareDialogProps) {
  const { data, isLoading } = trpc.invoiceSync.compare.useQuery(
    { atekInvoiceId, qbInvoiceId },
    { enabled: open && !!atekInvoiceId }
  )

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

  // Calculate ATEK tax - always calculate from subtotal if not provided
  const atekSubtotal = data?.atek?.subtotal || 0

  // Always calculate tax on ATEK side (Quebec rates)
  const atekTax = data?.atek?.taxAmount || calculateTaxFromSubtotal(atekSubtotal)
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
    const atekHasPostal = qbAddr.postalCode && normalizedAtek.includes(qbAddr.postalCode.toLowerCase().replace(/\s/g, ''))
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

  // Comparison row component
  const CompareRow = ({
    label,
    atekValue,
    qbValue,
    match,
    className
  }: {
    label: string
    atekValue: React.ReactNode
    qbValue: React.ReactNode
    match?: boolean
    className?: string
  }) => (
    <tr className={cn("border-b", className)}>
      <td className="py-2 px-3 font-medium text-sm text-muted-foreground w-[140px]">{label}</td>
      <td className="py-2 px-3 text-sm">{atekValue}</td>
      <td className="py-2 px-3 text-sm">{qbValue}</td>
      <td className="py-2 px-3 text-center w-[40px]">
        {match !== undefined && <MatchIndicator match={match} />}
      </td>
    </tr>
  )

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
        ) : !data?.qb ? (
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No matching QuickBooks invoice found</p>
            <p className="text-sm text-muted-foreground mt-2">
              Invoice #{data?.atek?.invoiceNumber} has not been synced to QuickBooks yet.
            </p>
            {atekUrl && (
              <a
                href={atekUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 mt-4"
              >
                Open in ATEK <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-4">
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
                  match={compareStrings(data.atek?.invoiceNumber, data.qb?.invoiceNumber)}
                />
                <CompareRow
                  label="Customer"
                  atekValue={<div className="font-medium">{formatAtekCustomerName()}</div>}
                  qbValue={<div className="font-medium">{data.qb?.customerName}</div>}
                  match={compareStrings(data.atek?.customerName, data.qb?.customerName)}
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
                  match={compareEmails(data.atek?.billingEmail, data.qb?.customerEmail)}
                />
                <CompareRow
                  label="Billing Address"
                  atekValue={<div className="whitespace-pre-line text-xs">{data.atek?.billingAddress || '-'}</div>}
                  qbValue={<div className="whitespace-pre-line text-xs">{formatQBAddress(data.qb?.billingAddress)}</div>}
                  match={compareAddresses(data.atek?.billingAddress, data.qb?.billingAddress)}
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
                  qbValue={<div className="whitespace-pre-line text-xs">{formatQBAddress(data.qb?.shippingAddress)}</div>}
                  match={compareAddresses(
                    data.atek?.shippingAddresses?.[0]?.address,
                    data.qb?.shippingAddress
                  )}
                />
                <CompareRow
                  label="Issue Date"
                  atekValue={data.atek?.issueDate || '-'}
                  qbValue={data.qb?.issueDate || '-'}
                  match={compareDates(data.atek?.issueDate, data.qb?.issueDate)}
                />
                <CompareRow
                  label="Due Date"
                  atekValue={data.atek?.dueDate || '-'}
                  qbValue={data.qb?.dueDate || '-'}
                  match={compareDates(data.atek?.dueDate, data.qb?.dueDate)}
                />
                <CompareRow
                  label="PO Number"
                  atekValue={data.atek?.poNumber || '-'}
                  qbValue="-"
                />
                <CompareRow
                  label="Line Items"
                  atekValue={`${data.atek?.lineItems?.length || 0} items`}
                  qbValue={`${data.qb?.lineItems?.length || 0} items`}
                  match={(data.atek?.lineItems?.length || 0) === (data.qb?.lineItems?.length || 0)}
                />
                <CompareRow
                  label="Subtotal"
                  atekValue={formatCurrency(atekSubtotal)}
                  qbValue={formatCurrency(data.qb?.subtotal)}
                  match={compareNumbers(atekSubtotal, data.qb?.subtotal)}
                  className="bg-muted/30"
                />
                <CompareRow
                  label="Tax (GST+QST)"
                  atekValue={formatCurrency(atekTax)}
                  qbValue={formatCurrency(data.qb?.taxAmount)}
                  match={compareNumbers(atekTax, data.qb?.taxAmount, 1)}
                  className="bg-muted/30"
                />
                <CompareRow
                  label="Total"
                  atekValue={<span className="font-bold text-lg">{formatCurrency(atekTotal)}</span>}
                  qbValue={<span className="font-bold text-lg">{formatCurrency(data.qb?.total)}</span>}
                  match={compareNumbers(atekTotal, data.qb?.total, 1)}
                  className="bg-muted/30"
                />
              </tbody>
            </table>

            {/* Line Items Comparison */}
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Line Items Comparison</h3>
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
                      const maxLen = Math.max(atekItems.length, qbItems.length)
                      const rows = []

                      for (let i = 0; i < maxLen; i++) {
                        const atekItem = atekItems[i]
                        const qbItem = qbItems[i]

                        // Check if amounts match
                        const amountsMatch = atekItem && qbItem &&
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

                        rows.push(
                          <tr key={i} className="border-t">
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
                              {atekItem && qbItem && (
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
                      <td className="p-2 text-right">{formatCurrency(data.qb?.subtotal)}</td>
                      <td className="border-l-2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Notes */}
            {(data.atek?.notes || data.qb?.memo) && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                {data.atek?.notes && (
                  <div>
                    <h4 className="font-semibold text-sm text-muted-foreground mb-1">ATEK Notes</h4>
                    <p className="text-sm whitespace-pre-line bg-muted/30 p-2 rounded">{data.atek.notes}</p>
                  </div>
                )}
                {data.qb?.memo && (
                  <div>
                    <h4 className="font-semibold text-sm text-muted-foreground mb-1">QB Memo</h4>
                    <p className="text-sm bg-muted/30 p-2 rounded">{data.qb.memo}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
