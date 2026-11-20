'use strict';
/** 启用 Rental AI 的实际 composition DI 与原请求/知识文件权限回归。只替换持久化与外部运输，
 * 使用真实 Auth → Guard → selected access → 原知识政策/文件 ACL。
 * Prisma 5.22 官方 247/40 模型运行时仅在内存生成及构造，不连接数据库或启动应用。
 * node apps/rental-api/test/ai-composition.test.cjs --deps <只读 node_modules>
 * 临时目录只由本入口创建，拒绝复用已有目录，成功、失败和退出均清理。
 */
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !args[1]))
  throw Error('只接受 --deps <node_modules>');
// 原 generator 将 runtimeBase 嵌入 JS 字符串，Windows 路径须先标准化。
const deps = path.resolve(args[1] || path.join(root, 'node_modules')).split(path.sep).join('/');
const temporary = path.resolve(root, 'output/.tmp/rental-lead-data');
let ownsTemporary = false;
function cleanup() {
  if (!ownsTemporary) return;
  if (path.relative(root, temporary) !== path.join('output', '.tmp', 'rental-lead-data'))
    throw Error('临时目录越界');
  const info = fs.lstatSync(temporary);
  if (info.isSymbolicLink() || fs.realpathSync(temporary) !== temporary)
    throw Error('临时目录身份变化，拒绝删除');
  const audit = path.join(temporary, 'audit.log');
  if (fs.existsSync(audit) && fs.statSync(audit).size) {
    process.exitCode = 1;
    console.error('离线守卫记录拒绝行为，本次验证失败');
  }
  fs.rmSync(temporary, { recursive: true });
  if (fs.existsSync(temporary)) throw Error('临时目录未清理');
  ownsTemporary = false;
}
// 不接受 junction 或另一个验证的目录，避免清理未知成果。
if (fs.existsSync(temporary)) throw Error('任务临时目录已存在，拒绝覆盖');
for (const relative of ['', 'output', 'output/.tmp']) {
  const item = path.resolve(root, relative);
  if (fs.existsSync(item) && (fs.lstatSync(item).isSymbolicLink() || fs.realpathSync(item) !== item))
    throw Error('工作树/临时父目录不应是链接');
}
process.once('exit', cleanup);
process.once('SIGINT', () => {
  process.exitCode = 130;
  cleanup();
  process.exit();
});
process.once('SIGTERM', () => {
  process.exitCode = 143;
  cleanup();
  process.exit();
});
fs.mkdirSync(temporary, { recursive: true });
ownsTemporary = true;
Object.assign(process.env, {
  DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary,
  AI_OFFLINE_AUDIT: path.join(temporary, 'audit.log'),
  TEMP: temporary,
  TMP: temporary,
});
require(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const Module = require('node:module'),
  rd = Module.createRequire(deps + '/offline.cjs'),
  ts = rd('typescript'),
  assert = require('node:assert/strict');
for (const name of ['prisma', '@prisma/client'])
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(deps, name, 'package.json'), 'utf8')).version,
    '5.22.0',
    '仅支持原官方 Prisma 5.22.0',
  );
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex'),
  aliases = {}, patterns = [];
for (const dir of ['packages', 'apps'])
  for (const entry of fs.readdirSync(root + '/' + dir, { withFileTypes: true })) {
    const home = root + '/' + dir + '/' + entry.name,
      p = home + '/package.json';
    if (!entry.isDirectory() || !fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [key, exp] of Object.entries(j.exports ?? {})) {
      const target = typeof exp === 'string' ? exp : (exp.types ?? exp.default);
      if (typeof target !== 'string') continue;
      let src = target
        .replace(/^\.\/dist-clients\//, './')
        .replace(/^\.\/dist\//, './src/')
        .replace(/\.d\.ts$/, '.ts')
        .replace(/\.js$/, '.ts');
      if ((key.match(/\*/g) ?? []).length === 1 && (src.match(/\*/g) ?? []).length === 1) {
        patterns.push({ key: j.name + key.slice(1), target: path.resolve(home, src) });
        continue;
      }
      let file = path.resolve(home, src);
      if (!fs.existsSync(file) && fs.existsSync(file + 'x')) file += 'x';
      if (fs.existsSync(file)) aliases[key === '.' ? j.name : j.name + key.slice(1)] = file;
    }
    if (!aliases[j.name] && fs.existsSync(home + '/src/index.ts')) aliases[j.name] = home + '/src/index.ts';
  }
const fallback = new Module(deps + '/offline.cjs');
fallback.paths = [deps];
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (aliases[request]) return aliases[request];
  for (const pattern of patterns) {
    const [prefix, suffix] = pattern.key.split('*');
    if (request.startsWith(prefix) && request.endsWith(suffix)) {
      const match = request.slice(prefix.length, suffix ? -suffix.length : undefined);
      if (match.split('/').some(part => !part || part === '..' || part === '.')) continue;
      const file = path.resolve(pattern.target.replace('*', match));
      if (fs.existsSync(file)) return file;
    }
  }
  try {
    return original.call(this, request, parent, ...rest);
  } catch (e) {
    return original.call(this, request, fallback, ...rest);
  }
};
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  );
const cli = fs.readFileSync(deps + '/prisma/build/index.js', 'utf8'),
  start = cli.indexOf('var yI=S('),
  end = cli.indexOf(';var bI=S(', start);
assert(start >= 0 && end > start);
const S = (init, cache) => () => {
  if (!cache) {
    cache = { exports: {} };
    init(cache.exports, cache);
  }
  return cache.exports;
};
const wasm = new Function('S', 'require', '__dirname', cli.slice(start, end) + ';return yI();')(
  S,
  Module.createRequire(deps + '/prisma/build/index.js'),
  deps + '/prisma/build',
);
const compose = require(root + '/packages/rental-core/src/prisma-schema.ts').composeRentalPrismaSchema;
const base = compose(
  fs.readFileSync(root + '/apps/platform-api/prisma/schema.prisma', 'utf8'),
  fs.readFileSync(root + '/packages/rental-core/prisma/schema.prisma', 'utf8'),
);
const data = require(root + '/packages/ai-native-data/src/data.ts'),
  prepare = require(root + '/packages/ai-native-data/src/preparation.ts');
const files = new Map(
  data.AI_NATIVE_DATA_FILES.map((a) => [
    a.file,
    fs.readFileSync(root + '/packages/ai-native-data/' + a.file),
  ]),
);
const contribution = data.createAiNativeDataContribution(files),
  prepared = prepare.createAiNativeDataPreparation({ baseSchema: base, contribution });
