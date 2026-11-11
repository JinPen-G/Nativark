/** Core financial read projections. Capability gaps stay explicit in the HTTP
 * contract, and order cash receipts remain separate from corporate allocations. */
import type { SchemaObject } from "../../contracts/openapi-document";

const text: SchemaObject = { type: "string", minLength: 1, maxLength: 191 };
const instant: SchemaObject = { type: "string", format: "date-time" };
const money: SchemaObject = { type: "number", minimum: 0, maximum: 9999999999.99 };
const delta: SchemaObject = { type: "number", minimum: -9999999999.99, maximum: 9999999999.99 };
const currency: SchemaObject = { type: "string", pattern: "^[A-Z]{3}$" };
const literal = (value: string): SchemaObject => ({ type: "string", enum: [value] });
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false
});
const unavailable = (reason: string) => object({ state: literal("unavailable"), reason: literal(reason) });
const statements = unavailable("formal_statement_provider_not_implemented");
const scope = {
  apiVersion: literal("v1"), corporateCustomerId: text,
  permissionRevision: { type: "string", minLength: 1 } as SchemaObject, observedAt: instant
};

export const ENTERPRISE_FINANCE_SCHEMAS = {
  RentalEnterpriseHistoryWorkspaceBasis: object({
    ...scope,
    source: literal("original_enterprise_order_subjects"),
    coverage: literal("current_trusted_workspace_only"),
    crossWorkspaceRead: unavailable("authoritative_enterprise_history_space_scope_not_connected"),
    workspaces: { type: "array", maxItems: 1, items: object({ workspaceId: text, workspaceCode: text, workspaceName: { type: "string", maxLength: 191 } }) }
  }),
  RentalEnterpriseCorporateFinancialProjection: object({
    ...scope,
    source: literal("original_tenant_corporate_credit_account"),
    credit: { oneOf: [
      object({ state: literal("available"), account: object({
        creditLimit: money, reservedAmount: money, receivableAmount: money, availableAmount: delta,
        currency: literal("CNY"), status: { type: "string", enum: ["active", "suspended", "revoked"] },
        billingCycle: { type: "string", enum: ["monthly", "semi_monthly", "per_order"] },
        settlementTermDays: { type: "integer", minimum: 0 }
      }) }),
      object({ state: literal("not_configured") }),
      object({ state: literal("unavailable"), reason: { type: "string", enum: [
        "original_account_source_not_connected", "original_account_configuration_missing_with_ledger",
        "authoritative_account_history_space_scope_not_connected"
      ] } })
    ] },
    maturities: unavailable("financially_determined_maturity_read_port_not_connected"),
    statements
  }),
  RentalEnterpriseOrderFinancialProjection: object({
    ...scope,
    workspaceId: text, orderId: text, currency, sourceOrderUpdatedAt: instant,
    source: literal("persisted_original_core_finance"),
    rentalCash: { oneOf: [
      object({ state: literal("available"), collected: money, refunded: money, netReceived: delta }),
      unavailable("unverified_original_cash_receipt")
    ] },
    corporatePaymentAllocated: money,
    receivableEntries: { type: "array", items: object({
      id: text, entryType: { type: "string", enum: ["reserve", "release", "settle", "payment_allocation", "allocation_reversal", "adjust"] },
      amount: money, reservedDelta: delta, receivableDelta: delta, occurredAt: instant
    }) },
    guarantee: unavailable("original_payer_or_provider_guarantee_read_port_not_connected"),
    statements
  })
} satisfies Record<string, SchemaObject>;
