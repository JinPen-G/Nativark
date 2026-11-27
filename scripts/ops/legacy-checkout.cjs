"use strict";

/** 旧单仓 CLI 的迁址入口。输出固定历史检出步骤，以失败码结束调用。 */
const LEGACY_COMMIT = "46db0945dee92ac916f7265e95948943fc8b641d";
const LEGACY_CHECKOUT_MESSAGE = [
  "此旧 Rental 入口须从固定历史完整检出运行。",
  `请显式创建独立工作树并核对 HEAD 为 ${LEGACY_COMMIT}。`,
  `git worktree add --detach <独占目录> ${LEGACY_COMMIT}`,
  "进入该目录核对锁定依赖、Client 和隔离开发配置，再显式运行原命令。",
].join("\n");

function stopLegacyCommand() {
  console.error(LEGACY_CHECKOUT_MESSAGE);
  process.exit(1);
}

if (require.main === module) stopLegacyCommand();

module.exports = { LEGACY_CHECKOUT_MESSAGE, stopLegacyCommand };
