/**
 * Invoice Validation Service
 *
 * Validates ATEK invoices for QuickBooks sync readiness by checking:
 * 1. Customer mapping is approved
 * 2. All SKUs in the invoice have approved mappings
 * 3. Aggregates blocking issues preventing sync
 * 4. Calculates overall validation confidence
 */

import { db } from '../db'
import { invoiceValidation, customerMapping, skuMapping, matchingAlgorithmLog } from '../db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { getInvoice, listInvoicesForSync, type NormalizedInvoice } from './atek-invoices'

// ============================================================================
// Types
// ============================================================================

export type ValidationStatus = 'pending' | 'ready' | 'blocked' | 'synced'

export type BlockingIssueType = 'customer_mapping' | 'sku_mapping' | 'invoice_status' | 'data_quality'

export type BlockingIssueSeverity = 'error' | 'warning'

export interface BlockingIssue {
  type: BlockingIssueType
  severity: BlockingIssueSeverity
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface CustomerValidationResult {
  isValid: boolean
  organizationId: string
  contractualManagerId: string | null
  mappingId: number | null
  quickbooksCustomerId: string | null
  quickbooksCustomerName: string | null
  issues: BlockingIssue[]
}

export interface SkuIssue {
  skuId: string
  skuCode: string | null
  skuName: string | null
  reason: 'no_mapping' | 'not_approved' | 'needs_creation'
}

export interface SkuValidationResult {
  isComplete: boolean
  totalSkus: number
  mappedSkus: number
  unmappedSkus: SkuIssue[]
  issues: BlockingIssue[]
}

export interface ValidationResult {
  invoiceId: string
  invoiceNumber: string
  status: ValidationStatus
  customerMappingValidated: boolean
  allSkusMapped: boolean
  blockingIssues: BlockingIssue[]
  confidenceScore: number
  readyForSync: boolean
  customerDetails?: {
    qbCustomerId: string
    qbCustomerName: string
  }
  skuSummary: {
    total: number
    mapped: number
    pending: number
  }
}

export interface BatchValidationResult {
  total: number
  ready: number
  blocked: number
  pending: number
  results: ValidationResult[]
}

export interface ReconciliationContext {
  invoiceNumber: string
  poNumber: string | null
  projectName: string | null
  customerName: string | null
  totalAmount: number
  currency: string
}

// Algorithm version for logging
const ALGORITHM_VERSION = '1.0.0'

// Confidence weights
const WEIGHTS = {
  CUSTOMER: 0.4,
  SKU: 0.6,
}

// ============================================================================
// Main Validation Functions
// ============================================================================

/**
 * Validate a single invoice for QuickBooks sync readiness
 */
export async function validateInvoice(atekInvoiceId: string): Promise<ValidationResult> {
  const startTime = Date.now()

  // Get invoice from ATEK
  const invoice = await getInvoice(atekInvoiceId)
  if (!invoice) {
    throw new Error(`Invoice not found: ${atekInvoiceId}`)
  }

  // Run validation checks
  const customerResult = await checkCustomerMapping(
    invoice.organizationId,
    invoice.contractualManagerId
  )

  const skuResult = await checkSkuMappings(invoice.lineItems)

  // Check invoice status
  const statusIssues = checkInvoiceStatus(invoice)

  // Check data quality
  const dataIssues = checkDataQuality(invoice)

  // Aggregate all blocking issues
  const blockingIssues = aggregateBlockingIssues(
    customerResult,
    skuResult,
    statusIssues,
    dataIssues
  )

  // Calculate confidence score
  const confidenceScore = calculateConfidenceScore(customerResult, skuResult)

  // Determine validation status
  const hasErrors = blockingIssues.some(issue => issue.severity === 'error')
  const status: ValidationStatus = hasErrors ? 'blocked' : 'ready'
  const readyForSync = !hasErrors

  // Build result
  const result: ValidationResult = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status,
    customerMappingValidated: customerResult.isValid,
    allSkusMapped: skuResult.isComplete,
    blockingIssues,
    confidenceScore,
    readyForSync,
    customerDetails: customerResult.isValid && customerResult.quickbooksCustomerId
      ? {
          qbCustomerId: customerResult.quickbooksCustomerId,
          qbCustomerName: customerResult.quickbooksCustomerName || '',
        }
      : undefined,
    skuSummary: {
      total: skuResult.totalSkus,
      mapped: skuResult.mappedSkus,
      pending: skuResult.totalSkus - skuResult.mappedSkus,
    },
  }

