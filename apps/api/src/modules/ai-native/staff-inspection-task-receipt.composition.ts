import { randomUUID } from 'node:crypto';
import { Module, type DynamicModule } from '@nestjs/common';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskCreationRepository } from './ai-task-creation.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { StaffInspectionRequestFactory } from './inspection-assist/inspection-assist.composition';
import { inspectionRecognitionMediaKind } from './inspection-assist/inspection-recognition.service';
import { inspectionId, inspectionTargetSchema } from './inspection-assist/inspection-assist.validation';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { originalIdentityHash } from './task-request/original-request.authority';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const referenceSchema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
  inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict();
const scene = z.object({ kind: z.enum(['image', 'audio']), code: inspectionId.max(128), version: inspectionId.max(64) }).strict();
export type StaffInspectionTaskReceiptDependencies = {
  db: Pick<PrismaClient, 'aiTask' | 'aiScope' | '$transaction'>;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  inspection: ConstructorParameters<typeof StaffInspectionRequestFactory>[0];
  clock?: () => Date;
};
export type StaffInspectionTaskReceiptOptions = { enabled: boolean; scenes: readonly z.infer<typeof scene>[] };
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Current resource/attachment authority -> original metadata receipt only.
 * Original creation provenance comes from the durable owned task, not today's
 * plan/profile/price. No candidate payload, execution grant or task creation.
 * An expired/changed draft still fails its original source validation; this
 * does not weaken file ACL or implement a historical inspection payload reader. */