const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: prepared.schema, noColor: true })));
const generator = rd('@prisma/client/generator-build/index.js');
assert.equal(dmmf.datamodel.models.length, 247);
assert.equal(dmmf.datamodel.enums.length, 35);

const generatorPath = deps + '/@prisma/client/generator-build/index.js';
const generatorModule = new Module(generatorPath);
generatorModule.filename = generatorPath;
generatorModule.paths = [deps];
generatorModule._compile(
  fs.readFileSync(generatorPath, 'utf8') + ';module.exports.__OfflineTSClient=TSClient;',
  generatorPath,
);
const generatedClientFile = root + '/apps/rental-api/generated/client/index.js';
const options = {
  dmmf: generator.externalToInternalDmmf(dmmf),
  datasources: [
    {
      name: 'db',
      provider: 'mysql',
      activeProvider: 'mysql',
      url: { fromEnvVar: 'DATABASE_URL', value: null },
      sourceFilePath: root + '/apps/rental-api/generated/schema.prisma',
    },
  ],
  clientVersion: '5.22.0',
  engineVersion: rd('@prisma/engines-version').enginesVersion,
  runtimeBase: deps + '/@prisma/client/runtime',
  runtimeNameJs: 'library',
  runtimeNameTs: 'library',
  schemaPath: root + '/apps/rental-api/generated/schema.prisma',
  outputDir: root + '/apps/rental-api/generated/client',
  activeProvider: 'mysql',
  binaryPaths: {},
  generator: {
    binaryTargets: [],
    config: {},
    name: 'prisma-client-js',
    output: null,
    provider: { value: 'prisma-client-js', fromEnvVar: null },
    previewFeatures: [],
    isCustomOutput: true,
    sourceFilePath: root + '/apps/rental-api/generated/schema.prisma',
  },
  datamodel: prepared.schema,
  browser: false,
  deno: false,
  edge: false,
  wasm: false,
  envPaths: { rootEnvPath: null, schemaEnvPath: undefined },
  copyEngine: false,
};
const generatedJs = new generatorModule.exports.__OfflineTSClient(options).toJS();
const generatedModule = new Module(generatedClientFile);
generatedModule.filename = generatedClientFile;
generatedModule.paths = [deps];
generatedModule._compile(generatedJs, generatedClientFile);
require.cache[generatedClientFile] = generatedModule;
let forbiddenDefaultLoads = 0;
const originalModuleLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === '@prisma/client' || /(?:^|[\\/])\.prisma[\\/]client(?:[\\/]|$)/u.test(request)) {
    forbiddenDefaultLoads++;
    throw Error('default generated Prisma Client is forbidden');
  }
  return originalModuleLoad.call(this, request, parent, ...rest);
};
const sourceResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('.') && parent?.filename && parent.filename.startsWith(path.resolve(root))) {
    const stem = path.resolve(path.dirname(parent.filename), request);
    for (const file of [stem + '.ts', stem + '/index.ts']) if (fs.existsSync(file)) return file;
  }
  return sourceResolve.call(this, request, parent, ...rest);
};

// 固定来源/哈希为锁合同夹具，不表示构建或实际物理部署成功。

require('reflect-metadata');
const { ConfigService } = require('@nestjs/config');
const {
  createRentalAiParticipants,
  RentalAiCompositionModule,
  RENTAL_AI_BINDING,
  RENTAL_AI_INSPECTION_BINDING,
  requireRentalAiSelection,
} = require(path.resolve(root, 'apps/rental-api/src/ai-composition.ts'));
const { createRentalApplication } = require('@rental-os/rental-core/application');
const { createRentalCustomerManagementApplication } = require('@rental-os/rental-core/customer-management');
const { createRentalAuthorization } = require('@rental-os/rental-core/http-auth');
const { createRentalManifest } = require('@rental-os/rental-core/manifest');

const source = { repository: 'https://example.com/offline/rental', commit: 'a'.repeat(40) };
const manifest = createRentalManifest({ source, assets: ['dist/http-openapi.js'],
  contributions: { openapi: 'dist/http-openapi.js' } });
const aiRelease = {
  id: 'ai-native',
  version: '0.1.0',
  source,
  sha256: 'b'.repeat(64),
  compatibility: manifest.compatibility,
  runtime: manifest.runtime,
  schema: data.AI_NATIVE_PRISMA_SCHEMA,
  files: [...files].map(([file, bytes]) => ({ file, sha256: hash(bytes) })),
  data: contribution.data,
  prerequisites: {
    platform: { minInclusive: '0.1.8', maxExclusive: '0.1.9' },
    cores: [
      {
        coreId: 'rental',
        version: { minInclusive: '0.1.0', maxExclusive: '0.1.1' },
        migrations: [
          {
            id: prepare.AI_NATIVE_DATA_PREREQUISITES.rental.migrationId,
            sha256: prepare.AI_NATIVE_DATA_PREREQUISITES.rental.migrationSha256,
          },
        ],
      },
    ],
  },
};
const lock = {
  lockVersion: 1,
  platform: {
    versions: { platform: '0.1.0', contract: '0.1.1', node: '22.16.0', capabilities: {} },
    source,
    sha256: 'c'.repeat(64),
    data: { version: '0.1.8', readable: { minInclusive: '0.1.0', maxExclusive: '0.2.0' }, migrations: [] },
  },
  cores: [{ manifest, sha256: 'd'.repeat(64) }],
  dataCapabilities: [aiRelease],
};
function compositionFixture(selectedLock = lock) {
  const trace = { db: [], life: 0 },
    // The fixture owns the exact official 247-model graph; no default Client is loaded.
    db = { _runtimeDataModel: { models: Object.fromEntries(
      dmmf.datamodel.models.map(({ name, ...model }) => [name, model]),
    ) } };
  for (const model of dmmf.datamodel.models) {
    const name = model.name[0].toLowerCase() + model.name.slice(1);
    db[name] = {};
    for (const method of [
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'aggregate',
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
    ])
      db[name][method] = async (...args) => {
        trace.db.push({ name, method });
        throw Error('unexpected ' + name + '.' + method);
      };
  }
  db.$transaction = async () => {
    throw Error('unexpected transaction at construction');
  };
  db.$connect = async () => {
    throw Error('unexpected connect');
  };
  db.$disconnect = async () => {
    throw Error('unexpected disconnect');
  };
  db.$queryRaw = async () => {
    throw Error('unexpected root query');
  };
  const config = new ConfigService({ NODE_ENV: 'test', AUTH_TOKEN_SECRET: 'synthetic-test-secret' });
  const factory = createRentalAiParticipants({ database: db, configuration: config, lock: selectedLock });
  const rental = createRentalApplication({
    database: db,
    configuration: config,
    aiMode: 'enabled',
    participants: factory.participants,
    fileCleanupAuthority: { assert: async () => { throw Error('unexpected file cleanup worker'); } },
    workerAuthority: {
      assertCurrent: async () => {
        throw Error('unexpected worker');
      },
      assertParentCurrent: async () => {
        throw Error('unexpected worker');
      },
    },
  });
  const authorization = createRentalAuthorization(require('@rental-os/shared'));
  const guard = new authorization.Guard(
    rental.auth,
    rental.foundation.capabilities,
    rental.client.auth,
    rental.client.rateLimit,
    db,
    rental.subscriptions,
  );
  const customers = createRentalCustomerManagementApplication(rental);
  const binding = factory.bind({ rental, guard, customers });
  return { db, trace, config, factory, rental, authorization, guard, customers, binding };
}

