"use strict";
/** Original Auth/Platform/Guard and bounded reader, with explicit external
 * Prisma/current-grant fixtures. Real installed Nest plumbing; no API boot or DB. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { createRequire, registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../../..");
// An explicit existing toolchain may be read for dependencies; all tested sources stay in root.
const toolchainRoot = path.resolve(process.env.MCP_TEST_TOOLCHAIN_ROOT || root);
const dependencyDirectory = path.join(toolchainRoot, "node_modules");
const installed = createRequire(path.join(dependencyDirectory, "typescript/package.json"));
const temporaryRoot = path.join(root, "output/.tmp");
const outputParent = path.resolve(process.env.MCP_TEST_OUTPUT_ROOT || temporaryRoot);
const owner = path.basename(process.argv[1] || "mcp-original-identity").replace(/[^A-Za-z0-9._-]/gu, "_");
const output = path.join(outputParent, `mcp-original-identity-${owner}`);
let ownsOutput = false, runtimeHooks;
function within(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function checkOutputPath() {
  assert.ok(within(temporaryRoot, outputParent), "MCP fixture output must stay in this worktree's output/.tmp");
  for (let current = output; current !== root; current = path.dirname(current)) {
    assert.ok(within(root, current), "MCP fixture output escaped its worktree");
    if (fs.existsSync(current)) assert.equal(fs.lstatSync(current).isSymbolicLink(), false, "MCP fixture must not follow output links");
  }
}
function cleanup() {
  if (!ownsOutput) return;
  checkOutputPath();
  assert.equal(fs.realpathSync(output), output, "MCP fixture output was redirected");
  const checkChildren = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, "MCP fixture cleanup must not enter a link");
      if (entry.isDirectory()) checkChildren(path.join(directory, entry.name));
    }
  };
  checkChildren(output);
  runtimeHooks?.deregister();
  fs.rmSync(output, { recursive: true });
  assert.equal(fs.existsSync(output), false, "MCP fixture output was not removed");
  ownsOutput = false;
}
// Register cleanup before compilation so failed imports and cancelled runs have
// the same lifecycle as a passing test. Never adopt a previous run's directory.
process.once("exit", cleanup);
for (const [name, status] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(name, () => {
  try { cleanup(); } finally { process.exit(status); }
});
checkOutputPath();
fs.mkdirSync(outputParent, { recursive: true });
fs.mkdirSync(output);
ownsOutput = true;
if (process.env.MCP_TEST_OFFLINE === "1") {
  process.env.DATABASE_URL = "mysql://offline:offline@127.0.0.1:1/rental_os_offline";
  process.env.AI_OFFLINE_AUDIT = path.join(output, "offline-audit.log");
  process.env.AI_OFFLINE_WRITE_ROOT = output;
  process.env.TEMP = output;
  process.env.TMP = output;
  process.env.NODE_COMPILE_CACHE = path.join(output, "node-cache");
  require("../ai-native/prisma-offline-preload.cjs");
}
installed("reflect-metadata");
const { createBuild, verifyContracts } = require("../../../scripts/check-rental-package-build.cjs");
const build = createBuild(dependencyDirectory), ts = build.ts;
const sourceResolver = require("../../../scripts/controller-sources.cjs").createControllerSourceLoader(root, dependencyDirectory);
verifyContracts(build);
const packageRoot = path.join(root, "packages/shared"), staged = path.join(output, "node_modules/@rental-os/shared");
const typeRoots = [path.join(dependencyDirectory, "@types")];
const platformArtifact = path.join(output, "node_modules/@rental-os/platform-contracts");
const artifacts = new Map();
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
// Emit the existing package build's actual dependency order, including Rental
// contracts now owned outside Shared. No installed workspace links or old dist.
for (const name of ["@rental-os/platform-contracts", "@rental-os/rental-core", "@rental-os/shared"]) {
  const pkg = build.packages.get(name), target = name === "@rental-os/shared" ? runtimeShared : path.join(output, "node_modules", name);
  artifacts.set(name, target);
  if (!verifiedShared || name !== "@rental-os/shared") {
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(pkg.directory, "package.json"), path.join(target, "package.json"));
  }
  for (const [file, text] of build.outputs) {
    if (!within(pkg.directory, file)) continue;
    const destination = path.join(target, path.relative(pkg.directory, file));
    if (verifiedShared && name === "@rental-os/shared") {
      assert.equal(fs.readFileSync(destination, "utf8"), text, "Current shared source differs from verified artifact: " + file);
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, text);
    }
  }
}
function artifactExport(specifier, runtime = false) {
  const name = specifier.split("/").slice(0, 2).join("/"), directory = artifacts.get(name);
  if (!directory) return undefined;
  const exported = build.exported(specifier, runtime);
  const target = path.join(directory, path.relative(build.packages.get(name).directory, exported));
  return fs.existsSync(target) ? target : undefined;
}
const options = { paths: {
  zod: [path.join(path.dirname(installed.resolve("zod/package.json")), "index.d.cts")],
  "@rental-os/platform-contracts": [artifactExport("@rental-os/platform-contracts")],
  ...Object.fromEntries(Object.keys(build.packages.get("@rental-os/rental-core").metadata.exports)
    .filter(key => !key.includes("*")).map(key => "@rental-os/rental-core" + (key === "." ? "" : key.slice(1)))
    .map(name => [name, artifactExport(name)]).filter(([, file]) => file).map(([name, file]) => [name, [file]])),
} };
function check(program) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const emitted = program.emit();
  assert.equal(emitted.emitSkipped, false); assert.equal(emitted.diagnostics.length, 0);
}
const principalSource = sourceResolver.resolveSource(__filename, "@rental-os/rental-core/trusted-workspace-principal", true);
check(ts.createProgram([principalSource], {
  strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ["node"], typeRoots,
  rootDir: path.dirname(principalSource), outDir: path.join(artifacts.get("@rental-os/rental-core"), "dist"), paths: options.paths,
}));
options.paths["@rental-os/rental-core/trusted-workspace-principal"] = [artifactExport("@rental-os/rental-core/trusted-workspace-principal")];
check(ts.createProgram([path.join(root, "apps/api/src/modules/auth/trusted-workspace-principal.ts")], {
  strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, types: ["node"], typeRoots,
  rootDir: path.join(root, "apps/api/src/modules/auth"), outDir: path.join(output, "principal-types"),
  paths: { ...options.paths, "@rental-os/shared": [path.join(runtimeShared, "dist/index.d.ts")] },
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
const prefixes = [output, runtimeShared].map(directory => pathToFileURL(directory + path.sep).href);
runtimeHooks = registerHooks({ resolve(specifier, context, next) {
  if (prefixes.some(prefix => context.parentURL?.startsWith(prefix))) {
    if (specifier === "zod") return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true };
    if (specifier.startsWith("@rental-os/")) {
      const file = artifactExport(specifier, true);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
} });
const shared = require(path.join(runtimeShared, "dist/index.js"));
// Loading decorators/exceptions does not bootstrap Nest. No identity or Guard
// method is replaced; this fixture still cannot prove actual DI or database use.
const nest = installed("@nestjs/common");
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
    if (specifier === "@nestjs/core/helpers/execution-context-host") return installed(specifier);
    if (specifier === "@prisma/client") return prisma;
    if (specifier === "@prisma/client/runtime/library") return installed(specifier);
    if (specifier === "@rental-os/shared") return shared;
    if (specifier === "@rental-os/shared/platform") return require(path.join(runtimeShared, "dist/platform-identity.js"));
    if (specifier === "@rental-os/platform-contracts") return require(path.join(platformArtifact, "dist/index.js"));
    if (specifier.startsWith("@rental-os/")) {
      const artifact = artifactExport(specifier, true);
      return artifact ? require(artifact) : source(sourceResolver.resolveSource(file, specifier, true));
    }
    if (specifier === "zod") return installed("zod");
    if (specifier === 'ajv' || specifier === 'ajv-formats') return installed(specifier);
    if (specifier === 'class-transformer' || specifier === 'class-validator') return installed(specifier);
    if (specifier.startsWith("node:")) return require(specifier);
    if (specifier.startsWith(".")) return source(sourceResolver.resolveSource(file, specifier, true));
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

// Preserve the original local consumer contracts, including every negative
// type assertion. The old hand-written ORM/classes mirrored pre-extraction files;
// the existing selected-schema checker now checks each consumer against its real
// owner and complete implementation. It runs once, without another runner or SDK.
const nativeTypeConsumers = [
  { name: 'checkNativeEntitlementTypes.ts', lines: [
    'import { PrismaSubscriptionBudgetReader } from "./modules/ai-native/budget/prisma-subscription-budget-reader";',
    'import type { Prisma } from "@prisma/client";',
    'import type { SubscriptionBudgetEntitlementReader } from "./modules/ai-native/budget/budget-dependency-adapters";',
    'declare const reader: PrismaSubscriptionBudgetReader; declare const tx: Prisma.TransactionClient; declare const signal: AbortSignal;',
    'export const legacy: SubscriptionBudgetEntitlementReader = reader;',
    'export const observe = (): ReturnType<PrismaSubscriptionBudgetReader["readIn"]> => reader.readIn("tenant-a", "ai.native.use", tx, signal);',
    '// @ts-expect-error Native observation requires original cancellation.',
    'reader.readIn("tenant-a", "ai.native.use", tx);',
  ] },
  { name: 'checkNativeRequestScopeTypes.ts', lines: [
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
  ] },
  { name: 'checkNativeRequestPolicyTypes.ts', lines: [
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
  ] },
  { name: 'checkNativeOrderStatusTypes.ts', lines: [
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
  ] },
  { name: 'checkNativeRequestSaveTypes.ts', lines: [
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
  ] },
  { name: 'checkNativeRequestAuditTypes.ts', lines: [
    'import { createOriginalMcpRequestSaveAudit } from "./modules/auth/original-mcp-request-save-audit"; import type { Prisma } from "@prisma/client"; import type { AiSceneRequestReceiptDraft } from "@rental-os/shared";',
    'declare const input: Parameters<typeof createOriginalMcpRequestSaveAudit>; declare const tx: Prisma.TransactionClient; declare const receipt: AiSceneRequestReceiptDraft; declare const signal: AbortSignal;',
    'export const associate = (): Promise<void> => createOriginalMcpRequestSaveAudit(...input).associateIn(tx, receipt, signal);',
    '// @ts-expect-error Native save audit requires the original cancellation.',
    'createOriginalMcpRequestSaveAudit(...input).associateIn(tx, receipt);',
  ] },
  { name: 'checkNativeRequestReconcileTypes.ts', lines: [
    'import type { Prisma } from "@prisma/client"; import type { PrismaOriginalRequestRepository } from "./modules/ai-native/task-request/prisma-original-request.repository";',
    'import type { AiOriginalRequestNativeAuthority } from "./modules/ai-native/task-request/original-request.authority";',
    'declare const repo: PrismaOriginalRequestRepository; declare const native: Prisma.TransactionClient; declare const authority: AiOriginalRequestNativeAuthority; declare const signal: AbortSignal; declare const command: unknown;',
    'export const observe = () => repo.reconcileIn(native, command, authority, signal);',
    'export const legacy = () => repo.reconcile(command);',
    '// @ts-expect-error Native original-key reconciliation requires cancellation.',
    'repo.reconcileIn(native, command, authority);',
  ] },
  { name: 'checkNativeRequestParticipantTypes.ts', lines: [
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
  ] },
  { name: 'checkNativeCatalogTypes.ts', lines: [
    'import { createOriginalMcpCatalogResources } from "./modules/auth/original-mcp-catalog-resources"; import type { Prisma } from "@prisma/client"; import type { AiCatalogReadProjection } from "@rental-os/shared";',
    'declare const input: Parameters<typeof createOriginalMcpCatalogResources>; declare const native: Prisma.TransactionClient; declare const signal: AbortSignal;',
    'export const read = (): Promise<AiCatalogReadProjection> => createOriginalMcpCatalogResources(...input).read({ limit: 2 }, signal);',
    'export const legacy = (): Promise<AiCatalogReadProjection> => createOriginalMcpCatalogResources(...input).readIn(native, { limit: 2 }, signal);',
    '// @ts-expect-error Owner-Native read also requires original cancellation.',
    'createOriginalMcpCatalogResources(...input).read({ limit: 2 });',
    '// @ts-expect-error Native catalog requires original cancellation.',
    'createOriginalMcpCatalogResources(...input).readIn(native, { limit: 2 });',
  ] }
];
let nativeConsumerTypesChecked = false, nativeConsumerTypeFailure;
function checkNativeConsumerTypes() {
  if (nativeConsumerTypesChecked) return;
  if (nativeConsumerTypeFailure) throw nativeConsumerTypeFailure;
  try {
    const directory = path.join(output, 'native-consumer-types');
    fs.mkdirSync(directory);
    const entries = nativeTypeConsumers.map(({ name, lines }) => {
      const file = path.join(directory, name);
      const originalApi = path.relative(directory, path.join(root, 'apps/api/src')).split(path.sep).join('/');
      // Only transport the existing relative imports to the original API entry.
      // Package imports still resolve through the owning package's formal exports.
      fs.writeFileSync(file, lines.join('\n').replace(/(from\s+["'])\.\//g, (_, prefix) => prefix + originalApi + '/'));
      return file;
    });
    const result = require('node:child_process').spawnSync(process.execPath, [
      '--no-compilation-cache', '--require', path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'),
      path.join(root, 'scripts/check-selected-prisma-types.cjs'), '--deps', dependencyDirectory,
      '--mode', 'rental-ai', '--config', 'apps/api/tsconfig.json', ...entries,
    ], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
        AI_OFFLINE_AUDIT: path.join(output, 'native-types-offline-audit.log'), AI_OFFLINE_WRITE_ROOT: output,
        TEMP: output, TMP: output, NODE_COMPILE_CACHE: path.join(output, 'node-cache') } });
    assert.equal(result.status, 0, [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'));
    assert.equal(fs.existsSync(path.join(output, 'native-types-offline-audit.log')), false, 'Native type checker crossed its offline boundary');
    const evidence = result.stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].roots, entries.length);
    assert.equal(evidence[0].diagnostics, 0);
    assert.equal(evidence[0].diskOutputs, 0);
    console.log(JSON.stringify({ ...evidence[0], originalConsumerGroups: entries.length,
      originalNegativeTypeAssertions: nativeTypeConsumers.flatMap(value => value.lines).filter(line => line.includes('@ts-expect-error')).length }));
    nativeConsumerTypesChecked = true;
  } catch (error) { nativeConsumerTypeFailure = error; throw error; }
}

let nativeEntitlementTypesChecked = false;
function checkNativeEntitlementTypes() {
  if (nativeEntitlementTypesChecked) return;
  checkNativeConsumerTypes();
  nativeEntitlementTypesChecked = true;
}

let nativeRequestScopeTypesChecked = false;
function checkNativeRequestScopeTypes() {
  if (nativeRequestScopeTypesChecked) return;
  checkNativeConsumerTypes();
  nativeRequestScopeTypesChecked = true;
}

let nativeRequestPolicyTypesChecked = false;
function checkNativeRequestPolicyTypes() {
  if (nativeRequestPolicyTypesChecked) return;
  checkNativeRequestScopeTypes();
  checkNativeConsumerTypes();
  nativeRequestPolicyTypesChecked = true;
}

let nativeOrderStatusTypesChecked = false;
function checkNativeOrderStatusTypes() {
  if (nativeOrderStatusTypesChecked) return;
  checkNativeRequestPolicyTypes();
  checkNativeConsumerTypes();
  nativeOrderStatusTypesChecked = true;
}

let nativeRequestSaveTypesChecked = false;
function checkNativeRequestSaveTypes() {
  if (nativeRequestSaveTypesChecked) return;
  checkNativeOrderStatusTypes();
  checkNativeConsumerTypes();
  nativeRequestSaveTypesChecked = true;
}

let nativeRequestAuditTypesChecked = false;
function checkNativeRequestAuditTypes() {
  if (nativeRequestAuditTypesChecked) return;
  checkNativeRequestSaveTypes();
  checkNativeConsumerTypes();
  nativeRequestAuditTypesChecked = true;
}

let nativeRequestReconcileTypesChecked = false;
function checkNativeRequestReconcileTypes() {
  if (nativeRequestReconcileTypesChecked) return;
  checkNativeRequestAuditTypes();
  checkNativeConsumerTypes();
  nativeRequestReconcileTypesChecked = true;
}

let nativeRequestParticipantTypesChecked = false;
function checkNativeRequestParticipantTypes() {
  if (nativeRequestParticipantTypesChecked) return;
  checkNativeRequestReconcileTypes();
  checkNativeConsumerTypes();
  nativeRequestParticipantTypesChecked = true;
}

let nativeCatalogTypesChecked = false;
function checkNativeCatalogTypes() {
  if (nativeCatalogTypesChecked) return;
  checkNativeRequestParticipantTypes();
  checkNativeConsumerTypes();
  nativeCatalogTypesChecked = true;
}

module.exports = { fixture, source, shared, identity, signal, AiCatalogReadFactsService, catalogConsumerUrl, output, runtimeShared, cache, root, toolchainRoot, cleanup,
  checkNativeCatalogTypes, nativeCatalogTypesChecked: () => nativeCatalogTypesChecked,
  checkNativeRequestParticipantTypes, nativeRequestParticipantTypesChecked: () => nativeRequestParticipantTypesChecked,
  checkNativeRequestReconcileTypes, nativeRequestReconcileTypesChecked: () => nativeRequestReconcileTypesChecked,
  checkNativeRequestAuditTypes, nativeRequestAuditTypesChecked: () => nativeRequestAuditTypesChecked,
  checkNativeRequestSaveTypes, nativeRequestSaveTypesChecked: () => nativeRequestSaveTypesChecked,
  checkNativeOrderStatusTypes, nativeOrderStatusTypesChecked: () => nativeOrderStatusTypesChecked,
  checkNativeRequestPolicyTypes, nativeRequestPolicyTypesChecked: () => nativeRequestPolicyTypesChecked,
  checkNativeEntitlementTypes, nativeEntitlementTypesChecked: () => nativeEntitlementTypesChecked,
  checkNativeRequestScopeTypes, nativeRequestScopeTypesChecked: () => nativeRequestScopeTypesChecked };
