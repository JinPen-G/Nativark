/**
 * 静态 HTTP/OpenAPI 声明的字段定位。只读取原 AST、符号和本地引用。
 * 字面量、有限数字加减及单一返回表达式按原语法读取，不执行模块、生成器或校验器。
 * 操作表的同步数组映射沿原标量、元组和数据成员绑定，字段与路由仍连接实际 Controller。
 * 本地纯声明的 const 绑定与 entries 原值映射保留原键顺序、命名空间及字段出处。
 * 未解析循环聚合附所选原输入和转换出处，最终输出继续保留原缺口状态。
 * 显式错误响应连接原状态码、说明和 schema 引用，字段资料各自保留来源状态。
 * 请求选项沿外层展开保留必填、媒体类型及编码的原值，生成器条件和缺省单独定位。
 * 响应选项保留原值和默认表达式，渲染声明单独定位原覆盖顺序及宿主转换边界。
 * 页面组件映射仅绑定受限局部声明，组件体和宿主上下文保持未解析来源。
 * 成员写入复用常量归属，所选对象保留确定字段及受影响子字段的准确缺口。
 * DTO 请求字段只定位原类型和装饰器，不推导校验或响应 schema。Zod 转换和动态表达式保留来源。
 */
import ts from "typescript";
import type { DevelopmentCapability, DevelopmentSourceReference } from "./development";
import { RepositorySource, UNRESOLVED, controllerMembers, isRepositorySourcePath, repositoryPath, sourceReference } from "./repository-source";

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
type ExpressionBinding = { expression: ts.Expression; bindings: Map<ts.Symbol, ExpressionBinding>; seen: Set<ts.Node>;
  staticValue?: string; elements?: ExpressionBinding[]; localDeclarations?: ts.VariableDeclaration[]; mutations?: ObjectMutation[] };
type ObjectWrites = { keys: Set<string>; unknown: boolean; unsafe: boolean; frozen: boolean };
type ObjectMutation = { node: ts.Node; members?: (string | undefined)[]; sources?: ts.Expression[] };
const objectMutationIndexes = new WeakMap<RepositorySource, Map<ts.VariableDeclaration, ObjectMutation[]>>();
type SchemaInputBinding = { binding: ExpressionBinding; assignment: ts.BinaryExpression; transformations: ts.CallExpression[] };
const schemaInputIndexes = new WeakMap<RepositorySource, Map<ts.BinaryExpression, Map<string, SchemaInputBinding[]>>>();
const schemaInputDescriptions = new WeakMap<ExpressionBinding, string>();

/** 只解释纯声明语法。未知展开会遮蔽前面的属性，不能保留可能被覆盖的旧字段。 */
class StaticSchemaReader {
  readonly issues = new Set<string>();
  readonly fields = new Map<string, DevelopmentSourceReference>();
  readonly literalMaps = new Set<ts.CallExpression>();
  readonly mappedObjects = new Set<ts.ObjectLiteralExpression>();
  readonly compositions = new Set<ts.Node>();
  private readonly partialObjects = new WeakSet<object>();
  private readonly objectWrites = new WeakMap<object, ObjectWrites>();

  constructor(private readonly source: RepositorySource, private readonly readBudget?: { remaining: number }) {}

  private withinReadLimit(): boolean {
    return !this.readBudget || this.readBudget.remaining-- > 0;
  }

  schema(expression: ts.Expression, bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>(), mutations?: ObjectMutation[]): SchemaValue | typeof UNRESOLVED {
    const value = this.readBinding({ expression, bindings, seen, mutations });
    if (this.readBudget && this.readBudget.remaining < 0) this.issues.add("/:static-read-limit");
    if (value !== UNRESOLVED && value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (value.type === "object" && value.additionalProperties === true && !value.properties) this.issues.add("/:unspecified-object-fields");
      if (value["x-schemaStatus"] === "incomplete" || Array.isArray(value["x-schemaGaps"]) && value["x-schemaGaps"].length)
        this.issues.add("/:declared-schema-gap");
    }
    return value;
  }

  member(expression: ts.Expression, name: string | string[], bindings = new Map<ts.Symbol, ExpressionBinding>(),
    seen = new Set<ts.Node>()): ExpressionBinding | typeof UNRESOLVED | undefined {
    return this.selectMember(expression, Array.isArray(name) ? name : [name], bindings, seen);
  }

