-- Restore the Prisma-default constraint names expected by schema.prisma.
-- This is an additive release migration, not an edit of an applied migration.
-- Target tables and referenced columns stay unchanged; no business rows move.
ALTER TABLE `customer_corporate_credit_ledger`
  DROP FOREIGN KEY `customer_credit_ledger_tenant_customer_fkey`,
  DROP FOREIGN KEY `customer_credit_ledger_tenant_fkey`,
  ADD CONSTRAINT `customer_corporate_credit_ledger_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `customer_corporate_credit_ledger_tenantId_customerId_fkey`
    FOREIGN KEY (`tenantId`,`customerId`) REFERENCES `customer_profiles` (`tenantId`,`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `rental_offline_payment_registrations`
  DROP FOREIGN KEY `rental_offline_payment_registrations_workspace_fkey`,
  ADD CONSTRAINT `rental_offline_payment_registrations_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
