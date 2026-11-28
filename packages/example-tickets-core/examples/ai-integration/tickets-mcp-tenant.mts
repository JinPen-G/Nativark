/** 工单tenant的人工同意、发布与当前grant权威，参加原OAuth的同一Native事务。
 * 身份只取原Auth及其持久会话；不创建workspace、角色、凭据状态机、模型或默认政策。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { infer as ZodInfer } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlatformAuthService, PlatformPrincipalAuthority } from "@rental-os/platform-server";
import { getRequestIdentity, runWithRequestIdentity } from "@rental-os/platform-server/request-identity";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";
import { requestFingerprint as hash } from "@rental-os/platform-contracts/request-fingerprint";
import { TicketIdSchema, TicketError, type TicketsService, type TicketAiRouteState } from "@rental-os/example-tickets-core";
import { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";
import { createPrismaPublicClientRegistry } from "@rental-os/mcp-server/prisma-public-client-registry";
import { createPublicClientAuthorization } from "@rental-os/mcp-server/public-client-authorization";
import type { OriginalOAuthConsentAuthority } from "@rental-os/mcp-server/persistent-oauth-authorization";
import type { CurrentOAuthGrant, OriginalOAuthAccessAuthority, OriginalOAuthGrantAuthority } from "@rental-os/mcp-server/persistent-oauth-tokens";

type Tx = Prisma.TransactionClient;
const { z } = createRequire(import.meta.url)("zod") as typeof import("zod");
export interface TicketsMcpBusiness {
  withTransaction<T>(native: Tx, consume: (service: TicketsService) => Promise<T>): Promise<T>;
}
const uuid = z.string().uuid(), revision = z.number().int().min(1).max(2147483647);
const seconds = z.number().int().positive().safe(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const clientId = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
export { TICKETS_MCP_SCOPES, TicketsMcpPolicySchema, TicketsMcpPublishSchema } from "@rental-os/example-tickets-core/mcp-http";
import { TICKETS_MCP_SCOPES, TicketsMcpPolicySchema, TicketsMcpPublishSchema } from "@rental-os/example-tickets-core/mcp-http";
const principalSchema = z.object({ tenantId: TicketIdSchema, subjectId: TicketIdSchema, audience: z.literal("operator") }).strict();
const sessionSchema = z.object({ sessionId: uuid, expiresAt: seconds, workspaceId: TicketIdSchema.nullable() }).strict();
const ownerSchema = z.object({ principal: principalSchema, session: sessionSchema }).strict();
type Owner = ZodInfer<typeof ownerSchema>;
const consentSchema = ownerSchema.extend({ id: uuid, revision: z.union([z.literal(1), z.literal(2)]), requestHash: digest,
  policyHash: digest, policy: TicketsMcpPolicySchema, redirectUri: z.string().url().max(2048), expiresAt: seconds, reviewHash: digest,
  decision: z.enum(["pending", "approved", "denied"]), grantId: uuid.nullable(), grantSubject: uuid.nullable() }).strict();
type Consent = ZodInfer<typeof consentSchema>;
const grantSchema = ownerSchema.extend({ id: uuid, subject: uuid, consentId: uuid, requestHash: digest,
  policyHash: digest, policy: TicketsMcpPolicySchema, expiresAt: seconds }).strict();
export type TicketsMcpGrant = ZodInfer<typeof grantSchema> & { revision: number; revoked: boolean };
export const TICKETS_MCP_TRANSACTION = { isolationLevel: "Serializable", maxWait: 2500, timeout: 15000 } as const;
export class TicketsMcpError extends Error {
  readonly retryable = false;
  constructor(readonly kind: "denied" | "unavailable" | "changed" | "unknown", readonly availability?: TicketAiRouteState) { super(`TICKETS_MCP_${kind.toUpperCase()}`); }
}
const fail = () => new TicketsMcpError("unavailable"), deny = () => new TicketsMcpError("denied"), changed = () => new TicketsMcpError("changed");
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail(); };
const decode = (raw: unknown): unknown => typeof raw === "string" ? JSON.parse(raw) : raw;
const same = (a: unknown, b: unknown) => hash(a) === hash(b);

export function createTicketsMcpTenant(input: { database: PrismaClient;
  auth: Pick<PlatformAuthService, "resolveAccessContext">; principals: Pick<PlatformPrincipalAuthority<Tx>, "lock">;
  tickets: TicketsMcpBusiness; resource: string; authorizationEndpoint: string;
  /** 同Native核原MCP数据能力与本Core选装迁移；不得只看表存在或包已安装。 */
  assertDataAvailable(native: Tx): Promise<void> }) {
  const resource = new URL(input.resource);
  if (resource.protocol !== "https:" || resource.href !== input.resource || resource.username || resource.password || resource.search || resource.hash) throw fail();
  const browser = new AsyncLocalStorage<{ owner: Owner; active: boolean; consentId?: string }>();
  const registrations = createPrismaPublicClientRegistry(input.database);
  const validateAuthorization = createPublicClientAuthorization({ authorizationEndpoint: input.authorizationEndpoint,
    resourceUrl: resource.href, allowedScopes: TICKETS_MCP_SCOPES, timeoutMs: 15000 }, registrations);
  const currentBrowser = () => {
    const entry = browser.getStore(), identity = getRequestIdentity();
    if (!entry?.active || !identity || identity.audience !== "operator" || identity.isSaasAdmin !== false
      || identity.workspaceId !== undefined || identity.staffApi || !same(identity.accessSession, entry.owner.session)
      || identity.userId !== entry.owner.principal.subjectId || identity.tenantId !== entry.owner.principal.tenantId) throw deny();
    return entry;
  };
  const ownerIn = async (native: Tx, who: Owner, signal: AbortSignal, requireRead = true) => {
    live(signal); await input.assertDataAvailable(native); live(signal);
    const lease = await input.principals.lock(native, who.principal, who.principal.tenantId);
    const user = await lease.revalidate();
    if (user.isSaasAdmin || who.session.expiresAt <= Date.now() / 1000
      || requireRead && !hasEffectivePermission(user.permissions, "example-tickets:ticket:read"))
      throw new TicketsMcpError("denied", { state: "denied", reason: "permission_denied" });
    return lease;
  };
  const coreIn = (native: Tx, who: Owner) => input.tickets.withTransaction(native,
    async service => { await service.list(who.principal, { offset: 0, limit: 1 }); });
  async function readPolicy(native: Tx, tenantId: string, selectedClient: string) {
    const rows = await native.$queryRaw<Array<{ revision: number; record_json: unknown }>>`
      SELECT revision, record_json FROM example_tickets_mcp_policies WHERE tenant_id = ${tenantId} AND client_id = ${selectedClient} FOR UPDATE`;
    if (rows.length > 1) throw fail(); if (!rows.length) return undefined;
    const policy = TicketsMcpPolicySchema.parse(decode(rows[0].record_json));
    if (policy.revision !== rows[0].revision || policy.clientId !== selectedClient || policy.resource !== resource.href) throw fail();
    return policy;
  }
  async function published(native: Tx, who: Owner, selectedClient: string, signal: AbortSignal) {
    const policy = await readPolicy(native, who.principal.tenantId, selectedClient);
    const registration = await registrations.readIn(native, selectedClient, signal);
    if (!policy) throw new TicketsMcpError("denied", { state: "unpublished", reason: "tool_not_published" });
    if (policy.expiresAt <= Date.now() / 1000) throw new TicketsMcpError("denied", { state: "unpublished", reason: "publication_expired" });
    if (!policy.enabled || !registration?.enabled
      || registration.revision !== policy.clientRevision || registration.expiresAt <= Date.now() / 1000
      || policy.scopes.some(scope => !registration.scopes.includes(scope))) throw deny();
    return { policy, registration };
  }
  async function readConsent(native: Tx, id: string): Promise<Consent | undefined> {
    const rows = await native.$queryRaw<Array<{ tenant_id: string; user_id: string; revision: number; record_json: unknown }>>`
      SELECT tenant_id, user_id, revision, record_json FROM example_tickets_mcp_consents WHERE id = ${uuid.parse(id)} FOR UPDATE`;
    if (rows.length > 1) throw fail(); if (!rows.length) return undefined;
    const consent = consentSchema.parse(decode(rows[0].record_json));
    if (consent.id !== id || consent.revision !== rows[0].revision || consent.principal.tenantId !== rows[0].tenant_id
      || consent.principal.subjectId !== rows[0].user_id || consent.policy.resource !== resource.href
      || consent.policyHash !== hash(consent.policy) || (consent.decision === "pending") !== (consent.revision === 1)
      || (consent.decision === "approved") !== (consent.grantId !== null && consent.grantSubject !== null)) throw fail();
    return consent;
  }
  async function readGrant(native: Tx, id: string): Promise<TicketsMcpGrant | undefined> {
    const rows = await native.$queryRaw<Array<{ tenant_id: string; user_id: string; consent_id: string; revision: number; revoked: number | boolean; record_json: unknown }>>`
      SELECT tenant_id, user_id, consent_id, revision, revoked, record_json FROM example_tickets_mcp_grants WHERE id = ${uuid.parse(id)} FOR UPDATE`;
    if (rows.length > 1) throw fail(); if (!rows.length) return undefined;
    const row = rows[0], grant = grantSchema.parse(decode(row.record_json));
    if (grant.id !== id || grant.principal.tenantId !== row.tenant_id || grant.principal.subjectId !== row.user_id
      || grant.consentId !== row.consent_id || grant.policyHash !== hash(grant.policy) || grant.policy.resource !== resource.href
      || ![0, 1, false, true].includes(row.revoked)) throw fail();
    return { ...grant, revision: revision.parse(row.revision), revoked: row.revoked === 1 || row.revoked === true };
  }
  const audit = async (native: Tx, who: Owner, action: string, detail: Record<string, unknown>, id: string = randomUUID()) => {
    await native.operationLog.create({ data: { id, tenantId: who.principal.tenantId, userId: who.principal.subjectId,
      workspaceId: null, action: `example-tickets.mcp.${action}`, detail: JSON.parse(JSON.stringify(detail)) } });
  };
  async function asBrowser<T>(work: (native: Tx, who: Owner) => Promise<T>, signal: AbortSignal, writes = false, requireRead = true): Promise<T> {
    const entry = currentBrowser(); let callbackCompleted = false;
    try {
      const result = await input.database.$transaction(async native => {
        const lease = await ownerIn(native, entry.owner, signal, requireRead);
        const result = await work(native, entry.owner);
        await lease.revalidate(); currentBrowser(); live(signal); callbackCompleted = writes; return result;
      }, TICKETS_MCP_TRANSACTION);
      currentBrowser(); live(signal); return result;
    } catch (error) { if (callbackCompleted) throw new TicketsMcpError("unknown"); throw error; }
  }
  async function currentGrant(native: Tx, id: string, signal: AbortSignal): Promise<TicketsMcpGrant | undefined> {
    live(signal); await input.assertDataAvailable(native);
    const grant = await readGrant(native, id);
    if (!grant || grant.revoked || grant.expiresAt <= Date.now() / 1000) return undefined;
    // 只恢复人工同意时由原Auth核过的会话定位；原principal随即锁定并复验当前会话/租户/账号/角色。
    // 此上下文不含缓存权限、经营workspace或客户自报身份，也不延长原签名的到期时间。
    return runWithRequestIdentity({ tenantId: grant.principal.tenantId, userId: grant.principal.subjectId, audience: "operator",
      isSaasAdmin: false, accessSession: { ...grant.session } }, async () => {
      const lease = await ownerIn(native, grant, signal), consent = await readConsent(native, grant.consentId);
      if (!consent || consent.decision !== "approved" || consent.grantId !== grant.id || consent.grantSubject !== grant.subject
        || !same(consent.principal, grant.principal) || !same(consent.session, grant.session) || consent.policyHash !== grant.policyHash
        || consent.requestHash !== grant.requestHash || consent.expiresAt !== grant.expiresAt) throw deny();
      const { policy } = await published(native, grant, grant.policy.clientId, signal);
      if (hash(policy) !== grant.policyHash) throw deny();
      await coreIn(native, grant); await lease.revalidate(); live(signal); return grant;
    });
  }
  const projection = (grant: TicketsMcpGrant): CurrentOAuthGrant => ({ id: grant.id, subject: grant.subject, revision: grant.revision,
    clientId: grant.policy.clientId, resource: resource.href, scopes: [...grant.policy.scopes], expiresAt: grant.expiresAt });
  const grantForOAuth = async (native: Tx, id: string, signal: AbortSignal) => {
    try { return await currentGrant(native, id, signal); }
    catch (error) {
      // 只有原权威明确拒绝才是无有效grant；数据/账/结构异常继续交原OAuth不可用分支。
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException
        || error instanceof TicketsMcpError && error.kind === "denied"
        || error instanceof TicketError && ["denied", "not_found"].includes(error.code)) return undefined;
      throw error;
    }
  };
  const store = createPrismaOAuthStore(input.database, { async record(native, authorization, signal) {
    const who = currentBrowser().owner, consent = await readConsent(native, authorization.authorizationId);
    if (!consent || !same(consent.principal, who.principal) || consent.decision !== "approved"
      || consent.revision !== authorization.authorizationRevision || consent.grantId !== authorization.grantId) throw deny();
    live(signal); await audit(native, who, "code-issued", authorization);
  } });
  const access: OriginalOAuthAccessAuthority = { async current(id, transaction, signal) {
    const grant = await grantForOAuth(store.native(transaction), id, signal); return grant && projection(grant);
  } };
  const issuance: OriginalOAuthGrantAuthority = { async current(id, selectedClient, clientRevision, transaction, signal) {
    const grant = await grantForOAuth(store.native(transaction), id, signal);
    return grant && grant.policy.clientId === selectedClient && grant.policy.clientRevision === clientRevision ? projection(grant) : undefined;
  }, async revocationOwner(id, selectedClient, transaction, signal) {
    // 原凭据先证明family归属；停用客户端/会话也可撤回本人原族，不恢复新访问权。
    const native = store.native(transaction); live(signal); await input.assertDataAvailable(native);
    const grant = await readGrant(native, id); live(signal); return grant?.policy.clientId === selectedClient;
  } };
  const consent: OriginalOAuthConsentAuthority = { async current(request, _http, transaction, signal) {
    const entry = currentBrowser(); if (!entry.consentId) throw deny();
    const native = store.native(transaction), lease = await ownerIn(native, entry.owner, signal);
    const saved = await readConsent(native, entry.consentId);
    if (!saved || !same(saved.principal, entry.owner.principal) || !same(saved.session, entry.owner.session)
      || saved.requestHash !== hash(request) || saved.expiresAt <= Date.now() / 1000 || saved.decision === "pending") throw deny();
    await lease.revalidate(); currentBrowser(); live(signal);
    if (saved.decision === "denied") return { kind: "denied", error: "access_denied" };
    const grant = await currentGrant(native, saved.grantId!, signal); if (!grant) throw deny();
    return { kind: "approved", id: saved.id, revision: saved.revision, expiresAt: saved.expiresAt, request, grant: projection(grant) };
  } };
  const publicConsent = (value: Consent) => ({ id: value.id, revision: value.revision, decision: value.decision,
    clientId: value.policy.clientId, resource: value.policy.resource, scopes: [...value.policy.scopes], fieldPolicy: value.policy.fieldPolicy,
    redirectUri: value.redirectUri, expiresAt: value.expiresAt, reviewHash: value.reviewHash,
    grantId: value.grantId, executionGranted: false as const, retryable: false as const });
  const publicationId = (who: Owner, operationId: string) => {
    const h = hash(["tickets-mcp-publication", who.principal, uuid.parse(operationId)]);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  return Object.freeze({ store, registrations, access, issuance, consent, currentGrantIn: currentGrant, readGrantIn: readGrant,
    policyIn: readPolicy,
    /** 只供已核宿主参加者；同一Native与原身份包住业务回调，并在返回前再次复核。 */
    async withGrantIn<T>(native: Tx, id: string, consume: (grant: Readonly<TicketsMcpGrant>) => Promise<T>, signal: AbortSignal): Promise<T> {
      const grant = await currentGrant(native, id, signal); if (!grant) throw deny();
      return runWithRequestIdentity({ tenantId: grant.principal.tenantId, userId: grant.principal.subjectId, audience: "operator",
        isSaasAdmin: false, accessSession: { ...grant.session } }, async () => {
        const result = await consume(grant);
        if (!same(grant, await currentGrant(native, id, signal))) throw deny(); live(signal); return result;
      });
    },
    withBrowserGrant: <T,>(id: string, consume: (native: Tx, grant: Readonly<TicketsMcpGrant>) => Promise<T>, signal: AbortSignal) =>
      asBrowser(async (native, who) => {
        const grant = await currentGrant(native, id, signal);
        if (!grant || !same(grant.principal, who.principal) || !same(grant.session, who.session)) throw deny();
        const result = await consume(native, grant);
        if (!same(grant, await currentGrant(native, id, signal))) throw deny(); return result;
      }, signal, true),
    /** 原记录回读独立核当前登录人与持久owner；撤权不抹掉原账，也不恢复工具读取权。 */
    withBrowserOwnedGrant: <T,>(id: string, consume: (native: Tx, grant: Readonly<TicketsMcpGrant>) => Promise<T>, signal: AbortSignal) =>
      asBrowser(async (native, who) => {
        const grant = await readGrant(native, id);
        if (!grant || !same(grant.principal, who.principal)) throw deny();
        return consume(native, grant);
      }, signal, false, false),
    /** 控制面入口必须先经原Guard建ALS；整个回调内可以消费原service.authorize，但不能泄出绑定。 */
    async withBrowser<T>(request: { headers: { authorization?: unknown } }, work: () => Promise<T>, consentId?: string): Promise<T> {
      if (browser.getStore()) throw deny();
      const identity = getRequestIdentity(), header = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/).parse(request.headers.authorization);
      const resolved = await input.auth.resolveAccessContext(header), who = resolved?.tenantUser, session = resolved?.accessSession;
      if (!who || !session || !identity || identity.isSaasAdmin !== false || who.isSaasAdmin || who.mustChangePassword
        || identity.audience !== "operator" || identity.workspaceId !== undefined || identity.staffApi
        || identity.userId !== who.id || identity.tenantId !== who.tenantId || !same(identity.accessSession, session)) throw deny();
      const entry = { owner: ownerSchema.parse({ principal: { tenantId: who.tenantId, subjectId: who.id, audience: "operator" }, session }),
        active: true, ...(consentId ? { consentId: uuid.parse(consentId) } : {}) };
      try { return await browser.run(entry, work); } finally { entry.active = false; }
    },
    readConsent: (id: string, signal: AbortSignal) => asBrowser(async (native, who) => {
      const saved = await readConsent(native, id);
      if (saved && !same(saved.principal, who.principal)) throw deny();
      return { consent: saved ? publicConsent(saved) : null, retryable: false as const, absence: "not_proof_of_no_commit" as const };
    }, signal, false, false),
    async prepareConsent(operationId: string, authorizationRequest: Request, signal: AbortSignal) {
      currentBrowser();
      const request = await validateAuthorization(authorizationRequest, signal);
      return asBrowser(async (native, who) => {
      const id = uuid.parse(operationId), { policy, registration } = await published(native, who, request.clientId, signal);
      if (request.resource !== resource.href || request.clientRevision !== registration.revision || !same(request.scopes, policy.scopes)) throw deny();
      await coreIn(native, who);
      const prior = await readConsent(native, id);
      if (prior) {
        if (!same(prior.principal, who.principal) || !same(prior.session, who.session) || prior.requestHash !== hash(request)) throw changed();
        return publicConsent(prior);
      }
      const expiresAt = Math.min(who.session.expiresAt, policy.expiresAt, registration.expiresAt, Math.floor(Date.now() / 1000) + 600);
      if (expiresAt <= Date.now() / 1000) throw deny();
      const reviewHash = hash({ version: "tickets-mcp-consent-1", principal: who.principal, requestHash: hash(request), policy, expiresAt });
      const saved = consentSchema.parse({ ...who, id, revision: 1, requestHash: hash(request), policyHash: hash(policy), policy, redirectUri: request.redirectUri,
        expiresAt, reviewHash, decision: "pending", grantId: null, grantSubject: null });
      if (await native.$executeRaw`INSERT INTO example_tickets_mcp_consents (id, tenant_id, user_id, revision, record_json)
        VALUES (${id}, ${who.principal.tenantId}, ${who.principal.subjectId}, 1, ${JSON.stringify(saved)})` !== 1) throw fail();
      await audit(native, who, "consent-prepared", { id, reviewHash }); return publicConsent(saved);
      }, signal, true);
    },
    decide: (id: string, reviewedHash: string, decision: "approved" | "denied", signal: AbortSignal) => asBrowser(async (native, who) => {
      z.enum(["approved", "denied"]).parse(decision); const saved = await readConsent(native, id);
      if (!saved || !same(saved.principal, who.principal) || !same(saved.session, who.session)
        || saved.reviewHash !== digest.parse(reviewedHash) || saved.expiresAt <= Date.now() / 1000) throw deny();
      if (saved.decision !== "pending") throw changed();
      const { policy } = await published(native, who, saved.policy.clientId, signal);
      if (hash(policy) !== saved.policyHash) throw changed(); await coreIn(native, who);
      const next = consentSchema.parse({ ...saved, revision: 2, decision,
        grantId: decision === "approved" ? randomUUID() : null, grantSubject: decision === "approved" ? randomUUID() : null });
      if (await native.$executeRaw`UPDATE example_tickets_mcp_consents SET revision = 2, record_json = ${JSON.stringify(next)} WHERE id = ${id} AND revision = 1` !== 1) throw changed();
      if (decision === "approved") {
        const grant = grantSchema.parse({ ...who, id: next.grantId, subject: next.grantSubject, consentId: id,
          requestHash: saved.requestHash, policyHash: saved.policyHash, policy, expiresAt: saved.expiresAt });
        if (await native.$executeRaw`INSERT INTO example_tickets_mcp_grants (id, tenant_id, user_id, consent_id, revision, revoked, record_json)
          VALUES (${grant.id}, ${who.principal.tenantId}, ${who.principal.subjectId}, ${id}, 1, 0, ${JSON.stringify(grant)})` !== 1) throw fail();
      }
      await audit(native, who, "consent-decided", { id, decision, reviewHash: saved.reviewHash, grantId: next.grantId });
      return publicConsent(next);
    }, signal, true),
    grant: (id: string, signal: AbortSignal) => asBrowser(async (native, who) => {
      const grant = await readGrant(native, id); if (grant && !same(grant.principal, who.principal)) throw deny();
      return { grant: grant ? { id: grant.id, revision: grant.revision, revoked: grant.revoked, expiresAt: grant.expiresAt,
        clientId: grant.policy.clientId, scopes: [...grant.policy.scopes] } : null,
        retryable: false as const, absence: "not_proof_of_no_commit" as const };
    }, signal, false, false),
    revoke: (id: string, expectedRevision: number, signal: AbortSignal) => asBrowser(async (native, who) => {
      const grant = await readGrant(native, id); if (!grant || !same(grant.principal, who.principal)) throw deny();
      if (grant.revoked || grant.revision !== revision.parse(expectedRevision) || expectedRevision === 2147483647) throw changed();
      if (await native.$executeRaw`UPDATE example_tickets_mcp_grants SET revision = revision + 1, revoked = 1 WHERE id = ${id} AND revision = ${expectedRevision} AND revoked = 0` !== 1) throw changed();
      await audit(native, who, "grant-revoked", { id, revision: expectedRevision + 1 });
      return { id, revision: expectedRevision + 1, revoked: true as const, retryable: false as const };
    }, signal, true, false),
    publication: (selectedClient: string, signal: AbortSignal) => asBrowser(async (native, who) => {
      const lease = await ownerIn(native, who, signal);
      if (!hasEffectivePermission((await lease.revalidate()).permissions, "system:params:manage")) throw deny();
      return { policy: await readPolicy(native, who.principal.tenantId, clientId.parse(selectedClient)) ?? null, executionGranted: false as const };
    }, signal),
    publicationOperation: (operationId: string, signal: AbortSignal) => asBrowser(async (native, who) => {
      const lease = await ownerIn(native, who, signal);
      if (!hasEffectivePermission((await lease.revalidate()).permissions, "system:params:manage")) throw deny();
      const original = await native.operationLog.findUnique({ where: { id: publicationId(who, operationId) } });
      if (original && (original.tenantId !== who.principal.tenantId || original.userId !== who.principal.subjectId
        || original.workspaceId !== null || original.action !== "example-tickets.mcp.published")) throw fail();
      const receipt = original ? z.object({ operationId: uuid, commandHash: digest, policy: TicketsMcpPolicySchema }).strict().parse(original.detail) : null;
      if (receipt && receipt.operationId !== operationId) throw fail();
      return { receipt, retryable: false as const, absence: "not_proof_of_no_commit" as const };
    }, signal),
    publish: (value: unknown, signal: AbortSignal) => asBrowser(async (native, who) => {
      const command = TicketsMcpPublishSchema.parse(value), lease = await ownerIn(native, who, signal), user = await lease.revalidate();
      if (!hasEffectivePermission(user.permissions, "system:params:manage") || command.resource !== resource.href) throw deny();
      const registered = await registrations.readIn(native, command.clientId, signal);
      if (!registered || registered.revision !== command.clientRevision || command.scopes.some(scope => !registered.scopes.includes(scope))
        || command.expiresAt <= Date.now() / 1000 || command.expiresAt > registered.expiresAt) throw deny();
      const { operationId, expectedRevision, ...fields } = command, previous = await readPolicy(native, who.principal.tenantId, command.clientId);
      const logId = publicationId(who, operationId);
      const original = await native.operationLog.findUnique({ where: { id: logId } });
      if (original) throw changed(); // 同键的原结果走独立读取，不能把重发当成新发布。
      if ((previous?.revision ?? null) !== expectedRevision || expectedRevision === 2147483647) throw changed();
      const policy = TicketsMcpPolicySchema.parse({ ...fields, revision: (previous?.revision ?? 0) + 1 });
      const count = previous ? await native.$executeRaw`UPDATE example_tickets_mcp_policies SET revision = ${policy.revision}, record_json = ${JSON.stringify(policy)}
        WHERE tenant_id = ${who.principal.tenantId} AND client_id = ${command.clientId} AND revision = ${expectedRevision}`
        : await native.$executeRaw`INSERT INTO example_tickets_mcp_policies (tenant_id, client_id, revision, record_json)
          VALUES (${who.principal.tenantId}, ${command.clientId}, ${policy.revision}, ${JSON.stringify(policy)})`;
      if (count !== 1) throw changed();
      const receipt = { operationId, commandHash: hash(command), policy };
      await audit(native, who, "published", receipt, logId); await lease.revalidate(); return receipt;
    }, signal, true)
  });
}
export type TicketsMcpTenant = ReturnType<typeof createTicketsMcpTenant>;
