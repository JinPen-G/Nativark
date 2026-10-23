import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ModelGatewayError } from './model-gateway.ports';
import { PrismaProviderCapabilityEvidenceRepository } from './provider-capability.repository';
import { ProviderCapabilityService } from './provider-capability.service';
import type { GatewayInvocationObservation } from './unified-ai-gateway.ports';
import type { AiLiveCapabilityEvidenceVerifier } from './capability-verification';
import type { RecordCapabilityEvidenceInput } from './provider-capability.ports';
import { capabilityProfileFingerprint, capabilityVerificationSchema } from './capability-verification';
import { checkedAccountingCall } from './budget/prisma-gateway-accounting-facts';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { isGatewayOrderExplainRequest } from './gateway-contract-validation';
import { matchesProbeProfile, probeUsageSchema, textDigest, textProbeDescriptorSchema, textProbeEvidenceHash,
  textProbeIntent, textProbeObservationSchema, textProbeCapability, textProbeMethod, textProbeMode, isPlatformProbeContext, TEXT_PROBE_TTL_MS,
  type TextProbeDescriptor, type TextProbeObservation, type TextProbeReceipt } from './text-capability-probe';

export type TextProbeReceiptDb = Pick<PrismaClient, '$transaction' | '$queryRaw' | '$executeRaw' | 'aiGatewayInvocation'
  | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission' | 'aiBudgetReservation' | 'aiBudgetLedgerEntry'>;
