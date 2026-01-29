import { ObjectId } from 'mongodb'
import { getCollection } from '../lib/mongodb'

// ATEK Invoice line item structure
export interface ATEKInvoiceLineItem {
  skuId: ObjectId
  skuCode?: string
  skuName?: string
  description?: string
  quantity: number
  unitPrice: number
  amount: number
  taxable?: boolean
}

// ATEK Site structure
export interface ATEKSite {
  _id: ObjectId
  name?: string
  address?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  email?: string
  phone?: string
  organization?: ObjectId
}

// ATEK Invoice structure (actual MongoDB schema)
export interface ATEKInvoice {
  _id: ObjectId
  invoice_number?: string
  organisation?: ObjectId
  customer?: ObjectId // Same as organisation in most cases
  contractual_manager?: ObjectId
  status: 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled' | 'void'
  date?: Date // Issue date
  expiration_date?: Date // Due date
  billing_site?: ObjectId
  billing_address?: string // Formatted billing address
  shipping_addresses?: Array<{
    _id?: ObjectId
    site?: ObjectId
    address?: string // Formatted shipping address
  }>
  skus?: Array<{
    sku?: ObjectId | string
    code?: string
    name?: string
    description?: string
    quantity?: number
    unit_price?: number
    total?: number
    taxable?: boolean
    item_number?: number
    subtotal_id?: string | null
    discount?: number // Percentage discount per line item
  }>
  subtotals?: Array<{
    _id?: ObjectId
    name?: string
    discount_type?: 'percentage' | 'fixed'
    discount_value?: number
  }> | {
    subtotal?: number
    tax?: number
    total?: number
  }
  total?: number
  currency?: string
  notes?: string | string[]
  internal_notes?: string
  payment_terms?: string
  po_number?: string
  project_name?: string
  created_at?: Date
  deleted?: boolean
  taxesAdded?: Array<{
    taxId?: string
    name?: string
    rate?: number
    amount?: number
  }>
  discount?: number
  discount_type?: 'percentage' | 'fixed'
}

// Normalized invoice for sync
export interface NormalizedInvoice {
  id: string
  invoiceNumber: string
  organizationId: string // The actual customer org (from 'customer' field)
  organizationName: string | null
  contractualManagerId: string | null
  status: string
  issueDate: string
  dueDate: string | null
  billingAddress: string | null
  shippingAddresses: Array<{
    address: string
  }>
  lineItems: Array<{
    skuId: string
    skuCode: string | null
    skuName: string | null
    description: string | null
    quantity: number
    unitPrice: number
    discount: number // Percentage discount
    amount: number // After discount
    taxable: boolean
  }>
  subtotal: number
  taxAmount: number
  totalAmount: number
  paidAmount: number
  balance: number
  currency: string
  notes: string | null
  privateNotes: string | null
  poNumber: string | null
  projectName: string | null
}

// Collection name (configurable via env)
const COLLECTION_NAME = process.env.ATEK_INVOICES_COLLECTION || 'invoices'

// List invoices ready for sync (sent, paid, partial, overdue - not draft/cancelled/void)
export async function listInvoicesForSync(options?: {
  startDate?: Date
  endDate?: Date
  organizationId?: string
  limit?: number
  skip?: number
}): Promise<NormalizedInvoice[]> {
  const { startDate, endDate, organizationId, limit = 1000, skip = 0 } = options || {}

  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {
    status: { $in: ['sent', 'paid', 'partial', 'overdue'] },
  }

  if (startDate || endDate) {
    filter.date = {}
    if (startDate) (filter.date as Record<string, Date>).$gte = startDate
    if (endDate) (filter.date as Record<string, Date>).$lte = endDate
  }

  if (organizationId) {
    filter.organisation = new ObjectId(organizationId)
  }

  const invoices = await collection
    .find(filter)
    .sort({ date: -1 })
    .skip(skip)
    .limit(limit)
    .toArray()

  return invoices.map(normalizeInvoice)
}

// Get invoice by ID
export async function getInvoice(id: string): Promise<NormalizedInvoice | null> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const invoice = await collection.findOne({ _id: new ObjectId(id) })

  return invoice ? normalizeInvoice(invoice) : null
}

// Get invoice by number
export async function getInvoiceByNumber(invoiceNumber: string): Promise<NormalizedInvoice | null> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const invoice = await collection.findOne({
    invoiceNumber: { $regex: `^${invoiceNumber}$`, $options: 'i' },
  })

  return invoice ? normalizeInvoice(invoice) : null
}

// Search invoices by number, org name, or PO number
export async function searchInvoices(query: string): Promise<NormalizedInvoice[]> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const invoices = await collection
    .find({
      $or: [
        { invoiceNumber: { $regex: query, $options: 'i' } },
        { organizationName: { $regex: query, $options: 'i' } },
        { poNumber: { $regex: query, $options: 'i' } },
        { projectName: { $regex: query, $options: 'i' } },
      ],
    })
    .limit(100)
    .toArray()

  return invoices.map(normalizeInvoice)
}

