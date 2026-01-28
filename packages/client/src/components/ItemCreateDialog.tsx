import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

type ItemType = 'Service' | 'NonInventory' | 'Inventory'

interface ItemCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  defaultName?: string
  defaultSku?: string
  defaultDescription?: string
  defaultPrice?: number
  defaultTaxable?: boolean
  // Optional: ATEK SKU info for auto-creating mapping after item creation
  atekSkuId?: string
  atekSkuCode?: string
  atekSkuName?: string
}

interface FormData {
  Name: string
  Type: ItemType
  Sku: string
  Description: string
  UnitPrice: string
  PurchaseCost: string
  IncomeAccountId: string
  ExpenseAccountId: string
  AssetAccountId: string
  Taxable: boolean
  QtyOnHand: string
}

const initialFormData: FormData = {
  Name: '',
  Type: 'Service',
  Sku: '',
  Description: '',
  UnitPrice: '',
  PurchaseCost: '',
  IncomeAccountId: '',
  ExpenseAccountId: '',
  AssetAccountId: '',
  Taxable: true,
  QtyOnHand: '0',
}

const itemTypeOptions = [
  { value: 'Service', label: 'Service' },
  { value: 'NonInventory', label: 'Non-Inventory' },
  { value: 'Inventory', label: 'Inventory' },
]

