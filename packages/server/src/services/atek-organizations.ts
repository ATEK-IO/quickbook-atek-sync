import { ObjectId } from 'mongodb'
import { getCollection } from '../lib/mongodb'

// ATEK Organization structure (actual schema from MongoDB)
export interface ATEKOrganization {
  _id: ObjectId
  name: string
  enabled: boolean
  description?: string
  timezone?: string
  language?: string
  org_num?: number
  sites?: Array<{
    _id?: ObjectId
    name?: string
    address?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }>
  users?: ObjectId[]
  tags?: string[]
  featureFlags?: Record<string, boolean>
  hubspot_link?: string
  gdrive_link?: string
}

// Normalized organization for sync
export interface NormalizedOrganization {
  id: string
  name: string
  enabled: boolean
  description: string | null
  timezone: string | null
  orgNumber: number | null
  primarySite: {
    name: string | null
    address: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
  } | null
}

// Collection name (configurable via env)
const COLLECTION_NAME = process.env.ATEK_ORGANIZATIONS_COLLECTION || 'organizations'

// List all organizations
export async function listOrganizations(options?: {
  activeOnly?: boolean
  customerOnly?: boolean
  limit?: number
  skip?: number
}): Promise<NormalizedOrganization[]> {
  const { activeOnly = true, customerOnly = false, limit = 1000, skip = 0 } = options || {}

  const collection = await getCollection<ATEKOrganization>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {}
  if (activeOnly) filter.enabled = true
  if (customerOnly) filter.tags = 'customer'

  const organizations = await collection
    .find(filter)
    .skip(skip)
    .limit(limit)
    .toArray()

  return organizations.map(normalizeOrganization)
}

// Get organization by ID
export async function getOrganization(id: string): Promise<NormalizedOrganization | null> {
  const collection = await getCollection<ATEKOrganization>(COLLECTION_NAME)

  const organization = await collection.findOne({ _id: new ObjectId(id) })

  return organization ? normalizeOrganization(organization) : null
}

// Search organizations by name
export async function searchOrganizations(query: string): Promise<NormalizedOrganization[]> {
  const collection = await getCollection<ATEKOrganization>(COLLECTION_NAME)

  const organizations = await collection
    .find({
      name: { $regex: query, $options: 'i' },
      enabled: true,
    })
    .limit(100)
    .toArray()

  return organizations.map(normalizeOrganization)
}

// Get organization count
export async function getOrganizationCount(activeOnly = true): Promise<number> {
  const collection = await getCollection<ATEKOrganization>(COLLECTION_NAME)

  const filter = activeOnly ? { enabled: true } : {}
  return collection.countDocuments(filter)
}

// Get organizations with their users
export async function getOrganizationsWithManagers(): Promise<
  Array<NormalizedOrganization & { userCount: number }>
> {
  const collection = await getCollection<ATEKOrganization>(COLLECTION_NAME)

  const organizations = await collection
    .find({ enabled: true })
    .toArray()

  return organizations.map((org) => ({
    ...normalizeOrganization(org),
    userCount: org.users?.length || 0,
  }))
}

// Normalize organization for consistent output
function normalizeOrganization(org: ATEKOrganization): NormalizedOrganization {
  const primarySite = org.sites?.[0]
  return {
    id: org._id.toString(),
    name: org.name,
    enabled: org.enabled,
    description: org.description || null,
    timezone: org.timezone || null,
    orgNumber: org.org_num || null,
    primarySite: primarySite
      ? {
          name: primarySite.name || null,
          address: primarySite.address || null,
          city: primarySite.city || null,
          state: primarySite.state || null,
          postalCode: primarySite.postalCode || null,
          country: primarySite.country || null,
        }
      : null,
  }
}
