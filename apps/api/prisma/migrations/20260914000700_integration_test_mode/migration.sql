ALTER TABLE `tenant_integration_configs`
    ADD COLUMN `lastTestMode` VARCHAR(20) NOT NULL DEFAULT 'none' AFTER `lastTestStatus`;
