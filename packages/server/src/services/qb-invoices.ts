import { createApiClient, withRetry, qbApiCall } from '../lib/quickbooks'

export interface QBInvoiceLine {
  Id?: string
  LineNum?: number
  Description?: string
  Amount: number
  DetailType: 'SalesItemLineDetail' | 'SubTotalLineDetail' | 'DiscountLineDetail'
  SalesItemLineDetail?: {
    ItemRef: { value: string; name?: string }
    Qty?: number
    UnitPrice?: number
    TaxCodeRef?: { value: string }
  }
}

export interface QBAddress {
  Line1?: string
  Line2?: string
  City?: string
  CountrySubDivisionCode?: string
  PostalCode?: string
  Country?: string
}

export interface QBInvoice {
  Id: string
  DocNumber?: string
  TxnDate: string
  DueDate?: string
  CustomerRef: { value: string; name?: string }
  Line: QBInvoiceLine[]
  TotalAmt: number
  Balance: number
  EmailStatus?: 'NotSet' | 'NeedToSend' | 'EmailSent'
  BillEmail?: { Address: string }
  BillAddr?: QBAddress
  ShipAddr?: QBAddress
  CustomerMemo?: { value: string }
  PrivateNote?: string
  TxnStatus?: string
  TxnTaxDetail?: {
    TotalTax?: number
    TaxLine?: Array<{
      Amount: number
      DetailType: string
    }>
  }
  LinkedTxn?: Array<{
    TxnId: string
    TxnType: string
  }>
  MetaData?: {
    CreateTime: string
    LastUpdatedTime: string
  }
}

export interface QBInvoiceCreateInput {
  CustomerRef: { value: string }
  Line: Array<{
    Description?: string
    Amount: number
    DetailType: 'SalesItemLineDetail'
    SalesItemLineDetail: {
      ItemRef: { value: string }
      Qty?: number
      UnitPrice?: number
      TaxCodeRef?: { value: string }
    }
  }>
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  BillEmail?: { Address: string }
  CustomerMemo?: { value: string }
  PrivateNote?: string
}

// List all invoices from QuickBooks
export async function listInvoices(options?: {
  maxResults?: number
  startPosition?: number
  startDate?: string
  endDate?: string
  customerId?: string
}): Promise<QBInvoice[]> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  const { maxResults = 1000, startPosition = 1, startDate, endDate, customerId } = options || {}

  const whereConditions: string[] = []
  if (startDate) whereConditions.push(`TxnDate >= '${startDate}'`)
  if (endDate) whereConditions.push(`TxnDate <= '${endDate}'`)
  if (customerId) whereConditions.push(`CustomerRef = '${customerId}'`)

  return withRetry(async () => {
    const { results } = await client.invoices.getAllInvoices({
      maxResults,
      startPosition,
      ...(whereConditions.length > 0 && { where: whereConditions.join(' AND ') }),
    })
    return results as QBInvoice[]
  })
}

// Get a single invoice by ID
export async function getInvoice(invoiceId: string): Promise<QBInvoice | null> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.invoices.getInvoiceById(invoiceId)
    return (results as QBInvoice) || null
  })
}

// Search invoices by doc number (exact match first, then LIKE)
export async function searchInvoices(docNumber: string): Promise<QBInvoice[]> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    // First try exact match
    const { results: exactResults } = await client.invoices.getAllInvoices({
      where: `DocNumber = '${docNumber}'`,
      maxResults: 10,
    })

    if (exactResults && (exactResults as QBInvoice[]).length > 0) {
      return exactResults as QBInvoice[]
    }

    // Fall back to LIKE query for partial matches
    const { results } = await client.invoices.getAllInvoices({
      where: `DocNumber LIKE '%${docNumber}%'`,
      maxResults: 100,
    })
    return results as QBInvoice[]
  })
}

