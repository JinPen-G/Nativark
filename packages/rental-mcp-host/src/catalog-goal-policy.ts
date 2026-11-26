/** Rental's fixed initial catalog admission binding. Historical policy versions
 * remain on their original records; this supplies neither Auth nor a new goal. */
import type { OriginalCatalogGoalPolicy } from '@rental-os/mcp-server/prisma-mcp-catalog-goals' with { 'resolution-mode': 'import' };

export const ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION = 'catalog-admission-1';
export const RENTAL_MCP_CATALOG_GOAL_POLICY: OriginalCatalogGoalPolicy = Object.freeze({
  purpose: 'rental.catalog.search',
  initialPolicyVersion: ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION,
});
