/** MCP 固定数据材料与完整能力包发行。只核字节、来源和合同；不执行 SQL 或证明原账已存在。 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CorePlatformDataCapabilityReleaseSchema, CoreSourceSchema,
  type CorePlatformDataCapabilityRelease } from '@rental-os/core-contracts';
import { createCoreArchive } from '@rental-os/core-contracts/archive';
import { readPlatformDataCapabilityPackage, requirePlatformDataCapabilityFiles } from '@rental-os/core-contracts/platform-data-package';

const schema = { file: 'prisma/schema.prisma', sha256: '8c3ad36c896693d3d056a9d1b067bf8c26cf222ed5aeadf7a1e367ae30fe7a63' } as const;
// Each build shape is pinned independently; existing installed shapes keep
// their original data version and migration identities.
const packageShapes = new Map([
  ['ce4caeecbd0b4b81a879f02d4e845b6f7eb8fbaf8b5b89024c670a6a8afb1202', '723a3e360d87002c026dd2278aea1d386e4d78ccf6d16b5d1c24fae9ab9b46ff'],
  ['f0386e52ce9bc6a49e0df9189bc7f81815bc67f7785dcbb10ca4358ae8e5a486', '720b367462add2cfba45bb0a3eb65347f6cc2cc8ea18d9d994f32cb0c7063277'],
  ['26ca72466491f81e793101c349bc291f34935aa73f902c9eaa5f7ea32707ae6a', '5b83831e3b469e8efc453870873f5bf9c443ee551d27da1414cfb3b57edb37f9'],
  ['2d6b422be72a6d4f1373ad8de3f1f491e9a40d9450e1a54c944b7d3b164f3e3b', 'ecd9f801f0e9d5f871ad95782942f794645b523282490ceabb23192f2e04c4d6'],
  ['691cd5e26ab2a7c4699fceecd34eb70fbf4eae0e15192b875511fb13c05e447d', '25d80b0e0fbeae7dfbf8cfc889d52e33772cb36f43a700156bf5c082042a07ca'],
  ['971ae3b1967475d8c9df84c972a8679db691e3f2f8c2577763e4806d0a913508', 'ecd9f801f0e9d5f871ad95782942f794645b523282490ceabb23192f2e04c4d6'],
]);
const migrations = [
  { id: 'mcp.0001-oauth', file: 'mysql-oauth-schema.sql', sha256: 'aa8f6004c1be402bd6adeda56bba9275d820cfdea43d52483429e684b5ddded4', requires: [] },
  { id: 'mcp.0002-read-budget', file: 'mysql-read-budget-schema.sql', sha256: 'c54ba21bd473f90c3be26761a60421af3fb2f6fc4f56f4edc9f2ab7bc73ef802', requires: [] },
  { id: 'mcp.0003-catalog-goal', file: 'mysql-catalog-goal-schema.sql', sha256: 'f2069c89c85257af8077df64335623d30f97516f131fe58a6089b18832045082', requires: ['mysql-oauth-schema.sql', 'mysql-read-budget-schema.sql'] },
  { id: 'mcp.0004-catalog-intent', file: 'mysql-catalog-goal-intent-schema.sql', sha256: 'db0011329f63a56f0fe199687925323a283b5de211065a60f1f1b0c06db49b57', requires: [] },
  { id: 'mcp.0005-catalog-adoption', file: 'mysql-catalog-goal-adoption-schema.sql', sha256: '1b3e6d471224bf49c77da04d6970829634979cc340786907f1348e2ec098e929', requires: ['mysql-catalog-goal-intent-schema.sql'] }
] as const;

export const MCP_DATA_CAPABILITY_VERSION = '0.1.1';

/** 本数据版仅声明已核定的公共数据基线；运行时业务依赖仍由原宿主提供。 */
export function mcpDataPrerequisites(): CorePlatformDataCapabilityRelease['prerequisites'] {
  return { platform: { minInclusive: '0.1.9', maxExclusive: '0.1.10' }, cores: [] };
}

function releaseMetadata(): Omit<CorePlatformDataCapabilityRelease, 'source' | 'sha256' | 'files'> {
  return {
    id: 'mcp', version: MCP_DATA_CAPABILITY_VERSION,
    compatibility: { platform: { minInclusive: '0.1.0', maxExclusive: '0.3.0' },
      contract: { minInclusive: '0.1.1', maxExclusive: '0.2.0' } },
    runtime: { node: { minInclusive: '22.0.0', maxExclusive: '25.0.0' } },
    schema: { ...schema },
    data: { version: '0.1.0', readable: { minInclusive: '0.1.0', maxExclusive: '0.1.1' },
      migrations: migrations.map(({ id, file, sha256 }) => ({ id, file, sha256 })) },
    prerequisites: mcpDataPrerequisites()
  };
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function bytesFor(files: ReadonlyMap<string, Uint8Array>, file: string): Uint8Array {
  const bytes = files.get(file);
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error(`MCP 固定包缺少文件：${file}`);
  return bytes;
}
function decode(bytes: Uint8Array): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }

