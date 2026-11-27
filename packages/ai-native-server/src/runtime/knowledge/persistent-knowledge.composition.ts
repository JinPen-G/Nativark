import type { KnowledgeModulePorts } from './knowledge.module';
import { composeKnowledgeServices } from './knowledge.module';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import { HumanKnowledgeInputService, type HumanKnowledgeInputDependencies } from './human-knowledge-input.service';
import { HumanKnowledgeConsumptionService } from './human-knowledge-consumption.service';
import { FormalKnowledgeAuthorizationAdapter, FormalMemoryAuthorizationAdapter, type FormalKnowledgePolicySource, type FormalMemoryPolicySource } from './formal-knowledge-authorization.adapter';
import type { FileStorageRuntimeService } from '../rental-adapters/file-storage.runtime.service';
import { FileStorageKnowledgeFileAdapter } from './file-storage-knowledge.adapter';
import type { MemoryPrismaClient } from './prisma-memory.repository';

import { createPersistedKnowledgePorts as publicPorts, type PersistentKnowledgeDependencies as PublicDependencies } from './persisted-knowledge';
import { lockRetentionSourceScope, inspectRetentionSource } from '../privacy/retention-model-sources';
import { eraseRetainedSourceTaskBodies } from '../privacy/retention-task-bodies';

export type PersistentKnowledgeDependencies = Omit<PublicDependencies, 'retention'>;
export function createPersistedKnowledgePorts(input: PersistentKnowledgeDependencies): KnowledgeModulePorts {
  return publicPorts({ ...input, retention: { lockSource: lockRetentionSourceScope,
    inspectSource: inspectRetentionSource, eraseCopies: eraseRetainedSourceTaskBodies } });
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
  const consumption = new HumanKnowledgeConsumptionService(management, preparation, input.clock);
  return { management, context, index, preparation, consumption, memory: preparation.memory };
}

export interface FormalHumanKnowledgeDependencies extends Omit<HumanKnowledgeInputDependencies, 'authorization' | 'files' | 'memory'> {
  knowledgePolicy: FormalKnowledgePolicySource;
  fileRuntime: Pick<
    FileStorageRuntimeService,
    'readKnowledgeBytes' | 'assertKnowledgeBinding'
  >;
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
