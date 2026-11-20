/** 从原 Controller 的 Nest 元数据核对 OpenAPI；不实例化应用、执行路由或连接外部服务。
 * 原型继承、常量、数组与动态装饰器均以真实元数据为准，贡献文档不能补造控制器。
 */
const path = require("node:path");
const { createControllerSourceLoader } = require("./controller-sources.cjs");

const repoRoot = path.resolve(__dirname, "..");
const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options", "trace", "search"];

function normalizeRoute(prefix, route) {
  const raw = ["api", prefix, route]
    .filter((part) => part !== undefined && part !== "")
    .join("/")
    .replace(/\/+/g, "/");

  return `/${raw}`.replace(/\/+$/, "").replace(/:([A-Za-z0-9_]+)/g, "{$1}") || "/";
}

async function controllerOperations(loader) {
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
  await visitModule(loader.load(path.join(repoRoot, "apps/api/src/app.module.ts")).AppModule);
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
            source: `${path.relative(repoRoot, file)}#${controller.name}.${name}`
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

async function validateApiContracts(loader) {
  const controllerRoutes = await controllerOperations(loader);
  const { API_CONTRACT_OPERATIONS, OPENAPI_DOCUMENT } = loader.load(path.join(repoRoot, "apps/api/src/contracts/openapi-document.ts"));
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
  let deps, offlinePrisma = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--deps" && args[index + 1]) deps = args[++index];
    else if (args[index] === "--offline-prisma") offlinePrisma = true;
    else throw new Error("用法：node scripts/validate-api-contracts.cjs [--deps <只读node_modules>] [--offline-prisma]");
  }
  const loader = createControllerSourceLoader(repoRoot, deps);
  (async () => {
    if (offlinePrisma) console.log(JSON.stringify(await loader.prepareOfflinePrisma()));
    return validateApiContracts(loader);
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
