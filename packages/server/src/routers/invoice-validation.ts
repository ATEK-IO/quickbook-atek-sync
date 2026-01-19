import { z } from 'zod'
import { router, publicProcedure } from '../lib/trpc'
import * as validation from '../services/invoice-validation'

export const invoiceValidationRouter = router({
  // Validate a single invoice
  validate: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .mutation(async ({ input }) => {
      return validation.validateInvoice(input.invoiceId)
    }),

  // Validate multiple invoices in batch
  validateBatch: publicProcedure
    .input(z.object({ invoiceIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      return validation.validateBatch(input.invoiceIds)
    }),

  // Validate all pending invoices
  validateAllPending: publicProcedure
    .input(
      z
        .object({
          limit: z.number().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      return validation.validateAllPending({
        limit: input?.limit,
        startDate: input?.startDate ? new Date(input.startDate) : undefined,
        endDate: input?.endDate ? new Date(input.endDate) : undefined,
      })
    }),

  // Get validation status for a specific invoice
  get: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ input }) => {
      return validation.getValidationStatus(input.invoiceId)
    }),

  // List all validations with optional filtering
  list: publicProcedure
    .input(
      z
        .object({
          status: z.enum(['pending', 'ready', 'blocked', 'synced']).optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return validation.getValidations(input)
    }),

  // Get validation statistics
  stats: publicProcedure.query(async () => {
    return validation.getValidationStats()
  }),

  // Get invoices ready for sync
  readyForSync: publicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return validation.getReadyForSync(input?.limit)
    }),

  // Get blocked invoices with issues
  blockedInvoices: publicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return validation.getBlockedInvoices(input?.limit)
    }),

  // Manually approve an invoice for sync
  approveForSync: publicProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        approvedBy: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await validation.approveForSync(input.invoiceId, input.approvedBy)
      return { success: true }
    }),

  // Mark an invoice as synced
  markAsSynced: publicProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        quickbooksInvoiceId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await validation.markAsSynced(input.invoiceId, input.quickbooksInvoiceId)
      return { success: true }
    }),

  // Clear validation for a specific invoice
  clearValidation: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .mutation(async ({ input }) => {
      await validation.clearValidation(input.invoiceId)
      return { success: true }
    }),

  // Clear all non-synced validations
  clearAll: publicProcedure.mutation(async () => {
    return validation.clearAllValidations()
  }),
})
