import type { PrismaClient } from '@prisma/client';
import type { KnowledgeModulePorts } from './knowledge.module';
import { composeKnowledgeServices } from './knowledge.module';
import { PrismaKnowledgeRepository } from './prisma-knowledge.repository';
import { PrismaStructuredMemoryRepository } from './prisma-memory.repository';
import { PrismaKnowledgeReadAdapter } from './prisma-knowledge-read.adapter';
import { PrismaKnowledgeIndexAdapter } from './prisma-knowledge-index.adapter';
import { requiredPort } from './knowledge-errors';
import { PrismaKnowledgeSelectionAdapter } from './prisma-knowledge-selection.adapter';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import { HumanKnowledgeInputService, type HumanKnowledgeInputDependencies } from './human-knowledge-input.service';
import { FormalKnowledgeAuthorizationAdapter, FormalMemoryAuthorizationAdapter, type FormalKnowledgePolicySource, type FormalMemoryPolicySource } from './formal-knowledge-authorization.adapter';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import { FileStorageKnowledgeFileAdapter } from './file-storage-knowledge.adapter';
import type { MemoryPrismaClient } from './prisma-memory.repository';

export interface PersistentKnowledgeDependencies {
  db: Pick<PrismaClient, '$transaction' | 'aiKnowledgeDocument' | 'aiKnowledgeVersion' | 'aiKnowledgeChunk' | 'aiKnowledgeOperation' | 'aiStructuredMemory' | 'aiMemoryOperation' | 'aiHumanConfirmation'>;
  authorization: KnowledgeModulePorts['documents']['authorization'];
  memoryAuthorization: KnowledgeModulePorts['memory']['authorization'];
  files: KnowledgeModulePorts['documents']['files'];
  /** Omit for bounded workspace metadata selection with required current authorization. */
  selection?: KnowledgeModulePorts['selection'];
  /** Omit to use durable relational lexical readiness, not an external index. */
  index?: KnowledgeModulePorts['index'];
  gateway: KnowledgeModulePorts['gateway'];
  clock: KnowledgeModulePorts['documents']['clock'];
  cache: KnowledgeModulePorts['cache'];
  policy: KnowledgeModulePorts['policy'];
}

/** Explicit opt-in: KnowledgeModule.register(createPersistedKnowledgePorts(deps)).
 * There is no root registration, scheduler, file/ACL/confirmation producer or
 * synthetic default authorization. Internal lexical search is not vector search.
 */
export function createPersistedKnowledgePorts(input: PersistentKnowledgeDependencies): KnowledgeModulePorts {
  requiredPort(input?.authorization, ['authorize']); requiredPort(input?.memoryAuthorization, ['authorize']);
  requiredPort(input?.files, ['read']);
  if (input?.selection !== undefined) requiredPort(input.selection, ['select']);
  if (input?.index !== undefined) requiredPort(input.index, ['apply']);
  requiredPort(input?.gateway, ['invoke', 'stream']); requiredPort(input?.clock, ['now']);
  requiredPort(input?.db, ['$transaction']);
  for (const key of ['aiKnowledgeDocument', 'aiKnowledgeVersion', 'aiStructuredMemory', 'aiKnowledgeOperation', 'aiMemoryOperation'] as const) {
    requiredPort(input.db[key], ['findFirst', 'create']);
  }
  requiredPort(input.db.aiKnowledgeDocument, ['updateMany']); requiredPort(input.db.aiStructuredMemory, ['updateMany']);
  requiredPort(input.db.aiKnowledgeChunk, ['findFirst', 'findMany', 'create']); requiredPort(input.db.aiHumanConfirmation, ['findFirst']);
  const clock = () => new Date(input.clock.now());
  const repository = new PrismaKnowledgeRepository(input.db, clock);
  const memory = new PrismaStructuredMemoryRepository(input.db, clock);
  const reads = new PrismaKnowledgeReadAdapter(input.db, repository, input.authorization, input.clock);
  return { documents: { repository, authorization: input.authorization, files: input.files, clock: input.clock },
    memory: { repository: memory, confirmations: memory, authorization: input.memoryAuthorization, clock: input.clock },
    content: reads, search: reads, selection: input.selection ?? new PrismaKnowledgeSelectionAdapter(input.db, repository, input.authorization), index: input.index ?? new PrismaKnowledgeIndexAdapter(input.db, input.authorization), gateway: input.gateway, cache: input.cache, policy: input.policy };
}

export function composePersistedKnowledge(input: PersistentKnowledgeDependencies) {
  return composeKnowledgeServices(createPersistedKnowledgePorts(input));
}

/** Human-session opt-in composition, independent of model dispatch. Missing
 * files disable parsing, missing memory policy disables preference inclusion.
 * Knowledge action authorization is mandatory even for metadata operations.
 */
export function composePersistedHumanKnowledge(input: HumanKnowledgeInputDependencies) {
  const management = new HumanKnowledgeService(input);
  const context = new HumanKnowledgeContextService(input);
  const index = new HumanKnowledgeIndexService(input);
  const preparation = new HumanKnowledgeInputService(context, input);
  return { management, context, index, preparation };
}

export interface FormalHumanKnowledgeDependencies extends Omit<HumanKnowledgeInputDependencies, 'authorization' | 'files' | 'memory'> {
  knowledgePolicy: FormalKnowledgePolicySource;
  fileRuntime: Pick<FileStorageRuntimeService, 'readKnowledgeBytes'>;
  memory?: { db: MemoryPrismaClient; policy: FormalMemoryPolicySource };
}

/** Opt-in production assembly. It derives current identity from AuthService,
 * action grants from server-owned policy sources, and bytes from the existing
 * file runtime. No global registration or default policy is created here. */
export function composeFormalPersistedHumanKnowledge(input: FormalHumanKnowledgeDependencies) {
  const authorization = new FormalKnowledgeAuthorizationAdapter(input.auth, input.credentials, input.knowledgePolicy, () => new Date(input.clock.now()));
  const memory = input.memory ? { db: input.memory.db, authorization: new FormalMemoryAuthorizationAdapter(input.auth, input.credentials, input.memory.policy, () => new Date(input.clock.now())) } : undefined;
  const { memory: _memoryPolicy, fileRuntime: _fileRuntime, knowledgePolicy: _knowledgePolicy, ...base } = input;
  const dependencies: HumanKnowledgeInputDependencies = { ...base, authorization, files: new FileStorageKnowledgeFileAdapter(input.fileRuntime), ...(memory ? { memory } : {}) };
  return composePersistedHumanKnowledge(dependencies);
}
