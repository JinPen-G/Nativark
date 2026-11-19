/** 为宿主组合公共与所选Core的Prisma源码；不读取环境、不生成客户端或执行迁移。
 * Core只提供自有模型/枚举和显式公共关系，公共标量、索引及生成器由底座维护。 */
import { CoreIdSchema } from "./manifest";

export type CorePrismaPublicRelations = Readonly<Record<string, readonly string[]>>;
export interface CorePrismaContribution {
  readonly id: string;
  readonly schema: string;
  readonly publicRelations?: CorePrismaPublicRelations;
}

interface SchemaBlock { kind: string; name: string; text: string }
function schemaBlocks(source: string): SchemaBlock[] {
  const pattern = /^(model|enum|generator|datasource)\s+(\w+)\s*\{[\s\S]*?^\}/gm;
  const blocks = [...source.matchAll(pattern)]
    .map(match => ({ kind: match[1], name: match[2], text: match[0] }));
  if (source.replace(pattern, "").replace(/^\s*\/\/.*$/gm, "").trim())
    throw new Error("Prisma贡献包含未识别的顶层声明");
  return blocks;
}

/** 返回新的组合源码；Core卸载和历史数据处理另走生命周期，不在这里删除事实。 */
export function composeCorePrismaSchema(platform: string, cores: readonly CorePrismaContribution[]): string {
  const publicBlocks = schemaBlocks(platform);
  if (publicBlocks.filter(block => block.kind === "datasource").length !== 1
    || publicBlocks.filter(block => block.kind === "generator").length !== 1)
    throw new Error("公共Prisma源码须提供唯一数据源和客户端生成器");
  const names = new Set<string>(), ids = new Set<string>();
  const register = (block: SchemaBlock) => {
    if (names.has(block.name)) throw new Error(`Prisma声明重复：${block.name}`);
    names.add(block.name);
  };
  publicBlocks.forEach(register);
  const selected = cores.map(core => {
    CoreIdSchema.parse(core.id);
    if (ids.has(core.id)) throw new Error(`Prisma贡献的Core重复：${core.id}`);
    ids.add(core.id);
    const blocks = schemaBlocks(core.schema);
    for (const block of blocks) {
      if (block.kind !== "model" && block.kind !== "enum")
        throw new Error(`Core不能提供Prisma生成器或数据源：${core.id}.${block.name}`);
      register(block);
    }
    return { core, blocks, models: new Set(blocks.filter(block => block.kind === "model").map(block => block.name)) };
  });
  const publicModels = new Map(publicBlocks.filter(block => block.kind === "model").map(block => [block.name, block]));
  for (const { core, models } of selected) for (const [name, fields] of Object.entries(core.publicRelations ?? {})) {
    const block = publicModels.get(name);
    if (!block) throw new Error(`未知公共关系目标：${core.id}.${name}`);
    const existing = new Set(block.text.split(/\r?\n/).flatMap(line => {
      const field = /^\s*(\w+)\s+\w/.exec(line);
      return field ? [field[1]] : [];
    }));
    for (const field of fields) {
      const parsed = /^(\w+)\s+(\w+)(?:\?|\[\])?(?:\s+@relation\([\s\S]+\))?$/.exec(field);
      if (!parsed || /[\r\n{};]/.test(field) || !models.has(parsed[2]) || existing.has(parsed[1]))
        throw new Error(`公共关系扩展冲突或无效：${core.id}.${name}.${field}`);
      // 仅沿用公共表已有标量。Core迁移负责追加约束，不能借关系声明新增公共列。
      const scalarFields = /fields:\s*\[([^\]]+)\]/.exec(field)?.[1].split(",").map(value => value.trim()) ?? [];
      if (scalarFields.some(value => !existing.has(value)))
        throw new Error(`公共外键缺少原字段：${core.id}.${name}.${parsed[1]}`);
      existing.add(parsed[1]);
    }
    block.text = block.text.replace(/\}\s*$/, fields.map(field => `  ${field}`).join("\n") + "\n}");
  }
  return [...publicBlocks, ...selected.flatMap(core => core.blocks)].map(block => block.text).join("\n\n") + "\n";
}
