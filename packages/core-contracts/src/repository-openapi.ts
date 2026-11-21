/**
 * 静态 HTTP/OpenAPI 声明的字段定位。只读取原 AST、符号和本地引用。
 * 字面量、有限数字加减及单一返回表达式按原语法读取，不执行模块、生成器或校验器。
 * DTO 请求字段只定位原类型和装饰器，不推导校验或响应 schema。Zod 转换和动态表达式保留来源。
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
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

type SchemaValue = null | boolean | number | string | SchemaValue[] | { [key: string]: SchemaValue };
type ExpressionBinding = { expression: ts.Expression; bindings: Map<ts.Symbol, ExpressionBinding>; seen: Set<ts.Node> };
type ObjectWrites = { keys: Set<string>; unknown: boolean; unsafe: boolean; frozen: boolean };
type ObjectMutation = { node: ts.Node; sources?: ts.Expression[] };
const objectMutationIndexes = new WeakMap<RepositorySource, Map<ts.VariableDeclaration, ObjectMutation[]>>();

/** 只解释纯声明语法。未知展开会遮蔽前面的属性，不能保留可能被覆盖的旧字段。 */
class StaticSchemaReader {
  readonly issues = new Set<string>();
  readonly fields = new Map<string, DevelopmentSourceReference>();
  readonly literalMaps = new Set<ts.CallExpression>();
  readonly mappedObjects = new Set<ts.ObjectLiteralExpression>();
  readonly compositions = new Set<ts.Node>();
  private readonly partialObjects = new WeakSet<object>();
  private readonly objectWrites = new WeakMap<object, ObjectWrites>();

  constructor(private readonly source: RepositorySource) {}

  schema(expression: ts.Expression, bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>()): SchemaValue | typeof UNRESOLVED {
    const value = this.read(expression, "", bindings, seen);
    if (value !== UNRESOLVED && value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (value.type === "object" && value.additionalProperties === true && !value.properties) this.issues.add("/:unspecified-object-fields");
      if (value["x-schemaStatus"] === "incomplete" || Array.isArray(value["x-schemaGaps"]) && value["x-schemaGaps"].length)
        this.issues.add("/:declared-schema-gap");
    }
    return value;
  }

  member(expression: ts.Expression, name: string): ExpressionBinding | typeof UNRESOLVED | undefined {
    return this.selectMember(expression, [name], new Map(), new Set());
  }

  fieldSources(value: SchemaValue | typeof UNRESOLVED): Array<{ pointer: string; source: DevelopmentSourceReference }> {
    if (value === UNRESOLVED) return [];
    return [...this.fields].filter(([pointer]) => {
      let current: SchemaValue = value;
      for (const segment of pointer.slice(1).split("/")) {
        const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
        if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return false;
        current = (current as Record<string, SchemaValue>)[key];
      }
      return true;
    }).map(([pointer, location]) => ({ pointer, source: location }));
  }

