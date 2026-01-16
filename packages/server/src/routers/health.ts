import { router, publicProcedure } from '../lib/trpc'

export const healthRouter = router({
  ping: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }),
})
