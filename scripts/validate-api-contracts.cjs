/** 从原 Controller 的 Nest 元数据核对 OpenAPI；不实例化应用、执行路由或连接外部服务。
 * 原型继承、常量、数组与动态装饰器均以真实元数据为准，贡献文档不能补造控制器。
 */
const path = require("node:path");
const { createControllerSourceLoader, checkedPath } = require("./controller-sources.cjs");

const repoRoot = path.resolve(__dirname, "..");
const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options", "trace", "search"];

function normalizeRoute(prefix, route) {
  const raw = ["api", prefix, route]
    .filter((part) => part !== undefined && part !== "")
    .join("/")
    .replace(/\/+/g, "/");

  return `/${raw}`.replace(/\/+$/, "").replace(/:([A-Za-z0-9_]+)/g, "{$1}") || "/";
}

async function controllerOperations(loader, { appModule, moduleExport = "AppModule" } = {}) {
  if (!appModule) throw new Error("API 合同检查必须显式选择 appModule");
  loader.requireDependency("reflect-metadata");
  const { PATH_METADATA, METHOD_METADATA, CONTROLLER_WATERMARK, MODULE_METADATA } = loader.requireDependency("@nestjs/common/constants");
  const { RequestMethod } = loader.requireDependency("@nestjs/common");
  const routes = [];
  const controllers = new Set(), modules = new Set();
  async function visitModule(value) {
    value = await value;
    if (value && typeof value.forwardRef === "function") value = value.forwardRef();
    if (!value || modules.has(value)) return;
    modules.add(value);
    const target = typeof value === "function" ? value : value.module;
    if (typeof target !== "function") throw new Error("原宿主模块登记无法核对");
    for (const controller of [...(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, target) ?? []), ...(value.controllers ?? [])]) {
      if (typeof controller !== "function" || !Reflect.getMetadata(CONTROLLER_WATERMARK, controller))
        throw new Error("原宿主登记了缺少 Controller 元数据的类型");
      controllers.add(controller);
    }
    for (const child of [...(Reflect.getMetadata(MODULE_METADATA.IMPORTS, target) ?? []), ...(value.imports ?? [])]) await visitModule(child);
  }
  // AppModule 只登记模块、类及 provider 工厂；不调用 NestFactory 或任何 provider。
  // 从实际 imports/controllers 出发，覆盖非 .controller.ts 文件并排除未挂载父类。
  const entry = loader.load(checkedPath(loader.repoRoot, appModule))[moduleExport];
  if (!entry) throw new Error(`所选宿主未导出模块：${moduleExport}`);
  await visitModule(entry);
  const paths = (value, label) => {
    const items = Array.isArray(value) ? value : [value];
    if (!items.length || items.some(item => typeof item !== "string"))
      throw new Error(`控制器路径元数据无法核对：${label}`);
    return items;
  };
  for (const controller of controllers) {
    const file = loader.declarations.get(controller);
    if (!file) throw new Error(`控制器缺少同树源码来源：${controller.name}`);
    const prefixes = paths(Reflect.getMetadata(PATH_METADATA, controller), controller.name);
    const visited = new Set(["constructor"]);
    // 与 Nest 原型扫描一致：最近的同名方法覆盖父类，包括不带路由的覆盖。
    for (let prototype = controller.prototype; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (visited.has(name)) continue;
        visited.add(name);
        const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
        if (typeof handler !== "function") continue;
        const route = Reflect.getMetadata(PATH_METADATA, handler);
        if (route === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]?.toLowerCase();
        if (method !== "all" && !httpMethods.includes(method))
          throw new Error(`控制器 HTTP 方法元数据无法核对：${controller.name}.${name}`);
        for (const prefix of prefixes) for (const value of paths(route, `${controller.name}.${name}`))
          for (const verb of method === "all" ? httpMethods : [method]) routes.push({
            method: verb, path: normalizeRoute(prefix, value),
            source: `${path.relative(loader.repoRoot, file)}#${controller.name}.${name}`
          });
      }
    }
  }
  if (!routes.length) throw new Error("未发现任何控制器路由，不能以空集合通过合同核验");
  return routes.sort(compareRoute);
}

function compareRoute(a, b) {
  const pathCompare = a.path.localeCompare(b.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }
  return a.method.localeCompare(b.method);
}

