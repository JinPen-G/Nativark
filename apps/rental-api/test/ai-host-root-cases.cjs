'use strict';
/** Standard-package integration: reuse the caller's actual emit/archive bytes and
 * memory filesystem. Scan and construct the real Nest root without starting an
 * application. Only storage/transport and forbidden lifecycle effects are trapped;
 * package validation, Auth, Core, catalogue and all AI factories remain original. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const hooks = ['onModuleInit', 'onApplicationBootstrap', 'beforeApplicationShutdown',
  'onModuleDestroy', 'onApplicationShutdown'];

module.exports = async function verifyAiHostRoot({ build, memory, rentalFiles, aiFiles, enabled,
  aiResult, disabled, platformClient }) {
  assert.equal(build.runtimeAliases.size, 0, 'root integration cannot alias production modules');
  const archive = memory.load(build.exported('@rental-os/core-contracts/archive', true));
  const releaseFiles = archive.readCoreArchive(aiResult.bytes, aiResult.sha256).files;
  assert.deepEqual(releaseFiles, aiResult.files, 'install the actual host archive bytes');
  const installed = new Map();
  for (const [file, bytes] of releaseFiles) {
    const absolute = slash(path.join(root, file));
    installed.set(absolute, Buffer.from(bytes));
    memory.put(absolute, bytes);
  }
  for (const [directory, files] of [['packages/rental-core', rentalFiles], ['packages/ai-native-data', aiFiles]])
    for (const [file, bytes] of files)
      assert.deepEqual(installed.get(slash(path.join(root, directory, file))), bytes, 'installed archive ' + file);
  assert.deepEqual(JSON.parse(aiResult.files.get('apps/rental-api/prisma-deployment/core.deployment.lock.json')), enabled.lock);
  for (const [, pkg] of build.packages) {
    const bytes = installed.get(slash(path.join(pkg.directory, 'package.json')));
    if (bytes) assert.deepEqual(JSON.parse(bytes).exports, pkg.metadata.exports,
      'memory package resolution must match installed formal exports');
  }

  // Official 5.22 generator, without its filesystem/engine CLI. Both generated
  // clients stay at their own real host paths and only in the existing memfs.
  const generatorFile = build.deps + '/@prisma/client/generator-build/index.js';
  const generatedModule = { exports: {} };
  const buildClient = new Function('require', 'module', 'exports', '__filename', '__dirname',
    fs.readFileSync(generatorFile, 'utf8') + '\nreturn buildClient;')(
    Module.createRequire(generatorFile), generatedModule, generatedModule.exports, generatorFile, path.dirname(generatorFile));
  const clients = [];
  for (const [host, schema, models] of [
    ['rental-api', enabled.files.get('schema.prisma').toString(), 247],
    ['platform-api', platformClient.schema, 40]
  ]) {
    const parsed = JSON.parse(build.prismaWasm.get_config(JSON.stringify({ prismaSchema: schema, ignoreEnvVarErrors: true })));
    assert.deepEqual(parsed.errors, []);
    const dmmf = JSON.parse(build.prismaWasm.get_dmmf(JSON.stringify({ prismaSchema: schema, noColor: true })));
    assert.equal(dmmf.datamodel.models.length, models);
    const directory = slash(path.join(root, 'apps', host, 'generated/client'));
    const result = await buildClient({ schemaPath: path.join(root, 'apps', host, 'prisma/schema.prisma'),
      runtimeBase: '@prisma/client/runtime', datamodel: schema, binaryPaths: {}, outputDir: directory,
      generator: parsed.config.generators[0], datasources: parsed.config.datasources, dmmf,
      clientVersion: '5.22.0', engineVersion: build.requireDeps('@prisma/engines-version').enginesVersion,
      activeProvider: 'mysql', copyEngine: false, postinstall: false,
      envPaths: { rootEnvPath: null, schemaEnvPath: undefined } });
    for (const [file, text] of Object.entries(result.fileMap)) if (file.endsWith('.js')) {
      installed.set(directory + '/' + file, Buffer.from(text));
      memory.put(directory + '/' + file, text);
    }
    installed.set(directory + '/schema.prisma', Buffer.from(schema));
    memory.put(directory + '/schema.prisma', schema);
    clients.push({ host, models, directory, schemaSha256: createHash('sha256').update(schema).digest('hex') });
  }

  const effects = [], reads = new Set(), restores = [], factoryCalls = new Map(), constructedClients = [];
  const replace = (target, name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
    restores.push(() => descriptor ? Object.defineProperty(target, name, descriptor) : delete target[name]);
  };
  const forbid = name => () => { effects.push(name); throw Error('Root DI must not ' + name); };
  const directories = new Set([slash(root)]);
  for (const file of installed.keys()) for (let parent = slash(path.dirname(file)); parent.startsWith(slash(root) + '/');
    parent = slash(path.dirname(parent))) directories.add(parent);
  const inWorkspace = file => slash(file) === slash(root) || slash(file).startsWith(slash(root) + '/');
  const hasInstalled = file => installed.has(slash(file)) || directories.has(slash(file));
  const originalReaddir = memory.fs.readdirSync, originalExists = memory.fs.existsSync;
  replace(memory.fs, 'readdirSync', (file, options) => {
    const entries = originalReaddir(file, options);
    return inWorkspace(file) ? entries.filter(entry => hasInstalled(path.join(file, typeof entry === 'string' ? entry : entry.name))) : entries;
  });
  replace(memory.fs, 'existsSync', file => inWorkspace(file) ? hasInstalled(file) : originalExists(file));
  for (const name of ['statSync', 'lstatSync', 'accessSync', 'realpathSync']) {
    const original = memory.fs[name];
    replace(memory.fs, name, (file, ...args) => {
      if (inWorkspace(file) && !hasInstalled(file)) {
        const error = Error('Absent from installed host: ' + path.relative(root, file)); error.code = 'ENOENT'; throw error;
      }
      return original(file, ...args);
    });
  }
  memory.fs.realpathSync.native = memory.fs.realpathSync;
  const originalRead = memory.fs.readFileSync;
  replace(memory.fs, 'readFileSync', (file, ...args) => {
    const absolute = slash(file);
    if (absolute.startsWith(slash(root) + '/')) {
      // The generic memory adapter allows readonly source fallback. This root
      // check deliberately closes that door, including non-generated manifests.
      assert(installed.has(absolute), 'root load outside installed archive/generated JS: ' + path.relative(root, file));
      const value = originalRead(file, ...args);
      assert.deepEqual(Buffer.from(value), installed.get(absolute), 'root read must match installed bytes');
      reads.add(absolute);
      return value;
    }
    return originalRead(file, ...args);
  });
  const nativeLoad = Module._load;
  replace(Module, '_load', function(name, ...args) {
    if (name === '@prisma/client' || /(?:^|[\\/])\.prisma[\\/]client(?:[\\/]|$)/u.test(name))
      return forbid('load default Prisma Client')();
    return nativeLoad.call(this, name, ...args);
  });
  const vm = require('node:vm'), NativeScript = vm.Script;
  replace(vm, 'Script', class InstalledScript extends NativeScript {
    constructor(code, options) {
      if (options?.filename && inWorkspace(options.filename)) {
        assert(/\.(?:js|cjs)$/u.test(options.filename), 'root must execute emitted JavaScript only');
        assert(installed.has(slash(options.filename)), 'root executed outside installed archive');
      }
      super(code, options);
    }
  });
  for (const owner of [globalThis, require('node:timers'), require('node:timers/promises')])
    for (const name of ['setTimeout', 'setInterval', 'setImmediate'])
      if (typeof owner[name] === 'function') replace(owner, name, forbid('schedule ' + name));
  replace(globalThis, 'fetch', forbid('fetch'));
  for (const name of ['node:http', 'node:https']) for (const method of ['request', 'get'])
    replace(require(name), method, forbid(name + '.' + method));
  replace(require('node:net').Socket.prototype, 'connect', forbid('open socket'));
  for (const owner of [require('node:dns'), require('node:dns').promises])
    for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6'])
      replace(owner, method, forbid('DNS ' + method));

  try {
    const load = name => memory.load(build.exported(name, true));
    const { NestContainer } = build.requireDeps('@nestjs/core/injector/container');
    const { DependenciesScanner } = build.requireDeps('@nestjs/core/scanner');
    const { InstanceLoader } = build.requireDeps('@nestjs/core/injector/instance-loader');
    const { Injector } = build.requireDeps('@nestjs/core/injector/injector');
    const { ApplicationConfig } = build.requireDeps('@nestjs/core/application-config');
    const { MetadataScanner } = build.requireDeps('@nestjs/core/metadata-scanner');
    const { GraphInspector } = build.requireDeps('@nestjs/core/inspector/graph-inspector');
    const { STATIC_CONTEXT } = build.requireDeps('@nestjs/core/injector/constants');
    const { RentalAppModule } = memory.load(path.join(root, 'apps/rental-api/dist/app.module.js'));
    const scanner = async definition => {
      const configuration = new ApplicationConfig(), container = new NestContainer(configuration);
      const graph = new GraphInspector(container);
      const dependencies = new DependenciesScanner(container, new MetadataScanner(), graph, configuration);
      await dependencies.scan(definition);
      return { container, configuration, graph, dependencies, modules: [...container.getModules().values()] };
    };
    // This checks the disabled import graph before any enabled module is loaded.
    // Its 161-model package was already built/verified by the caller; do not
    // instantiate it using the enabled host's 247-model client or a fake client.
    const disabledGraph = await scanner(RentalAppModule.register({ lock: disabled.lock, aiMode: 'disabled' }));
    assert(![...reads].some(file => file.includes('/packages/ai-native-server/')), 'disabled root imported optional AI runtime');
    assert(!disabledGraph.modules.some(item => /AiComposition|AiHttp/u.test(item.metatype.name)));
    const disabledControllers = disabledGraph.modules.flatMap(item => [...item.controllers.keys()]);
    assert.equal(new Set(disabledControllers).size, disabledControllers.length, 'disabled controllers registered once');

    const selectedRuntime = memory.load(clients[0].directory + '/index.js');
    const publicRuntime = memory.load(clients[1].directory + '/index.js');
    const { PrismaClient: SelectedClient } = selectedRuntime;
    const { PrismaClient: PublicClient } = publicRuntime;
    assert.equal(selectedRuntime.Prisma.dmmf.datamodel.models.length, 247);
    assert.equal(publicRuntime.Prisma.dmmf.datamodel.models.length, 40);
    assert.notEqual(SelectedClient, PublicClient, 'two real generated classes retain distinct models');
    for (const Client of [SelectedClient, PublicClient])
      for (const method of ['$connect', '$disconnect', '$transaction', '$queryRaw', '$queryRawUnsafe',
        '$executeRaw', '$executeRawUnsafe', '$runCommandRaw', '_executeRequest'])
        if (typeof Client.prototype[method] === 'function') replace(Client.prototype, method, forbid('Prisma ' + method));

    const hostModule = memory.load(path.join(root, 'apps/rental-api/dist-ai/ai-app.module.js'));
    const hostTokens = memory.load(path.join(root, 'apps/rental-api/dist-ai/app.module.js'));
    const hostDatabase = memory.load(path.join(root, 'apps/rental-api/dist-ai/database.js'));
    const ai = memory.load(path.join(root, 'apps/rental-api/dist-ai/ai-composition.js'));
    const policy = memory.load(path.join(root, 'apps/rental-api/dist-ai/ai-http-policy.js'));
    const publicDatabase = load('@rental-os/platform-api/database');
    class ObservedInjector extends Injector {
      async instantiateClass(instances, wrapper, ...rest) {
        if (wrapper.inject != null) {
          const calls = factoryCalls.get(wrapper.token) ?? [];
          calls.push([...instances]); factoryCalls.set(wrapper.token, calls);
        }
        const value = await super.instantiateClass(instances, wrapper, ...rest);
        if (wrapper.inject == null && (value instanceof SelectedClient || value instanceof PublicClient)) {
          assert.equal(wrapper.metatype, hostDatabase.RentalDatabaseClient, 'only host database is constructed');
          assert(value instanceof SelectedClient);
          constructedClients.push(value);
          // Prisma's delegate methods reach this actual request dispatcher.
          // Keep the official client/model metadata; forbid execution, not reads.
          replace(value, '_request', forbid('Prisma delegate query'));
          for (const method of ['start', 'stop', 'request', 'requestBatch', 'transaction'])
            if (typeof value._engine[method] === 'function') replace(value._engine, method, forbid('engine ' + method));
        }
        for (const hook of hooks) if (value && typeof value[hook] === 'function')
          replace(value, hook, forbid('invoke ' + hook));
        return value;
      }
    }
    const definition = hostModule.RentalAiAppModule.register({ lock: enabled.lock });
    const graph = await scanner(definition);
    const instanceLoader = new InstanceLoader(graph.container, new ObservedInjector(), graph.graph);
    instanceLoader.setLogger({ log() {} });
    await instanceLoader.createInstancesOfDependencies();
    graph.dependencies.applyApplicationProviders();
    const findModule = metatype => {
      const found = graph.modules.filter(item => item.metatype === metatype);
      assert.equal(found.length, 1, 'unique module ' + metatype.name); return found[0];
    };
    const get = (module, token) => {
      const wrapper = module.providers.get(token);
      assert(wrapper, 'registered provider ' + String(token));
      assert.equal(wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, String(token));
      return wrapper.instance;
    };
    const assemblyModule = graph.modules.find(item => item.providers.has(hostTokens.RENTAL_HOST_ASSEMBLY));
    assert(assemblyModule);
    const host = get(assemblyModule, hostTokens.RENTAL_HOST_ASSEMBLY);
    const databaseModule = findModule(hostDatabase.RentalDatabaseModule);
    const database = get(databaseModule, hostDatabase.RentalDatabaseClient);
    assert.deepEqual(constructedClients, [database], 'one constructed selected database');
    assert.equal(get(databaseModule, publicDatabase.PlatformDatabaseClient), database);
    assert.equal(Object.keys(database._runtimeDataModel.models).length, 247);
    assert.equal(host.rental.database, database);
    assert.equal(host.ai.database, database);
    assert.equal(host.ai.rental, host.rental);
    assert.equal(host.ai.guard, host.guard);
    assert.equal(host.rental.aiMode, 'enabled');
    assert(host.aiAccess && host.aiAccess !== host.access);
    assert.deepEqual(host.ai.lock, enabled.lock);
    assert.throws(() => ai.requireRentalAiSelection(disabled.lock), /AI 组合须选择/u);
    const disabledAssembly = memory.load(path.join(root, 'apps/rental-api/dist/assembly.js'));
    assert.throws(() => disabledAssembly.composeRentalApplication({ database, configuration: host.rental.configuration,
      lock: enabled.lock, aiMode: 'disabled' }), /无 AI 组合不能消费/u);
    assert.equal(factoryCalls.get(hostTokens.RENTAL_HOST_ASSEMBLY).length, 1);
    assert.equal(factoryCalls.get(hostTokens.RENTAL_HOST_ASSEMBLY)[0][0], database);
    const requestScope = get(assemblyModule, hostTokens.RENTAL_HTTP_REQUEST_SCOPE);
    assert.equal(typeof requestScope.middleware.use, 'function');
    assert.equal(typeof requestScope.interceptor.intercept, 'function');

    const publicApi = load('@rental-os/platform-server');
    const platformModule = findModule(publicApi.PlatformServerModule);
    assert.equal(get(platformModule, publicApi.PLATFORM_AUTH_DATA_STORE), database);
    assert.equal(get(platformModule, publicApi.PlatformAuthService), host.rental.auth);
    assert.equal(get(platformModule, publicApi.PlatformAuthenticationRepository), host.rental.authSource);
    assert.equal(get(platformModule, publicApi.PlatformAuthGuard), host.platform.guard);
    assert.deepEqual(graph.configuration.getGlobalGuards(), [host.platform.guard], 'one real global guard dispatcher');
    const publicCore = load('@rental-os/platform-core-host');
    assert.equal(get(findModule(publicCore.CoreHostModule), publicCore.CORE_HOST_APPLICATION), host.core);
    assert.deepEqual([...host.catalogue.registrations.keys()], ['rental'], 'real selected Core catalogue');
    const rentalHttp = load('@rental-os/rental-core/http');
    const httpModule = findModule(rentalHttp.RentalHttpModule);
    const http = rentalHttp.composeRentalHttpServiceGroups(token => get(httpModule, token));
    for (const actual of [http.rental.database, http.files.database, http.staff.database]) assert.equal(actual, database);
    assert.equal(http.client.readGuard, host.guard);
    assert.equal(http.client.auth, host.rental.client.auth);
    assert.equal(http.client.api, host.rental.client.api);
    assert.equal(http.rental.failureEvents, host.rental.failureEvents);

    const aiModule = findModule(ai.RentalAiCompositionModule);
    assert.equal(get(aiModule, ai.RENTAL_AI_BINDING), host.ai);
    const evidenceBinding = get(aiModule, ai.RENTAL_AI_INSPECTION_BINDING);
    const staff = load('@rental-os/rental-core/http-staff-uploads');
    assert(factoryCalls.get(staff.RENTAL_STAFF_INSPECTION_EVIDENCE).some(args => args[0] === evidenceBinding),
      'StaffUploads evidence uses the actual request-bound AI factory');
    assert.equal(httpModule.controllers.get(staff.StaffUploadsController).instance.inspectionEvidence, http.staff.inspectionEvidence);
    const adapter = (file, symbol) => load('@rental-os/ai-native-server/runtime/rental-adapters/' + file)[symbol];
    const probe = Symbol('real root service receiver');
    for (const [token, source] of [
      [adapter('prisma.service', 'PrismaService'), database],
      [adapter('auth.service', 'AuthService'), host.rental.auth],
      [adapter('api-auth.guard', 'ApiAuthGuard'), host.guard],
      [adapter('rental-core.service', 'RentalCoreService'), host.rental.primary.core],
      [adapter('rental-business.service', 'RentalBusinessService'), host.rental.primary.business],
    ]) {
      replace(source, probe, function() { return this; });
      assert.equal(get(aiModule, token)[probe](), source, 'same AI adapter source ' + token.name);
    }
    assert.equal(http.rental.core[probe](), host.rental.primary.core, 'HTTP and AI share Core');
    assert.equal(http.rental.business[probe](), host.rental.primary.business, 'HTTP and AI share business');
    const originalProviders = load('@rental-os/ai-native-server/runtime/ai-native-application.providers');
    assert.equal(get(aiModule, originalProviders.AI_NATIVE_BODY_DATABASE), host.ai.bodyDatabase);
    assert.equal(get(aiModule, originalProviders.AI_NATIVE_BUSINESS_FAILURE_RESOURCES), host.ai.resources);
    const { BUSINESS_FAILURE_OUTBOX } = load('@rental-os/ai-native-server/business-events/prisma-business-failure-outbox');
    assert.equal(get(aiModule, BUSINESS_FAILURE_OUTBOX), host.rental.failureEvents);

    const controllers = graph.modules.flatMap(item => [...item.controllers.values()]);
    assert.equal(new Set(controllers.map(item => item.metatype)).size, controllers.length, 'one instance per actual controller');
    for (const wrapper of controllers) {
      assert.equal(wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, wrapper.name);
      assert(wrapper.instance instanceof wrapper.metatype, 'actual controller ' + wrapper.name);
      for (const dependency of wrapper.getCtorMetadata() ?? [])
        if (dependency) {
          assert.equal(dependency.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, String(dependency.token));
          if (policy.RENTAL_AI_CONTROLLERS.includes(wrapper.metatype))
            assert(dependency.instance != null, 'actual AI controller dependency ' + String(dependency.token));
        }
    }
    assert.deepEqual(new Set(controllers.map(item => item.metatype)), new Set([...disabledControllers, ...policy.RENTAL_AI_CONTROLLERS]),
      'enabled root contains every public/Rental controller plus exactly the selected AI controllers');
    for (const module of graph.modules) for (const wrapper of module.providers.values())
      assert.equal(wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, 'unresolved provider ' + String(wrapper.token));
    assert.deepEqual(effects, [], 'zero database, transport, default client, timer or lifecycle effects');
    const result = { modules: graph.modules.length, controllers: controllers.length,
      providers: graph.modules.reduce((count, item) => count + item.providers.size, 0),
      factories: [...factoryCalls.values()].reduce((count, calls) => count + calls.length, 0),
      aiControllers: policy.RENTAL_AI_CONTROLLERS.length, selectedClientsConstructed: constructedClients.length,
      disabled: { modules: disabledGraph.modules.length, controllers: disabledControllers.length, phase: 'scanned-without-instantiation' },
      officialClients: clients.map(({ host, models, schemaSha256 }) => ({ host, models, schemaSha256 })),
      installedReads: reads.size, diskOutputs: 0, effects: 0, lifecycle: 'not-run', deployment: 'pending' };
    console.log('PASS installed Rental AI root: ' + JSON.stringify(result));
    return result;
  } finally {
    for (const restore of restores.reverse()) restore();
  }
};
