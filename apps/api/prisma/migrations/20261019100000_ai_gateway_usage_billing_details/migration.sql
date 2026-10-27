-- Keep original counters and usage receipts. Legacy NULL carries no cache
-- breakdown; no historical dimensions or charges are inferred or rewritten.
ALTER TABLE `ai_gateway_accounting_receipts`
  ADD COLUMN `usageDetails` JSON NULL;
