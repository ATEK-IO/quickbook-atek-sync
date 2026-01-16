import { z } from 'zod'
import { router, publicProcedure } from '../lib/trpc'
import * as matching from '../services/customer-matching'

export const customerMappingRouter = router({
  // Run the matching algorithm
  runMatching: publicProcedure.mutation(async () => {
    return matching.runCustomerMatching()
  }),

  // Clear all mappings (for fresh start)
  clearAll: publicProcedure.mutation(async () => {
    return matching.clearAllMappings()
  }),

  // Get all mappings with optional filtering
  list: publicProcedure
    .input(
      z
        .object({
          status: z.enum(['proposed', 'approved', 'rejected', 'needs_review']).optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return matching.getCustomerMappings(input)
    }),

  // Get mapping statistics
  stats: publicProcedure.query(async () => {
    return matching.getMappingStats()
  }),

  // Approve a mapping
  approve: publicProcedure
    .input(
      z.object({
        mappingId: z.number(),
        approvedBy: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await matching.approveMapping(input.mappingId, input.approvedBy)
      return { success: true }
    }),

  // Bulk approve high-confidence mappings
  bulkApprove: publicProcedure
    .input(
      z.object({
        mappingIds: z.array(z.number()),
        approvedBy: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      for (const id of input.mappingIds) {
        await matching.approveMapping(id, input.approvedBy)
      }
      return { success: true, approved: input.mappingIds.length }
    }),

  // Reject a mapping
  reject: publicProcedure
    .input(
      z.object({
        mappingId: z.number(),
        reviewNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await matching.rejectMapping(input.mappingId, input.reviewNotes)
      return { success: true }
    }),

  // Create manual mapping
  createManual: publicProcedure
    .input(
      z.object({
        atekOrgId: z.string(),
        qbCustomerId: z.string(),
        approvedBy: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const mappingId = await matching.createManualMapping(
        input.atekOrgId,
        input.qbCustomerId,
        input.approvedBy
      )
      return { success: true, mappingId }
    }),

  // Update QB customer for a mapping
  updateQbCustomer: publicProcedure
    .input(
      z.object({
        mappingId: z.number(),
        qbCustomerId: z.string(),
        qbCustomerName: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await matching.updateMappingQbCustomer(
        input.mappingId,
        input.qbCustomerId,
        input.qbCustomerName
      )
      return { success: true }
    }),
})