  // Store validation result in database
  await storeValidationResult(invoice, result)

  // Log validation attempt
  await logValidationAttempt(invoice, result, startTime)

  return result
}

/**
 * Validate multiple invoices in batch
 */
export async function validateBatch(invoiceIds: string[]): Promise<BatchValidationResult> {
  const results: ValidationResult[] = []

  for (const invoiceId of invoiceIds) {
    try {
      const result = await validateInvoice(invoiceId)
      results.push(result)
    } catch (error) {
      // Log error but continue with other invoices
      console.error(`Failed to validate invoice ${invoiceId}:`, error)
    }
  }

  const ready = results.filter(r => r.status === 'ready').length
  const blocked = results.filter(r => r.status === 'blocked').length
  const pending = results.filter(r => r.status === 'pending').length

  return {
    total: results.length,
    ready,
    blocked,
    pending,
    results,
  }
}

/**
 * Validate all unvalidated invoices
 */
export async function validateAllPending(options?: {
  limit?: number
  startDate?: Date
  endDate?: Date
}): Promise<BatchValidationResult> {
  const { limit = 100, startDate, endDate } = options || {}

  // Get invoices ready for sync from ATEK
  const invoices = await listInvoicesForSync({
    limit,
    startDate,
    endDate,
  })

  // Get already validated invoice IDs
  const existingValidations = await db
    .select({ atekInvoiceId: invoiceValidation.atekInvoiceId })
    .from(invoiceValidation)

  const validatedIds = new Set(existingValidations.map(v => v.atekInvoiceId))

  // Filter to only unvalidated invoices
  const unvalidatedInvoices = invoices.filter(inv => !validatedIds.has(inv.id))

  // Validate each invoice
  return validateBatch(unvalidatedInvoices.map(inv => inv.id))
}

// ============================================================================
// Customer Mapping Validation
// ============================================================================

/**
 * Check if customer mapping exists and is approved
 */
export async function checkCustomerMapping(
  organizationId: string,
  contractualManagerId: string | null
): Promise<CustomerValidationResult> {
  const issues: BlockingIssue[] = []

  if (!organizationId) {
    issues.push({
      type: 'customer_mapping',
      severity: 'error',
      code: 'CUSTOMER_NO_ORG',
      message: 'Invoice has no organization ID',
    })

    return {
      isValid: false,
      organizationId: '',
      contractualManagerId: null,
      mappingId: null,
      quickbooksCustomerId: null,
      quickbooksCustomerName: null,
      issues,
    }
  }

  // Query customer mapping by org + manager
  const managerId = contractualManagerId || ''

  const mapping = await db.query.customerMapping.findFirst({
    where: and(
      eq(customerMapping.atekOrganizationId, organizationId),
      eq(customerMapping.atekContractualManagerId, managerId)
    ),
  })

  // If no mapping with manager, try without manager (empty manager ID)
  let effectiveMapping = mapping
  if (!effectiveMapping && managerId !== '') {
    effectiveMapping = await db.query.customerMapping.findFirst({
      where: and(
        eq(customerMapping.atekOrganizationId, organizationId),
        eq(customerMapping.atekContractualManagerId, '')
      ),
    })
  }

  if (!effectiveMapping) {
    issues.push({
      type: 'customer_mapping',
      severity: 'error',
      code: 'CUSTOMER_NO_MAPPING',
      message: 'No customer mapping found for this organization',
      details: { organizationId, contractualManagerId },
    })

    return {
      isValid: false,
      organizationId,
      contractualManagerId,
      mappingId: null,
      quickbooksCustomerId: null,
      quickbooksCustomerName: null,
      issues,
    }
  }

  // Check mapping status
  if (effectiveMapping.mappingStatus !== 'approved') {
    issues.push({
      type: 'customer_mapping',
      severity: 'error',
      code: 'CUSTOMER_NOT_APPROVED',
      message: `Customer mapping not approved (status: ${effectiveMapping.mappingStatus})`,
      details: {
        mappingId: effectiveMapping.mappingId,
        status: effectiveMapping.mappingStatus,
      },
    })

    return {
      isValid: false,
      organizationId,
      contractualManagerId,
      mappingId: effectiveMapping.mappingId,
      quickbooksCustomerId: effectiveMapping.quickbooksCustomerId,
      quickbooksCustomerName: effectiveMapping.quickbooksCustomerName,
      issues,
    }
  }

  // Check QB customer is linked
  if (!effectiveMapping.quickbooksCustomerId) {
    issues.push({
      type: 'customer_mapping',
      severity: 'error',
      code: 'CUSTOMER_NO_QB_LINK',
      message: 'Customer mapping approved but no QuickBooks customer linked',
      details: { mappingId: effectiveMapping.mappingId },
    })

    return {
      isValid: false,
      organizationId,
      contractualManagerId,
      mappingId: effectiveMapping.mappingId,
      quickbooksCustomerId: null,
      quickbooksCustomerName: effectiveMapping.quickbooksCustomerName,
      issues,
    }
  }

  return {
    isValid: true,
    organizationId,
    contractualManagerId,
    mappingId: effectiveMapping.mappingId,
    quickbooksCustomerId: effectiveMapping.quickbooksCustomerId,
    quickbooksCustomerName: effectiveMapping.quickbooksCustomerName,
    issues: [],
  }
}

