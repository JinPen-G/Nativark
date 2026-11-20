'use strict';
/** 复用宿主发行测试的真实包和 emit，仅执行两份 Vite 配置工厂。
 * 原校验器/HTTP 许可不替换；安装和锁文件只在独占 memfs，finally 清理，不运行构建或服务。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

module.exports = async function runCases({ build, memory, rentalFiles, ticketsPackage, disabled, multi }) {
  assert(build && memory && rentalFiles && ticketsPackage && disabled?.lock && multi?.lock,
    '须复用父测试的真实 build/memory/完整包和两种部署锁');
  const folder = path.resolve(memory.task, 'rental-admin-config-cases');
  assert.equal(path.dirname(folder), path.resolve(memory.task));
  assert.equal(fs.existsSync(folder), false, '不使用磁盘安装目录');
  assert.equal(memory.fs.existsSync(folder), false, '不覆盖已有内存材料');
  const configPaths = ['apps/rental-admin/vite.config.ts', 'apps/example-multi-core-admin/vite.config.ts'];
  const adapterPaths = ['vite', 'motionPreferenceAdapter', 'actionButtonIconAdapter', 'nativeSidebarStyles', 'kanbanBoardAdapter']
    .map(name => `packages/platform-admin/config/${name}.ts`);
  const allowedSources = new Set([...configPaths, ...adapterPaths, 'config/environment.cjs']
    .map(file => slash(path.join(root, file))));
  const sources = new Map(), modules = new Map(), locks = new Set(), selectedRoots = new Map();
  const processView = { env: {} };
  let created = false, checks = 0, forbiddenCalls = 0;
  const forbid = name => { forbiddenCalls++; throw Error(`配置检查禁止 ${name}`); };
  const formal = name => {
    assert(!build.runtimeAliases.has(name), '不能替换正式包校验/宿主许可：' + name);
    const file = build.exported(name, true);
    assert(build.outputs.has(slash(file)), '须消费本次实际 emit：' + name);
    return memory.load(file);
  };

  try {
    memory.fs.mkdirSync(folder);
    created = true;
    // 依赖模块及插件工厂使用原版本；只调用 config，绝不调用 Vite build/createServer。
    const external = new Map(await Promise.all(['vite', '@vitejs/plugin-react', '@tailwindcss/vite'].map(async name => {
      const loaded = await import(pathToFileURL(build.requireDeps.resolve(name)).href);
      return [name, { ...loaded, __esModule: true }];
    })));
    external.set('postcss', build.requireDeps('postcss'));
    const { createCoreArchive } = formal('@rental-os/core-contracts/archive');
    const { prepareCoreInstall } = formal('@rental-os/core-contracts/install');
    const { inspectCorePackageFiles } = formal('@rental-os/core-contracts/package');
    const { coreDeploymentHostVersions } = formal('@rental-os/core-contracts');
    const legacyRoutes = formal('@rental-os/rental-api/openapi').rentalHostLegacyApiRoutes();
    const rentalPin = disabled.lock.cores.find(pin => pin.manifest.id === 'rental');
    assert(rentalPin);
    assert.deepEqual(multi.lock.cores.find(pin => pin.manifest.id === 'rental'), rentalPin);
    assert.deepEqual(multi.lock.cores.find(pin => pin.manifest.id === 'example-tickets'), ticketsPackage.pin);
    const installation = path.join(folder, 'installed');
    memory.fs.mkdirSync(installation);
    function install(files, pin, legacy) {
      const archive = createCoreArchive(files);
      assert.equal(archive.sha256, pin.sha256, '必须使用锁中的完整标准包');
      const prepared = prepareCoreInstall(archive.bytes, pin.sha256, installation,
        coreDeploymentHostVersions(multi.lock), pin.manifest, legacy);
      assert.equal(prepared.status, 'prepared');
      assert.equal(prepared.deployment, 'pending');
      return prepared.directory;
    }
    selectedRoots.set('@rental-os/rental-core', install(rentalFiles, rentalPin, legacyRoutes));
    selectedRoots.set('@rental-os/example-tickets-core', install(ticketsPackage.files, ticketsPackage.pin, []));

    const ts = build.ts;
    function loadSource(filename) {
      filename = slash(filename);
      assert(allowedSources.has(filename), '未核定配置源：' + filename);
      if (modules.has(filename)) return modules.get(filename).exports;
      const source = build.sourceRead(filename);
      assert.equal(typeof source, 'string');
      sources.set(filename, source);
      const module = { exports: {} };
      modules.set(filename, module);
      const meta = Object.freeze({ url: pathToFileURL(filename).href, resolve(name) {
        assert.equal(name, 'motion/react', '只解析原动效适配的明确依赖');
        return pathToFileURL(build.requireDeps.resolve(name)).href;
      } });
      // 仅代换 Node ESM 元信息，让原配置/适配器在同一个短期 CJS VM 中运行。
      const transformMeta = context => file => ts.visitNode(file, function visit(node) {
        if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'meta')
          return ts.factory.createIdentifier('__configImportMeta');
        return ts.visitEachChild(node, visit, context);
      });
      const emitted = filename.endsWith('.ts') ? ts.transpileModule(source, { fileName: filename,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
        reportDiagnostics: true, transformers: { before: [transformMeta] } }) : { outputText: source, diagnostics: [] };
      assert.equal(emitted.diagnostics.length, 0, '配置转译不能忽略诊断');
      const requireConfig = name => {
        if (external.has(name)) return external.get(name);
        if (name === '@rental-os/platform-admin/vite') return loadSource(build.exported(name, true));
        if (['@rental-os/core-contracts', '@rental-os/core-contracts/install', '@rental-os/rental-api/openapi'].includes(name))
          return formal(name);
        if (name === 'node:fs') return {
          readFileSync(file, ...args) {
            if (/^\.env(?:\.|$)/iu.test(path.basename(file))) return forbid('.env 读取');
            assert(locks.has(slash(file)), '配置只能读取本次明确提供的内存部署锁');
            return memory.fs.readFileSync(file, ...args);
          },
          existsSync: () => forbid('环境文件探测')
        };
        if (name === 'node:module') return { createRequire(url) {
          assert.equal(url, meta.url);
          const selectedRequire = () => forbid('配置执行 Core 入口');
          selectedRequire.resolve = requested => {
            const directory = selectedRoots.get(requested);
            assert(directory, '配置只解析两个明确安装的 Core');
            const metadata = JSON.parse(memory.fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
            assert.equal(metadata.name, requested);
            const published = metadata.exports?.['.'];
            const entry = typeof published === 'string' ? published : published?.require ?? published?.default;
            assert.equal(typeof entry, 'string');
            const target = path.resolve(directory, entry);
            assert(slash(target).startsWith(slash(directory) + '/'));
            assert(memory.fs.statSync(target).isFile());
            return target;
          };
          return selectedRequire;
        } };
        if (['node:path', 'node:url', 'node:util'].includes(name)) return require(name);
        if (name.startsWith('.')) {
          const target = path.resolve(path.dirname(filename), name);
          return loadSource([target, target + '.ts'].find(file => allowedSources.has(slash(file))) ?? target);
        }
        return forbid('未声明模块 ' + name);
      };
      new vm.Script(`(function(require,module,exports,__dirname,__filename,process,__configImportMeta,fetch,setTimeout,setInterval,setImmediate){${emitted.outputText}\n})`,
        { filename }).runInThisContext()(requireConfig, module, module.exports, path.dirname(filename), filename,
        processView, meta, () => forbid('网络'), () => forbid('timer'), () => forbid('timer'), () => forbid('timer'));
      return module.exports;
    }

    function evaluate(relative, lock, key) {
      const file = path.join(folder, key + '.lock.json');
      memory.put(file, json(lock)); locks.add(slash(file));
      processView.env.CORE_DEPLOYMENT_LOCK = file;
      const factory = loadSource(path.join(root, relative)).default;
      assert.equal(typeof factory, 'function');
      return factory({ command: 'build', mode: 'ai-offline', isSsrBuild: false, isPreview: false });
    }
    function virtualManifest(config, source) {
      assert.equal(config.envDir, false);
      assert.deepEqual(config.envPrefix, []);
      const plugin = config.plugins.flat(Infinity).find(item => item?.resolveId?.(source));
      assert(plugin, '须执行原配置中的 virtual manifest 插件');
      const value = plugin.load(plugin.resolveId(source));
      assert.match(value, /^export default [\s\S]*;$/u);
      return JSON.parse(value.slice('export default '.length, -1));
    }
    assert.deepEqual(virtualManifest(evaluate(configPaths[0], disabled.lock, 'rental'), 'virtual:core-manifest'), rentalPin.manifest);
    checks++; console.log('PASS Rental 真实 Vite 配置接受完整标准包与宿主旧路径许可');
    assert.deepEqual(virtualManifest(evaluate(configPaths[1], multi.lock, 'multi'), 'virtual:core-manifests'),
      { rental: rentalPin.manifest, tickets: ticketsPackage.pin.manifest });
    checks++; console.log('PASS 双 Core 真实 Vite 配置核定两完整标准包并生成原 virtual manifests');

    // 用真实工单内容制造一份摘要正确的反例；不能因摘要先失败掩盖旧路径许可泄漏。
    const altered = new Map([...ticketsPackage.files].map(([file, bytes]) => [file, Buffer.from(bytes)]));
    const apiFile = ticketsPackage.pin.manifest.entries.openapi;
    const api = JSON.parse(altered.get(apiFile).toString('utf8'));
    const ownPath = Object.keys(api.paths).find(route => api.paths[route].get);
    const legacyPath = legacyRoutes.filter(route => route.startsWith('GET /api/'))
      .map(route => route.slice('GET '.length)).find(route => !route.startsWith('/api/cores/'));
    assert(ownPath && legacyPath && !Object.hasOwn(api.paths, legacyPath));
    api.paths[legacyPath] = { get: api.paths[ownPath].get };
    delete api.paths[ownPath].get;
    if (!Object.keys(api.paths[ownPath]).length) delete api.paths[ownPath];
    altered.set(apiFile, json(api));
    assert.equal(inspectCorePackageFiles(altered, coreDeploymentHostVersions(multi.lock), legacyRoutes).ok, true,
      '该反例须精确命中 Rental 许可；误将许可传给工单时必须能暴露泄漏');
    const alteredPin = { ...structuredClone(ticketsPackage.pin), sha256: createCoreArchive(altered).sha256 };
    const badDirectory = path.join(folder, 'bad-tickets');
    for (const [file, bytes] of altered) memory.put(path.join(badDirectory, file), bytes);
    selectedRoots.set('@rental-os/example-tickets-core', badDirectory);
    const badLock = structuredClone(multi.lock);
    badLock.cores = badLock.cores.map(pin => pin.manifest.id === 'example-tickets' ? alteredPin : pin);
    assert.throws(() => evaluate(configPaths[1], badLock, 'bad-multi'), error =>
      /\[route_namespace\]/u.test(error.message) && error.message.includes(legacyPath));
    checks++; console.log('PASS 工单完整包即使摘要匹配也不能借用 Rental 旧路径');
    assert.equal(forbiddenCalls, 0);
    assert.equal(sources.size, allowedSources.size);
    return { checks, sourceModules: sources.size, corePackages: 2, diskOutputs: 0, viteBuild: 'not-run', server: 'not-started' };
  } finally {
    modules.clear(); sources.clear(); selectedRoots.clear(); locks.clear();
    if (created) {
      assert.equal(path.dirname(folder), path.resolve(memory.task));
      memory.fs.rmSync(folder, { recursive: true, force: true });
      assert.equal(memory.fs.existsSync(folder), false);
    }
    assert.equal(fs.existsSync(folder), false, '没有磁盘临时产物');
  }
};
