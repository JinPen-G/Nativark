/** 将同一业务合同输出为可打包元数据；stdout只写JSON，不执行服务或覆写文件。 */
import { createTicketsManifest } from "./manifest";
import { createTicketsOpenApi } from "./openapi";

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "openapi" && !args.length) process.stdout.write(`${JSON.stringify(createTicketsOpenApi(), null, 2)}\n`);
  else if (command === "manifest" && args.length === 2)
    process.stdout.write(`${JSON.stringify(createTicketsManifest({ repository: args[0], commit: args[1] }), null, 2)}\n`);
  else throw new Error("用法：metadata.js openapi；或 metadata.js manifest <仓库HTTPS地址> <固定提交>");
} catch (error) {
  console.error(error instanceof Error ? error.message : "工单元数据生成失败");
  process.exitCode = 1;
}
