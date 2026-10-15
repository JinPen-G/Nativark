# AIN-10 / CB05：版本内容读取上限

`PrismaKnowledgeRepository.versions` 现在会拒绝超过 200 个 chunk 或单版本正文累计超过 200,000 字符的历史版本；原先 `take: 201` 的探测结果没有检查，可能静默截断。版本数仍使用 `limit + 1` 超量检测，未引入新存储或分页协议。

验证：既有知识组合冒烟 1 pass / 0 fail / 0 skip / 0 todo，退出码 0；`git diff --check` 通过。真实数据库查询计划和 MySQL 行锁未验。