// ============================================================================
// SKU Mapping Validation
// ============================================================================

/**
 * Check if all SKUs in invoice have approved mappings
 */
export async function checkSkuMappings(
  lineItems: NormalizedInvoice['lineItems']
): Promise<SkuValidationResult> {
  const issues: BlockingIssue[] = []
  const unmappedSkus: SkuIssue[] = []

  if (!lineItems || lineItems.length === 0) {
    return {
      isComplete: true,
      totalSkus: 0,
      mappedSkus: 0,
      unmappedSkus: [],
      issues: [],
    }
  }

  // Get unique SKU identifiers (prefer code, fall back to id)
  const skuIdentifiers = new Map<string, { skuId: string; skuCode: string | null; skuName: string | null }>()

  for (const item of lineItems) {
    const key = item.skuCode || item.skuId
    if (key && !skuIdentifiers.has(key)) {
      skuIdentifiers.set(key, {
        skuId: item.skuId,
        skuCode: item.skuCode,
        skuName: item.skuName,
      })
    }
  }

  const totalSkus = skuIdentifiers.size
  let mappedSkus = 0

  // Check each SKU for approved mapping
  for (const [key, sku] of skuIdentifiers) {
    // Try to find mapping by code first, then by ID
    let mapping = await db.query.skuMapping.findFirst({
      where: eq(skuMapping.atekSkuCode, key),
    })

    if (!mapping && sku.skuId) {
      mapping = await db.query.skuMapping.findFirst({
        where: eq(skuMapping.atekSkuId, sku.skuId),
      })
    }

    if (!mapping) {
      unmappedSkus.push({
        skuId: sku.skuId,
        skuCode: sku.skuCode,
        skuName: sku.skuName,
        reason: 'no_mapping',
      })
      continue
    }

    if (mapping.mappingStatus === 'needs_creation') {
      unmappedSkus.push({
        skuId: sku.skuId,
        skuCode: sku.skuCode,
        skuName: sku.skuName,
        reason: 'needs_creation',
      })
      continue
    }

    if (mapping.mappingStatus !== 'approved') {
      unmappedSkus.push({
        skuId: sku.skuId,
        skuCode: sku.skuCode,
        skuName: sku.skuName,
        reason: 'not_approved',
      })
      continue
    }

    if (!mapping.quickbooksItemId) {
      unmappedSkus.push({
        skuId: sku.skuId,
        skuCode: sku.skuCode,
        skuName: sku.skuName,
        reason: 'not_approved',
      })
      continue
    }

    // Valid mapping found
    mappedSkus++
  }

  // Create issues for unmapped SKUs
  const noMappingSkus = unmappedSkus.filter(s => s.reason === 'no_mapping')
  const notApprovedSkus = unmappedSkus.filter(s => s.reason === 'not_approved')
  const needsCreationSkus = unmappedSkus.filter(s => s.reason === 'needs_creation')

  if (noMappingSkus.length > 0) {
    issues.push({
      type: 'sku_mapping',
      severity: 'error',
      code: 'SKU_NO_MAPPING',
      message: `${noMappingSkus.length} SKU(s) missing mappings`,
      details: {
        count: noMappingSkus.length,
        skus: noMappingSkus.map(s => s.skuCode || s.skuId),
      },
    })
  }

  if (notApprovedSkus.length > 0) {
    issues.push({
      type: 'sku_mapping',
      severity: 'error',
      code: 'SKU_NOT_APPROVED',
      message: `${notApprovedSkus.length} SKU mapping(s) pending approval`,
      details: {
        count: notApprovedSkus.length,
        skus: notApprovedSkus.map(s => s.skuCode || s.skuId),
      },
    })
  }

  if (needsCreationSkus.length > 0) {
    issues.push({
      type: 'sku_mapping',
      severity: 'warning',
      code: 'SKU_NEEDS_CREATION',
      message: `${needsCreationSkus.length} SKU(s) need QB item creation`,
      details: {
        count: needsCreationSkus.length,
        skus: needsCreationSkus.map(s => s.skuCode || s.skuId),
      },
    })
  }

  const isComplete = unmappedSkus.filter(s => s.reason !== 'needs_creation').length === 0

  return {
    isComplete,
    totalSkus,
    mappedSkus,
    unmappedSkus,
    issues,
  }
}

