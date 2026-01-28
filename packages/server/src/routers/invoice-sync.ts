import { z } from 'zod'
import { router, publicProcedure } from '../lib/trpc'
import * as sync from '../services/invoice-sync'
import * as validation from '../services/invoice-validation'
import { getInvoice as getATEKInvoice, getInvoiceBillingSiteId, getBillingSite } from '../services/atek-invoices'
import { getOrganization as getATEKOrganization } from '../services/atek-organizations'
import { getManager as getATEKManager } from '../services/atek-managers'
import { getInvoice as getQBInvoice, searchInvoices as searchQBInvoices, getInvoiceByDocNumber as getQBInvoiceByDocNumber } from '../services/qb-invoices'
import { getCustomer as getQBCustomer, createCustomer as createQBCustomer } from '../services/qb-customers'
import { getItem as getQBItem, createItem as createQBItem, getIncomeAccounts } from '../services/qb-items'
import { db } from '../db'
import { customerMapping, skuMapping, invoiceValidation } from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'

export const invoiceSyncRouter = router({
  // List invoices with validation status for UI
  list: publicProcedure
    .input(
      z
        .object({
          status: z.enum(['all', 'pending', 'ready', 'blocked', 'synced']).optional(),
          search: z.string().optional(),
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
      }

      // Always try to find by invoice number if direct lookup failed or wasn't provided
      if (!qbInvoice && atekInvoice.invoiceNumber) {
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

  // Create QB customer from invoice data and create mapping
  createCustomerForInvoice: publicProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        customerData: z.object({
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
        }),
      })
    )
    .mutation(async ({ input }) => {
      // 1. Get the invoice to get organization and manager info
      const invoice = await getATEKInvoice(input.invoiceId)
      if (!invoice) {
        throw new Error('Invoice not found')
      }

      // 2. Get organization details
      const org = await getATEKOrganization(invoice.organizationId)
      if (!org) {
        throw new Error('Organization not found')
      }

      // 3. Get manager details if available
      const manager = invoice.contractualManagerId
        ? await getATEKManager(invoice.contractualManagerId)
        : null

      // 4. Create customer in QuickBooks
      const qbCustomer = await createQBCustomer(input.customerData)

      // 5. Create customer mapping in database
      const orgNumber = org.orgNumber ? String(org.orgNumber).padStart(4, '0') : ''
      const orgDisplayName = orgNumber ? `${orgNumber} ${org.name}` : org.name

      await db.insert(customerMapping).values({
        atekOrganizationId: invoice.organizationId,
        atekOrganizationName: orgDisplayName,
        atekContractualManagerId: invoice.contractualManagerId || '',
        atekContractualManagerName: manager?.name || null,
        atekContractualManagerEmail: manager?.email || null,
        quickbooksCustomerId: qbCustomer.Id,
        quickbooksCustomerName: qbCustomer.DisplayName,
        quickbooksCustomerEmail: qbCustomer.PrimaryEmailAddr?.Address || null,
        mappingStatus: 'approved',
        confidenceScore: 1.0,
        matchingMethod: 'manual',
        approvedBy: 'inline_creation',
        approvedDate: new Date().toISOString(),
        createdDate: new Date().toISOString(),
        lastModifiedDate: new Date().toISOString(),
      })

      // 6. Re-validate the invoice
      const validationResult = await validation.validateInvoice(input.invoiceId)

      return {
        success: true,
        qbCustomerId: qbCustomer.Id,
        qbCustomerName: qbCustomer.DisplayName,
        validationStatus: validationResult.status,
        blockingIssues: validationResult.blockingIssues,
      }
    }),

  // Create missing SKU mappings for an invoice
  createMissingSkusForInvoice: publicProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        skus: z.array(
          z.object({
            atekSkuId: z.string(),
            atekSkuCode: z.string(),
            atekSkuName: z.string(),
            qbItemName: z.string(),
            qbItemType: z.enum(['Service', 'NonInventory', 'Inventory']),
            unitPrice: z.number().optional(),
            incomeAccountId: z.string(),
            incomeAccountName: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const results: Array<{
        atekSkuCode: string
        success: boolean
        qbItemId?: string
        error?: string
      }> = []

      for (const sku of input.skus) {
        try {
          // Create item in QuickBooks
          const qbItem = await createQBItem({
            Name: sku.qbItemName,
            Type: sku.qbItemType,
            IncomeAccountRef: {
              value: sku.incomeAccountId,
              name: sku.incomeAccountName,
            },
            UnitPrice: sku.unitPrice,
            Sku: sku.atekSkuCode,
          })

          // Check if mapping already exists
          const existingMapping = await db.query.skuMapping.findFirst({
            where: eq(skuMapping.atekSkuCode, sku.atekSkuCode),
          })

          if (existingMapping) {
            // Update existing mapping
            await db
              .update(skuMapping)
              .set({
                quickbooksItemId: qbItem.Id,
                quickbooksItemName: qbItem.Name,
                quickbooksItemType: qbItem.Type,
                mappingStatus: 'approved',
                approvedBy: 'inline_creation',
                approvedDate: new Date().toISOString(),
                lastModifiedDate: new Date().toISOString(),
              })
              .where(eq(skuMapping.mappingId, existingMapping.mappingId))
          } else {
            // Create new mapping
            await db.insert(skuMapping).values({
              atekSkuId: sku.atekSkuId,
              atekSkuCode: sku.atekSkuCode,
              atekSkuName: sku.atekSkuName,
              quickbooksItemId: qbItem.Id,
              quickbooksItemName: qbItem.Name,
              quickbooksItemType: qbItem.Type,
              mappingStatus: 'approved',
              confidenceScore: 1.0,
              matchingMethod: 'manual',
              approvedBy: 'inline_creation',
              approvedDate: new Date().toISOString(),
              createdDate: new Date().toISOString(),
              lastModifiedDate: new Date().toISOString(),
            })
          }

          results.push({
            atekSkuCode: sku.atekSkuCode,
            success: true,
            qbItemId: qbItem.Id,
          })
        } catch (error) {
          results.push({
            atekSkuCode: sku.atekSkuCode,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }

      // Re-validate the invoice
      const validationResult = await validation.validateInvoice(input.invoiceId)

      return {
        results,
        successCount: results.filter((r) => r.success).length,
        failCount: results.filter((r) => !r.success).length,
        validationStatus: validationResult.status,
        blockingIssues: validationResult.blockingIssues,
      }
    }),

  // Get missing SKUs for an invoice
  getMissingSkusForInvoice: publicProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ input }) => {
      const invoice = await getATEKInvoice(input.invoiceId)
      if (!invoice) {
        throw new Error('Invoice not found')
      }

      const missingSkus: Array<{
        skuId: string
        skuCode: string | null
        skuName: string | null
        description: string | null
        unitPrice: number
        reason: 'no_mapping' | 'not_approved' | 'needs_creation'
      }> = []

      // Get unique SKUs from line items
      const skuIdentifiers = new Map<
        string,
        { skuId: string; skuCode: string | null; skuName: string | null; description: string | null; unitPrice: number }
      >()

      for (const item of invoice.lineItems) {
        const key = item.skuCode || item.skuId
        if (key && !skuIdentifiers.has(key)) {
          skuIdentifiers.set(key, {
            skuId: item.skuId,
            skuCode: item.skuCode,
            skuName: item.skuName,
            description: item.description,
            unitPrice: item.unitPrice,
          })
        }
      }

      // Check each SKU for approved mapping
      for (const [key, sku] of skuIdentifiers) {
        let mapping = await db.query.skuMapping.findFirst({
          where: eq(skuMapping.atekSkuCode, key),
        })

        if (!mapping && sku.skuId) {
          mapping = await db.query.skuMapping.findFirst({
            where: eq(skuMapping.atekSkuId, sku.skuId),
          })
        }

        if (!mapping) {
          missingSkus.push({ ...sku, reason: 'no_mapping' })
        } else if (mapping.mappingStatus === 'needs_creation') {
          missingSkus.push({ ...sku, reason: 'needs_creation' })
        } else if (mapping.mappingStatus !== 'approved' || !mapping.quickbooksItemId) {
          missingSkus.push({ ...sku, reason: 'not_approved' })
        }
      }

      return missingSkus
    }),

  // Get dashboard stats with totals by year and customer
  getDashboardStats: publicProcedure.query(async () => {
    // Get all validations
    const validations = await db.select().from(invoiceValidation)

    // Get all customer mappings for name lookup
    const mappings = await db.select().from(customerMapping)
    const customerNameMap = new Map(
      mappings.map((m) => [m.quickbooksCustomerId, m.quickbooksCustomerName])
    )

    // Status counts
    const statusCounts = {
      pending: validations.filter((v) => v.validationStatus === 'pending').length,
      ready: validations.filter((v) => v.validationStatus === 'ready').length,
      blocked: validations.filter((v) => v.validationStatus === 'blocked').length,
      synced: validations.filter((v) => v.validationStatus === 'synced').length,
    }

    // Get synced invoices with their QB invoice IDs
    const syncedValidations = validations.filter(
      (v) => v.validationStatus === 'synced' && v.quickbooksInvoiceId
    )

    // Fetch QB invoice details for totals
    const invoiceDetails: Array<{
      year: number
      qbCustomerId: string | null
      qbCustomerName: string | null
      amount: number
    }> = []

    for (const val of syncedValidations) {
      if (!val.quickbooksInvoiceId || val.quickbooksInvoiceId.startsWith('DUPLICATE:')) {
        continue
      }

      try {
        const qbInvoice = await getQBInvoice(val.quickbooksInvoiceId)
        if (qbInvoice) {
          const year = qbInvoice.TxnDate
            ? new Date(qbInvoice.TxnDate).getFullYear()
            : new Date().getFullYear()

          invoiceDetails.push({
            year,
            qbCustomerId: qbInvoice.CustomerRef?.value || null,
            qbCustomerName:
              qbInvoice.CustomerRef?.name ||
              customerNameMap.get(qbInvoice.CustomerRef?.value || '') ||
              null,
            amount: qbInvoice.TotalAmt || 0,
          })
        }
      } catch (e) {
        // Skip invoices that can't be fetched
        console.error(`Error fetching QB invoice ${val.quickbooksInvoiceId}:`, e)
      }
    }

    // Calculate totals by year
    const totals: Record<number, { synced: number; amount: number }> = {}
    for (const inv of invoiceDetails) {
      if (!totals[inv.year]) {
        totals[inv.year] = { synced: 0, amount: 0 }
      }
      totals[inv.year].synced++
      totals[inv.year].amount += inv.amount
    }

    // Calculate totals by customer
    const byCustomerMap = new Map<
      string,
      { qbCustomerId: string; qbCustomerName: string; invoiceCount: number; totalAmount: number; amounts: Record<number, number> }
    >()

    for (const inv of invoiceDetails) {
      const customerId = inv.qbCustomerId || 'unknown'
      if (!byCustomerMap.has(customerId)) {
        byCustomerMap.set(customerId, {
          qbCustomerId: customerId,
          qbCustomerName: inv.qbCustomerName || 'Unknown Customer',
          invoiceCount: 0,
          totalAmount: 0,
          amounts: {},
        })
      }
      const customer = byCustomerMap.get(customerId)!
      customer.invoiceCount++
      customer.totalAmount += inv.amount
      if (!customer.amounts[inv.year]) {
        customer.amounts[inv.year] = 0
      }
      customer.amounts[inv.year] += inv.amount
    }

    const byCustomer = Array.from(byCustomerMap.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount
    )

    return {
      totals,
      byCustomer,
      statusCounts,
    }
  }),
})
