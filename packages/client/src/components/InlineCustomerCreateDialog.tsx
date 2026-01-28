import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { AlertCircle, Check, Loader2 } from 'lucide-react'

interface InlineCustomerCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  organizationName: string
  organizationNumber?: string
  managerName?: string
  managerEmail?: string
  onSuccess?: () => void
}

interface FormData {
  DisplayName: string
  CompanyName: string
  GivenName: string
  FamilyName: string
  Email: string
  Phone: string
  Line1: string
  City: string
  Province: string
  PostalCode: string
  Country: string
  Notes: string
}

export function InlineCustomerCreateDialog({
  open,
  onOpenChange,
  invoiceId,
  organizationName,
  organizationNumber,
  managerName,
  managerEmail,
  onSuccess,
}: InlineCustomerCreateDialogProps) {
  const utils = trpc.useUtils()

  // Parse manager name into first/last
  const parseManagerName = (name?: string) => {
    if (!name) return { firstName: '', lastName: '' }
    const parts = name.trim().split(/\s+/)
    if (parts.length === 1) return { firstName: parts[0], lastName: '' }
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    }
  }

  const { firstName, lastName } = parseManagerName(managerName)

  // Build display name from org number and name
  const buildDisplayName = () => {
    if (organizationNumber) {
      return `${organizationNumber} ${organizationName}`
    }
    return organizationName
  }

  const initialFormData: FormData = {
    DisplayName: buildDisplayName(),
    CompanyName: organizationName,
    GivenName: firstName,
    FamilyName: lastName,
    Email: managerEmail || '',
    Phone: '',
    Line1: '',
    City: '',
    Province: 'QC',
    PostalCode: '',
    Country: 'Canada',
    Notes: '',
  }

  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (open) {
      setFormData({
        DisplayName: buildDisplayName(),
        CompanyName: organizationName,
        GivenName: firstName,
        FamilyName: lastName,
        Email: managerEmail || '',
        Phone: '',
        Line1: '',
        City: '',
        Province: 'QC',
        PostalCode: '',
        Country: 'Canada',
        Notes: '',
      })
      setError(null)
    }
  }, [open, organizationName, organizationNumber, managerName, managerEmail])

  const createCustomerForInvoice = trpc.invoiceSync.createCustomerForInvoice.useMutation({
    onSuccess: (result) => {
      // Invalidate queries to refresh data
      utils.invoiceSync.list.invalidate()
      utils.invoiceSync.stats.invalidate()
      utils.invoiceSync.getDashboardStats.invalidate()

      setError(null)
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (err) => {
      setError(err.message || 'Failed to create customer')
    },
  })

  const handleChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }))
    setError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.DisplayName.trim()) {
      setError('Display Name is required')
      return
    }

    const customerData: Parameters<typeof createCustomerForInvoice.mutate>[0]['customerData'] = {
      DisplayName: formData.DisplayName.trim(),
    }

    if (formData.CompanyName.trim()) {
      customerData.CompanyName = formData.CompanyName.trim()
    }
    if (formData.GivenName.trim()) {
      customerData.GivenName = formData.GivenName.trim()
    }
    if (formData.FamilyName.trim()) {
      customerData.FamilyName = formData.FamilyName.trim()
    }
    if (formData.Email.trim()) {
      customerData.PrimaryEmailAddr = { Address: formData.Email.trim() }
    }
    if (formData.Phone.trim()) {
      customerData.PrimaryPhone = { FreeFormNumber: formData.Phone.trim() }
    }
    if (formData.Notes.trim()) {
      customerData.Notes = formData.Notes.trim()
    }

    // Only include address if at least one field is filled
    if (
      formData.Line1.trim() ||
      formData.City.trim() ||
      formData.Province.trim() ||
      formData.PostalCode.trim()
    ) {
      customerData.BillAddr = {}
      if (formData.Line1.trim()) customerData.BillAddr.Line1 = formData.Line1.trim()
      if (formData.City.trim()) customerData.BillAddr.City = formData.City.trim()
      if (formData.Province.trim()) customerData.BillAddr.CountrySubDivisionCode = formData.Province.trim()
      if (formData.PostalCode.trim()) customerData.BillAddr.PostalCode = formData.PostalCode.trim()
      if (formData.Country.trim()) customerData.BillAddr.Country = formData.Country.trim()
    }

    createCustomerForInvoice.mutate({
      invoiceId,
      customerData,
    })
  }

  const handleClose = () => {
    setFormData(initialFormData)
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create QuickBooks Customer</DialogTitle>
          <DialogDescription>
            Create a new QB customer and link it to this invoice's organization. This will automatically
            create the customer mapping and re-validate the invoice.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Pre-filled info banner */}
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="font-medium mb-1">Pre-filled from ATEK invoice:</div>
            <div className="text-muted-foreground space-y-0.5">
              <div>Organization: {organizationName}</div>
              {managerName && <div>Manager: {managerName}</div>}
              {managerEmail && <div>Email: {managerEmail}</div>}
            </div>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="DisplayName">
                Display Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="DisplayName"
                placeholder="0000 Company Name"
                value={formData.DisplayName}
                onChange={handleChange('DisplayName')}
                disabled={createCustomerForInvoice.isPending}
              />
              <p className="text-xs text-muted-foreground">Format: "XXXX Company Name"</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="CompanyName">Company Name</Label>
              <Input
                id="CompanyName"
                placeholder="Company Inc."
                value={formData.CompanyName}
                onChange={handleChange('CompanyName')}
                disabled={createCustomerForInvoice.isPending}
              />
            </div>
          </div>

          {/* Contact Person */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="GivenName">First Name</Label>
              <Input
                id="GivenName"
                placeholder="John"
                value={formData.GivenName}
                onChange={handleChange('GivenName')}
                disabled={createCustomerForInvoice.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="FamilyName">Last Name</Label>
              <Input
                id="FamilyName"
                placeholder="Doe"
                value={formData.FamilyName}
                onChange={handleChange('FamilyName')}
                disabled={createCustomerForInvoice.isPending}
              />
            </div>
          </div>

          {/* Contact Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="Email">Email</Label>
              <Input
                id="Email"
                type="email"
                placeholder="contact@company.com"
                value={formData.Email}
                onChange={handleChange('Email')}
                disabled={createCustomerForInvoice.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="Phone">Phone</Label>
              <Input
                id="Phone"
                type="tel"
                placeholder="514-555-1234"
                value={formData.Phone}
                onChange={handleChange('Phone')}
                disabled={createCustomerForInvoice.isPending}
              />
            </div>
          </div>

          {/* Billing Address */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Billing Address</h3>
            <div className="space-y-2">
              <Label htmlFor="Line1">Street Address</Label>
              <Input
                id="Line1"
                placeholder="123 Main Street"
                value={formData.Line1}
                onChange={handleChange('Line1')}
                disabled={createCustomerForInvoice.isPending}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="City">City</Label>
                <Input
                  id="City"
                  placeholder="Montreal"
                  value={formData.City}
                  onChange={handleChange('City')}
                  disabled={createCustomerForInvoice.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="Province">Province/State</Label>
                <Input
                  id="Province"
                  placeholder="QC"
                  value={formData.Province}
                  onChange={handleChange('Province')}
                  disabled={createCustomerForInvoice.isPending}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="PostalCode">Postal Code</Label>
                <Input
                  id="PostalCode"
                  placeholder="H2X 1Y4"
                  value={formData.PostalCode}
                  onChange={handleChange('PostalCode')}
                  disabled={createCustomerForInvoice.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="Country">Country</Label>
                <Input
                  id="Country"
                  placeholder="Canada"
                  value={formData.Country}
                  onChange={handleChange('Country')}
                  disabled={createCustomerForInvoice.isPending}
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="Notes">Notes</Label>
            <Textarea
              id="Notes"
              placeholder="Additional notes about this customer..."
              value={formData.Notes}
              onChange={handleChange('Notes')}
              disabled={createCustomerForInvoice.isPending}
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createCustomerForInvoice.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createCustomerForInvoice.isPending}>
              {createCustomerForInvoice.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Create & Link Customer
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
