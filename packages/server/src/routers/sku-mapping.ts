import { router, publicProcedure } from '../lib/trpc'
import { matchInvoiceSKUsWithQBItems, getSKUMatchStats } from '../services/sku-matching'

export const skuMappingRouter = router({
  // Get all SKUs from ATEK invoices with their QB match status
  list: publicProcedure.query(async () => {
    return matchInvoiceSKUsWithQBItems()
  }),

  // Get summary stats
  stats: publicProcedure.query(async () => {
    return getSKUMatchStats()
  }),
})
