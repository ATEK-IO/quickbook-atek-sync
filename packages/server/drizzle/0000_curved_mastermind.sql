CREATE TABLE `customer_mapping` (
	`mapping_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`atek_organization_id` text NOT NULL,
	`atek_organization_name` text NOT NULL,
	`atek_contractual_manager_id` text NOT NULL,
	`atek_contractual_manager_name` text,
	`atek_contractual_manager_email` text,
	`quickbooks_customer_id` text,
	`quickbooks_customer_name` text,
	`quickbooks_customer_email` text,
	`mapping_status` text DEFAULT 'proposed',
	`confidence_score` real,
	`confidence_factors` text,
	`matching_method` text,
	`email_match_score` real,
	`name_match_score` real,
	`address_match_score` real,
	`requires_manual_review` integer DEFAULT false,
	`review_notes` text,
	`approved_by` text,
	`approved_date` text,
	`created_date` text DEFAULT 'CURRENT_TIMESTAMP',
	`last_modified_date` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE TABLE `invoice_validation` (
	`validation_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`atek_invoice_id` text NOT NULL,
	`atek_invoice_number` text NOT NULL,
	`validation_status` text DEFAULT 'pending',
	`customer_mapping_validated` integer DEFAULT false,
	`all_skus_mapped` integer DEFAULT false,
	`blocking_issues` text,
	`confidence_score` real,
	`ready_for_sync` integer DEFAULT false,
	`sync_approved_by` text,
	`sync_approved_date` text,
	`quickbooks_invoice_id` text,
	`sync_date` text,
	`validation_notes` text,
	`created_date` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE TABLE `matching_algorithm_log` (
	`log_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`atek_entity_id` text NOT NULL,
	`algorithm_version` text,
	`execution_date` text DEFAULT 'CURRENT_TIMESTAMP',
	`total_candidates` integer,
	`best_match_id` text,
	`best_match_score` real,
	`all_candidates` text,
	`matching_criteria_used` text,
	`execution_time_ms` integer,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `qb_auth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`realm_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`access_token_expires_at` text NOT NULL,
	`refresh_token_expires_at` text NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP',
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qb_auth_tokens_realm_id_unique` ON `qb_auth_tokens` (`realm_id`);--> statement-breakpoint
CREATE TABLE `sku_mapping` (
	`mapping_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`atek_sku_id` text NOT NULL,
	`atek_sku_code` text NOT NULL,
	`atek_sku_name` text NOT NULL,
	`atek_category` text,
	`quickbooks_item_id` text,
	`quickbooks_item_name` text,
	`quickbooks_item_type` text,
	`mapping_status` text DEFAULT 'proposed',
	`confidence_score` real,
	`confidence_factors` text,
	`matching_method` text,
	`code_match_score` real,
	`name_match_score` real,
	`price_match_score` real,
	`requires_manual_review` integer DEFAULT false,
	`requires_qb_creation` integer DEFAULT false,
	`proposed_qb_item_type` text,
	`proposed_qb_income_account` text,
	`proposed_qb_item_config` text,
	`review_notes` text,
	`approved_by` text,
	`approved_date` text,
	`created_date` text DEFAULT 'CURRENT_TIMESTAMP',
	`last_modified_date` text DEFAULT 'CURRENT_TIMESTAMP'
);
