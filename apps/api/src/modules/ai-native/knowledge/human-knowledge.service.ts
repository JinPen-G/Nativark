import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import type { KnowledgeAuthorizationPort, KnowledgeClock, KnowledgeFilePort, KnowledgeRecord } from './knowledge.ports';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgePublicationService } from './knowledge-publication.service';
import { KnowledgeTextParser } from './knowledge-text-parser';
import { KnowledgeSourceService } from './knowledge-source.service';
import { PrismaKnowledgeReadAdapter } from './prisma-knowledge-read.adapter';
import { PrismaKnowledgeRepository } from './prisma-knowledge.repository';
import { KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { draftInput, fingerprint, id, parse, visible } from './knowledge-validation';

export type HumanKnowledgeDependencies = {
  db: ConstructorParameters<typeof PrismaKnowledgeRepository>[0];
  auth: Pick<AuthService, 'resolveAccessContext'>; credentials: AiTaskCredentialSource;
  authorization: KnowledgeAuthorizationPort; clock: KnowledgeClock;
  /** Missing source disables parsing, not lawful metadata management. */
  files?: KnowledgeFilePort;
};

export function knowledgeManagementView(record: KnowledgeRecord) {
  const d = record.document;
  const nextStep = record.parseOperationId ? 'reconcile' : d.publication === 'deleted' || d.publication === 'withdrawn' ? 'none'
    : d.parsing === 'failed' || d.parsing === 'rejected' ? 'manual' : d.parsing !== 'parsed' ? 'parse'
      : d.indexing !== 'indexed' ? 'index' : d.publication === 'draft' ? 'publish' : 'none';
  return { documentId: d.documentId, title: d.title, documentVersion: d.documentVersion, revision: record.revision,
    aclRevision: d.aclRevision, publication: d.publication, parsing: d.parsing, indexing: d.indexing,
    parseOperation: record.parseOperationId ? 'pending' as const : 'not_pending' as const,
    ...(record.failure ? { failure: record.failure } : {}),
    ...(record.indexJob ? { indexJob: structuredClone(record.indexJob) } : {}), nextStep,
    // This is guidance, not permission to execute the suggested action.
    actionAuthorization: 'required' as const };
}

const listInput = z.object({ limit: z.number().int().min(1).max(50),
  publication: z.enum(['draft', 'published', 'withdrawn', 'deleted']).optional(),
  parsing: z.enum(['pending', 'parsed', 'failed', 'rejected']).optional(),
  indexing: z.enum(['not_indexed', 'indexing', 'indexed', 'failed']).optional() }).strict();

/** Server facade: callers cannot supply actor/scope/context. No route or root registration. */
export class HumanKnowledgeService {
  readonly session: KnowledgeCurrentSession;
  readonly authorization: KnowledgeAuthorizationPort;
  readonly repository: PrismaKnowledgeRepository;
  readonly documents: KnowledgeDocumentService;
  private readonly publication: KnowledgePublicationService;
  constructor(readonly ports: HumanKnowledgeDependencies) {
    this.session = new KnowledgeCurrentSession(ports.auth, ports.credentials, ports.clock);
    this.authorization = this.session.bind(ports.authorization);
    this.repository = new PrismaKnowledgeRepository(ports.db, () => new Date(ports.clock.now()));
    if (ports.files !== undefined) requiredPort(ports.files, ['read']);
    this.documents = new KnowledgeDocumentService({ repository: this.repository, authorization: this.authorization,
      clock: ports.clock, files: ports.files ?? { read: async () => unavailable() }, parser: new KnowledgeTextParser() });
    this.publication = new KnowledgePublicationService(this.documents);
  }
  private invoke(callback: (context: AiExecutionContext) => Promise<KnowledgeRecord>) {
    return this.session.run(async context => knowledgeManagementView(await callback(context)));
  }
  create(value: unknown) { return this.invoke(context => this.documents.create(context, value)); }
  read(documentId: string) { return this.invoke(context => this.documents.read(context, parse(id, documentId))); }
  parserCapabilities() { return KnowledgeTextParser.capabilities(); }
  prepareCreate(value: unknown) {
    const input = parse(draftInput, value);
    return this.session.run(async context => {
      const grant = await this.authorization.authorize(context, { action: 'create', scope: context.scope,
        attachmentId: input.attachmentId });
      if (!grant || !this.ports.files) return unavailable();
      return { documentId: input.documentId, documentVersion: input.documentVersion, attachmentId: input.attachmentId,
        scope: structuredClone(grant.scope), owner: structuredClone(grant.actor), format: KnowledgeTextParser.capabilities().mediaTypes,
        status: 'ready_to_create' as const, nextStep: 'create' as const,
        semantics: 'attachment_reference_and_metadata_only' as const };
    });
  }
  parseReadiness(documentId: string) {
    parse(id, documentId);
    return this.session.run(async context => {
      const record = await this.documents.read(context, documentId), d = record.document;
      const grant = await this.authorization.authorize(context, { action: 'parse', scope: context.scope, document: d,
        attachmentId: d.attachmentId });
      const body = await this.authorization.authorize(context, { action: 'read_body', scope: context.scope, document: d,
        attachmentId: d.attachmentId });
      const ready = Boolean(grant && body && this.ports.files && d.publication === 'draft' && d.parsing !== 'parsed'
        && !record.parseOperationId && d.documentVersion && d.attachmentId);
      return { ...knowledgeManagementView(record), ready, format: KnowledgeTextParser.capabilities().mediaTypes,
        limits: KnowledgeTextParser.capabilities(), nextStep: ready ? 'parse' as const
          : record.parseOperationId ? 'reconcile' as const : 'unavailable' as const,
        checkSemantics: 'can_start_only_not_parsed_result' as const };
    });
  }
  publishReadiness(documentId: string) {
    parse(id, documentId);
    return this.session.run(async context => {
      const record = await this.documents.read(context, documentId), d = record.document;
      const grant = await this.authorization.authorize(context, { action: 'publish', scope: context.scope, document: d });
      const now = this.ports.clock.now();
      const checks = {
        authorized: Boolean(grant), parsed: d.parsing === 'parsed', indexed: d.indexing === 'indexed',
        draftOrWithdrawn: d.publication === 'draft' || d.publication === 'withdrawn',
        withinValidity: Number.isFinite(now) && Date.parse(d.validFrom) <= now && (!d.validUntil || Date.parse(d.validUntil) > now),
      };
      const ready = Object.values(checks).every(Boolean);
      return { ...knowledgeManagementView(record), ready, checks,
        nextStep: ready ? 'publish' as const : 'resolve_missing_conditions' as const,
        semantics: 'observation_not_state_transition' as const };
    });
  }
  preview(documentId: string, limit = 3) {
    parse(id, documentId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new KnowledgeError('invalid_input');
    return this.session.run(async context => {
      const record = await this.documents.read(context, documentId), d = record.document;
      if (d.parsing !== 'parsed' || d.publication === 'deleted') return { status: 'unavailable' as const, sources: [] };
      const reads = new PrismaKnowledgeReadAdapter(this.ports.db, this.repository, this.authorization, this.ports.clock);
      const chunks = await reads.previewChunks(context, d, limit);
      if (!Array.isArray(chunks)) return unavailable();
      const items = [];
      for (const chunk of chunks) {
        const ref = { kind: 'document' as const, documentId: chunk.documentId, documentVersion: chunk.documentVersion,
          chunkId: chunk.chunkId, scope: chunk.scope, aclRevision: chunk.aclRevision, locator: chunk.locator };
        items.push({ source: ref, snippet: chunk.text, contentFingerprint: fingerprint(chunk.text), trust: chunk.trust });
      }
      return { status: 'ready' as const, documentVersion: d.documentVersion, aclRevision: d.aclRevision,
        truncated: chunks.length === limit, sources: items,
        semantics: 'preview_not_approval_or_search_readiness' as const };
    });
  }
  versionStatus(documentId: string) {
    parse(id, documentId);
    return this.session.run(async context => {
      const head = await this.documents.read(context, documentId), d = head.document;
      const now = this.ports.clock.now();
      if (!Number.isFinite(now)) return unavailable();
      return { ...knowledgeManagementView(head), currentVersion: d.documentVersion,
        pendingParseVersion: d.parsing === 'pending' ? d.documentVersion : null,
        indexedPublishedVersion: visible(d, now) ? d.documentVersion : null,
        readinessSemantics: 'persistent_state_not_search_permission' as const,
        historicalVersions: 'unavailable' as const,
        parseRecovery: head.parseOperationId ? 'reconcile_original_operation' as const
          : head.failure ? 'revise_new_version' as const : 'none' as const };
    });
  }
  detail(documentId: string) {
    parse(id, documentId);
    return this.session.run(async context => {
      const before = await this.documents.read(context, documentId);
      const actions = ['parse', 'publish', 'revise', 'withdraw', 'delete', 'index', 'read_body', 'download'] as const;
      const permissions: Partial<Record<typeof actions[number], 'authorized' | 'unavailable'>> = {};
      for (const action of actions) {
        const grant = await this.authorization.authorize(context, { action, scope: context.scope, document: before.document });
        permissions[action] = grant && (action !== 'parse' || this.ports.files) ? 'authorized' : 'unavailable';
      }
      const after = await this.documents.read(context, documentId);
      if (fingerprint(before) !== fingerprint(after)) throw new KnowledgeError('conflict');
      const view = knowledgeManagementView(after);
      const suggestedAction = view.nextStep === 'reconcile' ? 'parse' : view.nextStep === 'parse' ? 'parse'
        : view.nextStep === 'index' ? 'index' : view.nextStep === 'publish' ? 'publish' : null;
      return { ...view, permissions,
        nextStepAuthorization: suggestedAction ? permissions[suggestedAction] : 'unavailable' as const,
        nextStepSemantics: 'guidance_requires_current_revision_and_original_operation' as const,
        permissionSemantics: 'current_policy_not_transition_or_future_grant' as const };
    });
  }
  parse(value: unknown) {
    // Do not create a pending admission for a missing trusted byte source.
    if (!this.ports.files) throw new KnowledgeError('unavailable');
    return this.invoke(context => this.documents.parseDocument(context, value));
  }
  publish(value: unknown) { return this.invoke(context => this.publication.publish(context, value)); }
  revise(expectedRevision: number, value: unknown) { return this.invoke(context => this.documents.newVersion(context, expectedRevision, value)); }
  withdraw(value: unknown) { return this.invoke(context => this.publication.withdraw(context, value)); }
  delete(value: unknown) { return this.invoke(context => this.publication.delete(context, value)); }
  reconcileParse(value: unknown) { return this.invoke(context => this.documents.reconcileParse(context, value)); }

  operation(documentId: string, operationId: string) {
    parse(id, documentId); parse(id, operationId);
    return this.session.run(async context => {
      const before = await this.documents.read(context, documentId);
      const receipt = await this.repository.operation(context.scope, documentId, operationId);
      const after = await this.documents.read(context, documentId);
      if (fingerprint(before) !== fingerprint(after)) throw new KnowledgeError('conflict');
      return { operationId, receipt: receipt ? 'recorded' as const : 'not_recorded' as const,
        // A receipt alone does not prove parse/index/business completion.
        document: knowledgeManagementView(after) };
    });
  }

  operationStatus(documentId: string, operationId: string) {
    return this.operation(documentId, operationId).then(result => ({ ...result,
      documentState: { publication: result.document.publication, parsing: result.document.parsing,
        indexing: result.document.indexing, indexJob: result.document.indexJob ?? null },
      completionSemantics: 'receipt_and_head_are_separate_facts' as const }));
  }

  list(value: unknown) {
    const input = parse(listInput, value);
    return this.session.run(async context => {
      if (context.scope.kind !== 'workspace') return unavailable();
      const scope = context.scope;
      const initial = await this.authorization.authorize(context, { action: 'read_metadata', scope });
      if (!initial) return unavailable();
      const rows = await this.ports.db.aiKnowledgeDocument.findMany({ where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
        select: { id: true, tenantId: true, workspaceId: true }, orderBy: { id: 'asc' }, take: 100 });
      if (!Array.isArray(rows) || rows.length > 100) return unavailable();
      const visible: KnowledgeRecord[] = [], seen = new Set<string>();
      for (const row of rows) {
        if (!id.safeParse(row.id).success || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || seen.has(row.id)) return unavailable();
        seen.add(row.id);
        const head = await this.repository.read(scope, row.id);
        if (!head) return unavailable();
        const allowed = await this.authorization.authorize(context, { action: 'read_metadata', scope, document: head.document });
        if (!allowed) continue;
        if (fingerprint(allowed) !== fingerprint(initial)) return unavailable();
        const fresh = await this.documents.read(context, row.id);
        if (fingerprint(head) !== fingerprint(fresh)) throw new KnowledgeError('conflict');
        if ((!input.publication || fresh.document.publication === input.publication)
          && (!input.parsing || fresh.document.parsing === input.parsing) && (!input.indexing || fresh.document.indexing === input.indexing)) visible.push(fresh);
      }
      // Recheck every returned document after all enumeration waits.
      for (const head of visible.slice(0, input.limit)) {
        const current = await this.documents.read(context, head.document.documentId);
        if (fingerprint(current) !== fingerprint(head)) throw new KnowledgeError('conflict');
      }
      const latest = await this.authorization.authorize(context, { action: 'read_metadata', scope });
      if (!latest || fingerprint(latest) !== fingerprint(initial)) return unavailable();
      return { items: visible.slice(0, input.limit).map(knowledgeManagementView), truncated: visible.length > input.limit,
        coverage: 'bounded_window' as const, pagination: 'unavailable' as const };
    });
  }
}
