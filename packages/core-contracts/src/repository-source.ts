/**
 * 开发索引的只读源码读取器。TypeScript 只解析本仓文件和符号，常量解析只接受静态值。
 * 无编译输出、模块执行、环境加载或外部包解析；动态表达式由调用方登记待核对。
 * const 对象的后置写入只定位并失效；可解释的组合仍由 OpenAPI 读取器处理。
 */
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import type { DevelopmentSourceReference } from "./development";

export const UNRESOLVED = Symbol("unresolved-static-value");
type StaticValue = string | number | boolean | null | StaticValue[] | { [key: string]: StaticValue };

function unwrapExpression(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

export function repositoryPath(root: string, file: string): string {
  return relative(root, file).replaceAll("\\", "/");
}

export function repositoryFiles(root: string, directory: string, include: (file: string) => boolean): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || /^(?:node_modules|vendor|dist(?:-.+)?|build|output|\.git|\.next|\.env(?:\..*)?)$/i.test(entry.name)) continue;
      const file = resolve(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && include(file)) files.push(file);
    }
  };
  const target = resolve(root, directory);
  if (isRepositorySourcePath(root, target) && lstatSync(target, { throwIfNoEntry: false })?.isDirectory()) visit(target);
  return files.sort();
}

export function sourceReference(node: ts.Node, root: string): DevelopmentSourceReference {
  const source = node.getSourceFile();
  return { path: repositoryPath(root, source.fileName), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 };
}

/** 索引所有读取共用这一条边界，包括编译器的文件探测和JSON/源码资料。 */
export function isRepositorySourcePath(root: string, file: string): boolean {
  const source = resolve(root, file);
  const rel = relative(root, source);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)
    || /(?:^|[\\/])(?:node_modules|output|\.git|\.env(?:\.[^\\/]+)?)(?:[\\/]|$)/i.test(rel))
    return false;
  let current = root;
  for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) return false;
  }
  return true;
}

export function readRepositoryText(root: string, file: string): string {
  const source = resolve(root, file);
  if (!isRepositorySourcePath(root, source)) throw new Error("源码索引只能读取仓库内的声明资料");
  return readFileSync(source, "utf8");
}

export function nodeDocumentation(node: ts.Node): string | undefined {
  const comments = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).map(comment =>
    typeof comment.comment === "string" ? comment.comment : comment.comment?.map(part => part.text).join(""));
  const text = comments.filter(Boolean).join("\n").trim();
  return text || undefined;
}

export class RepositorySource {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  private readonly objectWrites = new WeakMap<object, { keys: Set<string>; unknown: boolean }>();
  private mutationIndex?: Map<ts.VariableDeclaration, ts.Node[]>;

