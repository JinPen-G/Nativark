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

/** Server DI only. Never serialize these request-bound producers to clients. */
export const KNOWLEDGE_SCENE_OPTIONS = Symbol('KNOWLEDGE_SCENE_OPTIONS');
export type KnowledgeSceneOptionsFactory = (includePreferences: boolean) => AiOriginalSceneKnowledgeOptions;

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
  const objects = new TenantKnowledgeObjectReader(input.db, input.integrations, input.objectIO?.transport, input.objectIO?.egress);
  const access = new PrismaKnowledgeFileAccess(input.db, session, authorization, objects);
  const fileRuntime = new FileStorageRuntimeService(input.db, input.integrations, undefined, undefined, access);
  const { integrations: _integrations, objectIO: _objectIO, ...base } = input;
  // Feed the original scene consumer the SAME file runtime and exact policy
  // source as document management. Do not reconstruct a generic download
  // service or grant owner permission at the model-input boundary.
  const sceneKnowledge: KnowledgeSceneOptionsFactory = includePreferences => {
    if (typeof includePreferences !== 'boolean') throw new KnowledgeError('invalid_input');
    if (includePreferences && !base.memory) throw new KnowledgeError('unavailable');
    const { auth: _auth, credentials: _credentials, clock: _clock, ...infrastructure } = base;
    return { ...infrastructure, policyDb: input.db, fileRuntime, includePreferences };
  };
  return { ...composePrismaFormalHumanKnowledge({ ...base, policyDb: input.db, fileRuntime }),
    uploads: new HumanKnowledgeUploadService(session, fileRuntime, access.repository), sceneKnowledge };
}