// Get invoice by DocNumber using raw query
export async function getInvoiceByDocNumber(docNumber: string): Promise<QBInvoice | null> {
  // Use raw API query for more reliable results
  const query = `SELECT * FROM Invoice WHERE DocNumber = '${docNumber}'`
  const encodedQuery = encodeURIComponent(query)

  try {
    const response = await qbApiCall<{ QueryResponse: { Invoice?: QBInvoice[] } }>(
      'GET',
      `query?query=${encodedQuery}`
    )

    const invoices = response?.QueryResponse?.Invoice
    if (invoices && invoices.length > 0) {
      return invoices[0]!
    }
    return null
  } catch (error) {
    console.error('Error fetching invoice by DocNumber:', error)
    return null
  }
}

// Create a new invoice in QuickBooks
export async function createInvoice(input: QBInvoiceCreateInput): Promise<QBInvoice> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  // Set default transaction date if not provided
  const invoiceData = {
    ...input,
    TxnDate: input.TxnDate || new Date().toISOString().split('T')[0],
  }

  return withRetry(async () => {
    const { results } = await client.invoices.createInvoice(invoiceData)
    return results as QBInvoice
  })
}

// Update an existing invoice
export async function updateInvoice(
  invoiceId: string,
  syncToken: string,
  updates: Partial<QBInvoiceCreateInput>
): Promise<QBInvoice> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.invoices.updateInvoice({
      Id: invoiceId,
      SyncToken: syncToken,
      ...updates,
    })
    return results as QBInvoice
  })
}

// Delete/void an invoice
export async function voidInvoice(invoiceId: string, syncToken: string): Promise<QBInvoice> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.invoices.voidInvoice({
      Id: invoiceId,
      SyncToken: syncToken,
    })
    return results as QBInvoice
  })
}

// Get invoice PDF
export async function getInvoicePdf(invoiceId: string): Promise<Buffer> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const pdf = await client.invoices.getInvoicePdf(invoiceId)
    return pdf as Buffer
  })
}

// Send invoice via email
export async function sendInvoice(invoiceId: string, email?: string): Promise<QBInvoice> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.invoices.sendInvoice(invoiceId, email)
    return results as QBInvoice
  })
}

// Get invoice count
export async function getInvoiceCount(options?: {
  startDate?: string
  endDate?: string
}): Promise<number> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  const whereConditions: string[] = []
  if (options?.startDate) whereConditions.push(`TxnDate >= '${options.startDate}'`)
  if (options?.endDate) whereConditions.push(`TxnDate <= '${options.endDate}'`)

  return withRetry(async () => {
    const { results } = await client.invoices.getAllInvoices({
      select: 'COUNT(*)',
      ...(whereConditions.length > 0 && { where: whereConditions.join(' AND ') }),
    })
    return Array.isArray(results) ? results.length : 0
  })
}

// Get payments for reconciliation
export async function listPayments(options?: {
  maxResults?: number
  startDate?: string
  endDate?: string
}): Promise<
  Array<{
    Id: string
    TotalAmt: number
    TxnDate: string
    CustomerRef: { value: string; name?: string }
    PaymentRefNum?: string
    Line?: Array<{
      LinkedTxn: Array<{
        TxnId: string
        TxnType: string
      }>
    }>
  }>
> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  const { maxResults = 1000, startDate, endDate } = options || {}

  const whereConditions: string[] = []
  if (startDate) whereConditions.push(`TxnDate >= '${startDate}'`)
  if (endDate) whereConditions.push(`TxnDate <= '${endDate}'`)

  return withRetry(async () => {
    const { results } = await client.payments.getAllPayments({
      maxResults,
      ...(whereConditions.length > 0 && { where: whereConditions.join(' AND ') }),
    })
    return results as Array<{
      Id: string
      TotalAmt: number
      TxnDate: string
      CustomerRef: { value: string; name?: string }
      PaymentRefNum?: string
      Line?: Array<{
        LinkedTxn: Array<{
          TxnId: string
          TxnType: string
        }>
      }>
    }>
  })
}
