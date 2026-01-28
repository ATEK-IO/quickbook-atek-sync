/**
 * Invoice Sync Service
 *
 * Syncs validated ATEK invoices to QuickBooks:
 * 1. Verify validation status is 'ready'
 * 2. Check for duplicate in QB by DocNumber
 * 3. Build QB invoice with mapped customer/items
 * 4. Create in QuickBooks
 * 5. Mark as synced locally
 */

import { db } from '../db'
import { customerMapping, skuMapping, invoiceValidation } from '../db/schema'
import { eq, and, or } from 'drizzle-orm'
import {
  getInvoice as getATEKInvoice,
  listInvoicesForSync,
  type NormalizedInvoice,
} from './atek-invoices'
import { listOrganizations as listATEKOrganizations } from './atek-organizations'
import { getUsersByIds } from './atek-managers'
import {
  createInvoice as createQBInvoice,
  searchInvoices as searchQBInvoices,
  getInvoiceByDocNumber as getQBInvoiceByDocNumber,
  type QBInvoiceCreateInput,
  type QBInvoice,
} from './qb-invoices'
import {
  getValidationStatus,
  markAsSynced,
  checkCustomerMapping,
  type CustomerValidationResult,
} from './invoice-validation'

// ============================================================================
// Types
// ============================================================================

export interface InvoiceSyncResult {
  atekInvoiceId: string
  atekInvoiceNumber: string
  success: boolean
  quickbooksInvoiceId?: string
  quickbooksDocNumber?: string
  error?: string
  skippedReason?: 'already_synced' | 'duplicate_in_qb' | 'validation_failed' | 'no_customer_mapping' | 'missing_sku_mappings'
  lineItemsCreated: number
}

export interface BatchSyncResult {
  total: number
  successful: number
  failed: number
  skipped: number
  results: InvoiceSyncResult[]
}

export interface InvoiceForSync {
  id: string
  invoiceNumber: string
  organizationId: string
  organizationNumber: string | null
  organizationName: string | null
  contractualManagerId: string | null
  contractualManagerName: string | null
  issueDate: string
  dueDate: string | null
  totalAmount: number
  currency: string
  lineItemCount: number
  validationStatus: string | null
  customerMappingValidated: boolean
  allSkusMapped: boolean
  blockingIssues: unknown[]
  quickbooksInvoiceId: string | null
  quickbooksCustomerId: string | null
  quickbooksCustomerName: string | null
  syncDate: string | null
  matchScore: number | null // Match percentage with QB invoice (0-100)
}

export interface SyncStats {
  total: number
  pending: number
  ready: number
  blocked: number
  synced: number
}

// ============================================================================
// Main Sync Functions
// ============================================================================

/**
 * Sync a single invoice from ATEK to QuickBooks
 */
