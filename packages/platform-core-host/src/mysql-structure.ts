/** 从受控不可变迁移构造实际MySQL结构预期；仅支持本宿主已使用的建表/追加列/外键语法。
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
const names = (list: string) => [...list.matchAll(/`([^`]+)`/g)].map(match => match[1]);
const sqlType = (value: string) => value.toLowerCase().replace(/^boolean$/, "tinyint(1)").replace(/^integer\b/, "int").replace(/,\s+/g, ",");
const defaultValue = (value: string | undefined): string | null => value === undefined || /^null$/i.test(value) ? null
  : /^true$/i.test(value) ? "1" : /^false$/i.test(value) ? "0" : value.replace(/^'(.*)'$/, "$1").toLowerCase();

function column(line: string, table: MysqlTableShape): MysqlColumnShape {
  const match = /^`([^`]+)`\s+((?:enum\([^)]*\)|decimal\([^)]*\)|[a-z]+(?:\(\d+\))?)(?:\s+unsigned)?)\s+(?:COLLATE\s+(\w+)\s+)?(NOT NULL|NULL)(?:\s+DEFAULT\s+(.+))?$/i.exec(line);
  if (!match) throw new Error(`未支持的公共列定义：${table.name} ${line}`);
  const type = sqlType(match[2]), text = /^(?:varchar|char|(?:tiny|medium|long)?text|enum)/.test(type);
  return { name: match[1], type, nullable: match[4] === "NULL", collation: text ? match[3] ?? table.collation : null,
    defaultValue: defaultValue(match[5]) };
}

function foreignKey(line: string) {
  const match = /^CONSTRAINT `([^`]+)`\s+FOREIGN KEY \(([^)]+)\) REFERENCES `([^`]+)`\s*\(([^)]+)\) ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION) ON UPDATE (RESTRICT|CASCADE|SET NULL|NO ACTION)$/i.exec(line);
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

// 原迁移允许多列写在同一行；只在引号和括号外拆逗号，保留ENUM、DECIMAL及复合键原文。
function tableDefinitions(body: string): string[] {
  const definitions: string[] = [];
  let start = 0, depth = 0, quote: string | undefined;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) {
        if (body[index + 1] === quote) index++;
        else quote = undefined;
      }
    } else if (character === "'" || character === '"' || character === "`") quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (character === "," && depth === 0) {
      definitions.push(body.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) throw new Error("公共建表定义括号不匹配");
  }
  if (quote || depth !== 0) throw new Error("公共建表定义引号或括号不匹配");
  definitions.push(body.slice(start).trim());
  return definitions;
}

export function mysqlStructureFromMigrations(migrations: readonly string[]): MysqlTableShape[] {
  const tables = new Map<string, MysqlTableShape>();
  for (const text of migrations) for (const statement of text.replace(/^\s*--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean)) {
    const create = /^CREATE TABLE `([^`]+)`\s*\(([\s\S]+)\) DEFAULT CHARACTER SET utf8mb4 COLLATE (\w+)$/i.exec(statement);
    if (create) {
      if (tables.has(create[1])) throw new Error(`公共表重复定义：${create[1]}`);
      const table: MysqlTableShape = { name: create[1], collation: create[3], columns: [], indexes: [], checks: [], foreignKeys: [] };
      for (const definition of tableDefinitions(create[2])) {
        if (definition.startsWith("`")) table.columns.push(column(definition, table));
        else {
          const primary = /^PRIMARY KEY \(([^)]+)\)$/i.exec(definition);
          const index = /^(UNIQUE INDEX|UNIQUE KEY|INDEX) `([^`]+)`\s*\(([^)]+)\)$/i.exec(definition);
          const check = /^CONSTRAINT `([^`]+)` CHECK \(([\s\S]+)\)$/i.exec(definition);
          if (primary) table.indexes.push({ name: "PRIMARY", columns: names(primary[1]), unique: true });
          else if (index) table.indexes.push({ name: index[2], columns: names(index[3]), unique: index[1] !== "INDEX" });
          else if (check) table.checks.push({ name: check[1], clause: check[2] });
          // 同一受控外键既可在建表内声明，也可由后续ALTER追加；换行不改变约束。
          else if (/^CONSTRAINT `[^`]+`\s+FOREIGN KEY\b/i.test(definition)) table.foreignKeys.push(foreignKey(definition));
          else throw new Error(`未支持的公共表约束：${table.name} ${definition}`);
        }
      }
      tables.set(table.name, table);
      continue;
    }
    const alter = /^ALTER TABLE `([^`]+)`\s+([\s\S]+)$/i.exec(statement);
    if (!alter || !tables.has(alter[1])) throw new Error(`未支持的公共DDL或目标表：${statement.slice(0, 100)}`);
    const table = tables.get(alter[1])!;
    const checkAddition = /^ADD CONSTRAINT `([^`]+)` CHECK \(([\s\S]+)\)$/i.exec(alter[2]);
    if (checkAddition) table.checks.push({ name: checkAddition[1], clause: checkAddition[2] });
    else if (alter[2].startsWith("ADD CONSTRAINT")) table.foreignKeys.push(foreignKey(alter[2].replace(/^ADD /, "")));
    else for (const addition of alter[2].split(/,\s*\n/).map(line => line.trim())) {
      if (!addition.startsWith("ADD COLUMN ")) throw new Error(`未支持的公共ALTER：${addition}`);
      table.columns.push(column(addition.slice("ADD COLUMN ".length), table));
    }
  }
  return [...tables.values()];
}

/** 解析本版平台/Core CHECK的布尔、NULL、范围和修订增量，保留括号优先级；未知运算拒绝比较。 */
export function mysqlCheckShape(clause: string): string | undefined {
  const text = clause.toLowerCase().replace(/`([a-z_]+)`/g, "$1").replace(/_[a-z0-9]+(?=')/g, "");
  const tokens = text.match(/'[^']*'|[a-z_]+|[0-9]+|>=|<=|<>|[(),=<>+]/g) ?? [];
  if (tokens.join("") !== text.replace(/\s+/g, "")) return;
  type Node = string | Node[];
  let at = 0, depth = 0;
  const take = (token: string) => { if (tokens[at++] !== token) throw new Error("未知CHECK语法"); };
  const operand = (): Node => {
    if (tokens[at] === "(") {
      if (++depth > 32) throw new Error("CHECK层级过深");
      take("("); const result = or(); take(")"); depth--; return result;
    }
    const value = tokens[at++];
    if (!value || !/^(?:state|revision|baserevision|resultrevision|configurationrevision|kind|container_type|container_id|[0-9]+|'[a-z_]+')$/.test(value))
      throw new Error("未知CHECK字段");
    return value;
  };
  const addition = (): Node => {
    let result = operand();
    while (tokens[at] === "+") { take("+"); result = ["+", result, operand()]; }
    return result;
  };
  const compare = (): Node => {
    const left = addition(), operator = tokens[at];
    if (operator === "in") {
      take("in"); take("("); const values = [operand()];
      while (tokens[at] === ",") { take(","); values.push(operand()); }
      take(")"); return ["in", left, values];
    }
    if (operator === "between") {
      take("between"); const min = addition(); take("and"); const max = addition();
      return ["and", [">=", left, min], ["<=", left, max]];
    }
    if (operator === "is") {
      take("is"); const not = tokens[at] === "not";
      if (not) take("not"); take("null"); return [not ? "is_not_null" : "is_null", left];
    }
    if ([">=", "<=", "=", "<>", "<", ">"].includes(operator)) { at++; return [operator, left, addition()]; }
    return left;
  };
  const and = (): Node => {
    let result = compare();
    while (tokens[at] === "and") { take("and"); result = ["and", result, compare()]; }
    return result;
  };
  const or = (): Node => {
    let result = and();
    while (tokens[at] === "or") { take("or"); result = ["or", result, and()]; }
    return result;
  };
  try { const result = or(); return at === tokens.length ? JSON.stringify(result) : undefined; }
  catch { return; }
}
