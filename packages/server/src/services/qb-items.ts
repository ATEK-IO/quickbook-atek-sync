import { createApiClient, withRetry } from '../lib/quickbooks'

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

// List all items from QuickBooks
export async function listItems(options?: {
  maxResults?: number
  startPosition?: number
  activeOnly?: boolean
  type?: QBItemType
}): Promise<QBItem[]> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  const { maxResults = 1000, startPosition = 1, activeOnly = true, type } = options || {}

  const whereConditions: string[] = []
  if (activeOnly) whereConditions.push('Active = true')
  if (type) whereConditions.push(`Type = '${type}'`)

  return withRetry(async () => {
    const { results } = await client.items.getAllItems({
      maxResults,
      startPosition,
      ...(whereConditions.length > 0 && { where: whereConditions.join(' AND ') }),
    })
    return results as QBItem[]
  })
}

// Get a single item by ID
export async function getItem(itemId: string): Promise<QBItem | null> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.items.getItemById(itemId)
    return (results as QBItem) || null
  })
}

// Search items by name or SKU
export async function searchItems(query: string): Promise<QBItem[]> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.items.getAllItems({
      where: `Name LIKE '%${query}%'`,
      maxResults: 100,
    })
    return results as QBItem[]
  })
}

// Create a new item in QuickBooks
export async function createItem(input: QBItemCreateInput): Promise<QBItem> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  // Set required fields based on item type
  const itemData: Record<string, unknown> = { ...input }

  if (input.Type === 'Inventory') {
    itemData.TrackQtyOnHand = true
    itemData.InvStartDate = input.InvStartDate || new Date().toISOString().split('T')[0]
    itemData.QtyOnHand = input.QtyOnHand ?? 0
  }

  return withRetry(async () => {
    const { results } = await client.items.createItem(itemData)
    return results as QBItem
  })
}

// Update an existing item
export async function updateItem(
  itemId: string,
  syncToken: string,
  updates: Partial<QBItemCreateInput>
): Promise<QBItem> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.items.updateItem({
      Id: itemId,
      SyncToken: syncToken,
      ...updates,
    })
    return results as QBItem
  })
}

// Get item count
export async function getItemCount(): Promise<number> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.items.getAllItems({
      select: 'COUNT(*)',
    })
    return Array.isArray(results) ? results.length : 0
  })
}

// Get income accounts for item creation dropdown
export async function getIncomeAccounts(): Promise<Array<{ value: string; name: string }>> {
  const client = await createApiClient()
  if (!client) throw new Error('QuickBooks not connected')

  return withRetry(async () => {
    const { results } = await client.accounts.getAllAccounts({
      where: "AccountType = 'Income'",
      maxResults: 100,
    })
    return (results as Array<{ Id: string; Name: string }>).map((a) => ({
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
