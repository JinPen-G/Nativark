/**
 * 开发索引的只读源码读取器。TypeScript 只解析本仓文件和符号，常量解析只接受静态值。
 * 无编译输出、模块执行、环境加载或外部包解析；动态表达式由调用方登记待核对。
 */
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import type { DevelopmentSourceReference } from "./development";

export const UNRESOLVED = Symbol("unresolved-static-value");
type StaticValue = string | number | boolean | null | StaticValue[] | { [key: string]: StaticValue };

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
        && declaration.parent.flags & ts.NodeFlags.Const) return value(declaration.initializer);
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
        && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const)
        return this.unresolvedProperties(declaration.initializer, ignored, chain);
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
