import { ObjectId } from 'mongodb'
import { getCollection } from '../lib/mongodb'

// ATEK User/Manager structure
export interface ATEKUser {
  _id: ObjectId
  email: string
  firstName?: string
  lastName?: string
  name?: string // Some systems use full name
  role?: string
  status: 'active' | 'inactive' | 'pending'
  phone?: string
  organizations?: ObjectId[] // Organizations this user manages
  createdAt: Date
  updatedAt: Date
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
  if (activeOnly) filter.status = 'active'

  // Filter for users who are managers or have organizations assigned
  filter.$or = [
    { role: { $in: ['manager', 'contractual_manager', 'account_manager'] } },
    { organizations: { $exists: true, $ne: [] } },
  ]

  const managers = await collection
    .find(filter)
    .skip(skip)
    .limit(limit)
    .toArray()

  return managers.map(normalizeManager)
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
      $or: [
        { email: { $regex: query, $options: 'i' } },
        { name: { $regex: query, $options: 'i' } },
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
      ],
      status: 'active',
    })
    .limit(100)
    .toArray()

  return managers.map(normalizeManager)
}

// Get manager count
export async function getManagerCount(activeOnly = true): Promise<number> {
  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const filter: Record<string, unknown> = {}
  if (activeOnly) filter.status = 'active'
  filter.$or = [
    { role: { $in: ['manager', 'contractual_manager', 'account_manager'] } },
    { organizations: { $exists: true, $ne: [] } },
  ]

  return collection.countDocuments(filter)
}

// Get managers for a specific organization
export async function getManagersForOrganization(organizationId: string): Promise<NormalizedManager[]> {
  const collection = await getCollection<ATEKUser>(COLLECTION_NAME)

  const managers = await collection
    .find({
      organizations: new ObjectId(organizationId),
      status: 'active',
    })
    .toArray()

  return managers.map(normalizeManager)
}

// Normalize manager for consistent output
function normalizeManager(user: ATEKUser): NormalizedManager {
  const firstName = user.firstName || null
  const lastName = user.lastName || null
  const fullName = user.name || [firstName, lastName].filter(Boolean).join(' ') || user.email.split('@')[0]

  return {
    id: user._id.toString(),
    email: user.email,
    name: fullName,
    firstName,
    lastName,
    phone: user.phone || null,
    status: user.status,
    organizationIds: user.organizations?.map((id) => id.toString()) || [],
  }
}