// Get invoice count
export async function getInvoiceCount(options?: {
  forSync?: boolean
  startDate?: Date
  endDate?: Date
}): Promise<number> {
  const { forSync = true, startDate, endDate } = options || {}

  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {}

  if (forSync) {
    filter.status = { $in: ['sent', 'paid', 'partial', 'overdue'] }
  }

  if (startDate || endDate) {
    filter.date = {}
    if (startDate) (filter.date as Record<string, Date>).$gte = startDate
    if (endDate) (filter.date as Record<string, Date>).$lte = endDate
  }

  return collection.countDocuments(filter)
}

// Get invoices for a specific organization
export async function getInvoicesForOrganization(
  organizationId: string,
  forSync = true
): Promise<NormalizedInvoice[]> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {
    organisation: new ObjectId(organizationId),
  }

  if (forSync) {
    filter.status = { $in: ['sent', 'paid', 'partial', 'overdue'] }
  }

  const invoices = await collection.find(filter).sort({ date: -1 }).toArray()

  return invoices.map(normalizeInvoice)
}

// Get all unique SKU IDs used in invoices (for validation)
export async function getUsedSKUIds(): Promise<string[]> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const result = await collection
    .aggregate([
      { $match: { status: { $in: ['sent', 'paid', 'partial', 'overdue'] } } },
      { $unwind: '$lineItems' },
      { $group: { _id: '$lineItems.skuId' } },
    ])
    .toArray()

  return result.map((r) => r._id.toString())
}

// Unique SKU from invoices with details
export interface InvoiceSKU {
  skuId: string
  code: string | null
  name: string | null
  description: string | null
  unitPrice: number | null
  taxable: boolean
  invoiceCount: number
}

// Get all unique SKUs used in invoices with their details
export async function getUniqueSKUsFromInvoices(): Promise<InvoiceSKU[]> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const result = await collection
    .aggregate([
      // Only active invoices
      { $match: { status: { $in: ['sent', 'paid', 'partial', 'overdue'] } } },
      // Unwind the skus array
      { $unwind: '$skus' },
      // Group by SKU code (or sku ObjectId if code is missing)
      {
        $group: {
          _id: { $ifNull: ['$skus.code', { $toString: '$skus.sku' }] },
          skuId: { $first: { $toString: '$skus.sku' } },
          code: { $first: '$skus.code' },
          name: { $first: '$skus.name' },
          description: { $first: '$skus.description' },
          unitPrice: { $first: '$skus.unit_price' },
          taxable: { $first: { $ifNull: ['$skus.taxable', false] } },
          invoiceCount: { $sum: 1 },
        },
      },
      // Sort by invoice count (most used first)
      { $sort: { invoiceCount: -1 } },
    ])
    .toArray()

  return result.map((r) => {
    const skuId = r.skuId || r._id
    // Use skuId as code if code is not set (common pattern in ATEK data)
    const code = r.code || skuId
    // Extract name from first line of description if name is not set
    const name = r.name || (r.description ? r.description.split('\n')[0].trim() : null)

    return {
      skuId,
      code,
      name,
      description: r.description || null,
      unitPrice: r.unitPrice || null,
      taxable: r.taxable || false,
      invoiceCount: r.invoiceCount,
    }
  })
}

// Get invoices that haven't been synced yet
export async function getUnsyncedInvoiceIds(syncedInvoiceIds: string[]): Promise<NormalizedInvoice[]> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const syncedObjectIds = syncedInvoiceIds.map((id) => new ObjectId(id))

  const invoices = await collection
    .find({
      _id: { $nin: syncedObjectIds },
      status: { $in: ['sent', 'paid', 'partial', 'overdue'] },
    })
    .sort({ issueDate: -1 })
    .toArray()

  return invoices.map(normalizeInvoice)
}

// Get unique contractual managers per organization from invoices
export async function getContractualManagersByOrganization(): Promise<
  Record<string, Array<{ id: string; name: string; email: string }>>
> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  // Aggregate invoices to get unique managers per organization
  // Note: 'customer' field references the actual customer org, 'organisation' is internal (_ATEK_)
  const result = await collection
    .aggregate([
      // Only consider invoices with contractual_manager and customer
      { $match: { contractual_manager: { $exists: true, $ne: null }, customer: { $exists: true, $ne: null } } },
      // Group by customer (the actual ATEK organization) and collect unique manager IDs
      {
        $group: {
          _id: '$customer',
          managerIds: { $addToSet: '$contractual_manager' },
        },
      },
    ])
    .toArray()

  // Build lookup map of org -> manager IDs
  const orgManagerIds = new Map<string, ObjectId[]>()
  for (const row of result) {
    orgManagerIds.set(row._id.toString(), row.managerIds)
  }

  // Collect all unique manager IDs
  const allManagerIds = new Set<string>()
  for (const ids of orgManagerIds.values()) {
    for (const id of ids) {
      allManagerIds.add(id.toString())
    }
  }

  // Fetch all managers in one query
  const usersCollection = await getCollection<{
    _id: ObjectId
    email: string
    firstname?: string
    lastname?: string
  }>(process.env.ATEK_USERS_COLLECTION || 'users')

  const managers = await usersCollection
    .find({
      _id: { $in: Array.from(allManagerIds).map((id) => new ObjectId(id)) },
    })
    .toArray()

  // Build manager lookup map
  const managerMap = new Map<string, { id: string; name: string; email: string }>()
  for (const m of managers) {
    const email = m.email || ''
    const name =
      [m.firstname, m.lastname].filter(Boolean).join(' ') || email.split('@')[0] || 'Unknown'
    managerMap.set(m._id.toString(), {
      id: m._id.toString(),
      name,
      email,
    })
  }

  // Build final result
  const output: Record<string, Array<{ id: string; name: string; email: string }>> = {}
  for (const [orgId, mgrIds] of orgManagerIds) {
    output[orgId] = mgrIds
      .map((id) => managerMap.get(id.toString()))
      .filter((m): m is { id: string; name: string; email: string } => m !== undefined)
  }

  return output
}

