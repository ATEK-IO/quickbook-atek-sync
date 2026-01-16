import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Customer Mapping Table
export const customerMapping = sqliteTable('customer_mapping', {
  mappingId: integer('mapping_id').primaryKey({ autoIncrement: true }),
  atekOrganizationId: text('atek_organization_id').notNull(),
  atekOrganizationName: text('atek_organization_name').notNull(),
  atekContractualManagerId: text('atek_contractual_manager_id').notNull(),
  atekContractualManagerName: text('atek_contractual_manager_name'),
  atekContractualManagerEmail: text('atek_contractual_manager_email'),
  quickbooksCustomerId: text('quickbooks_customer_id'),
  quickbooksCustomerName: text('quickbooks_customer_name'),
  quickbooksCustomerEmail: text('quickbooks_customer_email'),
  mappingStatus: text('mapping_status', {
    enum: ['proposed', 'approved', 'rejected', 'needs_review'],
  }).default('proposed'),
  confidenceScore: real('confidence_score'),
  confidenceFactors: text('confidence_factors'), // JSON array
  matchingMethod: text('matching_method', {
    enum: ['email_exact', 'name_fuzzy', 'address_match', 'manual'],
  }),
  emailMatchScore: real('email_match_score'),
  nameMatchScore: real('name_match_score'),
  addressMatchScore: real('address_match_score'),
  requiresManualReview: integer('requires_manual_review', { mode: 'boolean' }).default(false),
  reviewNotes: text('review_notes'),
  approvedBy: text('approved_by'),
  approvedDate: text('approved_date'),
  createdDate: text('created_date').default('CURRENT_TIMESTAMP'),
  lastModifiedDate: text('last_modified_date').default('CURRENT_TIMESTAMP'),
})

// SKU Mapping Table
export const skuMapping = sqliteTable('sku_mapping', {
  mappingId: integer('mapping_id').primaryKey({ autoIncrement: true }),
  atekSkuId: text('atek_sku_id').notNull(),
  atekSkuCode: text('atek_sku_code').notNull(),
  atekSkuName: text('atek_sku_name').notNull(),
  atekCategory: text('atek_category'),
  quickbooksItemId: text('quickbooks_item_id'),
  quickbooksItemName: text('quickbooks_item_name'),
  quickbooksItemType: text('quickbooks_item_type'),
  mappingStatus: text('mapping_status', {
    enum: ['proposed', 'approved', 'rejected', 'needs_creation'],
  }).default('proposed'),
  confidenceScore: real('confidence_score'),
  confidenceFactors: text('confidence_factors'), // JSON array
  matchingMethod: text('matching_method', {
    enum: ['code_exact', 'name_fuzzy', 'description_match', 'manual'],
  }),
  codeMatchScore: real('code_match_score'),
  nameMatchScore: real('name_match_score'),
  priceMatchScore: real('price_match_score'),
  requiresManualReview: integer('requires_manual_review', { mode: 'boolean' }).default(false),
  requiresQbCreation: integer('requires_qb_creation', { mode: 'boolean' }).default(false),
  proposedQbItemType: text('proposed_qb_item_type'),
  proposedQbIncomeAccount: text('proposed_qb_income_account'),
  proposedQbItemConfig: text('proposed_qb_item_config'), // JSON
  reviewNotes: text('review_notes'),
  approvedBy: text('approved_by'),
  approvedDate: text('approved_date'),
  createdDate: text('created_date').default('CURRENT_TIMESTAMP'),
  lastModifiedDate: text('last_modified_date').default('CURRENT_TIMESTAMP'),
})

// Invoice Validation Table
export const invoiceValidation = sqliteTable('invoice_validation', {
  validationId: integer('validation_id').primaryKey({ autoIncrement: true }),
  atekInvoiceId: text('atek_invoice_id').notNull(),
  atekInvoiceNumber: text('atek_invoice_number').notNull(),
  validationStatus: text('validation_status', {
    enum: ['pending', 'ready', 'blocked', 'synced'],
  }).default('pending'),
  customerMappingValidated: integer('customer_mapping_validated', { mode: 'boolean' }).default(
    false
  ),
  allSkusMapped: integer('all_skus_mapped', { mode: 'boolean' }).default(false),
  blockingIssues: text('blocking_issues'), // JSON array
  confidenceScore: real('confidence_score'),
  readyForSync: integer('ready_for_sync', { mode: 'boolean' }).default(false),
  syncApprovedBy: text('sync_approved_by'),
  syncApprovedDate: text('sync_approved_date'),
  quickbooksInvoiceId: text('quickbooks_invoice_id'),
  syncDate: text('sync_date'),
  validationNotes: text('validation_notes'),
  createdDate: text('created_date').default('CURRENT_TIMESTAMP'),
})

// Matching Algorithm Log
export const matchingAlgorithmLog = sqliteTable('matching_algorithm_log', {
  logId: integer('log_id').primaryKey({ autoIncrement: true }),
  entityType: text('entity_type', { enum: ['customer', 'sku', 'invoice'] }).notNull(),
  atekEntityId: text('atek_entity_id').notNull(),
  algorithmVersion: text('algorithm_version'),
  executionDate: text('execution_date').default('CURRENT_TIMESTAMP'),
  totalCandidates: integer('total_candidates'),
  bestMatchId: text('best_match_id'),
  bestMatchScore: real('best_match_score'),
  allCandidates: text('all_candidates'), // JSON array
  matchingCriteriaUsed: text('matching_criteria_used'), // JSON
  executionTimeMs: integer('execution_time_ms'),
  notes: text('notes'),
})

// QuickBooks OAuth Tokens
export const qbAuthTokens = sqliteTable('qb_auth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  realmId: text('realm_id').notNull().unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  accessTokenExpiresAt: text('access_token_expires_at').notNull(),
  refreshTokenExpiresAt: text('refresh_token_expires_at').notNull(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
})