// ============================================================================
// Status and Data Quality Checks
// ============================================================================

/**
 * Check invoice status is valid for sync
 */
function checkInvoiceStatus(invoice: NormalizedInvoice): BlockingIssue[] {
  const issues: BlockingIssue[] = []

  const validStatuses = ['sent', 'paid', 'partial', 'overdue']

  if (!validStatuses.includes(invoice.status)) {
    if (invoice.status === 'draft') {
      issues.push({
        type: 'invoice_status',
        severity: 'error',
        code: 'INVOICE_DRAFT',
        message: 'Invoice is in draft status',
        details: { status: invoice.status },
      })
    } else if (invoice.status === 'cancelled' || invoice.status === 'void') {
      issues.push({
        type: 'invoice_status',
        severity: 'error',
        code: 'INVOICE_CANCELLED',
        message: `Invoice is ${invoice.status}`,
        details: { status: invoice.status },
      })
    } else {
      issues.push({
        type: 'invoice_status',
        severity: 'error',
        code: 'INVOICE_INVALID_STATUS',
        message: `Invoice has invalid status: ${invoice.status}`,
        details: { status: invoice.status },
      })
    }
  }

  return issues
}

/**
 * Check data quality issues
 */
function checkDataQuality(invoice: NormalizedInvoice): BlockingIssue[] {
  const issues: BlockingIssue[] = []

  // Check for line items
  if (!invoice.lineItems || invoice.lineItems.length === 0) {
    issues.push({
      type: 'data_quality',
      severity: 'error',
      code: 'MISSING_LINE_ITEMS',
      message: 'Invoice has no line items',
    })
  }

  // Check for invoice number
  if (!invoice.invoiceNumber) {
    issues.push({
      type: 'data_quality',
      severity: 'warning',
      code: 'MISSING_INVOICE_NUMBER',
      message: 'Invoice has no invoice number',
    })
  }

  // Check for total amount
  if (invoice.totalAmount <= 0) {
    issues.push({
      type: 'data_quality',
      severity: 'warning',
      code: 'ZERO_TOTAL',
      message: 'Invoice has zero or negative total',
      details: { totalAmount: invoice.totalAmount },
    })
  }

  return issues
}

// ============================================================================
// Blocking Issues Aggregator
// ============================================================================

/**
 * Aggregate all blocking issues from validation checks
 */