export async function syncInvoice(atekInvoiceId: string): Promise<InvoiceSyncResult> {
  // 1. Check local validation status
  const validation = await getValidationStatus(atekInvoiceId)

  if (validation?.validationStatus === 'synced') {
    return {
      atekInvoiceId,
      atekInvoiceNumber: validation.atekInvoiceNumber || '',
      success: false,
      skippedReason: 'already_synced',
      quickbooksInvoiceId: validation.quickbooksInvoiceId || undefined,
      lineItemsCreated: 0,
    }
  }

  // 2. Get the ATEK invoice
  const invoice = await getATEKInvoice(atekInvoiceId)
  if (!invoice) {
    return {
      atekInvoiceId,
      atekInvoiceNumber: '',
      success: false,
      error: 'Invoice not found in ATEK',
      lineItemsCreated: 0,
    }
  }

  // 3. Validate the invoice if not already validated
  if (!validation || validation.validationStatus === 'pending') {
    // Run validation first
    const customerResult = await checkCustomerMapping(
      invoice.organizationId,
      invoice.contractualManagerId
    )

    if (!customerResult.isValid) {
      return {
        atekInvoiceId,
        atekInvoiceNumber: invoice.invoiceNumber,
        success: false,
        skippedReason: 'no_customer_mapping',
        error: 'Customer mapping not approved',
        lineItemsCreated: 0,
      }
    }
  }

  // 4. Check for duplicate in QuickBooks by DocNumber
  if (invoice.invoiceNumber) {
    const existingInQB = await checkDuplicateInQB(invoice.invoiceNumber)
    if (existingInQB) {
      // Mark as synced locally to prevent future attempts
      await markAsSynced(atekInvoiceId, `DUPLICATE:${existingInQB.Id}`)
      return {
        atekInvoiceId,
        atekInvoiceNumber: invoice.invoiceNumber,
        success: false,
        skippedReason: 'duplicate_in_qb',
        quickbooksInvoiceId: existingInQB.Id,
        lineItemsCreated: 0,
      }
    }
  }

  // 5. Get customer mapping
  const customerResult = await checkCustomerMapping(
    invoice.organizationId,
    invoice.contractualManagerId
  )

  if (!customerResult.isValid || !customerResult.quickbooksCustomerId) {
    return {
      atekInvoiceId,
      atekInvoiceNumber: invoice.invoiceNumber,
      success: false,
      skippedReason: 'no_customer_mapping',
      error: customerResult.issues[0]?.message || 'No customer mapping',
      lineItemsCreated: 0,
    }
  }

  // 6. Build QB invoice with line item mappings
  const buildResult = await buildQBInvoice(invoice, customerResult)

  if (!buildResult.success) {
    return {
      atekInvoiceId,
      atekInvoiceNumber: invoice.invoiceNumber,
      success: false,
      skippedReason: 'missing_sku_mappings',
      error: buildResult.error,
      lineItemsCreated: 0,
    }
  }

  // 7. Create in QuickBooks
  try {
    const qbInvoice = await createQBInvoice(buildResult.invoice!)

    // 8. Mark as synced
    await markAsSynced(atekInvoiceId, qbInvoice.Id)

    return {
      atekInvoiceId,
      atekInvoiceNumber: invoice.invoiceNumber,
      success: true,
      quickbooksInvoiceId: qbInvoice.Id,
      quickbooksDocNumber: qbInvoice.DocNumber,
      lineItemsCreated: buildResult.invoice!.Line.length,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      atekInvoiceId,
      atekInvoiceNumber: invoice.invoiceNumber,
      success: false,
      error: `QB Error: ${errorMessage}`,
      lineItemsCreated: 0,
    }
  }
}

/**
 * Sync multiple invoices in batch
 */
export async function syncBatch(invoiceIds: string[]): Promise<BatchSyncResult> {
  const results: InvoiceSyncResult[] = []
  let successful = 0
  let failed = 0
  let skipped = 0

  for (const invoiceId of invoiceIds) {
    try {
      const result = await syncInvoice(invoiceId)
      results.push(result)

      if (result.success) {
        successful++
      } else if (result.skippedReason) {
        skipped++
      } else {
        failed++
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      results.push({
        atekInvoiceId: invoiceId,
        atekInvoiceNumber: '',
        success: false,
        error: errorMessage,
        lineItemsCreated: 0,
      })
      failed++
    }
  }

  return {
    total: invoiceIds.length,
    successful,
    failed,
    skipped,
    results,
  }
}

/**
 * Sync all invoices that are ready for sync
 */
export async function syncAllReady(limit?: number): Promise<BatchSyncResult> {
  // Get ready validations
  const readyValidations = await db
    .select()
    .from(invoiceValidation)
    .where(
      and(
        eq(invoiceValidation.validationStatus, 'ready'),
        eq(invoiceValidation.readyForSync, true)
      )
    )
    .limit(limit || 50)

  const invoiceIds = readyValidations.map((v) => v.atekInvoiceId)
  return syncBatch(invoiceIds)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an invoice already exists in QuickBooks by DocNumber
 */
export async function checkDuplicateInQB(invoiceNumber: string): Promise<QBInvoice | null> {
  try {
    const results = await searchQBInvoices(invoiceNumber)
    // Find exact match
    const exactMatch = results.find(
      (inv) => inv.DocNumber?.toLowerCase() === invoiceNumber.toLowerCase()
    )
    return exactMatch || null
  } catch (error) {
    // If QB search fails, assume no duplicate (safer to create than to skip)
    console.error('Error checking QB duplicate:', error)
    return null
  }
}

interface BuildQBInvoiceResult {
  success: boolean
  invoice?: QBInvoiceCreateInput
  error?: string
  missingMappings?: string[]
}

/**
 * Build a QuickBooks invoice from ATEK invoice data
 */
async function buildQBInvoice(
  invoice: NormalizedInvoice,
  customerResult: CustomerValidationResult
): Promise<BuildQBInvoiceResult> {
  const lineItems: QBInvoiceCreateInput['Line'] = []
  const missingMappings: string[] = []

  // Process each line item
  for (const item of invoice.lineItems) {
    // Find SKU mapping
    const mapping = await getSkuMappingForItem(item)

    if (!mapping || !mapping.quickbooksItemId) {
      missingMappings.push(item.skuCode || item.skuId || 'Unknown SKU')
      continue
    }

    if (mapping.mappingStatus !== 'approved') {
      missingMappings.push(`${item.skuCode || item.skuId} (not approved)`)
      continue
    }

    lineItems.push({
      Amount: item.amount,
      Description: item.description || item.skuName || '',
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: mapping.quickbooksItemId },
        Qty: item.quantity,
        UnitPrice: item.unitPrice,
      },
    })
  }

  if (missingMappings.length > 0) {
    return {
      success: false,
      error: `Missing SKU mappings: ${missingMappings.join(', ')}`,
      missingMappings,
    }
  }

  if (lineItems.length === 0) {
    return {
      success: false,
      error: 'No line items could be mapped',
    }
  }

  return {
    success: true,
    invoice: {
      CustomerRef: { value: customerResult.quickbooksCustomerId! },
      Line: lineItems,
      DocNumber: invoice.invoiceNumber,
      TxnDate: invoice.issueDate,
      DueDate: invoice.dueDate || undefined,
      CustomerMemo: invoice.notes ? { value: invoice.notes } : undefined,
      PrivateNote: invoice.privateNotes || undefined,
    },
  }
}