  /** 操作列表沿原数组和数据属性枚举绑定，映射体保持 AST，不调用生成器。
   * 元组和展开按原位置读取，map 的稀疏接收数组按原语义跳过空位。 */
  arrayBindings(expression: ts.Expression, bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>(), preservePositions = false): ExpressionBinding[] | undefined {
    if (!this.withinReadLimit()) return;
    const node = unwrap(expression);
    if (seen.has(node) || seen.size > 80) return;
    const chain = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const symbol = this.source.checker.getSymbolAtLocation(node), binding = symbol && bindings.get(symbol);
      if (binding) return binding.elements ?? this.arrayBindings(binding.expression, binding.bindings, binding.seen, preservePositions);
      const target = this.constTarget(node);
      if (target?.initializer && !this.objectMutations(target, node).length)
        return this.arrayBindings(target.initializer, bindings, chain, preservePositions);
    }
    if (ts.isArrayLiteralExpression(node)) {
      const items: ExpressionBinding[] = [];
      for (const element of node.elements) {
        if (ts.isOmittedExpression(element)) {
          if (preservePositions) return;
          continue;
        }
        if (ts.isSpreadElement(element)) {
          const parts = this.arrayBindings(element.expression, bindings, chain, true);
          if (!parts) return;
          items.push(...parts);
        } else items.push({ expression: element, bindings, seen: chain });
      }
      return items;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : this.read(node.argumentExpression, "", bindings, chain);
      if (typeof key !== "string" && typeof key !== "number") return;
      const selected = this.selectMember(node.expression, [String(key)], bindings, chain);
      if (selected && selected !== UNRESOLVED)
        return selected.elements ?? this.arrayBindings(selected.expression, selected.bindings, selected.seen, preservePositions);
    }
    if (!ts.isCallExpression(node)) return;
    if (["entries", "values"].some(method => this.objectCall(node, method)) && node.arguments.length === 1
      && !ts.isSpreadElement(node.arguments[0])) {
      const guard = new StaticSchemaReader(this.source, this.readBudget), table = guard.read(node.arguments[0], "", bindings, chain);
      const writes = table !== UNRESOLVED && table !== null && typeof table === "object" ? guard.objectWrites.get(table) : undefined;
      if (!writes || writes.unknown || writes.unsafe || Array.isArray(table)) return;
      const enumerable: Record<string, null> = Object.create(null);
      for (const key of writes.keys) enumerable[key] = null;
      const items: ExpressionBinding[] = [];
      for (const key of Object.keys(enumerable)) {
        const selected = this.selectMember(node.arguments[0], [key], bindings, chain);
        if (!selected || selected === UNRESOLVED) return;
        items.push(this.objectCall(node, "values") ? selected : { expression: node, bindings, seen: chain,
          elements: [{ expression: node, staticValue: key, bindings, seen: chain }, selected] });
      }
      return items;
    }
    const callback = this.arrayCallback(node);
    if (callback && this.pureExpression(callback.body)) {
      const method = (node.expression as ts.PropertyAccessExpression).name.text;
      const items = this.arrayBindings((node.expression as ts.PropertyAccessExpression).expression, bindings, chain, preservePositions && method === "map");
      if (!items) return;
      const result: ExpressionBinding[] = [];
      for (const item of items) {
        const scope = new Map(bindings), name = callback.parameters[0].name;
        if (ts.isIdentifier(name)) {
          const symbol = this.source.checker.getSymbolAtLocation(name);
          if (!symbol) return;
          scope.set(symbol, item);
        } else {
          const elements = item.elements ?? this.arrayBindings(item.expression, item.bindings, item.seen, true);
          if (!elements) return;
          for (const [index, element] of (name as ts.ArrayBindingPattern).elements.entries()) {
            if (ts.isOmittedExpression(element)) continue;
            const symbol = this.source.checker.getSymbolAtLocation(element.name);
            if (!symbol || !elements[index]) return;
            scope.set(symbol, elements[index]);
          }
        }
        const body = callback.body as ts.Expression;
        if (method === "map")
          result.push({ expression: body, bindings: scope, seen: chain });
        else {
          const parts = this.arrayBindings(body, scope, chain);
          if (parts) result.push(...parts);
          else if (ts.isObjectLiteralExpression(unwrap(body))) result.push({ expression: body, bindings: scope, seen: chain });
          else return;
        }
      }
      this.compositions.add(node);
      this.compositions.add(callback);
      return result;
    }
  }


  /** 有限循环只定位转换实参的原声明，循环和转换的执行结果继续由缺口状态表示。 */
  schemaInputs(name: string): SchemaInputBinding[] {
    let index = schemaInputIndexes.get(this.source);
    if (!index) {
      index = new Map();
      schemaInputIndexes.set(this.source, index);
    }
    const result: SchemaInputBinding[] = [];
    const lookupBudget = { remaining: 4096 };
    for (const node of [...this.compositions]) {
      if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
        || !ts.isElementAccessExpression(node.left) || !node.left.argumentExpression) continue;
      let names = index.get(node);
      if (!names) {
        names = new Map();
        index.set(node, names);
      }
      let inputs = names.get(name);
      if (!inputs) {
        inputs = [];
        names.set(name, inputs);
        const locator = new StaticSchemaReader(this.source, lookupBudget);
        for (const scope of locator.loopScopes(node, name)) {
          if (new StaticSchemaReader(this.source, lookupBudget).read(node.left.argumentExpression, "", scope) !== name) continue;
          const collect = (expression: ts.Expression, transformations: ts.CallExpression[]) => {
            if (!locator.withinReadLimit() || transformations.length > 80) return;
            const input = unwrap(expression);
            if (ts.isCallExpression(input)) {
              for (const argument of input.arguments) {
                if (!ts.isSpreadElement(argument)) collect(argument, [...transformations, input]);
              }
              return;
            }
            const symbol = ts.isIdentifier(input) && this.source.checker.getSymbolAtLocation(input);
            let binding = symbol ? scope.get(symbol) : undefined;
            if (ts.isPropertyAccessExpression(input) || ts.isElementAccessExpression(input)) {
              const member = ts.isPropertyAccessExpression(input) ? input.name.text
                : new StaticSchemaReader(this.source, lookupBudget).read(input.argumentExpression, "", scope);
              const selected = typeof member === "string" || typeof member === "number"
                ? locator.selectMember(input.expression, [String(member)], scope, new Set()) : undefined;
              if (selected && selected !== UNRESOLVED) binding = selected;
            }
            if (binding && binding.staticValue === undefined && !binding.elements)
              inputs!.push({ binding, assignment: node, transformations });
          };
          collect(node.right, []);
        }
      }
      result.push(...inputs);
    }
    return result;
  }

  private loopScopes(node: ts.BinaryExpression, selectedName: string): Map<ts.Symbol, ExpressionBinding>[] {
    const loops: ts.ForOfStatement[] = [];
    for (let parent: ts.Node | undefined = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isFunctionLike(parent)) return [];
      if (ts.isForOfStatement(parent)) loops.unshift(parent);
    }
    if (!loops.length || !ts.isElementAccessExpression(node.left) || !node.left.argumentExpression) return [];
    let scopes = [new Map<ts.Symbol, ExpressionBinding>()];
    for (const loop of loops) {
      if (loop.awaitModifier || !ts.isVariableDeclarationList(loop.initializer)
        || !(loop.initializer.flags & ts.NodeFlags.Const) || loop.initializer.declarations.length !== 1) return [];
      const declaration = loop.initializer.declarations[0];
      const name = declaration.name;
      if (declaration.initializer || !ts.isIdentifier(name) && !(ts.isArrayBindingPattern(name)
        && name.elements.every(element => ts.isOmittedExpression(element) || ts.isBindingElement(element)
          && ts.isIdentifier(element.name) && !element.initializer && !element.dotDotDotToken))) return [];
      const iterable = unwrap(loop.expression);
      const key = ts.isArrayBindingPattern(name) && name.elements[0];
      const keySymbol = key && ts.isBindingElement(key) && this.source.checker.getSymbolAtLocation(key.name);
      const output = unwrap(node.left.argumentExpression);
      let inputName: string | undefined;
      if (keySymbol && ts.isIdentifier(output) && this.source.checker.getSymbolAtLocation(output) === keySymbol)
        inputName = selectedName;
      else if (keySymbol && ts.isTemplateExpression(output) && output.templateSpans.length === 1
        && this.source.checker.getSymbolAtLocation(output.templateSpans[0].expression) === keySymbol
        && selectedName.startsWith(output.head.text) && selectedName.endsWith(output.templateSpans[0].literal.text))
        inputName = selectedName.slice(output.head.text.length, output.templateSpans[0].literal.text.length ? -output.templateSpans[0].literal.text.length : undefined);
      const next: Map<ts.Symbol, ExpressionBinding>[] = [];
      for (const scope of scopes) {
        let items: ExpressionBinding[] | undefined;
        if (inputName !== undefined && ts.isCallExpression(iterable) && this.objectCall(iterable, "entries")
          && iterable.arguments.length === 1 && !ts.isSpreadElement(iterable.arguments[0])) {
          // 所选键复用最后覆盖守卫。未知表项不会阻止定位它后面的明确声明。
          const member = this.selectMember(iterable.arguments[0], [inputName], scope, new Set());
          items = member && member !== UNRESOLVED ? [{ expression: iterable, bindings: scope, seen: new Set(),
            elements: [{ expression: iterable, staticValue: inputName, bindings: scope, seen: new Set() }, member] }] : [];
        } else items = this.arrayBindings(loop.expression, scope);
        if (!items || next.length + items.length > 2048) return [];
        for (const item of items) {
          const bound = new Map(scope);
          if (ts.isIdentifier(name)) {
            const symbol = this.source.checker.getSymbolAtLocation(name);
            if (!symbol) return [];
            bound.set(symbol, item);
          } else {
            const elements = item.elements ?? this.arrayBindings(item.expression, item.bindings, item.seen, true);
            if (!elements) return [];
            for (const [position, element] of name.elements.entries()) {
              if (ts.isOmittedExpression(element)) continue;
              const symbol = this.source.checker.getSymbolAtLocation(element.name);
              if (!symbol || !elements[position]) return [];
              bound.set(symbol, elements[position]);
            }
          }
          next.push(bound);
        }
      }
      scopes = next;
    }
    return scopes;
  }

  private arrayCallback(node: ts.CallExpression): ts.ArrowFunction | undefined {
    if (!ts.isPropertyAccessExpression(node.expression) || !["map", "flatMap"].includes(node.expression.name.text)
      || node.arguments.length !== 1 || ts.isSpreadElement(node.arguments[0])) return;
    const callback = unwrap(node.arguments[0]);
    if (!ts.isArrowFunction(callback) || callback.modifiers?.length || callback.parameters.length !== 1
      || callback.parameters[0].initializer || callback.parameters[0].dotDotDotToken || ts.isBlock(callback.body)) return;
    const name = callback.parameters[0].name;
    if (!ts.isIdentifier(name) && !(ts.isArrayBindingPattern(name) && name.elements.every(element => ts.isOmittedExpression(element)
      || ts.isBindingElement(element) && ts.isIdentifier(element.name) && !element.initializer && !element.dotDotDotToken))) return;
    return callback;
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

  /** 只保留当前已跟踪且自身或子字段仍有缺口的属性，不从整表 AST 补造出处。 */
  unresolvedFieldSources(): Array<{ pointer: string; source: DevelopmentSourceReference }> {
    // 指针中的键可以含冒号，缺口原因由最后一个冒号分隔。
    const locations = [...this.issues].map(issue => issue.slice(0, issue.lastIndexOf(":")));
    return [...this.fields].filter(([pointer]) => locations.some(location => location === pointer || location.startsWith(pointer + "/")))
      .map(([pointer, location]) => ({ pointer, source: location }));
  }

  read(expression: ts.Expression, pointer = "", bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>(), selectiveMembers = false): SchemaValue | typeof UNRESOLVED {
    if (!this.withinReadLimit()) return this.unresolved(pointer, "static-read-limit");
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
      if (binding) return this.readBinding(binding, pointer, selectiveMembers);
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
        if (value === UNRESOLVED || value === null || typeof value !== "object") return value;
        const mutations = this.objectMutations(constant, node);
        if (Array.isArray(value)) {
          if (!mutations.length) return value;
          this.clearFields(pointer);
          return this.unresolved(pointer, "dynamic-array-write");
        }
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
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const left = unwrap(node.left);
      if (ts.isIdentifier(left) && left.text === "undefined" && !this.source.checker.getSymbolAtLocation(left)?.declarations?.length)
        return read(node.right);
      if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
        const key = ts.isPropertyAccessExpression(left) ? left.name.text : left.argumentExpression && read(left.argumentExpression);
        if ((typeof key === "string" || typeof key === "number") && !Object.hasOwn(Object.prototype, key)
          && this.selectMember(left.expression, [String(key)], bindings, chain) === undefined) {
          const guard = new StaticSchemaReader(this.source, this.readBudget);
          const object = guard.read(left.expression, "", bindings, chain);
          const writes = object !== UNRESOLVED && object !== null && typeof object === "object" ? guard.objectWrites.get(object) : undefined;
          if (writes && !writes.unknown && !writes.unsafe && !writes.keys.has("__proto__")) return read(node.right);
        }
      }
      const value = read(node.left);
      // 已证明缺少的自有成员及 null 采用原后备值，未知覆盖仍保留缺口。
      return value === UNRESOLVED ? this.unresolved(pointer, "dynamic-nullish") : value === null ? read(node.right) : value;
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
        if (selected && selected !== UNRESOLVED) return this.readBinding(selected, pointer, selectiveMembers);
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
          && !callback.parameters[0].dotDotDotToken) {
          const symbol = this.source.checker.getSymbolAtLocation(callback.parameters[0].name);
          let items: ExpressionBinding[] | undefined;
          if (ts.isArrayLiteralExpression(list) && list.elements.every(ts.isStringLiteralLike))
            items = list.elements.map(expression => ({ expression, bindings, seen: chain }));
          else if (ts.isCallExpression(list) && this.objectCall(list, "values") && list.arguments.length === 1 && !ts.isSpreadElement(list.arguments[0])) {
            // 沿已有对象覆盖/写入守卫核定枚举集合，回调参数仍绑定原成员 AST，不执行工厂。
            const guard = new StaticSchemaReader(this.source, this.readBudget), table = guard.read(list.arguments[0], "", bindings, chain);
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
              let body = callback.body;
              if (ts.isBlock(body)) {
                // 只接纳组件表选择、局部箭头组件与唯一直接返回；不解释一般语句或执行组件体。
                const [lookup, local, returned] = body.statements;
                if (body.statements.length !== 3 || !ts.isVariableStatement(lookup) || !ts.isVariableStatement(local)
                  || !(lookup.declarationList.flags & ts.NodeFlags.Const) || !(local.declarationList.flags & ts.NodeFlags.Const)
                  || lookup.declarationList.declarations.length !== 1 || local.declarationList.declarations.length !== 1
                  || !ts.isReturnStatement(returned) || !returned.expression) return this.unresolved(pointer, "dynamic-map-body");
                const content = lookup.declarationList.declarations[0], page = local.declarationList.declarations[0];
                const access = content.initializer && unwrap(content.initializer), component = page.initializer && unwrap(page.initializer);
                const result = unwrap(returned.expression);
                if (!ts.isIdentifier(content.name) || !ts.isIdentifier(page.name) || !access || !ts.isElementAccessExpression(access)
                  || !access.argumentExpression || !component || !ts.isArrowFunction(component) || component.modifiers?.length
                  || component.parameters.length || !ts.isObjectLiteralExpression(result) || result.properties.length !== 2
                  || !ts.isSpreadAssignment(result.properties[0]) || !ts.isIdentifier(result.properties[0].expression)
                  || this.source.checker.getSymbolAtLocation(result.properties[0].expression) !== symbol
                  || !ts.isPropertyAssignment(result.properties[1]) || result.properties[1].name.getText().replace(/^["']|["']$/g, "") !== "component"
                  || !ts.isIdentifier(result.properties[1].initializer)) return this.unresolved(pointer, "dynamic-map-body");
                const contentSymbol = this.source.checker.getSymbolAtLocation(content.name), pageSymbol = this.source.checker.getSymbolAtLocation(page.name);
                if (!contentSymbol || !pageSymbol || this.source.checker.getSymbolAtLocation(result.properties[1].initializer) !== pageSymbol)
                  return this.unresolved(pointer, "dynamic-map-body");
                const guard = new StaticSchemaReader(this.source, this.readBudget), table = guard.read(access.expression, "", scope, chain);
                const writes = table !== UNRESOLVED && table !== null && typeof table === "object" ? guard.objectWrites.get(table) : undefined;
                for (const composition of guard.compositions) this.compositions.add(composition);
                const key = guard.read(access.argumentExpression, "", scope, chain);
                // 组件值本身保持源码引用；键集合、覆盖和写入必须可证明，访问器不会被调用。
                if (!writes || writes.unknown || writes.unsafe || typeof key !== "string" || !writes.keys.has(key))
                  return this.unresolved(pointer, "dynamic-map-component-table");
                const selected = this.selectMember(access.expression, [key], scope, chain);
                const reference = selected && selected !== UNRESOLVED && unwrap(selected.expression);
                const targetSymbol = reference && ts.isIdentifier(reference) && this.source.checker.getSymbolAtLocation(reference);
                const target = targetSymbol && this.source.target(targetSymbol).valueDeclaration;
                const targetValue = target && ts.isVariableDeclaration(target) && target.initializer ? unwrap(target.initializer) : target;
                if (!selected || selected === UNRESOLVED || !target || !isRepositorySourcePath(this.source.root, target.getSourceFile().fileName)
                  || !targetValue || !(ts.isFunctionDeclaration(targetValue) || ts.isArrowFunction(targetValue) || ts.isFunctionExpression(targetValue)))
                  return this.unresolved(pointer, "dynamic-map-component-reference");
                scope.set(contentSymbol, selected);
                scope.set(pageSymbol, { expression: component, bindings: new Map(scope), seen: chain });
                body = returned.expression;
              }
              const part = this.read(body, `${pointer}/${value.length}`, scope, chain, true);
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
      if (body && (!body.localDeclarations?.length || this.pureCall(node)))
        return this.read(body.expression, pointer, body.bindings, body.seen, selectiveMembers);
      return this.unresolved(pointer, "runtime-call");
    }
    return this.unresolved(pointer, "unsupported-expression");
  }

  /** 只移除所选对象中受影响的字段，原字段位置和未知写入继续留作缺口。 */
  private readBinding(binding: ExpressionBinding, pointer = "", selectiveMembers = false): SchemaValue | typeof UNRESOLVED {
    let value: SchemaValue | typeof UNRESOLVED;
    if (binding.elements) {
      const elements: SchemaValue[] = [];
      for (const [index, element] of binding.elements.entries()) {
        const item = this.readBinding(element, `${pointer}/${index}`, selectiveMembers);
        if (item === UNRESOLVED) return UNRESOLVED;
        elements.push(item);
      }
      value = elements;
    } else value = binding.staticValue ?? this.read(binding.expression, pointer, binding.bindings, binding.seen, selectiveMembers);
    if (!binding.mutations?.length) return value;
    if (value === UNRESOLVED || value === null || typeof value !== "object" || Array.isArray(value)
      || binding.mutations.some(mutation => !mutation.members?.length || mutation.members.includes(undefined))) {
      this.clearFields(pointer);
      return this.unresolved(pointer, "dynamic-object-write");
    }
    for (const mutation of binding.mutations) {
      this.compositions.add(mutation.node);
      let object = value as Record<string, SchemaValue>;
      let location = pointer;
      for (const [index, key] of (mutation.members as string[]).entries()) {
        location += "/" + key.replaceAll("~", "~0").replaceAll("/", "~1");
        const child = object[key];
        // 数组成员失效时移除该数组字段，避免缺项数组被当成完整静态值。
        if (index === mutation.members!.length - 1 || child === null || typeof child !== "object" || Array.isArray(child)) {
          delete object[key];
          this.clearFields(location);
          this.unresolved(location, "dynamic-object-write");
          this.partialObjects.add(object);
          break;
        }
        object = child;
      }
      this.partialObjects.add(value);
    }
    return value;
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

  /** 顶层 assign 保留原顺序，其他写入按共同归属定位重叠成员。 */
  private objectMutations(target: ts.VariableDeclaration, usage: ts.Identifier, selectedMembers: readonly string[] = []): ObjectMutation[] {
    let index = objectMutationIndexes.get(this.source);
    if (!index) {
      index = new Map();
      objectMutationIndexes.set(this.source, index);
      const add = (node: ts.Node, expression: ts.Expression, sources?: ts.Expression[], referenceOnly = false, members: (string | undefined)[] = []) => {
        let reference = this.source.constantOwner(expression);
        if (reference) reference = { declaration: reference.declaration, members: reference.members && [...reference.members, ...members] };
        if (referenceOnly && reference) {
          const value = this.source.value(expression);
          if (value !== UNRESOLVED && (value === null || typeof value !== "object")) return;
        }
        const seen = new Set<ts.VariableDeclaration>();
        while (reference && !seen.has(reference.declaration)) {
          if (referenceOnly && this.source.isPrimitiveMember(reference)) return;
          seen.add(reference.declaration);
          const entries = index!.get(reference.declaration) ?? [];
          entries.push({ node, members: reference.members, ...(sources ? { sources } : {}) });
          index!.set(reference.declaration, entries);
          const initializer = reference.declaration.initializer && unwrap(reference.declaration.initializer);
          const parent = initializer && (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer))
            ? this.source.constantOwner(initializer) : undefined;
          reference = parent && { declaration: parent.declaration, members: parent.members && reference.members
            ? [...parent.members, ...reference.members] : undefined };
          sources = undefined;
        }
      };
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const reference = node.arguments?.[0] && this.source.constantOwner(node.arguments[0]);
          if (reference && ts.isCallExpression(node) && this.objectCall(node, "assign")) {
            const direct = unwrap(node.arguments[0]);
            const topLevel = ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent);
            const local = node.getSourceFile() === reference.declaration.getSourceFile();
            add(node, node.arguments[0], ts.isIdentifier(direct) && topLevel && local && node.getStart() > reference.declaration.getStart()
              && !node.arguments.some(ts.isSpreadElement) ? [...node.arguments.slice(1)] : undefined);
          } else if (!(ts.isCallExpression(node)
            && (["assign", "keys", "values", "entries", "hasOwn"].some(method => this.objectCall(node, method)) || this.pureCall(node)))) {
            for (const [argumentIndex, argument] of (node.arguments ?? []).entries()) {
              const uses = ts.isCallExpression(node) ? this.source.callArgumentUses(node, argumentIndex) : undefined;
              if (uses) for (const use of uses) add(node, argument, undefined, use.referenceOnly, use.members);
              else add(node, argument, undefined, true);
            }
            if ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
              && !(ts.isCallExpression(node) && this.source.arrayCallPreservesReceiver(node)))
              add(node, node.expression.expression, undefined, true);
          }
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) add(node, node.left);
        else if (ts.isDeleteExpression(node) || (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
          && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) add(node, ts.isDeleteExpression(node) ? node.expression : node.operand);
        else if (ts.isVariableDeclaration(node) && node.initializer && ts.isVariableDeclarationList(node.parent)
          && !(node.parent.flags & ts.NodeFlags.Const)) add(node, node.initializer, undefined, true);
        ts.forEachChild(node, visit);
      };
      for (const file of this.source.program.getSourceFiles()) {
        if (!file.isDeclarationFile && isRepositorySourcePath(this.source.root, file.fileName)) visit(file);
      }
    }
    const deferred = (node: ts.Node) => {
      for (let current: ts.Node | undefined = node; current && !ts.isSourceFile(current); current = current.parent)
        if (ts.isFunctionLike(current)) return true;
      return false;
    };
    let statement: ts.Node = usage;
    while (statement.parent && !ts.isSourceFile(statement.parent)) statement = statement.parent;
    const finalName = ts.isVariableDeclaration(usage.parent) && usage.parent.name === usage;
    const cutoff = finalName || usage.getSourceFile() !== target.getSourceFile() ? Infinity : statement.end;
    // 已确定的其他成员不受影响，同语句、跨模块和延迟写入仍不能重放时序。
    const current = (index.get(target) ?? []).filter(mutation => {
      const members = mutation.members;
      const overlaps = !selectedMembers.length || !members || members.slice(0, Math.min(members.length, selectedMembers.length))
        .every((key, index) => key === undefined || key === selectedMembers[index]);
      return overlaps && (deferred(usage) || deferred(mutation.node)
        || mutation.node.getSourceFile() !== target.getSourceFile() || mutation.node.getStart() < cutoff);
    });
    for (const mutation of current) this.compositions.add(mutation.node);
    return current.map(mutation => deferred(usage) || deferred(mutation.node) ? { node: mutation.node, members: mutation.members } : mutation);
  }

  private pureCall(node: ts.CallExpression, seen = new Set<ts.Node>()): boolean {
    if (!this.withinReadLimit()) return false;
    const body = this.callBody(node, new Map(), new Set());
    if (!body || seen.has(body.expression) || seen.size > 80) return false;
    const chain = new Set(seen).add(body.expression);
    if (!this.pureExpression(body.expression, chain)) return false;
    for (const binding of body.bindings.values())
      if (!node.arguments.includes(binding.expression) && !this.pureExpression(binding.expression, chain)) return false;
    // 实参先于本次调用体求值，沿调用方的递归链核对。
    return node.arguments.every(argument => this.pureExpression(argument, seen));
  }

  private pureExpression(expression: ts.Node, seen = new Set<ts.Node>()): boolean {
    if (!this.withinReadLimit()) return false;
    let pure = true;
    const visit = (part: ts.Node, callSeen = seen) => {
      if (ts.isCallExpression(part) && !["keys", "values", "entries", "hasOwn"].some(method => this.objectCall(part, method))
        && !this.entryMapping(part) && !this.arrayCallback(part)
        && !(this.objectCall(part, "assign") && part.arguments.length && this.plainLiteral(part.arguments[0])) && !this.pureCall(part, callSeen)
        || ts.isNewExpression(part) || ts.isDeleteExpression(part)
        || ts.isBinaryExpression(part) && part.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && part.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        || (ts.isPrefixUnaryExpression(part) || ts.isPostfixUnaryExpression(part))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(part.operator)) pure = false;
      if (pure) ts.forEachChild(part, child => visit(child, callSeen));
    };
    visit(expression);
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
      || !isRepositorySourcePath(this.source.root, callable.getSourceFile().fileName)
      || node.arguments.some(ts.isSpreadElement)
      || !callable.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.dotDotDotToken)) return;
    const scope = new Map(bindings);
    callable.parameters.forEach((parameter, index) => {
      const name = this.source.checker.getSymbolAtLocation(parameter.name), argument = node.arguments[index];
      if (name && (argument || parameter.initializer)) scope.set(name, { expression: argument ?? parameter.initializer!, bindings: argument ? bindings : scope, seen });
    });
    let body: ts.Expression;
    const localDeclarations: ts.VariableDeclaration[] = [];
    if (ts.isBlock(callable.body)) {
      const returned = callable.body.statements[callable.body.statements.length - 1];
      if (!returned || !ts.isReturnStatement(returned) || !returned.expression) return;
      for (const statement of callable.body.statements.slice(0, -1)) {
        if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return;
          const name = this.source.checker.getSymbolAtLocation(declaration.name);
          if (!name) return;
          scope.set(name, { expression: declaration.initializer, bindings: new Map(scope), seen });
          localDeclarations.push(declaration);
        }
      }
      body = returned.expression;
      if (localDeclarations.length) this.compositions.add(callable);
    } else body = callable.body;
    return { expression: body, bindings: scope, seen, ...(localDeclarations.length ? { localDeclarations } : {}) };
  }

  /** entries 的二元局部绑定按原值定位，无法核定的映射保留源码缺口。 */
  private entryMapping(node: ts.CallExpression): { table: ts.Expression; callback: ts.ArrowFunction;
    key: ts.BindingElement; value: ts.BindingElement; keyExpression: ts.Expression } | undefined {
    const map = this.objectCall(node, "fromEntries") && node.arguments.length === 1 ? unwrap(node.arguments[0]) : node;
    if (!ts.isCallExpression(map) || !ts.isPropertyAccessExpression(map.expression) || map.expression.name.text !== "map"
      || map.arguments.length !== 1) return;
    const entries = unwrap(map.expression.expression), callback = unwrap(map.arguments[0]);
    if (!ts.isCallExpression(entries) || !this.objectCall(entries, "entries") || entries.arguments.length !== 1
      || ts.isSpreadElement(entries.arguments[0]) || !ts.isArrowFunction(callback) || callback.modifiers?.length
      || callback.parameters.length !== 1 || callback.parameters[0].initializer || callback.parameters[0].dotDotDotToken) return;
    const pattern = callback.parameters[0].name;
    if (!ts.isArrayBindingPattern(pattern) || pattern.elements.length !== 2
      || !pattern.elements.every((element): element is ts.BindingElement => ts.isBindingElement(element)
        && ts.isIdentifier(element.name) && !element.initializer && !element.dotDotDotToken)) return;
    const [key, value] = pattern.elements;
    const returned = ts.isBlock(callback.body) ? callback.body.statements.length === 1
      && ts.isReturnStatement(callback.body.statements[0]) ? callback.body.statements[0].expression : undefined : callback.body;
    const pair = returned && unwrap(returned);
    if (!pair || !ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2 || pair.elements.some(ts.isSpreadElement)
      || !ts.isIdentifier(unwrap(pair.elements[1]))
      || this.source.checker.getSymbolAtLocation(unwrap(pair.elements[1])) !== this.source.checker.getSymbolAtLocation(value.name)) return;
    return { table: entries.arguments[0], callback, key, value, keyExpression: pair.elements[0] };
  }

  private mappedMember(node: ts.CallExpression, keys: string[], bindings: Map<ts.Symbol, ExpressionBinding>, seen: Set<ts.Node>): ExpressionBinding | typeof UNRESOLVED | undefined {
    const mapping = this.entryMapping(node);
    if (!mapping) return UNRESOLVED;
    const guard = new StaticSchemaReader(this.source, this.readBudget), table = guard.read(mapping.table, "", bindings, seen);
    const writes = table !== UNRESOLVED && table !== null && typeof table === "object" ? guard.objectWrites.get(table) : undefined;
    if (!writes || writes.unknown || writes.unsafe || Array.isArray(table)) return UNRESOLVED;
    const keySymbol = this.source.checker.getSymbolAtLocation(mapping.key.name), valueSymbol = this.source.checker.getSymbolAtLocation(mapping.value.name);
    if (!keySymbol || !valueSymbol || keySymbol === valueSymbol) return UNRESOLVED;
    this.compositions.add(node);
    this.compositions.add(mapping.callback);
    for (const composition of guard.compositions) this.compositions.add(composition);
    // 缺口值仍有原属性键，数据属性枚举同时保留数字键顺序及最后覆盖语义。
    const enumerable: Record<string, null> = Object.create(null);
    for (const key of writes.keys) enumerable[key] = null;
    let selected: ExpressionBinding | typeof UNRESOLVED | undefined;
    for (const key of Object.keys(enumerable)) {
      const member = this.selectMember(mapping.table, [key], bindings, seen);
      if (!member || member === UNRESOLVED) return UNRESOLVED;
      const scope = new Map(bindings);
      scope.set(keySymbol, { expression: mapping.key.name as ts.Identifier, staticValue: key, bindings, seen });
      scope.set(valueSymbol, member);
      const outputName = new StaticSchemaReader(this.source, this.readBudget).read(mapping.keyExpression, "", scope, seen);
      if (typeof outputName !== "string") return UNRESOLVED;
      if (outputName === keys[0]) selected = keys.length === 1 ? member
        : this.selectMember(mapping.table, [key, ...keys.slice(1)], bindings, seen);
    }
    return selected;
  }

  /** 按最后写入语义定位所选成员，避免读入同一聚合中无关 schema 的缺口。 */
  private selectMember(expression: ts.Expression, keys: string[], bindings: Map<ts.Symbol, ExpressionBinding>, seen: Set<ts.Node>): ExpressionBinding | typeof UNRESOLVED | undefined {
    if (!this.withinReadLimit()) return UNRESOLVED;
    if (!keys.length) return { expression, bindings, seen };
    const node = unwrap(expression);
    if (seen.has(node) || seen.size > 80) return UNRESOLVED;
    const chain = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const symbol = this.source.checker.getSymbolAtLocation(node), binding = symbol && bindings.get(symbol);
      if (binding?.elements) {
        const element = /^(0|[1-9][0-9]*)$/u.test(keys[0]) ? binding.elements[Number(keys[0])] : undefined;
        if (!element) return;
        return keys.length === 1 ? element : this.selectMember(element.expression, keys.slice(1), element.bindings, element.seen);
      }
      if (binding) return this.selectMember(binding.expression, keys, binding.bindings, binding.seen);
      const target = this.constTarget(node);
      if (target?.initializer) {
        const mutations = this.objectMutations(target, node, keys);
        if (mutations.some(mutation => !mutation.sources && (!mutation.members || mutation.members.length <= keys.length))) return UNRESOLVED;
        const assignments = mutations.filter(mutation => mutation.sources);
        const selected = assignments.length ? this.assignedMember(target.initializer, assignments.flatMap(mutation => mutation.sources!), keys, bindings, chain)
          : this.selectMember(target.initializer, keys, bindings, chain);
        if (!selected || selected === UNRESOLVED) return selected;
        const memberWrites = mutations.filter(mutation => !mutation.sources)
          .map(mutation => ({ node: mutation.node, members: mutation.members!.slice(keys.length) }));
        return { ...selected, mutations: [...(selected.mutations ?? []), ...memberWrites] };
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
      if (this.objectCall(node, "fromEntries")) return this.mappedMember(node, keys, bindings, chain);
      const body = this.callBody(node, bindings, chain);
      if (body && (!body.localDeclarations?.length || this.pureCall(node)))
        return this.selectMember(body.expression, keys, body.bindings, body.seen);
    }
    if (ts.isArrayLiteralExpression(node) && /^(0|[1-9][0-9]*)$/u.test(keys[0]) && !node.elements.some(ts.isSpreadElement)) {
      const element = node.elements[Number(keys[0])];
      return element && !ts.isOmittedExpression(element) ? this.selectMember(element, keys.slice(1), bindings, chain) : undefined;
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
    const guard = new StaticSchemaReader(this.source, this.readBudget);
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
export function describeRepositorySchema(source: RepositorySource, expression: ts.Expression, maps: ts.Expression[] = [], referencePrefix = "",
  bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>(), readLimit?: number,
  options: { referenceStrings?: boolean; mutations?: ObjectMutation[] } = {}): Details {
  const root = source.root;
  const locations: DevelopmentSourceReference[] = [];
  const refs: Array<{ ref: string; declaration?: DevelopmentSourceReference; mapSources?: DevelopmentSourceReference[]; status: string; schema?: SchemaValue;
    fieldSources?: Array<{ pointer: string; source: DevelopmentSourceReference }>;
    unresolvedFieldSources?: Array<{ pointer: string; source: DevelopmentSourceReference }>; issues?: string[]; inputSchemas?: Details[] }> = [];
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
    const schema = target && reader.schema(target.expression, target.bindings, target.seen, target.mutations);
    const inputs = name && !target ? resolver.schemaInputs(name) : [];
    const inputSchemas = inputs.map(input => {
      let description = schemaInputDescriptions.get(input.binding);
      if (!description) {
        const original = describeRepositorySchema(source, input.binding.expression, [], "", input.binding.bindings, input.binding.seen, 4096);
        description = JSON.stringify(original);
        schemaInputDescriptions.set(input.binding, description);
      }
      const original = JSON.parse(description) as Details;
      const transformations = input.transformations.map(call => {
        const target = declaration(call.expression);
        return { expression: call.expression.getText(), source: sourceReference(call, root),
          ...(target ? { declaration: sourceReference(target, root) } : {}) };
      });
      return { ...original, assignmentSource: sourceReference(input.assignment, root), transformations };
    });

    refs.push({ ref, ...(inputSchemas.length ? { inputSchemas } : {}), ...(target ? { declaration: sourceReference(target.expression, root),
      ...(schema !== UNRESOLVED && schema !== undefined ? { schema } : {}),
      fieldSources: reader.fieldSources(schema ?? UNRESOLVED), unresolvedFieldSources: reader.unresolvedFieldSources(), issues: [...reader.issues] }
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
        const ref = bindings.size ? new StaticSchemaReader(source).read(node.initializer, "", bindings, seen) : source.value(node.initializer);
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
        const name = bindings.size ? new StaticSchemaReader(source).read(node.arguments[0], "", bindings, seen) : source.value(node.arguments[0]);
        if (typeof name === "string") addReference(`#/components/schemas/${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  const reader = new StaticSchemaReader(source, readLimit === undefined ? undefined : { remaining: readLimit });
  const schema = reader.schema(expression, bindings, seen, options.mutations);
  const referenceStrings = options.referenceStrings !== false;
  const name = !referenceStrings || readLimit !== undefined || bindings.size ? schema : source.value(expression);
  if (referenceStrings && typeof name === "string") addReference(`#/components/schemas/${name.includes(".") ? name : referencePrefix + name}`);
  else if (schema !== UNRESOLVED) visitValue(schema);
  visit(expression);
  for (const node of reader.compositions) locations.push(sourceReference(node, root));
  const target = declaration(expression);
  return { expression: expression.getText(), source: { ...sourceReference(expression, root) },
    ...(target ? { declaration: { ...sourceReference(target, root) } } : {}),
    sources: [...new Map(locations.map(location => [`${location.path}:${location.line}`, location])).values()],
    sourceFields,
    references: refs.map(ref => ({ ...ref, ...(ref.declaration ? { declaration: { ...ref.declaration } } : {}) })),
    ...(schema !== UNRESOLVED && (!referenceStrings || typeof name !== "string") ? { schema } : {}),
    fieldSources: reader.fieldSources(schema),
    unresolvedFieldSources: reader.unresolvedFieldSources(),
    issues: reader.issues.size ? ["schema-expansion:source-reference", ...reader.issues] : [],
    status: refs.some(ref => ref.status === "not-indexed") ? "not-indexed"
      : reader.issues.size || refs.some(ref => ref.status !== "indexed") ? "source-reference" : "indexed" };
}

/** 正式操作列表只补当前 Controller 的资料，不将未执行的生成器当作已挂载接口。 */
export function repositoryApiDocumentation(source: RepositorySource): Map<string, RepositoryApiDocumentation> {
  const result = new Map<string, RepositoryApiDocumentation>();
  const requestOperations = new Map<string, { node: ts.Expression; method: string; path: string; packageDirectory: string;
    maps: ts.Expression[]; bindings: Map<ts.Symbol, ExpressionBinding>; seen: Set<ts.Node> }>();
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
  const readValue = (expression: ts.Expression | undefined, bindings: Map<ts.Symbol, ExpressionBinding>, seen: Set<ts.Node>) =>
    expression && bindings.size ? new StaticSchemaReader(source).read(expression, "", bindings, seen) : source.value(expression);
  const schemaMaps = variables.filter(node => node.name.getText().endsWith("SCHEMAS"));
  const pathDefaults = new Map<boolean, ts.Expression>();
  const responseRenderers = new Map<string, Details>();
  const requestRenderers = new Map<string, Details>();
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
      if (!ts.isFunctionDeclaration(statement) || !statement.body) continue;
      if (statement.name?.text === (platform ? "createPlatformOpenApi" : "pathParameters")) visit(statement.body);
      if (statement.name?.text !== (platform ? "createPlatformOpenApi" : "operation")) continue;
      const declarations: Details[] = [];
      const defaults: Record<string, Details> = Object.create(null);
      const requestDefaults: Record<string, Details> = Object.create(null);
      const requestDeclarations: Details[] = [], requestConditions: Details[] = [];
      const visitResponses = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && node.name.getText() === "requestBody")
          requestDeclarations.push({ source: sourceReference(node, source.root), expression: node.getText() });
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isPropertyAccessExpression(node.left) && node.left.name.text === "requestBody")
          requestDeclarations.push({ source: sourceReference(node, source.root), expression: node.getText() });
        const condition = ts.isIfStatement(node) ? node.expression
          : ts.isConditionalExpression(node) ? node.condition : undefined;
        if (condition && (ts.isPropertyAccessExpression(condition) && ["requestSchema", "requestEncoding"].includes(condition.name.text)
          || ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.InKeyword
          && ts.isStringLiteralLike(condition.left) && condition.left.text === "request"))
          requestConditions.push({ source: sourceReference(condition, source.root), expression: condition.getText() });
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
          && ts.isPropertyAccessExpression(node.left) && ["requestRequired", "requestContentType"].includes(node.left.name.text))
          requestDefaults[node.left.name.text] = { source: sourceReference(node, source.root), expression: node.getText(),
            fallback: describeRepositorySchema(source, node.right, [], "", new Map(), new Set(), 4096, { referenceStrings: false }) };
        if (platform && ts.isConditionalExpression(node) && ts.isBinaryExpression(node.condition)
          && node.condition.operatorToken.kind === ts.SyntaxKind.InKeyword && ts.isStringLiteralLike(node.condition.left)
          && node.condition.left.text === "requestRequired")
          requestDefaults.requestRequired = { source: sourceReference(node, source.root), expression: node.getText(),
            fallback: describeRepositorySchema(source, node.whenFalse, [], "", new Map(), new Set(), 4096, { referenceStrings: false }) };
        if (platform && ts.isVariableDeclaration(node) && node.name.getText() === "content" && node.initializer) {
          const initializer = unwrap(node.initializer);
          const body = ts.isArrowFunction(initializer) && !ts.isBlock(initializer.body) ? unwrap(initializer.body) : undefined;
          const media = body && ts.isObjectLiteralExpression(body) ? body.properties[0]?.name : undefined;
          if (media && ts.isStringLiteralLike(media))
            requestDefaults.requestContentType = { source: sourceReference(node, source.root), expression: node.getText(),
              fallback: describeRepositorySchema(source, media, [], "", new Map(), new Set(), 4096, { referenceStrings: false }) };
        }
        if (ts.isPropertyAssignment(node) && node.name.getText() === "responses")
          declarations.push({ source: sourceReference(node, source.root), expression: node.getText() });
        if (ts.isBinaryExpression(node)) {
          const left = unwrap(node.left);
          const target = ts.isElementAccessExpression(left) ? unwrap(left.expression) : left;
          if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isPropertyAccessExpression(target) && target.name.text === "responses")
            declarations.push({ source: sourceReference(node, source.root), expression: node.getText() });
          if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && ts.isPropertyAccessExpression(left)
            && ["successStatus", "rawResponseContentType"].includes(left.name.text))
            defaults[left.name.text] = { source: sourceReference(node, source.root), expression: node.getText(),
              fallback: describeRepositorySchema(source, node.right, [], "", new Map(), new Set(), 4096, { referenceStrings: false }) };
        }
        ts.forEachChild(node, visitResponses);
      };
      visitResponses(statement.body);
      requestRenderers.set(path.split("/").slice(0, 2).join("/"), {
        source: sourceReference(statement, source.root), defaults: requestDefaults,
        declarations: requestDeclarations, conditions: requestConditions, status: "source-reference"
      });
      responseRenderers.set(path.split("/").slice(0, 2).join("/"), {
        source: sourceReference(statement, source.root), defaults, declarations, status: "source-reference"
      });
    }
  }
  const queryMap = variables.find(node => node.name.getText() === "querySchemas"
    && repositoryPath(source.root, node.getSourceFile().fileName) === "packages/platform-server/src/platform-openapi.ts");
  const queryReader = new StaticSchemaReader(source);
  const querySchemas = queryMap?.initializer ? queryReader.read(queryMap.initializer) : UNRESOLVED;
  const describeParameters = (node: ts.Expression, route: string, platform: boolean,
    fields: Record<string, ts.Expression | undefined>, maps: ts.Expression[], bindings: Map<ts.Symbol, ExpressionBinding>, seen: Set<ts.Node>): Details => {
    const explicit = fields.parameters && describeRepositorySchema(source, fields.parameters, maps, "", bindings, seen);
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
        const names = readValue(fields.query, bindings, seen);
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
    for (const member of controllerMembers(source, node).members) {
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
              controller: sourceReference(node, source.root),
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
          if (!documentation && (parameters.length || requestBodies.length) && ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
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
          // 参数可在响应资料未齐时定位，沿原 Controller 出处保留缺口。
          const parameterSource = openapi ?? documentation?.details.controllerSource;
          if (!parameters.length || !documentation || !parameterSource || typeof parameterSource !== "object" || Array.isArray(parameterSource)) continue;
          const controllers = Array.isArray(parameterSource.controllerParameters) ? parameterSource.controllerParameters : [];
          controllers.push({ source: sourceReference(member, source.root), controller: sourceReference(node, source.root), parameters });
          parameterSource.controllerParameters = controllers;
          const schemas = parameterSource.schemas;
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
            const missing = Array.isArray(parameterSource.issues) ? parameterSource.issues : [];
            if (!missing.includes("parameters:source-reference")) missing.push("parameters:source-reference");
            parameterSource.issues = missing;
          }
        }
      }
    }
  };
  const describe = (node: ts.Expression, method: unknown, path: unknown, fields: Record<string, ts.Expression | undefined>,
    bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>()) => {
    if (typeof method !== "string" || typeof path !== "string" || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return;
    const file = repositoryPath(source.root, node.getSourceFile().fileName);
    const packageDirectory = file.split("/").slice(0, 2).join("/");
    const platform = packageDirectory === "packages/platform-server";
    const route = platform ? `/api${path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}` : path;
    const key = `${method.toUpperCase()} ${route}`;
    if (result.has(key)) return;
    // 原生成器将显式全局 undefined 作为缺少可选 schema，局部绑定仍沿原来源读取。
    for (const name of ["requestSchema", "responseSchema"] as const) {
      const expression = fields[name] && unwrap(fields[name]!);
      if (expression && ts.isIdentifier(expression) && expression.text === "undefined"
        && !source.checker.getSymbolAtLocation(expression)?.declarations?.length) fields[name] = undefined;
    }
    const ownMaps = schemaMaps.filter(map => repositoryPath(source.root, map.getSourceFile().fileName).startsWith(packageDirectory + "/"));
    const aggregateMaps = ownMaps.filter(map => map.name.getText() === (platform ? "PLATFORM_OPENAPI_SCHEMAS" : "RENTAL_HTTP_COMPONENT_SCHEMAS"));
    const componentMaps = ownMaps.filter(map => map.name.getText().endsWith("COMPONENT_SCHEMAS"));
    const maps = (aggregateMaps.length ? aggregateMaps : componentMaps.length ? componentMaps : ownMaps).map(map => map.name as ts.Identifier);
    const schemas = Object.fromEntries(["requestSchema", "responseSchema", "parameters"].flatMap(name => {
      const expression = fields[name];
      return expression ? [[name, describeRepositorySchema(source, expression, maps, platform ? "Platform." : "", bindings, seen)]] : [];
    }));
    const parameters = describeParameters(node, route, platform, fields, maps, bindings, seen);
    schemas.parameters = parameters;
    let errorResponses: Details | undefined;
    if (fields.errorResponses) {
      errorResponses = describeRepositorySchema(source, fields.errorResponses, maps, "", bindings, seen);
      const responses = errorResponses.schema;
      const responseSchemas: Record<string, Details> = Object.create(null);
      const reader = new StaticSchemaReader(source);
      if (responses && typeof responses === "object" && !Array.isArray(responses)) {
        for (const [status, response] of Object.entries(responses)) {
          if (!response || typeof response !== "object" || Array.isArray(response) || typeof response.schema !== "string") continue;
          // 原生成器将字符串 schema 转为本地引用，内联 schema 已沿错误表读取。
          const selected = reader.member(fields.errorResponses, [status, "schema"], bindings, seen);
          responseSchemas[status] = selected && selected !== UNRESOLVED
            ? describeRepositorySchema(source, selected.expression, maps, platform ? "Platform." : "", selected.bindings, selected.seen)
            : { source: sourceReference(fields.errorResponses, source.root), expression: response.schema,
              status: "source-reference", issues: ["schema-reference:source-reference"] };
        }
      }
      errorResponses.schemas = responseSchemas;
      const unresolved = Object.entries(responseSchemas).filter(([, description]) => description.status !== "indexed");
      if (unresolved.length) {
        errorResponses.issues = [...(Array.isArray(errorResponses.issues) ? errorResponses.issues : []),
          ...unresolved.map(([status, description]) => "schema:" + status + ":" + description.status)];
        if (unresolved.some(([, description]) => description.status === "not-indexed")) errorResponses.status = "not-indexed";
        else if (errorResponses.status === "indexed") errorResponses.status = "source-reference";
      }
    }
    const responseOptions: Record<string, Details> = Object.create(null);
    const optionReader = new StaticSchemaReader(source, { remaining: 4096 });
    for (const name of ["successStatus", "rawResponseContentType", "responseHeaders", "redirectResponse", "rateLimited", "serviceUnavailableReason"]) {
      const selected = optionReader.member(node, name, bindings, seen);
      if (selected === undefined) continue;
      responseOptions[name] = selected === UNRESOLVED
        ? { source: sourceReference(node, source.root), status: "source-reference", issues: ["response-option:source-reference"] }
        : describeRepositorySchema(source, selected.expression, maps, platform ? "Platform." : "", selected.bindings, selected.seen, 4096,
          { referenceStrings: false, mutations: selected.mutations });
    }
    const responseRenderer = responseRenderers.get(packageDirectory);
    const summary = readValue(fields.summary, bindings, seen), id = readValue(fields.id, bindings, seen);
    const operationId = platform && typeof id === "string" ? `Platform.${id}` : readValue(fields.operationId, bindings, seen);
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
          ...(errorResponses ? { errorResponses } : {}),
          ...(Object.keys(responseOptions).length ? { responseOptions } : {}),
          ...(responseRenderer ? { responseRenderer } : {}), issues: missing } } });
    requestOperations.set(key, { node, method, path, packageDirectory, maps, bindings, seen });
  };
  const visit = (node: ts.Node, bindings = new Map<ts.Symbol, ExpressionBinding>(), seen = new Set<ts.Node>(), expandArrays = false) => {
    if (expandArrays && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ["map", "flatMap"].includes(node.expression.name.text)) {
      const items = new StaticSchemaReader(source).arrayBindings(node, bindings, seen);
      if (items) {
        for (const item of items) visit(item.expression, item.bindings, item.seen, true);
        return;
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      describe(node, readValue(property(node, "method"), bindings, seen), readValue(property(node, "path"), bindings, seen),
        { ...Object.fromEntries(["summary", "operationId", "id", "parameters", "query", "errorResponses"].map(name => [name, property(node, name)])),
          requestSchema: property(node, "requestSchema") ?? property(node, "request"),
          responseSchema: property(node, "responseSchema") ?? property(node, "response") }, bindings, seen);
    } else if (ts.isCallExpression(node)) {
      const symbol = source.checker.getSymbolAtLocation(node.expression), target = symbol && source.target(symbol).valueDeclaration;
      if (target && ts.isFunctionDeclaration(target) && ["clientOperation", "backlogOperation"].includes(target.name?.text ?? "")
        && repositoryPath(source.root, target.getSourceFile().fileName).endsWith("/http-openapi-contract.ts")) {
        const client = target.name?.text === "clientOperation", options = client ? node.arguments[4] : undefined;
        describe(node, readValue(node.arguments[0], bindings, seen), readValue(node.arguments[1], bindings, seen), {
          operationId: node.arguments[client ? 2 : 3], summary: node.arguments[client ? 3 : 4],
          requestSchema: options ? property(options, "requestSchema") : node.arguments[7],
          responseSchema: options ? property(options, "responseSchema") : node.arguments[8],
          parameters: options ? property(options, "parameters") : node.arguments[9]
        }, bindings, seen);
      }
    }
    ts.forEachChild(node, child => visit(child, bindings, seen, expandArrays));
  };
  const operations = variables.filter(node => node.name.getText().endsWith("OPERATIONS"));
  // 原静态声明先登记，绑定遍历只补缺少的资料，已有入口和字段结果继续保留。
  for (const variable of operations) visit(variable.initializer!);
  for (const variable of operations) visit(variable.initializer!, new Map(), new Set(), true);
  for (const file of source.program.getSourceFiles()) {
    if (file.isDeclarationFile || !isRepositorySourcePath(source.root, file.fileName)) continue;
    for (const statement of file.statements) {
      if (ts.isClassDeclaration(statement)) attachController(statement);
    }
  }
  // 请求资料在原字段、响应和 Controller 装配完成后读取，保持既有来源诊断的查询顺序。
  for (const [key, { node, method, path, packageDirectory, maps, bindings, seen }] of requestOperations) {
    const platform = packageDirectory === "packages/platform-server";
    let requestNode: ts.Expression = node;
    // 原调用可在外层展开后覆盖正文选项，字段资料仍沿原登记入口保留。
    while (requestNode.parent) {
      const parent = requestNode.parent;
      if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)
        || ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent)) requestNode = parent;
      else if (ts.isSpreadAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) requestNode = parent.parent;
      else break;
    }
    if (ts.isVariableDeclaration(requestNode.parent) && requestNode.parent.initializer === requestNode
      && ts.isIdentifier(requestNode.parent.name)) requestNode = requestNode.parent.name;
    const requestOptions: Record<string, Details> = Object.create(null);
    const requestReader = new StaticSchemaReader(source, { remaining: 4096 });
    const identity = ["method", "path"].map(name => {
      const selected = requestReader.member(requestNode, name, bindings, seen);
      return selected && selected !== UNRESOLVED
        ? new StaticSchemaReader(source, { remaining: 4096 }).read(selected.expression, "", selected.bindings, selected.seen) : UNRESOLVED;
    });
    const matches = typeof identity[0] === "string" && identity[0].toUpperCase() === method.toUpperCase() && identity[1] === path;
    for (const name of ["requestRequired", "requestContentType", "requestEncoding"]) {
      const selected = matches ? requestReader.member(requestNode, name, bindings, seen) : UNRESOLVED;
      if (selected === undefined) continue;
      requestOptions[name] = selected === UNRESOLVED
        ? { source: sourceReference(requestNode, source.root), status: "source-reference",
          issues: [matches ? "request-option:source-reference" : "request-operation:source-reference"] }
        : describeRepositorySchema(source, selected.expression, maps, platform ? "Platform." : "", selected.bindings, selected.seen, 4096,
          { referenceStrings: false, mutations: selected.mutations });
    }
    const requestRenderer = requestRenderers.get(packageDirectory);
    const openapi = result.get(key)!.details.openapiSource as Details;
    if (Object.keys(requestOptions).length) openapi.requestOptions = requestOptions;
    if (requestRenderer) openapi.requestRenderer = requestRenderer;
  }
  return result;
}
