import { router, publicProcedure } from '../lib/trpc'
import { matchInvoiceSKUsWithQBItems, getSKUMatchStats } from '../services/sku-matching'
import { z } from 'zod'
import { db } from '../db'
import { skuMapping } from '../db/schema'
import { eq } from 'drizzle-orm'

export const skuMappingRouter = router({
  // Get all SKUs from ATEK invoices with their QB match status
  list: publicProcedure.query(async () => {
    return matchInvoiceSKUsWithQBItems()
  }),

  // Get summary stats
  stats: publicProcedure.query(async () => {
    return getSKUMatchStats()
  }),

  // Approve a single SKU match and save to database
  approveMatch: publicProcedure
    .input(
      z.object({
        atekSkuId: z.string(),
        atekSkuCode: z.string(),
        atekSkuName: z.string(),
        quickbooksItemId: z.string(),
        quickbooksItemName: z.string(),
        quickbooksItemType: z.string().optional(),
        matchType: z.enum(['exact_code', 'exact_name', 'fuzzy_name', 'manual']),
        confidenceScore: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if mapping already exists by SKU code
      const existingMapping = await db.query.skuMapping.findFirst({
        where: eq(skuMapping.atekSkuCode, input.atekSkuCode),
      })

      const now = new Date().toISOString()

      if (existingMapping) {
        // Update existing mapping
        await db
          .update(skuMapping)
          .set({
            quickbooksItemId: input.quickbooksItemId,
            quickbooksItemName: input.quickbooksItemName,
            quickbooksItemType: input.quickbooksItemType || null,
            mappingStatus: 'approved',
            confidenceScore: input.confidenceScore,
            matchingMethod:
              input.matchType === 'exact_code'
                ? 'code_exact'
                : input.matchType === 'exact_name' || input.matchType === 'fuzzy_name'
                  ? 'name_fuzzy'
                  : 'manual',
            approvedDate: now,
            lastModifiedDate: now,
          })
          .where(eq(skuMapping.mappingId, existingMapping.mappingId))

        return { success: true, mappingId: existingMapping.mappingId, action: 'updated' }
      }

      // Insert new mapping
      const result = await db.insert(skuMapping).values({
        atekSkuId: input.atekSkuId,
        atekSkuCode: input.atekSkuCode,
        atekSkuName: input.atekSkuName,
        quickbooksItemId: input.quickbooksItemId,
        quickbooksItemName: input.quickbooksItemName,
        quickbooksItemType: input.quickbooksItemType || null,
        mappingStatus: 'approved',
        confidenceScore: input.confidenceScore,
        matchingMethod:
          input.matchType === 'exact_code'
            ? 'code_exact'
            : input.matchType === 'exact_name' || input.matchType === 'fuzzy_name'
              ? 'name_fuzzy'
              : 'manual',
        approvedDate: now,
        createdDate: now,
        lastModifiedDate: now,
      })

      return { success: true, mappingId: result.lastInsertRowid, action: 'created' }
    }),

  // Bulk approve all auto-matched SKUs
  approveAllMatches: publicProcedure.mutation(async () => {
    // Get all matches from the matching service
    const matches = await matchInvoiceSKUsWithQBItems()

    const now = new Date().toISOString()
    let approvedCount = 0
    let skippedCount = 0

    for (const match of matches) {
      // Only approve matches that have a QB item (not no_match)
      if (match.matchType === 'no_match' || !match.qbItem) {
        skippedCount++
        continue
      }

      // Check if mapping already exists
      const existingMapping = await db.query.skuMapping.findFirst({
        where: eq(skuMapping.atekSkuCode, match.atekSku.code || ''),
      })

      if (existingMapping) {
        // Update if not already approved with same QB item
        if (
          existingMapping.mappingStatus !== 'approved' ||
          existingMapping.quickbooksItemId !== match.qbItem.Id
        ) {
          await db
            .update(skuMapping)
            .set({
              quickbooksItemId: match.qbItem.Id,
              quickbooksItemName: match.qbItem.Name,
              quickbooksItemType: match.qbItem.Type,
              mappingStatus: 'approved',
              confidenceScore: match.confidence,
              matchingMethod:
                match.matchType === 'exact_code'
                  ? 'code_exact'
                  : match.matchType === 'exact_name' || match.matchType === 'fuzzy_name'
                    ? 'name_fuzzy'
                    : 'manual',
              approvedDate: now,
              lastModifiedDate: now,
            })
            .where(eq(skuMapping.mappingId, existingMapping.mappingId))

          approvedCount++
        } else {
          skippedCount++
        }
      } else {
        // Insert new mapping
        // Use code as fallback for skuId since some SKUs may not have a separate ID
        const skuId = match.atekSku.skuId || match.atekSku.code || ''
        if (!skuId) {
          skippedCount++
          continue
        }
        await db.insert(skuMapping).values({
          atekSkuId: skuId,
          atekSkuCode: match.atekSku.code || '',
          atekSkuName: match.atekSku.name || '',
          quickbooksItemId: match.qbItem.Id,
          quickbooksItemName: match.qbItem.Name,
          quickbooksItemType: match.qbItem.Type,
          mappingStatus: 'approved',
          confidenceScore: match.confidence,
          matchingMethod:
            match.matchType === 'exact_code'
              ? 'code_exact'
              : match.matchType === 'exact_name' || match.matchType === 'fuzzy_name'
                ? 'name_fuzzy'
                : 'manual',
          approvedDate: now,
          createdDate: now,
          lastModifiedDate: now,
        })

        approvedCount++
      }
    }

    return {
      success: true,
      approvedCount,
      skippedCount,
      totalProcessed: matches.length,
    }
  }),
})
