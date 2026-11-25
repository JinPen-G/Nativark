/** 从受控不可变迁移构造实际MySQL结构预期；只解释本宿主固定迁移使用的结构语法。
 * 未识别DDL拒绝形成预期，不能忽略语句后把损坏结构判成就绪。此模块不执行SQL。 */
export interface MysqlColumnShape {
  name: string; type: string; nullable: boolean; collation: string | null; defaultValue: string | null;
}
export interface MysqlTableShape {
  name: string; collation: string; columns: MysqlColumnShape[];
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
  checks: Array<{ name: string; clause: string }>;
  foreignKeys: Array<{ name: string; columns: string[]; targetTable: string; targetColumns: string[]; deleteRule: string; updateRule: string }>;
}
export interface MysqlForeignKeyExtension {
  readonly table: string;
  readonly foreignKey: MysqlTableShape["foreignKeys"][number];
}
const names = (list: string): string[] => list.split(",").map(part => {
  const match = /^\s*`([^`]+)`\s*$/.exec(part);
  if (!match) throw new Error(`未支持的索引或外键列：${part}`);
  return match[1];
});
// SQL关键字可归一，ENUM及默认值中的业务字面量不能随之改成小写。
const lowerOutsideText = (value: string) => value.replace(/'(?:\\.|''|[^'\\])*'|[^']+/g,
  part => part.startsWith("'") ? part : part.toLowerCase().replace(/,\s+/g, ","));
export const mysqlColumnType = (value: string) => lowerOutsideText(value).replace(/^boolean$/, "tinyint(1)").replace(/^integer\b/, "int");
export const mysqlDefaultExpression = (value: string) => lowerOutsideText(value);
const defaultValue = (value: string | undefined): string | null => value === undefined || /^null$/i.test(value) ? null
  : /^true$/i.test(value) ? "1" : /^false$/i.test(value) ? "0" : /^'/.test(value) ? value.replace(/^'(.*)'$/, "$1") : mysqlDefaultExpression(value);

/** MySQL按DECIMAL列精度补齐默认值小数位；只归一数值字面量，不经过浮点运算或修改文本默认值。 */
export function mysqlColumnDefault(type: string, value: string | null): string | null {
  if (!/^decimal\(/i.test(type) || value === null || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ""] = value.replace(/^\+/, "").split(".");
  const integer = whole.replace(/^(-?)0+(?=\d)/, "$1");
  const decimal = fraction.replace(/0+$/, "");
  const result = decimal ? `${integer}.${decimal}` : integer;
  return result === "-0" ? "0" : result;
}

function column(line: string, table: MysqlTableShape): MysqlColumnShape {
  // COMMENT描述不改变列结构；其引号内的分号、逗号由SQL分隔器保留，不能切成另一条迁移。
  const definition = line.replace(/\s+COMMENT\s*(?:=\s*)?'(?:\\.|''|[^'])*'$/i, "");
  const match = /^`([^`]+)`\s+((?:enum\([^)]*\)|decimal\([^)]*\)|[a-z]+(?:\(\d+\))?)(?:\s+unsigned)?)\s+(?:CHARACTER\s+SET\s+(\w+)\s+)?(?:COLLATE\s+(\w+)\s+)?(NOT NULL|NULL)(?:\s+DEFAULT\s+(.+))?$/i.exec(definition);
  if (!match) throw new Error(`未支持的公共列定义：${table.name} ${line}`);
  const type = mysqlColumnType(match[2]), text = /^(?:varchar|char|(?:tiny|medium|long)?text|enum)/.test(type);
  const collation = text ? match[4] ?? table.collation : null;
  if (match[3] && (!collation || !collation.toLowerCase().startsWith(match[3].toLowerCase() + "_")))
    throw new Error(`列字符集与排序规则不一致：${table.name}.${match[1]}`);
  return { name: match[1], type, nullable: match[5].toUpperCase() === "NULL", collation,
    defaultValue: mysqlColumnDefault(type, defaultValue(match[6])) };
}

