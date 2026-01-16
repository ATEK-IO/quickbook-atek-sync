import { ApiClient, AuthProvider, AuthScopes, Environment } from 'quickbooks-api'
import { db, qbAuthTokens } from '../db'
import { eq } from 'drizzle-orm'

// QuickBooks API base URLs
const QB_API_BASE = {
  production: 'https://quickbooks.api.intuit.com/v3/company',
  sandbox: 'https://sandbox-quickbooks.api.intuit.com/v3/company',
}

// Initialize QuickBooks Auth Provider
export function createAuthProvider() {
  return new AuthProvider(
    process.env.QB_CLIENT_ID || '',
    process.env.QB_CLIENT_SECRET || '',
    process.env.QB_REDIRECT_URI || 'http://localhost:4011/api/quickbooks/callback',
    [AuthScopes.Accounting]
  )
}

// Get environment based on config
export function getQBEnvironment(): Environment {
  return process.env.QB_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox
}

// Get the active realm ID (first connected company)
export async function getActiveRealmId(): Promise<string | null> {
  const token = await db.query.qbAuthTokens.findFirst()
  return token?.realmId || null
}

// Check if QuickBooks is connected
export async function isConnected(): Promise<boolean> {
  const token = await db.query.qbAuthTokens.findFirst()
  if (!token) return false

  // Check if refresh token is still valid
  const refreshExpiry = new Date(token.refreshTokenExpiresAt)
  return refreshExpiry > new Date()
}

// Get connection status with details
export async function getConnectionStatus(): Promise<{
  connected: boolean
  realmId: string | null
  accessTokenValid: boolean
  refreshTokenValid: boolean
}> {
  const token = await db.query.qbAuthTokens.findFirst()

  if (!token) {
    return {
      connected: false,
      realmId: null,
      accessTokenValid: false,
      refreshTokenValid: false,
    }
  }

  const now = new Date()
  const accessExpiry = new Date(token.accessTokenExpiresAt)
  const refreshExpiry = new Date(token.refreshTokenExpiresAt)

  return {
    connected: refreshExpiry > now,
    realmId: token.realmId,
    accessTokenValid: accessExpiry > now,
    refreshTokenValid: refreshExpiry > now,
  }
}

// Create API client with stored tokens (auto-refresh if needed)
export async function createApiClient(realmId?: string): Promise<ApiClient | null> {
  const targetRealmId = realmId || (await getActiveRealmId())
  if (!targetRealmId) return null

  const tokens = await db.query.qbAuthTokens.findFirst({
    where: eq(qbAuthTokens.realmId, targetRealmId),
  })

  if (!tokens) return null

  const authProvider = createAuthProvider()

  // Set the tokens on the auth provider
  await authProvider.setToken({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiryDate: new Date(tokens.accessTokenExpiresAt),
    refreshTokenExpiryDate: new Date(tokens.refreshTokenExpiresAt),
    realmId: tokens.realmId,
    tokenType: 'Bearer' as any,
  })

  // Check if access token needs refresh
  const accessExpiry = new Date(tokens.accessTokenExpiresAt)
  if (accessExpiry <= new Date()) {
    try {
      const newTokens = await authProvider.refresh()
      await storeTokens(
        tokens.realmId,
        newTokens.accessToken,
        newTokens.refreshToken,
        newTokens.accessTokenExpiryDate,
        newTokens.refreshTokenExpiryDate
      )
    } catch (error) {
      console.error('Failed to refresh access token:', error)
      return null
    }
  }

  return new ApiClient(authProvider, getQBEnvironment())
}

// Store OAuth tokens after successful auth
export async function storeTokens(
  realmId: string,
  accessToken: string,
  refreshToken: string,
  accessTokenExpiresAt: Date,
  refreshTokenExpiresAt: Date
) {
  const existing = await db.query.qbAuthTokens.findFirst({
    where: eq(qbAuthTokens.realmId, realmId),
  })

  if (existing) {
    await db
      .update(qbAuthTokens)
      .set({
        accessToken,
        refreshToken,
        accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(qbAuthTokens.realmId, realmId))
  } else {
    await db.insert(qbAuthTokens).values({
      realmId,
      accessToken,
      refreshToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    })
  }
}

// Disconnect QuickBooks (remove tokens)
export async function disconnect(realmId?: string) {
  const targetRealmId = realmId || (await getActiveRealmId())
  if (!targetRealmId) return

  await db.delete(qbAuthTokens).where(eq(qbAuthTokens.realmId, targetRealmId))
}

// Get authorization URL for OAuth flow
export function getAuthorizationUrl(authProvider: AuthProvider, state: string): string {
  return authProvider.generateAuthUrl(state).toString()
}

// Retry wrapper with exponential backoff
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelayMs?: number
    maxDelayMs?: number
    retryOn?: (error: unknown) => boolean
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    retryOn = (error: unknown) => {
      // Retry on rate limits and transient errors
      if (error instanceof Error) {
        const message = error.message.toLowerCase()
        return (
          message.includes('rate limit') ||
          message.includes('timeout') ||
          message.includes('network') ||
          message.includes('503') ||
          message.includes('429')
        )
      }
      return false
    },
  } = options

  let lastError: unknown
  let delay = initialDelayMs

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (attempt === maxRetries || !retryOn(error)) {
        throw error
      }

      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }

  throw lastError
}

/**
 * Make a raw API call to QuickBooks
 * Used for write operations not supported by quickbooks-api package
 */
export async function qbApiCall<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: unknown
): Promise<T> {
  const realmId = await getActiveRealmId()
  if (!realmId) throw new Error('QuickBooks not connected')

  const tokens = await db.query.qbAuthTokens.findFirst({
    where: eq(qbAuthTokens.realmId, realmId),
  })
  if (!tokens) throw new Error('QuickBooks not connected')

  // Check if access token needs refresh
  const accessExpiry = new Date(tokens.accessTokenExpiresAt)
  let accessToken = tokens.accessToken

  if (accessExpiry <= new Date()) {
    const authProvider = createAuthProvider()
    await authProvider.setToken({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiryDate: new Date(tokens.accessTokenExpiresAt),
      refreshTokenExpiryDate: new Date(tokens.refreshTokenExpiresAt),
      realmId: tokens.realmId,
      tokenType: 'Bearer' as any,
    })
    const newTokens = await authProvider.refresh()
    await storeTokens(
      realmId,
      newTokens.accessToken,
      newTokens.refreshToken,
      newTokens.accessTokenExpiryDate,
      newTokens.refreshTokenExpiryDate
    )
    accessToken = newTokens.accessToken
  }

  const baseUrl = getQBEnvironment() === Environment.Production
    ? QB_API_BASE.production
    : QB_API_BASE.sandbox

  const url = `${baseUrl}/${realmId}/${endpoint}`

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`QuickBooks API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  return data as T
}