export function composeStaffInspectionTaskReceiptReader(dependencies: StaffInspectionTaskReceiptDependencies,
  options: StaffInspectionTaskReceiptOptions) {
  const selected = freezeOriginalInput(z.object({ enabled: z.literal(true),
    scenes: z.array(scene).min(1).max(2).refine(rows => new Set(rows.map(row => row.kind)).size === rows.length) })
    .strict().parse(structuredClone(options)));
  if (dependencies.db !== dependencies.inspection.db || typeof dependencies.auth?.resolveAccessContext !== 'function') throw unavailable();
  const server = { ...dependencies, inspection: { ...dependencies.inspection } }, clock = server.clock ?? (() => new Date());
  return Object.freeze({
    async readCreation(request: { headers: { authorization?: unknown } }, value: unknown) {
      const parsed = referenceSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const reference = freezeOriginalInput(parsed.data);
      const token = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).safeParse(request?.headers?.authorization);
      if (!token.success) throw denied();
      const requestId = randomUUID(), credentials = { current: async () => ({ authorization: token.data,
        requestId, audience: 'staff' as const }) };
      return runWithRequestIdentity({}, async () => {
        const scopes = new AiScopeRepository(server.db, new AiTaskCurrentIdentityAuthority(server.auth, credentials, clock), clock);
        const inspection = new StaffInspectionRequestFactory(server.inspection).open({ headers: { authorization: token.data }, requestId });
        try {
          let originalBinding: string | undefined;
          const resolve = async () => {
            const before = await scopes.resolveCurrent(), context = before.context;
            if (before.scope.kind !== 'WORKSPACE' || context.audience !== 'staff' || context.actor.kind !== 'user') throw denied();
            if (!inspection.recognition) throw unavailable();
            // This reads/validates the original frozen metadata and current
            // evidence binding; it never calls media.resolve or opens bytes.
            const media = await inspection.recognition.gatewayMedia(reference);
            const kind = inspectionRecognitionMediaKind(media.input), configured = selected.scenes.find(row => row.kind === kind);
            if (!configured) throw unavailable();
            const creationKey = `inspection:${requestFingerprint({ scope: context.scope, actor: context.actor,
              audience: context.audience, draftId: reference.draftId, inputId: reference.inputId })}`;
            const access = aiTaskAccessFromContext(context, creationKey, clock());
            const row = structuredClone(await server.db.aiTask.findFirst({ where: { scopeId: before.scope.id,
              scope: { is: access.scope }, scopeKind: access.scope.kind, audience: access.audience,
              ownerKind: access.actorKind, ownerId: access.actorId, creationKey }, select: {
              id: true, scopeId: true, ownerKind: true, ownerId: true, audience: true, sceneCode: true, sceneVersion: true,
              creationKey: true, creationFingerprint: true, inputRef: true, inputRevision: true, inputHash: true, archivedAt: true } }));
            const after = await scopes.resolveCurrent();
            if (after.scope.id !== before.scope.id || originalIdentityHash(after.context) !== originalIdentityHash(context)) throw denied();
            if (!row) return { state: 'not_observed' as const, creationKey, context: after.context, configured,
              inputFingerprint: media.input.inputFingerprint };
            if (row.scopeId !== before.scope.id || row.ownerKind !== access.actorKind || row.ownerId !== access.actorId
              || row.audience !== access.audience || row.creationKey !== creationKey || row.sceneCode !== configured.code
              || row.sceneVersion !== configured.version || row.inputRef !== reference.inputId
              || row.inputRevision !== reference.expectedRevision || row.archivedAt !== null
              || !z.string().regex(/^[a-f0-9]{64}$/u).safeParse(row.inputHash).success
              || !z.string().regex(/^[a-f0-9]{64}$/u).safeParse(row.creationFingerprint).success) throw denied();
            const binding = requestFingerprint({ identity: originalIdentityHash(context), original: row,
              reference, frozen: media.input.inputFingerprint, kind });
            if (originalBinding !== undefined && originalBinding !== binding) throw denied();
            originalBinding = binding;
            return { state: 'observed' as const, creationKey, context: after.context, configured, row,
              inputFingerprint: media.input.inputFingerprint };
          };
          const original = await resolve();
          if (original.state !== 'observed') {
            const after = await resolve();
            if (after.state !== original.state || after.creationKey !== original.creationKey
              || after.inputFingerprint !== original.inputFingerprint) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
            return freezeOriginalInput({ state: 'not_observed' as const, creationKey: original.creationKey, task: null,
              execution: 'not_attested' as const, retryable: false as const, nextAction: 'read_original_task' as const });
          }
          const reader = AiTaskCreationRepository.receiptReader(server.db, { resolve: async (sceneCode, inputRef) => {
            const current = await resolve();
            if (current.state !== 'observed' || sceneCode !== current.configured.code || inputRef !== reference.inputId) throw denied();
            return { context: current.context, sceneCode, sceneVersion: current.configured.version,
              inputRef, inputRevision: reference.expectedRevision,
              inputHash: z.string().regex(/^[a-f0-9]{64}$/u).parse(current.row.inputHash) };
          } }, clock);
          const receipt = await reader.readCreation({ creationKey: original.creationKey,
            sceneCode: original.configured.code, inputRef: reference.inputId });
          return freezeOriginalInput({ ...receipt, execution: 'not_attested' as const,
            semantics: 'original_metadata_not_dispatch_or_candidate_evidence' as const });
        } finally { inspection.close(); }
      });
    }
  });
}

export const AI_STAFF_INSPECTION_TASK_RECEIPTS = Symbol('AI_STAFF_INSPECTION_TASK_RECEIPTS');
@Module({})
export class StaffInspectionTaskReceiptModule {
  static register(dependencies: StaffInspectionTaskReceiptDependencies, options?: StaffInspectionTaskReceiptOptions): DynamicModule {
    if (options?.enabled !== true) return { module: StaffInspectionTaskReceiptModule, providers: [], exports: [] };
    return { module: StaffInspectionTaskReceiptModule, providers: [{ provide: AI_STAFF_INSPECTION_TASK_RECEIPTS,
      useValue: composeStaffInspectionTaskReceiptReader(dependencies, options) }], exports: [AI_STAFF_INSPECTION_TASK_RECEIPTS] };
  }
}