  constructor(readonly root: string, files: string[], paths: Record<string, string[]>) {
    const readPermissions = new Map<string, boolean>();
    const readable = (file: string) => {
      const known = readPermissions.get(file);
      if (known !== undefined) return known;
      const allowed = isRepositorySourcePath(root, file);
      readPermissions.set(file, allowed);
      return allowed;
    };
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve, noLib: true, types: [],
      noEmit: true, allowJs: true, baseUrl: root, paths };
    const host = ts.createCompilerHost(options);
    host.readFile = file => readable(file) ? ts.sys.readFile(file) : undefined;
    host.fileExists = file => readable(file) && ts.sys.fileExists(file);
    host.directoryExists = file => readable(file) && ts.sys.directoryExists(file);
    host.getDirectories = file => readable(file) ? ts.sys.getDirectories(file) : [];
    const readDirectory: ts.System["readDirectory"] = (file, extensions, exclude, include, depth) => readable(file)
      ? ts.sys.readDirectory(file, extensions, exclude, include, depth).filter(readable) : [];
    host.readDirectory = readDirectory;
    host.writeFile = () => { throw new Error("源码索引只允许读取"); };
    const configurations = new Map<string, ts.CompilerOptions>();
    host.resolveModuleNames = (names, importer) => {
      const config = ts.findConfigFile(resolve(importer, ".."), host.fileExists);
      let local = config ? configurations.get(config) : undefined;
      if (config && !local) {
        const json = ts.readConfigFile(config, host.readFile);
        const parsed = ts.parseJsonConfigFileContent(json.config ?? {}, { ...host, readDirectory, useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames }, resolve(config, ".."));
        const base = parsed.options.baseUrl ?? (typeof parsed.options.pathsBasePath === "string" ? parsed.options.pathsBasePath : resolve(config, ".."));
        local = { ...options, paths: { ...paths, ...Object.fromEntries(Object.entries(parsed.options.paths ?? {})
          .map(([name, targets]) => [name, targets.map(target => resolve(base, target))])) } };
        configurations.set(config, local);
      }
      return names.map(name => ts.resolveModuleName(name, importer, local ?? options, host).resolvedModule);
    };
    this.program = ts.createProgram(files, options, host);
    this.checker = this.program.getTypeChecker();
  }

  source(file: string): ts.SourceFile {
    const source = this.program.getSourceFile(file);
    if (!source) throw new Error(`无法读取已声明源码 ${repositoryPath(this.root, file)}`);
    return source;
  }

  exports(file: string): ts.Symbol[] {
    const module = this.checker.getSymbolAtLocation(this.source(file));
    return module ? this.checker.getExportsOfModule(module) : [];
  }

  target(symbol: ts.Symbol): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
  }

  /** 沿原 OpenAPI 的 const/成员/解构归属定位写入，不重放赋值或未知调用。 */
  private objectMutations(usage: ts.Identifier): ts.Node[] {
    const owner = (expression: ts.Expression, seen = new Set<ts.Node>()): ts.VariableDeclaration | undefined => {
      let node = unwrapExpression(expression);
      if (seen.has(node) || seen.size > 80) return;
      const chain = new Set(seen).add(node);
      while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) node = unwrapExpression(node.expression);
      if (!ts.isIdentifier(node)) return;
      const symbol = this.checker.getSymbolAtLocation(node), declaration = symbol && this.target(symbol).valueDeclaration;
      if (declaration && ts.isBindingElement(declaration)) {
        let binding: ts.Node = declaration;
        while (binding.parent && !ts.isVariableDeclaration(binding)) binding = binding.parent;
        return ts.isVariableDeclaration(binding) && binding.initializer ? owner(binding.initializer, chain) : undefined;
      }
      if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer
        || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return;
      const initial = unwrapExpression(declaration.initializer);
      return ts.isIdentifier(initial) ? owner(initial, chain) : declaration;
    };
    if (!this.mutationIndex) {
      const index = new Map<ts.VariableDeclaration, ts.Node[]>();
      const add = (node: ts.Node, expression: ts.Expression) => {
        let constant = owner(expression);
        const seen = new Set<ts.VariableDeclaration>();
        while (constant && !seen.has(constant)) {
          seen.add(constant);
          index.set(constant, [...(index.get(constant) ?? []), node]);
          const initial = constant.initializer && unwrapExpression(constant.initializer);
          constant = initial && (ts.isPropertyAccessExpression(initial) || ts.isElementAccessExpression(initial)) ? owner(initial.expression) : undefined;
        }
      };
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && this.objectCall(node, "assign")) {
          if (node.arguments[0]) add(node, node.arguments[0]);
        } else if ((ts.isCallExpression(node) || ts.isNewExpression(node))
          && !(ts.isCallExpression(node) && this.readOnlyCall(node))) {
          for (const argument of node.arguments ?? []) add(node, argument);
          if (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) add(node, node.expression.expression);
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) add(node, node.left);
        else if (ts.isDeleteExpression(node) || (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
          && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) add(node, ts.isDeleteExpression(node) ? node.expression : node.operand);
        else if (ts.isVariableDeclaration(node) && node.initializer && ts.isVariableDeclarationList(node.parent)
          && !(node.parent.flags & ts.NodeFlags.Const)) add(node, node.initializer);
        ts.forEachChild(node, visit);
      };
      for (const file of this.program.getSourceFiles()) if (!file.isDeclarationFile && isRepositorySourcePath(this.root, file.fileName)) visit(file);
      this.mutationIndex = index;
    }
    const constant = owner(usage);
    if (!constant) return [];
    const deferred = (node: ts.Node) => {
      for (let current: ts.Node | undefined = node; current && !ts.isSourceFile(current); current = current.parent)
        if (ts.isFunctionLike(current)) return true;
      return false;
    };
    let statement: ts.Node = usage;
    while (statement.parent && !ts.isSourceFile(statement.parent)) statement = statement.parent;
    const finalName = ts.isVariableDeclaration(usage.parent) && usage.parent.name === usage;
    const cutoff = finalName || usage.getSourceFile() !== constant.getSourceFile() ? Infinity : statement.end;
    // 同语句不重放执行顺序；延迟读写和跨模块写入也没有可证明的文本先后关系。
    return (this.mutationIndex.get(constant) ?? []).filter(node => deferred(usage) || deferred(node)
      || node.getSourceFile() !== constant.getSourceFile() || node.getStart() < cutoff);
  }

  private objectCall(node: ts.CallExpression, method: string): boolean {
    return ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "Object" && node.expression.name.text === method
      && !this.checker.getSymbolAtLocation(node.expression.expression)?.declarations?.length;
  }

  /** 与原读取器相同的单返回纯声明边界；这里只证明没有写入，不求函数返回值。 */
  private readOnlyCall(node: ts.CallExpression, seen = new Set<ts.Node>()): boolean {
    if (["keys", "values", "entries", "hasOwn"].some(method => this.objectCall(node, method))) return true;
    const literal = node.arguments[0] && unwrapExpression(node.arguments[0]);
    if (this.objectCall(node, "assign") && literal && ts.isObjectLiteralExpression(literal)
      && literal.properties.every(property => !ts.isSpreadAssignment(property) && !ts.isGetAccessorDeclaration(property) && !ts.isSetAccessorDeclaration(property)
        && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)) && property.name.text !== "__proto__")) return true;
    const symbol = this.checker.getSymbolAtLocation(node.expression), target = symbol && this.target(symbol).valueDeclaration;
    const callable = target && ts.isVariableDeclaration(target) && target.initializer ? unwrapExpression(target.initializer) : target;
    if (!callable || !(ts.isFunctionDeclaration(callable) || ts.isArrowFunction(callable)) || !callable.body
      || seen.has(callable) || seen.size > 80 || callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      || ts.isFunctionDeclaration(callable) && callable.asteriskToken
      || !callable.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.dotDotDotToken)
      || node.arguments.some(ts.isSpreadElement)) return false;
    const body = ts.isBlock(callable.body) ? callable.body.statements.length === 1 && ts.isReturnStatement(callable.body.statements[0])
      ? callable.body.statements[0].expression : undefined : callable.body;
    if (!body) return false;
    const chain = new Set(seen).add(callable);
    let pure = true;
    const visit = (part: ts.Node) => {
      if (ts.isCallExpression(part) && !this.readOnlyCall(part, chain) || ts.isNewExpression(part) || ts.isDeleteExpression(part)
        || ts.isBinaryExpression(part) && part.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && part.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        || (ts.isPrefixUnaryExpression(part) || ts.isPostfixUnaryExpression(part))
          && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(part.operator)) pure = false;
      if (pure) ts.forEachChild(part, visit);
    };
    visit(body);
    for (const argument of node.arguments) if (pure) visit(argument);
    for (const parameter of callable.parameters) if (pure && parameter.initializer) visit(parameter.initializer);
    return pure;
  }

  /** 支持静态值和 Object.freeze 的字面量参数，通过语法拆包读取，不调用任何函数。 */
  value(node: ts.Node | undefined, visited = new Set<ts.Node>()): StaticValue | typeof UNRESOLVED {
    if (!node || visited.has(node)) return UNRESOLVED;
    const chain = new Set(visited).add(node);
    const value = (child: ts.Node | undefined) => this.value(child, chain);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) return value(node.expression);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "freeze" && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "Object" && !this.checker.getSymbolAtLocation(node.expression.expression)?.declarations?.length)
      return value(node.arguments[0]);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const operand = value(node.operand);
      return typeof operand === "number" ? -operand : UNRESOLVED;
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const part = value(span.expression);
        if (typeof part !== "string" && typeof part !== "number") return UNRESOLVED;
        text += part + span.literal.text;
      }
      return text;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const array: StaticValue[] = [];
      for (const element of node.elements) {
        const part = value(ts.isSpreadElement(element) ? element.expression : element);
        if (part === UNRESOLVED || ts.isSpreadElement(element) && !Array.isArray(part)) return UNRESOLVED;
        if (ts.isSpreadElement(element)) array.push(...part as StaticValue[]);
        else array.push(part);
      }
      return array;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const object: Record<string, StaticValue> = Object.create(null);
      const writes = { keys: new Set<string>(), unknown: false };
      this.objectWrites.set(object, writes);
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const part = value(property.expression);
          if (part === null || typeof part === "boolean" || typeof part === "number" || part === "") continue;
          const source = part !== UNRESOLVED && part && typeof part === "object" && !Array.isArray(part) ? part : undefined;
          const sourceWrites = source && this.objectWrites.get(source);
          // 嵌套部分对象仍可能覆盖旧键；已写但无静态值的键也必须覆盖旧值。
          if (!source || sourceWrites?.unknown) {
            for (const key of Object.keys(object)) delete object[key];
            writes.keys.clear();
            writes.unknown = true;
          }
          if (source) for (const key of sourceWrites?.keys ?? Object.keys(source)) {
            delete object[key];
            writes.keys.add(key);
            if (Object.hasOwn(source, key)) object[key] = source[key];
          }
        } else {
          const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)
            ? property.name.text : undefined;
          if (key === undefined) {
            for (const key of Object.keys(object)) delete object[key];
            writes.keys.clear();
            writes.unknown = true;
            continue;
          }
          const shorthand = ts.isShorthandPropertyAssignment(property) ? this.checker.getShorthandAssignmentValueSymbol(property) : undefined;
          const declaration = shorthand && this.target(shorthand).valueDeclaration;
          const expression = ts.isPropertyAssignment(property) ? property.initializer
            : ts.isShorthandPropertyAssignment(property) ? declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : property.name : undefined;
          const part = value(expression);
          writes.keys.add(key);
          delete object[key];
          if (part !== UNRESOLVED) object[key] = part;
        }
      }
      return object;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const object = value(node.expression);
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : value(node.argumentExpression);
      if (object !== UNRESOLVED && object !== null && typeof object === "object" && (typeof key === "string" || typeof key === "number"))
        return Object.hasOwn(object, key) ? (object as Record<string | number, StaticValue>)[key] : UNRESOLVED;
      const symbol = this.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
      const declaration = symbol && this.target(symbol).declarations?.[0];
      if (declaration && ts.isEnumMember(declaration)) return value(declaration.initializer);
      return UNRESOLVED;
    }
    if (ts.isIdentifier(node)) {
      const symbol = this.checker.getSymbolAtLocation(node);
      const declaration = symbol && this.target(symbol).declarations?.[0];
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
        && declaration.parent.flags & ts.NodeFlags.Const) {
        const initial = value(declaration.initializer);
        return initial !== UNRESOLVED && initial !== null && typeof initial === "object" && this.objectMutations(node).length ? UNRESOLVED : initial;
      }
    }
    return UNRESOLVED;
  }

  /** 字段存在但表达式需要运行时值时，将缺口显式交给目录调用方。 */
  unresolvedProperties(node: ts.Expression, ignored: readonly string[] = [], visited = new Set<ts.Node>()): string[] {
    if (visited.has(node)) return [node.getText()];
    const chain = new Set(visited).add(node);
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    if (ts.isIdentifier(node)) {
      const symbol = this.checker.getSymbolAtLocation(node), declaration = symbol && this.target(symbol).valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
        && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const) {
        const initial = this.value(declaration.initializer), mutations = initial !== UNRESOLVED && initial !== null && typeof initial === "object" ? this.objectMutations(node) : [];
        if (mutations.length) return [...new Set(mutations.map(mutation => {
          const location = sourceReference(mutation, this.root);
          return `post-write:${location.path}:${location.line}`;
        }))];
        return this.unresolvedProperties(declaration.initializer, ignored, chain);
      }
    }
    if (!ts.isObjectLiteralExpression(node)) return [];
    return node.properties.flatMap(property => {
      if (ts.isSpreadAssignment(property)) {
        const part = this.value(property.expression);
        const noop = part === null || typeof part === "boolean" || typeof part === "number" || part === "";
        const object = part !== UNRESOLVED && part && typeof part === "object" && !Array.isArray(part);
        return !noop && !object || this.unresolvedProperties(property.expression, [], chain).length ? [property.getText()] : [];
      }
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return [property.getText()];
      if (ts.isComputedPropertyName(property.name)) return [property.getText()];
      const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText();
      if (ignored.includes(name)) return [];
      const expression = ts.isPropertyAssignment(property) ? property.initializer : property.name;
      return this.value(expression) === UNRESOLVED || this.unresolvedProperties(expression, [], chain).length ? [name] : [];
    });
  }
}

export function readRepositoryJson(root: string, file: string): Record<string, unknown> {
  return JSON.parse(readRepositoryText(root, file));
}
