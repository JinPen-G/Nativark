/** Read the original Gateway money ledger. This port cannot record usage,
 * reserve money, attest a dispatch itself or query a provider. */
export interface BudgetEvidenceBinding {
  reservationId: string; requestId: string; runId: string; stepId: string; actionId: string; callId: string;
  actorId: string; scopeKey: string; sceneCode: string; configRevision: number; configurationHash: string; priceVersion: string;
}

export interface GatewayDispatchEvidenceSource {
  readDispatch(reservationId: string): Promise<BudgetEvidenceBinding & {
    state: 'not_dispatched' | 'dispatched' | 'unknown'; dispatchToken: string | null;
  }>;
}