function foreignKey(line: string) {
  const match = /^CONSTRAINT `([^`]+)`\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`([^`]+)`\s*\(([^)]+)\)\s+ON\s+DELETE\s+(RESTRICT|CASCADE|SET NULL|NO ACTION)\s+ON\s+UPDATE\s+(RESTRICT|CASCADE|SET NULL|NO ACTION)$/i.exec(line);
  if (!match) throw new Error(`未支持的公共外键定义：${line}`);
  return { name: match[1], columns: names(match[2]), targetTable: match[3], targetColumns: names(match[4]), deleteRule: match[5], updateRule: match[6] };
}

/** 所选Core迁移对公共表的显式外键，采用与建表相同的严格语法。 */
export function mysqlForeignKeyExtension(statement: string): MysqlForeignKeyExtension {
  const match = /^ALTER TABLE `([^`]+)`\s+ADD (CONSTRAINT [\s\S]+)$/i.exec(statement.trim().replace(/;$/, ""));
  if (!match) throw new Error("公共表扩展只接受明确的追加外键");
  return { table: match[1], foreignKey: foreignKey(match[2]) };
}

/** 宿主只从已核定的Core迁移提供扩展；不接收客户端的约束或覆盖原表定义。 */
export function extendMysqlPublicForeignKeys(tables: readonly MysqlTableShape[],
  extensions: readonly MysqlForeignKeyExtension[]): MysqlTableShape[] {
  const result = tables.map(table => structuredClone(table));
  for (const extension of extensions) {
    const table = result.find(candidate => candidate.name === extension.table);
    const key = extension.foreignKey;
    if (!table || table.foreignKeys.some(current => current.name === key.name)
      || key.columns.some(column => !table.columns.some(current => current.name === column))
      || !key.columns.length || key.columns.length !== key.targetColumns.length)
      throw new Error(`公共外键扩展冲突或无效：${extension.table}.${key.name}`);
    table.foreignKeys.push(structuredClone(key));
  }
  return result;
}

// 分号和逗号都只在引号、注释和括号外生效；COMMENT中的分号不是新的SQL操作。
function splitSql(body: string, separator: ";" | ","): string[] {
  const definitions: string[] = [];
  let part = "", depth = 0, quote: string | undefined;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (quote) {
      part += character;
      if (character === "\\" && index + 1 < body.length) part += body[++index];
      else if (character === quote) {
        if (body[index + 1] === quote) part += body[++index];
        else quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") quote = character;
    else if (character === "-" && body[index + 1] === "-" && (!body[index + 2] || /\s/.test(body[index + 2]))) {
      while (index + 1 < body.length && body[index + 1] !== "\n") index++;
      part += "\n";
      continue;
    } else if (character === "/" && body[index + 1] === "*") {
      // MySQL版本注释可以执行DDL，不能当普通说明丢弃。
      if (body[index + 2] === "!" || body[index + 2] === "+") throw new Error("未支持的可执行SQL注释");
      const end = body.indexOf("*/", index + 2);
      if (end < 0) throw new Error("SQL注释未闭合");
      index = end + 1;
      part += " ";
      continue;
    }
    if (!quote && character === "(") depth++;
    else if (!quote && character === ")") depth--;
    if (depth < 0) throw new Error("SQL定义括号不匹配");
    if (!quote && character === separator && depth === 0) {
      if (part.trim()) definitions.push(part.trim());
      part = "";
    } else part += character;
  }
  if (quote || depth !== 0) throw new Error("SQL定义引号或括号不匹配");
  if (part.trim()) definitions.push(part.trim());
  return definitions;
}

/** 固定迁移的结构/回填分类共用此入口；返回原语句，不执行或默认忽略数据操作。 */
export const mysqlMigrationStatements = (text: string): string[] => splitSql(text, ";");

function append<T extends { name: string }>(values: T[], value: T, table: string): void {
  if (values.some(current => current.name === value.name)) throw new Error(`结构重复定义：${table}.${value.name}`);
  values.push(value);
}

function addDefinition(table: MysqlTableShape, definition: string): void {
  if (definition.startsWith("`")) append(table.columns, column(definition, table), table.name);
  else {
    const primary = /^PRIMARY KEY \(([^)]+)\)$/i.exec(definition);
    const index = /^(UNIQUE INDEX|UNIQUE KEY|INDEX|KEY) `([^`]+)`\s*\(([^)]+)\)$/i.exec(definition);
    const check = /^CONSTRAINT `([^`]+)`\s+CHECK\s*\(([\s\S]+)\)$/i.exec(definition);
    if (primary) append(table.indexes, { name: "PRIMARY", columns: names(primary[1]), unique: true }, table.name);
    else if (index) append(table.indexes, { name: index[2], columns: names(index[3]), unique: index[1].toUpperCase().startsWith("UNIQUE ") }, table.name);
    else if (check) append(table.checks, { name: check[1], clause: check[2] }, table.name);
    else if (/^CONSTRAINT `[^`]+`\s+FOREIGN KEY\b/i.test(definition)) append(table.foreignKeys, foreignKey(definition), table.name);
    else throw new Error(`未支持的表约束：${table.name} ${definition}`);
  }
}

export function mysqlStructureFromMigrations(migrations: readonly string[]): MysqlTableShape[] {
  const tables = new Map<string, MysqlTableShape>();
  for (const text of migrations) for (const statement of mysqlMigrationStatements(text)) {
    const create = /^CREATE TABLE `([^`]+)`\s*\(([\s\S]+)\) DEFAULT CHARACTER SET utf8mb4 COLLATE (\w+)(?:\s+COMMENT\s*(?:=\s*)?'(?:\\.|''|[^'])*')?$/i.exec(statement);
    if (create) {
      if (tables.has(create[1])) throw new Error(`公共表重复定义：${create[1]}`);
      const table: MysqlTableShape = { name: create[1], collation: create[3], columns: [], indexes: [], checks: [], foreignKeys: [] };
      for (const definition of splitSql(create[2], ",")) addDefinition(table, definition);
      tables.set(table.name, table);
      continue;
    }
    const index = /^CREATE\s+(UNIQUE\s+)?INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*\(([^)]+)\)$/i.exec(statement);
    if (index && tables.has(index[3])) {
      const table = tables.get(index[3])!;
      append(table.indexes, { name: index[2], columns: names(index[4]), unique: Boolean(index[1]) }, table.name);
      continue;
    }
    const alter = /^ALTER TABLE `([^`]+)`\s+([\s\S]+)$/i.exec(statement);
    if (!alter || !tables.has(alter[1])) throw new Error(`未支持的公共DDL或目标表：${statement.slice(0, 100)}`);
    const table = tables.get(alter[1])!;
    for (const action of splitSql(alter[2], ",")) {
      const addColumn = /^ADD COLUMN ([\s\S]+)$/i.exec(action);
      const addConstraint = /^ADD ((?:CONSTRAINT|INDEX|KEY|UNIQUE INDEX|UNIQUE KEY) [\s\S]+)$/i.exec(action);
      const modify = /^MODIFY (?:COLUMN )?([\s\S]+)$/i.exec(action);
      const dropDefault = /^ALTER COLUMN `([^`]+)` DROP DEFAULT$/i.exec(action);
      const drop = /^DROP (CHECK|FOREIGN KEY) `([^`]+)`$/i.exec(action);
      if (addColumn) append(table.columns, column(addColumn[1], table), table.name);
      else if (addConstraint) addDefinition(table, addConstraint[1]);
      else if (modify) {
        const replacement = column(modify[1], table), at = table.columns.findIndex(current => current.name === replacement.name);
        if (at < 0) throw new Error(`修改的列不存在：${table.name}.${replacement.name}`);
        table.columns[at] = replacement;
      } else if (dropDefault) {
        const column = table.columns.find(current => current.name === dropDefault[1]);
        if (!column) throw new Error(`默认值目标列不存在：${table.name}.${dropDefault[1]}`);
        column.defaultValue = null;
      } else if (drop) {
        const values = drop[1].toUpperCase() === "CHECK" ? table.checks : table.foreignKeys;
        const at = values.findIndex(current => current.name === drop[2]);
        if (at < 0) throw new Error(`删除的约束不存在：${table.name}.${drop[2]}`);
        values.splice(at, 1);
      } else throw new Error(`未支持的公共ALTER：${action}`);
    }
  }
  return [...tables.values()];
}

/** 固定迁移使用的 CHECK 表达式；只比较结构，不执行字段或函数。
 * 字面量保留大小写，AND/OR只合并自身的结合层，不丢失混合运算的括号优先级。
 * MySQL返回的utf8mb4字面量及CHAR修饰按本版迁移字符集归一；未知函数/语法仍拒绝。 */
export function mysqlCheckShape(clause: string): string | undefined {
  if (clause.length > 32_768) return;
  type Token = { kind: "word" | "field" | "text" | "number" | "symbol"; value: string };
  type Node = string | Node[];
  const tokens: Token[] = [];
  const pattern = /\s+|`(?:``|[^`])+`|_(?:utf8mb4|ascii|binary)\\'[^'\\]*\\'|'(?:\\.|''|[^'\\])*'|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|>=|<=|<>|!=|[(),=<>+\-]/giy;
  let offset = 0;
  while (offset < clause.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(clause);
    if (!match) return;
    const raw = match[0];
    offset = pattern.lastIndex;
    if (/^\s/.test(raw)) continue;
    // CHECK_CLAUSE可将字符集字面量的外层引号返回为\'；只还原无内部转义的定界符，保留原值。
    const quoted = /^(_utf8mb4|_ascii|_binary)\\'([^'\\]*)\\'$/i.exec(raw);
    if (quoted) tokens.push({ kind: "word", value: quoted[1].toLowerCase() }, { kind: "text", value: `'${quoted[2]}'` });
    else {
      const kind = raw.startsWith("`") ? "field" : raw.startsWith("'") ? "text"
        : /^[0-9]/.test(raw) ? "number" : /^[A-Za-z_]/.test(raw) ? "word" : "symbol";
      tokens.push({ kind, value: kind === "word" ? raw.toLowerCase() : raw });
    }
    if (tokens.length > 4096) return;
  }
  let at = 0, depth = 0;
  const is = (value: string) => tokens[at]?.value === value && tokens[at]?.kind !== "field" && tokens[at]?.kind !== "text";
  const take = (value: string) => { if (!is(value)) throw new Error("未知CHECK语法"); at++; };
  const grouped = (consume: () => Node): Node => {
    if (++depth > 32) throw new Error("CHECK层级过深");
    take("("); const result = consume(); take(")"); depth--; return result;
  };
  const textValue = (raw: string) => raw.slice(1, -1).replace(/''|\\./g, escaped => {
    if (escaped === "''") return "'";
    const replacements: Record<string, string> = { "0": "\0", b: "\b", n: "\n", r: "\r", t: "\t", Z: "\x1a" };
    return replacements[escaped[1]] ?? ("%_".includes(escaped[1]) ? escaped : escaped[1]);
  });
  const arities: Record<string, readonly [number, number]> = { char_length: [1, 1], octet_length: [1, 1],
    json_type: [1, 1], json_unquote: [1, 1], json_extract: [2, 2], coalesce: [2, 4096],
    concat: [1, 4096], regexp_like: [2, 3] };
  const operand = (): Node => {
    if (is("(")) return grouped(or);
    if (is("binary")) { take("binary"); return ["binary", operand()]; }
    if (is("+") || is("-")) { const sign = tokens[at++].value; return ["unary", sign, operand()]; }
    const token = tokens[at++];
    if (!token) throw new Error("CHECK缺少操作数");
    if (token.kind === "field") return ["field", token.value.slice(1, -1).replace(/``/g, "`").toLowerCase()];
    if (token.kind === "text") return ["text", textValue(token.value)];
    if (token.kind === "number") return ["number", token.value];
    if (token.kind !== "word") throw new Error("未知CHECK操作数");
    const value = token.value;
    if (value === "null") return "null";
    if (value === "true" || value === "false") return ["number", value === "true" ? "1" : "0"];
    if (value.startsWith("_") && tokens[at]?.kind === "text") {
      if (!["_utf8mb4", "_ascii", "_binary"].includes(value)) throw new Error("未知字面量字符集");
      const literal: Node = ["text", textValue(tokens[at++].value)];
      return value === "_utf8mb4" ? literal : value === "_binary" ? ["binary", literal] : ["charset", value, literal];
    }
    if (!is("(")) {
      if (["and", "or", "not", "in", "between", "is", "as"].includes(value)) throw new Error("未知CHECK字段");
      return ["field", value];
    }
    if (value === "cast") return grouped(() => {
      const input = or(); take("as");
      if (is("unsigned")) {
        take("unsigned"); if (is("integer") || is("int")) at++;
        return ["cast", "unsigned", input];
      }
      if (is("binary")) { take("binary"); return ["binary", input]; }
      take("char");
      let length: Node = "default";
      if (is("(")) length = grouped(() => { const size = tokens[at++];
        if (size?.kind !== "number" || !/^[0-9]+$/.test(size.value)) throw new Error("未知CHAR长度");
        return size.value; });
      let charset = "utf8mb4";
      if (is("charset") || is("character")) {
        if (is("charset")) take("charset"); else { take("character"); take("set"); }
        const name = tokens[at++];
        if (name?.kind !== "word" || !["utf8mb4", "ascii", "binary"].includes(name.value)) throw new Error("未知CHAR字符集");
        charset = name.value;
      }
      return ["cast", "char", length, charset, input];
    });
    const arity = Object.hasOwn(arities, value) ? arities[value] : undefined;
    if (!arity) throw new Error("未知CHECK函数");
    return grouped(() => {
      const values: Node[] = [];
      if (!is(")")) {
        values.push(or());
        while (is(",")) { take(","); values.push(or()); }
      }
      if (values.length < arity[0] || values.length > arity[1]) throw new Error("CHECK函数参数错误");
      return ["call", value, values];
    });
  };
  const addition = (): Node => {
    let result = operand();
    while (is("+") || is("-")) { const operator = tokens[at++].value; result = [operator, result, operand()]; }
    return result;
  };
  const compare = (): Node => {
    const left = addition();
    const next = tokens[at + 1]?.value;
    const negated = is("not") && next !== undefined && ["in", "between"].includes(next);
    if (negated) take("not");
    const operator = tokens[at]?.value ?? "";
    if (operator === "in") {
      take("in"); take("("); const values = [operand()];
      while (is(",")) { take(","); values.push(operand()); }
      take(")"); return [negated ? "not_in" : "in", left, values];
    }
    if (operator === "between") {
      take("between"); const min = addition(); take("and"); const max = addition();
      const range: Node = ["and", [">=", left, min], ["<=", left, max]];
      return negated ? ["not", range] : range;
    }
    if (operator === "is") {
      take("is"); const not = is("not");
      if (not) take("not"); take("null"); return [not ? "is_not_null" : "is_null", left];
    }
    if ([">=", "<=", "=", "<>", "!=", "<", ">"].includes(operator)) { at++; return [operator === "!=" ? "<>" : operator, left, addition()]; }
    return left;
  };
  const not = (): Node => is("not") ? (take("not"), ["not", not()]) : compare();
  const and = (): Node => {
    let result = not();
    while (is("and")) { take("and"); result = ["and", result, not()]; }
    return result;
  };
  const or = (): Node => {
    let result = and();
    while (is("or")) { take("or"); result = ["or", result, and()]; }
    return result;
  };
  const normalize = (node: Node): Node => {
    if (!Array.isArray(node)) return node;
    const result = node.map(normalize);
    if (result[0] !== "and" && result[0] !== "or") return result;
    return [result[0], ...result.slice(1).flatMap(child => Array.isArray(child) && child[0] === result[0] ? child.slice(1) : [child])];
  };
  try { const result = or(); return at === tokens.length ? JSON.stringify(normalize(result)) : undefined; }
  catch { return; }
}
