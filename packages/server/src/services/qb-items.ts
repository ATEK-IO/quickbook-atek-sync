import { createApiClient, withRetry, qbApiCall } from '../lib/quickbooks'

export type QBItemType = 'Inventory' | 'NonInventory' | 'Service' | 'Category' | 'Group' | 'Bundle'

export interface QBItem {
  Id: string
  Name: string
  Description?: string
  Type: QBItemType
  Active: boolean
  UnitPrice?: number
  PurchaseCost?: number
  QtyOnHand?: number
  IncomeAccountRef?: { value: string; name: string }
  ExpenseAccountRef?: { value: string; name: string }
  AssetAccountRef?: { value: string; name: string }
  Taxable?: boolean
  SalesTaxCodeRef?: { value: string; name: string }
  Sku?: string
  MetaData?: {
    CreateTime: string
    LastUpdatedTime: string
  }
}

export interface QBItemCreateInput {
  Name: string
  Type: QBItemType
  Description?: string
  UnitPrice?: number
  PurchaseCost?: number
  QtyOnHand?: number
  IncomeAccountRef?: { value: string; name?: string }
  ExpenseAccountRef?: { value: string; name?: string }
  AssetAccountRef?: { value: string; name?: string }
  Taxable?: boolean
  SalesTaxCodeRef?: { value: string }
  Sku?: string
  InvStartDate?: string // Required for Inventory items
  TrackQtyOnHand?: boolean
}

// List all items from QuickBooks (using raw API with pagination)
export async function listItems(options?: {
  maxResults?: number
  startPosition?: number
  activeOnly?: boolean
  type?: QBItemType
}): Promise<QBItem[]> {
  const { maxResults = 1000, activeOnly = true, type } = options || {}
  const allItems: QBItem[] = []
  let startPosition = 1
  const pageSize = 100

  const whereConditions: string[] = []
  if (activeOnly) whereConditions.push('Active = true')
  if (type) whereConditions.push(`Type = '${type}'`)

  const whereClause = whereConditions.length > 0
    ? ` WHERE ${whereConditions.join(' AND ')}`
    : ''

  while (allItems.length < maxResults) {
    const query = `SELECT * FROM Item${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`

    const response = await withRetry(async () =>
      qbApiCall<{ QueryResponse: { Item?: QBItem[] } }>(
        'GET',
        `query?query=${encodeURIComponent(query)}`
      )
    )

    const items = response.QueryResponse?.Item || []
    if (items.length === 0) break

    allItems.push(...items)
    if (items.length < pageSize) break // Last page
    startPosition += pageSize
  }

  return allItems
}

// Get a single item by ID
export async function getItem(itemId: string): Promise<QBItem | null> {
  const query = `SELECT * FROM Item WHERE Id = '${itemId}'`

  const response = await withRetry(async () =>
    qbApiCall<{ QueryResponse: { Item?: QBItem[] } }>(
      'GET',
      `query?query=${encodeURIComponent(query)}`
    )
  )

  const items = response.QueryResponse?.Item || []
  return items[0] || null
}

