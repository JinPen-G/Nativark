/** 只输出元数据，不创建文件、连接数据库、挂载 HTTP 或授权角色。 */
import { createManifest } from "./manifest";
import { createOpenApi } from "./http";

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "manifest" && args.length === 2)
    process.stdout.write(JSON.stringify(createManifest({ repository: args[0], commit: args[1] }), null, 2) + "\n");
  else if (command === "openapi" && !args.length)
    process.stdout.write(JSON.stringify(createOpenApi(), null, 2) + "\n");
  else throw new Error("用法：metadata.js manifest <Core仓库HTTPS地址> <固定提交>；metadata.js openapi");
} catch (error) { console.error(error instanceof Error ? error.message : "元数据生成失败"); process.exitCode = 1; }
