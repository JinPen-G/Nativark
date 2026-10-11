import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiKnowledgeConsumptionHttpResponsesDraft } from '../../../../../../packages/shared/src/ai-knowledge-consumption-http-draft';
import { composePrismaFormalHumanKnowledge, type PrismaFormalKnowledgeDependencies } from './prisma-formal-knowledge.composition';
import { KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { documentSourceSchema, id, parse } from './knowledge-validation';

export type HumanKnowledgeConsumptionDependencies = Omit<PrismaFormalKnowledgeDependencies, 'credentials' | 'policyManagement'>;
export type HumanKnowledgeConsumptionHttpRequest = { headers: { authorization?: unknown } };
export type HumanKnowledgeConsumptionRequest = {
  [K in keyof AiKnowledgeConsumptionHttpResponsesDraft]: (value: unknown) => Promise<AiKnowledgeConsumptionHttpResponsesDraft[K]>;
} & { close(): void };

const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const documentInput = z.object({ documentId: id, previewLimit: z.number().int().min(1).max(10).optional() }).strict();
const sourceInput = documentSourceSchema.omit({ scope: true }).strict();
const memoryInput = z.object({ memoryId: id }).strict();
const preferencesInput = z.object({ limit: z.number().int().min(1).max(10) }).strict();

export class HumanKnowledgeConsumptionRequestFactory {
  constructor(private readonly dependencies: HumanKnowledgeConsumptionDependencies) {
    requiredPort(dependencies?.auth, ['resolveAccessContext']);
    requiredPort(dependencies?.clock, ['now']);
    requiredPort(dependencies?.db, ['$transaction']);
    requiredPort(dependencies?.policyDb?.aiKnowledgeActionPolicy, ['findUnique']);
    requiredPort(dependencies?.policyDb?.aiKnowledgePolicyManagementOperation, ['findFirst']);
    requiredPort(dependencies?.fileRuntime, ['readKnowledgeBytes', 'assertKnowledgeBinding']);
  }

  open(request: HumanKnowledgeConsumptionHttpRequest): HumanKnowledgeConsumptionRequest {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) return unavailable();
    let authorization: string | undefined = header.data;
    const requestId = randomUUID();
    const credentials = { current: async () => {
      if (authorization === undefined) return unavailable();
      return { authorization, requestId, audience: 'operator' as const };
    } };
    const services = composePrismaFormalHumanKnowledge({ ...this.dependencies, credentials });
    return {
      readDocument: async value => {
        const input = parse(documentInput, value);
        return services.management.session.run(async context => {
          const before = await services.management.documents.read(context, input.documentId);
          const result = await services.consumption.readDocument(input);
          if (before.revision !== result.metadata.revision) throw new KnowledgeError('conflict');
          const now = this.dependencies.clock.now();
          if (!Number.isFinite(now) || before.document.validUntil && Date.parse(before.document.validUntil) <= now) return unavailable();
          if (result.audience !== 'operator') return unavailable();
          return { ...result, audience: 'operator' as const };
        });
      },
      openSource: async value => {
        const source = parse(sourceInput, value);
        return services.management.session.run(context => services.consumption.openSource({ ...source, scope: context.scope }));
      },
      readMemory: async value => {
        const result = await services.consumption.readMemory(parse(memoryInput, value));
        if (result.status !== 'ready') return result;
        if (result.audience !== 'operator' || result.confirmation.audience !== 'operator') return unavailable();
        return { ...result, audience: 'operator' as const, confirmation: { ...result.confirmation, audience: 'operator' as const } };
      },
      readPreferences: value => services.consumption.readPreferences(parse(preferencesInput, value)),
      close() { authorization = undefined; },
    };
  }
}