type Reader = Omit<TextProbeReceiptDb, '$transaction'>;
type StoredReceipt = { id: string; descriptor: unknown; descriptorHash: string; observation: unknown; observationHash: string | null };
const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) as unknown : value;
function receipt(row: StoredReceipt): TextProbeReceipt {
  const descriptor = textProbeDescriptorSchema.parse(decode(row.descriptor));
  const observation = row.observation == null ? null : textProbeObservationSchema.parse(decode(row.observation));
  if (row.descriptorHash !== requestFingerprint(descriptor)
    || (observation ? row.observationHash !== requestFingerprint(observation) : row.observationHash !== null)) throw new ModelGatewayError('CONFIG_INVALID');
  const prepared = textProbeIntent(descriptor.command.operationId, descriptor.scopeId, textProbeCapability(descriptor.command));
  if (descriptor.methodVersion !== textProbeMethod(descriptor.command) || descriptor.callId !== prepared.intent.requestId
    || descriptor.intentHash !== prepared.intentHash || descriptor.challengeHash !== prepared.challengeHash
    || descriptor.configurationHash !== requestFingerprint(descriptor.configuration)) throw new ModelGatewayError('CONFIG_INVALID');
  return { id: row.id, descriptor, descriptorHash: row.descriptorHash, observation, observationHash: row.observationHash };
}
export class PrismaTextCapabilityReceiptRepository implements AiLiveCapabilityEvidenceVerifier {
  constructor(private readonly db: TextProbeReceiptDb, private readonly clock: () => Date = () => new Date()) {}
  private async readFrom(db: Reader, id: string): Promise<TextProbeReceipt | null> {
    const rows = await db.$queryRaw<StoredReceipt[]>(Prisma.sql`SELECT id, descriptor, descriptorHash, observation, observationHash
      FROM ai_text_capability_receipts WHERE id = ${id}`);
    if (rows.length > 1) throw new ModelGatewayError('CONFIG_INVALID');
    return rows.length ? receipt(rows[0]) : null;
  }
  async read(id: string) { return this.readFrom(this.db, id); }
  async find(scopeId: string, operationId: string) {
    const rows = await this.db.$queryRaw<StoredReceipt[]>(Prisma.sql`SELECT id, descriptor, descriptorHash, observation, observationHash
      FROM ai_text_capability_receipts WHERE scopeId = ${scopeId} AND operationId = ${operationId}`);
    if (rows.length > 1) throw new ModelGatewayError('CONFIG_INVALID');
    return rows.length ? receipt(rows[0]) : null;
  }
  async begin(value: TextProbeDescriptor): Promise<{ receipt: TextProbeReceipt; created: boolean }> {
    const descriptor = textProbeDescriptorSchema.parse(structuredClone(value)), descriptorHash = requestFingerprint(descriptor);
    const previous = await this.find(descriptor.scopeId, descriptor.command.operationId);
    if (previous) {
      if (previous.descriptorHash !== descriptorHash) throw new ModelGatewayError('CONFIG_INVALID');
      return { receipt: previous, created: false };
    }
    const id = randomUUID();
    await this.db.$executeRaw(Prisma.sql`INSERT INTO ai_text_capability_receipts
      (id, scopeId, profileId, operationId, descriptor, descriptorHash, createdAt)
      VALUES (${id}, ${descriptor.scopeId}, ${descriptor.profileId}, ${descriptor.command.operationId}, ${JSON.stringify(descriptor)}, ${descriptorHash}, CURRENT_TIMESTAMP(3))`);
    const saved = await this.read(id);
    if (!saved || saved.descriptorHash !== descriptorHash) throw new ModelGatewayError('ACCOUNTING_PENDING');
    return { receipt: saved, created: true };
  }
  private async original(db: Reader, row: TextProbeReceipt, observation: TextProbeObservation, terminal: boolean) {
    const d = row.descriptor, o = observation;
    // Platform receipts assert platform-scoped accounting rows only. Until the
    // platform admission/accounting storage lands, this lookup legitimately
    // fails closed instead of borrowing a tenant attribution.
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
    if (!invocation || admission.tenantId !== expectTenantId || admission.workspaceId !== expectWorkspaceId
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
        || accounting.inputTokens !== BigInt(usage.inputTokens)
        || accounting.outputTokens !== BigInt(usage.outputTokens)) return null;
      const usageHash = requestFingerprint({ receiptId: accounting.id, invocationId: invocation.id, admissionId: admission.id,
        reservationId: reservation.id, dispatchToken: o.dispatchId, requestHash: o.requestHash, usage });
      if (accounting.usageHash !== usageHash) return null;
      const entries = await db.aiBudgetLedgerEntry.findMany({ where: { reservationId: reservation.id, scopeId: d.scopeId,
        scopeKind: expectScopeKind, kind: { in: ['settle', 'reconcile'] } }, take: 2 });
      if (entries.length !== 1) return null;
      const quantity = reservation.unitKind === 'tokens' && reservation.actualTokens === accounting.inputTokens! + accounting.outputTokens!
        ? { unit: 'tokens', value: Number(reservation.actualTokens) }
        : reservation.unitKind === 'calls' && reservation.actualCalls === 1 ? { unit: 'calls', value: 1 }
        : reservation.unitKind === 'money' && reservation.actualMoney !== null && reservation.moneyCurrency
          ? { unit: 'money', amount: reservation.actualMoney.toFixed(6), currency: reservation.moneyCurrency, scale: 6 } : null;
      if (!quantity || ('value' in quantity && !Number.isSafeInteger(quantity.value))
        || entries[0].evidenceHash !== requestFingerprint({ usageHash, priceVersion: invocation.priceVersion, quantity })) return null;
    } else if (admission.status !== 'admitted' || reservation.status !== 'reserved') return null;
    return { accounting, invocation, reservation, admission };
  }
  async observe(id: string, value: GatewayInvocationObservation, transport: 'node_https' | 'mock') {
    const input = structuredClone(value), call = checkedAccountingCall(input.call);
    const row = await this.read(id);
    // A stream observation must belong to an explicitly frozen stream challenge,
    // never upgrade the original text-echo-1 receipt or another invocation.
    if (!row || (textProbeMode(row.descriptor.command) === 'stream' ? input.delivery?.mode !== 'stream' : input.delivery?.mode === 'stream')
      || call.binding.scope.id !== row.descriptor.scopeId || call.binding.profileId !== row.descriptor.profileId
      || requestFingerprint(call.context) !== requestFingerprint(row.descriptor.context)
      || call.request.callId !== row.descriptor.callId || call.request.intentHash !== row.descriptor.intentHash
      || call.request.model !== row.descriptor.configuration.model || call.request.maxOutputTokens !== 32
      || capabilityProfileFingerprint(input.route.profile) !== row.descriptor.profileFingerprint
      || typeof input.result.text !== 'string' || input.result.text.length > 256) throw new ModelGatewayError('CONFIG_INVALID');
    const now = this.clock(), prepared = textProbeIntent(row.descriptor.command.operationId, row.descriptor.scopeId, textProbeCapability(row.descriptor.command));
    const usage = probeUsageSchema.safeParse(input.result.usage);
    let observedText = input.result.text, structuredMatched = true;
    if (textProbeCapability(row.descriptor.command) === 'tools') {
      const requests = input.result.toolRequests;
      structuredMatched = Array.isArray(requests) && requests.length === 1 && requests.every(isGatewayOrderExplainRequest)
        && requestFingerprint(requests) === requestFingerprint(JSON.parse(prepared.expected));
      if (structuredMatched && Array.isArray(requests)) observedText = JSON.stringify(requests);
    }
    if (textProbeCapability(row.descriptor.command) === 'structured_output') {
      const output = input.result.structuredOutput, token = (JSON.parse(prepared.expected) as { token: string }).token;
      let decoded: unknown;
      try { decoded = JSON.parse(input.result.text); } catch { decoded = null; }
      structuredMatched = !!output && typeof output === 'object' && !Array.isArray(output)
        && Object.keys(output).length === 1 && 'token' in output && output.token === token
        && requestFingerprint(decoded) === requestFingerprint(output);
      if (structuredMatched) observedText = JSON.stringify({ token });
    }
    const observation = textProbeObservationSchema.parse({ admissionId: call.binding.id, dispatchId: call.binding.dispatchId,
      requestHash: call.binding.requestHash, reservationId: input.reservationId, transport,
      responseHash: textDigest(observedText), matched: structuredMatched && observedText === prepared.expected
        && (input.delivery?.mode !== 'stream' || input.delivery.deltaHash === textDigest(prepared.expected)
          && input.delivery.deltaBytes === Buffer.byteLength(prepared.expected, 'utf8')
          && input.delivery.deltaCount > 0 && input.delivery.eventCount === input.delivery.deltaCount + 1),
      usage: usage.success ? usage.data : null, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TEXT_PROBE_TTL_MS).toISOString(),
      ...(input.delivery?.mode === 'stream' ? { delivery: input.delivery } : {}) });
    await this.db.$transaction(async tx => {
      if (!await this.original(tx, row, observation, false)) throw new ModelGatewayError('ACCOUNTING_PENDING');
      const hash = requestFingerprint(observation);
      const changed = await tx.$executeRaw(Prisma.sql`UPDATE ai_text_capability_receipts SET observation = ${JSON.stringify(observation)}, observationHash = ${hash}
        WHERE id = ${row.id} AND descriptorHash = ${row.descriptorHash} AND observationHash IS NULL`);
      if (changed !== 1) throw new ModelGatewayError('ACCOUNTING_PENDING');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
  async verify(input: RecordCapabilityEvidenceInput): Promise<boolean> {
    const proof = capabilityVerificationSchema.safeParse(input.details?.verification);
    if (!proof.success || proof.data.evidence !== 'live'
      || !['text', 'streaming', 'vision', 'audio', 'structured_output', 'tools'].includes(input.capability) || proof.data.capability !== input.capability || input.source !== 'connection_test'
      || typeof input.details?.receiptId !== 'string') return false;
    const row = await this.read(input.details.receiptId), now = this.clock();
    if (!row || !row.observation || !matchesProbeProfile(row.descriptor, input.profile)
      || input.capability !== textProbeCapability(row.descriptor.command)
      || proof.data.methodVersion !== textProbeMethod(row.descriptor.command)) return false;
    const o = row.observation;
    if (o.transport !== 'node_https' || !o.matched || !o.usage
      || proof.data.profileFingerprint !== row.descriptor.profileFingerprint
      || input.evidenceHash !== textProbeEvidenceHash(row) || input.checkedAt.toISOString() !== o.checkedAt
      || input.expiresAt?.toISOString() !== o.expiresAt || Date.parse(o.checkedAt) > now.getTime()
      || Date.parse(o.expiresAt) <= now.getTime() || Date.parse(o.expiresAt) - Date.parse(o.checkedAt) !== TEXT_PROBE_TTL_MS
      || o.responseHash !== textDigest(textProbeIntent(row.descriptor.command.operationId, row.descriptor.scopeId, textProbeCapability(row.descriptor.command)).expected)) return false;
    if (input.capability === 'streaming' && (!o.delivery || o.delivery.deltaCount < 1
      || o.delivery.eventCount !== o.delivery.deltaCount + 1 || o.delivery.deltaHash !== o.responseHash
      || o.delivery.deltaBytes !== Buffer.byteLength(textProbeIntent(row.descriptor.command.operationId,
        row.descriptor.scopeId, 'streaming').expected, 'utf8'))) return false;
    if (input.capability !== 'streaming' && o.delivery) return false;
    return this.db.$transaction(async tx => !!await this.original(tx, row, o, true), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000
    });
  }
}

/** Shared by the probe producer and normal Gateway routing. Reading this
 * service never dispatches a probe; only the original text and explicit stream
 * and generated vision/audio pulse/strict JSON/controlled tool challenges are accepted.
 * Audio evidence proves the versioned bounded input challenge only, not speech
 * recognition accuracy or business approval. Missing original evidence stays closed. */
export function createPersistedTextCapabilityEvidence(db: TextProbeReceiptDb
  & ConstructorParameters<typeof PrismaProviderCapabilityEvidenceRepository>[0], clock: () => Date = () => new Date()) {
  return new ProviderCapabilityService(new PrismaProviderCapabilityEvidenceRepository(db),
    { liveEvidenceVerifier: new PrismaTextCapabilityReceiptRepository(db, clock) }, clock);
}
