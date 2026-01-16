import { createApiClient, withRetry, qbApiCall } from '../lib/quickbooks'

export interface QBCustomer {
  Id: string
  DisplayName: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryEmailAddr?: { Address: string }
  PrimaryPhone?: { FreeFormNumber: string }
  BillAddr?: {
    Line1?: string
    City?: string
    CountrySubDivisionCode?: string
    PostalCode?: string
    Country?: string
  }
  Notes?: string
  Active: boolean
  Balance?: number
  MetaData?: {
    CreateTime: string
    LastUpdatedTime: string
  }
}

export interface QBCustomerCreateInput {
  DisplayName: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryEmailAddr?: { Address: string }
  PrimaryPhone?: { FreeFormNumber: string }
  BillAddr?: {
    Line1?: string
    City?: string
    CountrySubDivisionCode?: string
    PostalCode?: string
    Country?: string
  }
  Notes?: string
}

// List all customers from QuickBooks (using raw API with proper pagination)
export async function listCustomers(options?: {
  maxResults?: number
  activeOnly?: boolean
}): Promise<QBCustomer[]> {
  const { maxResults = 5000, activeOnly = true } = options || {}
  const allCustomers: QBCustomer[] = []
  let startPosition = 1
  const pageSize = 100

  const whereClause = activeOnly ? ' WHERE Active = true' : ''

  while (allCustomers.length < maxResults) {
    const query = `SELECT * FROM Customer${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`

    const response = await withRetry(async () =>
      qbApiCall<{ QueryResponse: { Customer?: QBCustomer[] } }>(
        'GET',
        `query?query=${encodeURIComponent(query)}`
      )
    )

    const customers = response.QueryResponse?.Customer || []
    if (customers.length === 0) break

    allCustomers.push(...customers)
    if (customers.length < pageSize) break // Last page
    startPosition += pageSize
  }

  return allCustomers
}

// Get a single customer by ID
export async function getCustomer(customerId: string): Promise<QBCustomer | null> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.customers.getCustomerById(customerId)
    return (results as QBCustomer) || null
  })
}

// Search customers by display name or email
export async function searchCustomers(query: string): Promise<QBCustomer[]> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    // Search by display name (case-insensitive LIKE)
    const { results } = await client.customers.getAllCustomers({
      where: `DisplayName LIKE '%${query}%'`,
      maxResults: 100,
    })
    return results as QBCustomer[]
  })
}

// Create a new customer in QuickBooks
export async function createCustomer(input: QBCustomerCreateInput): Promise<QBCustomer> {
  return withRetry(async () => {
    const response = await qbApiCall<{ Customer: QBCustomer }>('POST', 'customer', input)
    return response.Customer
  })
}

// Update an existing customer
export async function updateCustomer(
  customerId: string,
  syncToken: string,
  updates: Partial<QBCustomerCreateInput>
): Promise<QBCustomer> {
  return withRetry(async () => {
    const response = await qbApiCall<{ Customer: QBCustomer }>('POST', 'customer', {
      Id: customerId,
      SyncToken: syncToken,
      sparse: true,
      ...updates,
    })
    return response.Customer
  })
}

// Get customer count
export async function getCustomerCount(): Promise<number> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.customers.getAllCustomers({
      select: 'COUNT(*)',
    })
    // The count query returns a different structure
    return Array.isArray(results) ? results.length : 0
  })
}
