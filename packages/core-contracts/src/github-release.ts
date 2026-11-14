/** 显式读取公开GitHub Release或准备其标准包；不会自动部署、安装依赖或读取本机Key。 */
import { readFileSync } from "node:fs";
import { CoreHostVersionsSchema } from "./compatibility";
import { GitHubCoreReleasePinSchema, GitHubCoreReleaseSelectionSchema, inspectGitHubCoreRelease, prepareGitHubCoreRelease } from "./github";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  let result: unknown;
  if (command === "inspect" && (args.length === 3 || args.length === 4)) {
    const [repository, coreId, version, tag = `v${version}`] = args;
    const selection = GitHubCoreReleaseSelectionSchema.parse({ repository: `https://github.com/${repository}`, coreId, version, tag });
    result = await inspectGitHubCoreRelease(selection);
  } else if (command === "prepare" && args.length === 3) {
    const pin = GitHubCoreReleasePinSchema.parse(JSON.parse(readFileSync(args[0], "utf8")));
    const host = CoreHostVersionsSchema.parse(JSON.parse(readFileSync(args[2], "utf8")));
    result = await prepareGitHubCoreRelease(pin, args[1], host);
  } else throw new Error("用法：github-release.js inspect <owner/repo> <Core ID> <版本> [Tag]；或 github-release.js prepare <固定Release JSON> <既有独占待部署根目录> <宿主版本JSON>");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "GitHub Release读取或准备失败");
  process.exitCode = 1;
});