// 原 storage delegate 与唯一 native transport 的离线替身；Auth/Guard/ACL 不替换。

const { runWithRequestIdentity, getRequestIdentity } = require('@rental-os/platform-server/request-identity');
const { createRentalApplicationAccess } = require('@rental-os/rental-core/application-access');
const { KnowledgeError } = require(
  '@rental-os/ai-native-server/runtime/knowledge/knowledge-errors',
);
const { knowledgeUploadRequest } = require(
  '@rental-os/ai-native-server/runtime/knowledge/human-knowledge-upload.service',
);
const { user: syntheticUser } = require(
  path.resolve(root, 'tests/fixtures/ai-native/authorization-baseline.cjs'),
);
const { fileStorageLocationHash } = require('@rental-os/platform-contracts/file-content-binding');
const shared = require('@rental-os/shared');
const unavailable = (e) => e instanceof KnowledgeError && e.code === 'unavailable';
const modelTransport = require(
  '@rental-os/ai-native-server/runtime/model-egress.transport',
);
const outbound = require('@rental-os/platform-server/outbound-url');
const originalTransport = modelTransport.createNativeModelEgressTransport,
  originalOutbound = outbound.assertOutboundUrl;
let currentTransport;
modelTransport.createNativeModelEgressTransport = () => ({ get: (input) => currentTransport(input) });
outbound.assertOutboundUrl = async (value) => new URL(value);
function knowledgeFixture(selectedLock = lock) {
  const f = compositionFixture(selectedLock),
    state = {
      active: true,
      workspace: 'workspace-a',
      user: syntheticUser({ permissions: ['system:params:manage', 'rental-os:order:view'] }),
      grant: 'enabled',
      assigned: 'assigned',
      available: true,
      policyEnabled: true,
      policyThrows: false,
      revision: 1,
      depth: 0,
      transactions: 0,
      committedLogs: [],
      pendingLogs: [],
      logFailure: false,
      dispatches: 0,
      policyReads: 0,
      sessionReads: 0,
      queries: [],
      authHook: undefined,
    };
  const configuration = {
    id: 'storage-a',
    provider: 's3_compatible',
    settings: {
      endpoint: 'https://objects.example.test',
      bucket: 'offline-bucket',
      region: 'us-east-1',
      forcePathStyle: true,
      objectPrefix: 'tenant-files',
    },
    credentials: { accessKeyId: 'offline', secretAccessKey: 'offline-secret' },
  };
  const bytes = Uint8Array.from(Buffer.from('synthetic knowledge bytes'));
  const contentHash = hash(bytes),
    document = {
      draftVersion: shared.AI_KNOWLEDGE_DRAFT_VERSION,
      documentId: 'document-a',
      documentVersion: 'version-a',
      attachmentId: 'file-a',
      owner: { actorKind: 'user', actorId: state.user.id },
      scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      aclRevision: 1,
      title: 'Synthetic',
      publication: 'published',
      parsing: 'parsed',
      indexing: 'indexed',
      validFrom: '2026-01-01T00:00:00Z',
    };
  const row = {
    id: 'document-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    title: 'Synthetic',
    status: 'published',
    revision: 1,
    withdrawnAt: null,
    state: { document, revision: 1, contentHash },
  };
  const staging = 'tenant-files/tenant-a/file-a/blob',
    key = staging + '.committed/11111111-1111-4111-8111-111111111111/' + contentHash;
  const asset = {
    id: 'file-a',
    tenantId: 'tenant-a',
    businessModule: 'ai-native',
    businessType: 'ai_knowledge_document',
    businessId: 'document-a',
    uploadScene: 'ai-knowledge',
    status: 'active',
    uploadedBy: state.user.id,
    storageProvider: 's3_compatible',
    storageKey: key,
    checksum: contentHash,
    fileName: 'synthetic.txt',
    mimeType: 'text/plain',
    sizeBytes: bytes.length,
    metadata: {
      workspaceId: 'workspace-a',
      knowledgeUploadVersion: 1,
      knowledgeContentHash: contentHash,
      fileUploadVersion: 2,
      fileContentVersion: 1,
      contentHash,
      stagingStorageKey: staging,
      storageLocationHash: fileStorageLocationHash(configuration),
    },
    uploadSession: {
      id: 'upload-a',
      fileAssetId: 'file-a',
      tenantId: 'tenant-a',
      provider: 's3_compatible',
      storageKey: key,
      status: 'completed',
      completedAt: new Date('2026-01-01T00:00:00Z'),
    },
  };
  const owner = {
    businessType: 'ai_knowledge_document',
    businessId: 'document-a',
    uploadScene: 'ai-knowledge',
    workspaceId: 'workspace-a',
    actorUserId: state.user.id,
  };
  f.rental.authSource.getAuthSession = async (id) => {
    state.sessionReads++;
    if (state.authHook) await state.authHook();
    return state.active && id === 'session-a'
      ? { id, userId: state.user.id, audience: 'operator', currentWorkspaceId: state.workspace }
      : undefined;
  };
  f.rental.authSource.findUserById = async (id) =>
    id === state.user.id ? structuredClone(state.user) : undefined;
  f.rental.authSource.findWorkspaceScopedUser = async (id, w) =>
    state.active && id === state.user.id && w === state.workspace ? structuredClone(state.user) : undefined;
  f.rental.authSource.listUserWorkspaces = async () => [];
  f.rental.integrations.integrations.runtimeConfig = async () => structuredClone(configuration);
  f.db.aiKnowledgeDocument.findFirst = async ({ where }) =>
    where.id === 'document-a' ? structuredClone(row) : null;
  f.db.aiKnowledgeDocument.findUnique = async () => null;
  f.db.fileAsset.findFirst = async ({ where }) => (where.id === 'file-a' ? structuredClone(asset) : null);
  f.db.aiKnowledgePolicyManagementOperation.findFirst = async () => null;
  f.db.aiKnowledgeActionPolicy.findUnique = async (args) => {
    state.policyReads++;
    if (state.policyThrows) throw Error('offline private policy failure');
    const k = args.where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey;
    assert.equal(k.tenantId, 'tenant-a');
    assert.equal(k.workspaceId, 'workspace-a');
    assert.equal(k.actorId, state.user.id);
    assert.equal(k.audience, 'operator');
    const resource =
      k.action === 'read_body'
        ? { documentId: 'document-a', documentVersion: 'version-a', attachmentId: 'file-a', aclRevision: 1 }
        : k.action === 'upload'
          ? {
              upload: {
                documentId: 'fresh-a',
                idempotencyKey: knowledgeUploadRequest({
                  documentId: 'fresh-a',
                  fileName: 'upload.txt',
                  mimeType: 'text/plain',
                  sizeBytes: 5,
                }).idempotencyKey,
                fileName: 'upload.txt',
                mimeType: 'text/plain',
                sizeBytes: 5,
              },
            }
          : {};
    return {
      ...k,
      resource,
      enabled: state.policyEnabled,
      revision: state.revision,
      expiresAt: new Date(Date.now() + 600000),
      requiredPermissions: ['system:params:manage'],
    };
  };
  // Expiry is stable per stored row, not freshly fabricated at every read.
  const policyRead = f.db.aiKnowledgeActionPolicy.findUnique,
    expiry = new Date(Date.now() + 600000);
  f.db.aiKnowledgeActionPolicy.findUnique = async (args) => ({
    ...(await policyRead(args)),
    expiresAt: expiry,
  });
  f.db.$transaction = async (callback, options) => {
    assert.equal(state.depth, 0, 'no nested transaction');
    assert.equal(options.isolationLevel, 'ReadCommitted');
    state.depth++;
    state.transactions++;
    state.pendingLogs = [];
    const tx = {};
    for (const model of dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1);
      tx[name] = f.db[name];
    }
    tx.$queryRaw = async (q, ...values) => {
      if (Array.isArray(q)) q = require('@rental-os/platform-server/prisma-runtime').prismaRuntime.sql(q, ...values);
      const text = q.sql.replace(/\s+/gu, ' ').trim();
      state.queries.push(text);
      if (text.includes('FROM Tenant')) return [{ id: 'tenant-a', status: 'active' }];
      if (text.includes('FROM platform_core_access_locks'))
        return [{ tenantId: 'tenant-a', coreId: 'rental' }];
      if (text.includes('FROM platform_tenant_core_grants'))
        return [{ state: state.grant, revision: 1n, operationId: 'grant-a' }];
      if (text.includes('FROM platform_member_core_assignments'))
        return [{ state: state.assigned, revision: 1n, operationId: 'assignment-a' }];
      if (text.includes('FROM platform_core_bindings'))
        return [
          {
            bindingId: 'binding-a',
            revision: 1n,
            dataVersion: '0.1.0',
            containerType: 'rental-workspace',
            containerId: 'workspace-a',
          },
        ];
      throw Error('unexpected SQL');
    };
    tx.operationLog = {
      create: async (input) => {
        assert.equal(state.depth, 1);
        assert.equal(getRequestIdentity()?.accessSession?.sessionId, 'session-a');
        if (state.logFailure) throw Error('private-db-credentials');
        state.pendingLogs.push(structuredClone(input));
        return { id: 'log-a' };
      },
    };
    try {
      const result = await callback(tx);
      state.committedLogs.push(...state.pendingLogs);
      return result;
    } finally {
      state.pendingLogs = [];
      state.depth--;
    }
  };
  const access = createRentalApplicationAccess({
    database: f.db,
    authorization: f.authorization,
    term: {
      requireNewBusiness: async () => {
        throw Error('unexpected term');
      },
    },
    deploymentForTransaction: (tx) => ({
      requireAvailable: async () => {
        assert.equal(typeof tx.$queryRaw, 'function');
        if (!state.available) throw Error('deployment unavailable');
      },
    }),
  });
  const token = f.rental.auth.signAccessToken({
    sub: state.user.id,
    tid: 'tenant-a',
    sid: 'session-a',
    wid: state.workspace,
    aud: 'operator',
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const request = () => ({
    method: 'POST',
    url: '/api/ai-native/knowledge-management/uploads/read',
    originalUrl: '/api/ai-native/knowledge-management/uploads/read',
    headers: { authorization: 'Bearer ' + token },
    query: {},
    body: { documentId: 'document-a', sessionId: 'upload-a' },
    staffApiRequest: false,
  });
  const invoke = (work) =>
    runWithRequestIdentity({}, () =>
      access.run(async () => {
        const req = request();
        assert.equal(await f.guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
        return access.withRequest(req, () => work(req));
      }),
    );
  const transport = async (input) => {
    assert.equal(state.depth, 0, 'object transport outside transaction');
    assert.equal(input.maxResponseBytes, bytes.length);
    state.dispatches++;
    if (state.afterDispatch) await state.afterDispatch();
    return {
      status: 200,
      bytes: Uint8Array.from(bytes),
      headers: { 'content-type': 'text/plain', 'content-length': String(bytes.length) },
    };
  };
  const readBody = () => f.rental.integrations.files.readKnowledgeBytes('tenant-a', 'file-a', owner, 262144);
  const uploadInput = knowledgeUploadRequest({
    documentId: 'fresh-a',
    fileName: 'upload.txt',
    mimeType: 'text/plain',
    sizeBytes: 5,
  });
  const authorizeUpload = () =>
    f.factory.participants.knowledge.knowledgeFiles.authorizeUpload('tenant-a', uploadInput, {
      ...owner,
      businessId: 'fresh-a',
    });
  require('./knowledge-scene-cases.cjs').prepareFixture({ ...f, state });
  return {
    ...f,
    state,
    access,
    request,
    invoke,
    transport,
    readBody,
    authorizeUpload,
    owner,
    bytes,
    asset,
    row,
  };
}
const { test } = require('node:test');
test('启用宿主的实际 DI、知识权限与原结果边界', async (t) => {
  try {
    await t.test('缺 selected 或知识请求上下文时拒绝且不读政策', async () => {
      const none = knowledgeFixture();
      await assert.rejects(
        none.binding.withRequest(none.request(), async () => true),
        unavailable,
      );
      assert.throws(none.authorizeUpload, unavailable);
      assert.equal(none.state.policyReads, 0);
      console.log('PASS no selected/knowledge request rejects without policy IO');
    });
    await t.test('真实 Auth、Guard、access 与文件审计共用原身份', async () => {
      const good = knowledgeFixture();
      currentTransport = good.transport;
      await good.invoke((req) =>
        good.binding.withRequest(req, async () => {
          await good.authorizeUpload();
          const result = await runWithRequestIdentity({}, good.readBody);
          assert.deepEqual(result.bytes, good.bytes);
          assert.equal(good.state.dispatches, 1);
          assert.equal(good.state.committedLogs.length, 1);
          assert.equal(good.state.committedLogs[0].data.workspaceId, 'workspace-a');
          assert.equal(good.state.committedLogs[0].data.userId, 'operator-a');
          const encoded = JSON.stringify(good.state.committedLogs);
          assert(!encoded.includes('synthetic knowledge bytes'));
          assert(!encoded.includes('Bearer'));
          assert(!encoded.includes('offline-secret'));
        }),
      );
      assert(good.state.policyReads >= 4);
      assert(good.state.transactions >= 4);
      console.log(
        'PASS actual Auth/Guard/access + original file/policy/object/audit positive; isolated AI ALS restores exact request; one object GET and same-tx scoped audit',
      );
    });
    await t.test('政策结果未知拒绝且不释放内部错误', async () => {
      const unknown = knowledgeFixture();
      unknown.state.policyThrows = true;
      currentTransport = unknown.transport;
      await unknown.invoke((req) =>
        unknown.binding.withRequest(req, async () => {
          await assert.rejects(unknown.readBody, unavailable);
        }),
      );
      assert.equal(unknown.state.dispatches, 0);
      console.log('PASS unknown policy fails closed without internal error exposure');
    });
    await t.test('当前角色、地点、会话、空间或改密状态变化拒绝', async () => {
      for (const change of ['role', 'location', 'session', 'workspace', 'password']) {
        const f = knowledgeFixture();
        await f.invoke((req) =>
          f.binding.withRequest(req, async () => {
            if (change === 'role') f.state.user.permissions = [];
            if (change === 'password') f.state.user.mustChangePassword = true;
            if (change === 'location')
              f.state.user.locationScope = { mode: 'selected', locationIds: ['other-place'] };
            if (change === 'session') f.state.active = false;
            if (change === 'workspace') f.state.workspace = 'workspace-b';
            await assert.rejects(f.authorizeUpload, unavailable);
          }),
        );
        assert.equal(f.state.policyReads, 0);
      }
      console.log(
        'PASS changed role/location/session/workspace rejects exact original request before file policy',
      );
    });
    await t.test('唯一对象 GET 后撤销 Core，不审计、不返回字节、不重试', async () => {
      const after = knowledgeFixture();
      currentTransport = after.transport;
      after.state.afterDispatch = () => {
        after.state.grant = 'disabled';
      };
      await after.invoke((req) =>
        after.binding.withRequest(req, async () => {
          await assert.rejects(after.readBody, unavailable);
        }),
      );
      assert.equal(after.state.dispatches, 1);
      assert.equal(after.state.committedLogs.length, 0);
      console.log('PASS revoke after sole GET denies same-tx audit and body; no retry');
    });
    await t.test('必需审计失败回滚且隐藏原始错误', async () => {
      const audit = knowledgeFixture();
      currentTransport = audit.transport;
      audit.state.logFailure = true;
      await audit.invoke((req) =>
        audit.binding.withRequest(req, async () => {
          await assert.rejects(audit.readBody, (e) => unavailable(e) && !e.message.includes('private-db'));
        }),
      );
      assert.equal(audit.state.dispatches, 1);
      assert.equal(audit.state.committedLogs.length, 0);
      console.log(
        'PASS requireSuccess audit failure rolls back and hides body/private error without repeat GET',
      );
    });
    await t.test('退出后异步续体不能继承知识凭据', async () => {
      let escaped;
      const closed = knowledgeFixture();
      await closed.invoke((req) =>
        closed.binding.withRequest(req, async () => {
          escaped = require('node:async_hooks').AsyncLocalStorage.snapshot();
        }),
      );
      const before = closed.state.sessionReads;
      await assert.rejects(async () => escaped(closed.authorizeUpload), unavailable);
      assert.equal(closed.state.sessionReads, before);
      console.log('PASS escaped async continuation after withRequest cannot inherit knowledge credentials');
    });
    await t.test('父 selected 作用域关闭使待执行知识回调失效', async () => {
      let proceed, started;
      const continueAfter = new Promise((resolve) => {
          proceed = resolve;
        }),
        inScope = new Promise((resolve) => {
          started = resolve;
        });
      let inFlight;
      const parentClosed = knowledgeFixture();
      await parentClosed.invoke((req) => {
        inFlight = parentClosed.binding.withRequest(req, async () => {
          started();
          await continueAfter;
          await parentClosed.authorizeUpload();
        });
        inFlight.catch(() => {});
        return inScope;
      });
      proceed();
      await assert.rejects(inFlight);
      assert.equal(parentClosed.state.policyReads, 0);
      console.log(
        'PASS original selected/internal scope closure rejects even while knowledge callback remains pending',
      );
    });
    await t.test('真实 Nest DI 解析全部 AI 原工厂并保留同实例业务端口', async () => {
      const { Module: NestModule } = require('@nestjs/common');
      const { NestContainer } = require('@nestjs/core/injector/container');
      const { DependenciesScanner } = require('@nestjs/core/scanner');
      const { InstanceLoader } = require('@nestjs/core/injector/instance-loader');
      const { Injector } = require('@nestjs/core/injector/injector');
      const { ApplicationConfig } = require('@nestjs/core/application-config');
      const { MetadataScanner } = require('@nestjs/core/metadata-scanner');
      const { GraphInspector } = require('@nestjs/core/inspector/graph-inspector');
      const { STATIC_CONTEXT } = require('@nestjs/core/injector/constants');
      const providers = require('@rental-os/ai-native-server/runtime/ai-native-application.providers');
      const taskCenter = require('@rental-os/ai-native-server/runtime/task-center.application');
      const { AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_OPERATIONS } =
        require('@rental-os/ai-native-server/runtime/inspection-assist/staff-inspection-assist.controller');
      const { RENTAL_AI_CONTROLLERS, RENTAL_AI_INSPECTION_OPERATIONS, RENTAL_AI_MOUNTED_REQUESTS } =
        require(path.join(root, 'apps/rental-api/src/ai-http-policy.ts'));
      const factoryCalls = new Map(), centerInputs = [], effects = [];
      const restores = [];
      const replace = (target, name, value) => {
        const previous = Object.getOwnPropertyDescriptor(target, name);
        Object.defineProperty(target, name, { configurable: true, writable: true, value });
        restores.push(() => previous ? Object.defineProperty(target, name, previous) : delete target[name]);
      };
      const forbid = name => () => { effects.push(name); throw Error('DI must not ' + name); };
      const hooks = ['onModuleInit', 'onApplicationBootstrap', 'beforeApplicationShutdown',
        'onModuleDestroy', 'onApplicationShutdown'];
      const originalCenter = taskCenter.composeRequestBoundTaskCenter;
      // Transparent observation: execute the original factory once with its actual Nest arguments.
      replace(taskCenter, 'composeRequestBoundTaskCenter', input => {
        centerInputs.push(input);
        return originalCenter(input);
      });
      replace(globalThis, 'setInterval', forbid('start interval'));
      replace(globalThis, 'setTimeout', forbid('start timeout'));
      replace(modelTransport, 'createNativeModelEgressTransport', originalTransport);
      for (const name of ['get', 'post', 'postStream', 'getModelDirectory'])
        replace(modelTransport.ModelEgressTransport.prototype, name, forbid('dispatch model/object transport'));
      try {
        // Actual application/Guard and exact selected-schema metadata. This is composition DI,
        // not an installed archive/root-host test; no package loader or admission is replaced.
        const f = compositionFixture();
        assert.deepEqual(requireRentalAiSelection(f.binding.lock), lock);
        assert.equal(Object.keys(f.db._runtimeDataModel.models).length, 247);
        for (const name of ['$transaction', '$connect', '$disconnect', '$queryRaw'])
          replace(f.db, name, forbid(name));
        const adapter = (file, name) => require('@rental-os/ai-native-server/runtime/rental-adapters/' + file)[name];
        const sourceAliases = [
          [adapter('prisma.service', 'PrismaService'), f.db],
          [ConfigService, f.config],
          [require('@rental-os/platform-server/secret-box').SecretBox, f.rental.secrets],
          [adapter('auth.service', 'AuthService'), f.rental.auth],
          [adapter('api-auth.guard', 'ApiAuthGuard'), f.guard],
          [require('@rental-os/rental-core/mysql-client-application').ClientApiService, f.rental.client.api],
          [require('@rental-os/rental-core/mysql-client-delivery-address').ClientDeliveryAddressService, f.rental.client.addresses],
          [adapter('rental-core.service', 'RentalCoreService'), f.rental.primary.core],
          [adapter('rental-business.service', 'RentalBusinessService'), f.rental.primary.business],
          [adapter('rental-core-fact.repository', 'RentalCoreFactRepository'), f.rental.foundation.coreFacts],
          [adapter('rental-business-fact.repository', 'RentalBusinessFactRepository'), f.rental.foundation.businessFacts],
          [adapter('rental-core-config.repository', 'RentalCoreConfigRepository'), f.rental.foundation.coreConfiguration],
          [adapter('rental-business-config.repository', 'RentalBusinessConfigRepository'), f.rental.foundation.businessConfiguration],
          [adapter('rental-allocation.service', 'RentalAllocationService'), f.rental.workers.allocation],
          [adapter('rental-funding.service', 'RentalFundingService'), f.rental.foundation.funding],
          [adapter('rental-idempotency.repository', 'RentalIdempotencyRepository'), f.rental.foundation.receipts],
          [adapter('rental-order-confirmation.service', 'RentalOrderConfirmationService'), f.rental.orderConfirmation],
          [require('@rental-os/rental-core/mysql-reports').RentalWorkspaceReportRepository, f.rental.integrations.reports],
          [adapter('workspace-capability.service', 'WorkspaceCapabilityService'), f.rental.foundation.capabilities],
          [require('@rental-os/rental-core/mysql-enterprise-merchant-delegation').EnterpriseMerchantDelegationService, f.rental.enterprise.delegations],
          [require('@rental-os/rental-core/mysql-membership').MembershipService, f.rental.customers.memberships],
          [adapter('payment.runtime.service', 'PaymentRuntimeService'), f.rental.integrations.payments],
          [require('@rental-os/platform-server/tenant-integration').TenantIntegrationService, f.rental.integrations.integrations],
          [require('@rental-os/platform-server/subscription').SubscriptionService, f.rental.subscriptions],
          [adapter('operation-log.service', 'OperationLogService'), f.binding.operationLogs],
          [adapter('platform.service', 'PlatformService'), f.customers],
        ];
        for (const [, source] of sourceAliases) for (const hook of hooks)
          if (typeof source[hook] === 'function') replace(source, hook, forbid('invoke ' + hook));
        for (const hook of hooks) if (typeof f.rental.workers.dueJobs[hook] === 'function')
          replace(f.rental.workers.dueJobs, hook, forbid('invoke worker ' + hook));
        const SOURCE = Symbol('actual enabled Rental AI binding');
        class Sources {}
        NestModule({ providers: [{ provide: SOURCE, useValue: f.binding }], exports: [SOURCE] })(Sources);
        const definition = RentalAiCompositionModule.registerFactory({ imports: [Sources], inject: [SOURCE],
          useFactory: binding => binding, inspectionOperations: RENTAL_AI_INSPECTION_OPERATIONS,
          httpPublication: { isMounted: token => RENTAL_AI_MOUNTED_REQUESTS.includes(token) } });
        class HttpComposition {}
        NestModule({ imports: [definition], controllers: [...RENTAL_AI_CONTROLLERS] })(HttpComposition);
        const applicationConfig = new ApplicationConfig(), container = new NestContainer(applicationConfig);
        const graph = new GraphInspector(container);
        class ObservedInjector extends Injector {
          async instantiateClass(instances, wrapper, ...rest) {
            if (wrapper.inject != null) {
              const calls = factoryCalls.get(wrapper.token) ?? [];
              calls.push([...instances]); factoryCalls.set(wrapper.token, calls);
            }
            return super.instantiateClass(instances, wrapper, ...rest);
          }
        }
        const injector = new ObservedInjector();
        await new DependenciesScanner(container, new MetadataScanner(), graph, applicationConfig).scan(HttpComposition);
        // This invokes constructors/factories only, never NestFactory, init/listen or lifecycle hooks.
        const loader = new InstanceLoader(container, injector, graph);
        loader.setLogger({ log() {} });
        await loader.createInstancesOfDependencies();
        const modules = [...container.getModules().values()];
        const aiModule = modules.find(module => module.metatype === RentalAiCompositionModule);
        assert(aiModule);
        const get = token => {
          const wrapper = aiModule.providers.get(token);
          assert(wrapper, 'registered AI token ' + String(token));
          assert.equal(wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, String(token));
          return wrapper.instance;
        };
        for (const provider of definition.providers) {
          const token = typeof provider === 'function' ? provider : provider.provide;
          get(token);
          if (provider.useFactory) assert.equal(factoryCalls.get(token)?.length, 1, 'single factory ' + String(token));
        }
        assert.equal(get(RENTAL_AI_BINDING), f.binding);
        const sourceProbe = Symbol('original service receiver');
        for (const [token, source] of sourceAliases) {
          const view = get(token);
          // A real serviceView binds methods to the original instance and masks only lifecycle.
          replace(source, sourceProbe, function () { return this; });
          assert.equal(view[sourceProbe](), source, 'same source ' + token.name);
          for (const hook of hooks) assert.equal(view[hook], undefined, token.name + '.' + hook);
        }
        assert.equal(get(providers.AI_NATIVE_BODY_DATABASE), f.binding.bodyDatabase);
        assert.equal(get(providers.AI_NATIVE_BUSINESS_FAILURE_RESOURCES), f.binding.resources);
        assert.equal(get(adapter('file-storage.runtime.service', 'FileStorageRuntimeService')), f.binding.files);
        const centerProvider = providers.AI_NATIVE_TASK_CENTER_PROVIDER;
        const center = get(centerProvider.provide), call = factoryCalls.get(centerProvider.provide);
        assert.equal(call.length, 1);
        assert.equal(centerInputs.length, 1, 'original TaskCenter composition ran once');
        const centerInput = centerInputs[0];
        const auth = get(adapter('auth.service', 'AuthService'));
        const guard = get(adapter('api-auth.guard', 'ApiAuthGuard'));
        const orders = get(adapter('rental-core-fact.repository', 'RentalCoreFactRepository'));
        const quotes = get(adapter('rental-business-fact.repository', 'RentalBusinessFactRepository'));
        assert.equal(call[0][0], f.binding.bodyDatabase);
        assert.equal(call[0][1], auth); assert.equal(call[0][3], guard);
        assert.equal(call[0][7], quotes); assert.equal(call[0].at(-1), orders);
        assert.equal(centerInput.db, f.binding.bodyDatabase);
        assert.equal(centerInput.auth, auth); assert.equal(centerInput.guard, guard);
        assert.equal(centerInput.transactions.auth, auth);
        assert.equal(centerInput.transactions.orders, orders); assert.equal(centerInput.transactions.quotes, quotes);
        assert.equal(centerInput.originalDb, centerInput.db); assert.equal(centerInput.visibleDb, centerInput.db);
        assert.equal(typeof center.stop, 'function');
        await assert.rejects(center.stop({ headers: {} }, { taskId: 'task-a', expectedRevision: 1 }),
          error => error.code === 'AI_ACCESS_DENIED');
        assert.equal(typeof get(RENTAL_AI_INSPECTION_BINDING).bindInspectionEvidence, 'function');
        for (const provider of [providers.AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER,
          providers.AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER, providers.AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER]) {
          // HTTP publication cannot enable a model driver without its original
          // server configuration, capability evidence and current task admission.
          await assert.rejects(get(provider.provide).start({ headers: {} }, {}),
            error => error.code === 'AI_RESOURCE_UNAVAILABLE');
        }
        assert.deepEqual(get(AI_STAFF_INSPECTION_OPERATIONS), [
          'history-read', 'receipt-host-read', 'draft-operation', 'submission-preparation',
          'submission-read', 'fulfillment-receipt-read',
        ], 'default publication exposes original receipts only; host allowlist does not enable new work');
        const http = modules.find(module => module.metatype === HttpComposition);
        for (const controller of RENTAL_AI_CONTROLLERS) {
          const wrapper = http.controllers.get(controller);
          assert.equal(wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, controller.name);
          assert(wrapper.instance instanceof controller);
          for (const dependency of wrapper.getCtorMetadata() ?? [])
            if (dependency) assert.equal(dependency.instance, get(dependency.token));
        }
        assert.deepEqual(f.trace.db, []); assert.deepEqual(effects, []);
        assert.equal(forbiddenDefaultLoads, 0);
        const factories = definition.providers.filter(provider => provider.useFactory).length;
        console.log('PASS real Nest DI: ' + modules.length + ' modules, ' + factories + ' factories, '
          + sourceAliases.length + ' same-source aliases, ' + RENTAL_AI_CONTROLLERS.length
          + ' original controllers; TaskCenter Auth/Guard/orders/quotes order and single source; zero IO/lifecycle/timers/default Client');
      } finally {
        for (const restore of restores.reverse()) restore();
      }
    });
    await require('./model-settings-cases.cjs')({ t, knowledgeFixture });
    await require('./knowledge-scene-cases.cjs')({ t, knowledgeFixture });
    await require('./task-center-cases.cjs')({ t, knowledgeFixture });
    await require('./ai-http-cases.cjs')({ t, lock });
    await require('./ai-client-http-cases.cjs')({ t });
    await require('./ai-multi-core-cases.cjs')({ t, lock, knowledgeFixture });
    await t.test('官方双 Client 独立运行值与嵌套正文保护', async () => {
      const { prismaRuntime: p } = require('@rental-os/platform-server/prisma-runtime');
      const official = generatedModule.exports.Prisma;
      for (const name of ['DbNull', 'JsonNull', 'AnyNull', 'Decimal', 'PrismaClientKnownRequestError'])
        assert.equal(p[name], official[name], name + ' keeps original official identity');
      const query = p.sql(['SELECT ', ' FROM ', ' WHERE id IN (', ')', ''],
        p.raw('id'), p.raw('example'), p.join(['a', 'b']), p.empty);
      assert.equal(query.sql, 'SELECT id FROM example WHERE id IN (?,?)');
      assert.deepEqual(query.values, ['a', 'b']);
      assert.equal(new p.Decimal('0.1').plus('0.2').toString(), '0.3');
      assert(new p.PrismaClientKnownRequestError('synthetic', { code: 'P2002', clientVersion: '5.22.0' })
        instanceof official.PrismaClientKnownRequestError);
      assert.deepEqual(Object.values(p.TransactionIsolationLevel),
        ['ReadUncommitted', 'ReadCommitted', 'RepeatableRead', 'Serializable']);

      const publicSchema = fs.readFileSync(root + '/apps/platform-api/prisma/schema.prisma', 'utf8');
      const publicDmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: publicSchema, noColor: true })));
      assert.equal(publicDmmf.datamodel.models.length, 40);
      const publicClientFile = root + '/apps/platform-api/generated/client/index.js';
      const publicModule = new Module(publicClientFile);
      publicModule.filename = publicClientFile;
      publicModule.paths = [deps];
      publicModule._compile(new generatorModule.exports.__OfflineTSClient({ ...options,
        dmmf: generator.externalToInternalDmmf(publicDmmf), datamodel: publicSchema,
        outputDir: root + '/apps/platform-api/generated/client' }).toJS(), publicClientFile);
      // Constructors only: neither Client connects, queries, generates files or runs lifecycle hooks.
      const selectedClient = new generatedModule.exports.PrismaClient();
      const publicClient = new publicModule.exports.PrismaClient();
      assert.equal(Object.keys(selectedClient._runtimeDataModel.models).length, 247);
      assert.equal(Object.keys(publicClient._runtimeDataModel.models).length, 40);
      const { createAiBodyStorageDatabase, bindAiBodyStorageTransaction } =
        require('@rental-os/ai-native-server/runtime/privacy/prisma-ai-body-storage');
      const { AiBodyStorageCodec, AI_BODY_TITLE_PLACEHOLDER } =
        require('@rental-os/ai-native-server/runtime/privacy/ai-body-storage.codec');
      const { SecretBox } = require('@rental-os/platform-server/secret-box');
      const cipher = new SecretBox({ get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-body-test-secret' : undefined });
      const codec = new AiBodyStorageCodec(cipher);
      const { AiTaskRepositoryError } = require('@rental-os/ai-native-server/task-errors');
      const bodyUnavailable = error => error instanceof AiTaskRepositoryError && error.code === 'AI_RESOURCE_UNAVAILABLE';
      const selectedView = createAiBodyStorageDatabase(selectedClient, cipher);
      const publicView = createAiBodyStorageDatabase(publicClient, cipher);
      assert.equal(typeof selectedView.aiKnowledgeDocument.create, 'function');
      assert.equal(publicView.aiKnowledgeDocument, undefined);
      for (const value of [p.DbNull, p.JsonNull])
        assert.equal(codec.encode('aiKnowledgeChunk', 'text', ['chunk-a'], value), value);
      assert.throws(() => createAiBodyStorageDatabase({}, cipher), bodyUnavailable);
      assert.throws(() => createAiBodyStorageDatabase({ _runtimeDataModel: { models: {} } }, cipher), bodyUnavailable);
      assert.throws(() => createAiBodyStorageDatabase({
        _runtimeDataModel: publicClient._runtimeDataModel, aiKnowledgeDocument: { create() {} },
      }, cipher), bodyUnavailable);

      let stored, writes = 0, reads = 0, seenArgs;
      const tx = { aiKnowledgeDocument: {
        create: async args => {
          writes++;
          seenArgs = args;
          const data = args.data;
          stored = { ...data, versions: data.versions.create.map(version => ({
            ...version, chunks: version.chunks.create,
          })) };
          return structuredClone(stored);
        },
        findMany: async () => { reads++; return [structuredClone(stored)]; },
      } };
      const native = { _runtimeDataModel: selectedClient._runtimeDataModel,
        aiKnowledgeDocument: tx.aiKnowledgeDocument, $transaction: async callback => callback(tx) };
      const view = createAiBodyStorageDatabase(native, cipher);
      const input = { data: {
        id: 'document-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', title: 'private title',
        state: { document: { title: 'private title' } },
        versions: { create: [{ id: 'version-a', chunks: { create: [{
          id: 'chunk-a', text: 'private body', state: { chunk: { text: 'private body' } },
        }] } }] },
      }, include: { versions: { include: { chunks: true } } } };
      const result = await view.$transaction(bound => {
        assert.equal(bindAiBodyStorageTransaction(view, tx), bound, 'same transaction and model graph');
        return bound.aiKnowledgeDocument.create(input);
      });
      assert.equal(result.title, 'private title');
      assert.equal(result.versions[0].chunks[0].text, 'private body');
      assert.equal(result.versions[0].chunks[0].state.chunk.text, 'private body');
      assert.equal(seenArgs.data.title, AI_BODY_TITLE_PLACEHOLDER);
      assert(codec.isSealed(seenArgs.data.state.document.title));
      assert(codec.isSealed(seenArgs.data.versions.create[0].chunks.create[0].text));
      assert(codec.isSealed(seenArgs.data.versions.create[0].chunks.create[0].state.chunk.text));
      assert.equal(input.data.versions.create[0].chunks.create[0].text, 'private body', 'caller input is not mutated');
      // A public graph created later cannot replace this view's nested encryption map.
      createAiBodyStorageDatabase(publicClient, cipher);
      const observed = await view.aiKnowledgeDocument.findMany({ include: { versions: { include: { chunks: true } } } });
      assert.equal(observed[0].versions[0].chunks[0].text, 'private body');
      await assert.rejects(view.aiKnowledgeDocument.findMany({ where: {
        versions: { some: { chunks: { some: { text: { contains: 'private body' } } } } },
      } }), bodyUnavailable);
      assert.equal(reads, 1, 'nested body query denied before delegate');
      stored.versions[0].chunks[0].id = 'another-chunk';
      await assert.rejects(view.aiKnowledgeDocument.findMany({}), bodyUnavailable);
      assert.equal(writes, 1, 'corrupt binding is not rewritten');
      const explicit = createAiBodyStorageDatabase({ aiKnowledgeDocument: tx.aiKnowledgeDocument }, cipher,
        generatedModule.exports.Prisma.dmmf);
      assert.equal(typeof explicit.aiKnowledgeDocument.create, 'function');
      native.unlistedModel = { create() { throw Error('unlisted delegate must not be called'); } };
      assert.throws(() => view.unlistedModel, bodyUnavailable);
      assert.equal(forbiddenDefaultLoads, 0, 'no default generated Client was loaded');
      console.log('PASS official SQL/null/Decimal identities, 247+40 graph isolation, nested encryption and fail closed metadata');
    });
  } finally {
    modelTransport.createNativeModelEgressTransport = originalTransport;
    outbound.assertOutboundUrl = originalOutbound;
    cleanup();
  }
});
