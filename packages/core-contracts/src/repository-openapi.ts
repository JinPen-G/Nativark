/**
 * 静态 HTTP/OpenAPI 声明的字段定位。只读取原 AST、符号和本地引用。
 * 不运行生成器或推导 DTO 字段，转换、动态表达式和缺失引用保留准确来源与缺口。
 */
import ts from "typescript";
import type { DevelopmentCapability, DevelopmentSourceReference } from "./development";
import { RepositorySource, UNRESOLVED, isRepositorySourcePath, repositoryPath, sourceReference } from "./repository-source";

type Details = NonNullable<DevelopmentCapability["details"]>;
export interface RepositoryApiDocumentation {
  reference: DevelopmentSourceReference;
  summary?: string;
  operationId?: string;
  details: Details;
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}

function property(node: ts.Expression, name: string): ts.Expression | undefined {
  const object = unwrap(node);
  if (!ts.isObjectLiteralExpression(object)) return;
  const found = object.properties.find(item => ts.isPropertyAssignment(item)
    && item.name.getText().replace(/^["']|["']$/g, "") === name);
  return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}

/** 请求修饰器、响应和 Zod 转换沿原表达式定位，不展开或执行方法。 */
export function describeRepositorySchema(source: RepositorySource, expression: ts.Expression, maps: ts.Expression[] = []): Details {
  const root = source.root;
  const locations: DevelopmentSourceReference[] = [];
  const refs: Array<{ ref: string; declaration?: DevelopmentSourceReference; status: string }> = [];
  const seenNodes = new Set<ts.Node>(), seenRefs = new Set<string>();
  const declaration = (node: ts.Node) => {
    const symbol = source.checker.getSymbolAtLocation(node);
    const target = symbol && source.target(symbol).valueDeclaration;
    return target && isRepositorySourcePath(root, target.getSourceFile().fileName) ? target : undefined;
  };
  const lookup = (node: ts.Expression, name: string, seen = new Set<ts.Node>()): ts.Expression | typeof UNRESOLVED | undefined => {
    if (seen.has(node)) return UNRESOLVED;
    seen.add(node);
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const target = declaration(node);
      if (target && ts.isVariableDeclaration(target) && target.initializer && ts.isVariableDeclarationList(target.parent)
        && target.parent.flags & ts.NodeFlags.Const) return lookup(target.initializer, name, seen);
    }
    if (!ts.isObjectLiteralExpression(node)) return UNRESOLVED;
    // 与对象展开的最后写入语义一致，不拿早期同名定义覆盖后面的真实声明。
    for (const item of [...node.properties].reverse()) {
      if (ts.isSpreadAssignment(item)) {
        const found = lookup(item.expression, name, seen);
        if (found !== undefined) return found;
      } else if (ts.isPropertyAssignment(item) && item.name.getText().replace(/^["']|["']$/g, "") === name) return item.initializer;
    }
  };
  const addReference = (ref: string) => {
    if (seenRefs.has(ref)) return;
    seenRefs.add(ref);
    const name = ref.startsWith("#/components/schemas/") ? ref.slice(21) : undefined;
    const target = name ? maps.map(map => lookup(map, name)).find(value => value !== undefined && value !== UNRESOLVED) : undefined;
    refs.push({ ref, ...(target ? { declaration: sourceReference(target, root) } : {}), status: target ? "source-reference" : "not-indexed" });
    if (target) visit(target);
  };
  const visit = (node: ts.Node) => {
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText().replace(/^["']|["']$/g, "");
      if (["example", "examples", "default", "enum"].includes(name) || name.startsWith("x-")) return;
      if (name === "$ref") {
        const ref = source.value(node.initializer);
        if (typeof ref === "string") addReference(ref);
      }
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      const target = declaration(node);
      if (target && (ts.isVariableDeclaration(target) || ts.isPropertyAssignment(target)) && target.initializer) {
        locations.push({ ...sourceReference(target, root), symbol: target.name.getText() });
        visit(target.initializer);
      }
    }
    if (ts.isCallExpression(node)) {
      const target = declaration(node.expression);
      const file = target && repositoryPath(root, target.getSourceFile().fileName);
      // 这两个正式构造器的字符串参数是本地 schema 名。只读参数，不调用构造器。
      if (target && ts.isFunctionDeclaration(target) && ["ref", "arrayOf"].includes(target.name?.text ?? "")
        && file?.endsWith("/http-openapi-contract.ts")) {
        const name = source.value(node.arguments[0]);
        if (typeof name === "string") addReference(`#/components/schemas/${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  const name = source.value(expression);
  if (typeof name === "string") addReference(`#/components/schemas/${name}`);
  visit(expression);
  const target = declaration(expression);
  return { expression: expression.getText(), source: { ...sourceReference(expression, root) },
    ...(target ? { declaration: { ...sourceReference(target, root) } } : {}),
    sources: [...new Map(locations.map(location => [`${location.path}:${location.line}`, location])).values()],
    references: refs.map(ref => ({ ...ref, ...(ref.declaration ? { declaration: { ...ref.declaration } } : {}) })),
    issues: source.value(expression) === UNRESOLVED || source.unresolvedProperties(expression).length ? ["schema-expansion:source-reference"] : [],
    status: refs.some(ref => ref.status === "not-indexed") ? "not-indexed" : "source-reference" };
}

/** 正式操作列表只补当前 Controller 的资料，不将未执行的生成器当作已挂载接口。 */
export function repositoryApiDocumentation(source: RepositorySource): Map<string, RepositoryApiDocumentation> {
  const result = new Map<string, RepositoryApiDocumentation>();
  const variables: ts.VariableDeclaration[] = [];
  for (const file of source.program.getSourceFiles()) {
    if (file.isDeclarationFile || !isRepositorySourcePath(source.root, file.fileName)) continue;
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const node of statement.declarationList.declarations) {
        if (ts.isIdentifier(node.name) && node.initializer && /(?:OPERATIONS|SCHEMAS)$/u.test(node.name.text)) variables.push(node);
      }
    }
  }
  const schemaMaps = variables.filter(node => node.name.getText().endsWith("SCHEMAS"));
  const describe = (node: ts.Expression, method: unknown, path: unknown, fields: Record<string, ts.Expression | undefined>) => {
    if (typeof method !== "string" || typeof path !== "string" || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return;
    const key = `${method.toUpperCase()} ${path}`;
    if (result.has(key)) return;
    const file = repositoryPath(source.root, node.getSourceFile().fileName);
    const packageDirectory = file.split("/").slice(0, 2).join("/");
    const ownMaps = schemaMaps.filter(map => repositoryPath(source.root, map.getSourceFile().fileName).startsWith(packageDirectory + "/"));
    const componentMaps = ownMaps.filter(map => map.name.getText().endsWith("COMPONENT_SCHEMAS"));
    const maps = (componentMaps.length ? componentMaps : ownMaps).map(map => map.initializer!);
    const schemas = Object.fromEntries(["requestSchema", "responseSchema", "parameters"].flatMap(name => {
      const expression = fields[name];
      return expression ? [[name, describeRepositorySchema(source, expression, maps)]] : [];
    }));
    const summary = source.value(fields.summary), operationId = source.value(fields.operationId);
    const missing = Object.entries(schemas).filter(([, value]) => value.status === "not-indexed").map(([name]) => `${name}:not-indexed`);
    if (!fields.responseSchema) missing.push("responseSchema:source-reference");
    result.set(key, { reference: sourceReference(node, source.root),
      ...(typeof summary === "string" ? { summary } : {}), ...(typeof operationId === "string" ? { operationId } : {}),
      details: { apiFieldsStatus: Object.keys(schemas).length ? "source-reference" : "not-indexed",
        openapiSource: { source: { ...sourceReference(node, source.root) }, schemas,
          issues: missing } } });
  };
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      describe(node, source.value(property(node, "method")), source.value(property(node, "path")),
        Object.fromEntries(["summary", "operationId", "requestSchema", "responseSchema", "parameters"].map(name => [name, property(node, name)])));
    } else if (ts.isCallExpression(node)) {
      const symbol = source.checker.getSymbolAtLocation(node.expression), target = symbol && source.target(symbol).valueDeclaration;
      if (target && ts.isFunctionDeclaration(target) && ["clientOperation", "backlogOperation"].includes(target.name?.text ?? "")
        && repositoryPath(source.root, target.getSourceFile().fileName).endsWith("/http-openapi-contract.ts")) {
        const client = target.name?.text === "clientOperation", options = client ? node.arguments[4] : undefined;
        describe(node, source.value(node.arguments[0]), source.value(node.arguments[1]), {
          operationId: node.arguments[client ? 2 : 3], summary: node.arguments[client ? 3 : 4],
          requestSchema: options ? property(options, "requestSchema") : node.arguments[7],
          responseSchema: options ? property(options, "responseSchema") : node.arguments[8],
          parameters: options ? property(options, "parameters") : node.arguments[9]
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const variable of variables.filter(node => node.name.getText().endsWith("OPERATIONS"))) visit(variable.initializer!);
  return result;
}
