/** 显式读取公开GitHub Release或准备其标准包；不会自动部署、安装依赖或读取本机Key。 */
import { readFileSync } from "node:fs";
import { CoreHostVersionsSchema } from "./compatibility";
import { GitHubCoreReleasePinSchema, GitHubCoreReleaseSelectionSchema, createGitHubCoreDiscovery, inspectGitHubCoreRelease, prepareGitHubCoreRelease } from "./github";
import { inspectGitHubCoreRepository } from "./github-repository";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  let result: unknown;
  if (command === "discover" && args.length <= 2) {
    const discovery = await createGitHubCoreDiscovery()({ text: args[0] ?? "", page: args[1] === undefined ? 1 : Number(args[1]) });
    result = discovery;
    if (discovery.status === "unavailable") process.exitCode = 1;
  } else if (command === "repository" && (args.length === 1 || args.length === 2 && args[1] === "--releases")) {
    result = await inspectGitHubCoreRepository(`https://github.com/${args[0]}`, { includeReleases: args[1] === "--releases" });
  } else if (command === "inspect" && (args.length === 3 || args.length === 4)) {
    const [repository, coreId, version, tag = `v${version}`] = args;
    const selection = GitHubCoreReleaseSelectionSchema.parse({ repository: `https://github.com/${repository}`, coreId, version, tag });
    result = await inspectGitHubCoreRelease(selection);
  } else if (command === "prepare" && args.length === 3) {
    const pin = GitHubCoreReleasePinSchema.parse(JSON.parse(readFileSync(args[0], "utf8")));
    const host = CoreHostVersionsSchema.parse(JSON.parse(readFileSync(args[2], "utf8")));
    result = await prepareGitHubCoreRelease(pin, args[1], host);
  } else throw new Error("用法：github-release.js discover [关键词] [页码]；repository <owner/repo> [--releases]；inspect <owner/repo> <Core ID> <版本> [Tag]；prepare <固定Release JSON> <既有独占待部署根目录> <宿主版本JSON>");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "GitHub Release读取或准备失败");
  process.exitCode = 1;
});
