import { z } from 'zod'
import { router, publicProcedure } from '../lib/trpc'
import * as sync from '../services/invoice-sync'
import * as validation from '../services/invoice-validation'
import { getInvoice as getATEKInvoice, getInvoiceBillingSiteId, getBillingSite } from '../services/atek-invoices'
import { getOrganization as getATEKOrganization } from '../services/atek-organizations'
import { getManager as getATEKManager } from '../services/atek-managers'
import { getInvoice as getQBInvoice, searchInvoices as searchQBInvoices, getInvoiceByDocNumber as getQBInvoiceByDocNumber } from '../services/qb-invoices'
import { getCustomer as getQBCustomer } from '../services/qb-customers'
import { getItem as getQBItem } from '../services/qb-items'

export const invoiceSyncRouter = router({
  // List invoices with validation status for UI
  list: publicProcedure
    .input(
      z
        .object({
          status: z.enum(['all', 'pending', 'ready', 'blocked', 'synced']).optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return sync.listInvoicesWithValidation(input)
    }),

  // Get single invoice details with mappings
  getDetails: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ input }) => {
      return sync.getInvoiceDetails(input.invoiceId)
    }),

  // Get sync statistics
  stats: publicProcedure.query(async () => {
    return sync.getSyncStats()
  }),

  // Validate a single invoice (run validation without syncing)
  validate: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .mutation(async ({ input }) => {
      return validation.validateInvoice(input.invoiceId)
    }),

  // Validate multiple invoices
  validateBatch: publicProcedure
    .input(z.object({ invoiceIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      return validation.validateBatch(input.invoiceIds)
    }),

  // Validate all pending invoices
  validateAllPending: publicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .mutation(async ({ input }) => {
      return validation.validateAllPending({ limit: input?.limit })
    }),

  // Check if invoice already exists in QB
  checkDuplicate: publicProcedure
    .input(z.object({ invoiceNumber: z.string() }))
    .query(async ({ input }) => {
      const existing = await sync.checkDuplicateInQB(input.invoiceNumber)
      return {
        exists: !!existing,
        quickbooksInvoiceId: existing?.Id || null,
        quickbooksDocNumber: existing?.DocNumber || null,
      }
    }),

  // Sync a single invoice to QuickBooks
  sync: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .mutation(async ({ input }) => {
      return sync.syncInvoice(input.invoiceId)
    }),

  // Sync multiple invoices to QuickBooks
  syncBatch: publicProcedure
    .input(z.object({ invoiceIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      return sync.syncBatch(input.invoiceIds)
    }),

  // Sync all ready invoices
  syncAllReady: publicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .mutation(async ({ input }) => {
      return sync.syncAllReady(input?.limit)
    }),

  // Get validation status for a specific invoice
  getValidationStatus: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ input }) => {
      return validation.getValidationStatus(input.invoiceId)
    }),

  // Get ready for sync invoices
  readyForSync: publicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return validation.getReadyForSync(input?.limit)
    }),

  // Get blocked invoices
  blockedInvoices: publicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return validation.getBlockedInvoices(input?.limit)
    }),

  // Approve invoice for sync manually
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

  // Compare ATEK invoice with QB invoice side by side
  compare: publicProcedure
    .input(
      z.object({
        atekInvoiceId: z.string(),
        qbInvoiceId: z.string().optional(), // If not provided, will search by invoice number
      })
    )
    .query(async ({ input }) => {
      // Get ATEK invoice
      const atekInvoice = await getATEKInvoice(input.atekInvoiceId)
      if (!atekInvoice) {
        return { error: 'ATEK invoice not found', atek: null, qb: null }
      }

      // Get ATEK organization for customer name and billing address
      const atekOrg = atekInvoice.organizationId
        ? await getATEKOrganization(atekInvoice.organizationId)
        : null

      // Get ATEK manager for contractual manager details
      const atekManager = atekInvoice.contractualManagerId
        ? await getATEKManager(atekInvoice.contractualManagerId)
        : null

      // Get ATEK billing site for billing email
      const billingSiteId = await getInvoiceBillingSiteId(input.atekInvoiceId)
      const atekBillingSite = billingSiteId ? await getBillingSite(billingSiteId) : null

      // Get QB invoice - either by ID or search by invoice number
      let qbInvoice = null
      let qbCustomer = null

      if (input.qbInvoiceId) {
        qbInvoice = await getQBInvoice(input.qbInvoiceId)
      } else if (atekInvoice.invoiceNumber) {
        // First try direct raw query for exact match (most reliable)
        qbInvoice = await getQBInvoiceByDocNumber(atekInvoice.invoiceNumber)

        // Fall back to search if raw query didn't work
        if (!qbInvoice) {
          const results = await searchQBInvoices(atekInvoice.invoiceNumber)
          qbInvoice = results.find(
            (inv) => inv.DocNumber?.toLowerCase() === atekInvoice.invoiceNumber.toLowerCase()
          ) || null
        }
      }

      // Get QB customer for address info
      if (qbInvoice?.CustomerRef?.value) {
        qbCustomer = await getQBCustomer(qbInvoice.CustomerRef.value)
      }

      // Get invoice details with mappings for ATEK side
      const atekDetails = await sync.getInvoiceDetails(input.atekInvoiceId)

      // Format comparison data
      return {
        atek: atekDetails ? {
          id: input.atekInvoiceId,
          invoiceNumber: atekDetails.invoiceNumber,
          customerName: atekOrg?.name || atekDetails.organizationName || '-',
          orgNumber: atekOrg?.orgNumber || null,
          contractualManager: atekManager ? {
            name: atekManager.name,
            email: atekManager.email,
            phone: atekManager.phone,
          } : null,
          billingEmail: atekBillingSite?.email || null,
          // Use billing address directly from invoice (formatted string)
          billingAddress: atekDetails.billingAddress || (atekOrg?.primarySite ?
            [
              atekOrg.primarySite.address,
              [atekOrg.primarySite.city, atekOrg.primarySite.state, atekOrg.primarySite.postalCode].filter(Boolean).join(', '),
              atekOrg.primarySite.country
            ].filter(Boolean).join('\n') : null),
          // Use shipping addresses directly from invoice
          shippingAddresses: atekDetails.shippingAddresses || [],
          issueDate: atekDetails.issueDate,
          dueDate: atekDetails.dueDate,
          lineItems: atekDetails.lineItems.map((item) => ({
            skuCode: item.skuCode || null,
            skuName: item.skuName || null,
            description: item.description || item.skuName || item.skuCode || '-',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0, // Percentage discount per line
            amount: item.amount, // After discount
            taxable: item.taxable || false,
          })),
          subtotal: atekDetails.subtotal,
          taxAmount: atekDetails.taxAmount,
          total: atekDetails.totalAmount,
          notes: atekDetails.notes,
          poNumber: atekDetails.poNumber,
        } : null,
        qb: qbInvoice ? {
          id: qbInvoice.Id,
          invoiceNumber: qbInvoice.DocNumber || '-',
          customerName: qbInvoice.CustomerRef?.name || '-',
          customerEmail: qbInvoice.BillEmail?.Address || qbCustomer?.PrimaryEmailAddr?.Address || '-',
          billingAddress: qbInvoice.BillAddr || qbCustomer?.BillAddr ? {
            line1: qbInvoice.BillAddr?.Line1 || qbCustomer?.BillAddr?.Line1 || '',
            line2: qbInvoice.BillAddr?.Line2 || '',
            city: qbInvoice.BillAddr?.City || qbCustomer?.BillAddr?.City || '',
            state: qbInvoice.BillAddr?.CountrySubDivisionCode || qbCustomer?.BillAddr?.CountrySubDivisionCode || '',
            postalCode: qbInvoice.BillAddr?.PostalCode || qbCustomer?.BillAddr?.PostalCode || '',
            country: qbInvoice.BillAddr?.Country || qbCustomer?.BillAddr?.Country || '',
          } : null,
          shippingAddress: qbInvoice.ShipAddr ? {
            line1: qbInvoice.ShipAddr.Line1 || '',
            line2: qbInvoice.ShipAddr.Line2 || '',
            city: qbInvoice.ShipAddr.City || '',
            state: qbInvoice.ShipAddr.CountrySubDivisionCode || '',
            postalCode: qbInvoice.ShipAddr.PostalCode || '',
            country: qbInvoice.ShipAddr.Country || '',
          } : null,
          issueDate: qbInvoice.TxnDate,
          dueDate: qbInvoice.DueDate || null,
          lineItems: await Promise.all(
            qbInvoice.Line
              .filter((line) => line.DetailType === 'SalesItemLineDetail')
              .map(async (line) => {
                // Fetch item to get SKU code
                const itemId = line.SalesItemLineDetail?.ItemRef?.value
                let sku: string | null = null
                if (itemId) {
                  const item = await getQBItem(itemId)
                  sku = item?.Sku || null
                }
                return {
                  itemId: itemId || null,
                  itemName: line.SalesItemLineDetail?.ItemRef?.name || null,
                  sku,
                  description: line.Description || '-',
                  quantity: line.SalesItemLineDetail?.Qty || 1,
                  unitPrice: line.SalesItemLineDetail?.UnitPrice || line.Amount,
                  amount: line.Amount,
                }
              })
          ),
          subtotal: qbInvoice.Line
            .filter((line) => line.DetailType === 'SalesItemLineDetail')
            .reduce((sum, line) => sum + line.Amount, 0),
          taxAmount: qbInvoice.TxnTaxDetail?.TotalTax || 0,
          total: qbInvoice.TotalAmt,
          memo: qbInvoice.CustomerMemo?.value || null,
        } : null,
      }
    }),
})
