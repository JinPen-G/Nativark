-- F05: migrate unambiguous legacy corporate fields into the structured profile.
-- Duplicate, blank, or malformed legacy codes are intentionally skipped. Their
-- original CustomerProfile rows remain untouched for manual reconciliation;
-- the structured table stores only valid 18-character unified social credit codes.
INSERT INTO `customer_corporate_profiles` (
  `id`, `tenantId`, `customerId`, `legalName`, `unifiedSocialCreditCode`,
  `unifiedSocialCreditCodeMasked`, `registeredAddress`, `legalRepName`,
  `legalRepPhoneMasked`, `industry`, `scale`, `status`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  c.`tenantId`,
  c.`id`,
  COALESCE(NULLIF(TRIM(c.`corporateName`), ''), NULLIF(TRIM(c.`name`), '')),
  UPPER(TRIM(c.`corporateTaxNo`)),
  CASE
    WHEN CHAR_LENGTH(TRIM(c.`corporateTaxNo`)) >= 8
      THEN CONCAT(LEFT(UPPER(TRIM(c.`corporateTaxNo`)), 3), '****', RIGHT(UPPER(TRIM(c.`corporateTaxNo`)), 4))
    ELSE '****'
  END,
  NULL, NULL, NULL, NULL, NULL,
  CASE WHEN m.`status` = 'active' THEN 'active' ELSE 'pending_review' END,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `customer_profiles` c
LEFT JOIN `customer_memberships` m
  ON m.`tenantId` = c.`tenantId` AND m.`customerId` = c.`id`
WHERE c.`customerType` = 'corporate'
  AND c.`corporateTaxNo` IS NOT NULL
  AND TRIM(c.`corporateTaxNo`) <> ''
  AND UPPER(TRIM(c.`corporateTaxNo`)) REGEXP '^[0-9A-HJ-NPQRTUWXY]{18}$'
  AND COALESCE(NULLIF(TRIM(c.`corporateName`), ''), NULLIF(TRIM(c.`name`), '')) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `customer_corporate_profiles` p
    WHERE p.`tenantId` = c.`tenantId` AND p.`customerId` = c.`id`
  )
  AND 1 = (
    SELECT COUNT(*) FROM `customer_profiles` duplicate_code
    WHERE duplicate_code.`tenantId` = c.`tenantId`
      AND duplicate_code.`customerType` = 'corporate'
      AND UPPER(TRIM(duplicate_code.`corporateTaxNo`)) = UPPER(TRIM(c.`corporateTaxNo`))
  )
  AND NOT EXISTS (
    SELECT 1 FROM `customer_corporate_profiles` existing_code
    WHERE existing_code.`tenantId` = c.`tenantId`
      AND UPPER(TRIM(existing_code.`unifiedSocialCreditCode`)) = UPPER(TRIM(c.`corporateTaxNo`))
  );
