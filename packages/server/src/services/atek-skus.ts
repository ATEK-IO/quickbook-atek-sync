import { ObjectId } from 'mongodb'
import { getCollection } from '../lib/mongodb'

// ATEK SKU/Product structure
export interface ATEKSKU {
  _id: ObjectId
  code: string // SKU code (e.g., "SVC-001", "HW-LAPTOP-01")
  name: string
  description?: string
  category?: string // Service, Hardware, Software, License, Subscription, etc.
  subcategory?: string
  unitPrice?: number
  currency?: string
  taxCategory?: string // Taxable, Non-Taxable, etc.
  status: 'active' | 'inactive' | 'discontinued'
  inventoryTracked?: boolean
  quantityOnHand?: number
  reorderPoint?: number
  vendor?: string
  costPrice?: number
  createdAt: Date
  updatedAt: Date
}

// Normalized SKU for sync
export interface NormalizedSKU {
  id: string
  code: string
  name: string
  description: string | null
  category: string | null
  subcategory: string | null
  unitPrice: number | null
  currency: string
  taxCategory: string | null
  status: string
  inventoryTracked: boolean
  quantityOnHand: number | null
  costPrice: number | null
}

// Collection name (configurable via env)
const COLLECTION_NAME = process.env.ATEK_SKUS_COLLECTION || 'skus'

// List all active SKUs
export async function listSKUs(options?: {
  activeOnly?: boolean
  category?: string
  limit?: number
  skip?: number
}): Promise<NormalizedSKU[]> {
  const { activeOnly = true, category, limit = 5000, skip = 0 } = options || {}

  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {}
  if (activeOnly) filter.status = 'active'
  if (category) filter.category = { $regex: category, $options: 'i' }

  const skus = await collection
    .find(filter)
    .skip(skip)
    .limit(limit)
    .toArray()

  return skus.map(normalizeSKU)
}

// Get SKU by ID
export async function getSKU(id: string): Promise<NormalizedSKU | null> {
  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const sku = await collection.findOne({ _id: new ObjectId(id) })

  return sku ? normalizeSKU(sku) : null
}

// Get SKU by code
export async function getSKUByCode(code: string): Promise<NormalizedSKU | null> {
  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const sku = await collection.findOne({
    code: { $regex: `^${code}$`, $options: 'i' },
  })

  return sku ? normalizeSKU(sku) : null
}

// Search SKUs by code or name
export async function searchSKUs(query: string): Promise<NormalizedSKU[]> {
  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const skus = await collection
    .find({
      $or: [
        { code: { $regex: query, $options: 'i' } },
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
      ],
      status: 'active',
    })
    .limit(100)
    .toArray()

  return skus.map(normalizeSKU)
}

// Get SKU count
export async function getSKUCount(activeOnly = true): Promise<number> {
  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const filter = activeOnly ? { status: 'active' } : {}
  return collection.countDocuments(filter)
}

// Get SKUs by category
export async function getSKUsByCategory(category: string): Promise<NormalizedSKU[]> {
  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const skus = await collection
    .find({
      category: { $regex: category, $options: 'i' },
      status: 'active',
    })
    .toArray()

  return skus.map(normalizeSKU)
}

// Get all unique categories
export async function getCategories(): Promise<string[]> {
  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const categories = await collection.distinct('category', { status: 'active' })
  return categories.filter(Boolean) as string[]
}

// Get SKUs that need QB item creation (not yet mapped)
export async function getUnmappedSKUIds(mappedSkuIds: string[]): Promise<NormalizedSKU[]> {
  const collection = await getCollection<ATEKSKU>(COLLECTION_NAME)

  const mappedObjectIds = mappedSkuIds.map((id) => new ObjectId(id))

  const skus = await collection
    .find({
      _id: { $nin: mappedObjectIds },
      status: 'active',
    })
    .toArray()

  return skus.map(normalizeSKU)
}

// Normalize SKU for consistent output
function normalizeSKU(sku: ATEKSKU): NormalizedSKU {
  return {
    id: sku._id.toString(),
    code: sku.code,
    name: sku.name,
    description: sku.description || null,
    category: sku.category || null,
    subcategory: sku.subcategory || null,
    unitPrice: sku.unitPrice ?? null,
    currency: sku.currency || 'USD',
    taxCategory: sku.taxCategory || null,
    status: sku.status,
    inventoryTracked: sku.inventoryTracked || false,
    quantityOnHand: sku.quantityOnHand ?? null,
    costPrice: sku.costPrice ?? null,
  }
}
