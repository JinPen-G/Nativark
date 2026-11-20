'use strict';
/** 从锁定的纯源码底座归档复算公共运行产物。沿原 tsconfig、所选 Client 和 tsc Program，
 * 只在内存 emit；既有 dist 不作为输入，不执行归档代码/脚本，也不生成或启动 Client。
 * 构建器及原锁对应的本地编译依赖属于受控构建环境，记录实际输入，不将摘要当签名。 */
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const { selectedCompilerOptions, compileTypeScriptProgram } = require('./build-selected-prisma.cjs');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const inside = (parent, file) => file === parent || file.startsWith(parent + '/');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const publicDirectories = Object.freeze(['packages/platform-contracts', 'packages/core-contracts', 'packages/core-host',
  'packages/platform-server', 'packages/platform-core-host', 'apps/platform-api']);
const runtimeFile = file => /^dist(?:-[a-z0-9-]+)?\/.*\.(?:js|cjs|json|d\.ts)$/u.test(file);
const sortedHashes = files => [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([file, bytes]) => ({ file, sha256: hash(bytes) }));

function compileRentalPlatformSource(input) {
  const { platformFiles, release, selection, api } = input;
  if (!(platformFiles instanceof Map) || !path.isAbsolute(input.dependencyDirectory || ''))
    throw Error('须提供完整底座归档文件与明确只读编译依赖目录');
  const archive = api.createCoreArchive(platformFiles);
  if (archive.sha256 !== release.sha256) throw Error('底座源码完整归档摘要与启动锁不一致');
  if (!api.inspectCorePackageArtifact({ kind: 'platform', release, bytes: archive.bytes }, undefined, {}).ok)
    throw Error('底座归档未通过原源码发行检查');
  const source = api.createPlatformSource(platformFiles, release.source);
  if (source.files.size !== platformFiles.size || [...source.files].some(([file, bytes]) =>
    !platformFiles.has(file) || !Buffer.from(platformFiles.get(file)).equals(bytes)))
    throw Error('底座归档与原固定来源文件集不一致');
  const readSource = file => {
    const bytes = platformFiles.get(file);
    if (!bytes?.length) throw Error('底座源码缺少原材料：' + file);
    return Buffer.from(bytes).toString('utf8');
  };
  const lock = JSON.parse(readSource('package-lock.json'));
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw Error('底座构建要求原 npm v3 锁');
  const deps = slash(input.dependencyDirectory), requireDeps = createRequire(deps + '/typescript/package.json');
  const ts = requireDeps('typescript'), compilerPath = slash(requireDeps.resolve('typescript'));
  if (input.ts !== ts || ts.version !== lock.packages['node_modules/typescript']?.version)
    throw Error('底座复算须使用原锁版本的同一实际 TypeScript 编译器');
  const workspace = slash(root), modules = workspace + '/node_modules';
  const clientDirectory = workspace + '/apps/platform-api/generated/client';
  if (!selection || slash(selection.client) !== clientDirectory + '/index.d.ts'
    || selection.schema !== readSource('apps/platform-api/prisma/schema.prisma'))
    throw Error('底座所选 Client 与固定归档原公共 schema 不一致');
  const virtual = new Map([...platformFiles].map(([file, bytes]) => [workspace + '/' + file, Buffer.from(bytes).toString('utf8')]));
  virtual.set(clientDirectory + '/index.d.ts', selection.declarations);
  virtual.set(clientDirectory + '/schema.prisma', selection.schema);
  const outputs = new Map(), dependencies = new Map(), clientFiles = new Map();
  const packages = new Map(publicDirectories.map(directory => {
    const metadata = JSON.parse(readSource(directory + '/package.json'));
    return [metadata.name, { directory, metadata }];
  }));
  const externalVersions = new Set();
  const dependencyLocation = file => {
    const relative = file.slice(deps.length + 1);
    const parts = relative.split('/'), lastModule = parts.lastIndexOf('node_modules');
    const start = lastModule + 1, count = parts[start]?.startsWith('@') ? 2 : 1;
    const owner = parts.slice(0, start + count).join('/'), entry = lock.packages['node_modules/' + owner];
    return { relative, owner, entry };
  };
  function readDependency(file) {
    const { relative, owner, entry } = dependencyLocation(file);
    if (relative.split('/').some(part => part.startsWith('.env') || part === '.git' || part === '.prisma'))
      throw Error('底座编译不得读取默认 Client 或私有环境');
    if (!entry || entry.link || !entry.version) throw Error('实际编译依赖不属于固定底座锁：' + relative);
    if (!externalVersions.has(owner)) {
      const metadataFile = deps + '/' + owner + '/package.json';
      const metadata = fs.readFileSync(metadataFile);
      if (JSON.parse(metadata).version !== entry.version) throw Error('实际编译依赖版本与底座锁不一致：' + owner);
      dependencies.set('node_modules/' + owner + '/package.json', metadata);
      externalVersions.add(owner);
    }
    const bytes = fs.readFileSync(file);
    dependencies.set('node_modules/' + relative, bytes);
    return bytes.toString('utf8');
  }
  readDependency(compilerPath);
  const mapped = file => {
    file = slash(file);
    if (file === modules) return deps;
    if (inside(modules, file)) {
      const relative = file.slice(modules.length + 1), parts = relative.split('/');
      const name = parts.slice(0, 2).join('/'), pkg = packages.get(name);
      if (pkg) return workspace + '/' + pkg.directory + (parts.length > 2 ? '/' + parts.slice(2).join('/') : '');
      if (relative.startsWith('@rental-os/')) return file;
      return deps + '/' + relative;
    }
    return file;
  };
  const hasDirectory = file => [...virtual.keys(), ...outputs.keys()].some(name => name.startsWith(file + '/'));
  const canReadDependency = file => {
    if (!inside(deps, file) || file.split('/').some(part => part === '.prisma' || /^\.env(?:\.|$)/u.test(part))) return false;
    const { entry } = dependencyLocation(file);
    return Boolean(entry && !entry.link && entry.version);
  };
  // 模块解析会试探同目录的其它包（如 node 的 events）；原锁之外须表现为不存在，
  // 不能让作者完整 node_modules 中的多余包改变本次归档的类型解析。
  const dependencyParents = new Set([deps]);
  for (const [file, entry] of Object.entries(lock.packages)) if (file.startsWith('node_modules/') && !entry.link && entry.version) {
    for (let current = deps + '/' + file.slice('node_modules/'.length); inside(deps, current); current = slash(path.dirname(current))) {
      dependencyParents.add(current);
      if (current === deps) break;
    }
  }
  const fileExists = file => {
    file = mapped(file);
    return outputs.has(file) || virtual.has(file) || canReadDependency(file) && ts.sys.fileExists(file)
      || inside(clientDirectory, file) && /\.(?:d\.ts|json)$/u.test(file) && ts.sys.fileExists(file);
  };
  const readFile = file => {
    file = mapped(file);
    if (outputs.has(file)) return outputs.get(file).toString('utf8');
    if (virtual.has(file)) return virtual.get(file);
    if (canReadDependency(file) && ts.sys.fileExists(file)) return readDependency(file);
    if (inside(clientDirectory, file) && /\.(?:d\.ts|json)$/u.test(file) && ts.sys.fileExists(file)) {
      const bytes = fs.readFileSync(file); clientFiles.set(file.slice(workspace.length + 1), bytes); return bytes.toString('utf8');
    }
    return undefined;
  };
  const directoryExists = file => {
    file = mapped(file);
    return file === modules || file === modules + '/@rental-os' || hasDirectory(file)
      || (dependencyParents.has(file) || canReadDependency(file)) && ts.sys.directoryExists(file)
      || inside(clientDirectory, file) && ts.sys.directoryExists(file);
  };
  function entries(directory) {
    const files = new Set(), directories = new Set(), prefix = mapped(directory) + '/';
    for (const file of [...virtual.keys(), ...outputs.keys()]) if (file.startsWith(prefix)) {
      const tail = file.slice(prefix.length), end = tail.indexOf('/');
      if (end < 0) files.add(tail); else directories.add(tail.slice(0, end));
    }
    return { files: [...files].sort(), directories: [...directories].sort() };
  }
  const readDirectory = (directory, extensions, excludes, includes, depth) => {
    const file = mapped(directory);
    if (inside(deps, file)) return ts.sys.readDirectory(file, extensions, excludes, includes, depth).filter(canReadDependency);
    return ts.matchFiles(file, extensions, excludes, includes, true, workspace, depth, entries, mapped);
  };
  const typeNames = Object.keys(lock.packages).filter(file => /^node_modules\/@types\/[^/]+$/u.test(file))
    .map(file => file.slice('node_modules/@types/'.length));
  const getDirectories = directory => mapped(directory) === deps + '/@types' ? typeNames
    : inside(deps, mapped(directory)) ? ts.sys.getDirectories(mapped(directory)).filter(name => {
      const file = slash(path.resolve(mapped(directory), name));
      return dependencyParents.has(file) || canReadDependency(file);
    }) : entries(directory).directories;
  const identity = file => {
    file = mapped(file);
    if (inside(deps, file)) return 'node_modules/' + file.slice(deps.length + 1);
    if (inside(workspace, file)) return file.slice(workspace.length + 1);
    throw Error('编译输入越出固定源码/所选 Client/原依赖：' + file);
  };
  const normalized = value => {
    if (Array.isArray(value)) return value.map(normalized);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalized(item)]));
    return typeof value === 'string' && path.isAbsolute(value) ? identity(value) : value;
  };
  const projects = [];
  for (const directory of publicDirectories) {
    const project = directory + '/tsconfig.json', projectPath = workspace + '/' + project;
    const parseHost = { useCaseSensitiveFileNames: true, readFile, fileExists, directoryExists, readDirectory, getDirectories,
      getCurrentDirectory: () => workspace, onUnRecoverableConfigFileDiagnostic: issue => {
        throw Error(ts.flattenDiagnosticMessageText(issue.messageText, '\n'));
      } };
    const parsed = ts.getParsedCommandLineOfConfigFile(projectPath, {}, parseHost);
    if (!parsed || parsed.projectReferences?.length) throw Error('底座原配置缺失或含未核的 project references：' + project);
    let options = { ...parsed.options, noEmitOnError: true, typeRoots: [modules + '/@types'] };
    if (directory === 'apps/platform-api') options = selectedCompilerOptions(ts, projectPath, options,
      { mode: 'platform', client: clientDirectory + '/index.d.ts' }, readFile).options;
    if (slash(options.rootDir) !== workspace + '/' + directory + '/src' || slash(options.outDir) !== workspace + '/' + directory + '/dist'
      || options.noEmit || options.incremental || options.composite)
      throw Error('底座编译必须保留原 src→dist 的完整普通 emit：' + project);
    const host = ts.createCompilerHost(options);
    Object.assign(host, parseHost, { useCaseSensitiveFileNames: () => true, getCanonicalFileName: file => file,
      realpath: mapped, getSourceFile: (file, version) => {
      const content = readFile(file); return content === undefined ? undefined : ts.createSourceFile(file, content, version, true);
    } });
    host.resolveModuleNames = (names, containing) => names.map(name => {
      if (name === '@prisma/client' && !options.paths?.[name]) throw Error('公共包不能消费默认生成 Client：' + project);
      const resolved = ts.resolveModuleName(name, containing, options, host).resolvedModule;
      return resolved && { ...resolved, resolvedFileName: mapped(resolved.resolvedFileName) };
    });
    const emitted = new Map();
    host.writeFile = (file, content) => {
      file = slash(file);
      if (!inside(workspace + '/' + directory + '/dist', file) || !runtimeFile(file.slice(workspace.length + directory.length + 2)))
        throw Error('原底座 emit 越界或含未核格式：' + file);
      emitted.set(file, Buffer.from(content));
    };
    const result = compileTypeScriptProgram(ts, parsed, options, host);
    if (result.failed || !emitted.size) throw Error('固定底座源码编译失败：' + project + '\n' + ts.formatDiagnostics(result.diagnostics.slice(0, 20), {
      getCanonicalFileName: file => file, getCurrentDirectory: () => workspace, getNewLine: () => '\n'
    }));
    const inputs = result.program.getSourceFiles().map(file => ({ file: identity(file.fileName), sha256: hash(Buffer.from(file.text)) }))
      .sort((a, b) => a.file.localeCompare(b.file));
    // configFile 是编译器的 AST 缓存；原文件字节已绑定归档，不能把循环对象写入收据。
    const { configFile, ...recordedOptions } = options;
    projects.push({ project, options: normalized(recordedOptions), inputsSha256: hash(json(inputs)) });
    for (const [file, bytes] of emitted) outputs.set(file, bytes);
  }
  const generated = new Map([...outputs].map(([file, bytes]) => [file.slice(workspace.length + 1), bytes]));
  for (const directory of publicDirectories) generated.set(directory + '/package.json', Buffer.from(readSource(directory + '/package.json')));
  return { generated, evidence: {
    release: structuredClone(release), sourceArchiveSha256: archive.sha256,
    sourceLockSha256: hash(platformFiles.get('package-lock.json')),
    compiler: { name: 'typescript', version: ts.version, sha256: hash(dependencies.get('node_modules/typescript/lib/typescript.js')) },
    client: { mode: 'platform', schemaSha256: hash(Buffer.from(selection.schema)), declarationsSha256: hash(Buffer.from(selection.declarations)),
      files: sortedHashes(clientFiles) },
    projects, dependencies: sortedHashes(dependencies), generated: sortedHashes(generated)
  } };
}

