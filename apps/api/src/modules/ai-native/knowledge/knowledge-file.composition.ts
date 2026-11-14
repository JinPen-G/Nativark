import type { PrismaService } from '../../database/prisma.service';
import type { TenantIntegrationService } from '../../integrations/tenant-integration.service';
import { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import { TenantKnowledgeObjectReader } from '../../integrations/knowledge-object-reader';
import { composePrismaFormalHumanKnowledge, type PrismaFormalKnowledgeDependencies } from './prisma-formal-knowledge.composition';
import { PrismaKnowledgeActionPolicySource } from './prisma-knowledge-policy.source';
import { FormalKnowledgeAuthorizationAdapter } from './formal-knowledge-authorization.adapter';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { PrismaKnowledgeFileAccess } from './prisma-knowledge-file-access';
import { HumanKnowledgeUploadService } from './human-knowledge-upload.service';
import type { AiOriginalSceneKnowledgeOptions } from '../scenes/original-scene-knowledge';
import { KnowledgeError } from './knowledge-errors';
import { preferenceSchema } from './knowledge-validation';
import { HumanKnowledgeContentErasure } from '../privacy/knowledge-content-erasure';
import { createNativeModelEgressTransport } from '../model-egress.transport';

/** Server DI only. Never serialize these request-bound producers to clients. */
export const KNOWLEDGE_SCENE_OPTIONS = Symbol('KNOWLEDGE_SCENE_OPTIONS');
export type KnowledgeSceneOptionsFactory = (includePreferences: boolean,
  preferenceKinds?: AiOriginalSceneKnowledgeOptions['preferenceKinds']) => AiOriginalSceneKnowledgeOptions;

export type KnowledgeFileApplicationDependencies = Omit<PrismaFormalKnowledgeDependencies, 'fileRuntime' | 'policyDb' | 'db'> & {
  db: PrismaService;
  integrations: TenantIntegrationService;
  objectIO?: { transport: ConstructorParameters<typeof TenantKnowledgeObjectReader>[2]; egress: ConstructorParameters<typeof TenantKnowledgeObjectReader>[3] };
};

export function composeKnowledgeFileApplication(input: KnowledgeFileApplicationDependencies) {
  const session = new KnowledgeCurrentSession(input.auth, input.credentials, input.clock);
  const policies = new PrismaKnowledgeActionPolicySource(input.db, () => new Date(input.clock.now()));
  const authorization = session.bind(new FormalKnowledgeAuthorizationAdapter(input.auth, input.credentials, policies.knowledge,
    () => new Date(input.clock.now())));
  const objects = new TenantKnowledgeObjectReader(input.db, input.integrations, input.objectIO?.transport ?? createNativeModelEgressTransport(), input.objectIO?.egress);
  const access = new PrismaKnowledgeFileAccess(input.db, session, authorization, objects, input.operationLogs, input.integrations);
  const fileRuntime = new FileStorageRuntimeService(input.db, input.integrations, undefined, undefined, access);
  const { integrations: _integrations, objectIO: _objectIO, ...base } = input;
  // Feed the original scene consumer the SAME file runtime and exact policy
  // source as document management. Do not reconstruct a generic download
  // service or grant owner permission at the model-input boundary.
  const sceneKnowledge: KnowledgeSceneOptionsFactory = (includePreferences, preferenceKinds) => {
    if (typeof includePreferences !== 'boolean') throw new KnowledgeError('invalid_input');
    if (includePreferences && !base.memory) throw new KnowledgeError('unavailable');
    if (preferenceKinds !== undefined && (!includePreferences || !Array.isArray(preferenceKinds) || preferenceKinds.length < 1
      || preferenceKinds.length > 3 || new Set(preferenceKinds).size !== preferenceKinds.length
      || preferenceKinds.some(kind => !preferenceSchema.options.some(option => option.shape.kind.value === kind)))) {
      throw new KnowledgeError('invalid_input');
    }
    const { auth: _auth, credentials: _credentials, clock: _clock, policyManagement: _management, ...infrastructure } = base;
    return { ...infrastructure, policyDb: input.db, fileRuntime, includePreferences,
      ...(preferenceKinds ? { preferenceKinds: Object.freeze([...preferenceKinds]) } : {}) };
  };
  const services = composePrismaFormalHumanKnowledge({ ...base, policyDb: input.db, fileRuntime });
  return { ...services, erasure: new HumanKnowledgeContentErasure(services.management, input.db),
    uploads: new HumanKnowledgeUploadService(session, fileRuntime, access.repository), sceneKnowledge };
}
