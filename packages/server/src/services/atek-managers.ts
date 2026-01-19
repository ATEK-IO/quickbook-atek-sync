import { ObjectId } from 'mongodb'
import { getCollection } from '../lib/mongodb'

// ATEK User/Manager structure (actual MongoDB schema - uses lowercase field names)
export interface ATEKUser {
  _id: ObjectId
  email: string
  firstname?: string // lowercase in MongoDB
  lastname?: string // lowercase in MongoDB
  name?: string // Some systems use full name
  role?: string
  status?: 'active' | 'inactive' | 'pending'
  enabled?: boolean
  phone?: string
  organisations?: ObjectId[] // Organizations this user manages (lowercase 's')
  organization?: ObjectId // Single organization
  created_at?: Date
  updated_at?: Date
}

// Normalized manager for sync
export interface NormalizedManager {
  id: string
  email: string
  name: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  status: string
  organizationIds: string[]
}

// Collection name (configurable via env)
const COLLECTION_NAME = process.env.ATEK_USERS_COLLECTION || 'users'

// List all contractual managers (users with manager role or assigned organizations)
export async function listContractualManagers(options?: {
  activeOnly?: boolean
  limit?: number
  skip?: number
}): Promise<NormalizedManager[]> {
  const { activeOnly = true, limit = 1000, skip = 0 } = options || {}

  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {}
  if (activeOnly) {
    // Check either status or enabled field
    filter.$or = [
      { status: 'active' },
      { enabled: true }
    ]
  }

  // Filter for users who are managers or have organizations assigned
  filter.$and = filter.$and || []
  ;(filter.$and as unknown[]).push({
    $or: [
      { role: { $in: ['manager', 'contractual_manager', 'account_manager'] } },
      { organisations: { $exists: true, $ne: [] } },
    ]
  })

  const managers = await collection
    .find(filter)
    .skip(skip)
    .limit(limit)
    .toArray()

  return managers.map(normalizeManager)
}

// Get users by specific IDs (for looking up managers from invoices)
export async function getUsersByIds(ids: string[]): Promise<NormalizedManager[]> {
  if (ids.length === 0) return []

  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  // Convert string IDs to ObjectIds, filtering out invalid ones
  const objectIds = ids
    .filter((id) => id && ObjectId.isValid(id))
    .map((id) => new ObjectId(id))

  if (objectIds.length === 0) return []

  const users = await collection
    .find({ _id: { $in: objectIds } })
    .toArray()

  return users.map(normalizeManager)
}

// Get manager by ID
export async function getManager(id: string): Promise<NormalizedManager | null> {
  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const manager = await collection.findOne({ _id: new ObjectId(id) })

  return manager ? normalizeManager(manager) : null
}

// Get manager by email
export async function getManagerByEmail(email: string): Promise<NormalizedManager | null> {
  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const manager = await collection.findOne({
    email: { $regex: `^${email}$`, $options: 'i' },
  })

  return manager ? normalizeManager(manager) : null
}

// Search managers by name or email
export async function searchManagers(query: string): Promise<NormalizedManager[]> {
  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const managers = await collection
    .find({
      $and: [
        {
          $or: [
            { email: { $regex: query, $options: 'i' } },
            { name: { $regex: query, $options: 'i' } },
            { firstname: { $regex: query, $options: 'i' } },
            { lastname: { $regex: query, $options: 'i' } },
          ]
        },
        {
          $or: [
            { status: 'active' },
            { enabled: true }
          ]
        }
      ]
    })
    .limit(100)
    .toArray()

  return managers.map(normalizeManager)
}

// Get manager count
export async function getManagerCount(activeOnly = true): Promise<number> {
  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {}
  if (activeOnly) {
    filter.$or = [
      { status: 'active' },
      { enabled: true }
    ]
  }

  return collection.countDocuments(filter)
}

// Get managers for a specific organization
export async function getManagersForOrganization(organizationId: string): Promise<NormalizedManager[]> {
  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const managers = await collection
    .find({
      $and: [
        { organisations: new ObjectId(organizationId) },
        {
          $or: [
            { status: 'active' },
            { enabled: true }
          ]
        }
      ]
    })
    .toArray()

  return managers.map(normalizeManager)
}

// Normalize manager for consistent output
function normalizeManager(user: ATEKUser): NormalizedManager {
  // Use lowercase field names from MongoDB
  const firstName = user.firstname || null
  const lastName = user.lastname || null
  const fullName = user.name || [firstName, lastName].filter(Boolean).join(' ') || user.email.split('@')[0]

  return {
    id: user._id.toString(),
    email: user.email,
    name: fullName,
    firstName,
    lastName,
    phone: user.phone || null,
    status: user.status || (user.enabled ? 'active' : 'inactive'),
    organizationIds: user.organisations?.map((id) => id.toString()) || [],
  }
}
