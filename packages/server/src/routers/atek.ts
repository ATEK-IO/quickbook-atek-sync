import { z } from 'zod'
import { router, publicProcedure } from '../lib/trpc'
import { getMongoConnectionStatus, getMongoDb } from '../lib/mongodb'
import * as organizations from '../services/atek-organizations'
import * as managers from '../services/atek-managers'
import * as skus from '../services/atek-skus'
import * as invoices from '../services/atek-invoices'
import * as sensors from '../services/atek-sensors'

export const atekRouter = router({
  // Connection status
  connectionStatus: publicProcedure.query(async () => {
    return getMongoConnectionStatus()
  }),

  // List all collections in database (for debugging)
  listCollections: publicProcedure.query(async () => {
    const db = await getMongoDb()
    const collections = await db.listCollections().toArray()
    return collections.map((c) => c.name).sort()
  }),

  // Sample a collection (for debugging schema)
  sampleCollection: publicProcedure
    .input(z.object({ name: z.string(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      const db = await getMongoDb()
      const docs = await db.collection(input.name).find().limit(input.limit || 1).toArray()
      return docs.map((d) => ({ _id: d._id?.toString(), keys: Object.keys(d), tags: d.tags }))
    }),

  // Organization operations
  organizations: router({
    list: publicProcedure
      .input(
        z
          .object({
            activeOnly: z.boolean().optional(),
            limit: z.number().optional(),
            skip: z.number().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return organizations.listOrganizations(input)
      }),

    get: publicProcedure.input(z.string()).query(async ({ input }) => {
      return organizations.getOrganization(input)
    }),

    search: publicProcedure.input(z.string()).query(async ({ input }) => {
      return organizations.searchOrganizations(input)
    }),

    count: publicProcedure
      .input(z.boolean().optional())
      .query(async ({ input }) => {
        return organizations.getOrganizationCount(input ?? true)
      }),

    // List customer-only organizations (for QB matching)
    customers: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return organizations.listOrganizations({
          activeOnly: true,
          customerOnly: true,
          limit: input?.limit || 1000,
        })
      }),

    withManagers: publicProcedure.query(async () => {
      return organizations.getOrganizationsWithManagers()
    }),
  }),

  // Manager operations
  managers: router({
    list: publicProcedure
      .input(
        z
          .object({
            activeOnly: z.boolean().optional(),
            limit: z.number().optional(),
            skip: z.number().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return managers.listContractualManagers(input)
      }),

    get: publicProcedure.input(z.string()).query(async ({ input }) => {
      return managers.getManager(input)
    }),

    getByEmail: publicProcedure.input(z.string()).query(async ({ input }) => {
      return managers.getManagerByEmail(input)
    }),

    search: publicProcedure.input(z.string()).query(async ({ input }) => {
      return managers.searchManagers(input)
    }),

    count: publicProcedure
      .input(z.boolean().optional())
      .query(async ({ input }) => {
        return managers.getManagerCount(input ?? true)
      }),

    forOrganization: publicProcedure.input(z.string()).query(async ({ input }) => {
      return managers.getManagersForOrganization(input)
    }),
  }),

  // SKU operations
  skus: router({
    list: publicProcedure
      .input(
        z
          .object({
            activeOnly: z.boolean().optional(),
            category: z.string().optional(),
            limit: z.number().optional(),
            skip: z.number().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return skus.listSKUs(input)
      }),

    get: publicProcedure.input(z.string()).query(async ({ input }) => {
      return skus.getSKU(input)
    }),

    getByCode: publicProcedure.input(z.string()).query(async ({ input }) => {
      return skus.getSKUByCode(input)
    }),

    search: publicProcedure.input(z.string()).query(async ({ input }) => {
      return skus.searchSKUs(input)
    }),

    count: publicProcedure
      .input(z.boolean().optional())
      .query(async ({ input }) => {
        return skus.getSKUCount(input ?? true)
      }),

    byCategory: publicProcedure.input(z.string()).query(async ({ input }) => {
      return skus.getSKUsByCategory(input)
    }),

    categories: publicProcedure.query(async () => {
      return skus.getCategories()
    }),

    unmapped: publicProcedure
      .input(z.array(z.string()))
      .query(async ({ input }) => {
        return skus.getUnmappedSKUIds(input)
      }),
  }),

  // Invoice operations
  invoices: router({
    list: publicProcedure
      .input(
        z
          .object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            organizationId: z.string().optional(),
            limit: z.number().optional(),
            skip: z.number().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const options = input
          ? {
              ...input,
              startDate: input.startDate ? new Date(input.startDate) : undefined,
              endDate: input.endDate ? new Date(input.endDate) : undefined,
            }
          : undefined
        return invoices.listInvoicesForSync(options)
      }),

    get: publicProcedure.input(z.string()).query(async ({ input }) => {
      return invoices.getInvoice(input)
    }),

    getByNumber: publicProcedure.input(z.string()).query(async ({ input }) => {
      return invoices.getInvoiceByNumber(input)
    }),

    search: publicProcedure.input(z.string()).query(async ({ input }) => {
      return invoices.searchInvoices(input)
    }),

    count: publicProcedure
      .input(
        z
          .object({
            forSync: z.boolean().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const options = input
          ? {
              ...input,
              startDate: input.startDate ? new Date(input.startDate) : undefined,
              endDate: input.endDate ? new Date(input.endDate) : undefined,
            }
          : undefined
        return invoices.getInvoiceCount(options)
      }),

    forOrganization: publicProcedure
      .input(
        z.object({
          organizationId: z.string(),
          forSync: z.boolean().optional(),
        })
      )
      .query(async ({ input }) => {
        return invoices.getInvoicesForOrganization(input.organizationId, input.forSync ?? true)
      }),

    usedSKUIds: publicProcedure.query(async () => {
      return invoices.getUsedSKUIds()
    }),

    unsynced: publicProcedure
      .input(z.array(z.string()))
      .query(async ({ input }) => {
        return invoices.getUnsyncedInvoiceIds(input)
      }),

    // Get contractual managers grouped by organization (from invoices)
    managersByOrganization: publicProcedure.query(async () => {
      return invoices.getContractualManagersByOrganization()
    }),
  }),

  // Sensor operations
  sensors: router({
    countsByOrganization: publicProcedure.query(async () => {
      return sensors.getSensorCountsByOrganization()
    }),
  }),
})