function aggregateBlockingIssues(
  customerResult: CustomerValidationResult,
  skuResult: SkuValidationResult,
  statusIssues: BlockingIssue[],
  dataIssues: BlockingIssue[]
): BlockingIssue[] {
  return [
    ...customerResult.issues,
    ...skuResult.issues,
    ...statusIssues,
    ...dataIssues,
  ]
}

// ============================================================================
// Confidence Score Calculation
// ============================================================================

/**
 * Calculate overall confidence score for invoice validation
 */
function calculateConfidenceScore(
  customerResult: CustomerValidationResult,
  skuResult: SkuValidationResult
): number {
  // Customer score: 1.0 if valid, 0.0 if not
  const customerScore = customerResult.isValid ? 1.0 : 0.0

  // SKU score: percentage of mapped SKUs
  const skuScore = skuResult.totalSkus > 0
    ? skuResult.mappedSkus / skuResult.totalSkus
    : 1.0 // No SKUs = 100% complete

  return (customerScore * WEIGHTS.CUSTOMER) + (skuScore * WEIGHTS.SKU)
}

// ============================================================================
// Reconciliation Context
// ============================================================================

/**
 * Build reconciliation context for payment matching
 */
export function buildReconciliationContext(invoice: NormalizedInvoice): ReconciliationContext {
  return {
    invoiceNumber: invoice.invoiceNumber,
    poNumber: invoice.poNumber,
    projectName: invoice.projectName,
    customerName: invoice.organizationName,
    totalAmount: invoice.totalAmount,
    currency: invoice.currency,
  }
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Store validation result in database
 */
async function storeValidationResult(
  invoice: NormalizedInvoice,
  result: ValidationResult
): Promise<void> {
  const existingValidation = await db.query.invoiceValidation.findFirst({
    where: eq(invoiceValidation.atekInvoiceId, invoice.id),
  })

  const validationData = {
    atekInvoiceId: invoice.id,
    atekInvoiceNumber: invoice.invoiceNumber,
    validationStatus: result.status as 'pending' | 'ready' | 'blocked' | 'synced',
    customerMappingValidated: result.customerMappingValidated,
    allSkusMapped: result.allSkusMapped,
    blockingIssues: JSON.stringify(result.blockingIssues),
    confidenceScore: result.confidenceScore,
    readyForSync: result.readyForSync,
  }

  if (existingValidation) {
    // Don't overwrite synced invoices
    if (existingValidation.validationStatus === 'synced') {
      return
    }

    await db
      .update(invoiceValidation)
      .set(validationData)
      .where(eq(invoiceValidation.validationId, existingValidation.validationId))
  } else {
    await db.insert(invoiceValidation).values({
      ...validationData,
      createdDate: new Date().toISOString(),
    })
  }
}

/**
 * Log validation attempt for audit trail
 */
async function logValidationAttempt(
  invoice: NormalizedInvoice,
  result: ValidationResult,
  startTime: number
): Promise<void> {
  await db.insert(matchingAlgorithmLog).values({
    entityType: 'invoice',
    atekEntityId: invoice.id,
    algorithmVersion: ALGORITHM_VERSION,
    executionDate: new Date().toISOString(),
    totalCandidates: result.skuSummary.total,
    bestMatchId: result.customerDetails?.qbCustomerId || null,
    bestMatchScore: result.confidenceScore,
    allCandidates: JSON.stringify({
      customer: result.customerDetails,
      skuSummary: result.skuSummary,
    }),
    matchingCriteriaUsed: JSON.stringify({
      customerMappingValidated: result.customerMappingValidated,
      allSkusMapped: result.allSkusMapped,
      blockingIssueCount: result.blockingIssues.length,
    }),
    executionTimeMs: Date.now() - startTime,
  })
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get validation status for a specific invoice
 */
export async function getValidationStatus(atekInvoiceId: string) {
  const validation = await db.query.invoiceValidation.findFirst({
    where: eq(invoiceValidation.atekInvoiceId, atekInvoiceId),
  })

  if (!validation) return null

  return {
    ...validation,
    blockingIssues: validation.blockingIssues
      ? JSON.parse(validation.blockingIssues)
      : [],
  }
}

/**
 * Get all validations with optional filtering
 */
export async function getValidations(options?: {
  status?: ValidationStatus
  limit?: number
  offset?: number
}) {
  const { status, limit = 100, offset = 0 } = options || {}

  let query = db.select().from(invoiceValidation)

  if (status) {
    query = query.where(eq(invoiceValidation.validationStatus, status)) as typeof query
  }

  const results = await query.limit(limit).offset(offset)

  return results.map(r => ({
    ...r,
    blockingIssues: r.blockingIssues ? JSON.parse(r.blockingIssues) : [],
  }))
}

/**
 * Get invoices ready for sync
 */
export async function getReadyForSync(limit?: number) {
  const query = db
    .select()
    .from(invoiceValidation)
    .where(
      and(
        eq(invoiceValidation.validationStatus, 'ready'),
        eq(invoiceValidation.readyForSync, true)
      )
    )
    .limit(limit || 100)

  const results = await query

  return results.map(r => ({
    ...r,
    blockingIssues: r.blockingIssues ? JSON.parse(r.blockingIssues) : [],
  }))
}

/**
 * Get blocked invoices with issues
 */
export async function getBlockedInvoices(limit?: number) {
  const results = await db
    .select()
    .from(invoiceValidation)
    .where(eq(invoiceValidation.validationStatus, 'blocked'))
    .limit(limit || 100)

  return results.map(r => ({
    ...r,
    blockingIssues: r.blockingIssues ? JSON.parse(r.blockingIssues) : [],
  }))
}

/**
 * Get validation statistics
 */
export async function getValidationStats() {
  const all = await db.select().from(invoiceValidation)

  const stats = {
    total: all.length,
    pending: all.filter(v => v.validationStatus === 'pending').length,
    ready: all.filter(v => v.validationStatus === 'ready').length,
    blocked: all.filter(v => v.validationStatus === 'blocked').length,
    synced: all.filter(v => v.validationStatus === 'synced').length,
    avgConfidence: all.length > 0
      ? all.reduce((sum, v) => sum + (v.confidenceScore || 0), 0) / all.length
      : 0,
    readyForSync: all.filter(v => v.readyForSync).length,
  }

  return stats
}

// ============================================================================
// Approval Workflow
// ============================================================================

/**
 * Manually approve an invoice for sync
 */
export async function approveForSync(
  atekInvoiceId: string,
  approvedBy: string
): Promise<void> {
  await db
    .update(invoiceValidation)
    .set({
      readyForSync: true,
      syncApprovedBy: approvedBy,
      syncApprovedDate: new Date().toISOString(),
    })
    .where(eq(invoiceValidation.atekInvoiceId, atekInvoiceId))
}

/**
 * Mark an invoice as synced to QuickBooks
 */
export async function markAsSynced(
  atekInvoiceId: string,
  quickbooksInvoiceId: string
): Promise<void> {
  await db
    .update(invoiceValidation)
    .set({
      validationStatus: 'synced',
      quickbooksInvoiceId,
      syncDate: new Date().toISOString(),
    })
    .where(eq(invoiceValidation.atekInvoiceId, atekInvoiceId))
}

/**
 * Clear validation for an invoice (reset to revalidate)
 */
export async function clearValidation(atekInvoiceId: string): Promise<void> {
  await db
    .delete(invoiceValidation)
    .where(eq(invoiceValidation.atekInvoiceId, atekInvoiceId))
}

/**
 * Clear all non-synced validations
 */
export async function clearAllValidations(): Promise<{ deleted: number }> {
  // Only delete validations that are not synced
  const result = await db
    .delete(invoiceValidation)
    .where(
      and(
        eq(invoiceValidation.validationStatus, 'pending'),
      )
    )

  await db
    .delete(invoiceValidation)
    .where(
      and(
        eq(invoiceValidation.validationStatus, 'ready'),
      )
    )

  await db
    .delete(invoiceValidation)
    .where(
      and(
        eq(invoiceValidation.validationStatus, 'blocked'),
      )
    )

  // Also clear invoice logs
  await db.delete(matchingAlgorithmLog).where(eq(matchingAlgorithmLog.entityType, 'invoice'))

  const remaining = await db.select().from(invoiceValidation)
  return { deleted: remaining.length }
}
