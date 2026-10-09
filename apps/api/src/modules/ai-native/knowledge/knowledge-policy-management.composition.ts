import { z } from 'zod';
import { HumanKnowledgePolicyManagementService, type KnowledgePolicyManagementDb, type KnowledgePolicyManagementDependencies } from './human-knowledge-policy-management.service';
import { KnowledgePolicyManagementError, managementParse } from './knowledge-policy-management.validation';

export const KNOWLEDGE_POLICY_MANAGEMENT = Symbol('KNOWLEDGE_POLICY_MANAGEMENT');
export type KnowledgePolicyManagementFactoryOptions = { enabled: boolean; guard: KnowledgePolicyManagementDependencies['guard'] };
const requestSchema = z.object({ authorization: z.string().min(1).max(8192), requestId: z.string().min(1).max(191), audience: z.literal('operator') }).strict();
export function createKnowledgePolicyManagementFactory(input: KnowledgePolicyManagementFactoryOptions & {
  db: KnowledgePolicyManagementDb; auth: KnowledgePolicyManagementDependencies['auth']; clock: () => Date;
}) {
  const service = (request: unknown) => {
    if (input.enabled !== true) throw new KnowledgePolicyManagementError('unavailable');
    const credential = structuredClone(managementParse(requestSchema, request));
    return new HumanKnowledgePolicyManagementService(input.db, { auth: input.auth, guard: input.guard,
      credentials: { current: async () => structuredClone(credential) } }, input.clock);
  };
  return {
    read: (request: unknown, value: unknown) => service(request).read(value),
    prepare: (request: unknown, value: unknown) => service(request).prepare(value),
    preparation: (request: unknown, value: unknown) => service(request).preparation(value),
    commit: (request: unknown, value: unknown) => service(request).commit(value),
    operation: (request: unknown, value: unknown) => service(request).operation(value),
  };
}
export type KnowledgePolicyManagementApplication = ReturnType<typeof createKnowledgePolicyManagementFactory>;
