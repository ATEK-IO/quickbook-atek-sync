import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { trpcServer } from '@hono/trpc-server'
import { appRouter } from './routers'
import type { TRPCContext } from './lib/trpc'
import { createAuthProvider, getAuthorizationUrl, storeTokens } from './lib/quickbooks'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: ['http://localhost:4012'],
    credentials: true,
  })
)

// Health check endpoint
app.get('/', (c) => c.json({ status: 'ok', service: 'qb-sync-server' }))

// QuickBooks OAuth routes
app.get('/api/quickbooks/auth', (c) => {
  const authProvider = createAuthProvider()
  const state = crypto.randomUUID()
  const authUrl = getAuthorizationUrl(authProvider, state)
  return c.redirect(authUrl)
})

app.get('/api/quickbooks/callback', async (c) => {
  const code = c.req.query('code')
  const realmId = c.req.query('realmId')

  if (!code || !realmId) {
    return c.json({ error: 'Missing code or realmId' }, 400)
  }

  try {
    const authProvider = createAuthProvider()
    const tokens = await authProvider.exchangeCode(code)

    await storeTokens(
      realmId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.accessTokenExpiresAt,
      tokens.refreshTokenExpiresAt
    )

    // Redirect to frontend with success
    return c.redirect('http://localhost:4012?qb_auth=success')
  } catch (error) {
    console.error('OAuth callback error:', error)
    return c.redirect('http://localhost:4012?qb_auth=error')
  }
})

// tRPC handler
app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, c): TRPCContext => ({
      honoContext: c,
    }),
  })
)

const port = Number(process.env.SERVER_PORT) || 4011

console.log(`Server starting on port ${port}`)

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 120, // 2 minutes for slow QB API pagination
}
