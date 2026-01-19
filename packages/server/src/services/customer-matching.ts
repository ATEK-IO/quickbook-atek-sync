/**
 * Customer Matching Algorithm
 *
 * Matches ATEK Organizations to QuickBooks Customers using org_num as primary key.
 *
 * QB Customer naming convention:
 * - Primary: "XXXX Name" (e.g., "0000 JGH")
 * - Sub-customer: "XXXX-YY Department" (e.g., "0000-01 JGH Pharmacy")
 *
 * Where XXXX = ATEK org_num (4-digit zero-padded)
 */

import { db } from '../db'
import { customerMapping, matchingAlgorithmLog } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { listOrganizations, type NormalizedOrganization } from './atek-organizations'
import { listCustomers, type QBCustomer } from './qb-customers'
import { getContractualManagersByOrganization } from './atek-invoices'
import { getUsersByIds } from './atek-managers'
import {
  extractOrgNumber,
  extractNameFromDisplayName,
  isSubCustomer,
  padOrgNumber,
  combinedSimilarity,
} from '../lib/fuzzy-match'

// Matching result for a single organization
export interface CustomerMatchResult {
  atekOrganization: NormalizedOrganization
  qbCustomer: QBCustomer | null
  confidenceScore: number
  matchingMethod: 'org_num_exact' | 'name_fuzzy' | 'no_match'
  confidenceFactors: {
    orgNumMatch: boolean
    orgNumScore: number
    nameScore: number
    isSubCustomer: boolean
  }
  allCandidates: Array<{
    qbCustomerId: string
    qbDisplayName: string
    score: number
  }>
}

// Algorithm configuration
const ALGORITHM_VERSION = '1.0.0'

// Confidence score thresholds
const THRESHOLDS = {
  ORG_NUM_MATCH_BASE: 0.9, // 90% base score for org_num match
  NAME_BONUS_HIGH: 0.1, // +10% for name similarity > 80%
  NAME_BONUS_MED: 0.05, // +5% for name similarity 50-80%
  FUZZY_ONLY_HIGH: 0.7, // 70% for name-only match > 85%
  FUZZY_ONLY_MED: 0.5, // 50% for name-only match 60-85%
  AUTO_APPROVE_THRESHOLD: 0.95, // Auto-approve if >= 95%
  NEEDS_REVIEW_THRESHOLD: 0.7, // Needs review if < 70%
}

/**
 * Run the matching algorithm for all ATEK organizations
 * Creates one mapping per (organization, manager) pair
 */
export async function runCustomerMatching(): Promise<{
  totalOrganizations: number
  totalMappings: number
  matched: number
  unmatched: number
  needsReview: number
  results: CustomerMatchResult[]
}> {
  const startTime = Date.now()

  // Fetch all data - only get ATEK organizations tagged as "customer"
  const [atekOrgs, qbCustomers, managersByOrg] = await Promise.all([
    listOrganizations({ activeOnly: true, customerOnly: true }),
    listCustomers({ activeOnly: true }),
    getContractualManagersByOrganization(),
  ])

  // Build QB customer lookup by org number
  const qbByOrgNum = new Map<string, QBCustomer[]>()
  for (const customer of qbCustomers) {
    const orgNum = extractOrgNumber(customer.DisplayName)
    if (orgNum) {
      const existing = qbByOrgNum.get(orgNum) || []
      existing.push(customer)
      qbByOrgNum.set(orgNum, existing)
    }
  }

  const results: CustomerMatchResult[] = []
  let matched = 0
  let unmatched = 0
  let needsReview = 0
  let totalMappings = 0

  // Match each ATEK organization
  for (const org of atekOrgs) {
    const result = matchOrganization(org, qbCustomers, qbByOrgNum)
    results.push(result)

    // Get managers for this organization
    const managers = managersByOrg[org.id] || []

    // If no managers, create one mapping with empty manager
    if (managers.length === 0) {
      totalMappings++
      if (result.qbCustomer) {
        matched++
        if (result.confidenceScore < THRESHOLDS.NEEDS_REVIEW_THRESHOLD) {
          needsReview++
        }
      } else {
        unmatched++
      }
      await logMatchingAttempt(org, result, startTime)
      await storeMapping(org, result, null)
    } else {
      // Create one mapping per manager
      for (const manager of managers) {
        totalMappings++
        if (result.qbCustomer) {
          matched++
          if (result.confidenceScore < THRESHOLDS.NEEDS_REVIEW_THRESHOLD) {
            needsReview++
          }
        } else {
          unmatched++
        }
        await storeMapping(org, result, manager)
      }
      // Only log once per org
      await logMatchingAttempt(org, result, startTime)
    }
  }

  return {
    totalOrganizations: atekOrgs.length,
    totalMappings,
    matched,
    unmatched,
    needsReview,
    results,
  }
}