// Search items by name or SKU
export async function searchItems(query: string): Promise<QBItem[]> {
  // Escape single quotes in the search query
  const escapedQuery = query.replace(/'/g, "\\'")
  const sqlQuery = `SELECT * FROM Item WHERE Name LIKE '%${escapedQuery}%' MAXRESULTS 100`

  const response = await withRetry(async () =>
    qbApiCall<{ QueryResponse: { Item?: QBItem[] } }>(
      'GET',
      `query?query=${encodeURIComponent(sqlQuery)}`
    )
  )

  return response.QueryResponse?.Item || []
}

// Create a new item in QuickBooks
export async function createItem(input: QBItemCreateInput): Promise<QBItem> {
  // Set required fields based on item type
  const itemData: Record<string, unknown> = { ...input }

  // Ensure item is created as active
  itemData.Active = true

  if (input.Type === 'Inventory') {
    itemData.TrackQtyOnHand = true
    itemData.InvStartDate = input.InvStartDate || new Date().toISOString().split('T')[0]
    itemData.QtyOnHand = input.QtyOnHand ?? 0
  }

  const response = await withRetry(async () =>
    qbApiCall<{ Item: QBItem }>(
      'POST',
      'item',
      itemData
    )
  )

  return response.Item
}

// Update an existing item
export async function updateItem(
  itemId: string,
  syncToken: string,
  updates: Partial<QBItemCreateInput>
): Promise<QBItem> {
  const itemData = {
    Id: itemId,
    SyncToken: syncToken,
    sparse: true,
    ...updates,
  }

  const response = await withRetry(async () =>
    qbApiCall<{ Item: QBItem }>(
      'POST',
      'item',
      itemData
    )
  )

  return response.Item
}

// Get item count
export async function getItemCount(): Promise<number> {
  const query = 'SELECT COUNT(*) FROM Item'

  const response = await withRetry(async () =>
    qbApiCall<{ QueryResponse: { totalCount?: number } }>(
      'GET',
      `query?query=${encodeURIComponent(query)}`
    )
  )

  return response.QueryResponse?.totalCount || 0
}

// QB Account types for filtering
interface QBAccount {
  Id: string
  Name: string
  AccountType: string
  AccountSubType?: string
}

// Debug: Get all unique account types
export async function getAccountTypes(): Promise<string[]> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  const { results } = await client.accounts.getAllAccounts({ maxResults: 500 })
  const accounts = results as QBAccount[]
  const types = [...new Set(accounts.map((a) => a.AccountType))]
  console.log('Available AccountTypes:', types)
  console.log('Sample accounts by type:')
  types.forEach((t) => {
    const sample = accounts.filter((a) => a.AccountType === t).slice(0, 3)
    console.log(`  ${t}:`, sample.map((a) => a.Name))
  })
  return types
}

// Get income accounts for item creation dropdown (Income + Other Income types)
export async function getIncomeAccounts(): Promise<Array<{ value: string; name: string }>> {
  const query = `SELECT Id, Name, AccountType, AccountSubType FROM Account WHERE AccountType IN ('Income', 'Other Income') MAXRESULTS 500`

  const response = await withRetry(async () =>
    qbApiCall<{ QueryResponse: { Account?: QBAccount[] } }>(
      'GET',
      `query?query=${encodeURIComponent(query)}`
    )
  )

  const accounts = response.QueryResponse?.Account || []

  return accounts.map((a) => ({
    value: a.Id,
    name: a.Name,
  }))
}

// Get COGS accounts for item creation dropdown (Cost of Goods Sold only)
export async function getExpenseAccounts(): Promise<Array<{ value: string; name: string }>> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.accounts.getAllAccounts({
      maxResults: 500,
    })
    const accounts = results as QBAccount[]
    return accounts
      .filter((a) => a.AccountType === 'Cost of Goods Sold')
      .map((a) => ({
        value: a.Id,
        name: a.Name,
      }))
  })
}

// Get asset accounts for inventory items
export async function getAssetAccounts(): Promise<Array<{ value: string; name: string }>> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.accounts.getAllAccounts({
      maxResults: 500,
    })
    const accounts = results as QBAccount[]
    return accounts
      .filter((a) => a.AccountType === 'Other Current Asset')
      .map((a) => ({
        value: a.Id,
        name: a.Name,
      }))
  })
}

// Determine QB item type from ATEK category
export function determineItemType(
  category: string,
  inventoryTracked?: boolean
): QBItemType {
  const serviceCategories = ['service', 'subscription', 'support', 'consulting']
  const hardwareCategory = 'hardware'

  const normalizedCategory = category.toLowerCase()

  if (serviceCategories.some((c) => normalizedCategory.includes(c))) {
    return 'Service'
  }

  if (normalizedCategory.includes(hardwareCategory) && inventoryTracked) {
    return 'Inventory'
  }

  if (
    normalizedCategory.includes(hardwareCategory) ||
    normalizedCategory.includes('software') ||
    normalizedCategory.includes('license')
  ) {
    return 'NonInventory'
  }

  // Default to Service
  return 'Service'
}
