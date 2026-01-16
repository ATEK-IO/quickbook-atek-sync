import { router } from '../lib/trpc'
import { healthRouter } from './health'
import { quickbooksRouter } from './quickbooks'
import { atekRouter } from './atek'
import { customerMappingRouter } from './customer-mapping'

export const appRouter = router({
  health: healthRouter,
  quickbooks: quickbooksRouter,
  atek: atekRouter,
  customerMapping: customerMappingRouter,
})

export type AppRouter = typeof appRouter
