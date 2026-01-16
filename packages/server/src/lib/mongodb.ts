import { MongoClient, Db } from 'mongodb'

let client: MongoClient | null = null
let db: Db | null = null

// Get MongoDB connection (read-only)
export async function getMongoDb(): Promise<Db> {
  if (db) return db

  const uri = process.env.ATEK_MONGO_URI
  if (!uri) {
    throw new Error('ATEK_MONGO_URI environment variable is not set')
  }

  client = new MongoClient(uri, {
    // Read-only settings
    readPreference: 'secondaryPreferred',
    maxPoolSize: 10,
    minPoolSize: 1,
  })

  await client.connect()
  db = client.db() // Uses database from connection string

  console.log('Connected to ATEK MongoDB (read-only)')
  return db
}

// Check if MongoDB is connected
export async function isMongoConnected(): Promise<boolean> {
  try {
    if (!client) return false
    await client.db().admin().ping()
    return true
  } catch {
    return false
  }
}

// Get connection status
export async function getMongoConnectionStatus(): Promise<{
  connected: boolean
  database: string | null
  error: string | null
}> {
  try {
    const database = await getMongoDb()
    return {
      connected: true,
      database: database.databaseName,
      error: null,
    }
  } catch (error) {
    return {
      connected: false,
      database: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Close connection (for cleanup)
export async function closeMongoConnection(): Promise<void> {
  if (client) {
    await client.close()
    client = null
    db = null
  }
}

// Helper to safely get a collection
export async function getCollection<T extends Document>(name: string) {
  const database = await getMongoDb()
  return database.collection<T>(name)
}
