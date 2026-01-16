import { z } from 'zod'
import { router, publicProcedure } from '../lib/trpc'
import { getConnectionStatus, disconnect, createAuthProvider, storeTokens, getAuthorizationUrl } from '../lib/quickbooks'
import * as customers from '../services/qb-customers'
import * as items from '../services/qb-items'
import * as invoices from '../services/qb-invoices'

export const quickbooksRouter = router({
  // Connection status
  connectionStatus: publicProcedure.query(async () => {
    return getConnectionStatus()
  }),

  // Get OAuth authorization URL
  getAuthUrl: publicProcedure.query(async () => {
    const authProvider = createAuthProvider()
    const state = Math.random().toString(36).substring(7)
    const url = getAuthorizationUrl(authProvider, state)
    return { url, state }
  }),

  // Handle OAuth callback
  handleCallback: publicProcedure
    .input(z.object({ code: z.string(), realmId: z.string() }))
    .mutation(async ({ input }) => {
      const authProvider = createAuthProvider()
      const tokens = await authProvider.exchangeCode(input.code, input.realmId)
      await storeTokens(
        input.realmId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.accessTokenExpiryDate,
        tokens.refreshTokenExpiryDate
      )
      return { success: true, realmId: input.realmId }
    }),

  disconnect: publicProcedure.mutation(async () => {
    await disconnect()
    return { success: true }
  }),

  // Customer operations
  customers: router({
    list: publicProcedure
      .input(
        z
          .object({
            maxResults: z.number().optional(),
            activeOnly: z.boolean().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return customers.listCustomers(input)
      }),

    get: publicProcedure.input(z.string()).query(async ({ input }) => {
      return customers.getCustomer(input)
    }),

    search: publicProcedure.input(z.string()).query(async ({ input }) => {
      return customers.searchCustomers(input)
    }),

    create: publicProcedure
      .input(
        z.object({
          DisplayName: z.string(),
          CompanyName: z.string().optional(),
          GivenName: z.string().optional(),
          FamilyName: z.string().optional(),
          PrimaryEmailAddr: z.object({ Address: z.string() }).optional(),
          PrimaryPhone: z.object({ FreeFormNumber: z.string() }).optional(),
          BillAddr: z
            .object({
              Line1: z.string().optional(),
              City: z.string().optional(),
              CountrySubDivisionCode: z.string().optional(),
              PostalCode: z.string().optional(),
              Country: z.string().optional(),
            })
            .optional(),
          Notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return customers.createCustomer(input)
      }),

    count: publicProcedure.query(async () => {
      return customers.getCustomerCount()
    }),
  }),

  // Item operations
  items: router({
    list: publicProcedure
      .input(
        z
          .object({
            maxResults: z.number().optional(),
            activeOnly: z.boolean().optional(),
            type: z.enum(['Inventory', 'NonInventory', 'Service', 'Category', 'Group', 'Bundle']).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return items.listItems(input)
      }),

    get: publicProcedure.input(z.string()).query(async ({ input }) => {
      return items.getItem(input)
    }),

    search: publicProcedure.input(z.string()).query(async ({ input }) => {
      return items.searchItems(input)
    }),

    create: publicProcedure
      .input(
        z.object({
          Name: z.string(),
          Type: z.enum(['Inventory', 'NonInventory', 'Service', 'Category', 'Group', 'Bundle']),
          Description: z.string().optional(),
          UnitPrice: z.number().optional(),
          PurchaseCost: z.number().optional(),
          QtyOnHand: z.number().optional(),
          IncomeAccountRef: z.object({ value: z.string(), name: z.string().optional() }).optional(),
          ExpenseAccountRef: z.object({ value: z.string(), name: z.string().optional() }).optional(),
          AssetAccountRef: z.object({ value: z.string(), name: z.string().optional() }).optional(),
          Taxable: z.boolean().optional(),
          SalesTaxCodeRef: z.object({ value: z.string() }).optional(),
          Sku: z.string().optional(),
          InvStartDate: z.string().optional(),
          TrackQtyOnHand: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return items.createItem(input)
      }),

    count: publicProcedure.query(async () => {
      return items.getItemCount()
    }),

    incomeAccounts: publicProcedure.query(async () => {
      return items.getIncomeAccounts()
    }),
  }),

  // Invoice operations
  invoices: router({
    list: publicProcedure
      .input(
        z
          .object({
            maxResults: z.number().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            customerId: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return invoices.listInvoices(input)
      }),

    get: publicProcedure.input(z.string()).query(async ({ input }) => {
      return invoices.getInvoice(input)
    }),

    search: publicProcedure.input(z.string()).query(async ({ input }) => {
      return invoices.searchInvoices(input)
    }),

    create: publicProcedure
      .input(
        z.object({
          CustomerRef: z.object({ value: z.string() }),
          Line: z.array(
            z.object({
              Description: z.string().optional(),
              Amount: z.number(),
              DetailType: z.literal('SalesItemLineDetail'),
              SalesItemLineDetail: z.object({
                ItemRef: z.object({ value: z.string() }),
                Qty: z.number().optional(),
                UnitPrice: z.number().optional(),
                TaxCodeRef: z.object({ value: z.string() }).optional(),
              }),
            })
          ),
          DocNumber: z.string().optional(),
          TxnDate: z.string().optional(),
          DueDate: z.string().optional(),
          BillEmail: z.object({ Address: z.string() }).optional(),
          CustomerMemo: z.object({ value: z.string() }).optional(),
          PrivateNote: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return invoices.createInvoice(input)
      }),

    void: publicProcedure
      .input(
        z.object({
          invoiceId: z.string(),
          syncToken: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        return invoices.voidInvoice(input.invoiceId, input.syncToken)
      }),

    send: publicProcedure
      .input(
        z.object({
          invoiceId: z.string(),
          email: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return invoices.sendInvoice(input.invoiceId, input.email)
      }),

    count: publicProcedure
      .input(
        z
          .object({
            startDate: z.string().optional(),
            endDate: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return invoices.getInvoiceCount(input)
      }),
  }),

  // Payment operations (for reconciliation)
  payments: router({
    list: publicProcedure
      .input(
        z
          .object({
            maxResults: z.number().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return invoices.listPayments(input)
      }),
  }),
})
