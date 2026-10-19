import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiExecutionScope, AiKnowledgeLocatorDraft, AiPreferenceValueDraft } from '@rental-os/shared';
import type { AiKnowledgeConsumptionHttpResponsesDraft } from '@rental-os/shared';
import { composePrismaFormalHumanKnowledge, type PrismaFormalKnowledgeDependencies } from './prisma-formal-knowledge.composition';
import { KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { documentSourceSchema, id, parse } from './knowledge-validation';
import type { HumanKnowledgeConsumptionService } from './human-knowledge-consumption.service';
import { composeKnowledgeFileApplication, type KnowledgeFileApplicationDependencies } from './knowledge-file.composition';
import type { AiRequestAbortSource } from '../scenes/request-abort';

export type HumanKnowledgeConsumptionDependencies = Omit<PrismaFormalKnowledgeDependencies, 'credentials' | 'policyManagement'>
  | Omit<KnowledgeFileApplicationDependencies, 'credentials' | 'policyManagement'>;
export type HumanKnowledgeConsumptionHttpRequest = { headers: { authorization?: unknown } } & AiRequestAbortSource;
export type HumanKnowledgeConsumptionRequest = {
  [K in keyof AiKnowledgeConsumptionHttpResponsesDraft]: (value: unknown) => Promise<AiKnowledgeConsumptionHttpResponsesDraft[K]>;
} & {
  /** Server-only input preparation, not an HTTP/model tool or permanent grant. */
  collectInput(value: unknown, options?: unknown): ReturnType<HumanKnowledgeConsumptionService['collectInput']>;
  revalidateInput(value: unknown): ReturnType<HumanKnowledgeConsumptionService['revalidateInput']>;
  close(): void;
};

const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const documentInput = z.object({ documentId: id, previewLimit: z.number().int().min(1).max(10).optional() }).strict();
const sourceInput = documentSourceSchema.omit({ scope: true }).strict();
const memoryInput = z.object({ memoryId: id }).strict();
const preferencesInput = z.object({ limit: z.number().int().min(1).max(10) }).strict();

function publicScope(scope: AiExecutionScope): AiExecutionScope {
  if (scope.kind === 'platform') return { kind: 'platform' };
  if (scope.kind === 'tenant') return { kind: 'tenant', tenantId: scope.tenantId };
  return { kind: 'workspace', tenantId: scope.tenantId, workspaceId: scope.workspaceId };
}
function publicLocator(locator: AiKnowledgeLocatorDraft): AiKnowledgeLocatorDraft {
  return locator.kind === 'page' ? { kind: 'page', page: locator.page, paragraph: locator.paragraph }
    : { kind: 'section', sectionId: locator.sectionId, paragraph: locator.paragraph };
}
function publicPreference(preference: AiPreferenceValueDraft): AiPreferenceValueDraft {
  if (preference.kind === 'locale') return { kind: 'locale', value: preference.value };
  if (preference.kind === 'fulfillment_location') return { kind: 'fulfillment_location', locationId: preference.locationId };
  return { kind: 'display_density', value: preference.value };
}
function publicMemory(item: AiKnowledgeConsumptionHttpResponsesDraft['readPreferences']['items'][number]) {
  return { memoryId: item.memoryId, revision: item.revision, aclRevision: item.aclRevision,
    expiresAt: item.expiresAt, preference: publicPreference(item.preference), confirmationRecordId: item.confirmationRecordId };
}
export class HumanKnowledgeConsumptionRequestFactory {
  constructor(private readonly dependencies: HumanKnowledgeConsumptionDependencies) {
    requiredPort(dependencies?.auth, ['resolveAccessContext']);
    requiredPort(dependencies?.clock, ['now']);
    requiredPort(dependencies?.db, ['$transaction']);
    const policyDb = 'integrations' in dependencies ? dependencies.db : dependencies.policyDb;
    requiredPort(policyDb?.aiKnowledgeActionPolicy, ['findUnique']);
    requiredPort(policyDb?.aiKnowledgePolicyManagementOperation, ['findFirst']);
    if ('integrations' in dependencies) requiredPort(dependencies.integrations, ['runtimeConfig', 'assertEnabledInTransaction']);
    else requiredPort(dependencies.fileRuntime, ['readKnowledgeBytes', 'assertKnowledgeBinding']);
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
    // The standard app must use the SAME request-owned file ACL/integration
    // producer as document management, never a generic download runtime.
    const requestAuth: typeof this.dependencies.auth = { resolveAccessContext: async (...args) => {
      await credentials.current();
      const access = await this.dependencies.auth.resolveAccessContext(...args);
      await credentials.current();
      return access;
    } };
    const services = 'integrations' in this.dependencies
      ? composeKnowledgeFileApplication({ ...this.dependencies, auth: requestAuth, credentials })
      : composePrismaFormalHumanKnowledge({ ...this.dependencies, auth: requestAuth, credentials });
    return {
      collectInput: (value, options) => services.consumption.collectInput(value, options),
      revalidateInput: value => services.consumption.revalidateInput(value),
      readDocument: async value => {
        const input = parse(documentInput, value);
        return services.management.session.run(async context => {
          const before = await services.management.documents.read(context, input.documentId);
          const result = await services.consumption.readDocument(input);
          if (before.revision !== result.metadata.revision) throw new KnowledgeError('conflict');
          const now = this.dependencies.clock.now();
          if (!Number.isFinite(now) || before.document.validUntil && Date.parse(before.document.validUntil) <= now) return unavailable();
          if (result.audience !== 'operator') return unavailable();
          const metadata = result.metadata;
          return {
            state: result.state,
            metadata: { documentId: metadata.documentId, title: metadata.title, documentVersion: metadata.documentVersion,
              revision: metadata.revision, aclRevision: metadata.aclRevision, publication: metadata.publication,
              parsing: metadata.parsing, indexing: metadata.indexing },
            body: result.body,
            preview: result.preview.status === 'ready' && result.body === 'current_readable' && result.state === 'current_readable'
              ? { status: 'ready' as const, documentVersion: result.preview.documentVersion, aclRevision: result.preview.aclRevision,
                truncated: result.preview.truncated, semantics: result.preview.semantics,
                sources: result.preview.sources.map(item => ({
                  source: { kind: 'document' as const, documentId: item.source.documentId, documentVersion: item.source.documentVersion,
                    chunkId: item.source.chunkId, aclRevision: item.source.aclRevision,
                    scope: publicScope(item.source.scope), locator: publicLocator(item.source.locator) },
                  snippet: item.snippet, contentFingerprint: item.contentFingerprint, trust: item.trust,
                })) }
              : { status: 'unavailable' as const, sources: [] },
            scope: publicScope(result.scope), audience: 'operator' as const, observedAt: result.observedAt,
            bounded: result.bounded, truncated: result.truncated, semantics: result.semantics,
          };
        });
      },
      openSource: async value => {
        const source = parse(sourceInput, value);
        const result = await services.management.session.run(context => services.consumption.openSource({ ...source, scope: context.scope }));
        return { draftVersion: result.draftVersion, documentId: result.documentId, documentVersion: result.documentVersion,
          chunkId: result.chunkId, aclRevision: result.aclRevision, scope: publicScope(result.scope),
          locator: publicLocator(result.locator), text: result.text, trust: result.trust };
      },
      readMemory: async value => {
        const result = await services.consumption.readMemory(parse(memoryInput, value));
        if (result.status !== 'ready') return {
          status: result.status,
          memory: { memoryId: result.memory.memoryId, revision: result.memory.revision, aclRevision: result.memory.aclRevision,
            storageStatus: result.memory.storageStatus, consentStatus: result.memory.consentStatus, expiresAt: result.memory.expiresAt },
          semantics: result.semantics,
        };
        if (result.audience !== 'operator' || result.confirmation.audience !== 'operator') return unavailable();
        const proof = result.confirmation;
        return { status: 'ready' as const, memory: publicMemory(result.memory), observedAt: result.observedAt,
          scope: publicScope(result.scope), audience: 'operator' as const,
          confirmation: { confirmationRecordId: proof.confirmationRecordId, revision: proof.revision, aclRevision: proof.aclRevision,
            scope: publicScope(proof.scope), audience: 'operator' as const, confirmedAt: proof.confirmedAt, expiresAt: proof.expiresAt },
          semantics: result.semantics };
      },
      readPreferences: async value => {
        const result = await services.consumption.readPreferences(parse(preferencesInput, value));
        return { items: result.items.map(publicMemory),
          ambiguities: result.ambiguities.map(item => ({ kind: item.kind, memoryIds: [...item.memoryIds], nextStep: item.nextStep })),
          ambiguityCoverage: result.ambiguityCoverage, businessCompatibility: result.businessCompatibility,
          truncated: result.truncated, coverage: result.coverage, pagination: result.pagination, semantics: result.semantics };
      },
      close() { authorization = undefined; },
    };
  }
}