/**
 * Get SKU mapping for a line item
 */
async function getSkuMappingForItem(item: {
  skuId: string
  skuCode: string | null
  skuName: string | null
}) {
  // Try by code first
  if (item.skuCode) {
    const byCode = await db.query.skuMapping.findFirst({
      where: eq(skuMapping.atekSkuCode, item.skuCode),
    })
    if (byCode) return byCode
  }

  // Fall back to ID
  if (item.skuId) {
    const byId = await db.query.skuMapping.findFirst({
      where: eq(skuMapping.atekSkuId, item.skuId),
    })
    if (byId) return byId
  }

  return null
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get list of invoices with their validation status for UI display
 */
export async function listInvoicesWithValidation(options?: {
  status?: 'all' | 'pending' | 'ready' | 'blocked' | 'synced'
  search?: string
  limit?: number
  offset?: number
}): Promise<InvoiceForSync[]> {
  const { status = 'all', search, limit = 100, offset = 0 } = options || {}

  // Get ATEK invoices - fetch more when searching to ensure we find matches
  const fetchLimit = search?.trim() ? 1000 : limit + offset
  const invoices = await listInvoicesForSync({ limit: fetchLimit })

  // Get ATEK organizations for org number and name
  const atekOrgs = await listATEKOrganizations()
  const atekOrgMap = new Map(atekOrgs.map((o) => [o.id, o]))

  // Extract unique manager IDs from invoices and fetch only those users
  const uniqueManagerIds = [...new Set(
    invoices
      .map((inv) => inv.contractualManagerId)
      .filter((id): id is string => id !== null && id !== undefined)
  )]
  const atekUsers = await getUsersByIds(uniqueManagerIds)
  const atekManagerMap = new Map(atekUsers.map((m) => [m.id, m]))

  // Get all validations
  const validations = await db.select().from(invoiceValidation)
  const validationMap = new Map(validations.map((v) => [v.atekInvoiceId, v]))

  // Get all customer mappings
  const customerMappings = await db.select().from(customerMapping)
  // Create maps for lookups
  // Map by orgId + managerId combo
  const getMappingKey = (orgId: string, managerId: string | null | undefined) =>
    `${orgId}:${managerId || ''}`
  const customerMappingByOrgManager = new Map(
    customerMappings.map((m) => [
      getMappingKey(m.atekOrganizationId, m.atekContractualManagerId),
      m,
    ])
  )
  // Also create a map by orgId only (for fallback when manager doesn't match)
  const customerMappingByOrg = new Map<string, typeof customerMappings[0]>()
  for (const m of customerMappings) {
    // Prefer approved mappings, or keep first if none approved
    const existing = customerMappingByOrg.get(m.atekOrganizationId)
    if (!existing || m.mappingStatus === 'approved') {
      customerMappingByOrg.set(m.atekOrganizationId, m)
    }
  }

  // Helper to find mapping with fallback
  const findMapping = (orgId: string, managerId: string | null) => {
    // First try exact match (org + manager)
    const exactKey = getMappingKey(orgId, managerId)
    const exact = customerMappingByOrgManager.get(exactKey)
    if (exact) return exact

    // Try org + empty manager (some mappings have no manager)
    const emptyManagerKey = getMappingKey(orgId, '')
    const withEmptyManager = customerMappingByOrgManager.get(emptyManagerKey)
    if (withEmptyManager) return withEmptyManager

    // Fall back to any mapping for this org
    return customerMappingByOrg.get(orgId) || null
  }

  // Pre-filter invoices by search BEFORE QB lookups (for performance)
  let preFilteredInvoices = invoices
  if (search?.trim()) {
    const query = search.toLowerCase().trim()
    preFilteredInvoices = invoices.filter((inv) => {
      const atekOrg = atekOrgMap.get(inv.organizationId)
      const orgNumber = atekOrg?.orgNumber ? String(atekOrg.orgNumber).padStart(4, '0') : ''
      const orgName = atekOrg?.name || inv.organizationName || ''
      return (
        inv.invoiceNumber?.toLowerCase().includes(query) ||
        orgName.toLowerCase().includes(query) ||
        orgNumber.toLowerCase().includes(query)
      )
    })
  }

  // Pre-filter by status BEFORE QB lookups
  if (status !== 'all') {
    preFilteredInvoices = preFilteredInvoices.filter((inv) => {
      const validation = validationMap.get(inv.id)
      return (validation?.validationStatus || 'pending') === status
    })
  }

  // Apply pagination BEFORE QB lookups
  const paginatedInvoices = preFilteredInvoices.slice(offset, offset + limit)

  // Search QB only for paginated invoices (much faster!)
  const qbInvoiceMap = new Map<string, QBInvoice>()
  const uniqueInvoiceNumbers = [...new Set(paginatedInvoices.map((inv) => inv.invoiceNumber))]

  // Search in batches to avoid rate limiting
  for (const invoiceNumber of uniqueInvoiceNumbers) {
    try {
      const qbInv = await getQBInvoiceByDocNumber(invoiceNumber)
      if (qbInv) {
        qbInvoiceMap.set(invoiceNumber.toLowerCase(), qbInv)
      }
    } catch (e) {
      // Continue on error - invoice just won't have a match
      console.error(`Error searching QB for invoice ${invoiceNumber}:`, e)
    }
  }

  // Helper to calculate match score between ATEK and QB invoice
  const calculateMatchScore = (atekInv: NormalizedInvoice, qbInv: QBInvoice): number => {
    const checks: { match: boolean; weight: number }[] = []

    // Invoice number match
    checks.push({
      match: atekInv.invoiceNumber.toLowerCase() === (qbInv.DocNumber || '').toLowerCase(),
      weight: 2,
    })

    // Date match
    checks.push({
      match: atekInv.issueDate === qbInv.TxnDate,
      weight: 1,
    })

    // Due date match
    checks.push({
      match: atekInv.dueDate === qbInv.DueDate,
      weight: 1,
    })

    // Calculate QB subtotal
    const qbSubtotal = qbInv.Line
      .filter((line) => line.DetailType === 'SalesItemLineDetail')
      .reduce((sum, line) => sum + line.Amount, 0)

    // Subtotal match (within 1%)
    const subtotalDiff = Math.abs(atekInv.subtotal - qbSubtotal)
    checks.push({
      match: subtotalDiff <= atekInv.subtotal * 0.01,
      weight: 2,
    })

    // Total match (within 1%)
    const totalDiff = Math.abs(atekInv.totalAmount - qbInv.TotalAmt)
    checks.push({
      match: totalDiff <= atekInv.totalAmount * 0.01,
      weight: 2,
    })

    // Line item count match
    const qbLineCount = qbInv.Line.filter((l) => l.DetailType === 'SalesItemLineDetail').length
    checks.push({
      match: atekInv.lineItems.length === qbLineCount,
      weight: 1,
    })

    const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0)
    const matchedWeight = checks.reduce((sum, c) => sum + (c.match ? c.weight : 0), 0)

    return Math.round((matchedWeight / totalWeight) * 100)
  }

  // Combine data (only for paginated invoices)
  const results: InvoiceForSync[] = paginatedInvoices.map((inv) => {
    const validation = validationMap.get(inv.id)
    const custMapping = findMapping(inv.organizationId, inv.contractualManagerId)
    const atekOrg = atekOrgMap.get(inv.organizationId)

    // Format org number as 4-digit padded string (from ATEK org data)
    const orgNumber = atekOrg?.orgNumber
      ? String(atekOrg.orgNumber).padStart(4, '0')
      : null

    // Use customer mapping's org name (which has proper display name like "0007 Marc-Étienne Lemoyne")
    // Fall back to ATEK org name if no mapping
    const orgName = custMapping?.atekOrganizationName || atekOrg?.name || inv.organizationName || null

    // Get QB invoice and calculate match score
    const qbInv = qbInvoiceMap.get(inv.invoiceNumber.toLowerCase())
    const matchScore = qbInv ? calculateMatchScore(inv, qbInv) : null

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      organizationId: inv.organizationId,
      organizationNumber: orgNumber,
      organizationName: orgName,
      contractualManagerId: inv.contractualManagerId,
      // Use actual manager from invoice's contractualManagerId
      contractualManagerName: inv.contractualManagerId
        ? atekManagerMap.get(inv.contractualManagerId)?.name || null
        : null,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      totalAmount: inv.totalAmount,
      currency: inv.currency,
      lineItemCount: inv.lineItems.length,
      validationStatus: validation?.validationStatus || 'pending',
      customerMappingValidated: validation?.customerMappingValidated || false,
      allSkusMapped: validation?.allSkusMapped || false,
      blockingIssues: validation?.blockingIssues
        ? JSON.parse(validation.blockingIssues)
        : [],
      quickbooksInvoiceId: validation?.quickbooksInvoiceId || qbInv?.Id || null,
      quickbooksCustomerId: custMapping?.quickbooksCustomerId || null,
      quickbooksCustomerName: custMapping?.quickbooksCustomerName || null,
      syncDate: validation?.syncDate || null,
      matchScore,
    }
  })

  // Already filtered and paginated above, just return results
  return results
}