/**
 * Match a single organization to QB customers
 */
function matchOrganization(
  org: NormalizedOrganization,
  allQbCustomers: QBCustomer[],
  qbByOrgNum: Map<string, QBCustomer[]>
): CustomerMatchResult {
  const orgNum = padOrgNumber(org.orgNumber)
  const candidates: Array<{ customer: QBCustomer; score: number; factors: any }> = []

  // Strategy 1: Match by org_num (primary)
  if (orgNum) {
    const orgNumMatches = qbByOrgNum.get(orgNum) || []

    for (const customer of orgNumMatches) {
      // Skip sub-customers for primary matching (they inherit from parent)
      if (isSubCustomer(customer.DisplayName)) continue

      const qbName = extractNameFromDisplayName(customer.DisplayName)
      const nameScore = combinedSimilarity(org.name, qbName)

      // Calculate confidence score
      let score = THRESHOLDS.ORG_NUM_MATCH_BASE
      if (nameScore > 0.8) {
        score += THRESHOLDS.NAME_BONUS_HIGH
      } else if (nameScore > 0.5) {
        score += THRESHOLDS.NAME_BONUS_MED
      }

      candidates.push({
        customer,
        score: Math.min(score, 1), // Cap at 100%
        factors: {
          orgNumMatch: true,
          orgNumScore: 1,
          nameScore,
          isSubCustomer: false,
        },
      })
    }
  }

  // Strategy 2: Fuzzy name matching (fallback)
  if (candidates.length === 0) {
    for (const customer of allQbCustomers) {
      // Skip sub-customers
      if (isSubCustomer(customer.DisplayName)) continue

      const qbName = extractNameFromDisplayName(customer.DisplayName)
      const nameScore = combinedSimilarity(org.name, qbName)

      // Only consider if name similarity is decent
      if (nameScore > 0.6) {
        let score: number
        if (nameScore > 0.85) {
          score = THRESHOLDS.FUZZY_ONLY_HIGH
        } else {
          score = THRESHOLDS.FUZZY_ONLY_MED
        }

        candidates.push({
          customer,
          score: score * nameScore, // Scale by name match quality
          factors: {
            orgNumMatch: false,
            orgNumScore: 0,
            nameScore,
            isSubCustomer: false,
          },
        })
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score)

  // Build result
  const bestMatch = candidates[0]

  return {
    atekOrganization: org,
    qbCustomer: bestMatch?.customer || null,
    confidenceScore: bestMatch?.score || 0,
    matchingMethod: bestMatch
      ? bestMatch.factors.orgNumMatch
        ? 'org_num_exact'
        : 'name_fuzzy'
      : 'no_match',
    confidenceFactors: bestMatch?.factors || {
      orgNumMatch: false,
      orgNumScore: 0,
      nameScore: 0,
      isSubCustomer: false,
    },
    allCandidates: candidates.slice(0, 5).map((c) => ({
      qbCustomerId: c.customer.Id,
      qbDisplayName: c.customer.DisplayName,
      score: c.score,
    })),
  }
}

/**
 * Store or update a customer mapping in the database
 * Each (org, manager) pair gets its own mapping
 */
async function storeMapping(
  org: NormalizedOrganization,
  result: CustomerMatchResult,
  manager: { id: string; name: string; email: string } | null
) {
  const managerId = manager?.id || ''

  // Find existing mapping by (orgId + managerId)
  const existing = await db.query.customerMapping.findFirst({
    where: and(
      eq(customerMapping.atekOrganizationId, org.id),
      eq(customerMapping.atekContractualManagerId, managerId)
    ),
  })

  const mappingData = {
    atekOrganizationId: org.id,
    atekOrganizationName: org.name,
    atekContractualManagerId: managerId,
    atekContractualManagerName: manager?.name || null,
    atekContractualManagerEmail: manager?.email || null,
    quickbooksCustomerId: result.qbCustomer?.Id || null,
    quickbooksCustomerName: result.qbCustomer?.DisplayName || null,
    quickbooksCustomerEmail: result.qbCustomer?.PrimaryEmailAddr?.Address || null,
    mappingStatus: determineMappingStatus(result) as 'proposed' | 'approved' | 'rejected' | 'needs_review',
    confidenceScore: result.confidenceScore,
    confidenceFactors: JSON.stringify(result.confidenceFactors),
    matchingMethod: result.matchingMethod === 'org_num_exact' ? 'email_exact' : 'name_fuzzy' as const,
    emailMatchScore: 0, // Not used in this algorithm
    nameMatchScore: result.confidenceFactors.nameScore,
    addressMatchScore: 0, // Not used in this algorithm
    requiresManualReview: result.confidenceScore < THRESHOLDS.NEEDS_REVIEW_THRESHOLD,
    lastModifiedDate: new Date().toISOString(),
  }

  if (existing) {
    // Only update if not already approved/rejected
    if (existing.mappingStatus === 'proposed' || existing.mappingStatus === 'needs_review') {
      await db
        .update(customerMapping)
        .set(mappingData)
        .where(eq(customerMapping.mappingId, existing.mappingId))
    }
  } else {
    await db.insert(customerMapping).values({
      ...mappingData,
      createdDate: new Date().toISOString(),
    })
  }
}

/**
 * Determine mapping status based on confidence score
 */
function determineMappingStatus(result: CustomerMatchResult): string {
  if (!result.qbCustomer) return 'needs_review'
  if (result.confidenceScore >= THRESHOLDS.AUTO_APPROVE_THRESHOLD) return 'proposed' // High confidence, ready for bulk approve
  if (result.confidenceScore >= THRESHOLDS.NEEDS_REVIEW_THRESHOLD) return 'proposed'
  return 'needs_review'
}

/**
 * Log matching attempt for audit trail
 */
async function logMatchingAttempt(
  org: NormalizedOrganization,
  result: CustomerMatchResult,
  startTime: number
) {
  await db.insert(matchingAlgorithmLog).values({
    entityType: 'customer',
    atekEntityId: org.id,
    algorithmVersion: ALGORITHM_VERSION,
    executionDate: new Date().toISOString(),
    totalCandidates: result.allCandidates.length,
    bestMatchId: result.qbCustomer?.Id || null,
    bestMatchScore: result.confidenceScore,
    allCandidates: JSON.stringify(result.allCandidates),
    matchingCriteriaUsed: JSON.stringify({
      method: result.matchingMethod,
      factors: result.confidenceFactors,
    }),
    executionTimeMs: Date.now() - startTime,
  })
}

/**
 * Get all customer mappings with their status
 * Fetches actual manager names from invoice data (not stored mapping data)
 */
export async function getCustomerMappings(options?: {
  status?: 'proposed' | 'approved' | 'rejected' | 'needs_review'
  limit?: number
  offset?: number
}) {
  const { status, limit = 100, offset = 0 } = options || {}

  let query = db.select().from(customerMapping)

  if (status) {
    query = query.where(eq(customerMapping.mappingStatus, status)) as any
  }

  const results = await query.limit(limit).offset(offset)

  // Extract unique manager IDs from results and fetch only those users
  const uniqueManagerIds = [...new Set(
    results
      .map((r) => r.atekContractualManagerId)
      .filter((id): id is string => id !== null && id !== undefined)
  )]
  const managers = await getUsersByIds(uniqueManagerIds)
  const managerMap = new Map(managers.map((m) => [m.id, m]))

  return results.map((r) => {
    // Use actual manager data from ATEK if available
    const actualManager = r.atekContractualManagerId
      ? managerMap.get(r.atekContractualManagerId)
      : null

    return {
      ...r,
      // Override with actual manager data (keep stored data as fallback)
      atekContractualManagerName: actualManager?.name || r.atekContractualManagerName,
      atekContractualManagerEmail: actualManager?.email || r.atekContractualManagerEmail,
      confidenceFactors: r.confidenceFactors ? JSON.parse(r.confidenceFactors) : null,
    }
  })
}

/**
 * Approve a customer mapping
 */
export async function approveMapping(mappingId: number, approvedBy: string) {
  await db
    .update(customerMapping)
    .set({
      mappingStatus: 'approved',
      approvedBy,
      approvedDate: new Date().toISOString(),
      lastModifiedDate: new Date().toISOString(),
    })
    .where(eq(customerMapping.mappingId, mappingId))
}

/**
 * Reject a customer mapping
 */
export async function rejectMapping(mappingId: number, reviewNotes?: string) {
  await db
    .update(customerMapping)
    .set({
      mappingStatus: 'rejected',
      reviewNotes,
      lastModifiedDate: new Date().toISOString(),
    })
    .where(eq(customerMapping.mappingId, mappingId))
}

/**
 * Create a manual mapping
 */
export async function createManualMapping(
  atekOrgId: string,
  qbCustomerId: string,
  approvedBy: string
) {
  // Get org and customer details
  const [orgs, customers] = await Promise.all([
    listOrganizations({ activeOnly: false }),
    listCustomers({ activeOnly: false }),
  ])

  const org = orgs.find((o) => o.id === atekOrgId)
  const customer = customers.find((c) => c.Id === qbCustomerId)

  if (!org) throw new Error('ATEK organization not found')
  if (!customer) throw new Error('QuickBooks customer not found')

  // Check for existing mapping
  const existing = await db.query.customerMapping.findFirst({
    where: eq(customerMapping.atekOrganizationId, atekOrgId),
  })

  const mappingData = {
    atekOrganizationId: org.id,
    atekOrganizationName: org.name,
    atekContractualManagerId: '',
    quickbooksCustomerId: customer.Id,
    quickbooksCustomerName: customer.DisplayName,
    quickbooksCustomerEmail: customer.PrimaryEmailAddr?.Address || null,
    mappingStatus: 'approved' as const,
    confidenceScore: 1.0, // Manual = 100%
    matchingMethod: 'manual' as const,
    emailMatchScore: 0,
    nameMatchScore: 0,
    addressMatchScore: 0,
    requiresManualReview: false,
    approvedBy,
    approvedDate: new Date().toISOString(),
    lastModifiedDate: new Date().toISOString(),
  }

  if (existing) {
    await db
      .update(customerMapping)
      .set(mappingData)
      .where(eq(customerMapping.mappingId, existing.mappingId))
    return existing.mappingId
  } else {
    const result = await db.insert(customerMapping).values({
      ...mappingData,
      createdDate: new Date().toISOString(),
    })
    return result.lastInsertRowid
  }
}

/**
 * Clear unapproved mappings only (preserves approved/rejected)
 */
export async function clearAllMappings() {
  // Only delete mappings that are NOT approved or rejected (preserve locked ones)
  await db.delete(customerMapping).where(
    and(
      eq(customerMapping.mappingStatus, 'proposed'),
    )
  )
  await db.delete(customerMapping).where(
    and(
      eq(customerMapping.mappingStatus, 'needs_review'),
    )
  )
  await db.delete(matchingAlgorithmLog).where(eq(matchingAlgorithmLog.entityType, 'customer'))
  return { success: true }
}

/**
 * Force clear ALL mappings including approved (use with caution)
 */
export async function forceDeleteAllMappings() {
  await db.delete(customerMapping)
  await db.delete(matchingAlgorithmLog).where(eq(matchingAlgorithmLog.entityType, 'customer'))
  return { success: true }
}

/**
 * Update the QB customer for a mapping
 */
export async function updateMappingQbCustomer(
  mappingId: number,
  qbCustomerId: string,
  qbCustomerName: string
) {
  await db
    .update(customerMapping)
    .set({
      quickbooksCustomerId: qbCustomerId,
      quickbooksCustomerName: qbCustomerName,
      matchingMethod: 'manual',
      confidenceScore: 1.0,
      lastModifiedDate: new Date().toISOString(),
    })
    .where(eq(customerMapping.mappingId, mappingId))
}

/**
 * Get mapping statistics
 */
export async function getMappingStats() {
  const all = await db.select().from(customerMapping)

  const stats = {
    total: all.length,
    proposed: all.filter((m) => m.mappingStatus === 'proposed').length,
    approved: all.filter((m) => m.mappingStatus === 'approved').length,
    rejected: all.filter((m) => m.mappingStatus === 'rejected').length,
    needsReview: all.filter((m) => m.mappingStatus === 'needs_review').length,
    avgConfidence: all.length > 0
      ? all.reduce((sum, m) => sum + (m.confidenceScore || 0), 0) / all.length
      : 0,
    highConfidence: all.filter((m) => (m.confidenceScore || 0) >= 0.95).length,
    lowConfidence: all.filter((m) => (m.confidenceScore || 0) < 0.7).length,
  }

  return stats
}
