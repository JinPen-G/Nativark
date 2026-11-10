"use strict";
require('reflect-metadata');
/** Original Auth/Platform/Guard and bounded reader, with explicit external
 * Prisma/current-grant and Nest decorator/exception facades. No API boot or DB. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { createRequire, registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../../..");
// An explicit existing toolchain may be read for dependencies; all tested sources stay in root.
const toolchainRoot = path.resolve(process.env.MCP_TEST_TOOLCHAIN_ROOT || path.join(root, "clients/agent-desktop/harness"));
const installed = createRequire(path.join(toolchainRoot, "packages/mcp/mcp-client/package.json"));
const ts = require(path.join(toolchainRoot, "node_modules/typescript/lib/typescript.js"));
const output = fs.mkdtempSync(path.join(process.env.MCP_TEST_OUTPUT_ROOT || path.join(root, "output"), "mcp-trusted-principal-verification-"));
const packageRoot = path.join(root, "packages/shared"), staged = path.join(output, "node_modules/@rental-os/shared");
fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(staged, "package.json"));
const parsed = ts.readConfigFile(path.join(packageRoot, "tsconfig.json"), ts.sys.readFile);
const configured = ts.parseJsonConfigFileContent(parsed.config, ts.sys, packageRoot);
const typeRoots = [path.join(toolchainRoot, "node_modules/@types")];
const options = { ...configured.options, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16,
  composite: false, rootDir: path.join(packageRoot, "src"), outDir: path.join(staged, "dist"), typeRoots,
  paths: { zod: [path.join(path.dirname(installed.resolve("zod/package.json")), "index.d.cts")] } };
// Explicit same-worktree artifact reuse avoids repeated bulk disk emission. A
// fresh strict compile compares EVERY emitted JS/declaration byte; stale output
// rejects, never suppresses diagnostics or borrows another worktree's build.
const verifiedShared = process.env.MCP_VERIFIED_SHARED_ARTIFACT;
const runtimeShared = verifiedShared ? fs.realpathSync(verifiedShared) : staged;
if (verifiedShared) {
  const relative = path.relative(fs.realpathSync(path.join(root, 'output')), runtimeShared);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(runtimeShared, 'package.json'), 'utf8'), fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
}
function check(program, verifiedArtifact) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const emitted = verifiedArtifact ? program.emit(undefined, (file, data) => {
    const relative = path.relative(options.outDir, file);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(data, fs.readFileSync(path.join(verifiedArtifact, 'dist', relative), 'utf8'), 'Current shared source differs from verified artifact: ' + relative);
  }) : program.emit();
  assert.equal(emitted.emitSkipped, false); assert.equal(emitted.diagnostics.length, 0);
}
check(ts.createProgram(configured.fileNames, options), verifiedShared ? runtimeShared : undefined);
check(ts.createProgram([path.join(root, "apps/api/src/modules/auth/trusted-workspace-principal.ts")], {
  strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ["node"], typeRoots,
  rootDir: path.join(root, "apps/api/src/modules/auth"), outDir: path.join(output, "principal-types"),
  paths: { "@rental-os/shared": [path.join(runtimeShared, "dist/index.d.ts")] },
}));
const catalogConsumer = path.join(output, 'catalog-consumer.mts');
fs.writeFileSync(catalogConsumer, [
  'import { aiCatalogReadInputSchema, aiCatalogReadProjectionSchema } from "@rental-os/shared";',
  'import type { AiCatalogReadProjection } from "@rental-os/shared";',
  'export const parseOriginalCatalog = (value: unknown): ReturnType<typeof aiCatalogReadInputSchema.parse> => aiCatalogReadInputSchema.parse(value);',
  'export const parseOriginalProjection = (value: unknown): AiCatalogReadProjection => aiCatalogReadProjectionSchema.parse(value);',
  'export const retainOriginalProjection = (value: AiCatalogReadProjection): AiCatalogReadProjection => value;',
].join('\n'));
check(ts.createProgram([catalogConsumer], { strict: true, skipLibCheck: true, declaration: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: ['node'], typeRoots, rootDir: output, outDir: path.join(output, 'catalog-consumer-build'),
  paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] } }));
const catalogConsumerUrl = pathToFileURL(path.join(output, 'catalog-consumer-build/catalog-consumer.mjs')).href;
const prefix = pathToFileURL(runtimeShared + path.sep).href;
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(prefix) && specifier === "zod") return { url: pathToFileURL(installed.resolve("zod")).href, shortCircuit: true };
  if (verifiedShared && specifier === '@rental-os/shared' && context.parentURL?.startsWith(pathToFileURL(path.join(output, 'catalog-consumer-build') + path.sep).href))
    return { url: pathToFileURL(path.join(runtimeShared, 'dist/index.js')).href, shortCircuit: true };
  return next(specifier, context);
} });
const shared = require(path.join(runtimeShared, "dist/index.js"));
// Only external framework plumbing is substituted; no identity/Guard method is
// replaced. Actual Nest DI/bootstrap and actual Prisma types remain unverified.
class HttpException extends Error { constructor(message, status) { super(message); this.status = status; } getStatus() { return this.status; } }
const nest = { HttpException, Injectable: () => () => {}, Inject: () => () => {}, Optional: () => () => {}, Logger: class { warn() {} log() {} error() {} } };
for (const [name, status] of Object.entries({ ForbiddenException: 403, UnauthorizedException: 401, BadRequestException: 400, NotFoundException: 404, ConflictException: 409, ServiceUnavailableException: 503, InternalServerErrorException: 500 })) nest[name] = class extends HttpException { constructor(message) { super(message, status); } };
const prisma = { Prisma: { TransactionIsolationLevel: { Serializable: "Serializable", RepeatableRead: "RepeatableRead" }, sql: (strings, ...values) => ({ strings, values }), empty: { strings: [''], values: [] }, join: values => ({ values }),
  PrismaClientKnownRequestError: class extends Error { constructor(message, options) { super(message); this.code = options.code; } } },
  PrismaClient: class { constructor() { throw new Error('Offline fixture must not construct a PrismaClient'); } } };
for (const [, name, body] of fs.readFileSync(path.join(root, "apps/api/prisma/schema.prisma"), "utf8").matchAll(/enum\s+(\w+)\s*\{([^}]+)\}/g)) {
  prisma[name] = Object.fromEntries(body.split("\n").map(line => /^\s*(\w+)/.exec(line)?.[1]).filter(Boolean).map(value => [value, value]));
}
const cache = new Map();
function source(relative) {
  const file = path.resolve(root, relative); if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: false } });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const localRequire = specifier => {
    if (specifier === "@nestjs/common") return nest;
    if (specifier === "@nestjs/config") return { ConfigService: class {} };
    if (specifier === "@prisma/client") return prisma;
    if (specifier === "@rental-os/shared") return shared;
    if (specifier === "zod") return installed("zod");
    if (specifier === 'ajv' || specifier === 'ajv-formats') return installed(specifier);
    if (specifier === 'class-transformer' || specifier === 'class-validator') return require(specifier);
    if (specifier.startsWith("node:")) return require(specifier);
    if (specifier.startsWith(".")) return source(path.relative(root, path.resolve(path.dirname(file), specifier.endsWith(".js") ? specifier.slice(0, -3) + ".ts" : specifier + ".ts")));
    throw new Error("Unexpected external dependency: " + specifier);
  };
  new Function("require", "module", "exports", compiled.outputText)(localRequire, module, module.exports);
  return module.exports;
}
const { AuthService } = source("apps/api/src/modules/auth/auth.service.ts");
const { PlatformRepository } = source("apps/api/src/modules/platform/platform.repository.ts");
const { PlatformService } = source("apps/api/src/modules/platform/platform.service.ts");
const { ApiAuthGuard } = source("apps/api/src/common/api-auth.guard.ts");
const { AiCatalogReadFactsService } = source("apps/api/src/modules/ai-native/catalog-read-facts.service.ts");
const identity = source("apps/api/src/common/request-identity.ts");
const signal = () => new AbortController().signal;
function fixture() {
  const role = (id, permission, dataScope) => ({ id, name: id, isActive: true, fixedAllPermissions: false, scope: "OPERATOR", dataScope, buttonPermissions: [], permissions: [{ permission: { code: permission } }] });
  const f = { calls: [], binding: { userId: "user-a", tenantId: "tenant-a", workspaceId: "workspace-a", audience: "operator" }, mysql: true, configReads: 0,
    user: { id: "user-a", tenantId: "tenant-a", account: "a", displayName: "A", isActive: true, isSaasAdmin: false, isPlatformAdmin: false, mustChangePassword: false,
      organizationId: "org-a", organization: { name: "Org", type: "OPERATOR" }, roleAssignments: [{ role: role("tenant-role", "unrelated:permission", "ALL") }], role: null },
    member: { isActive: true, role: role("workspace-role", "rental-core:catalog:view", "ORGANIZATION"), dataScope: "ORGANIZATION", locationScope: { mode: "selected", locationIds: ["loc-a", "loc-outside"] } },
    workspace: { id: "workspace-a", tenantId: "tenant-a", status: "ACTIVE" }, coreReads: 0, currentReads: 0 };
  const tx = f.tx = {
    user: { async findFirst(query) { f.calls.push(["tx-user", query]); return f.user.isActive && query.where.id === f.user.id ? structuredClone(f.user) : null; } },
    workspaceMember: { async findFirst(query) { f.calls.push(["tx-member", query]); return f.member.isActive && query.where.userId === f.user.id && query.where.workspaceId === f.workspace.id ? structuredClone(f.member) : null; } },
    businessWorkspace: { async findFirst(query) { f.calls.push(["tx-workspace", query]); return query.where.id === f.workspace.id && query.where.tenantId === f.workspace.tenantId && f.workspace.status === "ACTIVE" ? structuredClone(f.workspace) : null; } },
    organizationUnit: { async findMany(query) { f.calls.push(["tx-organizations", query]); return [{ id: "org-a", parentId: null, status: "enabled" }, { id: "org-child", parentId: "org-a", status: "enabled" }]; } },
    rentalFulfillmentLocation: { async findMany(query) { f.calls.push(["tx-locations", query]); return [{ id: "loc-a" }, { id: "loc-b" }]; } },
  };
  const outside = { user: tx.user, workspaceMember: tx.workspaceMember,
    organizationUnit: { findMany() { throw new Error("Identity read escaped original transaction"); } },
    rentalFulfillmentLocation: { findMany() { throw new Error("Location read escaped original transaction"); } } };
  f.repository = new PlatformRepository(outside);
  const platform = f.platform = {
    useMysqlDataSource: () => f.mysql, platformRepository: f.repository,
    resolveTrustedWorkspacePrincipal: (binding, transaction) => PlatformService.prototype.resolveTrustedWorkspacePrincipal.call(platform, binding, transaction),
    getAuthSession: async () => ({ userId: "user-a", audience: "operator", currentWorkspaceId: "workspace-a" }),
    findUserById: id => f.repository.findUserById(id),
    findWorkspaceScopedUser: (...args) => f.repository.findWorkspaceScopedUser(...args),
  };
  f.auth = new AuthService(platform, { get(key) { f.configReads++; return key === "AUTH_TOKEN_SECRET" ? "offline-original-web-secret" : undefined; } });
  f.guard = new ApiAuthGuard(f.auth, undefined, undefined, undefined, outside);
  f.current = async transaction => { assert.equal(transaction, tx); f.currentReads++; return f.binding && structuredClone(f.binding); };
  f.run = (read, abortSignal = signal()) => f.auth.withTrustedWorkspacePrincipal(tx, f.current, abortSignal, resolve => f.guard.withTrustedCatalogRead(2, resolve, read, abortSignal));
  return f;
}

let nativeEntitlementTypesChecked = false;
function checkNativeEntitlementTypes() {
  const build = path.join(output, 'native-entitlement-types'), models = path.join(build, 'modules/ai-native/budget');
  fs.mkdirSync(models, { recursive: true });
  const nativeSource = path.join(root, 'apps/api/src/modules/ai-native/budget/prisma-subscription-budget-reader.ts');
  fs.copyFileSync(nativeSource, path.join(models, 'prisma-subscription-budget-reader.ts'));
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  // These declarations model external ORM/service ports for the actual reader's
  // strict signature/body check, NOT generated Prisma types or full API strict.
  write('node_modules/@prisma/client/index.d.ts', [
    'export namespace Prisma {',
    ' export interface TransactionClient { tenant: { findUnique(args: unknown): Promise<{ subscription: { startAt: Date | null; endAt: Date | null } | null; subscriptionSegments: Array<{ startAt: Date | null; endAt: Date | null }> } | null> } }',
    ' export const TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" };',
    '}',
    'export interface PrismaClient { $transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: string; maxWait: number; timeout: number }): Promise<T> }',
  ].join('\n'));
  write('modules/subscription/subscription.service.d.ts', [
    'import type { Prisma } from "@prisma/client";',
    'export declare class SubscriptionService { readCategoryCommercialContext(tenantId: string, tx: Prisma.TransactionClient, now: Date, features?: readonly string[]): Promise<{ revision: number; serviceStatus: string; newBusinessAllowed: boolean; entitlements: Array<{ code: string; categories: string[]; available: boolean }> }> }',
  ].join('\n'));
  write('modules/ai-native/budget/budget-dependency-adapters.d.ts', 'export interface SubscriptionBudgetEntitlementReader { read(tenantId: string, featureCode: string): Promise<{ revision: number; entitlements: ReadonlyArray<{ code: string; available: boolean }> }> }');
  write('modules/ai-native/budget/budget.ports.d.ts', 'export declare class BudgetError extends Error { readonly code: "INVALID" | "FORBIDDEN" | "UNAVAILABLE"; constructor(code: "INVALID" | "FORBIDDEN" | "UNAVAILABLE") }');
  write('consumer.ts', [
    'import { PrismaSubscriptionBudgetReader } from "./modules/ai-native/budget/prisma-subscription-budget-reader";',
    'import type { Prisma } from "@prisma/client";',
    'import type { SubscriptionBudgetEntitlementReader } from "./modules/ai-native/budget/budget-dependency-adapters";',
    'declare const reader: PrismaSubscriptionBudgetReader; declare const tx: Prisma.TransactionClient; declare const signal: AbortSignal;',
    'export const legacy: SubscriptionBudgetEntitlementReader = reader;',
    'export const observe = (): ReturnType<PrismaSubscriptionBudgetReader["readIn"]> => reader.readIn("tenant-a", "ai.native.use", tx, signal);',
    '// @ts-expect-error Native observation requires original cancellation.',
    'reader.readIn("tenant-a", "ai.native.use", tx);',
  ].join('\n'));
  check(ts.createProgram([path.join(models, 'prisma-subscription-budget-reader.ts'), path.join(build, 'consumer.ts')], {
    strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled'),
  }));
  assert.equal(fs.readFileSync(path.join(models, 'prisma-subscription-budget-reader.ts'), 'utf8'), fs.readFileSync(nativeSource, 'utf8'));
  nativeEntitlementTypesChecked = true;
}
let nativeRequestScopeTypesChecked = false;
function checkNativeRequestScopeTypes() {
  if (nativeRequestScopeTypesChecked) return;
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  for (const [from, to] of [
    ['apps/api/src/modules/auth/original-mcp-request-scope.ts', 'modules/auth/original-mcp-request-scope.ts'],
    ['apps/api/src/modules/auth/original-mcp-read-context.ts', 'modules/auth/original-mcp-read-context.ts'],
    ['apps/api/src/common/request-identity.ts', 'common/request-identity.ts'],
  ]) write(to, fs.readFileSync(path.join(root, from), 'utf8'));
  write('node_modules/@prisma/client/index.d.ts', 'export namespace Prisma { export interface TransactionClient { aiScope: { findFirst(args: unknown): Promise<unknown> } } }');
  write('node_modules/@nestjs/common/index.d.ts', 'export declare class ForbiddenException extends Error { constructor(message?: string) }');
  write('node_modules/@rental-os/mcp-server/package.json', JSON.stringify({ name: '@rental-os/mcp-server', type: 'module', exports: { '.': './index.d.ts', './persistent-read-accounting': './persistent-read-accounting.d.ts', './persistent-oauth-tokens': './persistent-oauth-tokens.d.ts' } }));
  write('node_modules/@rental-os/mcp-server/index.d.ts', 'export interface McpReadAuthorization { subject: string; token: string; clientId: string; scopes: readonly string[]; resource: string }');
  write('node_modules/@rental-os/mcp-server/persistent-read-accounting.d.ts', 'import type { McpReadAuthorization } from "./index.js"; export interface OriginalMcpReadCallRef { callId: string; authorization: McpReadAuthorization; toolName: string; inputHash: string }');
  write('node_modules/@rental-os/mcp-server/persistent-oauth-tokens.d.ts', 'export interface VerifiedPersistentOAuthAccess { grantId: string; grantRevision: number }');
  write('modules/ai-native/ai-scope.repository.d.ts', [
    'import type { AiExecutionContext } from "@rental-os/shared"; import type { Prisma } from "@prisma/client";',
    'export declare class AiScopeRepository { constructor(db: Pick<Prisma.TransactionClient, "aiScope">, authority: { resolve(): Promise<AiExecutionContext> }, clock?: () => Date); resolveCurrent(): Promise<{ context: AiExecutionContext; scope: { id: string; kind: "PLATFORM" | "TENANT" | "WORKSPACE" } }> }',
  ].join('\n'));
  write('modules/ai-native/task-contract-validation.d.ts', 'import type { AiExecutionContext } from "@rental-os/shared"; export declare function isAiStepExecutionContext(value: unknown): value is AiExecutionContext;');
  write('modules/ai-native/task-request/original-request.authority.d.ts', 'import type { AiExecutionContext } from "@rental-os/shared"; export interface AiOriginalRequestAccess { context: AiExecutionContext; scopeId: string }');
  write('modules/ai-native/task-request/original-request.validation.d.ts', 'export declare function freezeOriginalInput<T>(value: T): T;');
  write('consumer.ts', [
    'import { createOriginalMcpRequestScopeSource } from "./modules/auth/original-mcp-request-scope";',
    'import type { OriginalMcpCatalogReadContext } from "./modules/auth/original-mcp-read-context"; import type { Prisma } from "@prisma/client";',
    'import type { OriginalMcpReadCallRef } from "@rental-os/mcp-server/persistent-read-accounting" with { "resolution-mode": "import" };',
    'import type { AiOriginalRequestAccess } from "./modules/ai-native/task-request/original-request.authority";',
    'declare const context: OriginalMcpCatalogReadContext; declare const call: OriginalMcpReadCallRef; declare const tx: Prisma.TransactionClient; declare const signal: AbortSignal;',
    'const source = createOriginalMcpRequestScopeSource(context); export const observe = (): Promise<AiOriginalRequestAccess> => source.currentIn(call, tx, signal);',
    '// @ts-expect-error Caller cancellation is mandatory, not a new allowance.',
    'source.currentIn(call, tx);',
    'export const ownerRead = () => context.withReadNative!(call, signal, async (native, stop) => { const same: Prisma.TransactionClient = native; const cancellation: AbortSignal = stop; void same; void cancellation; return "internal-reader"; });',
    '// @ts-expect-error Owner-Native callback requires the original signal.',
    'context.withReadNative!(call, async () => "missing-signal");',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'modules/auth/original-mcp-request-scope.ts'), path.join(build, 'consumer.ts')], {
    strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled'), paths: { '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] },
  }));
  assert.equal(fs.readFileSync(path.join(build, 'modules/auth/original-mcp-request-scope.ts'), 'utf8'), fs.readFileSync(path.join(root, 'apps/api/src/modules/auth/original-mcp-request-scope.ts'), 'utf8'));
  nativeRequestScopeTypesChecked = true;
}
let nativeRequestPolicyTypesChecked = false;
function checkNativeRequestPolicyTypes() {
  if (nativeRequestPolicyTypesChecked) return;
  checkNativeRequestScopeTypes();
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  for (const [from, to] of [
    ['apps/api/src/modules/ai-native/task-request/original-request.authority.ts', 'modules/ai-native/task-request/original-request.authority.ts'],
    ['apps/api/src/modules/auth/original-mcp-request-authority.ts', 'modules/auth/original-mcp-request-authority.ts'],
  ]) write(to, fs.readFileSync(path.join(root, from), 'utf8'));
  // Exact new/changed authority bodies are strict-checked. External ORM and
  // existing class declarations below remain named facades, not generated API.
  write('node_modules/@prisma/client/index.d.ts', [
    'export namespace Prisma {',
    ' export interface TransactionClient { aiScope: { findFirst(args: unknown): Promise<unknown> }; aiTaskPlanPolicy: { findFirst(args: unknown): Promise<Plan | null> }; tenant: { findUnique(args: unknown): Promise<unknown> } }',
    '}',
    'export interface Plan { scopeId: string; sceneCode: string; sceneVersion: string; enabled: boolean; revision: number; expiresAt: Date; allowedTools: unknown; limits: unknown }',
    'export interface PrismaClient extends Prisma.TransactionClient { $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: unknown): Promise<T>; aiTaskActionPolicy: { findUnique(args: unknown): Promise<unknown> } }',
  ].join('\n'));
  write('modules/auth/auth.service.d.ts', 'export declare class AuthService { resolveAccessContext(value: string, options: unknown): Promise<unknown> }');
  write('modules/subscription/subscription.service.d.ts', 'export declare class SubscriptionService { readCategoryCommercialContext(...args: unknown[]): Promise<unknown> }');
  write('modules/rental-core/rental-idempotency.repository.d.ts', 'export declare function requestFingerprint(value: unknown): string;');
  write('modules/ai-native/ai-task.repository.d.ts', 'export declare class AiTaskRepositoryError extends Error { readonly code: string; constructor(code: string) }');
  write('modules/ai-native/task-current-identity.authority.d.ts', 'import type { AiExecutionContext } from "@rental-os/shared"; export declare class AiTaskCurrentIdentityAuthority { constructor(auth: unknown, credentials: unknown, clock: () => Date); resolve(): Promise<AiExecutionContext> }');
  write('modules/ai-native/task-current-action.authority.d.ts', 'import type { AiExecutionContext } from "@rental-os/shared"; export interface AiTaskCredentialSource { current(): Promise<unknown> } export declare class AiTaskCurrentActionAuthority { constructor(auth: unknown, credentials: unknown, policy: unknown, clock: () => Date); resolve(taskId: string, action: string): Promise<AiExecutionContext> }');
  write('modules/ai-native/prisma-task-action-policy.source.d.ts', 'export declare class PrismaTaskActionPolicySource { constructor(db: unknown, scope: unknown, clock: () => Date) }');
  write('modules/ai-native/budget/prisma-subscription-budget-reader.d.ts', [
    'import type { Prisma, PrismaClient } from "@prisma/client";',
    'type Entitlement = { revision: number; entitlements: ReadonlyArray<{ code: string; available: boolean }> };',
    'export declare class PrismaSubscriptionBudgetReader { constructor(db: Pick<PrismaClient, "$transaction">, service: unknown, clock: () => Date); read(tenantId: string, code: string): Promise<Entitlement>; readIn(tenantId: string, code: string, native: Prisma.TransactionClient, signal: AbortSignal): Promise<Entitlement> }',
  ].join('\n'));
  write('policy-consumer.ts', [
    'import type { AiSceneRequestBody } from "@rental-os/shared"; import type { Prisma } from "@prisma/client";',
    'import { createOriginalMcpRequestAuthority } from "./modules/auth/original-mcp-request-authority";',
    'import type { AiOriginalRequestAuthority, AiOriginalRequestNativeAuthority, AiOriginalRequestCreationAccess } from "./modules/ai-native/task-request/original-request.authority";',
    'declare const input: Parameters<typeof createOriginalMcpRequestAuthority>; declare const tx: Prisma.TransactionClient; declare const signal: AbortSignal; declare const body: AiSceneRequestBody;',
    'export const source: AiOriginalRequestNativeAuthority = createOriginalMcpRequestAuthority(...input);',
    'const observer: AiOriginalRequestAuthority = source.bindIn(tx, signal);',
    'export const observe = (): Promise<AiOriginalRequestCreationAccess> => observer.create(body);',
    'source.bindIn(tx, signal).assertCurrent();',
    '// @ts-expect-error Native original cancellation is required.',
    'source.bindIn(tx);',
    '// @ts-expect-error A Native resource authorizer is mandatory, never Web fallback.',
    'createOriginalMcpRequestAuthority(input[0], input[1], { creationRules: input[2].creationRules, entitlements: input[2].entitlements });',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'policy-consumer.ts')], {
    strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled-policy'),
    paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] },
  }));
  nativeRequestPolicyTypesChecked = true;
}
let nativeOrderStatusTypesChecked = false;
function checkNativeOrderStatusTypes() {
  if (nativeOrderStatusTypesChecked) return;
  checkNativeRequestPolicyTypes();
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  for (const [from, to] of [
    ['apps/api/src/modules/auth/original-mcp-order-status-resources.ts', 'modules/auth/original-mcp-order-status-resources.ts'],
    ['apps/api/src/modules/ai-native/order-read-facts.service.ts', 'modules/ai-native/order-read-facts.service.ts'],
    ['apps/api/src/modules/ai-native/tools/order-saved-quote.source.ts', 'modules/ai-native/tools/order-saved-quote.source.ts'],
    ['apps/api/src/modules/ai-native/tools/order-inspection-facts.service.ts', 'modules/ai-native/tools/order-inspection-facts.service.ts'],
    ['apps/api/src/modules/ai-native/tools/order-payment-facts.service.ts', 'modules/ai-native/tools/order-payment-facts.service.ts'],
    ['apps/api/src/modules/auth/trusted-workspace-principal.ts', 'modules/auth/trusted-workspace-principal.ts'],
  ]) write(to, fs.readFileSync(path.join(root, from), 'utf8'));
  const prismaFile = path.join(build, 'node_modules/@prisma/client/index.d.ts');
  write('node_modules/@prisma/client/index.d.ts', fs.readFileSync(prismaFile, 'utf8').replace('interface TransactionClient {', 'interface TransactionClient { businessWorkspace: { findFirst(args: unknown): Promise<unknown> }; rentalOrder: { findFirst(args: unknown): Promise<unknown> }; rentalQuote: { findFirst(args: unknown): Promise<unknown> }; rentalInspectionRecord: { findFirst(args: unknown): Promise<unknown>; findMany(args: unknown): Promise<unknown[]> };'));
  const mcpPackage = JSON.parse(fs.readFileSync(path.join(build, 'node_modules/@rental-os/mcp-server/package.json'), 'utf8'));
  mcpPackage.exports['./capability-mapping'] = './capability-mapping.d.ts';
  write('node_modules/@rental-os/mcp-server/package.json', JSON.stringify(mcpPackage));
  write('node_modules/@rental-os/mcp-server/capability-mapping.d.ts', 'export declare const MCP_BUSINESS_CAPABILITIES: ReadonlyArray<{ code: string; name: string; operation: string }>');
  write('modules/auth/auth.service.d.ts', 'import type { Prisma } from "@prisma/client"; import type { TrustedWorkspaceAccess } from "./trusted-workspace-principal"; export declare class AuthService { resolveAccessContext(value: string, options: unknown): Promise<unknown>; withTrustedWorkspacePrincipal<T>(tx: Prisma.TransactionClient, current: (tx: Prisma.TransactionClient, signal: AbortSignal) => Promise<{ userId: string; tenantId: string; workspaceId: string; audience: "operator" }>, signal: AbortSignal, consume: (resolve: () => Promise<TrustedWorkspaceAccess | undefined>) => Promise<T>): Promise<T> }');
  write('common/api-auth.guard.d.ts', 'import type { RequestIdentity } from "./request-identity"; export declare class ApiAuthGuard { withTrustedOrderRead<T>(id: string, resolve: () => Promise<unknown>, consume: (identity: RequestIdentity) => Promise<T>, signal: AbortSignal): Promise<T> }');
  write('modules/ai-native/order-route-context.authority.d.ts', 'import type { AiExecutionContext } from "@rental-os/shared"; export declare class AiOrderRouteContextAuthority { resolve(): Promise<AiExecutionContext>; withOrderRead<T>(consume: (context: AiExecutionContext, id: string) => Promise<T>): Promise<T> }');
  write('modules/ai-native/task-request/original-request.validation.d.ts', 'import type { AiSceneRequestBody } from "@rental-os/shared"; export declare function freezeOriginalInput<T>(value: T): T; export declare function parseOriginalRequest(value: unknown): AiSceneRequestBody; export declare function originalBody(value: AiSceneRequestBody): AiSceneRequestBody;');
  write('modules/ai-native/tools/read-context-binding.d.ts', 'import type { AiExecutionContext } from "@rental-os/shared"; export declare function assertAiReadContextBinding(context: AiExecutionContext, expected?: AiExecutionContext): void;');
  write('modules/ai-native/tools/order-explanation-facts.service.d.ts', 'import type { AiOrderInspectionFactsService } from "./order-inspection-facts.service"; import type { AiOrderPaymentFactsService } from "./order-payment-facts.service"; export declare class AiOrderExplanationFactsService { constructor(authority: unknown, facts: unknown, payment: Pick<AiOrderPaymentFactsService, "read"> | undefined, clock: () => Date, inspections?: Pick<AiOrderInspectionFactsService, "read">) }');
  const routeSource = fs.readFileSync(path.join(root, 'apps/api/src/modules/ai-native/business-read-route.authority.ts'), 'utf8');
  write('modules/ai-native/business-read-route.authority.d.ts', 'import type { AiExecutionContext } from "@rental-os/shared";\n' + routeSource.slice(routeSource.indexOf('export type AiBusinessReadKind '), routeSource.indexOf('const routes =')));
  write('modules/ai-native/tools/order-next-steps.service.d.ts', 'export declare class AiOrderNextStepsService { constructor(authority: unknown, facts: unknown) }');
  write('modules/ai-native/tools/order-explanation-preparation.service.d.ts', 'export declare class AiOrderExplanationPreparationService { constructor(authority: unknown, facts: unknown, next: unknown); prepare(value: unknown): Promise<unknown> }');
  // Strict-check the exact new Core method, not its 5k-line class or Prisma
  // generated types. Its runtime still executes the original complete class.
  const coreSource = fs.readFileSync(path.join(root, 'apps/api/src/modules/rental-core/rental-core.service.ts'), 'utf8');
  const start = coreSource.indexOf('  async getOrderInTransaction('), end = coreSource.indexOf('\n  /**', start);
  assert.ok(start > 0 && end > start);
  const method = coreSource.slice(start, end);
  const pageStart = coreSource.indexOf('  async listInspectionsPageInTransaction('), pageEnd = coreSource.indexOf('\n  async correctInspectionUsage(', pageStart);
  assert.ok(pageStart > 0 && pageEnd > pageStart);
  const pageMethod = coreSource.slice(pageStart, pageEnd);
  const repositorySource = fs.readFileSync(path.join(root, 'apps/api/src/modules/rental-core/rental-core-fact.repository.ts'), 'utf8');
  const parserStart = repositorySource.indexOf('export interface RentalInspectionPageQuery '), parserEnd = repositorySource.indexOf('\nexport interface InventoryLockTarget ', parserStart);
  assert.ok(parserStart > 0 && parserEnd > parserStart);
  write('modules/rental-core/rental-core-fact.repository.ts', 'import type { RentalInspectionRecord } from "@rental-os/shared"; import { BadRequestException } from "@nestjs/common";\n' + repositorySource.slice(parserStart, parserEnd));
  write('modules/rental-core/rental-core.service.ts', [
    'import type { Prisma } from "@prisma/client"; import type { RentalOrder, RentalOrderInspectionBasisFacts } from "@rental-os/shared";',
    'import { getRequestIdentity } from "../../common/request-identity"; import { ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";',
    'import { requestFingerprint } from "./rental-idempotency.repository"; type RentalFactTx = Prisma.TransactionClient;',
    'import { parseRentalInspectionPageQuery, type RentalInspectionPageQuery, type RentalInspectionPage } from "./rental-core-fact.repository";',
    'export class RentalCoreService { constructor(private readonly factStore: { findOrder(tenant: string, id: string, tx: Prisma.TransactionClient): Promise<RentalOrder | undefined>; listInspectionsPage?(tenant: string, id: string, query: RentalInspectionPageQuery, tx?: Prisma.TransactionClient): Promise<RentalInspectionPage> }) {} private publicOrder(row: RentalOrder): RentalOrder { return row; } getOrder(tenant: string, id: string): Promise<RentalOrder> { throw new Error("Type facade only, never a runtime Core"); } listInspectionsPage(tenant: string, id: string, query: RentalInspectionPageQuery): Promise<RentalInspectionPage> { throw new Error("Type facade only"); }',
    'readOrderFacts(tenant: string, id: string): Promise<RentalOrder & { workspaceId: string }> { throw new Error("Type facade only"); } readInspectionFactsPage(tenant: string, id: string, query: RentalInspectionPageQuery): Promise<RentalInspectionPage> { throw new Error("Type facade only"); } readOrderInspectionBasis(tenant: string, id: string): Promise<RentalOrderInspectionBasisFacts> { throw new Error("Type facade only"); }',
    method, pageMethod, '}',
  ].join('\n'));
  write('core-inspection-method-fragment.txt', pageMethod);
  write('node_modules/@nestjs/common/index.d.ts', 'export declare class ForbiddenException extends Error { constructor(message?: string) } export declare class NotFoundException extends Error { constructor(message?: string) }');
  write('modules/ai-native/quote-preview.service.d.ts', 'import type { AiWorkspaceScope } from "@rental-os/shared"; export interface AiQuoteCoreContextSource { current(scope: AiWorkspaceScope): Promise<unknown> }');
  write('modules/ai-native/model-gateway.ports.d.ts', 'export declare class ModelGatewayError extends Error { constructor(code: string) }');
  const businessSource = fs.readFileSync(path.join(root, 'apps/api/src/modules/rental-core/rental-business.service.ts'), 'utf8');
  const factStart = businessSource.indexOf('  private async loadQuoteFact('), factEnd = businessSource.indexOf('\n  /**', factStart);
  const quoteStart = businessSource.indexOf('  async readQuoteInTransaction('), quoteEnd = businessSource.indexOf('\n  /**', quoteStart);
  assert.ok(factStart > 0 && factEnd > factStart && quoteStart > factEnd && quoteEnd > quoteStart);
  const quoteMethods = businessSource.slice(factStart, factEnd) + businessSource.slice(quoteStart, quoteEnd);
  write('modules/rental-core/rental-business.service.ts', [
    'import type { Prisma } from "@prisma/client"; import type { RentalQuoteSnapshotV1 } from "@rental-os/shared";',
    'import { getRequestIdentity } from "../../common/request-identity"; import { ServiceUnavailableException, NotFoundException, ConflictException } from "@nestjs/common";',
    'import { requestFingerprint } from "./rental-idempotency.repository"; type RentalBusinessFactTx = Prisma.TransactionClient;',
    'export class RentalBusinessService { constructor(private readonly factStore: { findQuote(tenant: string, id: string, tx?: Prisma.TransactionClient): Promise<RentalQuoteSnapshotV1 | undefined> }) {} loadQuote(tenant: string, context: unknown, id: string, tx?: Prisma.TransactionClient): Promise<RentalQuoteSnapshotV1> { throw new Error("Type facade only"); }',
    'readOrderLinkedQuoteFacts(tenant: string, order: string, quote: string): Promise<RentalQuoteSnapshotV1 | undefined> { throw new Error("Type facade only"); }',
    quoteMethods, '}',
  ].join('\n'));
  write('business-quote-method-fragments.txt', quoteMethods);
  write('node_modules/@nestjs/common/index.d.ts', 'export declare class ForbiddenException extends Error { constructor(message?: string) } export declare class NotFoundException extends Error { constructor(message?: string) } export declare class ServiceUnavailableException extends Error { constructor(message?: string) } export declare class ConflictException extends Error { constructor(message?: string) } export declare class BadRequestException extends Error { constructor(message?: string) }');
  // These are explicit external row/type facades, not generated Prisma. Exact
  // new Native methods, common legacy page bodies and response projections are
  // compiled below; runtime tests still execute the complete original classes.
  write('node_modules/@prisma/client/index.d.ts', fs.readFileSync(prismaFile, 'utf8') + '\n' + [
    'export namespace Prisma {',
    ' export type Decimal = { toString(): string };',
    ' export interface PaymentIntentFactFacade { id: string; tenantId: string; workspaceId: string; orderId: string; instrument: string; provider: string; method: string; amount: Decimal; currency: string; merchantOrderNo: string; status: string; checkoutUrl: string | null; externalTransactionId: string | null; failureReason: string | null; expiresAt: Date; paidAt: Date | null }',
    ' export interface PaymentRefundFactFacade { id: string; tenantId: string; workspaceId: string; orderId: string; paymentIntentId: string; provider: string; method: string; amount: Decimal; currency: string; merchantRefundNo: string; status: string; externalRefundId: string | null; externalStatus: string | null; reason: string; failureReason: string | null; acceptedAt: Date | null; succeededAt: Date | null; fundedAt: Date | null; createdAt: Date; updatedAt: Date }',
    ' export type RentalPaymentRefundGetPayload<T> = PaymentRefundFactFacade;',
    ' export interface TransactionClient { rentalPaymentIntent: { findFirst(args: unknown): Promise<PaymentIntentFactFacade | null>; findMany(args: unknown): Promise<PaymentIntentFactFacade[]> }; rentalPaymentRefund: { findFirst(args: unknown): Promise<PaymentRefundFactFacade | null>; findMany(args: unknown): Promise<PaymentRefundFactFacade[]> } }',
    '}',
  ].join('\n'));
  const paymentSource = fs.readFileSync(path.join(root, 'apps/api/src/modules/integrations/payment.runtime.service.ts'), 'utf8');
  const part = (begin, finish) => { const s = paymentSource.indexOf(begin), e = paymentSource.indexOf(finish, s); assert.ok(s > 0 && e > s, begin); return paymentSource.slice(s, e); };
  const paymentMethods = [
    part('  async listPaymentIntentsPage(', '\n  private async withOrderPaymentFacts'),
    part('  async listPaymentRefundsPage(', '\n  /** Native local observations only.'),
    part('  async listPaymentIntentsPageInTransaction(', '\n  /**'),
    part('  private async requirePaymentIntent(', '\n  private async confirmedRefundTotal('),
    part('  private toRefundResponse(', '\n  private async createAlipayIntent('),
    part('  private toResponse(', '\n  private async log('),
  ].join('\n');
  const rowTypes = part('interface PaymentIntentRow {', '\ninterface ProviderPaymentResult {');
  write('modules/integrations/payment.runtime.service.ts', [
    'import type { Prisma } from "@prisma/client"; import { CLIENT_API_VERSION, type ClientPaymentIntentResponse, type ClientWechatJsapiParameters } from "@rental-os/shared";',
    'import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common"; import { getRequestIdentity } from "../../common/request-identity"; import { requestFingerprint } from "../rental-core/rental-idempotency.repository";',
    rowTypes,
    'export class PaymentRuntimeService { constructor(private readonly prisma: Prisma.TransactionClient) {} listPaymentIntents(tenant: string, space: string, order: string): Promise<unknown[]> { throw new Error("Type facade only"); } listPaymentRefunds(tenant: string, space: string, order: string, intent: string): Promise<unknown[]> { throw new Error("Type facade only"); }',
    'readOrderPaymentIntentsPage(tenant: string, space: string, order: string, query: { limit: number; cursor?: string }): Promise<{ rows: Array<Pick<ClientPaymentIntentResponse, "intentId" | "instrument" | "amount" | "currency" | "status" | "expiresAt"> & { paidAt: string | undefined }>; truncated: boolean; nextCursor: string | undefined }> { throw new Error("Type facade only"); } readOrderPaymentRefundsPage(tenant: string, space: string, order: string, intent: string, query: { limit: number; cursor?: string }): ReturnType<PaymentRuntimeService["listPaymentRefundsPage"]> { throw new Error("Type facade only"); }',
    paymentMethods, '}',
  ].join('\n'));
  write('payment-read-method-fragments.txt', paymentMethods);
  const guardSource = fs.readFileSync(path.join(root, 'apps/api/src/common/api-auth.guard.ts'), 'utf8');
  const guardStart = guardSource.indexOf('  async withTrustedOrderPaymentRead<T>('), guardEnd = guardSource.indexOf('\n  private async withTrustedRead<T>(', guardStart);
  assert.ok(guardStart > 0 && guardEnd > guardStart);
  const financeGuard = guardSource.slice(guardStart, guardEnd);
  write('common/api-auth.guard.ts', [
    'import { ForbiddenException } from "@nestjs/common"; import type { RequestIdentity } from "./request-identity"; import type { TrustedWorkspaceAccess } from "../modules/auth/trusted-workspace-principal";',
    'export class ApiAuthGuard { withTrustedOrderRead<T>(id: string, resolve: () => Promise<TrustedWorkspaceAccess | undefined>, consume: (identity: RequestIdentity) => Promise<T>, signal: AbortSignal): Promise<T> { throw new Error("Type facade only"); } private withTrustedRead<T>(path: string, query: object, resolve: () => Promise<TrustedWorkspaceAccess | undefined>, consume: (identity: RequestIdentity) => Promise<T>, signal: AbortSignal): Promise<T> { throw new Error("Type facade only, not runtime authorization"); }',
    financeGuard, '}',
  ].join('\n'));
  write('finance-guard-method-fragment.txt', financeGuard);
  write('order-status-consumer.ts', [
    'import { createOriginalMcpOrderStatusResources, createOriginalMcpOrderResources } from "./modules/auth/original-mcp-order-status-resources"; import type { Prisma } from "@prisma/client";',
    'import type { AiSceneRequestBody, AiExecutionContext } from "@rental-os/shared"; declare const input: Parameters<typeof createOriginalMcpOrderStatusResources>; declare const tx: Prisma.TransactionClient; declare const signal: AbortSignal; declare const body: AiSceneRequestBody;',
    'export const observe = (): Promise<AiExecutionContext> => createOriginalMcpOrderStatusResources(...input).authorizeResourcesIn(body, tx, signal);',
    'export const originalQuestions = (): Promise<AiExecutionContext> => createOriginalMcpOrderResources(...input).authorizeResourcesIn(body, tx, signal);',
    'import type { RentalBusinessService } from "./modules/rental-core/rental-business.service"; declare const business: RentalBusinessService;',
    'export const savedQuote = () => business.readQuoteInTransaction("tenant-a", "quote-a", tx, signal);',
    'import type { RentalCoreService } from "./modules/rental-core/rental-core.service"; declare const core: RentalCoreService;',
    'export const recordedInspections = () => core.listInspectionsPageInTransaction("tenant-a", "order-a", { limit: 50 }, tx, signal);',
    'import type { PaymentRuntimeService } from "./modules/integrations/payment.runtime.service"; declare const payments: PaymentRuntimeService;',
    'export const recordedPayments = () => payments.listPaymentIntentsPageInTransaction("tenant-a", "workspace-a", "order-a", { limit: 20 }, tx, signal, () => {});',
    'export const recordedRefunds = () => payments.listPaymentRefundsPageInTransaction("tenant-a", "workspace-a", "order-a", "intent-a", { limit: 50 }, tx, signal, () => {});',
    '// @ts-expect-error Native payment observation requires the owner lifecycle.',
    'payments.listPaymentIntentsPageInTransaction("tenant-a", "workspace-a", "order-a", { limit: 20 }, tx, signal);',
    '// @ts-expect-error Native refund observation requires the original cancellation and owner.',
    'payments.listPaymentRefundsPageInTransaction("tenant-a", "workspace-a", "order-a", "intent-a", { limit: 50 }, tx);',
    '// @ts-expect-error Native inspection observation requires the original cancellation.',
    'core.listInspectionsPageInTransaction("tenant-a", "order-a", { limit: 50 }, tx);',
    '// @ts-expect-error Native quote observation requires the original cancellation.',
    'business.readQuoteInTransaction("tenant-a", "quote-a", tx);',
    '// @ts-expect-error Broader questions still require the original cancellation.',
    'createOriginalMcpOrderResources(...input).authorizeResourcesIn(body, tx);',
    '// @ts-expect-error The original cancellation is mandatory.',
    'createOriginalMcpOrderStatusResources(...input).authorizeResourcesIn(body, tx);',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'order-status-consumer.ts')], {
    strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled-order-status'),
    paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] },
  }));
  write('core-method-fragment.txt', method);
  nativeOrderStatusTypesChecked = true;
}
let nativeRequestSaveTypesChecked = false;
function checkNativeRequestSaveTypes() {
  if (nativeRequestSaveTypesChecked) return;
  checkNativeOrderStatusTypes();
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const prismaFile = path.join(build, 'node_modules/@prisma/client/index.d.ts');
  write('node_modules/@prisma/client/index.d.ts', fs.readFileSync(prismaFile, 'utf8') + '\n' + [
    'export namespace Prisma {',
    ' export type InputJsonObject = Record<string, unknown>;',
    ' export class PrismaClientKnownRequestError extends Error { readonly code: string; constructor(message: string, options: { code: string }) }',
    ' export const TransactionIsolationLevel: { Serializable: "Serializable" };',
    ' export interface OriginalRequestRowFacade { id: string; scopeId: string; audience: string; ownerKind: string; ownerId: string; requestKey: string; sceneCode: string; sceneVersion: string; revision: number; previousRequestId: string | null; payload: unknown; contractVersion: string; contentHash: string; authorizationBindingHash: string; policyRevision: number; policyHash: string; expiresAt: Date; createdAt: Date; status: "STORED" | "REVOKED"; erasedAt: Date | null; creationClosedAt: Date | null; creationCloseKey: string | null }',
    ' export type AiTaskOriginalRequestGetPayload<T> = OriginalRequestRowFacade;',
    ' export interface TransactionClient { aiTaskOriginalRequest: { findFirst(args: unknown): Promise<OriginalRequestRowFacade | null>; create(args: unknown): Promise<OriginalRequestRowFacade> } }',
    '}',
  ].join('\n'));
  write('modules/ai-native/ai-task.repository.d.ts', [
    'import type { AiExecutionContext } from "@rental-os/shared";',
    'export declare class AiTaskRepositoryError extends Error { readonly code: string; constructor(code: string) }',
    'export declare function aiTaskAccessFromContext(value: AiExecutionContext, task: string, now: Date): { actorKind: "USER" | "SYSTEM"; actorId: string; audience: AiExecutionContext["audience"]; scope: { kind: "WORKSPACE" | "TENANT" | "PLATFORM" } };',
  ].join('\n'));
  const validation = fs.readFileSync(path.join(root, 'apps/api/src/modules/ai-native/task-request/original-request.validation.ts'), 'utf8');
  write('modules/ai-native/task-request/original-request.validation.ts', validation);
  write('modules/ai-native/tools/quote-candidate-preparation.service.d.ts', 'import { z } from "zod"; import type { AiSceneRequestBody } from "@rental-os/shared"; export declare const aiQuoteCandidateInputSchema: z.ZodType<Extract<AiSceneRequestBody, { sceneCode: "quote_clarification" }>["input"]["candidate"]>;');
  const repo = fs.readFileSync(path.join(root, 'apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts'), 'utf8');
  const commonStart = repo.indexOf('  private async stored<T>('), commonEnd = repo.indexOf('  /** Observe an existing original input ', commonStart);
  const saveStart = repo.indexOf('  /** Original save algorithm shared ');
  const reconcileHelper = repo.indexOf('  /** Exact original-key/body matching ', saveStart);
  const saveEnd = reconcileHelper >= 0 ? reconcileHelper : repo.indexOf('  async reconcile(', saveStart);
  const unknownStart = repo.indexOf('export class AiOriginalRequestResultUnknownError '), unknownEnd = repo.indexOf('\nexport class PrismaOriginalRequestRepository ', unknownStart);
  assert.ok(commonStart > 0 && commonEnd > commonStart && saveStart > commonEnd && saveEnd > saveStart && unknownStart > 0 && unknownEnd > unknownStart);
  const fragments = repo.slice(commonStart, commonEnd) + repo.slice(saveStart, saveEnd);
  write('modules/ai-native/task-request/prisma-original-request.repository.ts', [
    'import { randomUUID } from "node:crypto"; import { Prisma, type PrismaClient } from "@prisma/client";',
    'import { AI_SCENE_REQUEST_DRAFT_VERSION, type AiSceneCode, type AiSceneRequestReceiptDraft, type AiSceneRequestBody } from "@rental-os/shared";',
    'import { requestFingerprint } from "../../rental-core/rental-idempotency.repository"; import { aiTaskAccessFromContext, AiTaskRepositoryError } from "../ai-task.repository";',
    'import { originalIdentityHash, type AiOriginalRequestAuthority, type AiOriginalRequestNativeAuthority, type AiOriginalRequestAccess } from "./original-request.authority";',
    'import { freezeOriginalInput, originalBody, originalRequestReferenceSchema, parseOriginalRequest } from "./original-request.validation";',
    'type Row = Prisma.AiTaskOriginalRequestGetPayload<{}>; const conflict = () => new AiTaskRepositoryError("AI_REVISION_CONFLICT"); const unavailable = () => new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE"); const denied = () => new AiTaskRepositoryError("AI_ACCESS_DENIED");',
    repo.slice(unknownStart, unknownEnd),
    'export class PrismaOriginalRequestRepository { constructor(private readonly db: Pick<PrismaClient, "$transaction" | "aiTaskOriginalRequest">, private readonly authority: AiOriginalRequestAuthority, private readonly clock: () => Date = () => new Date()) {}',
    fragments, '}',
  ].join('\n'));
  write('original-request-save-method-fragments.txt', fragments);
  write('request-save-consumer.ts', [
    'import type { Prisma } from "@prisma/client"; import type { AiSceneRequestReceiptDraft } from "@rental-os/shared";',
    'import type { PrismaOriginalRequestRepository } from "./modules/ai-native/task-request/prisma-original-request.repository"; import type { AiOriginalRequestNativeAuthority } from "./modules/ai-native/task-request/original-request.authority";',
    'declare const repo: PrismaOriginalRequestRepository; declare const tx: Prisma.TransactionClient; declare const authority: AiOriginalRequestNativeAuthority; declare const signal: AbortSignal; declare const input: unknown;',
    'export const prepare = () => repo.saveIn(tx, input, authority, signal);',
    'export const legacy = () => repo.save(input);',
    'export const reissue = () => repo.saveIn(tx, input, authority, signal, true, async (native, receipt) => { const same: Prisma.TransactionClient = native; const original: AiSceneRequestReceiptDraft = receipt; void same; void original; });',
    '// @ts-expect-error Native save requires the original cancellation.',
    'repo.saveIn(tx, input, authority);',
    '// @ts-expect-error Native preparation is deliberately not a committed Web receipt.',
    'export const commitProof: Promise<AiSceneRequestReceiptDraft> = repo.saveIn(tx, input, authority, signal);',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'request-save-consumer.ts')], { strict: true, skipLibCheck: true, declaration: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled-request-save'), paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] } }));
  nativeRequestSaveTypesChecked = true;
}
let nativeRequestAuditTypesChecked = false;
function checkNativeRequestAuditTypes() {
  if (nativeRequestAuditTypesChecked) return;
  checkNativeRequestSaveTypes();
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const prisma = path.join(build, 'node_modules/@prisma/client/index.d.ts');
  write('node_modules/@prisma/client/index.d.ts', fs.readFileSync(prisma, 'utf8') + '\n' + [
    'export const AiAudience: { OPERATOR: "OPERATOR" };',
    'export namespace Prisma { export function sql(strings: TemplateStringsArray, ...values: unknown[]): unknown;',
    'export interface OriginalRequestAuditRowFacade { id: string; tenantId: string; workspaceId: string | null; userId: string | null; rentalOrderId: string | null; action: string; detail: unknown }',
    'export interface TransactionClient { $queryRaw<T = unknown>(...args: unknown[]): Promise<T>; operationLog: { findUnique(args: unknown): Promise<OriginalRequestAuditRowFacade | null>; create(args: unknown): Promise<OriginalRequestAuditRowFacade> } } }',
  ].join('\n'));
  const nativeMcp = path.join(build, 'node_modules/@rental-os/mcp-server/persistent-read-accounting.d.ts');
  write('node_modules/@rental-os/mcp-server/persistent-read-accounting.d.ts', fs.readFileSync(nativeMcp, 'utf8') + '\nexport declare function captureMcpReadInput(input: unknown): { readonly input: unknown; readonly inputHash: string };');
  const repo = fs.readFileSync(path.join(root, 'apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts'), 'utf8');
  const start = repo.indexOf('  async withCurrentInputIn<T>('), end = repo.indexOf('  async read(value: unknown)', start);
  const closure = repo.indexOf('  private closureBinding(row: Row)'), closureEnd = repo.indexOf('\n  /**', closure);
  assert.ok(start > 0 && end > start && closure > end && closureEnd > closure);
  const observer = repo.slice(start, end) + repo.slice(closure, closureEnd);
  const mirrorRepo = path.join(build, 'modules/ai-native/task-request/prisma-original-request.repository.ts');
  const originalMirror = fs.readFileSync(mirrorRepo, 'utf8'), classEnd = originalMirror.lastIndexOf('\n}');
  write('modules/ai-native/task-request/prisma-original-request.repository.ts', originalMirror.slice(0, classEnd) + '\n' + observer + originalMirror.slice(classEnd));
  write('original-request-observe-method-fragments.txt', observer);
  const logs = fs.readFileSync(path.join(root, 'apps/api/src/common/operation-log.service.ts'), 'utf8');
  const typeStart = logs.indexOf('export interface OriginalMcpRequestSaveAuditRecord '), typeEnd = logs.indexOf('\nexport interface HttpMutationAuditInput ', typeStart);
  const methodStart = logs.indexOf('  async recordOriginalMcpRequestSaveAudit('), methodEnd = logs.indexOf('\n  /**', methodStart);
  assert.ok(typeStart > 0 && typeEnd > typeStart && methodStart > typeEnd && methodEnd > methodStart);
  const logMethod = logs.slice(methodStart, methodEnd);
  write('common/operation-log.service.ts', [
    'import { AiAudience, type Prisma } from "@prisma/client"; import { InternalServerErrorException } from "@nestjs/common"; import { isDeepStrictEqual } from "node:util"; import { AI_SCENE_CODES } from "@rental-os/shared"; import { requestFingerprint } from "../modules/rental-core/rental-idempotency.repository";',
    logs.slice(typeStart, typeEnd), 'export class OperationLogService {', logMethod, '}',
  ].join('\n'));
  write('original-request-audit-log-method-fragment.txt', logMethod);
  const nest = path.join(build, 'node_modules/@nestjs/common/index.d.ts');
  write('node_modules/@nestjs/common/index.d.ts', fs.readFileSync(nest, 'utf8') + '\nexport declare class InternalServerErrorException extends Error { constructor(message?: string) }');
  write('modules/auth/original-mcp-request-save-audit.ts', fs.readFileSync(path.join(root, 'apps/api/src/modules/auth/original-mcp-request-save-audit.ts'), 'utf8'));
  write('request-audit-consumer.ts', [
    'import { createOriginalMcpRequestSaveAudit } from "./modules/auth/original-mcp-request-save-audit"; import type { Prisma } from "@prisma/client"; import type { AiSceneRequestReceiptDraft } from "@rental-os/shared";',
    'declare const input: Parameters<typeof createOriginalMcpRequestSaveAudit>; declare const tx: Prisma.TransactionClient; declare const receipt: AiSceneRequestReceiptDraft; declare const signal: AbortSignal;',
    'export const associate = (): Promise<void> => createOriginalMcpRequestSaveAudit(...input).associateIn(tx, receipt, signal);',
    '// @ts-expect-error Native save audit requires the original cancellation.',
    'createOriginalMcpRequestSaveAudit(...input).associateIn(tx, receipt);',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'request-audit-consumer.ts')], { strict: true, skipLibCheck: true, declaration: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled-request-audit'), paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] } }));
  nativeRequestAuditTypesChecked = true;
}
let nativeRequestReconcileTypesChecked = false;
function checkNativeRequestReconcileTypes() {
  if (nativeRequestReconcileTypesChecked) return;
  checkNativeRequestAuditTypes();
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const source = fs.readFileSync(path.join(root, 'apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts'), 'utf8');
  const start = source.indexOf('  /** Exact original-key/body matching '), end = source.indexOf('  /** Owner-authorized retained material ', start);
  assert.ok(start > 0 && end > start);
  const methods = source.slice(start, end);
  const file = path.join(build, 'modules/ai-native/task-request/prisma-original-request.repository.ts');
  const current = fs.readFileSync(file, 'utf8'), classEnd = current.lastIndexOf('\n}');
  write('modules/ai-native/task-request/prisma-original-request.repository.ts', current.slice(0, classEnd) + '\n' + methods + '\nprivate async readTaskReceipt(id: string): Promise<unknown> { throw new Error("Type facade only, never Native/global task fallback"); }' + current.slice(classEnd));
  write('original-request-reconcile-method-fragments.txt', methods);
  write('request-reconcile-consumer.ts', [
    'import type { Prisma } from "@prisma/client"; import type { PrismaOriginalRequestRepository } from "./modules/ai-native/task-request/prisma-original-request.repository";',
    'import type { AiOriginalRequestNativeAuthority } from "./modules/ai-native/task-request/original-request.authority";',
    'declare const repo: PrismaOriginalRequestRepository; declare const native: Prisma.TransactionClient; declare const authority: AiOriginalRequestNativeAuthority; declare const signal: AbortSignal; declare const command: unknown;',
    'export const observe = () => repo.reconcileIn(native, command, authority, signal);',
    'export const legacy = () => repo.reconcile(command);',
    '// @ts-expect-error Native original-key reconciliation requires cancellation.',
    'repo.reconcileIn(native, command, authority);',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'request-reconcile-consumer.ts')], { strict: true, skipLibCheck: true, declaration: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled-request-reconcile'), paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] } }));
  nativeRequestReconcileTypesChecked = true;
}
let nativeRequestParticipantTypesChecked = false;
function checkNativeRequestParticipantTypes() {
  if (nativeRequestParticipantTypesChecked) return;
  checkNativeRequestReconcileTypes();
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  write('modules/auth/original-mcp-request-participant.ts', fs.readFileSync(path.join(root, 'apps/api/src/modules/auth/original-mcp-request-participant.ts'), 'utf8'));
  write('request-participant-consumer.ts', [
    'import { createOriginalMcpRequestParticipant } from "./modules/auth/original-mcp-request-participant"; import type { Prisma } from "@prisma/client"; import type { AiSceneRequestReceiptDraft } from "@rental-os/shared";',
    'declare const input: Parameters<typeof createOriginalMcpRequestParticipant>; declare const native: Prisma.TransactionClient; declare const signal: AbortSignal; declare const command: unknown;',
    'export const prepare = () => createOriginalMcpRequestParticipant(...input).saveIn(native, command, signal);',
    'export const observe = () => createOriginalMcpRequestParticipant(...input).reconcileIn(native, command, signal);',
    '// @ts-expect-error Participant save requires cancellation.',
    'createOriginalMcpRequestParticipant(...input).saveIn(native, command);',
    '// @ts-expect-error Original-key observation requires cancellation.',
    'createOriginalMcpRequestParticipant(...input).reconcileIn(native, command);',
    '// @ts-expect-error Preparation plus audit is not a committed receipt.',
    'export const commit: Promise<AiSceneRequestReceiptDraft> = prepare();',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'request-participant-consumer.ts')], { strict: true, skipLibCheck: true, declaration: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled-request-participant'), paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] } }));
  nativeRequestParticipantTypesChecked = true;
}
let nativeCatalogTypesChecked = false;
function checkNativeCatalogTypes() {
  if (nativeCatalogTypesChecked) return;
  checkNativeRequestParticipantTypes();
  const build = path.join(output, 'native-request-scope-types');
  const write = (relative, text) => { const target = path.join(build, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const prisma = path.join(build, 'node_modules/@prisma/client/index.d.ts');
  write('node_modules/@prisma/client/index.d.ts', fs.readFileSync(prisma, 'utf8') + '\nexport namespace Prisma { export const empty: unknown; export interface CatalogGroupRowFacade { id: string; tenantId: string; workspaceId: string; categoryCode: string; code: string; name: string; inventoryMode: string; unit: string; status: string; createdAt: Date; updatedAt: Date; bundleComponents: Array<{ componentItemGroupId: string; quantity: number; optional: boolean; substitutionGroup: string | null; componentItemGroup: { code: string; name: string; tenantId: string; workspaceId: string } }> } export type RentalItemGroupGetPayload<T> = CatalogGroupRowFacade; export interface TransactionClient { rentalItemGroup: { findMany(args: unknown): Promise<CatalogGroupRowFacade[]> } } }');
  const config = fs.readFileSync(path.join(root, 'apps/api/src/modules/rental-core/rental-core-config.repository.ts'), 'utf8');
  const start = config.indexOf('export interface RentalItemGroupPageQuery '), end = config.indexOf('\n/**', start);
  const pageStart = config.indexOf('  async listItemGroupsPage('), pageEnd = config.indexOf('\n  async readFulfillmentAdmission(', pageStart);
  assert.ok(start > 0 && end > start && pageStart > end && pageEnd > pageStart);
  const page = config.slice(pageStart, pageEnd);
  write('modules/rental-core/rental-core-config.repository.ts', [
    'import { BadRequestException, ConflictException } from "@nestjs/common"; import { createHash } from "node:crypto"; import { Prisma } from "@prisma/client"; import type { RentalItemGroup, RentalCategoryCode, RentalInventoryMode } from "@rental-os/shared"; import { resolveScopeWorkspaceId } from "./workspace-scope"; export type RentalConfigTx = Prisma.TransactionClient;',
    'const lower = <T extends string>(value: string): T => value.toLowerCase() as T; const iso = (value: Date): string => value.toISOString();',
    config.slice(start, end), 'export class RentalCoreConfigRepository { constructor(private readonly prisma: Prisma.TransactionClient) {} private toItemGroup(row: Prisma.CatalogGroupRowFacade): RentalItemGroup { throw new Error("Named conversion type facade only; actual complete repository executes at runtime"); }', page, '}',
  ].join('\n'));
  write('catalog-config-page-method-fragment.txt', page);
  write('modules/rental-core/workspace-scope.d.ts', 'import type { Prisma } from "@prisma/client"; export declare function resolveScopeWorkspaceId(client: Pick<Prisma.TransactionClient, "businessWorkspace">, tenantId: string): Promise<string>;');
  const core = fs.readFileSync(path.join(root, 'apps/api/src/modules/rental-core/rental-core.service.ts'), 'utf8');
  const nativeStart = core.indexOf('  async listItemGroupsPageInTransaction('), nativeEnd = core.indexOf('\n  listPricingGroups(', nativeStart);
  assert.ok(nativeStart > 0 && nativeEnd > nativeStart);
  const native = core.slice(nativeStart, nativeEnd);
  const mirror = path.join(build, 'modules/rental-core/rental-core.service.ts'), old = fs.readFileSync(mirror, 'utf8'), classEnd = old.lastIndexOf('\n}');
  write('modules/rental-core/rental-core.service.ts', 'import { ConflictException } from "@nestjs/common"; import { parseRentalItemGroupPageQuery, type RentalConfigTx, type RentalItemGroupPageQuery, type RentalItemGroupPage, RentalCoreConfigRepository } from "./rental-core-config.repository"; import type { RentalItemGroup } from "@rental-os/shared";\n' + old.slice(0, classEnd) + '\nprivate configStore!: Pick<RentalCoreConfigRepository, "listItemGroupsPage">; private publicItemGroup(row: RentalItemGroup): RentalItemGroup { throw new Error("Type facade only"); }\n' + native + old.slice(classEnd));
  write('catalog-core-native-method-fragment.txt', native);
  const guardSource = fs.readFileSync(path.join(root, 'apps/api/src/common/api-auth.guard.ts'), 'utf8');
  const guardStart = guardSource.indexOf('  async withTrustedCatalogRead<T>('), guardEnd = guardSource.indexOf('\n  /**', guardStart);
  assert.ok(guardStart > 0 && guardEnd > guardStart);
  const guard = path.join(build, 'common/api-auth.guard.ts'), guardText = fs.readFileSync(guard, 'utf8'), guardClose = guardText.lastIndexOf('\n}');
  write('common/api-auth.guard.ts', guardText.slice(0, guardClose) + '\n' + guardSource.slice(guardStart, guardEnd) + guardText.slice(guardClose));
  const mcp = path.join(build, 'node_modules/@rental-os/mcp-server/persistent-read-accounting.d.ts');
  assert.match(fs.readFileSync(mcp, 'utf8'), /captureMcpReadInput/);
  write('modules/auth/original-mcp-catalog-resources.ts', fs.readFileSync(path.join(root, 'apps/api/src/modules/auth/original-mcp-catalog-resources.ts'), 'utf8'));
  write('modules/ai-native/catalog-read-facts.service.ts', fs.readFileSync(path.join(root, 'apps/api/src/modules/ai-native/catalog-read-facts.service.ts'), 'utf8'));
  // Original facts' legacy port is a type-only signature, never a global runtime fallback.
  const coreMirror = path.join(build, 'modules/rental-core/rental-core.service.ts');
  const coreText = fs.readFileSync(coreMirror, 'utf8'), last = coreText.lastIndexOf('\n}');
  write('modules/rental-core/rental-core.service.ts', coreText.slice(0, last) + '\nlistItemGroupsPage(tenant: string, query: RentalItemGroupPageQuery): Promise<RentalItemGroupPage> { throw new Error("Legacy port type facade only"); } listItemGroups(tenant: string): RentalItemGroup[] { throw new Error("Unbounded port type facade only"); }' + coreText.slice(last));
  write('catalog-consumer.ts', [
    'import { createOriginalMcpCatalogResources } from "./modules/auth/original-mcp-catalog-resources"; import type { Prisma } from "@prisma/client"; import type { AiCatalogReadProjection } from "@rental-os/shared";',
    'declare const input: Parameters<typeof createOriginalMcpCatalogResources>; declare const native: Prisma.TransactionClient; declare const signal: AbortSignal;',
    'export const read = (): Promise<AiCatalogReadProjection> => createOriginalMcpCatalogResources(...input).read({ limit: 2 }, signal);',
    'export const legacy = (): Promise<AiCatalogReadProjection> => createOriginalMcpCatalogResources(...input).readIn(native, { limit: 2 }, signal);',
    '// @ts-expect-error Owner-Native read also requires original cancellation.',
    'createOriginalMcpCatalogResources(...input).read({ limit: 2 });',
    '// @ts-expect-error Native catalog requires original cancellation.',
    'createOriginalMcpCatalogResources(...input).readIn(native, { limit: 2 });',
  ].join('\n'));
  check(ts.createProgram([path.join(build, 'catalog-consumer.ts')], { strict: true, skipLibCheck: true, declaration: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ['node'], typeRoots,
    rootDir: build, outDir: path.join(build, 'compiled-native-catalog'), paths: { ...options.paths, '@rental-os/shared': [path.join(runtimeShared, 'dist/index.d.ts')] } }));
  nativeCatalogTypesChecked = true;
}
module.exports = { fixture, source, shared, identity, signal, AiCatalogReadFactsService, catalogConsumerUrl, output, runtimeShared, cache, root, toolchainRoot,
  checkNativeCatalogTypes, nativeCatalogTypesChecked: () => nativeCatalogTypesChecked,
  checkNativeRequestParticipantTypes, nativeRequestParticipantTypesChecked: () => nativeRequestParticipantTypesChecked,
  checkNativeRequestReconcileTypes, nativeRequestReconcileTypesChecked: () => nativeRequestReconcileTypesChecked,
  checkNativeRequestAuditTypes, nativeRequestAuditTypesChecked: () => nativeRequestAuditTypesChecked,
  checkNativeRequestSaveTypes, nativeRequestSaveTypesChecked: () => nativeRequestSaveTypesChecked,
  checkNativeOrderStatusTypes, nativeOrderStatusTypesChecked: () => nativeOrderStatusTypesChecked,
  checkNativeRequestPolicyTypes, nativeRequestPolicyTypesChecked: () => nativeRequestPolicyTypesChecked,
  checkNativeEntitlementTypes, nativeEntitlementTypesChecked: () => nativeEntitlementTypesChecked,
  checkNativeRequestScopeTypes, nativeRequestScopeTypesChecked: () => nativeRequestScopeTypesChecked };
