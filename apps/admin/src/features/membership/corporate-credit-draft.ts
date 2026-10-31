import type { CustomerCorporateCredit, SaveCustomerCreditRequest } from '@rental-os/shared';

/** A form's fields and revision share one read. A newer query is not a grant to
 * rebase touched input; only an explicit reload or an exact save response is. */
export interface CorporateCreditDraftBaseline {
  scope: string;
  customerId: string;
  revision: number | null;
}
export interface CorporateCreditDraftCommand {
  scope: string;
  customerId: string;
  input: SaveCustomerCreditRequest;
}

export function bindCorporateCreditDraft(scope: string, customerId: string, row: CustomerCorporateCredit | null): CorporateCreditDraftBaseline {
  if (!scope || !customerId || (row && (row.customerId !== customerId || !Number.isSafeInteger(row.revision) || row.revision < 1))) {
    throw new Error('资料已变更，请刷新后重新选择');
  }
  return { scope, customerId, revision: row?.revision ?? null };
}

export function corporateCreditDraftChanged(baseline: CorporateCreditDraftBaseline | undefined, row: CustomerCorporateCredit | null | undefined) {
  return Boolean(baseline && row !== undefined && (baseline.customerId !== (row?.customerId ?? baseline.customerId)
    || baseline.revision !== (row?.revision ?? null)));
}

export function prepareCorporateCreditDraft(baseline: CorporateCreditDraftBaseline | undefined,
  scope: string, customerId: string | undefined, values: SaveCustomerCreditRequest): CorporateCreditDraftCommand {
  if (!baseline || baseline.scope !== scope || baseline.customerId !== customerId) throw new Error('资料已变更，请刷新后重新选择');
  const { expectedRevision: _untrusted, ...input } = values;
  return { scope, customerId, input: { ...input, ...(baseline.revision !== null ? { expectedRevision: baseline.revision } : {}) } };
}
