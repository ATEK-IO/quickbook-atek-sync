import { useState } from 'react'
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

interface CustomerCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  defaultOrgNumber?: string
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

const initialFormData: FormData = {
  DisplayName: '',
  CompanyName: '',
  GivenName: '',
  FamilyName: '',
  Email: '',
  Phone: '',
  Line1: '',
  City: '',
  Province: 'QC',
  PostalCode: '',
  Country: 'Canada',
  Notes: '',
}

export function CustomerCreateDialog({
  open,
  onOpenChange,
  onSuccess,
  defaultOrgNumber,
}: CustomerCreateDialogProps) {
  const [formData, setFormData] = useState<FormData>({
    ...initialFormData,
    DisplayName: defaultOrgNumber ? `${defaultOrgNumber} ` : '',
  })
  const [error, setError] = useState<string | null>(null)

  const createCustomer = trpc.quickbooks.customers.create.useMutation({
    onSuccess: () => {
      setFormData(initialFormData)
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

    const payload: Parameters<typeof createCustomer.mutate>[0] = {
      DisplayName: formData.DisplayName.trim(),
    }

    if (formData.CompanyName.trim()) {
      payload.CompanyName = formData.CompanyName.trim()
    }
    if (formData.GivenName.trim()) {
      payload.GivenName = formData.GivenName.trim()
    }
    if (formData.FamilyName.trim()) {
      payload.FamilyName = formData.FamilyName.trim()
    }
    if (formData.Email.trim()) {
      payload.PrimaryEmailAddr = { Address: formData.Email.trim() }
    }
    if (formData.Phone.trim()) {
      payload.PrimaryPhone = { FreeFormNumber: formData.Phone.trim() }
    }
    if (formData.Notes.trim()) {
      payload.Notes = formData.Notes.trim()
    }

    // Only include address if at least one field is filled
    if (
      formData.Line1.trim() ||
      formData.City.trim() ||
      formData.Province.trim() ||
      formData.PostalCode.trim()
    ) {
      payload.BillAddr = {}
      if (formData.Line1.trim()) payload.BillAddr.Line1 = formData.Line1.trim()
      if (formData.City.trim()) payload.BillAddr.City = formData.City.trim()
      if (formData.Province.trim()) payload.BillAddr.CountrySubDivisionCode = formData.Province.trim()
      if (formData.PostalCode.trim()) payload.BillAddr.PostalCode = formData.PostalCode.trim()
      if (formData.Country.trim()) payload.BillAddr.Country = formData.Country.trim()
    }

    createCustomer.mutate(payload)
  }

  const handleClose = () => {
    setFormData(initialFormData)
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create QuickBooks Customer</DialogTitle>
          <DialogDescription>
            Add a new customer to QuickBooks. Display Name is required and should follow the format "XXXX Company Name".
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
              <Label htmlFor="DisplayName">
                Display Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="DisplayName"
                placeholder="0000 Company Name"
                value={formData.DisplayName}
                onChange={handleChange('DisplayName')}
                disabled={createCustomer.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="CompanyName">Company Name</Label>
              <Input
                id="CompanyName"
                placeholder="Company Inc."
                value={formData.CompanyName}
                onChange={handleChange('CompanyName')}
                disabled={createCustomer.isPending}
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
                disabled={createCustomer.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="FamilyName">Last Name</Label>
              <Input
                id="FamilyName"
                placeholder="Doe"
                value={formData.FamilyName}
                onChange={handleChange('FamilyName')}
                disabled={createCustomer.isPending}
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
                disabled={createCustomer.isPending}
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
                disabled={createCustomer.isPending}
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
                disabled={createCustomer.isPending}
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
                  disabled={createCustomer.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="Province">Province/State</Label>
                <Input
                  id="Province"
                  placeholder="QC"
                  value={formData.Province}
                  onChange={handleChange('Province')}
                  disabled={createCustomer.isPending}
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
                  disabled={createCustomer.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="Country">Country</Label>
                <Input
                  id="Country"
                  placeholder="Canada"
                  value={formData.Country}
                  onChange={handleChange('Country')}
                  disabled={createCustomer.isPending}
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
              disabled={createCustomer.isPending}
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createCustomer.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createCustomer.isPending}>
              {createCustomer.isPending ? 'Creating...' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