function routeKey(route) {
  return `${route.method.toUpperCase()} ${route.path}`;
}

function matchesControllerRoute(controller, contract) {
  if (controller.method !== contract.method) return false;
  const actual = controller.path.split("/"), documented = contract.path.split("/");
  // Nest 的单段参数也可由具体枚举路径记入 OpenAPI；该匹配只证明 HTTP 路由存在，
  // 不把文档枚举当作 handler 内部支持该操作、业务授权或验收的证据。
  return actual.length === documented.length && actual.every((part, index) =>
    part === documented[index] || /^\{[A-Za-z0-9_]+\}$/u.test(part)
      && !!documented[index] && !/[{}]/u.test(documented[index]));
}

function documentOperations(document) {
  const routes = [];
  for (const [pathKey, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of httpMethods) {
      if (pathItem[method]) {
        routes.push({ method, path: pathKey });
      }
    }
  }
  return routes.sort(compareRoute);
}

function findRefs(value, refs = []) {
  if (!value || typeof value !== "object") {
    return refs;
  }
  if (typeof value.$ref === "string") {
    refs.push(value.$ref);
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      child.forEach((item) => findRefs(item, refs));
      continue;
    }
    findRefs(child, refs);
  }
  return refs;
}

function pathVariableNames(pathValue) {
  return Array.from(pathValue.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
}

async function validateApiContracts(loader, selection = {}) {
  if (!selection.contracts) throw new Error("API 合同检查必须显式选择 contracts");
  const loadEntry = entry => loader.load(entry.startsWith("@")
    ? loader.resolveSource(__filename, entry, true) : checkedPath(loader.repoRoot, entry));
  const controllerRoutes = await controllerOperations(loader, selection);
  const contracts = loadEntry(selection.contracts);
  let { API_CONTRACT_OPERATIONS, OPENAPI_DOCUMENT } = contracts;
  if (selection.documentFactory) {
    if (typeof contracts[selection.documentFactory] !== "function") throw new Error("所选 OpenAPI 工厂不存在");
    OPENAPI_DOCUMENT = contracts[selection.documentFactory]();
    for (const transform of selection.documentTransforms ?? []) {
      const [entry, name, extra] = transform.split("#");
      if (!entry || !name || extra) throw new Error("文档组合必须为 <正式包或源码>#<工厂>");
      const factory = loadEntry(entry)[name];
      if (typeof factory !== "function") throw new Error(`所选 OpenAPI 组合工厂不存在：${transform}`);
      OPENAPI_DOCUMENT = factory(OPENAPI_DOCUMENT);
    }
    // 公共文档由正式路由政策工厂生成；独立比对实际 Nest 模块，不补造处理器。
    // 旧常量模式仍保留 operations / document / controller 三方核对。
    API_CONTRACT_OPERATIONS = documentOperations(OPENAPI_DOCUMENT).map(route => ({ ...route,
      operationId: OPENAPI_DOCUMENT.paths[route.path][route.method].operationId,
      permissions: OPENAPI_DOCUMENT.paths[route.path][route.method]["x-requiredPermissions"] }));
  } else if (selection.documentTransforms?.length) throw new Error("文档组合必须先选择 documentFactory");
  if (!Array.isArray(API_CONTRACT_OPERATIONS) || !API_CONTRACT_OPERATIONS.length || !OPENAPI_DOCUMENT?.paths)
    throw new Error("所选合同缺少非空操作或 OpenAPI，不能以空集合通过");
  const errors = [];
  const contractRoutes = API_CONTRACT_OPERATIONS.map(({ method, path }) => ({
    method,
    path
  })).sort(compareRoute);
  const docRoutes = documentOperations(OPENAPI_DOCUMENT);

  const contractSet = new Set(contractRoutes.map(routeKey));
  const docSet = new Set(docRoutes.map(routeKey));

  for (const route of controllerRoutes) {
    if (!contractRoutes.some(contract => matchesControllerRoute(route, contract))) {
      errors.push(`Missing contract operation for controller route ${routeKey(route)} (${route.source})`);
    }
  }

  for (const route of contractRoutes) {
    if (!controllerRoutes.some(controller => matchesControllerRoute(controller, route))) {
      errors.push(`Contract operation has no controller route: ${routeKey(route)}`);
    }
    if (!docSet.has(routeKey(route))) {
      errors.push(`Contract operation is missing from OpenAPI paths: ${routeKey(route)}`);
    }
  }

  for (const route of docRoutes) {
    if (!contractSet.has(routeKey(route))) {
      errors.push(`OpenAPI path has no contract operation source: ${routeKey(route)}`);
    }
  }

  const operationIds = new Set();
  for (const item of API_CONTRACT_OPERATIONS) {
    if (!item.operationId) {
      errors.push(`Missing operationId for ${item.method.toUpperCase()} ${item.path}`);
    }
    if (operationIds.has(item.operationId)) {
      errors.push(`Duplicate operationId: ${item.operationId}`);
    }
    operationIds.add(item.operationId);

    if (!Array.isArray(item.permissions)) {
      errors.push(`Missing permissions array for ${item.method.toUpperCase()} ${item.path}`);
    }
  }

  const componentSchemas = OPENAPI_DOCUMENT.components?.schemas ?? {};
  for (const ref of findRefs(OPENAPI_DOCUMENT)) {
    const prefix = "#/components/schemas/";
    if (ref.startsWith(prefix)) {
      const schemaName = ref.slice(prefix.length);
      if (!componentSchemas[schemaName]) {
        errors.push(`Unknown schema reference: ${ref}`);
      }
    }
  }

  for (const [pathKey, pathItem] of Object.entries(OPENAPI_DOCUMENT.paths ?? {})) {
    for (const method of httpMethods) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      if (!Array.isArray(operation["x-requiredPermissions"])) {
        errors.push(`Missing x-requiredPermissions on ${method.toUpperCase()} ${pathKey}`);
      }

      const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      const declaredPathParams = new Set(
        parameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name)
      );
      for (const variableName of pathVariableNames(pathKey)) {
        if (!declaredPathParams.has(variableName)) {
          errors.push(`Missing path parameter ${variableName} on ${method.toUpperCase()} ${pathKey}`);
        }
      }
    }
  }

  return { errors, controllerRoutes, contractRoutes, docRoutes };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let deps, sourceRoot = repoRoot, offlinePrisma = false, schemaPath;
  const selection = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--deps" && args[index + 1]) deps = args[++index];
    else if (args[index] === "--source-root" && args[index + 1]) sourceRoot = path.resolve(args[++index]);
    else if (args[index] === "--app-module" && args[index + 1]) selection.appModule = args[++index];
    else if (args[index] === "--module-export" && args[index + 1]) selection.moduleExport = args[++index];
    else if (args[index] === "--contracts" && args[index + 1]) selection.contracts = args[++index];
    else if (args[index] === "--document-factory" && args[index + 1]) selection.documentFactory = args[++index];
    else if (args[index] === "--document-transform" && args[index + 1]) (selection.documentTransforms ??= []).push(args[++index]);
    else if (args[index] === "--schema" && args[index + 1]) schemaPath = args[++index];
    else if (args[index] === "--offline-prisma") offlinePrisma = true;
    else throw new Error("用法：node scripts/validate-api-contracts.cjs --app-module <源码> --contracts <正式包或合同源码> [--document-factory <工厂>] [--document-transform <正式包或源码>#<工厂>] [--module-export <导出名>] [--source-root <工作区>] [--deps <只读node_modules>] [--offline-prisma --schema <schema>]");
  }
  (async () => {
    if (!selection.appModule || !selection.contracts) throw new Error("必须显式选择 --app-module 和 --contracts；旧组合请使用固定历史检出");
    const loader = createControllerSourceLoader(sourceRoot, deps, { schemaPath });
    if (offlinePrisma) console.log(JSON.stringify(await loader.prepareOfflinePrisma()));
    return validateApiContracts(loader, selection);
  })().then(result => {
    if (result.errors.length) {
      console.error(`API contract validation failed (${result.controllerRoutes.length} controller operations):`);
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else console.log(`API contract validation passed: ${result.controllerRoutes.length} controller operations covered.`);
  }).catch(error => {
    for (let cause = error; cause; cause = cause.cause) console.error(cause.cause ? cause.message : cause.stack ?? cause);
    process.exitCode = 1;
  });
}
module.exports = { controllerOperations, validateApiContracts, normalizeRoute, matchesControllerRoute };
