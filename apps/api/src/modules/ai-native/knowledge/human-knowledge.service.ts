import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import type { KnowledgeAuthorizationPort, KnowledgeClock, KnowledgeFilePort, KnowledgeRecord } from './knowledge.ports';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgePublicationService } from './knowledge-publication.service';
import { KnowledgeTextParser } from './knowledge-text-parser';
import { PrismaKnowledgeRepository } from './prisma-knowledge.repository';
import { KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { fingerprint, id, parse, visible } from './knowledge-validation';

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
