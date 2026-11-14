-- Original configuration-row revisions, not an aggregate readiness version.
-- The original Core writers must advance these counters in their own commit.
-- This forward migration alone does not enable AI producers or any policy.
ALTER TABLE `tenant_rental_profiles`
  ADD COLUMN `configurationRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD CONSTRAINT `tenant_profile_config_revision_check` CHECK (`configurationRevision` BETWEEN 1 AND 4294967294);

ALTER TABLE `rental_core_state_snapshots`
  ADD COLUMN `configurationRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD CONSTRAINT `core_snapshot_config_revision_check` CHECK (`configurationRevision` BETWEEN 1 AND 4294967294);

ALTER TABLE `rental_tenant_business_settings`
  ADD UNIQUE INDEX `rental_business_settings_scope_key` (`tenantId`, `workspaceId`);

ALTER TABLE `ai_business_failure_outbox`
  DROP CHECK `ai_failure_outbox_resource_check`,
  ADD COLUMN `fulfillmentOrderId` VARCHAR(191) NULL,
  ADD COLUMN `configurationKind` VARCHAR(24) NULL,
  ADD COLUMN `configurationId` VARCHAR(191) NULL,
  ADD COLUMN `configurationProfileTenantId` VARCHAR(191) NULL,
  ADD COLUMN `configurationSnapshotWorkspaceId` VARCHAR(191) NULL,
  ADD COLUMN `configurationSettingsWorkspaceId` VARCHAR(191) NULL,
  ADD COLUMN `sectionCode` VARCHAR(64) NULL,
  ADD COLUMN `dueAt` DATETIME(3) NULL,
  ADD COLUMN `locationId` VARCHAR(191) NULL,
  ADD COLUMN `sourceHash` CHAR(64) NULL,
  ADD COLUMN `sourcePolicyId` VARCHAR(191) NULL,
  ADD COLUMN `sourcePolicyRevision` INTEGER UNSIGNED NULL,
  ADD INDEX `ai_failure_outbox_fulfillment_idx` (`tenantId`, `workspaceId`, `fulfillmentOrderId`),
  ADD INDEX `ai_failure_outbox_config_idx` (`tenantId`, `workspaceId`, `configurationKind`, `configurationId`, `sectionCode`),
  ADD CONSTRAINT `ai_failure_outbox_fulfillment_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `fulfillmentOrderId`)
    REFERENCES `rental_orders` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_location_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `locationId`)
    REFERENCES `rental_fulfillment_locations` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_config_profile_fk` FOREIGN KEY (`configurationProfileTenantId`)
    REFERENCES `tenant_rental_profiles` (`tenantId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_config_snapshot_fk` FOREIGN KEY (`tenantId`, `configurationSnapshotWorkspaceId`)
    REFERENCES `rental_core_state_snapshots` (`tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_config_settings_fk` FOREIGN KEY (`tenantId`, `configurationSettingsWorkspaceId`)
    REFERENCES `rental_tenant_business_settings` (`tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_resource_check` CHECK (COALESCE((
    -- Old resources retain their original columns; new links are all absent.
    (
      `fulfillmentOrderId` IS NULL AND `configurationKind` IS NULL AND `configurationId` IS NULL
      AND `configurationProfileTenantId` IS NULL AND `configurationSnapshotWorkspaceId` IS NULL
      AND `configurationSettingsWorkspaceId` IS NULL AND `sectionCode` IS NULL
      AND `dueAt` IS NULL AND `locationId` IS NULL AND `sourceHash` IS NULL
      AND `sourcePolicyId` IS NULL AND `sourcePolicyRevision` IS NULL
      AND (
        (`eventType` = 'notification.failed' AND `notificationId` IS NOT NULL AND `refundId` IS NULL
          AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `failureCode` = 'delivery_failed')
        OR (`eventType` = 'refund.failed' AND `refundId` IS NOT NULL AND `notificationId` IS NULL
          AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'provider_failed')
        OR (`eventType` = 'inspection.return_exception' AND `inspectionId` IS NOT NULL
          AND `exceptionId` IS NOT NULL AND CHAR_LENGTH(`exceptionId`) > 0
          AND `notificationId` IS NULL AND `refundId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'review_pending')
      )
    )
    OR (
      `eventType` = 'fulfillment.resource_shortage' AND `failureCode` = 'resource_shortage'
      AND `notificationId` IS NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL
      AND `fulfillmentOrderId` IS NOT NULL AND `orderId` IS NOT NULL AND `orderId` = `fulfillmentOrderId`
      AND `dueAt` IS NOT NULL AND `dueAt` > `occurredAt` AND `locationId` IS NOT NULL
      AND `sourceHash` IS NOT NULL AND REGEXP_LIKE(`sourceHash`, '^[a-f0-9]{64}$', 'c')
      AND `sourcePolicyId` IS NOT NULL AND CHAR_LENGTH(`sourcePolicyId`) > 0
      AND `sourcePolicyRevision` IS NOT NULL AND `sourcePolicyRevision` BETWEEN 1 AND 4294967294
      AND `configurationKind` IS NULL AND `configurationId` IS NULL AND `configurationProfileTenantId` IS NULL
      AND `configurationSnapshotWorkspaceId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL AND `sectionCode` IS NULL
    )
    OR (
      `eventType` = 'opening.missing_configuration' AND `failureCode` = 'missing_configuration'
      AND `notificationId` IS NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL
      AND `orderId` IS NULL AND `fulfillmentOrderId` IS NULL AND `dueAt` IS NULL AND `locationId` IS NULL
      AND `sourcePolicyId` IS NULL AND `sourcePolicyRevision` IS NULL
      AND `configurationKind` IS NOT NULL AND `configurationId` IS NOT NULL AND CHAR_LENGTH(`configurationId`) > 0
      AND `sourceHash` IS NOT NULL AND REGEXP_LIKE(`sourceHash`, '^[a-f0-9]{64}$', 'c')
      AND `sectionCode` IS NOT NULL AND `sectionCode` IN (
        'workspace_profile', 'accounts_roles', 'fulfillment_network', 'business_rule', 'business_calendar',
        'item_groups', 'pricing_groups_rates', 'price_version', 'membership_base'
      )
      AND (
        (`configurationKind` = 'tenant_profile' AND `configurationProfileTenantId` IS NOT NULL
          AND `configurationProfileTenantId` = `tenantId` AND `configurationId` = `configurationProfileTenantId`
          AND `configurationSnapshotWorkspaceId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL)
        OR (`configurationKind` = 'core_snapshot' AND `configurationSnapshotWorkspaceId` IS NOT NULL
          AND `configurationSnapshotWorkspaceId` = `workspaceId` AND `configurationId` = `configurationSnapshotWorkspaceId`
          AND `configurationProfileTenantId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL)
        OR (`configurationKind` = 'business_settings' AND `configurationSettingsWorkspaceId` IS NOT NULL
          AND `configurationSettingsWorkspaceId` = `workspaceId` AND `configurationId` = `configurationSettingsWorkspaceId`
          AND `configurationProfileTenantId` IS NULL AND `configurationSnapshotWorkspaceId` IS NULL)
      )
    )
  ), FALSE));