/**
 * Get sync statistics
 */
export async function getSyncStats(): Promise<SyncStats> {
  const validations = await db.select().from(invoiceValidation)

  // Get total invoices from ATEK
  const invoices = await listInvoicesForSync({ limit: 10000 })
  const total = invoices.length

  // Count by status
  const pending = total - validations.length
  const ready = validations.filter((v) => v.validationStatus === 'ready').length
  const blocked = validations.filter((v) => v.validationStatus === 'blocked').length
  const synced = validations.filter((v) => v.validationStatus === 'synced').length

  return { total, pending, ready, blocked, synced }
}

/**
 * Get invoice details with full line items and mappings
 */
export async function getInvoiceDetails(atekInvoiceId: string) {
  const invoice = await getATEKInvoice(atekInvoiceId)
  if (!invoice) return null

  const validation = await getValidationStatus(atekInvoiceId)
  const customerResult = await checkCustomerMapping(
    invoice.organizationId,
    invoice.contractualManagerId
  )

  // Get SKU mappings for all line items
  const lineItemsWithMappings = await Promise.all(
    invoice.lineItems.map(async (item) => {
      const mapping = await getSkuMappingForItem(item)
      return {
        ...item,
        mapping: mapping
          ? {
              mappingId: mapping.mappingId,
              quickbooksItemId: mapping.quickbooksItemId,
              quickbooksItemName: mapping.quickbooksItemName,
              mappingStatus: mapping.mappingStatus,
            }
          : null,
      }
    })
  )

  return {
    ...invoice,
    lineItems: lineItemsWithMappings,
    validation: validation
      ? {
          status: validation.validationStatus,
          customerMappingValidated: validation.customerMappingValidated,
          allSkusMapped: validation.allSkusMapped,
          blockingIssues: validation.blockingIssues
            ? typeof validation.blockingIssues === 'string'
              ? JSON.parse(validation.blockingIssues)
              : validation.blockingIssues
            : [],
          quickbooksInvoiceId: validation.quickbooksInvoiceId,
          syncDate: validation.syncDate,
        }
      : null,
    customerMapping: customerResult.isValid
      ? {
          mappingId: customerResult.mappingId,
          quickbooksCustomerId: customerResult.quickbooksCustomerId,
          quickbooksCustomerName: customerResult.quickbooksCustomerName,
        }
      : null,
  }
}
