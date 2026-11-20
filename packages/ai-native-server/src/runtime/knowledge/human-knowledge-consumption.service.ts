import { z } from 'zod';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeInputService } from './human-knowledge-input.service';
import type { KnowledgeClock } from './knowledge.ports';
import { KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { fingerprint, id, parse } from './knowledge-validation';

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
    return this.management.session.run(async context => {
    const detail = await this.management.detail(input.documentId);
    const closed = detail.publication === 'withdrawn' || detail.publication === 'deleted';
    const preview = closed || detail.parsing !== 'parsed' || detail.permissions.read_body !== 'authorized'
      ? { status: 'unavailable' as const, sources: [] }
      : await this.management.preview(input.documentId, input.previewLimit ?? 3);
    const latest = await this.management.detail(input.documentId);
    if (fingerprint(latest) !== fingerprint(detail)) throw new KnowledgeError('conflict');
    if (preview.status === 'ready' && (preview.documentVersion !== detail.documentVersion
      || preview.aclRevision !== detail.aclRevision)) throw new KnowledgeError('conflict');
    // Revalidate the body action after the metadata waits as well. The old
    // preview remains an observation; never substitute newly fetched content.
    if (preview.status === 'ready') {
      const current = await this.management.preview(input.documentId, input.previewLimit ?? 3);
      if (fingerprint(current) !== fingerprint(preview)) throw new KnowledgeError('conflict');
    }
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
      scope: structuredClone(context.scope), audience: context.audience,
      observedAt: new Date(now).toISOString(),
      bounded: true as const,
      truncated: preview.status === 'ready' ? preview.truncated : false,
      semantics: 'current_policy_rechecked_metadata_and_preview_not_business_fact' as const,
    };
    });
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
    return this.management.session.run(async context => {
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
    if (proof.status !== 'confirmed' || proof.confirmationRecordId !== current.confirmationRecordId
      || proof.revision + 1 !== current.revision || proof.aclRevision !== current.aclRevision
      || fingerprint(proof.preference) !== fingerprint(current.preference)
      || fingerprint(proof.scope) !== fingerprint(current.scope) || proof.audience !== context.audience) return unavailable();
    const latest = await memory.read(memoryId);
    if (fingerprint(latest) !== fingerprint(current)) throw new KnowledgeError('conflict');
    const observedAt = this.clock.now();
    if (!Number.isFinite(observedAt) || Date.parse(proof.expiresAt) <= observedAt) return unavailable();
    return {
      status: 'ready' as const,
      observedAt: new Date(observedAt).toISOString(), scope: structuredClone(context.scope), audience: context.audience,
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
    });
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

  /** Mutation recovery verifies the original payload fingerprint as well as
   * owner/scope and revision. A generic receipt lookup cannot establish this. */
  recoverMemoryChange(operationId: string, value: unknown) {
    if (!this.preparation.memory) return unavailable();
    return this.preparation.memory.changeStatus(operationId, value);
  }

  /** The existing bounded knowledge + optional confirmed-preferences package. */
  collectInput(value: unknown, options: unknown = { includePreferences: false }) {
    return this.preparation.collect(value, options);
  }
  /** Reuse the exact collected material. Revocation or changed content requires
   * recollection; never substitute a fresh body under an old fingerprint. */
  revalidateInput(value: unknown) { return this.preparation.revalidate(value); }
}