// Get billing site by ID
export async function getBillingSite(siteId: string): Promise<ATEKSite | null> {
  const collection = await getCollection<ATEKSite>(process.env.ATEK_SITES_COLLECTION || 'sites')

  try {
    const site = await collection.findOne({ _id: new ObjectId(siteId) })
    return site
  } catch (error) {
    console.error('Error fetching billing site:', error)
    return null
  }
}

// Get billing site ID from invoice
export async function getInvoiceBillingSiteId(invoiceId: string): Promise<string | null> {
  const collection = await getCollection<ATEKInvoice>(COLLECTION_NAME)

  const invoice = await collection.findOne(
    { _id: new ObjectId(invoiceId) },
    { projection: { billing_site: 1 } }
  )

  return invoice?.billing_site?.toString() || null
}

// Normalize invoice for consistent output
function normalizeInvoice(invoice: ATEKInvoice): NormalizedInvoice {
  const issueDate = invoice.date ? new Date(invoice.date).toISOString().split('T')[0]! : ''
  const dueDate = invoice.expiration_date
    ? new Date(invoice.expiration_date).toISOString().split('T')[0]
    : null

  // Map line items and calculate amounts
  const lineItems = (invoice.skus || []).map((item) => {
    const quantity = item.quantity || 0
    const unitPrice = item.unit_price || 0
    const discount = item.discount || 0 // Percentage discount
    // Calculate amount: (quantity * unitPrice) - discount percentage
    const grossAmount = quantity * unitPrice
    const discountAmount = discount > 0 ? (grossAmount * discount / 100) : 0
    const amount = item.total || (grossAmount - discountAmount)
    return {
      skuId: item.sku?.toString() || '',
      skuCode: item.code || item.sku?.toString() || null,
      skuName: item.name || null,
      description: item.description || null,
      quantity,
      unitPrice,
      discount,
      amount,
      taxable: item.taxable || false,
    }
  })

  // Calculate subtotal from line items if not provided
  const calculatedSubtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)

  // Handle subtotals being either an object or an array
  let subtotal = 0
  let taxAmount = 0
  if (invoice.subtotals && !Array.isArray(invoice.subtotals)) {
    subtotal = invoice.subtotals.subtotal || calculatedSubtotal
    taxAmount = invoice.subtotals.tax || 0
  } else {
    subtotal = calculatedSubtotal
    // Sum up taxesAdded if available
    if (invoice.taxesAdded && Array.isArray(invoice.taxesAdded)) {
      taxAmount = invoice.taxesAdded.reduce((sum, tax) => sum + (tax.amount || 0), 0)
    }
  }

  // Handle notes being string, array of strings, or array of note objects
  let notes: string | null = null
  if (Array.isArray(invoice.notes)) {
    notes = invoice.notes
      .map(n => typeof n === 'string' ? n : (n.text || n.content || n.note || ''))
      .filter(Boolean)
      .join('\n') || null
  } else {
    notes = invoice.notes || null
  }

  // Map shipping addresses
  const shippingAddresses = (invoice.shipping_addresses || [])
    .filter(addr => addr.address)
    .map(addr => ({ address: addr.address! }))

  return {
    id: invoice._id.toString(),
    invoiceNumber: invoice.invoice_number || '',
    // Use 'customer' field which is the actual customer org, not 'organisation' which is internal (_ATEK_)
    organizationId: invoice.customer?.toString() || invoice.organisation?.toString() || '',
    organizationName: null, // Not stored directly on invoice
    contractualManagerId: invoice.contractual_manager?.toString() || null,
    status: invoice.status,
    issueDate,
    dueDate,
    billingAddress: invoice.billing_address || null,
    shippingAddresses,
    lineItems,
    subtotal,
    taxAmount,
    totalAmount: invoice.total || (subtotal + taxAmount),
    paidAmount: 0, // Not directly available
    balance: invoice.total || 0,
    currency: invoice.currency || 'CAD',
    notes,
    privateNotes: invoice.internal_notes || null,
    poNumber: invoice.po_number || null,
    projectName: invoice.project_name || null,
  }
}