/** 只接受原源码导出器明确去掉 scripts.test 的差异，发行采用归档的规范化元数据。 */
function requireMatchingPublicRuntime(sourceFiles, platformFiles, build) {
  for (const directory of publicDirectories) {
    const file = directory + '/package.json', expected = platformFiles.get(file), actual = sourceFiles.get(file);
    if (!expected || !actual) throw Error('缺少实际公共包 metadata：' + directory);
    const original = JSON.parse(Buffer.from(expected).toString('utf8')), current = JSON.parse(Buffer.from(actual).toString('utf8'));
    if (current.scripts) current.scripts = Object.fromEntries(Object.entries(current.scripts).filter(([key]) => key !== 'test'));
    if (!isDeepStrictEqual(original, current)) throw Error('实际公共包与固定源码 metadata 不同：' + directory);
    const actualFiles = [...sourceFiles].filter(([file]) => file.startsWith(directory + '/') && runtimeFile(file.slice(directory.length + 1)));
    const expectedFiles = [...build.generated].filter(([file]) => file.startsWith(directory + '/') && file !== directory + '/package.json');
    if (actualFiles.length !== expectedFiles.length) throw Error('实际公共运行产物集合与源码复算不同：' + directory);
    for (const [file, bytes] of expectedFiles) if (!sourceFiles.has(file) || !Buffer.from(sourceFiles.get(file)).equals(bytes))
      throw Error('实际公共运行产物与固定源码编译不同：' + file);
  }
}
module.exports = { compileRentalPlatformSource, requireMatchingPublicRuntime, publicDirectories };