/** 所有公开入口必须来自同一完整构建包；仅 SQL 材料摘要不能冒充包摘要。 */
function checkPackage(files: ReadonlyMap<string, Uint8Array>): void {
  const metadata = JSON.parse(decode(bytesFor(files, 'package.json'))) as {
    name?: unknown; version?: unknown; license?: unknown; exports?: Record<string, unknown>;
  };
  if (metadata.name !== '@rental-os/mcp-server' || metadata.version !== MCP_DATA_CAPABILITY_VERSION
    || metadata.license !== 'MIT' || !metadata.exports || typeof metadata.exports !== 'object' || Array.isArray(metadata.exports))
    throw new Error('MCP 固定包身份或出口无效');
  const packageBuildPathsSha256 = packageShapes.get(digest(Buffer.from(JSON.stringify(metadata))));
  if (!packageBuildPathsSha256) throw new Error('MCP 固定包元数据与本实现不一致');
  // 未导出的内部模块同样参与运行，不能只检查 package.json 中的公开入口。
  const buildPaths = [...files.keys()].filter(file => file.startsWith('dist/')).sort();
  if (digest(Buffer.from(JSON.stringify(buildPaths))) !== packageBuildPathsSha256)
    throw new Error('MCP 固定包的构建文件集合不完整或发生变化');
  for (const file of buildPaths) bytesFor(files, file);
  for (const entry of ['.', './data-capability', './mysql-data', './data-contribution.json'])
    if (!Object.hasOwn(metadata.exports, entry)) throw new Error(`MCP 固定包缺少声明入口：${entry}`);
  for (const [entry, target] of Object.entries(metadata.exports)) {
    const targets = typeof target === 'string' ? [target]
      : target && typeof target === 'object' && !Array.isArray(target) ? Object.values(target) : [];
    if (!targets.length || targets.some(value => typeof value !== 'string' || !value.startsWith('./')
      || value.includes('..') || value.includes('\\'))) throw new Error(`MCP 包出口无效：${entry}`);
    for (const value of targets) bytesFor(files, (value as string).slice(2));
  }
  bytesFor(files, 'README.md');
  bytesFor(files, 'LICENSE');
  const contribution = JSON.parse(decode(bytesFor(files, 'data-contribution.json')));
  const expected = { formatVersion: 1, capabilityId: 'mcp', owner: 'platform-capability:mcp', provider: 'mysql',
    sql: migrations.map(({ file, sha256, requires }) => ({ file, sha256, requires: [...requires] })) };
  if (!isDeepStrictEqual(contribution, expected)) throw new Error('MCP 数据贡献清单与本版固定材料不一致');
  for (const artifact of [schema, ...migrations])
    if (digest(bytesFor(files, artifact.file)) !== artifact.sha256) throw new Error(`MCP 数据材料摘要变化：${artifact.file}`);
}

/** 来源由发行者从同一次固定提交提供；候选归档不代表已发布或已安装。 */
export function createMcpDataRelease(input: {
  files: ReadonlyMap<string, Uint8Array>; source: CorePlatformDataCapabilityRelease['source'];
}): CorePlatformDataCapabilityRelease {
  checkPackage(input.files);
  return CorePlatformDataCapabilityReleaseSchema.parse({ ...releaseMetadata(), source: CoreSourceSchema.parse(input.source),
    sha256: createCoreArchive(input.files).sha256,
    files: [...input.files].sort(([a], [b]) => a.localeCompare(b)).map(([file, bytes]) => ({ file, sha256: digest(bytes) })) });
}

function readVerified(files: ReadonlyMap<string, Uint8Array>, release: CorePlatformDataCapabilityRelease) {
  checkPackage(files);
  const { source: _source, sha256: _sha256, files: _files, ...metadata } = release;
  if (!isDeepStrictEqual(metadata, releaseMetadata())) throw new Error('MCP 发行版本、schema、迁移或前置与本实现不一致');
  return { release, schema: decode(bytesFor(files, schema.file)),
    migrations: migrations.map(({ id, file, sha256 }) => ({ id, file, sha256, sql: decode(bytesFor(files, file)) })) };
}

export function readMcpDataPackage(files: ReadonlyMap<string, Uint8Array>, release: CorePlatformDataCapabilityRelease) {
  return readVerified(files, requirePlatformDataCapabilityFiles(files, release));
}

export function requireMcpDataPackage(directory: string, release: CorePlatformDataCapabilityRelease) {
  const installed = readPlatformDataCapabilityPackage(directory, release);
  return { root: installed.root, files: installed.files, ...readVerified(installed.files, installed.release) };
}