export function ItemCreateDialog({
  open,
  onOpenChange,
  onSuccess,
  defaultName,
  defaultSku,
  defaultDescription,
  defaultPrice,
  defaultTaxable,
  atekSkuId,
  atekSkuCode,
  atekSkuName,
}: ItemCreateDialogProps) {
  const [formData, setFormData] = useState<FormData>({
    ...initialFormData,
    Name: defaultName || '',
    Sku: defaultSku || '',
    Description: defaultDescription || '',
    UnitPrice: defaultPrice?.toString() || '',
  })
  const [error, setError] = useState<string | null>(null)

  // Fetch accounts for dropdowns
  const { data: incomeAccounts, isLoading: loadingIncomeAccounts } = trpc.quickbooks.items.incomeAccounts.useQuery(
    undefined,
    { enabled: open }
  )
  const { data: expenseAccounts, isLoading: loadingExpenseAccounts } = trpc.quickbooks.items.expenseAccounts.useQuery(
    undefined,
    { enabled: open }
  )
  const { data: assetAccounts, isLoading: loadingAssetAccounts } = trpc.quickbooks.items.assetAccounts.useQuery(
    undefined,
    { enabled: open && formData.Type === 'Inventory' }
  )

  // Reset form when dialog opens with new defaults
  useEffect(() => {
    if (open) {
      setFormData({
        ...initialFormData,
        Name: defaultName || '',
        Sku: defaultSku || '',
        Description: defaultDescription || '',
        UnitPrice: defaultPrice?.toString() || '',
        Taxable: defaultTaxable ?? true,
      })
      setError(null)
    }
  }, [open, defaultName, defaultSku, defaultDescription, defaultPrice, defaultTaxable])

  // Mutation to approve SKU mapping after creating QB item
  const approveMapping = trpc.skuMapping.approveMatch.useMutation()

  const createItem = trpc.quickbooks.items.create.useMutation({
    onSuccess: async (createdItem) => {
      // If ATEK SKU info was provided, create the mapping automatically
      if (atekSkuId && atekSkuCode && createdItem?.Id) {
        try {
          await approveMapping.mutateAsync({
            atekSkuId,
            atekSkuCode,
            atekSkuName: atekSkuName || formData.Name,
            quickbooksItemId: createdItem.Id,
            quickbooksItemName: createdItem.Name,
            quickbooksItemType: createdItem.Type,
            matchType: 'manual',
            confidenceScore: 1.0,
          })
        } catch (mappingError) {
          console.error('Failed to create SKU mapping:', mappingError)
          // Continue anyway - item was created successfully
        }
      }

      setFormData(initialFormData)
      setError(null)
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (err: { message?: string }) => {
      setError(err.message || 'Failed to create item')
    },
  })

  const handleChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }))
    setError(null)
  }

  const handleTypeChange = (value: string) => {
    setFormData((prev) => ({ ...prev, Type: value as ItemType }))
    setError(null)
  }

  const handleAccountChange = (field: 'IncomeAccountId' | 'ExpenseAccountId' | 'AssetAccountId') => (value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  const handleTaxableChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, Taxable: checked }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.Name.trim()) {
      setError('Name is required')
      return
    }

    if (!formData.IncomeAccountId) {
      setError('Income Account is required')
      return
    }

    if (formData.Type === 'Inventory' && !formData.AssetAccountId) {
      setError('Asset Account is required for Inventory items')
      return
    }

    const selectedAccount = incomeAccounts?.find((a) => a.value === formData.IncomeAccountId)

    const payload: Parameters<typeof createItem.mutate>[0] = {
      Name: formData.Name.trim(),
      Type: formData.Type,
      IncomeAccountRef: {
        value: formData.IncomeAccountId,
        name: selectedAccount?.name,
      },
      Taxable: formData.Taxable,
    }

    if (formData.Sku.trim()) {
      payload.Sku = formData.Sku.trim()
    }

    if (formData.Description.trim()) {
      payload.Description = formData.Description.trim()
    }

    if (formData.UnitPrice.trim()) {
      const price = parseFloat(formData.UnitPrice)
      if (!isNaN(price)) {
        payload.UnitPrice = price
      }
    }

    if (formData.PurchaseCost.trim()) {
      const cost = parseFloat(formData.PurchaseCost)
      if (!isNaN(cost)) {
        payload.PurchaseCost = cost
      }
    }

    if (formData.Type === 'Inventory') {
      payload.TrackQtyOnHand = true
      payload.QtyOnHand = parseInt(formData.QtyOnHand) || 0
      if (formData.AssetAccountId) {
        payload.AssetAccountRef = { value: formData.AssetAccountId }
      }
    }

    if (formData.ExpenseAccountId) {
      payload.ExpenseAccountRef = { value: formData.ExpenseAccountId }
    }

    createItem.mutate(payload)
  }

  const handleClose = () => {
    setFormData(initialFormData)
    setError(null)
    onOpenChange(false)
  }

  const incomeAccountOptions = incomeAccounts?.map((a: { value: string; name: string }) => ({ value: a.value, label: a.name })) || []
  const expenseAccountOptions = expenseAccounts?.map((a: { value: string; name: string }) => ({ value: a.value, label: a.name })) || []
  const assetAccountOptions = assetAccounts?.map((a: { value: string; name: string }) => ({ value: a.value, label: a.name })) || []

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create QuickBooks Item</DialogTitle>
          <DialogDescription>
            Add a new product or service item to QuickBooks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="Name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="Name"
                placeholder="Product or Service Name"
                value={formData.Name}
                onChange={handleChange('Name')}
                disabled={createItem.isPending}
                className={!formData.Name.trim() ? 'bg-rose-50 border-rose-200' : ''}
              />
              {!formData.Name.trim() && (
                <p className="text-xs text-rose-500">Requis</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="Type">
                Type <span className="text-destructive">*</span>
              </Label>
              <Select
                options={itemTypeOptions}
                value={formData.Type}
                onChange={handleTypeChange}
                disabled={createItem.isPending}
              />
            </div>
          </div>

          {/* SKU and Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="Sku">SKU Code</Label>
              <Input
                id="Sku"
                placeholder="SKU-001"
                value={formData.Sku}
                onChange={handleChange('Sku')}
                disabled={createItem.isPending}
              />
            </div>
            <div className="space-y-2 flex items-center gap-2 pt-8">
              <Checkbox
                id="Taxable"
                checked={formData.Taxable}
                onChange={handleTaxableChange}
                disabled={createItem.isPending}
              />
              <Label htmlFor="Taxable" className="cursor-pointer">
                Taxable
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="Description">Description</Label>
            <Textarea
              id="Description"
              placeholder="Item description..."
              value={formData.Description}
              onChange={handleChange('Description')}
              disabled={createItem.isPending}
              rows={2}
            />
          </div>

          {/* Pricing */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Pricing</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="UnitPrice">Sales Price</Label>
                <Input
                  id="UnitPrice"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.UnitPrice}
                  onChange={handleChange('UnitPrice')}
                  disabled={createItem.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="PurchaseCost">Cost</Label>
                <Input
                  id="PurchaseCost"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.PurchaseCost}
                  onChange={handleChange('PurchaseCost')}
                  disabled={createItem.isPending}
                />
              </div>
            </div>
          </div>

          {/* Accounts */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Accounts</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="IncomeAccount">
                  Income Account <span className="text-destructive">*</span>
                </Label>
                <Select
                  options={incomeAccountOptions}
                  value={formData.IncomeAccountId}
                  onChange={handleAccountChange('IncomeAccountId')}
                  placeholder={loadingIncomeAccounts ? 'Loading...' : 'Select account'}
                  searchable
                  disabled={createItem.isPending || loadingIncomeAccounts}
                  buttonClassName={!formData.IncomeAccountId ? 'bg-rose-50 border-rose-200' : ''}
                />
                {!formData.IncomeAccountId && (
                  <p className="text-xs text-rose-500">Requis</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ExpenseAccount">Expense Account (COGS)</Label>
                <Select
                  options={expenseAccountOptions}
                  value={formData.ExpenseAccountId}
                  onChange={handleAccountChange('ExpenseAccountId')}
                  placeholder={loadingExpenseAccounts ? 'Loading...' : 'Select account (optional)'}
                  searchable
                  disabled={createItem.isPending || loadingExpenseAccounts}
                />
              </div>
            </div>
          </div>

          {/* Inventory specific fields */}
          {formData.Type === 'Inventory' && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">Inventory Settings</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="QtyOnHand">Initial Quantity on Hand</Label>
                  <Input
                    id="QtyOnHand"
                    type="number"
                    placeholder="0"
                    value={formData.QtyOnHand}
                    onChange={handleChange('QtyOnHand')}
                    disabled={createItem.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="AssetAccount">
                    Asset Account <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    options={assetAccountOptions}
                    value={formData.AssetAccountId}
                    onChange={handleAccountChange('AssetAccountId')}
                    placeholder={loadingAssetAccounts ? 'Loading...' : 'Select account'}
                    searchable
                    disabled={createItem.isPending || loadingAssetAccounts}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createItem.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createItem.isPending || loadingIncomeAccounts}>
              {createItem.isPending ? 'Creating...' : 'Create Item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
