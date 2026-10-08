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
  return { ...composePrismaFormalHumanKnowledge({ ...base, policyDb: input.db, fileRuntime }),
    uploads: new HumanKnowledgeUploadService(session, fileRuntime, access.repository) };
}
