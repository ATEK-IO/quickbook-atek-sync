import { router } from '../lib/trpc'
import { healthRouter } from './health'
import { quickbooksRouter } from './quickbooks'
import { atekRouter } from './atek'
import { customerMappingRouter } from './customer-mapping'
import { skuMappingRouter } from './sku-mapping'
import { invoiceValidationRouter } from './invoice-validation'
import { invoiceSyncRouter } from './invoice-sync'

export const appRouter = router({
  health: healthRouter,
  quickbooks: quickbooksRouter,
  atek: atekRouter,
  customerMapping: customerMappingRouter,
  skuMapping: skuMappingRouter,
  invoiceValidation: invoiceValidationRouter,
  invoiceSync: invoiceSyncRouter,
})

export type AppRouter = typeof appRouter
