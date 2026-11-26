/** Reads the same immutable probe receipt and original financial facts used by Gateway admission. */
import type { PrismaClient } from '@prisma/client';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { ModelGatewayError, modelReasoningEvidenceSchema, modelEmbeddingEvidenceSchema, capabilityVerificationSchema,
  type AiLiveCapabilityEvidenceVerifier, type RecordCapabilityEvidenceInput } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { matchesProbeProfile, probeUsageSchema, embeddingProbeUsageSchema, textDigest, textProbeDescriptorSchema, textProbeEvidenceHash,
  textProbeIntent, textProbeObservationSchema, textProbeCapability, textProbeMethod, textProbeMode, hasObjectiveProbeMethod, isPlatformProbeContext, TEXT_PROBE_TTL_MS,
  type TextProbeObservation, type TextProbeReceipt } from '../runtime/text-capability-probe';

export type TextProbeEvidenceDatabase = Pick<PrismaClient, '$transaction' | '$queryRaw' | 'aiGatewayInvocation'
  | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission' | 'aiBudgetReservation' | 'aiBudgetLedgerEntry'>;
type Reader = Omit<TextProbeEvidenceDatabase, '$transaction'>;
type StoredReceipt = { id: string; descriptor: unknown; descriptorHash: string; observation: unknown; observationHash: string | null };
const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) as unknown : value;
function receipt(row: StoredReceipt): TextProbeReceipt {
  const descriptor = textProbeDescriptorSchema.parse(decode(row.descriptor));
  const observation = row.observation == null ? null : textProbeObservationSchema.parse(decode(row.observation));
  if (row.descriptorHash !== requestFingerprint(descriptor)
    || (observation ? row.observationHash !== requestFingerprint(observation) : row.observationHash !== null)) throw new ModelGatewayError('CONFIG_INVALID');
  if (observation?.usage && !(textProbeCapability(descriptor.command) === 'embedding' ? embeddingProbeUsageSchema : probeUsageSchema)
    .safeParse(observation.usage).success) throw new ModelGatewayError('CONFIG_INVALID');
  const prepared = textProbeIntent(descriptor.command.operationId, descriptor.scopeId, textProbeCapability(descriptor.command));
  if (descriptor.methodVersion !== textProbeMethod(descriptor.command, descriptor.configuration.protocol) || descriptor.callId !== prepared.intent.requestId
    || descriptor.intentHash !== prepared.intentHash || descriptor.challengeHash !== prepared.challengeHash
    || descriptor.configurationHash !== requestFingerprint(descriptor.configuration)) throw new ModelGatewayError('CONFIG_INVALID');
  return { id: row.id, descriptor, descriptorHash: row.descriptorHash, observation, observationHash: row.observationHash };
}
export class PrismaTextCapabilityEvidenceReader implements AiLiveCapabilityEvidenceVerifier {
  constructor(protected readonly db: TextProbeEvidenceDatabase, protected readonly clock: () => Date = () => new Date()) {}
  protected async readFrom(db: Reader, id: string): Promise<TextProbeReceipt | null> {
    const rows = await db.$queryRaw<StoredReceipt[]>(prismaRuntime.sql`SELECT id, descriptor, descriptorHash, observation, observationHash
      FROM ai_text_capability_receipts WHERE id = ${id}`);
    if (rows.length > 1) throw new ModelGatewayError('CONFIG_INVALID');
    return rows.length ? receipt(rows[0]) : null;
  }
  async read(id: string) { return this.readFrom(this.db, id); }
  async find(scopeId: string, operationId: string) {
    const rows = await this.db.$queryRaw<StoredReceipt[]>(prismaRuntime.sql`SELECT id, descriptor, descriptorHash, observation, observationHash
      FROM ai_text_capability_receipts WHERE scopeId = ${scopeId} AND operationId = ${operationId}`);
    if (rows.length > 1) throw new ModelGatewayError('CONFIG_INVALID');
    return rows.length ? receipt(rows[0]) : null;
  }
  protected async original(db: Reader, row: TextProbeReceipt, observation: TextProbeObservation, terminal: boolean) {
    const d = row.descriptor, o = observation;
    // Platform receipts require platform attribution on every original row;
    // nullable tenant columns alone cannot prove the row belongs to a platform call.
    const expectTenantId = isPlatformProbeContext(d.context) ? null : d.context.tenantId;
    const expectWorkspaceId = isPlatformProbeContext(d.context) ? null : d.context.workspaceId;
    const expectScopeKind = isPlatformProbeContext(d.context) ? 'PLATFORM' : 'WORKSPACE';
    const [admission, accounting, reservation] = await Promise.all([
      db.aiInvocationAdmission.findUnique({ where: { id: o.admissionId } }),
      db.aiGatewayAccountingReceipt.findUnique({ where: { reservationId: o.reservationId } }),
      db.aiBudgetReservation.findUnique({ where: { id: o.reservationId } })
    ]);
    if (!admission || !accounting || !reservation) return null;
    const invocation = await db.aiGatewayInvocation.findUnique({ where: { id: accounting.invocationId } });
    if (!invocation || admission.scopeKind !== expectScopeKind
      || admission.tenantId !== expectTenantId || admission.workspaceId !== expectWorkspaceId
      || admission.actorId !== d.context.actorId || admission.callId !== d.callId || admission.profileId !== d.profileId
      || admission.requestHash !== o.requestHash || admission.dispatchId !== o.dispatchId || admission.revokedAt
      || accounting.admissionId !== admission.id || accounting.scopeId !== d.scopeId || accounting.scopeKind !== expectScopeKind
      || accounting.tenantId !== expectTenantId || accounting.workspaceId !== expectWorkspaceId
      || accounting.dispatchToken !== o.dispatchId || accounting.requestHash !== o.requestHash || accounting.state !== 'dispatched'
      || invocation.scopeId !== d.scopeId || invocation.taskId !== accounting.taskId || invocation.actorId !== d.context.actorId
      || invocation.callId !== d.callId || invocation.intentHash !== d.intentHash || invocation.stepFingerprint !== requestFingerprint(d.command)
      || invocation.runId !== d.runId || invocation.stepId !== d.stepId || invocation.mode !== textProbeMode(d.command)
      || invocation.sceneCode !== 'ai.capability.text' || invocation.maxOutputTokens !== 32
      || invocation.configurationHash !== d.configurationHash || requestFingerprint(invocation.configuration) !== d.configurationHash
      || reservation.scopeId !== d.scopeId || reservation.scopeKind !== expectScopeKind
      || reservation.tenantId !== expectTenantId || reservation.workspaceId !== expectWorkspaceId
      || reservation.actorId !== d.context.actorId || reservation.callId !== d.callId || reservation.requestId !== d.callId
      || reservation.idempotencyKey !== d.callId || reservation.runId !== d.runId || reservation.stepId !== d.stepId
      || reservation.actionId !== invocation.actionId || reservation.sceneCode !== invocation.sceneCode
      || reservation.configRevision !== d.configuration.configRevision || reservation.configurationHash !== d.configurationHash
      || reservation.priceVersion !== invocation.priceVersion
      || reservation.dispatchState !== (terminal ? 'completed' : 'dispatched')) return null;
    if (terminal) {
      const usage = o.usage;
      if (!usage || admission.status !== 'completed' || !admission.completedAt || reservation.status !== 'settled'
        || reservation.billingMode !== d.configuration.serviceMode
        || accounting.inputTokens !== BigInt(usage.inputTokens)
        || accounting.outputTokens !== BigInt(usage.outputTokens)
        || requestFingerprint(accounting.usageDetails ?? null) !== requestFingerprint(usage.billingDetails ?? null)) return null;
      const usageHash = requestFingerprint({ receiptId: accounting.id, invocationId: invocation.id, admissionId: admission.id,
        reservationId: reservation.id, dispatchToken: o.dispatchId, requestHash: o.requestHash, usage });
      if (accounting.usageHash !== usageHash) return null;
      const entries = await db.aiBudgetLedgerEntry.findMany({ where: { reservationId: reservation.id, scopeId: d.scopeId,
        scopeKind: expectScopeKind, kind: { in: ['settle', 'reconcile'] } }, take: 2 });
      if (entries.length !== 1) return null;
      const event = entries[0];
      // A digest cannot replace the original settled quantity. Missing or
      // contradictory columns are not capability evidence, even with that hash.
      if (!['settle', 'reconcile'].includes(event.kind) || event.reservationId !== reservation.id
        || event.scopeId !== d.scopeId || event.scopeKind !== expectScopeKind || event.tenantId !== expectTenantId
        || event.outputTokens !== null || event.reason !== null) return null;
      let quantity;
      if (reservation.unitKind === 'tokens') {
        const tokens = reservation.actualTokens;
        if (tokens === null || tokens < 0n || tokens > BigInt(Number.MAX_SAFE_INTEGER)
          || tokens !== accounting.inputTokens! + accounting.outputTokens! || reservation.actualCalls !== null
          || reservation.actualMoney !== null || reservation.moneyCurrency !== null || event.inputTokens !== tokens
          || event.calls !== null || event.moneyAmount !== null || event.moneyCurrency !== null) return null;
        quantity = { unit: 'tokens', value: Number(tokens) };
      } else if (reservation.unitKind === 'calls') {
        if (reservation.actualCalls !== 1 || reservation.actualTokens !== null || reservation.actualMoney !== null
          || reservation.moneyCurrency !== null || event.calls !== 1 || event.inputTokens !== null
          || event.moneyAmount !== null || event.moneyCurrency !== null) return null;
        quantity = { unit: 'calls', value: 1 };
      } else if (reservation.unitKind === 'money') {
        const money = reservation.actualMoney;
        if (reservation.billingMode !== 'platform_managed' || !money || !money.isFinite() || money.isNegative()
          || money.decimalPlaces() > 6 || !/^[A-Z]{3}$/u.test(reservation.moneyCurrency ?? '')
          || reservation.actualTokens !== null || reservation.actualCalls !== null || !event.moneyAmount?.eq(money)
          || event.moneyCurrency !== reservation.moneyCurrency || event.inputTokens !== null || event.calls !== null) return null;
        quantity = { unit: 'money', amount: money.toFixed(6), currency: reservation.moneyCurrency!, scale: 6 };
      } else return null;
      if (event.evidenceHash !== requestFingerprint({ usageHash, priceVersion: invocation.priceVersion, quantity })) return null;
    } else if (admission.status !== 'admitted' || reservation.status !== 'reserved') return null;
    return { accounting, invocation, reservation, admission };
  }
  async verify(input: RecordCapabilityEvidenceInput): Promise<boolean> {
    const proof = capabilityVerificationSchema.safeParse(input.details?.verification);
    if (!proof.success || proof.data.evidence !== 'live'
      || !hasObjectiveProbeMethod(input.capability, input.profile.protocol) || !input.profile.allowedCapabilities.includes(input.capability)
      || proof.data.capability !== input.capability || input.source !== 'connection_test'
      || typeof input.details?.receiptId !== 'string') return false;
    const row = await this.read(input.details.receiptId), now = this.clock();
    if (!row || !row.observation || !matchesProbeProfile(row.descriptor, input.profile)
      || input.capability !== textProbeCapability(row.descriptor.command)
      || proof.data.methodVersion !== textProbeMethod(row.descriptor.command, input.profile.protocol)) return false;
    const o = row.observation;
    if (o.transport !== 'node_https' || !o.matched || !o.usage
      || proof.data.profileFingerprint !== row.descriptor.profileFingerprint
      || input.evidenceHash !== textProbeEvidenceHash(row) || input.checkedAt.toISOString() !== o.checkedAt
      || input.expiresAt?.toISOString() !== o.expiresAt || Date.parse(o.checkedAt) > now.getTime()
      || Date.parse(o.expiresAt) <= now.getTime() || Date.parse(o.expiresAt) - Date.parse(o.checkedAt) !== TEXT_PROBE_TTL_MS
      || o.responseHash !== textDigest(textProbeIntent(row.descriptor.command.operationId, row.descriptor.scopeId, textProbeCapability(row.descriptor.command)).expected)) return false;
    if (input.capability === 'embedding') {
      const evidence = modelEmbeddingEvidenceSchema.safeParse(o.embeddingEvidence);
      const prepared = textProbeIntent(row.descriptor.command.operationId, row.descriptor.scopeId, 'embedding');
      const originalInput = prepared.intent.messages.map(message => message.content.map(part => part.kind === 'text' ? part.text : '').join(''));
      if (!evidence.success || !embeddingProbeUsageSchema.safeParse(o.usage).success
        || evidence.data.inputHash !== requestFingerprint(originalInput)) return false;
    } else if (o.embeddingEvidence !== undefined) return false;
    if (input.capability === 'reasoning') {
      const reasoning = modelReasoningEvidenceSchema.safeParse(o.reasoningEvidence);
      if (!reasoning.success || reasoning.data.reasoningTokens > o.usage.outputTokens) return false;
    } else if (o.reasoningEvidence !== undefined) return false;
    if (input.capability === 'streaming' && (!o.delivery || o.delivery.deltaCount < 1
      || o.delivery.eventCount !== o.delivery.deltaCount + 1 || o.delivery.deltaHash !== o.responseHash
      || o.delivery.deltaBytes !== Buffer.byteLength(textProbeIntent(row.descriptor.command.operationId,
        row.descriptor.scopeId, 'streaming').expected, 'utf8'))) return false;
    if (input.capability !== 'streaming' && o.delivery) return false;
    return this.db.$transaction(async tx => !!await this.original(tx, row, o, true), {
      isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000
    });
  }
}
