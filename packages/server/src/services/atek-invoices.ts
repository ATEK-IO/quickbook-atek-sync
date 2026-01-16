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
  skus?: Array<{
    sku?: ObjectId
    code?: string
    name?: string
    description?: string
    quantity?: number
    unit_price?: number
    total?: number
    taxable?: boolean
  }>
  subtotals?: {
    subtotal?: number
    tax?: number
    total?: number
  }
  total?: number
  currency?: string
  notes?: string
  internal_notes?: string
  payment_terms?: string
  po_number?: string
  project_name?: string
  created_at?: Date
  deleted?: boolean
}

// Normalized invoice for sync
export interface NormalizedInvoice {
  id: string
  invoiceNumber: string
  organizationId: string
  organizationName: string | null
  contractualManagerId: string | null
  status: string
  issueDate: string
  dueDate: string | null
  lineItems: Array<{
    skuId: string
    skuCode: string | null
    skuName: string | null
    description: string | null
    quantity: number
    unitPrice: number
    amount: number
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

// Normalize invoice for consistent output
function normalizeInvoice(invoice: ATEKInvoice): NormalizedInvoice {
  const issueDate = invoice.date ? new Date(invoice.date).toISOString().split('T')[0]! : ''
  const dueDate = invoice.expiration_date
    ? new Date(invoice.expiration_date).toISOString().split('T')[0]
    : null

  return {
    id: invoice._id.toString(),
    invoiceNumber: invoice.invoice_number || '',
    organizationId: invoice.organisation?.toString() || '',
    organizationName: null, // Not stored directly on invoice
    contractualManagerId: invoice.contractual_manager?.toString() || null,
    status: invoice.status,
    issueDate,
    dueDate,
    lineItems: (invoice.skus || []).map((item) => ({
      skuId: item.sku?.toString() || '',
      skuCode: item.code || null,
      skuName: item.name || null,
      description: item.description || null,
      quantity: item.quantity || 0,
      unitPrice: item.unit_price || 0,
      amount: item.total || 0,
      taxable: item.taxable || false,
    })),
    subtotal: invoice.subtotals?.subtotal || 0,
    taxAmount: invoice.subtotals?.tax || 0,
    totalAmount: invoice.total || invoice.subtotals?.total || 0,
    paidAmount: 0, // Not directly available
    balance: invoice.total || 0,
    currency: invoice.currency || 'CAD',
    notes: invoice.notes || null,
    privateNotes: invoice.internal_notes || null,
    poNumber: invoice.po_number || null,
    projectName: invoice.project_name || null,
  }
}
