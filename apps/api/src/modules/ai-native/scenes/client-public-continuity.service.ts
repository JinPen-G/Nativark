/** Request-bound public catalog/help continuity, never customer authentication.
 * A server host must verify an opaque anonymous-session credential before its
 * source returns a hash. A body, Task ID, IP or URL cannot supply that identity.
 * Logged-in continuation uses the original Client Auth/Guard and creates only
 * a current customer material; later Task/Action/quote approval stays separate. */
import { z } from 'zod';
import { aiClientPublicPreparationRequestSchema, aiClientPublicOperationRequestSchema,
  aiClientPublicContinuationRequestSchema, aiClientPublicPreparationResponseSchema,
  aiClientPublicOperationResponseSchema, aiClientPublicContinuationResponseSchema } from '@rental-os/shared';
import type { ClientRequestContext } from '../../client/client-auth.service';
import type { AiClientPublicSessionIdentity } from './client-public-session.credential';
import { createAiGuardedClientSession } from '../client-scene.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { composeRequestBoundClientApplication, type AiClientApplicationRequest, type AiClientRequestDependencies,
  type AiClientRequestConfiguration } from './client-request.application';
import { PrismaClientSceneMaterialRepository, type AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { ClientPublicContinuityRepository, ClientPublicContinuityUnknownError, clientPublicCommandSchema,
  clientPublicContinuationReadSchema, clientPublicMaterialId, type ClientPublicCommand, type ClientPublicContinuityDb,
  type ClientPublicContinuityOwner, type ClientPublicContinuityClient,
  type ClientPublicContinuityTarget, type ClientPublicContinuation } from './client-public-continuity.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.date().refine(value => Number.isFinite(value.getTime()));
const signedTime = z.string().datetime({ offset: true }).transform(value => new Date(value)).pipe(time);
const ownerProof = z.object({ tenantId: id, workspaceId: id, channel: z.enum(['web', 'wechat_miniprogram']),
  sessionHash: digest, issuedAt: signedTime, expiresAt: signedTime }).strict();
const prepareSchema = aiClientPublicPreparationRequestSchema.omit({ tenantCode: true, serviceCode: true });
const readSchema = aiClientPublicOperationRequestSchema.omit({ tenantCode: true, serviceCode: true });
const continuationSchema = aiClientPublicContinuationRequestSchema.omit({ tenantCode: true, serviceCode: true });
const configurationSchema = z.object({ enabled: z.boolean(), tenantCode: id, serviceCode: id,
  channel: z.enum(['web', 'wechat_miniprogram']), appId: id.optional() }).strict();
export type ClientPublicContinuityConfiguration = z.infer<typeof configurationSchema>;
export type ClientPublicContinuityDependencies = Pick<AiClientRequestDependencies, 'client' | 'guard'> & { db: ClientPublicContinuityDb;
  credentials: { current(): Promise<AiClientApplicationRequest> };
  /** This source is a server-only seam for verified anonymous ownership. It
   * must not return a hash of a body/task/IP, or treat a caller hash as proof.
   * Receipt reads may verify an expired credential without reviving its lease. */
  anonymous?: { current(mode: 'read' | 'write'): Promise<AiClientPublicSessionIdentity> };
  /** The standard host reopens its current enablement/channel publication.
   * This additional check applies only to a new write, never original receipts. */
  publication?: { assertCurrent(): Promise<void> };
  clock?: () => Date };
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const stale = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const parse = <T, I>(schema: z.ZodType<T, z.ZodTypeDef, I>, value: unknown): T => {
  let parsed: z.SafeParseReturnType<I, T>;
  try { parsed = schema.safeParse(structuredClone(value)); }
  catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return parsed.data;
};
const jsonHash = (value: unknown) => hash(JSON.parse(JSON.stringify(value)));

export class ClientPublicContinuityService {
  private readonly config: ClientPublicContinuityConfiguration;
  private readonly clock: () => Date;
  private readonly repository: ClientPublicContinuityRepository;
  private readonly scopes: PrismaClientSceneMaterialRepository;
  private readonly application: ReturnType<typeof composeRequestBoundClientApplication>;
  constructor(private readonly dependencies: ClientPublicContinuityDependencies, configuration: ClientPublicContinuityConfiguration) {
    this.config = parse(configurationSchema, configuration);
    this.clock = dependencies.clock ?? (() => new Date());
    if (typeof dependencies?.credentials?.current !== 'function'
      || dependencies.publication && typeof dependencies.publication.assertCurrent !== 'function') throw unavailable();
    this.repository = new ClientPublicContinuityRepository(dependencies.db);
    this.scopes = new PrismaClientSceneMaterialRepository(dependencies.db);
    const publicConfiguration: AiClientRequestConfiguration = { ...this.config, enabled: true };
    this.application = composeRequestBoundClientApplication({ client: dependencies.client, guard: dependencies.guard,
      db: dependencies.db, clock: this.clock }, publicConfiguration);
  }
  private now() { return new Date(time.parse(this.clock()).getTime()); }
  private live(signal?: AbortSignal) {
    if (signal?.aborted) throw new ClientPublicContinuityUnknownError();
  }
  private async request() {
    const current = structuredClone(await this.dependencies.credentials.current());
    return { headers: { authorization: current?.headers?.authorization }, ip: current?.ip };
  }
  private async scope(expected?: { tenantId: string; workspaceId: string }, signal?: AbortSignal) {
    this.live(signal);
    const tenant = await this.dependencies.db.tenant.findFirst({ where: { code: this.config.tenantCode, status: 'ACTIVE',
      ...(expected ? { id: expected.tenantId } : {}) }, select: { id: true, code: true, status: true } });
    if (!tenant || tenant.code !== this.config.tenantCode || tenant.status !== 'ACTIVE'
      || expected && tenant.id !== expected.tenantId) throw denied();
    const workspace = await this.dependencies.db.businessWorkspace.findFirst({ where: { tenantId: tenant.id,
      code: this.config.serviceCode, status: 'ACTIVE', ...(expected ? { id: expected.workspaceId } : {}) },
      select: { id: true, tenantId: true, code: true, status: true } });
    if (!workspace || workspace.tenantId !== tenant.id || workspace.code !== this.config.serviceCode || workspace.status !== 'ACTIVE'
      || expected && workspace.id !== expected.workspaceId) throw denied();
    this.live(signal);
    return { tenantId: tenant.id, workspaceId: workspace.id };
  }
  private async owner(mode: 'read' | 'write', signal?: AbortSignal) {
    this.live(signal);
    if (typeof this.dependencies.anonymous?.current !== 'function') throw unavailable();
    const proof = parse(ownerProof, await this.dependencies.anonymous.current(mode));
    const scope = await this.scope(proof, signal), now = this.now();
    this.live(signal);
    if (proof.channel !== this.config.channel || proof.issuedAt > now || proof.expiresAt <= proof.issuedAt
      || proof.expiresAt.getTime() - proof.issuedAt.getTime() > 300000
      || mode === 'write' && (!this.config.enabled || proof.expiresAt <= now)) throw denied();
    const identity = { ...scope, channel: this.config.channel, appId: this.config.appId ?? null };
    const owner: ClientPublicContinuityOwner = { ...identity, ownerHash: proof.sessionHash,
      principalHash: hash({ version: 'client-public-owner-1', ...identity, sessionHash: proof.sessionHash }) };
    return { owner, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt };
  }
  private async publicMaterial(command: ClientPublicCommand, expected: { tenantId: string; workspaceId: string }, signal?: AbortSignal) {
    this.live(signal);
    await this.scope(expected, signal);
    const request = await this.request(), material = await this.application.readPublic(request, command);
    const scope = await this.scopes.resolveScope(this.config.tenantCode, this.config.serviceCode);
    if (scope.tenantId !== expected.tenantId || scope.workspaceId !== expected.workspaceId) throw denied();
    await this.scope(expected, signal);
    this.live(signal);
    return { scope, value: material.publication, material: material.material };
  }
  private async client(signal?: AbortSignal) {
    const request = await this.request();
    const session = createAiGuardedClientSession(this.dependencies.guard, { current: async () => {
      this.live(signal);
      if (typeof request.headers.authorization !== 'string') throw denied();
      return { authorization: request.headers.authorization, ip: request.ip };
    } });
    const identity = await session.current();
    this.live(signal);
    if (identity.tenantCode !== this.config.tenantCode || identity.workspaceCode !== this.config.serviceCode) throw denied();
    await this.scope(identity, signal);
    return { identity, session };
  }
  private clientOwner(identity: ClientRequestContext): ClientPublicContinuityClient {
    const scope = { tenantId: identity.tenantId, workspaceId: identity.workspaceId };
    return { ...scope, channel: this.config.channel, appId: this.config.appId ?? null, principalKind: identity.customerType,
      principalHash: hash({ ...scope, channel: this.config.channel, appId: this.config.appId ?? null,
        customerId: identity.customerId, customerType: identity.customerType, sessionId: identity.sessionId }) };
  }
  private target(identity: ClientRequestContext, publication: { scope: { tenantId: string; workspaceId: string }; value: unknown }) {
    if (identity.tenantId !== publication.scope.tenantId || identity.workspaceId !== publication.scope.workspaceId) throw denied();
    return { ...this.clientOwner(identity),
      bindingHash: hash({ publication: { scope: publication.scope, value: publication.value }, identity, appId: this.config.appId ?? null })
    } satisfies ClientPublicContinuityTarget;
  }
  private continuationPacket(receipt: ClientPublicContinuation) {
    return freezeOriginalInput(aiClientPublicContinuationResponseSchema.parse({ state: 'observed' as const, operationKey: receipt.operationKey, publicRef: receipt.publicRef,
      materialRef: receipt.materialRef, materialOperationKey: receipt.materialOperationKey, inputHash: receipt.materialInputHash,
      materialHash: receipt.materialHash, expiresAt: receipt.expiresAt, execution: 'not_attested' as const,
      continuation: 'public_request_only_current_client_material' as const, retryable: false as const,
      nextAction: 'read_original_public_continuation' as const }));
  }

  async prepare(value: unknown, signal?: AbortSignal) {
    const command = parse(prepareSchema, value), observed = await this.owner('read', signal);
    const prior = await this.repository.readOriginal(observed.owner, command.operationKey);
    if (prior) {
      if (hash(prior.row.command) !== hash(command.command)) throw stale();
      return this.readOriginal({ operationKey: command.operationKey }, signal);
    }
    const before = await this.owner('write', signal);
    if (jsonHash(before) !== jsonHash(observed)) throw denied();
    const publication = await this.publicMaterial(command.command, before.owner, signal);
    const check = async () => {
      await this.dependencies.publication?.assertCurrent();
      const current = await this.owner('write', signal), latest = await this.publicMaterial(command.command, before.owner, signal);
      if (jsonHash(current) !== jsonHash(before) || jsonHash(publication) !== jsonHash(latest)) throw stale();
      if (jsonHash(await this.owner('write', signal)) !== jsonHash(before)) throw denied();
      await this.dependencies.publication?.assertCurrent();
      if (before.expiresAt <= this.now()) throw denied();
      this.live(signal);
    };
    const createdAt = this.now(), expiresAt = new Date(Math.min(createdAt.getTime() + 300000, before.expiresAt.getTime()));
    const row = { ...publication.scope, channel: this.config.channel, principalKind: 'anonymous' as const,
      principalHash: before.owner.principalHash, id: clientPublicMaterialId({ owner: before.owner, operationKey: command.operationKey }),
      operationKey: command.operationKey, command: command.command, material: publication.material, publication: publication.value,
      bindingHash: hash({ publication: { scope: publication.scope, value: publication.value }, owner: before.owner }),
      publicationHash: jsonHash(publication.value), inputHash: hash(command.command), materialHash: jsonHash(publication.material),
      revision: 1 as const, createdAt, expiresAt };
    const saved = await this.repository.record(before.owner, row, { issuedAt: before.issuedAt, expiresAt: before.expiresAt }, check);
    if (saved.replayed) return this.readOriginal({ operationKey: command.operationKey }, signal);
    try {
      await check();
      return freezeOriginalInput(aiClientPublicPreparationResponseSchema.parse({ state: 'observed' as const, operationKey: command.operationKey, publicRef: saved.row.id,
        kind: saved.row.command.kind, inputHash: saved.row.inputHash, materialHash: saved.row.materialHash,
        material: saved.row.material, publication: saved.row.publication, expiresAt: saved.row.expiresAt.toISOString(),
        execution: 'public_read_only' as const, continuation: 'explicit_current_client_required' as const,
        retryable: false as const, nextAction: 'read_original_public_operation' as const }));
    } catch { throw new ClientPublicContinuityUnknownError(); }
  }

  async readOriginal(value: unknown, signal?: AbortSignal) {
    const command = parse(readSchema, value), before = await this.owner('read', signal);
    const original = await this.repository.readOriginal(before.owner, command.operationKey), current = await this.owner('read', signal);
    if (jsonHash(before) !== jsonHash(current)) throw denied();
    const latest = await this.repository.readOriginal(before.owner, command.operationKey);
    if (jsonHash(original) !== jsonHash(latest)) throw stale();
    if (jsonHash(await this.owner('read', signal)) !== jsonHash(before)) throw denied();
    const row = original?.row;
    // This is an original locator observation. Expiry or absence cannot grant
    // another write, and old public content is not delivered after withdrawal.
    return freezeOriginalInput(aiClientPublicOperationResponseSchema.parse({ state: row ? 'observed' as const : 'unknown' as const, operationKey: command.operationKey,
      publicRef: row?.id ?? null, kind: row?.command.kind ?? null, inputHash: row?.inputHash ?? null,
      materialHash: row?.materialHash ?? null, expiresAt: row?.expiresAt.toISOString() ?? null,
      expiredAtObservation: row ? row.expiresAt <= this.now() : null, execution: 'not_attested' as const,
      retryable: false as const, nextAction: 'read_original_public_operation' as const }));
  }

  async continueOriginal(value: unknown, signal?: AbortSignal) {
    const { decision: _decision, ...command } = parse(continuationSchema, value);
    const client = await this.client(signal);
    // A previous commit is observed through current client Auth before checking
    // anonymous/material TTL or publication for any new preparation.
    if (await this.repository.readContinuation(this.clientOwner(client.identity), command)) return this.readContinuation(command, signal);
    const before = await this.owner('write', signal);
    const original = await this.repository.readOriginalReference(before.owner, command.publicRef);
    if (!original || original.row.id !== command.publicRef || original.row.materialHash !== command.expectedMaterialHash) throw denied();
    const publication = await this.publicMaterial(original.row.command, before.owner, signal);
    const target = this.target(client.identity, publication);
    const check = async () => {
      await this.dependencies.publication?.assertCurrent();
      const owner = await this.owner('write', signal), current = await client.session.current();
      const latest = await this.publicMaterial(original.row.command, before.owner, signal);
      const source = await this.repository.readOriginalReference(before.owner, command.publicRef);
      if (jsonHash(owner) !== jsonHash(before) || hash(current) !== hash(client.identity) || jsonHash(publication) !== jsonHash(latest)
        || jsonHash(source) !== jsonHash(original) || original.row.expiresAt <= this.now()) throw stale();
      if (hash(await client.session.current()) !== hash(client.identity)
        || jsonHash(await this.owner('write', signal)) !== jsonHash(before)) throw denied();
      await this.dependencies.publication?.assertCurrent();
      if (original.row.expiresAt <= this.now() || before.expiresAt <= this.now()) throw stale();
      this.live(signal);
    };
    await check();
    const createdAt = this.now(), materialOperationKey = `public-continuation:${hash({ publicRef: command.publicRef, operationKey: command.operationKey, target })}`;
    const row: AiClientSceneMaterial = { ...publication.scope, channel: this.config.channel, principalKind: target.principalKind,
      principalHash: target.principalHash, id: clientPublicMaterialId({ version: 'client-public-continuation-1', target, command }),
      bindingHash: target.bindingHash, publicationHash: jsonHash(publication.value), operationKey: materialOperationKey,
      inputHash: original.row.inputHash, materialHash: jsonHash(publication.material), command: original.row.command,
      material: publication.material, publication: publication.value, revision: 1, createdAt,
      expiresAt: new Date(Math.min(createdAt.getTime() + 300000, original.row.expiresAt.getTime(), before.expiresAt.getTime())) };
    await this.repository.continueOriginal(before.owner, target, command, row, check);
    try { return await this.readContinuation(command, signal); }
    catch { throw new ClientPublicContinuityUnknownError('read_original_public_continuation'); }
  }

  async readContinuation(value: unknown, signal?: AbortSignal) {
    const command = parse(clientPublicContinuationReadSchema, value), before = await this.client(signal);
    // Receipt ownership survives anonymous/material TTL and publication changes,
    // but remains bound to the original CUSTOMER/session/surface. No content or
    // current-use grant escapes this independently authenticated metadata read.
    const target = this.clientOwner(before.identity);
    const result = await this.repository.readContinuation(target, command);
    const current = await before.session.current();
    if (hash(current) !== hash(before.identity)) throw denied();
    const latest = await this.repository.readContinuation(target, command);
    if (jsonHash(result) !== jsonHash(latest)) throw stale();
    await this.scope(before.identity, signal);
    if (hash(await before.session.current()) !== hash(before.identity)) throw denied();
    this.live(signal);
    return result ? this.continuationPacket(result.receipt) : freezeOriginalInput(aiClientPublicContinuationResponseSchema.parse({ state: 'unknown' as const,
      operationKey: command.operationKey, publicRef: command.publicRef, materialRef: null, execution: 'not_attested' as const,
      retryable: false as const, nextAction: 'read_original_public_continuation' as const }));
  }
}