  read(expression: ts.Expression, pointer = "", bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>(), selectiveMembers = false): SchemaValue | typeof UNRESOLVED {
    const node = unwrap(expression);
    if (seen.has(node) || seen.size > 80) return this.unresolved(pointer, "recursive-expression");
    const chain = new Set(seen).add(node);
    const read = (child: ts.Expression, location = pointer, scope = bindings) => this.read(child, location, scope, chain, selectiveMembers);
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || ts.isPrefixUnaryExpression(node)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) {
      const value = this.source.value(node);
      return value === UNRESOLVED ? this.unresolved(pointer, "literal") : value;
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operatorToken.kind)) {
      // 菜单顺序只接纳已确定的有限数字，不做字符串拼接、隐式转换或其他运算。
      const left = read(node.left), right = read(node.right);
      if (typeof left !== "number" || typeof right !== "number") return this.unresolved(pointer, "dynamic-number");
      const value = node.operatorToken.kind === ts.SyntaxKind.PlusToken ? left + right : left - right;
      return Number.isFinite(left) && Number.isFinite(right) && Number.isFinite(value)
        ? value : this.unresolved(pointer, "non-finite-number");
    }
    if (ts.isIdentifier(node)) {
      const symbol = this.source.checker.getSymbolAtLocation(node);
      const binding = symbol && bindings.get(symbol);
      if (binding) return this.read(binding.expression, pointer, binding.bindings, binding.seen, selectiveMembers);
      const target = symbol && this.source.target(symbol).valueDeclaration;
      if (target && ts.isEnumDeclaration(target) && isRepositorySourcePath(this.source.root, target.getSourceFile().fileName)) {
        const value: Record<string, SchemaValue> = Object.create(null);
        for (const member of target.members) {
          const constant = this.source.checker.getConstantValue(member);
          if (typeof constant !== "string") return this.unresolved(pointer, "enum-member");
          value[member.name.getText().replace(/^["']|["']$/g, "")] = constant;
        }
        return value;
      }
      const constant = this.constTarget(node);
      if (constant?.initializer) {
        const value = read(constant.initializer);
        if (value === UNRESOLVED || value === null || typeof value !== "object" || Array.isArray(value)) return value;
        const mutations = this.objectMutations(constant, node);
        const writes = this.objectWrites.get(value);
        if (mutations.some(mutation => !mutation.sources) || mutations.length && (writes?.unsafe || writes?.frozen || writes?.keys.has("__proto__"))) {
          this.clearFields(pointer);
          return this.unresolved(pointer, "dynamic-object-write");
        }
        for (const mutation of mutations) for (const part of mutation.sources!) this.mergeObject(value, part, pointer, read, true);
        return value;
      }
      return this.unresolved(pointer, "dynamic-identifier");
    }
    if (ts.isObjectLiteralExpression(node)) {
      if (selectiveMembers) this.mappedObjects.add(node);
      const value: Record<string, SchemaValue> = Object.create(null);
      const writes: ObjectWrites = { keys: new Set(), unknown: false, unsafe: false, frozen: false };
      this.objectWrites.set(value, writes);
      let partial = false;
      for (const item of node.properties) {
        if (ts.isSpreadAssignment(item)) {
          this.mergeObject(value, item.expression, pointer, read);
          continue;
        }
        const key = ts.isComputedPropertyName(item.name) ? read(item.name.expression)
          : ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name) || ts.isNumericLiteral(item.name) ? item.name.text : UNRESOLVED;
        if (typeof key !== "string" && typeof key !== "number") {
          for (const key of Object.keys(value)) delete value[key];
          writes.keys.clear();
          writes.unknown = true;
          partial = true;
          this.clearFields(pointer);
          this.unresolved(pointer, "dynamic-key");
          continue;
        }
        const location = `${pointer}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
        writes.keys.add(String(key));
        writes.unsafe ||= ts.isGetAccessorDeclaration(item) || ts.isSetAccessorDeclaration(item);
        this.clearFields(location);
        this.fields.set(location, sourceReference(item, this.source.root));
        const shorthand = ts.isShorthandPropertyAssignment(item) && this.source.checker.getShorthandAssignmentValueSymbol(item);
        const target = shorthand && this.source.target(shorthand).valueDeclaration;
        const child = ts.isPropertyAssignment(item) ? item.initializer
          : target && ts.isParameter(target) && ts.isIdentifier(target.name) ? target.name
          : target && ts.isVariableDeclaration(target) ? target.initializer : undefined;
        const part = child ? read(child, location) : this.unresolved(location, "dynamic-property");
        delete value[String(key)];
        if (part !== UNRESOLVED) value[String(key)] = part;
        else partial = true;
      }
      if (partial) this.partialObjects.add(value);
      return value;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const value: SchemaValue[] = [];
      for (const item of node.elements) {
        if (ts.isOmittedExpression(item)) return this.unresolved(pointer, "array-hole");
        const offset = value.length;
        const part = read(ts.isSpreadElement(item) ? item.expression : item, `${pointer}/${value.length}`);
        if (part === UNRESOLVED) return UNRESOLVED;
        if (ts.isSpreadElement(item)) {
          if (!Array.isArray(part)) return this.unresolved(pointer, "dynamic-array-spread");
          // 展开的数组不保留外层占位索引，字段及缺口都映射到最终数组位置。
          const prefix = `${pointer}/${offset}/`;
          const fields = [...this.fields].filter(([key]) => key.startsWith(prefix));
          for (const [key] of fields) this.fields.delete(key);
          for (const [key, location] of fields) {
            const suffix = key.slice(prefix.length), index = /^(\d+)(?=\/|$)/u.exec(suffix)?.[1];
            if (index !== undefined) this.fields.set(`${pointer}/${offset + Number(index)}${suffix.slice(index.length)}`, location);
          }
          for (const issue of [...this.issues]) if (issue.startsWith(prefix)) {
            const suffix = issue.slice(prefix.length), index = /^(\d+)(?=\/|:|$)/u.exec(suffix)?.[1];
            if (index !== undefined) {
              this.issues.delete(issue);
              this.issues.add(`${pointer}/${offset + Number(index)}${suffix.slice(index.length)}`);
            }
          }
          value.push(...part);
        } else value.push(part);
      }
      return value;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = read(span.expression);
        if (typeof part !== "string" && typeof part !== "number") return this.unresolved(pointer, "dynamic-template");
        value += part + span.literal.text;
      }
      return value;
    }
    if (ts.isConditionalExpression(node)) {
      const condition = read(node.condition);
      return condition === UNRESOLVED ? this.unresolved(pointer, "dynamic-condition") : read(condition ? node.whenTrue : node.whenFalse);
    }
    if (ts.isTypeOfExpression(node)) {
      const value = read(node.expression);
      return value === UNRESOLVED ? UNRESOLVED : typeof value;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      const left = read(node.left), right = read(node.right);
      return left === UNRESOLVED || right === UNRESOLVED ? UNRESOLVED : left === right;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression && read(node.argumentExpression);
      if (key === "source") {
        let pattern = unwrap(node.expression);
        const aliases = new Set(chain);
        while (ts.isIdentifier(pattern) && !aliases.has(pattern)) {
          aliases.add(pattern);
          const symbol = this.source.checker.getSymbolAtLocation(pattern);
          const target = symbol && this.source.target(symbol).valueDeclaration;
          if (!target || !ts.isVariableDeclaration(target) || !target.initializer
            || !ts.isVariableDeclarationList(target.parent) || !(target.parent.flags & ts.NodeFlags.Const)
            || !isRepositorySourcePath(this.source.root, target.getSourceFile().fileName)) break;
          pattern = unwrap(target.initializer);
        }
        // 正则字面量的 source 是原模式文本，不执行 RegExp 构造器或用户 getter。
        if (ts.isRegularExpressionLiteral(pattern)) {
          const literal = pattern.getText();
          return literal.slice(1, literal.lastIndexOf("/"));
        }
      }
      if (typeof key === "string" || typeof key === "number") {
        const selected = this.selectMember(node.expression, [String(key)], bindings, chain);
        if (selected && selected !== UNRESOLVED) return this.read(selected.expression, pointer, selected.bindings, selected.seen, selectiveMembers);
      }
      const value = read(node.expression);
      return value !== UNRESOLVED && value !== null && typeof value === "object" && (typeof key === "string" || typeof key === "number")
        && Object.hasOwn(value, key) ? (value as Record<string, SchemaValue>)[String(key)] : this.unresolved(pointer, "dynamic-member");
    }
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map" && node.arguments.length === 1) {
        const list = unwrap(node.expression.expression), callback = unwrap(node.arguments[0]);
        if (ts.isArrowFunction(callback) && !callback.modifiers?.length && callback.parameters.length === 1
          && ts.isIdentifier(callback.parameters[0].name) && !callback.parameters[0].initializer
          && !callback.parameters[0].dotDotDotToken && !ts.isBlock(callback.body)) {
          const symbol = this.source.checker.getSymbolAtLocation(callback.parameters[0].name);
          let items: ExpressionBinding[] | undefined;
          if (ts.isArrayLiteralExpression(list) && list.elements.every(ts.isStringLiteralLike))
            items = list.elements.map(expression => ({ expression, bindings, seen: chain }));
          else if (ts.isCallExpression(list) && this.objectCall(list, "values") && list.arguments.length === 1 && !ts.isSpreadElement(list.arguments[0])) {
            // 沿已有对象覆盖/写入守卫核定枚举集合，回调参数仍绑定原成员 AST，不执行工厂。
            const guard = new StaticSchemaReader(this.source), table = guard.read(list.arguments[0], "", bindings, chain);
            const writes = table !== UNRESOLVED && table !== null && typeof table === "object" ? guard.objectWrites.get(table) : undefined;
            if (table !== UNRESOLVED && table !== null && typeof table === "object" && !Array.isArray(table)
              && !guard.partialObjects.has(table) && !writes?.unknown && !writes?.unsafe) {
              const selected = Object.keys(table).map(key => this.selectMember(list.arguments[0], [key], bindings, chain));
              if (selected.every((item): item is ExpressionBinding => item !== undefined && item !== UNRESOLVED)) items = selected;
            }
          }
          if (symbol && items) {
            const value: SchemaValue[] = [];
            // 逐项绑定原表达式，再沿同一静态读取器解释映射体。
            for (const item of items) {
              const scope = new Map(bindings);
              scope.set(symbol, item);
              const part = this.read(callback.body, `${pointer}/${value.length}`, scope, chain, true);
              if (part === UNRESOLVED) return UNRESOLVED;
              value.push(part);
            }
            this.literalMaps.add(node);
            return value;
          }
        }
        return this.unresolved(pointer, "dynamic-map");
      }
      if (this.objectCall(node, "assign") && node.arguments.length && !node.arguments.some(ts.isSpreadElement)) {
        const value = read(node.arguments[0]);
        const writes = value !== UNRESOLVED && value !== null && typeof value === "object" && this.objectWrites.get(value);
        if (value === UNRESOLVED || value === null || typeof value !== "object" || Array.isArray(value) || writes && (writes.unsafe || writes.frozen || writes.keys.has("__proto__"))) {
          this.clearFields(pointer);
          return this.unresolved(pointer, "dynamic-assign-target");
        }
        for (const part of node.arguments.slice(1)) this.mergeObject(value, part, pointer, read, true);
        return value;
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.arguments.length === 1
        && ["freeze", "keys", "values"].some(method => this.objectCall(node, method))) {
        const value = read(node.arguments[0]);
        if (node.expression.name.text === "freeze") {
          if (value !== UNRESOLVED && value !== null && typeof value === "object") {
            const writes = this.objectWrites.get(value) ?? { keys: new Set(Object.keys(value)), unknown: false, unsafe: false, frozen: false };
            writes.frozen = true;
            this.objectWrites.set(value, writes);
          }
          return value;
        }
        if (value !== UNRESOLVED && value !== null && typeof value === "object" && !this.partialObjects.has(value)) {
          const keys = Object.keys(value);
          if (node.expression.name.text === "keys") return keys;
          // values 的最终数组沿原属性枚举顺序定位，嵌套未知字段也必须跟随数组索引。
          const locations = keys.map((key, index) => [`${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, `${pointer}/${index}`])
            .sort(([left], [right]) => right.length - left.length);
          const relocate = (location: string, issue = false) => {
            const found = locations.find(([from]) => location === from || location.startsWith(from + "/") || issue && location.startsWith(from + ":"));
            return found ? found[1] + location.slice(found[0].length) : location;
          };
          const fields = [...this.fields].filter(([location]) => location.startsWith(pointer + "/"));
          this.clearFields(pointer);
          for (const [location, source] of fields) this.fields.set(relocate(location), source);
          const issues = [...this.issues].map(location => [location, relocate(location, true)]);
          for (const [from, to] of issues) if (from !== to) this.issues.delete(from);
          for (const [from, to] of issues) if (from !== to) this.issues.add(to);
          return Object.values(value);
        }
        return this.unresolved(pointer, node.expression.name.text === "keys" ? "dynamic-keys" : "dynamic-values");
      }
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "includes" && node.arguments.length === 1) {
        const value = read(node.expression.expression), search = read(node.arguments[0]);
        return typeof value === "string" && typeof search === "string" ? value.includes(search) : this.unresolved(pointer, "dynamic-includes");
      }
      const body = this.callBody(node, bindings, chain);
      if (body) return this.read(body.expression, pointer, body.bindings, body.seen, selectiveMembers);
      return this.unresolved(pointer, "runtime-call");
    }
    return this.unresolved(pointer, "unsupported-expression");
  }

  private objectCall(node: ts.CallExpression, method: string): boolean {
    return ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "Object" && node.expression.name.text === method
      && !this.source.checker.getSymbolAtLocation(node.expression.expression)?.declarations?.length;
  }

  private plainLiteral(expression: ts.Expression): boolean {
    const node = unwrap(expression);
    return ts.isObjectLiteralExpression(node) && node.properties.every(item => !ts.isSpreadAssignment(item)
      && !ts.isGetAccessorDeclaration(item) && !ts.isSetAccessorDeclaration(item)
      && (ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name) || ts.isNumericLiteral(item.name)) && item.name.text !== "__proto__");
  }

  private constTarget(expression: ts.Expression): ts.VariableDeclaration | undefined {
    let node = unwrap(expression);
    let latest: ts.VariableDeclaration | undefined;
    const seen = new Set<ts.VariableDeclaration>();
    while (ts.isIdentifier(node)) {
      const symbol = this.source.checker.getSymbolAtLocation(node);
      const target = symbol && this.source.target(symbol).valueDeclaration;
      if (!target || !ts.isVariableDeclaration(target) || !target.initializer || !ts.isVariableDeclarationList(target.parent)
        || !(target.parent.flags & ts.NodeFlags.Const) || !isRepositorySourcePath(this.source.root, target.getSourceFile().fileName)) return latest;
      if (seen.has(target)) return;
      seen.add(target);
      latest = target;
      const initializer = unwrap(target.initializer);
      if (!ts.isIdentifier(initializer)) return target;
      node = initializer;
    }
  }

  /** 只接纳同模块顺序明确的顶层 assign。循环、未知调用及其他写入保留真实位置并失效。 */
  private objectMutations(target: ts.VariableDeclaration, usage: ts.Identifier): ObjectMutation[] {
    let index = objectMutationIndexes.get(this.source);
    if (!index) {
      index = new Map();
      const owner = (expression: ts.Expression, seen = new Set<ts.Node>()): ts.VariableDeclaration | undefined => {
        let node = unwrap(expression);
        if (seen.has(node) || seen.size > 80) return;
        const chain = new Set(seen).add(node);
        while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) node = unwrap(node.expression);
        const constant = this.constTarget(node);
        if (constant || !ts.isIdentifier(node)) return constant;
        const symbol = this.source.checker.getSymbolAtLocation(node);
        const binding = symbol && this.source.target(symbol).valueDeclaration;
        if (binding && ts.isBindingElement(binding)) {
          let declaration: ts.Node = binding.parent;
          while (declaration.parent && !ts.isVariableDeclaration(declaration)) declaration = declaration.parent;
          if (ts.isVariableDeclaration(declaration) && declaration.initializer) return owner(declaration.initializer, chain);
        }
      };
      const add = (node: ts.Node, constant: ts.VariableDeclaration, sources?: ts.Expression[]) => {
        const seen = new Set<ts.VariableDeclaration>();
        while (!seen.has(constant)) {
          seen.add(constant);
          const entries = index!.get(constant) ?? [];
          entries.push({ node, ...(sources ? { sources } : {}) });
          index!.set(constant, entries);
          const initializer = constant.initializer && unwrap(constant.initializer);
          const parent = initializer && (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer))
            && owner(initializer.expression);
          if (!parent) break;
          constant = parent;
          sources = undefined;
        }
      };
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const constant = node.arguments[0] && owner(node.arguments[0]);
          if (constant && this.objectCall(node, "assign")) {
            const direct = unwrap(node.arguments[0]);
            const topLevel = ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent);
            const local = node.getSourceFile() === constant.getSourceFile();
            add(node, constant, ts.isIdentifier(direct) && topLevel && local && node.getStart() > constant.getStart()
              && !node.arguments.some(ts.isSpreadElement) ? [...node.arguments.slice(1)] : undefined);
          } else if (!["assign", "keys", "values", "entries", "hasOwn"].some(method => this.objectCall(node, method)) && !this.pureCall(node)) {
            for (const argument of node.arguments) {
              const constant = owner(argument);
              if (constant) add(node, constant);
            }
          }
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
          const constant = owner(node.left);
          if (constant) add(node, constant);
        } else if (ts.isDeleteExpression(node) || (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
          && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
          const constant = owner(ts.isDeleteExpression(node) ? node.expression : node.operand);
          if (constant) add(node, constant);
        } else if (ts.isVariableDeclaration(node) && node.initializer && ts.isVariableDeclarationList(node.parent)
          && !(node.parent.flags & ts.NodeFlags.Const)) {
          const constant = owner(node.initializer);
          if (constant) add(node, constant);
        }
        ts.forEachChild(node, visit);
      };
      for (const file of this.source.program.getSourceFiles()) {
        if (!file.isDeclarationFile && isRepositorySourcePath(this.source.root, file.fileName)) visit(file);
      }
      objectMutationIndexes.set(this.source, index);
    }
    const mutations = index.get(target) ?? [];
    const deferred = (node: ts.Node) => {
      for (let current: ts.Node | undefined = node; current && !ts.isSourceFile(current); current = current.parent)
        if (ts.isFunctionLike(current)) return true;
      return false;
    };
    let statement: ts.Node = usage;
    while (statement.parent && !ts.isSourceFile(statement.parent)) statement = statement.parent;
    const finalName = ts.isVariableDeclaration(usage.parent) && usage.parent.name === usage;
    const cutoff = finalName || usage.getSourceFile() !== target.getSourceFile() ? Infinity : statement.end;
    // 与基础常量读取一致：同语句不重放顺序，延迟读写不凭文本位置裁定发生时间。
    const current = mutations.filter(mutation => deferred(usage) || deferred(mutation.node)
      || mutation.node.getSourceFile() !== target.getSourceFile() || mutation.node.getStart() < cutoff);
    for (const mutation of current) this.compositions.add(mutation.node);
    return current.map(mutation => deferred(usage) || deferred(mutation.node) ? { node: mutation.node } : mutation);
  }

  private pureCall(node: ts.CallExpression, seen = new Set<ts.Node>()): boolean {
    const body = this.callBody(node, new Map(), new Set());
    if (!body || seen.has(body.expression) || seen.size > 80) return false;
    const chain = new Set(seen).add(body.expression);
    let pure = true;
    const visit = (part: ts.Node) => {
      if (ts.isCallExpression(part) && !["keys", "values", "entries", "hasOwn"].some(method => this.objectCall(part, method))
        && !(this.objectCall(part, "assign") && part.arguments.length && this.plainLiteral(part.arguments[0])) && !this.pureCall(part, chain)
        || ts.isNewExpression(part) || ts.isDeleteExpression(part)
        || ts.isBinaryExpression(part) && part.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && part.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        || (ts.isPrefixUnaryExpression(part) || ts.isPostfixUnaryExpression(part))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(part.operator)) pure = false;
      if (pure) ts.forEachChild(part, visit);
    };
    visit(body.expression);
    for (const binding of body.bindings.values()) if (pure) visit(binding.expression);
    return pure;
  }

  /** 每层先单独定位出处，再按已知键覆盖。部分来源不会丢掉未知之后的明确字段。 */
  private mergeObject(value: Record<string, SchemaValue>, expression: ts.Expression, pointer: string,
    read: (expression: ts.Expression) => SchemaValue | typeof UNRESOLVED, assignment = false): void {
    const previous = [...this.fields].filter(([key]) => key.startsWith(pointer + "/"));
    this.clearFields(pointer);
    const part = read(expression);
    const fields = [...this.fields].filter(([key]) => key.startsWith(pointer + "/"));
    if (part === null || typeof part === "boolean" || typeof part === "number" || part === "") {
      for (const [key, location] of previous) this.fields.set(key, location);
      return;
    }
    const writes = this.objectWrites.get(value) ?? { keys: new Set(Object.keys(value)), unknown: false, unsafe: false, frozen: false };
    this.objectWrites.set(value, writes);
    const object = part !== UNRESOLVED && part !== null && typeof part === "object" && !Array.isArray(part) ? part : undefined;
    const source = object && (this.objectWrites.get(object) ?? { keys: new Set(Object.keys(object)), unknown: false, unsafe: false, frozen: false });
    const unsafe = source && (source.unsafe || assignment && source.keys.has("__proto__"));
    this.clearFields(pointer);
    if (!source || source.unknown || unsafe) {
      for (const key of Object.keys(value)) delete value[key];
      writes.keys.clear();
      writes.unknown = true;
      this.partialObjects.add(value);
    } else for (const [key, location] of previous) this.fields.set(key, location);
    if (!object || !source || unsafe) {
      this.unresolved(pointer, assignment ? "dynamic-assign-source" : "dynamic-spread");
      return;
    }
    for (const key of source.keys) {
      const location = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      delete value[key];
      this.fields.delete(location);
      this.clearFields(location);
      writes.keys.add(key);
      if (Object.hasOwn(object, key)) value[key] = object[key];
    }
    for (const [key, location] of fields) this.fields.set(key, location);
    if (this.partialObjects.has(object)) this.partialObjects.add(value);
  }

  private callBody(node: ts.CallExpression, bindings: Map<ts.Symbol, ExpressionBinding>, seen: Set<ts.Node>): ExpressionBinding | undefined {
    const symbol = this.source.checker.getSymbolAtLocation(node.expression);
    const target = symbol && this.source.target(symbol).valueDeclaration;
    const callable = target && ts.isVariableDeclaration(target) && target.initializer ? unwrap(target.initializer) : target;
    if (!callable || !(ts.isFunctionDeclaration(callable) || ts.isArrowFunction(callable)) || !callable.body
      || ts.isFunctionDeclaration(callable) && callable.asteriskToken
      || callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      || !isRepositorySourcePath(this.source.root, callable.getSourceFile().fileName)) return;
    const body = ts.isBlock(callable.body) ? callable.body.statements.length === 1 && ts.isReturnStatement(callable.body.statements[0])
      ? callable.body.statements[0].expression : undefined : callable.body;
    if (!body || node.arguments.some(ts.isSpreadElement)
      || !callable.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.dotDotDotToken)) return;
    const scope = new Map(bindings);
    callable.parameters.forEach((parameter, index) => {
      const name = this.source.checker.getSymbolAtLocation(parameter.name), argument = node.arguments[index];
      if (name && (argument || parameter.initializer)) scope.set(name, { expression: argument ?? parameter.initializer!, bindings: argument ? bindings : scope, seen });
    });
    return { expression: body, bindings: scope, seen };
  }

  /** 按最后写入语义定位所选成员，避免读入同一聚合中无关 schema 的缺口。 */
  private selectMember(expression: ts.Expression, keys: string[], bindings: Map<ts.Symbol, ExpressionBinding>, seen: Set<ts.Node>): ExpressionBinding | typeof UNRESOLVED | undefined {
    if (!keys.length) return { expression, bindings, seen };
    const node = unwrap(expression);
    if (seen.has(node) || seen.size > 80) return UNRESOLVED;
    const chain = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const symbol = this.source.checker.getSymbolAtLocation(node), binding = symbol && bindings.get(symbol);
      if (binding) return this.selectMember(binding.expression, keys, binding.bindings, binding.seen);
      const target = this.constTarget(node);
      if (target?.initializer) {
        const mutations = this.objectMutations(target, node);
        if (mutations.some(mutation => !mutation.sources)) return UNRESOLVED;
        return mutations.length ? this.assignedMember(target.initializer, mutations.flatMap(mutation => mutation.sources!), keys, bindings, chain)
          : this.selectMember(target.initializer, keys, bindings, chain);
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression && this.read(node.argumentExpression, "", bindings, chain);
      if (typeof key === "string" || typeof key === "number") return this.selectMember(node.expression, [String(key), ...keys], bindings, chain);
    }
    if (ts.isCallExpression(node)) {
      if (this.objectCall(node, "freeze") && node.arguments.length === 1)
        return this.selectMember(node.arguments[0], keys, bindings, chain);
      if (this.objectCall(node, "assign") && node.arguments.length && !node.arguments.some(ts.isSpreadElement))
        return this.assignedMember(node.arguments[0], [...node.arguments.slice(1)], keys, bindings, chain);
      const body = this.callBody(node, bindings, chain);
      if (body) return this.selectMember(body.expression, keys, body.bindings, body.seen);
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const item of [...node.properties].reverse()) {
        if (ts.isSpreadAssignment(item)) {
          const found = this.selectMember(item.expression, keys, bindings, chain);
          if (found !== undefined) return found;
          continue;
        }
        const key = ts.isComputedPropertyName(item.name) ? this.read(item.name.expression, "", bindings, chain)
          : ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name) || ts.isNumericLiteral(item.name) ? item.name.text : UNRESOLVED;
        if (key === UNRESOLVED) return UNRESOLVED;
        if (String(key) !== keys[0]) continue;
        const symbol = ts.isShorthandPropertyAssignment(item) && this.source.checker.getShorthandAssignmentValueSymbol(item);
        const target = symbol && this.source.target(symbol).valueDeclaration;
        const child = ts.isPropertyAssignment(item) ? item.initializer
          : target && ts.isParameter(target) && ts.isIdentifier(target.name) ? target.name
          : target && ts.isVariableDeclaration(target) ? target.initializer : undefined;
        return child ? this.selectMember(child, keys.slice(1), bindings, chain) ?? UNRESOLVED : UNRESOLVED;
      }
      return;
    }
    return UNRESOLVED;
  }

  private assignedMember(target: ts.Expression, sources: ts.Expression[], keys: string[], bindings: Map<ts.Symbol, ExpressionBinding>, seen: Set<ts.Node>): ExpressionBinding | typeof UNRESOLVED | undefined {
    const guard = new StaticSchemaReader(this.source);
    // 普通字面量的属性值无需展开即可核定可写性，引用查找只读取最终所选 schema。
    if (!this.plainLiteral(target)) {
      const value = guard.read(target, "", bindings, seen);
      const writes = value !== UNRESOLVED && value !== null && typeof value === "object" && guard.objectWrites.get(value);
      if (value === UNRESOLVED || value === null || typeof value !== "object" || Array.isArray(value) || writes && (writes.unsafe || writes.frozen || writes.keys.has("__proto__"))) return UNRESOLVED;
    }
    for (const expression of [...sources].reverse()) {
      if (!this.plainLiteral(expression)) {
        const part = guard.read(expression, "", bindings, seen);
        if (part === null || typeof part === "boolean" || typeof part === "number" || part === "") continue;
        const writes = part !== UNRESOLVED && part !== null && typeof part === "object" && guard.objectWrites.get(part);
        if (writes && (writes.unsafe || writes.keys.has("__proto__"))) return UNRESOLVED;
      }
      const found = this.selectMember(expression, keys, bindings, seen);
      if (found !== undefined) return found;
    }
    return this.selectMember(target, keys, bindings, seen);
  }

  private unresolved(pointer: string, reason: string): typeof UNRESOLVED {
    this.issues.add(`${pointer || "/"}:${reason}`);
    return UNRESOLVED;
  }

  private clearFields(pointer: string): void {
    for (const key of this.fields.keys()) {
      if (key.startsWith(pointer + "/")) this.fields.delete(key);
    }
  }
}

