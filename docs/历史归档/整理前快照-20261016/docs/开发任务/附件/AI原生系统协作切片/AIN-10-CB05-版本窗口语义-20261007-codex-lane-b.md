# AIN-10 / CB05：版本窗口截断语义

`HumanKnowledgeService.versions` 现在只在仓储 `limit + 1` 探测未超量时成功返回，并明确 `truncated: false`；不再把“恰好达到上限”误报为存在未返回历史版本。超量仍 fail closed，未新增分页协议。

验证：既有知识组合冒烟 1 pass / 0 fail / 0 skip / 0 todo，退出码 0；`git diff --check` 通过。真实历史分页和 MySQL 未验。
