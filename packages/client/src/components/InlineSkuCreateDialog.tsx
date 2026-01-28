import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Check, Loader2, Package } from 'lucide-react'

type ItemType = 'Service' | 'NonInventory' | 'Inventory'

interface MissingSku {
  skuId: string
  skuCode: string | null
  skuName: string | null
  description: string | null
  unitPrice: number
  reason: 'no_mapping' | 'not_approved' | 'needs_creation'
}

interface SkuFormData {
  selected: boolean
  qbItemName: string
  qbItemType: ItemType
  unitPrice: string
  incomeAccountId: string
}

interface InlineSkuCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  onSuccess?: () => void
}

const itemTypeOptions = [
  { value: 'Service', label: 'Service' },
  { value: 'NonInventory', label: 'Non-Inventory' },
  { value: 'Inventory', label: 'Inventory' },
]

export function InlineSkuCreateDialog({
  open,
  onOpenChange,
  invoiceId,
  onSuccess,
}: InlineSkuCreateDialogProps) {
  const utils = trpc.useUtils()

  // Fetch missing SKUs for this invoice
  const { data: missingSkus, isLoading: loadingSkus } = trpc.invoiceSync.getMissingSkusForInvoice.useQuery(
    { invoiceId },
    { enabled: open && !!invoiceId }
  )

  // Fetch income accounts
  const { data: incomeAccounts, isLoading: loadingAccounts } = trpc.quickbooks.items.incomeAccounts.useQuery(
    undefined,
    { enabled: open }
  )

  // Form state for each SKU
  const [skuForms, setSkuForms] = useState<Record<string, SkuFormData>>({})
  const [error, setError] = useState<string | null>(null)

  // Initialize forms when missing SKUs are loaded
  useEffect(() => {
    if (missingSkus) {
      const initialForms: Record<string, SkuFormData> = {}
      missingSkus.forEach((sku) => {
        const key = sku.skuCode || sku.skuId
        initialForms[key] = {
          selected: true,
          qbItemName: sku.skuName || sku.skuCode || '',
          qbItemType: 'Service',
          unitPrice: sku.unitPrice?.toString() || '',
          incomeAccountId: '',
        }
      })
      setSkuForms(initialForms)
    }
  }, [missingSkus])

  // Create missing SKUs mutation
  const createMissingSkus = trpc.invoiceSync.createMissingSkusForInvoice.useMutation({
    onSuccess: (result) => {
      utils.invoiceSync.list.invalidate()
      utils.invoiceSync.stats.invalidate()
      utils.invoiceSync.getDashboardStats.invalidate()

      if (result.failCount > 0) {
        const failedSkus = result.results.filter((r) => !r.success)
        setError(`Failed to create ${result.failCount} item(s): ${failedSkus.map((r) => r.error).join(', ')}`)
      } else {
        setError(null)
        onOpenChange(false)
        onSuccess?.()
      }
    },
    onError: (err) => {
      setError(err.message || 'Failed to create items')
    },
  })

  const handleSkuFieldChange = (skuKey: string, field: keyof SkuFormData, value: string | boolean) => {
    setSkuForms((prev) => ({
      ...prev,
      [skuKey]: {
        ...prev[skuKey],
        [field]: value,
      },
    }))
    setError(null)
  }

  const toggleSelectAll = (selected: boolean) => {
    setSkuForms((prev) => {
      const newForms = { ...prev }
      Object.keys(newForms).forEach((key) => {
        newForms[key] = { ...newForms[key], selected }
      })
      return newForms
    })
  }

  const selectedCount = Object.values(skuForms).filter((f) => f.selected).length

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!missingSkus) return

    // Validate selected SKUs
    const selectedSkus = missingSkus.filter((sku) => {
      const key = sku.skuCode || sku.skuId
      return skuForms[key]?.selected
    })

    if (selectedSkus.length === 0) {
      setError('Please select at least one SKU to create')
      return
    }

    // Validate all selected have required fields
    for (const sku of selectedSkus) {
      const key = sku.skuCode || sku.skuId
      const form = skuForms[key]
      if (!form.qbItemName.trim()) {
        setError(`Item name is required for ${key}`)
        return
      }
      if (!form.incomeAccountId) {
        setError(`Income account is required for ${key}`)
        return
      }
    }

    // Build payload
    const skusToCreate = selectedSkus.map((sku) => {
      const key = sku.skuCode || sku.skuId
      const form = skuForms[key]
      const account = incomeAccounts?.find((a) => a.value === form.incomeAccountId)

      return {
        atekSkuId: sku.skuId,
        atekSkuCode: sku.skuCode || sku.skuId,
        atekSkuName: sku.skuName || sku.skuCode || '',
        qbItemName: form.qbItemName.trim(),
        qbItemType: form.qbItemType,
        unitPrice: form.unitPrice ? parseFloat(form.unitPrice) : undefined,
        incomeAccountId: form.incomeAccountId,
        incomeAccountName: account?.name,
      }
    })

    createMissingSkus.mutate({
      invoiceId,
      skus: skusToCreate,
    })
  }

  const handleClose = () => {
    setError(null)
    onOpenChange(false)
  }

  const incomeAccountOptions = incomeAccounts?.map((a) => ({ value: a.value, label: a.name })) || []

  // Show reason badge
  const getReasonBadge = (reason: MissingSku['reason']) => {
    switch (reason) {
      case 'no_mapping':
        return <Badge variant="destructive">No Mapping</Badge>
      case 'not_approved':
        return <Badge variant="secondary">Not Approved</Badge>
      case 'needs_creation':
        return <Badge variant="outline">Needs Creation</Badge>
      default:
        return null
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(amount)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Create Missing QB Items
          </DialogTitle>
          <DialogDescription>
            Create QuickBooks items for the missing SKUs in this invoice. Select the items to create
            and configure their QB settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {loadingSkus || loadingAccounts ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading...
            </div>
          ) : !missingSkus || missingSkus.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No missing SKUs found for this invoice.
            </div>
          ) : (
            <>
              {/* Select all header */}
              <div className="flex items-center justify-between py-2 border-b">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedCount === missingSkus.length}
                    onChange={(checked: boolean) => toggleSelectAll(checked)}
                    disabled={createMissingSkus.isPending}
                  />
                  <span className="text-sm font-medium">
                    {selectedCount} of {missingSkus.length} selected
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Income account required for all items
                </div>
              </div>

              {/* SKU list */}
              <div className="space-y-4">
                {missingSkus.map((sku) => {
                  const key = sku.skuCode || sku.skuId
                  const form = skuForms[key] || {
                    selected: true,
                    qbItemName: '',
                    qbItemType: 'Service' as ItemType,
                    unitPrice: '',
                    incomeAccountId: '',
                  }

                  return (
                    <div
                      key={key}
                      className={`border rounded-lg p-4 space-y-3 ${
                        form.selected ? 'bg-background' : 'bg-muted/30 opacity-60'
                      }`}
                    >
                      {/* Header row with checkbox and ATEK info */}
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={form.selected}
                          onChange={(checked: boolean) => handleSkuFieldChange(key, 'selected', checked)}
                          disabled={createMissingSkus.isPending}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                              {sku.skuCode || sku.skuId}
                            </span>
                            {getReasonBadge(sku.reason)}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {sku.skuName || 'No name'}
                            {sku.unitPrice && (
                              <span className="ml-2">• {formatCurrency(sku.unitPrice)}</span>
                            )}
                          </div>
                          {sku.description && (
                            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {sku.description}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Form fields */}
                      {form.selected && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t">
                          <div className="space-y-1">
                            <Label className="text-xs">QB Item Name *</Label>
                            <Input
                              value={form.qbItemName}
                              onChange={(e) => handleSkuFieldChange(key, 'qbItemName', e.target.value)}
                              disabled={createMissingSkus.isPending}
                              placeholder="Item name"
                              className={!form.qbItemName.trim() ? 'border-rose-200' : ''}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Type</Label>
                            <Select
                              options={itemTypeOptions}
                              value={form.qbItemType}
                              onChange={(value) => handleSkuFieldChange(key, 'qbItemType', value)}
                              disabled={createMissingSkus.isPending}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Unit Price</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={form.unitPrice}
                              onChange={(e) => handleSkuFieldChange(key, 'unitPrice', e.target.value)}
                              disabled={createMissingSkus.isPending}
                              placeholder="0.00"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Income Account *</Label>
                            <Select
                              options={incomeAccountOptions}
                              value={form.incomeAccountId}
                              onChange={(value) => handleSkuFieldChange(key, 'incomeAccountId', value)}
                              disabled={createMissingSkus.isPending || loadingAccounts}
                              placeholder={loadingAccounts ? 'Loading...' : 'Select...'}
                              searchable
                              buttonClassName={!form.incomeAccountId ? 'border-rose-200' : ''}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createMissingSkus.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMissingSkus.isPending || selectedCount === 0 || loadingSkus || loadingAccounts}
            >
              {createMissingSkus.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Create {selectedCount} Item{selectedCount !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
