/** MCP transport names for the approved business scope, not a capability grant.
 * Original public codes stay unchanged; contract owners still supply current
 * schemas, readers, authorization, accounting and field release before publication. */
import { AI_TOOL_CODES } from "@rental-os/shared";
import type { AiRisk, AiToolCode } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";

/** Version of the transport mapping only, never an original schema or grant revision. */
export const MCP_CAPABILITY_MAPPING_VERSION = "rental-mcp-capability-map-1" as const;

// Risk labels follow AI Native R04/R05 and MCP R04/R07, not today's readiness.
const mappings = [
  { code: "rental.catalog.search", name: "rental_catalog_search", operation: "read", risk: "R0" },
  { code: "rental.availability.check", name: "rental_availability_check", operation: "read", risk: "R0" },
  // This maps only the trusted selector's result, not personal candidate lookup.
  { code: "membership.customer.resolve", name: "rental_customer_selection_read", operation: "read", risk: "R0" },
  { code: "rental.order.explain", name: "rental_order_explain", operation: "read", risk: "R0" },
  // The original quote operation persists a snapshot even though its code says preview.
  { code: "rental.quote.preview", name: "rental_quote_prepare", operation: "quote_save", risk: "R1" },
  { code: "rental.order.propose", name: "rental_order_propose", operation: "proposal_save", risk: "R1" },
  { code: "rental.order.commit", name: "rental_order_commit", operation: "approved_order_commit", risk: "R2" },
] as const satisfies readonly { code: AiToolCode; name: string; operation: string; risk: AiRisk }[];

export type McpBusinessCapabilityCode = typeof mappings[number]["code"];
export type McpBusinessReadCode = Extract<typeof mappings[number], { operation: "read" }>["code"];

/** Fixed transport inventory. Presence is not readiness, permission or publication. */
export const MCP_BUSINESS_CAPABILITIES = Object.freeze(mappings.map(mapping => {
  if (!AI_TOOL_CODES.includes(mapping.code)) throw new TypeError("Original business capability unavailable");
  return Object.freeze({ ...mapping, mappingVersion: MCP_CAPABILITY_MAPPING_VERSION });
}));

/** Bind a fixed read name to an original owner's explicit read contract.
 * @param code - one approved read code; no names or selectors come from the model.
 * @param binding - original closed schemas, description and effect-free reader.
 * @returns an inert read candidate requiring every original registry policy provider.
 * Unknown or side-effect codes throw; no Task, model, HTTP call or registration runs.
 */
export function createMappedBusinessRead(code: McpBusinessReadCode, binding: Omit<McpReadTool, "name">): McpReadTool {
  const mapping = MCP_BUSINESS_CAPABILITIES.find(candidate => candidate.code === code);
  if (!mapping || mapping.operation !== "read") throw new TypeError("Business capability is not a mapped read");
  return { name: mapping.name, description: binding.description,
    inputSchema: structuredClone(binding.inputSchema), outputSchema: structuredClone(binding.outputSchema),
    read: binding.read.bind(binding) };
}
