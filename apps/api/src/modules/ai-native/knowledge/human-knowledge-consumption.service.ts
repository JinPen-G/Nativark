import { z } from 'zod';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeInputService } from './human-knowledge-input.service';
import type { KnowledgeClock } from './knowledge.ports';
import { KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { id, parse } from './knowledge-validation';

const documentInput = z.object({
  documentId: id,
  previewLimit: z.number().int().min(1).max(10).optional(),
}).strict();

const memoryInput = z.object({ memoryId: id }).strict();

/**
 * A small, server-side consumption boundary for the already-authorized human
 * knowledge composition.  It deliberately delegates every read and mutation
 * to the existing facades; it does not accept an actor, scope, URL, policy
 * decision, confirmation id, or model text from its caller.
 *
 * This is a composition entry, not a second knowledge or memory state machine.
 * The returned values are bounded observations. They are not Core facts,
 * permissions, approval proofs, or a model dispatch authorization.
 */
export class HumanKnowledgeConsumptionService {
  constructor(
    private readonly management: HumanKnowledgeService,
    private readonly preparation: HumanKnowledgeInputService,
    private readonly clock: KnowledgeClock,
  ) {
    requiredPort(clock, ['now']);
  }

  /** Read current metadata and a separately re-authorized bounded preview. */
  async readDocument(value: unknown) {
    const input = parse(documentInput, value);
    const detail = await this.management.detail(input.documentId);
    const preview = await this.management.preview(input.documentId, input.previewLimit ?? 3);
    const now = this.clock.now();
    if (!Number.isFinite(now)) return unavailable();

    const body = preview.status === 'ready' && detail.publication !== 'withdrawn' && detail.publication !== 'deleted'
      ? 'current_readable' as const
      : 'unavailable' as const;
    const state = detail.publication === 'withdrawn' || detail.publication === 'deleted'
      ? 'withdrawn_or_deleted' as const
      : body === 'current_readable' ? 'current_readable' as const : 'metadata_only' as const;

    return {
      state,
      metadata: detail,
      body,
      preview,
      observedAt: new Date(now).toISOString(),
      bounded: true as const,
      truncated: preview.status === 'ready' ? preview.truncated : false,
      semantics: 'current_policy_rechecked_metadata_and_preview_not_business_fact' as const,
    };
  }

  /**
   * Re-open one previously collected source through the existing context
   * service. The context service performs current scope, version and ACL
   * checks; an old source object is never treated as a permanent grant.
   */
  openSource(source: unknown) {
    return this.preparation.openSource(source);
  }

  /** Read one current confirmed preference only when the formal memory policy
   * was supplied to the composition. Revoked/expired records remain metadata
   * only and never return a preference value.
   */
  async readMemory(value: unknown) {
    const { memoryId } = parse(memoryInput, value);
    const memory = this.preparation.memory;
    if (!memory) return unavailable();
    const state = await memory.state(memoryId);
    if (!state.usable) {
      return {
        status: state.consentStatus === 'revoked' ? 'revoked' as const : 'unavailable' as const,
        memory: { memoryId: state.memoryId, revision: state.revision, aclRevision: state.aclRevision,
          storageStatus: state.storageStatus, consentStatus: state.consentStatus, expiresAt: state.expiresAt },
        semantics: 'preference_not_available_without_current_confirmation' as const,
      };
    }
    const current = await memory.read(memoryId);
    if (current.status !== 'confirmed') return unavailable();
    const proof = await memory.confirmationDetail(memoryId);
    if (proof.status !== 'confirmed') return unavailable();
    return {
      status: 'ready' as const,
      memory: {
        memoryId: current.memoryId, revision: current.revision, aclRevision: current.aclRevision,
        expiresAt: current.expiresAt, preference: structuredClone(current.preference),
        confirmationRecordId: current.confirmationRecordId,
      },
      confirmation: {
        confirmationRecordId: proof.confirmationRecordId, revision: proof.revision,
        aclRevision: proof.aclRevision, scope: structuredClone(proof.scope), audience: proof.audience,
        confirmedAt: proof.confirmedAt, expiresAt: proof.expiresAt,
      },
      semantics: 'current_confirmed_preference_not_business_authority' as const,
    };
  }

  /** Bounded current preference selection; no implicit "all preferences" mode. */
  readPreferences(value: unknown) {
    const input = parse(z.object({ limit: z.number().int().min(1).max(10) }).strict(), value);
    if (!this.preparation.memory) return unavailable();
    return this.preparation.memory.confirmedPreferences(input);
  }

  /** Consent withdrawal is not physical memory deletion or business rollback. */
  async withdrawMemory(value: unknown) {
    const input = parse(z.object({ memoryId: id, expectedRevision: z.number().int().min(2).max(4294967294) }).strict(), value);
    const memory = this.preparation.memory;
    if (!memory) return unavailable();
    const proof = await memory.revoke(input);
    return {
      status: proof.status === 'revoked' ? 'revoked' as const : 'unknown' as const,
      memoryId: proof.memoryId, revision: proof.revision, aclRevision: proof.aclRevision,
      confirmationRecordId: proof.id, observedScope: structuredClone(proof.scope),
      semantics: 'consent_withdrawal_not_memory_delete_or_business_rollback' as const,
    };
  }

  /** Existing modify/delete path with its original operation id and CAS. */
  changeMemory(operationId: string, value: unknown) {
    if (!this.preparation.memory) throw new KnowledgeError('unavailable');
    return this.preparation.memory.change(operationId, value);
  }

  /** Receipt-only recovery. Missing receipts remain unknown; no blind retry. */
  recoverMemoryOperation(value: unknown) {
    if (!this.preparation.memory) throw new KnowledgeError('unavailable');
    return this.preparation.memory.operationRecovery(value);
  }

  /** The existing bounded knowledge + optional confirmed-preferences package. */
  collectInput(value: unknown, options: unknown = { includePreferences: false }) {
    return this.preparation.collect(value, options);
  }
}
