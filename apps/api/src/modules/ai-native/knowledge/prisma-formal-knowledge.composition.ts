import type { PrismaClient } from '@prisma/client';
import { composeFormalPersistedHumanKnowledge, type FormalHumanKnowledgeDependencies } from './persistent-knowledge.composition';
import { PrismaKnowledgeActionPolicySource } from './prisma-knowledge-policy.source';

export type PrismaFormalKnowledgeDependencies = Omit<FormalHumanKnowledgeDependencies, 'knowledgePolicy' | 'memory'> & {
  policyDb: Pick<PrismaClient, 'aiKnowledgeActionPolicy'>;
  memory?: Omit<NonNullable<FormalHumanKnowledgeDependencies['memory']>, 'policy'>;
};

/** Opt-in only. Empty/disabled/expired policy storage never becomes a grant.
 * Provisioning grants is a separate authorized administrative responsibility. */
export function composePrismaFormalHumanKnowledge(input: PrismaFormalKnowledgeDependencies) {
  const { policyDb, memory, ...base } = input;
  const policies = new PrismaKnowledgeActionPolicySource(policyDb, () => new Date(input.clock.now()));
  return composeFormalPersistedHumanKnowledge({ ...base, knowledgePolicy: policies.knowledge,
    ...(memory ? { memory: { ...memory, policy: policies.memory } } : {}) });
}
