import type { KnowledgePolicyReadDb } from './knowledge-policy-management-authority';
import { createKnowledgePolicyManagementFactory, type KnowledgePolicyManagementFactoryOptions } from './knowledge-policy-management.composition';
import type { KnowledgePolicyManagementDb } from './human-knowledge-policy-management.service';
import { composeFormalPersistedHumanKnowledge, type FormalHumanKnowledgeDependencies } from './persistent-knowledge.composition';
import { PrismaKnowledgeActionPolicySource } from './prisma-knowledge-policy.source';

export type PrismaFormalKnowledgeDependencies = Omit<FormalHumanKnowledgeDependencies, 'knowledgePolicy' | 'memory'> & {
  policyDb: KnowledgePolicyReadDb;
  policyManagement?: KnowledgePolicyManagementFactoryOptions;
  memory?: Omit<NonNullable<FormalHumanKnowledgeDependencies['memory']>, 'policy'>;
};

/** Opt-in only. Empty/disabled/expired policy storage never becomes a grant.
 * Provisioning grants is a separate authorized administrative responsibility. */
export function composePrismaFormalHumanKnowledge(input: PrismaFormalKnowledgeDependencies) {
  const { policyDb, memory, policyManagement, ...base } = input;
  const policies = new PrismaKnowledgeActionPolicySource(policyDb, () => new Date(input.clock.now()));
  if (policyManagement && !Object.is(policyDb, input.db)) throw new Error('Knowledge management requires the original policy transaction');
  const management = policyManagement ? createKnowledgePolicyManagementFactory({ ...policyManagement,
    db: policyDb as KnowledgePolicyManagementDb,
    auth: input.auth, clock: () => new Date(input.clock.now()) }) : undefined;
  return { ...composeFormalPersistedHumanKnowledge({ ...base, knowledgePolicy: policies.knowledge,
    ...(memory ? { memory: { ...memory, policy: policies.memory } } : {}) }),
    ...(management ? { policyManagement: management } : {}) };
}
