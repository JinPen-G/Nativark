const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node"
  }
});

const {
  API_CONTRACT_OPERATIONS,
  OPENAPI_DOCUMENT
} = require("../apps/api/src/contracts/openapi-document");

const repoRoot = path.resolve(__dirname, "..");
const controllerRoot = path.join(repoRoot, "apps", "api", "src", "modules");
const httpMethods = ["get", "post", "put", "patch", "delete"];

function readControllerFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readControllerFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".controller.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeRoute(prefix, route) {
  const raw = ["api", prefix, route]
    .filter((part) => part !== undefined && part !== "")
    .join("/")
    .replace(/\/+/g, "/");

  return `/${raw}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function controllerOperations() {
  const routes = [];

  for (const file of readControllerFiles(controllerRoot)) {
    const source = fs.readFileSync(file, "utf8");
    const controllerMatch = source.match(/@Controller\((?:"([^"]*)")?\)/);
    if (!controllerMatch) {
      continue;
    }

    const prefix = controllerMatch[1] ?? "";
    const routeRegex = /@(Get|Post|Put|Patch|Delete)\((?:"([^"]*)")?\)/g;
    let match;
    while ((match = routeRegex.exec(source))) {
      routes.push({
        method: match[1].toLowerCase(),
        path: normalizeRoute(prefix, match[2] ?? ""),
        source: path.relative(repoRoot, file)
      });
    }
  }

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

function documentOperations() {
  const routes = [];
  for (const [pathKey, pathItem] of Object.entries(OPENAPI_DOCUMENT.paths ?? {})) {
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

const errors = [];
const controllerRoutes = controllerOperations();
const contractRoutes = API_CONTRACT_OPERATIONS.map(({ method, path }) => ({
  method,
  path
})).sort(compareRoute);
const docRoutes = documentOperations();

const controllerSet = new Set(controllerRoutes.map(routeKey));
const contractSet = new Set(contractRoutes.map(routeKey));
const docSet = new Set(docRoutes.map(routeKey));

for (const route of controllerRoutes) {
  if (!contractSet.has(routeKey(route))) {
    errors.push(`Missing contract operation for controller route ${routeKey(route)} (${route.source})`);
  }
}

for (const route of contractRoutes) {
  if (!controllerSet.has(routeKey(route))) {
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

if (errors.length > 0) {
  console.error("API contract validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `API contract validation passed: ${controllerRoutes.length} controller operations covered.`
);
