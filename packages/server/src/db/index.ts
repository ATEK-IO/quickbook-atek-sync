import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

const sqlite = new Database(process.env.DATABASE_URL?.replace('file:', '') || './data/qb-sync.db')

// Enable WAL mode for better concurrent read performance
sqlite.exec('PRAGMA journal_mode = WAL')

export const db = drizzle(sqlite, { schema })

export * from './schema'
