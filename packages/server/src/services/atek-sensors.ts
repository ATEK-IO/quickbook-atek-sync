import { getCollection } from '../lib/mongodb'
import { ObjectId } from 'mongodb'

interface ATEKSensor {
  _id: ObjectId
  organisation: ObjectId
  name: string
  archived?: boolean
  billable?: boolean
}

/**
 * Get sensor counts grouped by organization (excluding archived sensors)
 */
export async function getSensorCountsByOrganization(): Promise<Record<string, number>> {
  const collection = await getCollection<ATEKSensor>(
    process.env.ATEK_SENSORS_COLLECTION || 'sensors'
  )

  const pipeline = [
    { $match: { archived: { $ne: true } } },
    { $group: { _id: '$organisation', count: { $sum: 1 } } },
  ]

  const results = await collection.aggregate(pipeline).toArray()
  const counts: Record<string, number> = {}

  for (const r of results) {
    if (r._id) {
      counts[r._id.toString()] = r.count as number
    }
  }

  return counts
}
