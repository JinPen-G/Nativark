/** 开发能力查询命令，只读源码并输出资料；0=查询成功，1=检查有缺口，2=用法/读取失败。 */
import { resolve } from "node:path";
import { DevelopmentCapabilityKindSchema, queryDevelopmentCapabilities, type DevelopmentCapabilityQuery } from "./development";
import { buildRepositoryCapabilityIndex } from "./repository-index";

const args = process.argv.slice(2);
const query: DevelopmentCapabilityQuery = {};
let directory = process.cwd(), json = false, check = false;

try {
  for (let position = 0; position < args.length; position++) {
    const argument = args[position];
    if (argument === "--json") json = true;
    else if (argument === "--check") check = true;
    else if (["--repo", "--query", "--id", "--kind", "--owner", "--offset", "--limit"].includes(argument)) {
      const value = args[++position];
      if (value === undefined || value.startsWith("--")) throw new Error(`${argument} 需要一个值`);
      if (argument === "--repo") directory = resolve(value);
      else if (argument === "--kind") query.kind = DevelopmentCapabilityKindSchema.parse(value);
      else if (argument === "--offset" || argument === "--limit") {
        if (!/^\d+$/u.test(value)) throw new Error(`${argument} 需要整数`);
        query[argument === "--offset" ? "offset" : "limit"] = Number(value);
      } else query[argument.slice(2) as "query" | "id" | "owner"] = value;
    } else throw new Error(`无法识别参数 ${argument}`);
  }
  const index = buildRepositoryCapabilityIndex(directory);
  const result = queryDevelopmentCapabilities(index, query);
  if (json) process.stdout.write(JSON.stringify(result) + "\n");
  else {
    console.log(`开发能力索引，共 ${result.total} 项，当前条件匹配 ${result.matched} 项。`);
    if (result.source.workingTreeChanged) console.log("本次读取包含未提交修改。");
    for (const source of result.coverage.notPresent) console.log(`${source.source} [not_present] 未检出，尚未读取`);
    for (const source of result.coverage.partial) console.log(`${source.source} [partial] 尚有未读取或未解析范围`);
    for (const capability of result.capabilities) {
      console.log(`\n${capability.name} (${capability.kind})\n${capability.id}`);
      if (capability.description) console.log(capability.description);
      if (capability.entry?.kind === "import") console.log(`导入 ${capability.entry.module} 的 ${capability.entry.symbol}${capability.entry.typeOnly ? "（类型）" : ""}`);
      if (capability.entry?.kind === "http") console.log(`${capability.entry.method} ${capability.entry.path}`);
      if (capability.entry?.kind === "page") console.log(capability.entry.path);
      for (const source of capability.sources) console.log(`${source.path}${source.line ? `:${source.line}` : ""}`);
    }
    if (result.nextOffset !== null) console.log(`\n下一页使用 --offset ${result.nextOffset}`);
    for (const issue of result.issues) console.log(`${issue.path} [${issue.code}] ${issue.message}`);
  }
  process.exitCode = check && (result.issues.length || result.coverage.partial.length || result.coverage.notPresent.length) ? 1 : 0;
} catch (error) {
  const message = error instanceof Error ? error.message : "能力索引读取失败";
  if (json) process.stdout.write(JSON.stringify({ audience: "development", error: message }) + "\n");
  else console.error(message);
  process.exitCode = 2;
}
