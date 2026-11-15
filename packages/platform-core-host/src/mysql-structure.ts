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
const names = (list: string) => [...list.matchAll(/`([^`]+)`/g)].map(match => match[1]);
const sqlType = (value: string) => value.toLowerCase().replace(/^boolean$/, "tinyint(1)").replace(/^integer$/, "int").replace(/,\s+/g, ",");
const defaultValue = (value: string | undefined): string | null => value === undefined || /^null$/i.test(value) ? null
  : /^true$/i.test(value) ? "1" : /^false$/i.test(value) ? "0" : value.replace(/^'(.*)'$/, "$1").toLowerCase();

function column(line: string, table: MysqlTableShape): MysqlColumnShape {
  const match = /^`([^`]+)`\s+((?:enum\([^)]*\)|decimal\([^)]*\)|[a-z]+(?:\(\d+\))?)(?:\s+unsigned)?)\s+(?:COLLATE\s+(\w+)\s+)?(NOT NULL|NULL)(?:\s+DEFAULT\s+(.+))?$/i.exec(line);
  if (!match) throw new Error(`未支持的公共列定义：${table.name} ${line}`);
  const type = sqlType(match[2]), text = /^(?:varchar|char|text|enum)/.test(type);
  return { name: match[1], type, nullable: match[4] === "NULL", collation: text ? match[3] ?? table.collation : null,
    defaultValue: defaultValue(match[5]) };
}

function foreignKey(line: string) {
  const match = /^CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]+)\) REFERENCES `([^`]+)`\(([^)]+)\) ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION) ON UPDATE (RESTRICT|CASCADE|SET NULL|NO ACTION)$/i.exec(line);
  if (!match) throw new Error(`未支持的公共外键定义：${line}`);
  return { name: match[1], columns: names(match[2]), targetTable: match[3], targetColumns: names(match[4]), deleteRule: match[5], updateRule: match[6] };
}

export function mysqlStructureFromMigrations(migrations: readonly string[]): MysqlTableShape[] {
  const tables = new Map<string, MysqlTableShape>();
  for (const text of migrations) for (const statement of text.replace(/^\s*--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean)) {
    const create = /^CREATE TABLE `([^`]+)`\s*\(([\s\S]+)\) DEFAULT CHARACTER SET utf8mb4 COLLATE (\w+)$/i.exec(statement);
    if (create) {
      if (tables.has(create[1])) throw new Error(`公共表重复定义：${create[1]}`);
      const table: MysqlTableShape = { name: create[1], collation: create[3], columns: [], indexes: [], checks: [], foreignKeys: [] };
      for (const definition of create[2].split(/,\s*\n/).map(line => line.trim()).filter(Boolean)) {
        if (definition.startsWith("`")) table.columns.push(column(definition, table));
        else {
          const primary = /^PRIMARY KEY \(([^)]+)\)$/i.exec(definition);
          const index = /^(UNIQUE INDEX|UNIQUE KEY|INDEX) `([^`]+)`\s*\(([^)]+)\)$/i.exec(definition);
          const check = /^CONSTRAINT `([^`]+)` CHECK \(([\s\S]+)\)$/i.exec(definition);
          if (primary) table.indexes.push({ name: "PRIMARY", columns: names(primary[1]), unique: true });
          else if (index) table.indexes.push({ name: index[2], columns: names(index[3]), unique: index[1] !== "INDEX" });
          else if (check) table.checks.push({ name: check[1], clause: check[2] });
          else throw new Error(`未支持的公共表约束：${table.name} ${definition}`);
        }
      }
      tables.set(table.name, table);
      continue;
    }
    const alter = /^ALTER TABLE `([^`]+)`\s+([\s\S]+)$/i.exec(statement);
    if (!alter || !tables.has(alter[1])) throw new Error(`未支持的公共DDL或目标表：${statement.slice(0, 100)}`);
    const table = tables.get(alter[1])!;
    if (alter[2].startsWith("ADD CONSTRAINT")) table.foreignKeys.push(foreignKey(alter[2].replace(/^ADD /, "")));
    else for (const addition of alter[2].split(/,\s*\n/).map(line => line.trim())) {
      if (!addition.startsWith("ADD COLUMN ")) throw new Error(`未支持的公共ALTER：${addition}`);
      table.columns.push(column(addition.slice("ADD COLUMN ".length), table));
    }
  }
  return [...tables.values()];
}

/** 只解析本版平台CHECK的布尔/NULL/范围表达式，保留括号优先级；未知运算拒绝比较。 */
export function mysqlCheckShape(clause: string): string | undefined {
  const text = clause.toLowerCase().replace(/`([a-z_]+)`/g, "$1").replace(/_[a-z0-9]+(?=')/g, "");
  const tokens = text.match(/'[^']*'|[a-z_]+|[0-9]+|>=|<=|<>|[(),=<>]/g) ?? [];
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
    if (!value || !/^(?:state|revision|kind|container_type|container_id|[0-9]+|'[a-z_]+')$/.test(value))
      throw new Error("未知CHECK字段");
    return value;
  };
  const compare = (): Node => {
    const left = operand(), operator = tokens[at];
    if (operator === "in") {
      take("in"); take("("); const values = [operand()];
      while (tokens[at] === ",") { take(","); values.push(operand()); }
      take(")"); return ["in", left, values];
    }
    if (operator === "between") {
      take("between"); const min = operand(); take("and"); const max = operand();
      return ["and", [">=", left, min], ["<=", left, max]];
    }
    if (operator === "is") {
      take("is"); const not = tokens[at] === "not";
      if (not) take("not"); take("null"); return [not ? "is_not_null" : "is_null", left];
    }
    if ([">=", "<=", "=", "<>", "<", ">"].includes(operator)) { at++; return [operator, left, operand()]; }
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
