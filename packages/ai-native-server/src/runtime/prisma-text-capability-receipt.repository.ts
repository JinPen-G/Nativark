import { randomUUID } from 'node:crypto';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { PrismaClient } from '@prisma/client';
import { ModelGatewayError, modelReasoningEvidenceSchema, modelEmbeddingEvidenceSchema } from './model-gateway.ports';
import { PrismaProviderCapabilityEvidenceRepository, type ProviderCapabilityEvidenceTransactions } from './provider-capability.repository';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { withAiTaskTransaction } from './task-transaction-authority';
import { ProviderCapabilityService } from './provider-capability.service';
import type { GatewayInvocationObservation } from './unified-ai-gateway.ports';
import { capabilityProfileFingerprint } from './capability-verification';
import { checkedAccountingCall } from './budget/prisma-gateway-accounting-facts';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { isGatewayOrderExplainRequest } from './gateway-contract-validation';
import { probeUsageSchema, embeddingProbeUsageSchema, textDigest, textProbeDescriptorSchema,
  textProbeIntent, textProbeObservationSchema, textProbeCapability, textProbeMode, isPlatformProbeContext, TEXT_PROBE_TTL_MS,
  type TextProbeDescriptor, type TextProbeReceipt } from './text-capability-probe';

import { PrismaTextCapabilityEvidenceReader, type TextProbeEvidenceDatabase } from '../configuration/text-capability-evidence.reader';

export type TextProbeReceiptDb = TextProbeEvidenceDatabase & Pick<PrismaClient, '$executeRaw'>;
type Writer = Omit<TextProbeReceiptDb, '$transaction'>;

/** Writes remain on the original task/transaction host. Observations share the public reader. */
export class PrismaTextCapabilityReceiptRepository extends PrismaTextCapabilityEvidenceReader {
  constructor(private readonly writer: TextProbeReceiptDb, clock?: () => Date) { super(writer, clock); }
  async begin(value: TextProbeDescriptor): Promise<{ receipt: TextProbeReceipt; created: boolean }> {
    const descriptor = textProbeDescriptorSchema.parse(structuredClone(value)), descriptorHash = requestFingerprint(descriptor);
    const previous = await this.find(descriptor.scopeId, descriptor.command.operationId);
    if (previous) {
      if (previous.descriptorHash !== descriptorHash) throw new ModelGatewayError('CONFIG_INVALID');
      return { receipt: previous, created: false };
    }
    const id = randomUUID();
    const insert = async (db: Writer) => {
      await db.$executeRaw(prismaRuntime.sql`INSERT INTO ai_text_capability_receipts
        (id, scopeId, profileId, operationId, descriptor, descriptorHash, createdAt)
        VALUES (${id}, ${descriptor.scopeId}, ${descriptor.profileId}, ${descriptor.command.operationId}, ${JSON.stringify(descriptor)}, ${descriptorHash}, CURRENT_TIMESTAMP(3))`);
      const saved = await this.readFrom(db, id);
      if (!saved || saved.descriptorHash !== descriptorHash) throw new ModelGatewayError('ACCOUNTING_PENDING');
      return { receipt: saved, created: true };
    };
    return hasRentalBusinessTenantFence() ? this.writer.$transaction(tx =>
      withAiTaskTransaction(tx, { kind: 'step', stepId: descriptor.stepId }, () => insert(tx)),
      { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }) : insert(this.writer);
  }
  async observe(id: string, value: GatewayInvocationObservation, transport: 'node_https' | 'mock') {
    const input = structuredClone(value), call = checkedAccountingCall(input.call);
    const row = await this.read(id);
    // A stream observation must belong to an explicitly frozen stream challenge,
    // never upgrade the original text-echo-1 receipt or another invocation.
    if (!row || (textProbeMode(row.descriptor.command) === 'stream' ? input.delivery?.mode !== 'stream' : input.delivery?.mode === 'stream')
      || call.binding.scope.id !== row.descriptor.scopeId || call.binding.profileId !== row.descriptor.profileId
      || (isPlatformProbeContext(row.descriptor.context)
        ? call.binding.scope.kind !== 'PLATFORM' || 'tenantId' in call.context || 'workspaceId' in call.context
          || call.context.actorId !== row.descriptor.context.actorId
        : requestFingerprint(call.context) !== requestFingerprint(row.descriptor.context))
      || call.request.callId !== row.descriptor.callId || call.request.intentHash !== row.descriptor.intentHash
      || call.request.model !== row.descriptor.configuration.model || call.request.maxOutputTokens !== 32
      || capabilityProfileFingerprint(input.route.profile) !== row.descriptor.profileFingerprint
      || typeof input.result.text !== 'string' || input.result.text.length > 256) throw new ModelGatewayError('CONFIG_INVALID');
    const now = this.clock(), prepared = textProbeIntent(row.descriptor.command.operationId, row.descriptor.scopeId, textProbeCapability(row.descriptor.command));
    const usage = (textProbeCapability(row.descriptor.command) === 'embedding' ? embeddingProbeUsageSchema : probeUsageSchema).safeParse(input.result.usage);
    const reasoning = textProbeCapability(row.descriptor.command) === 'reasoning'
      ? modelReasoningEvidenceSchema.safeParse(input.result.reasoningEvidence) : undefined;
    const embedding = textProbeCapability(row.descriptor.command) === 'embedding'
      ? modelEmbeddingEvidenceSchema.safeParse(input.result.embeddingEvidence) : undefined;
    const embeddingInput = prepared.intent.messages.map(message => message.content.map(part => part.kind === 'text' ? part.text : '').join(''));
    let observedText = input.result.text, structuredMatched = (reasoning === undefined || reasoning.success
      && usage.success && reasoning.data.reasoningTokens <= usage.data.outputTokens)
      && (embedding === undefined || embedding.success && usage.success && embedding.data.inputHash === requestFingerprint(embeddingInput));
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
      ...(embedding?.success ? { embeddingEvidence: embedding.data } : {}),
      ...(reasoning?.success ? { reasoningEvidence: reasoning.data } : {}),
      ...(input.delivery?.mode === 'stream' ? { delivery: input.delivery } : {}) });
    await this.writer.$transaction(async tx => {
      if (!await this.original(tx, row, observation, false)) throw new ModelGatewayError('ACCOUNTING_PENDING');
      const hash = requestFingerprint(observation);
      const changed = await tx.$executeRaw(prismaRuntime.sql`UPDATE ai_text_capability_receipts SET observation = ${JSON.stringify(observation)}, observationHash = ${hash}
        WHERE id = ${row.id} AND descriptorHash = ${row.descriptorHash} AND observationHash IS NULL`);
      if (changed !== 1) throw new ModelGatewayError('ACCOUNTING_PENDING');
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
}

/** Shared by the probe producer and normal Gateway routing. Reading this
 * service never dispatches a probe; only the original text and explicit stream
 * and generated vision/audio pulse/strict JSON/controlled tool challenges are accepted.
 * Audio evidence proves the versioned bounded input challenge only, not speech
 * recognition accuracy or business approval. Missing original evidence stays closed. */
export function createPersistedTextCapabilityEvidence(db: TextProbeReceiptDb
  & ConstructorParameters<typeof PrismaProviderCapabilityEvidenceRepository>[0], clock: () => Date = () => new Date(),
  transactions?: ProviderCapabilityEvidenceTransactions) {
  return new ProviderCapabilityService(new PrismaProviderCapabilityEvidenceRepository(db, transactions),
    { liveEvidenceVerifier: new PrismaTextCapabilityReceiptRepository(db, clock) }, clock);
}
