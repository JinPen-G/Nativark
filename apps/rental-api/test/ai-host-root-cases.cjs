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
  aiResult, disabled, platformClient, platformArchive, multi, multiResult, ticketsPackage }) {
  const isMulti = Boolean(multi), selected = isMulti ? multi : enabled,
    isAi = selected.lock.dataCapabilities?.some(capability => capability.id === 'ai-native') === true,
    context = isMulti ? multiResult : aiResult, selectedModelCount = isAi ? 247 : 161,
    output = isAi ? 'dist-ai' : 'dist';
  assert.equal(build.runtimeAliases.size, 0, 'root integration cannot alias production modules');
  const archive = memory.load(build.exported('@rental-os/core-contracts/archive', true));
  const releaseFiles = archive.readCoreArchive(context.bytes, context.sha256).files;
  assert.deepEqual(releaseFiles, context.files, 'install the actual host archive bytes');
  const installed = new Map();
  for (const [file, bytes] of releaseFiles) {
    const absolute = slash(path.join(root, file));
    installed.set(absolute, Buffer.from(bytes));
    memory.put(absolute, bytes);
  }
  for (const [directory, files] of [['packages/rental-core', rentalFiles],
    ...(isMulti ? [['packages/example-tickets-core', ticketsPackage.files]] : []),
    ...(isAi ? [['packages/ai-native-data', aiFiles]] : [])])
    for (const [file, bytes] of files)
      assert.deepEqual(installed.get(slash(path.join(root, directory, file))), bytes, 'installed archive ' + file);
  assert.deepEqual(JSON.parse(context.files.get('apps/rental-api/prisma-deployment/core.deployment.lock.json')), selected.lock);
  for (const [, pkg] of build.packages) {
    const bytes = installed.get(slash(path.join(pkg.directory, 'package.json')));
    if (bytes) assert.deepEqual(JSON.parse(bytes).exports, pkg.metadata.exports,
      'memory package resolution must match installed formal exports');
  }
  const storage = path.join(root, 'managed-core-packages'), reference = 'current-platform';
  const sourceMaterials = new Map([
    [path.join(storage, 'archives/index.json'), Buffer.from(JSON.stringify({ format: 'core-package-archives-1',
      artifacts: [{ reference, file: 'platform.tgz', artifact: { kind: 'platform', release: selected.lock.platform } }] }))],
    [path.join(storage, 'archives/platform.tgz'), platformArchive.bytes]
  ]);
  for (const [file, bytes] of sourceMaterials) { installed.set(slash(file), Buffer.from(bytes)); memory.put(file, bytes); }

  // Official 5.22 generator, without its filesystem/engine CLI. Both generated
  // clients stay at their own real host paths and only in the existing memfs.
  const generatorFile = build.deps + '/@prisma/client/generator-build/index.js';
  const generatedModule = { exports: {} };
  const buildClient = new Function('require', 'module', 'exports', '__filename', '__dirname',
    fs.readFileSync(generatorFile, 'utf8') + '\nreturn buildClient;')(
    Module.createRequire(generatorFile), generatedModule, generatedModule.exports, generatorFile, path.dirname(generatorFile));
  const clients = [];
  for (const [host, schema, models] of [
    ['rental-api', selected.files.get('schema.prisma').toString(), selectedModelCount],
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
  // Only the archive reader's original readonly FileHandle transport is in
  // memory. Its path, identity, bounded read and archive checks remain intact.
  const promises = require('node:fs/promises');
  replace(promises, 'lstat', async file => memory.fs.lstatSync(file));
  replace(promises, 'open', async (file, flags) => {
    assert.equal(flags, 'r');
    const opened = memory.fs.lstatSync(file), source = installed.get(slash(file));
    assert(source, 'readonly handle must open an installed archive byte source');
    // memfs advances ctime on reads (its atime setter also changes ctime),
    // unlike native readonly handles. Serve this handle from the exact installed
    // bytes without that transport mutation; original lstat identity checks stay.
    const content = Buffer.from(source);
    let closed = false;
    return { stat: async () => { assert(!closed); return opened; },
      read: async (buffer, offset, length, position) => {
        assert(!closed); const bytesRead = Math.max(0, Math.min(length, content.length - position));
        content.copy(buffer, offset, position, position + bytesRead); return { bytesRead, buffer };
      }, close: async () => { closed = true; } };
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
    assert.equal(selectedRuntime.Prisma.dmmf.datamodel.models.length, selectedModelCount);
    assert.equal(publicRuntime.Prisma.dmmf.datamodel.models.length, 40);
    assert.notEqual(SelectedClient, PublicClient, 'two real generated classes retain distinct models');
    for (const Client of [SelectedClient, PublicClient])
      for (const method of ['$connect', '$disconnect', '$transaction', '$queryRaw', '$queryRawUnsafe',
        '$executeRaw', '$executeRawUnsafe', '$runCommandRaw', '_executeRequest'])
        if (typeof Client.prototype[method] === 'function') replace(Client.prototype, method, forbid('Prisma ' + method));

    const hostModule = memory.load(path.join(root, isMulti
      ? `apps/example-multi-core-api/${output}/${isAi ? 'ai-app.module' : 'app.module'}.js`
      : 'apps/rental-api/dist-ai/ai-app.module.js'));
    const hostTokens = memory.load(path.join(root, 'apps/rental-api', output, 'app.module.js'));
    const hostDatabase = memory.load(path.join(root, 'apps/rental-api', output, 'database.js'));
    const ai = isAi ? memory.load(path.join(root, 'apps/rental-api/dist-ai/ai-composition.js')) : undefined;
    const policy = memory.load(path.join(root, 'apps/rental-api', output, isAi ? 'ai-http-policy.js' : 'http-policy.js'));
    if (isAi) {
      const formalAi = load('@rental-os/rental-api/ai-app-module');
      assert.equal(formalAi.RENTAL_HOST_ASSEMBLY, hostTokens.RENTAL_HOST_ASSEMBLY, 'AI consumer uses same emitted assembly token');
      assert.equal(formalAi.bootstrapRentalComposition,
        memory.load(path.join(root, 'apps/rental-api/dist-ai/bootstrap.js')).bootstrapRentalComposition,
        'AI startup reads request scope from the same emitted root');
    }
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
    const definition = isMulti ? (isAi ? hostModule.multiCoreAiApplicationModule(selected.lock) : hostModule.multiCoreApplicationModule(selected.lock))
      : hostModule.RentalAiAppModule.register({ lock: selected.lock });
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
    assert.equal(Object.keys(database._runtimeDataModel.models).length, selectedModelCount);
    assert.equal(host.rental.database, database);
    if (isAi) {
    assert.equal(host.ai.database, database);
    assert.equal(host.ai.rental, host.rental);
    assert.equal(host.ai.guard, host.guard);
    assert.equal(host.rental.aiMode, 'enabled');
    assert(host.aiAccess && host.aiAccess !== host.access);
    assert.deepEqual(host.ai.lock, selected.lock);
    assert.throws(() => ai.requireRentalAiSelection(disabled.lock), /AI 组合须选择/u);
    const disabledAssembly = memory.load(path.join(root, 'apps/rental-api/dist/assembly.js'));
    assert.throws(() => disabledAssembly.composeRentalApplication({ database, configuration: host.rental.configuration,
      lock: selected.lock, aiMode: 'disabled' }), /无 AI 组合不能消费/u);
    } else {
      assert.equal(host.ai, undefined);
      assert.equal(host.aiAccess, undefined);
      assert.equal(host.rental.aiMode, 'disabled');
    }
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
    assert.deepEqual([...host.catalogue.registrations.keys()], isMulti ? ['rental', 'example-tickets'] : ['rental'], 'real selected Core catalogue');
    const packageModule = findModule(publicCore.CorePackageAssemblyModule);
    assert.equal(get(packageModule, publicCore.CORE_PACKAGE_ASSEMBLY), host.packages);
    assert.deepEqual(factoryCalls.get(publicCore.CORE_PACKAGE_ASSEMBLY), [[host]], 'one package assembly from actual host');
    const { PATH_METADATA, METHOD_METADATA } = build.requireDeps('@nestjs/common/constants');
    const { RequestMethod } = build.requireDeps('@nestjs/common');
    const additionalOpenApi = isMulti ? [{ manifest: ticketsPackage.pin.manifest,
      contribution: load('@rental-os/example-tickets-core').createTicketsOpenApi() }] : [];
    const document = isAi ? memory.load(path.join(root, 'apps/rental-api/dist-ai/ai-openapi.js'))
        .createRentalAiOpenApi(selected.lock, policy.createRentalAiHttpPolicy(host.authorization), additionalOpenApi)
      : memory.load(path.join(root, 'apps/rental-api/dist/openapi.js')).createRentalHostOpenApi(
        selected.lock, policy.createRentalHostHttpPolicy(host.authorization), additionalOpenApi);
    for (const [Controller, token, application] of [
      [publicCore.CorePackageController, publicCore.CORE_PACKAGE_APPLICATION, host.packages.packages],
      [publicCore.CorePackagePreflightController, publicCore.CORE_PACKAGE_PREFLIGHT_APPLICATION, host.packages.preflight],
      [publicCore.CorePackageSelectionController, publicCore.CORE_PACKAGE_SELECTION_APPLICATION, host.packages.releases],
      [publicCore.CorePackagePreparationController, publicCore.CORE_PACKAGE_PREPARATION_APPLICATION, host.packages.preparation],
    ]) {
      assert.equal(get(packageModule, token), application);
      assert.equal(packageModule.controllers.get(Controller).instance.application, application);
      const base = Reflect.getMetadata(PATH_METADATA, Controller);
      for (const name of Object.getOwnPropertyNames(Controller.prototype)) {
        const handler = Controller.prototype[name], method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const url = '/' + [base, Reflect.getMetadata(PATH_METADATA, handler)].filter(Boolean).join('/');
        const verb = RequestMethod[method];
        assert(host.platform.routesToPlatform({ method: verb, url }), Controller.name + '.' + name);
        assert(!host.platform.routesToPlatform({ method: verb, url, staffApiRequest: true }), 'staff cannot borrow public management');
        assert(!host.platform.routesToPlatform({ method: verb, url: url + '/unexpected' }), 'no broad prefix registration');
        assert(document.paths['/api' + url]?.[verb.toLowerCase()], 'same-host package OpenAPI ' + url);
      }
    }
    await assert.rejects(host.packages.http.authorize('GET', '/platform/core-packages/catalogue'), /主体/);
    const rentalHttp = load('@rental-os/rental-core/http');
    const httpModule = findModule(rentalHttp.RentalHttpModule);
    const http = rentalHttp.composeRentalHttpServiceGroups(token => get(httpModule, token));
    for (const actual of [http.rental.database, http.files.database, http.staff.database]) assert.equal(actual, database);
    assert.equal(http.client.readGuard, host.guard);
    assert.equal(http.client.auth, host.rental.client.auth);
    assert.equal(http.client.api, host.rental.client.api);
    assert.equal(http.rental.failureEvents, host.rental.failureEvents);

    const extraControllers = [];
    if (isAi) {
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
      [load('@rental-os/rental-core/mysql-client-auth').ClientAuthService, host.rental.client.auth],
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
    extraControllers.push(...policy.RENTAL_AI_CONTROLLERS);
    }
    if (isMulti) {
      const tickets = load('@rental-os/example-tickets-core/nest'), binding = host.additionalCores.get('example-tickets');
      const module = findModule(tickets.TicketsHttpModule), controller = module.controllers.get(tickets.TicketsController).instance;
      assert(binding, 'actual bound tickets Core');
      assert.equal(controller.service, binding.service);
      assert.equal(controller.principal, binding.principals);
      assert.equal(factoryCalls.get(hostTokens.RENTAL_HOST_ASSEMBLY).length, 1);
      assert.equal(host.lifecycle.application, host.rental, 'one lifecycle owns the same Rental graph');
      const copy = host.additionalCores; copy.clear();
      assert.equal(host.additionalCores.get('example-tickets'), binding, 'caller cannot replace the registry');
      for (const name of Object.getOwnPropertyNames(tickets.TicketsController.prototype)) {
        const handler = tickets.TicketsController.prototype[name], method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const url = '/' + [Reflect.getMetadata(PATH_METADATA, tickets.TicketsController), Reflect.getMetadata(PATH_METADATA, handler)].filter(Boolean).join('/');
        assert(host.platform.routesToPlatform({ method: RequestMethod[method], url }), 'tickets uses same global guard ' + url);
        assert(document.paths['/api' + url.replace(/:([a-zA-Z][a-zA-Z0-9]*)/gu, '{$1}')]?.[RequestMethod[method].toLowerCase()],
          'tickets in same OpenAPI ' + url);
      }
      extraControllers.push(tickets.TicketsController);
      if (!isAi) assert(![...reads].some(file => file.includes('/packages/ai-native-server/')), 'multi disabled root never imports AI');
    }

    const controllers = graph.modules.flatMap(item => [...item.controllers.values()]);
    assert.equal(new Set(controllers.map(item => item.metatype)).size, controllers.length, 'one instance per actual controller');
    for (const wrapper of controllers) {
      assert.equal(wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, wrapper.name);
      assert(wrapper.instance instanceof wrapper.metatype, 'actual controller ' + wrapper.name);
      for (const dependency of wrapper.getCtorMetadata() ?? [])
        if (dependency) {
          assert.equal(dependency.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, String(dependency.token));
          if (extraControllers.includes(wrapper.metatype))
            assert(dependency.instance != null, 'actual AI controller dependency ' + String(dependency.token));
        }
    }
    assert.deepEqual(new Set(controllers.map(item => item.metatype)), new Set([...disabledControllers, ...extraControllers]),
      'enabled root contains every public/Rental controller plus exactly the selected AI controllers');
    for (const module of graph.modules) for (const wrapper of module.providers.values())
      assert.equal(wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved, true, 'unresolved provider ' + String(wrapper.token));
    const sourceFactory = memory.load(path.join(root, 'apps/rental-api', output, 'core-package-sources.js'));
    const rentalPackage = memory.load(path.join(root, 'apps/rental-api', output, 'deployment-package.js'));
    const aiPackage = isAi ? load('@rental-os/ai-native-data/data-package') : undefined;
    let observations = 0;
    const sources = sourceFactory.createRentalCorePackageSources({ lock: selected.lock,
      configuration: { get: name => ({ CORE_PACKAGE_STORAGE_ROOT: storage, CORE_PLATFORM_PACKAGE_REFERENCE: reference }[name]) },
      rentalPackage: () => rentalPackage.requireRentalDeploymentPackage(selected.lock.cores[0], selected.lock.platform.versions),
      ...(isMulti ? { additionalCorePackages: [{ root: path.join(root, 'packages/example-tickets-core'),
        entry: path.resolve(build.exported('@rental-os/example-tickets-core', true)), ...ticketsPackage.pin }] } : {}),
      ...(isAi ? { dataCapabilities: () => [aiPackage.requireAiNativeDataPackage(path.join(root, 'packages/ai-native-data'), selected.lock.dataCapabilities[0])] } : {}),
      observe: async () => { observations++; throw Error('materials preparation must not query a database'); } });
    const materials = await sources.materials.read();
    assert.deepEqual(materials.base, selected.lock);
    assert.deepEqual(materials.cores.get('rental'), rentalFiles);
    if (isMulti) assert.deepEqual(materials.cores.get('example-tickets'), ticketsPackage.files);
    if (isAi) assert.deepEqual(materials.dataCapabilities.get('ai-native'), aiFiles);
    assert.equal(materials.platform.length, selected.lock.platform.data.migrations.length);
    assert.equal(observations, 0);
    const contextFile = slash(path.join(root, 'rental-host.context.json'));
    const contextBytes = installed.get(contextFile);
    installed.delete(contextFile);
    assert.equal(await sources.materials.read(), undefined, 'source archive alone is not an installed runtime');
    installed.set(contextFile, contextBytes);
    const runtimeFile = slash(path.join(root, 'packages/platform-server/dist/index.js'));
    const runtimeBytes = installed.get(runtimeFile), altered = Buffer.concat([runtimeBytes, Buffer.from('\nexports.changed = true;\n')]);
    installed.set(runtimeFile, altered); memory.put(runtimeFile, altered);
    await assert.rejects(sources.materials.read(), /摘要不一致/);
    installed.set(runtimeFile, runtimeBytes); memory.put(runtimeFile, runtimeBytes);
    const forged = JSON.parse(contextBytes.toString('utf8')); forged.platformBuild.release.source.commit = 'f'.repeat(40);
    const forgedBytes = Buffer.from(JSON.stringify(forged)); installed.set(contextFile, forgedBytes); memory.put(contextFile, forgedBytes);
    await assert.rejects(sources.materials.read(), /来源.*不一致/);
    installed.set(contextFile, contextBytes); memory.put(contextFile, contextBytes);
    assert.equal(observations, 0, 'unverified runtime never reaches data observation');
    const recovery = isMulti && !isAi ? await require('./multi-core-recovery-cases.cjs')({
      build, memory, load, root, lock: selected.lock, catalogue: host.catalogue, materials: sources.materials,
      platformArchive, ticketsPackage,
      rentalPackage: () => rentalPackage.requireRentalDeploymentPackage(
        selected.lock.cores.find(pin => pin.manifest.id === 'rental'), selected.lock.platform.versions)
    }) : undefined;
    assert.deepEqual(effects, [], 'zero database, transport, default client, timer or lifecycle effects');
    const result = { modules: graph.modules.length, controllers: controllers.length,
      providers: graph.modules.reduce((count, item) => count + item.providers.size, 0),
      factories: [...factoryCalls.values()].reduce((count, calls) => count + calls.length, 0),
      aiControllers: isAi ? policy.RENTAL_AI_CONTROLLERS.length : 0, selectedClientsConstructed: constructedClients.length,
      disabled: { modules: disabledGraph.modules.length, controllers: disabledControllers.length, phase: 'scanned-without-instantiation' },
      officialClients: clients.map(({ host, models, schemaSha256 }) => ({ host, models, schemaSha256 })),
      ...(recovery ? { recovery } : {}),
      installedReads: reads.size, diskOutputs: 0, effects: 0, lifecycle: 'not-run', deployment: 'pending' };
    console.log('PASS installed Rental' + (isMulti ? ' + tickets' : '') + (isAi ? ' AI' : '') + ' root: ' + JSON.stringify(result));
    return result;
  } finally {
    for (const restore of restores.reverse()) restore();
  }
};
