import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiKnowledgeManagementHttpResponsesDraft, AiKnowledgeManagementStateDraft } from '@rental-os/shared';
import { composeKnowledgeFileApplication, type KnowledgeFileApplicationDependencies } from './knowledge-file.composition';
import { knowledgeManagementView } from './human-knowledge.service';
import { requiredPort, unavailable } from './knowledge-errors';
import { draftInput, id, mutationInput, parse } from './knowledge-validation';
import type { FileUploadSessionSummary } from '@rental-os/shared';
import type { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import type { KnowledgePolicyManagementApplication } from './knowledge-policy-management.composition';

export type HumanKnowledgeManagementDependencies = Omit<KnowledgeFileApplicationDependencies, 'credentials' | 'memory'>;
type PolicyAction = keyof KnowledgePolicyManagementApplication;
const policyActions: readonly PolicyAction[] = ['prepareTarget', 'target', 'bindTarget', 'read', 'prepare', 'preparation', 'commit', 'operation'];
export type HumanKnowledgeManagementHttpRequest = { headers: { authorization?: unknown } };
export type HumanKnowledgeManagementRequest = {
  [K in keyof AiKnowledgeManagementHttpResponsesDraft]: (value: unknown) => Promise<AiKnowledgeManagementHttpResponsesDraft[K]>;
} & {
  /** Server application only; no new HTTP contract or worker registration. */
  indexStatus(value: unknown): Promise<Awaited<ReturnType<HumanKnowledgeIndexService['status']>>>;
  requestIndex(value: unknown): ReturnType<HumanKnowledgeIndexService['request']>;
  resumeIndex(value: unknown): ReturnType<HumanKnowledgeIndexService['resume']>;
  indexOperationStatus(value: unknown): ReturnType<HumanKnowledgeIndexService['operationStatus']>;
  /** Explicit server management only, never a model tool or HTTP permission. */
  managePolicy(action: PolicyAction, value: unknown): Promise<Awaited<ReturnType<KnowledgePolicyManagementApplication[PolicyAction]>>>;
  close(): void;
};

const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const createInput = z.object({ confirmation: z.literal('create'), command: draftInput }).strict();
const reviseInput = z.object({ confirmation: z.literal('revise'), expectedRevision: mutationInput.shape.expectedRevision, command: draftInput }).strict();
const operationInput = z.object({ documentId: id, operationId: id }).strict();
const commands = {
  parse: z.object({ confirmation: z.literal('parse'), command: mutationInput }).strict(),
  publish: z.object({ confirmation: z.literal('publish'), command: mutationInput }).strict(),
  withdraw: z.object({ confirmation: z.literal('withdraw'), command: mutationInput }).strict(),
  delete: z.object({ confirmation: z.literal('delete'), command: mutationInput }).strict(),
};

function publicState(view: ReturnType<typeof knowledgeManagementView>): AiKnowledgeManagementStateDraft {
  const job = view.indexJob;
  return {
    documentId: view.documentId, title: view.title, documentVersion: view.documentVersion, revision: view.revision,
    aclRevision: view.aclRevision, publication: view.publication, parsing: view.parsing, indexing: view.indexing,
    parseOperation: view.parseOperation, ...(view.failure ? { failure: view.failure } : {}),
    indexJob: job ? { operationId: job.operationId, kind: job.kind, status: job.status,
      documentVersion: job.documentVersion, aclRevision: job.aclRevision, generation: job.generation } : null,
    body: 'not_included', physicalIndexDeletion: 'not_verified', actionAuthorization: 'required',
  };
}

export class HumanKnowledgeManagementRequestFactory {
  constructor(private readonly dependencies: HumanKnowledgeManagementDependencies) {
    requiredPort(dependencies?.auth, ['resolveAccessContext']);
    requiredPort(dependencies?.clock, ['now']);
    requiredPort(dependencies?.db, ['$transaction']);
    requiredPort(dependencies?.db?.aiKnowledgeActionPolicy, ['findUnique']);
    requiredPort(dependencies?.db?.aiKnowledgePolicyManagementOperation, ['findFirst']);
    requiredPort(dependencies?.integrations, ['runtimeConfig', 'assertEnabledInTransaction']);
    if (dependencies.policyManagement?.enabled === true) requiredPort(dependencies.policyManagement.guard, ['canActivate']);
  }

  open(request: HumanKnowledgeManagementHttpRequest): HumanKnowledgeManagementRequest {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) return unavailable();
    let authorization: string | undefined = header.data;
    const requestId = randomUUID();
    const credentials = { current: async () => {
      if (authorization === undefined) return unavailable();
      return { authorization, requestId, audience: 'operator' as const };
    } };
    const { db, auth, clock, integrations, objectIO, policyManagement: policyOptions } = this.dependencies;
    // The policy factory owns a short-lived copy of credentials. Keep its Auth
    // reads bound to the parent request too, including close() during an await.
    const requestAuth: typeof auth = { resolveAccessContext: async (...args) => {
      await credentials.current();
      const current = await auth.resolveAccessContext(...args);
      await credentials.current();
      return current;
    } };
    // File access carries a session too; never reuse a runtime bound to another request.
    const { management, uploads, index, policyManagement } = composeKnowledgeFileApplication({ db, auth: requestAuth, clock, integrations, objectIO, credentials,
      ...(policyOptions?.enabled === true ? { policyManagement: policyOptions } : {}) });
    const uploadSession = (result: FileUploadSessionSummary & { documentId: string }) => ({
      sessionId: result.sessionId, fileAssetId: result.fileAssetId, provider: result.provider,
      mode: result.mode, status: result.status, expiresAt: result.expiresAt,
      ...(result.uploadUrl === undefined ? {} : { uploadUrl: result.uploadUrl }),
      ...(result.uploadHeaders === undefined ? {} : { uploadHeaders: { ...result.uploadHeaders } }),
      documentId: result.documentId,
    });
    const response = (operationId: string, view: ReturnType<typeof knowledgeManagementView>) => ({
      operationId, document: publicState(view), semantics: 'current_document_state_not_original_operation_result' as const,
    });
    const change = async (action: keyof typeof commands, value: unknown) => {
      const { command } = parse<{ confirmation: keyof typeof commands; command: z.infer<typeof mutationInput> }>(commands[action], value);
      return response(command.operationId, await management[action](command));
    };
    return {
      managePolicy: async (action, value) => {
        if (!policyActions.includes(action) || !policyManagement) return unavailable();
        const command = structuredClone(value);
        // The caller supplies only the existing management command; credentials
        // come from this request and close() invalidates subsequent operations.
        const current = await credentials.current();
        return policyManagement[action](current, command);
      },
      indexStatus: value => index.status(parse(z.object({ documentId: id }).strict(), value).documentId),
      requestIndex: value => index.request(value),
      resumeIndex: value => index.resume(value),
      indexOperationStatus: value => index.operationStatus(value),
      observeUpload: value => uploads.observe(value),
      observeRevisionUpload: value => uploads.observeRevision(value),
      beginUpload: async value => {
        const result = await uploads.begin(value);
        return { ...uploadSession(result), semantics: result.semantics };
      },
      completeUpload: async value => uploads.complete(value),
      beginRevisionUpload: async value => {
        const result = await uploads.beginRevision(value);
        return { ...uploadSession(result),
          targetVersion: result.targetVersion, expectedRevision: result.expectedRevision, semantics: result.semantics };
      },
      completeRevisionUpload: async value => uploads.completeRevision(value),
      prepareCreate: async value => {
        const input = parse(draftInput, value);
        const result = await management.prepareCreate(input);
        return { documentId: result.documentId, documentVersion: result.documentVersion, attachmentId: result.attachmentId,
          operationId: input.operationId, format: [...result.format], status: result.status,
          semantics: 'preparation_not_creation_or_future_authorization' as const };
      },
      create: async value => {
        const { command } = parse(createInput, value);
        return response(command.operationId, await management.create(command));
      },
      parse: value => change('parse', value),
      reconcileParse: async value => {
        const command = parse(mutationInput, value);
        return response(command.operationId, await management.reconcileParse(command));
      },
      revise: async value => {
        const { expectedRevision, command } = parse(reviseInput, value);
        return response(command.operationId, await management.revise(expectedRevision, command));
      },
      publish: value => change('publish', value),
      withdraw: value => change('withdraw', value),
      delete: value => change('delete', value),
      operationStatus: async value => {
        const input = parse(operationInput, value);
        const result = await management.operationStatus(input.documentId, input.operationId);
        return { operationId: result.operationId, receipt: result.receipt, document: publicState(result.document),
          completionSemantics: result.completionSemantics, recovery: 'read_original_operation_only' as const };
      },
      close() { authorization = undefined; },
    };
  }
}
