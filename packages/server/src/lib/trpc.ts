import { initTRPC } from '@trpc/server'
import type { Context } from 'hono'

export interface TRPCContext {
  honoContext: Context
}

const t = initTRPC.context<TRPCContext>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware
