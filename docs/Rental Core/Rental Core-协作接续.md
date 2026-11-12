# Rental Core 协作接续

更新时间：2026-11-12。

> 本轮由负责人通过PM正式授权Core研发负责人在指定工作树恢复核心开发。主线为品类治理原CAT-GOV-01～14全部收口，同时独立核实本册原十二项CLOSE及对企业/AI的必要Core接点；不混算进度、不扩大为PCH。日常任务分支精确提交/普通推送持续获准；最新安排为每个可独立验证阶段交固定SHA，由PM串行收回main，不等待两个完整任务。禁止新增/扩写测试脚本，采用已有定向冒烟、短命令及必要类型检查；本轮不含真实环境、依赖安装、迁移、部署或生产启用许可。

## 1. 目标与依据

按[需求](<Rental Core-需求.md>)和[原12项CLOSE任务](<Rental Core-开发任务.md>)完成通用租赁闭环；完整业务条款仍见[平台需求](../管理后台/管理后台-需求.md)。[记录](<Rental Core-开发记录.md>)承接证据入口，不另造总计划。

品类定义/发布/采用/动态编码见子目录[品类治理接续](品类治理/品类治理-协作接续.md)；跨行业Core接入见[平台专项](../平台底座/Core接入/平台Core接入-协作接续.md)。两者不能替代原CLOSE工作。

## 2. 现场和写入归属

- 唯一开发树：`D:/工作文件/rental-OS/worktree/rental-core`，分支`codex/rental-core`。当前读取侧修订校验固定`cb96a636b`由PM仅按解析器差异核收，原完整resolver断言、五组绑定行为和main API类型通过，见[固定阶段](<Rental Core-开发记录.md#workspace-resolver-main-integration-20261112>)；写锁修复已收main`307abf572`。照片固定`e2a1a2b9d`已随企业阶段收main`3cf502b7c`，七组恢复有独立限定证据。Core继续同源定义/全部写入口/08存量采用和原CLOSE；配置counter/17只读接点与Outbox完整捕获仍须按各自固定来源和未完项核接，不追活动main，不停工等PM。原财务核定到期来源的Core纯decoder与Platform原`recordMaturity`/`readMaturity`必要委托窗口已由PM明确核准，原actor/审计时间、key/锁及operator/staff门闸保持，企业投影第二阶段尚需固定合同与最小窗口。旧开工/换货及恢复证据原位保留，不得回main施工或重建旧树。
- Core负责人可写Core专属实现、shared对应领域协议和必要既有接点；共同总入口先报具体字段/路径，由PM指定唯一作者。AI runner和企业政策/审批内部实现归各自研发，企业端消费原Core，不复制账本或计价逻辑。本轮无额外助手。
- 主树、AI及企业树的并行成果保留，不追活动HEAD、不夹带他人WIP。固定整合按来源SHA及受影响路径核对；原63项审查全文仍见[平台开发记录](../管理后台/管理后台-开发记录.md#review-63)，不由旧状态推定当前已完成。
- main已接`0947a6eb8`的16份换货Core增量及`2a2c9ae64`四份固定记录/接续，具体范围与类型/14项短调用证据见[PM整合](<Rental Core-开发记录.md#approved-exchange-main-integration-20261111>)；照片和企业参与者后继已按上述固定阶段接入，其他Core配置/唯一声明父阶段仍待各自消费者核收。HTTP/DI源码接入不等于真实环境验收。25份原JSON证据已迁至主树唯一`D:/工作文件/rental-OS/output/category-governance/`，本树相应旧证据链接须按该位置读取，不复制第二份。原任务及真实验收缺口保持。
- PM固定维护`6b2dd0a`已在本树整合；当前受管Shared202文件、固定`0947a6eb8`的API863文件已核哈希，未混入照片WIP。客户小程序原242文件/22页面结果、31项原冒烟17过/14失败、采用/配置读取及其他原失败保留，不计CLOSE进度。当前构建及原五项3过/2失败见[本片记录](<Rental Core-开发记录.md#approved-exchange-core-port-20261111>)，企业读取/客户前片沿原证据。公共工具只读使用，同树两个包别名不跨树共享；暂存已删除。真库/宿主/供应商仍未验。

## 3. 下一入口与原缺口

PM已核main`212df5bd6`包含企业原补款/政策比较及AI展示/订单消费者，本次只接Core固定`b659aa857`的两份批次源码与四份记录/接续，原两脚本、九类坏回执和main共享/API类型通过，见[批次整合](<Rental Core-开发记录.md#pm-preparation-receipt-integration-20261112>)。六项他人WIP保留；a0/619仍待原固定依赖，不取整份父文件。Core继续两个新续租报价真实无服务空快照及纯保证金普通换货门闸，随后优先AIN-17四入口counter/原tx参加者；企业/AI继续自己的核心消费者，不等整项。原依赖冲突及最小窗口见[PM协调](<Rental Core-开发记录.md#pm-core-intake-and-dependencies-20261112>)。

1. 沿[品类治理接续](品类治理/品类治理-协作接续.md)推进治理发布、新编码/新空间及端消费，08存量主链独立必做。当前治理已复用原Auth平台身份/权限，由Core承担Serializable与前后检查，见[当前阶段](品类治理/品类治理-开发记录.md#governance-current-authority-20261111)；真实锁/发布/恢复继续未验。
2. 原十二项CLOSE首轮静态核实见[本轮记录](<Rental Core-开发记录.md#core-resume-20261110>)：实际用量/完整免赔、非实物/停租/结算后追加及真实预授权仍有实现缺口，其余保留原真实证据门槛。旧状态仅是2026-10-18口径，不新增分数，不计入CAT-GOV分母。
3. 企业作者正在消费[固定换货端口](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)和[企业参与合同](../../apps/api/src/modules/rental-core/approved-exchange-transaction.ports.ts)。Core商户执行与客户端 `material/confirm/original` 保持各自原身份；企业作者负责批准参与者、本人明确提交及其服务/页面，公共登记/DI窗口由PM指定。照片未冻结保持不可接受；下一口是既有专用文件来源的内容冻结和按原目标核对，不等待真库才交已验证端口，原K/C不能换键重做。源码/类型、11组受限调用、原五项3过/2失败和静态契约边界见[当前记录](<Rental Core-开发记录.md#approved-exchange-core-port-20261111>)。
4. ECP-09/10的[Core当前空间读端口](../../apps/api/src/modules/rental-core/rental-enterprise-read.port.ts)及原48行共享投影仍归Core；PM已按固定`527e731c8`逐blob核实，声明企业17f4f9887及前置已收回并核GitHub main `917a92a1a41caadc1180e8c8b2c8dc0b596c748f`，未取活动换货代码。其DI/登记/消费者已有源码和离线结果，真实HTTP、完整ECP仍待验；本树不追活动main。历史跨空间、全账户其他空间、正式账单/核定到期及保证金专用读源仍不可用，不另算账。企业 `readerCursor/readerAudit` 仅其既有审计段，不占本片租赁合同。按负责人明确交接给企业可消费固定SHA；不以他树环境许可运行本树服务。
5. 非关键路径CLOSE依原任务留后续，保持用量/免赔、特殊结案、停租、车辆后发现费用、真实保证金及安全的完整门槛。历史CORE-019片不覆盖存量账务、企业原回款冲销或真实供应商保证金。

## 4. 验证与交付边界

代码/类型、离线行为、真实事务、供应商、后台/微信宿主及正式放行分别登记。缺原事实/权限保持拒绝或待核对；不以模拟或缺金额=零补生产依赖。本树已自持Client/Shared/API产物并取得类型及定向离线证据；[规则/日历草稿接点](品类治理/品类治理-开发记录.md#bound-draft-category-context-20261111)也已复核，原场景失败及真实验收缺口保留，不能计为CLOSE完成。记录与接续同步实际证据，不用阶段提交、默认关闭或测试数量判完成；本轮前像由开工Git提交保全。