function property(node: ts.Expression, name: string): ts.Expression | undefined {
  const object = unwrap(node);
  if (!ts.isObjectLiteralExpression(object)) return;
  const found = object.properties.find(item => ts.isPropertyAssignment(item)
    && item.name.getText().replace(/^["']|["']$/g, "") === name);
  return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}

/** OpenAPI 字段可由纯声明展开，Zod/DTO 仍沿原表达式定位，不执行校验或转换。 */
export function describeRepositorySchema(source: RepositorySource, expression: ts.Expression, maps: ts.Expression[] = [], referencePrefix = ""): Details {
  const root = source.root;
  const locations: DevelopmentSourceReference[] = [];
  const refs: Array<{ ref: string; declaration?: DevelopmentSourceReference; mapSources?: DevelopmentSourceReference[]; status: string; schema?: SchemaValue;
    fieldSources?: Array<{ pointer: string; source: DevelopmentSourceReference }>; issues?: string[] }> = [];
  const sourceFields: Array<{ name: string; expression: string; source: DevelopmentSourceReference }> = [];
  const seenNodes = new Set<ts.Node>(), seenRefs = new Set<string>();
  const declaration = (node: ts.Node) => {
    const symbol = source.checker.getSymbolAtLocation(node);
    const target = symbol && source.target(symbol).valueDeclaration;
    return target && isRepositorySourcePath(root, target.getSourceFile().fileName) ? target : undefined;
  };
  const addReference = (ref: string) => {
    if (seenRefs.has(ref)) return;
    seenRefs.add(ref);
    const name = ref.startsWith("#/components/schemas/") ? ref.slice(21).replaceAll("~1", "/").replaceAll("~0", "~") : undefined;
    const resolver = new StaticSchemaReader(source);
    const found = name ? maps.map(map => resolver.member(map, name)).find(value => value !== undefined) : undefined;
    const target = found !== UNRESOLVED ? found : undefined;
    const reader = new StaticSchemaReader(source);
    const schema = target && reader.schema(target.expression, target.bindings, target.seen);
    refs.push({ ref, ...(target ? { declaration: sourceReference(target.expression, root),
      ...(schema !== UNRESOLVED && schema !== undefined ? { schema } : {}),
      fieldSources: reader.fieldSources(schema ?? UNRESOLVED), issues: [...reader.issues] }
      : { mapSources: [...maps, ...resolver.compositions].map(map => sourceReference(map, root)),
        issues: [found === UNRESOLVED ? "schema-map:source-reference" : "schema-reference:not-indexed"] }),
      status: target ? reader.issues.size ? "source-reference" : "indexed" : "not-indexed" });
    if (schema !== UNRESOLVED && schema !== undefined) visitValue(schema);
    for (const node of reader.compositions) locations.push(sourceReference(node, root));
    if (target) visit(target.expression);
  };
  const visitValue = (value: SchemaValue) => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visitValue);
      return;
    }
    if (typeof value.$ref === "string") addReference(value.$ref);
    for (const [key, child] of Object.entries(value))
      if (!["example", "examples", "default", "enum"].includes(key) && !key.startsWith("x-")) visitValue(child);
  };
  const visit = (node: ts.Node) => {
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (ts.isCallExpression(node) && reader.literalMaps.has(node)) {
      for (const object of reader.mappedObjects) visit(object);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText().replace(/^["']|["']$/g, "");
      if (["example", "examples", "default", "enum"].includes(name) || name.startsWith("x-")) return;
      sourceFields.push({ name, expression: node.initializer.getText(), source: sourceReference(node, root) });
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
  const reader = new StaticSchemaReader(source);
  const schema = reader.schema(expression);
  const name = source.value(expression);
  if (typeof name === "string") addReference(`#/components/schemas/${name.includes(".") ? name : referencePrefix + name}`);
  else if (schema !== UNRESOLVED) visitValue(schema);
  visit(expression);
  for (const node of reader.compositions) locations.push(sourceReference(node, root));
  const target = declaration(expression);
  return { expression: expression.getText(), source: { ...sourceReference(expression, root) },
    ...(target ? { declaration: { ...sourceReference(target, root) } } : {}),
    sources: [...new Map(locations.map(location => [`${location.path}:${location.line}`, location])).values()],
    sourceFields,
    references: refs.map(ref => ({ ...ref, ...(ref.declaration ? { declaration: { ...ref.declaration } } : {}) })),
    ...(schema !== UNRESOLVED && typeof name !== "string" ? { schema } : {}),
    fieldSources: reader.fieldSources(schema),
    issues: reader.issues.size ? ["schema-expansion:source-reference", ...reader.issues] : [],
    status: refs.some(ref => ref.status === "not-indexed") ? "not-indexed"
      : reader.issues.size || refs.some(ref => ref.status !== "indexed") ? "source-reference" : "indexed" };
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
        if (ts.isIdentifier(node.name) && node.initializer) variables.push(node);
      }
    }
  }
  const schemaMaps = variables.filter(node => node.name.getText().endsWith("SCHEMAS"));
  const pathDefaults = new Map<boolean, ts.Expression>();
  for (const file of source.program.getSourceFiles()) {
    const path = repositoryPath(source.root, file.fileName);
    const platform = path === "packages/platform-server/src/platform-openapi.ts";
    if (!platform && path !== "packages/rental-core/src/http-openapi-contract.ts") continue;
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node) && source.value(property(node, "in")) === "path"
        && source.value(property(node, "required")) === true) {
        const schema = property(node, "schema");
        if (schema) pathDefaults.set(platform, schema);
      }
      ts.forEachChild(node, visit);
    };
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === (platform ? "createPlatformOpenApi" : "pathParameters")
        && statement.body) visit(statement.body);
    }
  }
  const queryMap = variables.find(node => node.name.getText() === "querySchemas"
    && repositoryPath(source.root, node.getSourceFile().fileName) === "packages/platform-server/src/platform-openapi.ts");
  const queryReader = new StaticSchemaReader(source);
  const querySchemas = queryMap?.initializer ? queryReader.read(queryMap.initializer) : UNRESOLVED;
  const describeParameters = (node: ts.Expression, route: string, platform: boolean,
    fields: Record<string, ts.Expression | undefined>, maps: ts.Expression[]): Details => {
    const explicit = fields.parameters && describeRepositorySchema(source, fields.parameters, maps);
    const value = explicit?.schema;
    const issues = Array.isArray(explicit?.issues) ? explicit.issues.filter((issue): issue is string => typeof issue === "string") : [];
    if (explicit && explicit.status !== "indexed") issues.unshift("declared-parameters:source-reference");
    const parameters: SchemaValue[] = Array.isArray(value) ? value : [];
    const sources: DevelopmentSourceReference[] = explicit ? [sourceReference(fields.parameters!, source.root)] : [];
    // 公共生成器显式 parameters 覆盖推导列表，Rental 生成器仅补缺少的路径参数。
    const supportsRenderer = platform || repositoryPath(source.root, node.getSourceFile().fileName).startsWith("packages/rental-core/");
    const infer = supportsRenderer && (!fields.parameters || !platform && Array.isArray(value)
      && value.every(item => item !== null && typeof item === "object" && !Array.isArray(item)
        && typeof item.name === "string" && typeof item.in === "string"));
    if (infer) {
      const names = [...route.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
      const expression = pathDefaults.get(platform);
      const pathSchema = expression && describeRepositorySchema(source, expression, maps);
      for (const name of names) {
        if (parameters.some(item => item !== null && typeof item === "object" && !Array.isArray(item) && item.in === "path" && item.name === name)) continue;
        parameters.push({ name, in: "path", required: true,
          ...(pathSchema?.schema !== undefined ? { schema: pathSchema.schema } : {}) });
        if (expression) sources.push(sourceReference(expression, source.root));
        if (!pathSchema || pathSchema.status !== "indexed") issues.push(`path:${name}:source-reference`);
      }
      if (platform && fields.query) {
        const names = source.value(fields.query);
        if (!Array.isArray(names) || !names.every(name => typeof name === "string")) issues.push("query-names:source-reference");
        else for (const name of names as string[]) {
          const schema = querySchemas !== UNRESOLVED && querySchemas !== null && typeof querySchemas === "object" && !Array.isArray(querySchemas)
            ? querySchemas[name] : undefined;
          const pointer = `/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
          const gaps = [...queryReader.issues].filter(issue => issue.startsWith(pointer + "/") || issue.startsWith(pointer + ":") || issue.startsWith("/:"));
          parameters.push({ name, in: "query", required: false, ...(schema !== undefined ? { schema } : {}) });
          const location = queryReader.fields.get(pointer);
          if (location) sources.push(location);
          if (schema === undefined) issues.push(`query:${name}:not-indexed`);
          issues.push(...gaps.map(gap => `query:${name}:${gap}`));
        }
      }
    } else if (!platform && route.includes("{")) issues.push("path-parameter-overrides:source-reference");
    return { ...(explicit ?? {}), source: sourceReference(node, source.root), schema: parameters,
      sources: [...new Map(sources.map(location => [`${location.path}:${location.line}`, location])).values()],
      issues, status: issues.length ? "source-reference" : "indexed" };
  };
  const parameterDeclaration = (node: ts.ParameterDeclaration | ts.PropertyDeclaration): Details => {
    const reader = new StaticSchemaReader(source);
    const value = node.initializer && reader.read(node.initializer);
    return { source: sourceReference(node, source.root), name: node.name.getText(), optional: Boolean(node.questionToken),
      ...(node.type ? { declaredType: node.type.getText() } : {}),
      ...(node.initializer ? { defaultExpression: node.initializer.getText(),
        ...(value !== UNRESOLVED && value !== undefined ? { declaredDefault: value } : {}),
        defaultStatus: value === UNRESOLVED || reader.issues.size ? "source-reference" : "indexed", defaultIssues: [...reader.issues] } : {}),
      decorators: (ts.getDecorators(node) ?? []).map(decorator => ({ expression: decorator.expression.getText(), source: sourceReference(decorator, source.root) })) };
  };
  const attachController = (node: ts.ClassDeclaration) => {
    const controller = (ts.getDecorators(node) ?? []).find(decorator => ts.isCallExpression(decorator.expression)
      && decorator.expression.expression.getText() === "Controller");
    if (!controller || !ts.isCallExpression(controller.expression)) return;
    const prefix = controller.expression.arguments.length ? source.value(controller.expression.arguments[0]) : "";
    const prefixes = typeof prefix === "string" ? [prefix] : Array.isArray(prefix) && prefix.every(item => typeof item === "string") ? prefix as string[] : [];
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const parameters: Details[] = [], requestBodies: Details[] = [];
      for (const parameter of member.parameters) {
        for (const decorator of ts.getDecorators(parameter) ?? []) {
          if (!ts.isCallExpression(decorator.expression) || !["Query", "Param", "Body"].includes(decorator.expression.expression.getText())) continue;
          const name = source.value(decorator.expression.arguments[0]);
          const binding = decorator.expression.expression.getText() === "Query" ? "query" : "path";
          const type = parameter.type;
          const symbol = type && ts.isTypeReferenceNode(type) && source.checker.getSymbolAtLocation(type.typeName);
          const declaration = symbol && source.target(symbol).valueDeclaration;
          const dto = declaration && ts.isClassDeclaration(declaration) && isRepositorySourcePath(source.root, declaration.getSourceFile().fileName) ? declaration : undefined;
          const fields = dto?.members.filter(ts.isPropertyDeclaration).map(parameterDeclaration);
          const fieldNamesComplete = dto && !dto.typeParameters?.length
            && !dto.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
            && dto.members.length > 0 && dto.members.every(field => ts.isPropertyDeclaration(field)
              && ts.isIdentifier(field.name) && !(ts.getCombinedModifierFlags(field) & ts.ModifierFlags.Static));
          if (decorator.expression.expression.getText() === "Body") {
            requestBodies.push({ ...parameterDeclaration(parameter), binding: "body",
              ...(typeof name === "string" ? { field: name } : {}),
              ...(decorator.expression.arguments.length ? { bindingStatus: "source-reference" } : {}),
              ...(decorator.expression.arguments.length > 1 ? { pipesStatus: "source-reference" } : {}),
              ...(dto ? { declaration: sourceReference(dto, source.root),
                fields: dto.members.filter(field => ts.isPropertyDeclaration(field)
                  && !(ts.getCombinedModifierFlags(field) & ts.ModifierFlags.Static)).map(field => parameterDeclaration(field as ts.PropertyDeclaration)),
                fieldNamesStatus: fieldNamesComplete ? "indexed" : "source-reference" } : { fieldNamesStatus: "source-reference" }),
              status: "source-reference" });
            continue;
          }
          parameters.push({ ...parameterDeclaration(parameter), in: binding,
            ...(typeof name === "string" ? { parameterName: name } : { status: "source-reference" }),
            ...(decorator.expression.arguments.length > 1 ? { pipesStatus: "source-reference" } : {}),
            ...(dto ? { declaration: sourceReference(dto, source.root),
              fields, ...(binding === "query" && decorator.expression.arguments.length === 0
                ? { fieldNamesStatus: fieldNamesComplete ? "indexed" : "source-reference" } : {}) } : {}) });
        }
      }
      if (!parameters.length && !requestBodies.length) continue;
      for (const decorator of ts.getDecorators(member) ?? []) {
        if (!ts.isCallExpression(decorator.expression)) continue;
        const method = decorator.expression.expression.getText().toUpperCase();
        const suffix = decorator.expression.arguments.length ? source.value(decorator.expression.arguments[0]) : "";
        const suffixes = typeof suffix === "string" ? [suffix] : Array.isArray(suffix) && suffix.every(item => typeof item === "string") ? suffix as string[] : [];
        for (const prefix of prefixes) for (const suffix of suffixes) {
          const path = "/" + ["api", prefix, suffix].filter(Boolean).join("/").replace(/\/+/gu, "/").replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
          const key = `${method} ${path}`;
          let documentation = result.get(key);
          if (!documentation && requestBodies.length && ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
            documentation = { reference: sourceReference(member, source.root),
              details: { apiFieldsStatus: "source-reference",
                controllerSource: { source: sourceReference(member, source.root), issues: ["responseSchema:source-reference"] } } };
            result.set(key, documentation);
          }
          if (documentation && requestBodies.length) {
            // 原 DTO 类型/装饰器可定位字段，但不足以证明转换、校验或返回体完整。
            const bodies = documentation.details.controllerRequestBodies;
            documentation.details.controllerRequestBodies = [...(Array.isArray(bodies) ? bodies : []), ...requestBodies];
          }
          const openapi = documentation?.details.openapiSource;
          if (documentation && requestBodies.length) {
            const schemas = openapi && typeof openapi === "object" && !Array.isArray(openapi) ? openapi.schemas : undefined;
            if (!schemas || typeof schemas !== "object" || Array.isArray(schemas) || !schemas.requestSchema)
              documentation.details.apiFieldsStatus = "source-reference";
          }
          if (!parameters.length || !documentation || !openapi || typeof openapi !== "object" || Array.isArray(openapi)) continue;
          const controllers = Array.isArray(openapi.controllerParameters) ? openapi.controllerParameters : [];
          controllers.push({ source: sourceReference(member, source.root), parameters });
          openapi.controllerParameters = controllers;
          const schemas = openapi.schemas;
          const description = schemas && typeof schemas === "object" && !Array.isArray(schemas) ? schemas.parameters : undefined;
          if (!description || typeof description !== "object" || Array.isArray(description)) continue;
          const described = Array.isArray(description.schema) ? description.schema : [];
          const issues = Array.isArray(description.issues) ? description.issues : [];
          for (const parameter of parameters) {
            // DTO 只用于对应已有查询声明，不从类型或装饰器补造另一份 schema。
            const fields = parameter.fieldNamesStatus === "indexed" && Array.isArray(parameter.fields) ? parameter.fields : undefined;
            for (const declaration of fields ?? [parameter]) {
              if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) continue;
              const name = fields ? declaration.name : declaration.parameterName;
              if (typeof name !== "string") issues.push(`controller:${parameter.in}:source-reference`);
              else if (!described.some(item => item && typeof item === "object" && !Array.isArray(item)
                && item.in === parameter.in && item.name === name)) issues.push(`controller:${parameter.in}:${name}:not-indexed`);
              if (declaration.defaultStatus === "source-reference") issues.push(`controller:${parameter.in}:${name ?? "object"}:default-source-reference`);
            }
            if (fields && parameter.defaultStatus === "source-reference") issues.push(`controller:${parameter.in}:object:default-source-reference`);
            if (parameter.pipesStatus === "source-reference") issues.push(`controller:${parameter.in}:${parameter.parameterName ?? "object"}:pipes-source-reference`);
          }
          description.issues = [...new Set(issues)];
          if (issues.length) {
            description.status = "source-reference";
            documentation.details.apiFieldsStatus = "source-reference";
            const missing = Array.isArray(openapi.issues) ? openapi.issues : [];
            if (!missing.includes("parameters:source-reference")) missing.push("parameters:source-reference");
            openapi.issues = missing;
          }
        }
      }
    }
  };
  const describe = (node: ts.Expression, method: unknown, path: unknown, fields: Record<string, ts.Expression | undefined>) => {
    if (typeof method !== "string" || typeof path !== "string" || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return;
    const file = repositoryPath(source.root, node.getSourceFile().fileName);
    const packageDirectory = file.split("/").slice(0, 2).join("/");
    const platform = packageDirectory === "packages/platform-server";
    const route = platform ? `/api${path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}` : path;
    const key = `${method.toUpperCase()} ${route}`;
    if (result.has(key)) return;
    const ownMaps = schemaMaps.filter(map => repositoryPath(source.root, map.getSourceFile().fileName).startsWith(packageDirectory + "/"));
    const aggregateMaps = ownMaps.filter(map => map.name.getText() === (platform ? "PLATFORM_OPENAPI_SCHEMAS" : "RENTAL_HTTP_COMPONENT_SCHEMAS"));
    const componentMaps = ownMaps.filter(map => map.name.getText().endsWith("COMPONENT_SCHEMAS"));
    const maps = (aggregateMaps.length ? aggregateMaps : componentMaps.length ? componentMaps : ownMaps).map(map => map.name as ts.Identifier);
    const schemas = Object.fromEntries(["requestSchema", "responseSchema", "parameters"].flatMap(name => {
      const expression = fields[name];
      return expression ? [[name, describeRepositorySchema(source, expression, maps, platform ? "Platform." : "")]] : [];
    }));
    const parameters = describeParameters(node, route, platform, fields, maps);
    schemas.parameters = parameters;
    const summary = source.value(fields.summary), id = source.value(fields.id);
    const operationId = platform && typeof id === "string" ? `Platform.${id}` : source.value(fields.operationId);
    const missing = Object.entries(schemas).filter(([, value]) => value.status === "not-indexed").map(([name]) => `${name}:not-indexed`);
    if (!fields.responseSchema) missing.push("responseSchema:source-reference");
    if (parameters.status !== "indexed") missing.push("parameters:source-reference");
    const hasFields = Boolean(fields.requestSchema || fields.responseSchema || fields.parameters)
      || Array.isArray(parameters.schema) && parameters.schema.length > 0;
    result.set(key, { reference: sourceReference(node, source.root),
      ...(typeof summary === "string" ? { summary } : {}), ...(typeof operationId === "string" ? { operationId } : {}),
      details: { apiFieldsStatus: !hasFields ? "not-indexed"
        : missing.length || Object.values(schemas).some(schema => schema.status !== "indexed") ? "source-reference" : "indexed",
        openapiSource: { source: { ...sourceReference(node, source.root) }, schemas,
          issues: missing } } });
  };
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      describe(node, source.value(property(node, "method")), source.value(property(node, "path")),
        { ...Object.fromEntries(["summary", "operationId", "id", "parameters", "query"].map(name => [name, property(node, name)])),
          requestSchema: property(node, "requestSchema") ?? property(node, "request"),
          responseSchema: property(node, "responseSchema") ?? property(node, "response") });
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
  for (const file of source.program.getSourceFiles()) {
    if (file.isDeclarationFile || !isRepositorySourcePath(source.root, file.fileName)) continue;
    for (const statement of file.statements) {
      if (ts.isClassDeclaration(statement)) attachController(statement);
    }
  }
  return result;
}
