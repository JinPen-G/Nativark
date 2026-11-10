# AI Native：当前协作接续

> 更新日期：2026-11-10。当前唯一整合入口为`D:/工作文件/rental-OS`的`main`。覆盖前原文见[前像清单](../../output/other-worktrees-consolidation-20261110/main-docs-before/manifest.json)，原未解决事项全文仍见[开发记录](<AI Native-开发记录.md#ain-three-tree-preserved-open-items-20261109>)。旧派工、心跳和完成声明不恢复fork施工或外部访问许可。

## 当前目标与结果

负责人明确授权将AI Native三树及五棵指定工作树成果合入main，再普通推送GitHub；随后要求保留main和AI主树，删除其余工作树。源码归集与合并问题修复已完成；清理后发现的main文件缺失已经恢复，当前复验仍有本地依赖缺件，不能沿用清理前绿色声明全部通过。准确提交与远端核对见[交付回执](../../output/other-worktrees-consolidation-20261110/final-receipt.json)。两侧保持停写，不扩展新功能。工作树目录与登记仅保留main和AI主树；D盘Windows残留尚未物理删除，见[清理回执](../../output/other-worktrees-consolidation-20261110/worktree-removal-result.json)。

原订单人工交接、显式只读政策、首字/首卡宿主，以及原报价再准备、optional runId、订单材料、会员和日历消费者都已进入main。企业成员/门户、MCP/Harness和网站按固定快照核接，文档树已在祖先链。冻结后无新增源码/status差异，七份原稿档案哈希匹配；来源和实际归档位置见[逐树核对](../../output/other-worktrees-consolidation-20261110/source-and-archive-final-audit.json)。旧设计、日志和隔离产物不替代运行依赖或业务验收。

修复、验证及历史失败见[本阶段记录](<AI Native-开发记录.md#ain-main-consolidation-20261110>)和[验证回执](../../output/other-worktrees-consolidation-20261110/validation/summary.json)。原Guard/ALS、当前范围、Core事实、独立批准及unknown原收据边界保持；本次不据合并新增AIN/ENTRY的100%，进度只在[任务册](<AI Native-开发任务.md>)维护。

## 主树与写入归属

主仓库分支为`main`，五树合并基线为`9f5c72f0239f691b07ed4acca5842a1c9d8f74ed`，合后修复另成提交。AI主树HEAD/WIP保留原现场；其余原稿在D盘档案，固定快照提交已在main祖先链，旧SHA不是reset目标。恢复AI主树施工前须从最终main按固定成果核接，不能把保留原现场当作已同步到最新main。

| 位置 | 当前职责 |
| --- | --- |
| `D:/工作文件/rental-OS`／`main` | 本对话负责最终整合、公共契约/装配与唯一四册，后续从当前main接手 |
| `claude-ai-native-foundation` | 原主开发树，成果已归main，保留原现场 |
| 原`claude-ain08-facts-20261105`／ag-服务端1 `01a1bf34-f061-74c2-b588-3e21385c4b49` | 成果已归main和D盘档案，原工作目录按授权移除；不得自行重建、恢复开发或同步公共文件 |
| 原`claude-ai-native-gateway-closeout-20261106-src`／ag-服务端2 `01a1bf35-1ee5-7400-a97d-c0ebf5f9482c` | 成果已归main和D盘档案，原工作目录按授权移除；不得自行重建、恢复开发或验证 |

两侧如发现未交出的源码、归属冲突或真实阻塞，应立即向主对话`01a1be68-da55-7f13-9536-79be07cb2093`报告原任务号、固定路径与错误证据；旧Goal不自动恢复。本次停止指令已送达，但两侧新回合均因模型供应商资源不匹配失败，不能宣称已取得Goal暂停回执，见[停止状态](../../output/other-worktrees-consolidation-20261110/fork-stop-state.json)。其余专项当前缺口分别在企业、MCP、Harness和预约网站的现行接续维护。

## 后续核心入口及未完项

1. **原AIN-15报价再准备：** 后端只读定位和[会话WIP](../../apps/admin/src/features/ai-native/quote-reprepare-session.ts)已保留、类型通过；服务端原再准备→新批准→Core单次订单→丢失应答原收据链通过本次离线冒烟。仍缺新材料发起、完整前端选择/对比及其端到端消费。不要让用户手填Step/ActionInput/planHash；unknown只核原操作，不换键重发。入口和前像在`output/ain-human-reprepare-locator-core-20261110/`，前置正向链见[原报价选单阶段](<AI Native-开发记录.md#ain-conversation-quote-selection-core-20261109>)。
2. **原AIN-13/ENTRY-05人工交接及只读政策：** 新代码已合回，完整消费者行为尚未独立收口。仅显式管理员配置原read_metadata/read_events/read_step_terminal政策，不自动种政策、不授模型或Core执行；保留原CAS、TTL、当前权限及三项独立原收据，部分/unknown不得重发。侧树原验证结果与候选均在主树成果档案内，不能借作者的绿色替代主树验收。
3. **原AIN-25：** 真实首字/首卡组件及关闭、重开、React效果重放代码已回收，一组离线宿主冒烟通过；真实浏览器可见性、完整场景、容量/SLO、队列/背压/公平性/告警仍需原门槛。客户端报告不成为经营或计费事实；原11同账与累计资源要求保持。
4. **其余原任务：** 05→06→07完整供应商/能力/往返及故障前置、12/13～16完整Agent和多角色资料隔离、17～28可靠事件/知识隐私/员工与平台治理/组合灰度及交付缺口均保留，详见[原28项摘要](<AI Native-开发记录.md#原28项当前实施摘要>)和[完整未完原文](<AI Native-开发记录.md#ain-three-tree-preserved-open-items-20261109>)。不重开已有100%条目，不新增Reserved或边缘能力。
5. **客户与ENTRY：** 当前两端三Action以原证据为准；六不可用Action、其他audience、匿名/企业、跨surface重绑定、媒体弱网及真实设备仍需完成。详见[ENTRY摘要](<AI Native-开发记录.md#entry-增量实施摘要>)，不以档案/报告数量或本次局部绿色加分。

以上保留原任务范围、编号、依赖和验收；恢复功能施工须沿负责人当次授权。每个完整核心切片只做必要定向冒烟和类型检查，跨原G1～G4门槛后维护唯一任务表；未跨档的缺口留记录，不能把合并或档案数量当100%。

## 验证与资源边界

本次使用main原离线preload、固定不可达数据库地址、main/output内audit/TEMP/cache及从当前schema生成的隔离Prisma Client。清理前shared两个出口、MCP和插件在私有目录构建通过；清理后MCP复验只读使用保留AI主树的原SDK依赖，验证源码仍来自main。恢复后企业状态13项、MCP4项、网站1项及员工绑定类型通过；API/后台/企业端/网站完整类型和报价、B02组合未复验通过，当前缺少Nest、UI及ts-node所需包。具体失败见[恢复后回执](../../output/other-worktrees-consolidation-20261110/validation/post-recovery/summary.json)，须先获准恢复锁定依赖再复验失败范围。Git提交/推送按负责人本轮明确授权执行。

类型、构建和定向离线行为不代表真实宿主、数据库、供应商、整项G4或发布通过；本次没有安装、启服务、浏览器/微信、真实HTTP/DB/DNS/模型/支付/对象存储、迁移或部署。旧环境和失败证据保持，文档导航三条既有历史缺链不伪造补绿。
