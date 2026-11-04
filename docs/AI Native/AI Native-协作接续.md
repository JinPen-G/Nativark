# AI Native：当前协作接续

> 更新日期：2026-11-04。负责人要求的顺序是先修原63项，再逐编号二次确认并修复Codex28项及独立押金缺口，随后在本主树连续推进原AI Native任务。两份问题清单现已按原触发收口；正式任务仍须逐项满足原门槛，不以局部绿色或无需真人签字直接改100%。

## 当前目标与权威入口

负责人已将已删除会话的AIN-02职责交给新fork“AI Native主线-服务端 (A)”，继续集中完整任务收口，不恢复旧loop。网站正式出口修复`21d6af2e`保留；网站/微信各17条已装配方法的34条出版缺口、客户独立schema及四种取消响应的精确uint64上界已补并定向复验。当前校验输入、提交状态、固定SHA及范围从[本片交付清单](../../output/takeover-20261102-ed5rs4ug/ain02-A-20261104-ttlbxqsq/delivery.json)核对；完整阶段证据统一在[集中收口阶段](<AI Native-开发记录.md#ain02-consumer-contract-closeout-20261104>)，不在接续重复测试流水。原AIN-02仍75%，剩余同一冻结基线的完整生产者/消费者/版本与证据复核及跨AI全文确认；此前停止的核查没有结论，不将AIN-12完整聊天/沙箱执行倒作合同前置。

源“AI Native主线-服务端”继续独立AIN-08只读可用性片；新A独占AIN-02客户出版、原两份验证及记录/接续，任务表仅跨原门槛后更新百分比，需求正文不改。源会话AIN-08成果仍须按其固定交付核验，不能夹入A的提交。其他客户端文件归属仍按具体文件核验，不凭idle/无diff/未送达消息接管。原63/Codex28与独立押金触发已收口，不恢复旧队列。对话历史/生命周期/原受理日志、关闭及轮换、订单首次模型执行与原结果均保留；局部开业只到Task元数据，未接开业执行/事实/采用；订单仍缺其他能力/旧历史接手/完整恢复消费。unknown始终按原键读取，日志不授权限；清理、隐藏、取消请求和TTL均不证明未消耗。需求v1.14/任务v1.18及G1～G4不变，本轮未启浏览器/真实服务、迁移、外联、推送/合main或生产启用。

- 正式范围、依赖和唯一百分比表：[需求](<AI Native-需求.md>)、[开发任务](<AI Native-开发任务.md>)。本修复阶段未调整任务正文或百分比。
- 已做/剩余及证据：[原28项实施摘要](<AI Native-开发记录.md#原28项当前实施摘要>)、[ENTRY摘要](<AI Native-开发记录.md#entry-增量实施摘要>)及同页完整阶段；AIN-02最近入口为[集中收口阶段](<AI Native-开发记录.md#ain02-consumer-contract-closeout-20261104>)。
- 原63项与Codex28项/押金修复的完整阶段、实际命令和未验边界统一在[原业务记录](../管理后台/管理后台-开发记录.md#local-integration-20261101)，[后台现行接续](../管理后台/管理后台-协作接续.md)定位业务余项。原63及后继29项已在对话原生Code Review UI标fixed，不新增MD问题表；这不是全库修后独立审查或正式专项验收。
- 项目组成与阅读路线：[README](../../README.md)、[开发指南](../公共技术资料/开发指南/项目-开发指南.md#25-跨模块阅读路线)、[AGENTS](../../AGENTS.md)。
- 原文追溯：[2026-10-28整理前接续](<AI Native-开发记录.md#接续原文保全2026-10-28>)、[本次精简前原文及哈希](../../output/repair-current-20261101-uotDQk/handoff-before-codex-ej7q0775/manifest.json)。历史“58+5开放/Codex后置”只定位当时阶段，不能恢复为当前队列。

## 工作树与写入归属

| 项目 | 当前定位与限制 |
| --- | --- |
| 唯一施工树 | `D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`，分支`ai/ai-native-contracts-s01-20261002`，已固定合同批次`fae3d20a`/`8375ebf9`/`cb7971eb`/`6614b4eb`；当前HEAD及未提交归属以Git核验为准 |
| 服务端本片 | 新fork“AI Native主线-服务端 (A)”接替已删除旧会话，独占AIN-02：客户HTTP schema、entry-management取消边界、shared/index、API leaf/OpenAPI、原publication/scene-host测试及记录/接续。源“AI Native主线-服务端”独占AIN-08 Core/availability/read composition/tools/catalog-runner及相关测试WIP；固定范围见[库存切片](<AI Native-开发记录.md#ain08-bounded-availability-20261104>)。共享index/提交互斥，不夹带对方源码；当前HEAD/提交状态按Git及本片清单核对 |
| 并行客户端 | 原前端/MCP/Harness后继归原会话，本次整合的固定保全已接入；只协调具体文件冲突，不凭idle或共享文件接管其工作 |
| 固定整合 | 根目录修复`fd870b3d`、本树独有`69c6c89e`及MCP/Harness保全`08d41945`经本地main同步至`a1013774`。负责人两树停写后又按固定清单同步未提交文档/源码20,676路径；其后本树新业务WIP未再固定同步 |
| 保全 | 根WIP stash `50553f58`、本树WIP stash `85f8377e`与逐文件原像保留；`output/ain02-20261030/review-origin-20261101`保存原63项/根阶段，当前私有证据在`output/repair-current-20261101-uotDQk`，不清理未知WIP/output/锁 |
| 操作限制 | 已授权本地修复提交及此前固定整合，不追辅助树活动HEAD、不推送/合main/迁移/启服务/外联或生产启用；新片核实际HEAD、status、暂存、MERGE_HEAD/CHERRY_PICK_HEAD及归属 |

本轮不续派旧A/B任务，不读取或同步辅助树，不新建心跳。原[Agent接入](../Agent接入改造/Agent接入改造-协作接续.md)、[MCP服务](../MCP服务/MCP服务-协作接续.md)、[Harness插件](../Harness插件/Harness插件-协作接续.md)各自独立维护，不替换原AI Native服务端或继承本专项进度。

## 服务端未完成事项

当前优先将可闭合全文的原任务实现、验证并按门槛更新百分比；只有具体前置阻塞才切其他可做任务。通知设置、计数标准装配、超八字段连续澄清及已有公共合同不重写。

| 原任务 / 域 | 尚需处理或核实 | 入口 / 证据 |
| --- | --- | --- |
| AIN-02合同冻结 | 网站正式出口已提交；34条客户别名出版、取消uint64上界和原客户/报价wire复验已收片，原知识schema不变，同私有包API/四端选定消费者已核。固定交付后核完整生产者/消费者/版本及跨AI全文确认；已停止的旧核查无结论，不能按局部绿色判100% | [集中收口阶段](<AI Native-开发记录.md#ain02-consumer-contract-closeout-20261104>)、[正式出口](../../packages/shared/src/index.ts)、[员工wire](../../apps/staff-miniprogram/src/components/ai-native/inspection-wire.ts)；未装host保持unavailable |
| AIN-08业务只读 | 原Core库存只读切片及有界仓储已实现、定向离线复验，源会话独占，尚未提交；独立复核未有结论。原历史/四品类真实对照及其他reader/适用变体仍待核，不升全文100% | [固定库存切片](<AI Native-开发记录.md#ain08-bounded-availability-20261104>)及该阶段清单/原日志；A不接管源码 |
| AIN-05/11/25 | 管理计数、持久CALLS、recorded生成及AppModule已接；三场景HTTP/多轮变体、真实计数/能力/费率、平台专用audit生产者、平台旧任务善后及SLO仍有缺口 | [模型组合](../../apps/api/src/modules/ai-native/task-model-gateway.composition.ts)，记录“标准计数与原任务计数执行链”“平台探测标准入口与停用后历史” |
| AIN-06/09/13/15/21/22 | 混合模型/业务完整恢复、多行组合与原范围核对、企业身份和完整报价/预约链；客户上下文澄清不等于业务参数选择，unknown不重派 | [请求场景](../../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application.ts)、原28项/ENTRY摘要及“超限澄清有界连续轮” |
| AIN-12/14/16 | 后台完整消息/事件及实际场景消费；通知设置以外的获准分区、普通资料写入、变化后重确认、原Core提交与失败恢复 | [正式providers](../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、原28项摘要；只读任务中心不等于完整可执行助手 |
| AIN-10/17/18/24 | 正式知识管理authority、真实对象ACL、撤回/删除跨实例传播、外部副本/备份；限定事件完整生产/处理、死信乱序；影子待办不等于业务异常解决 | 原知识合同阶段、原28项及[隐私模块](../../apps/api/src/modules/ai-native/privacy/README.md) |
| AIN-19/20/23及ENTRY-06 | 员工政策精确mutation receipt、首次released-input标准取消收尾、失效草稿历史载荷及真实媒体/宿主全链；品类高风险发布/资格/采用和模型消费仍缺 | 记录“员工原任务取消与收据合同”及原28项摘要；不恢复暂停的品类治理专项 |
| AIN-03/24～28及适用ENTRY | 旧B02兼容、真库跨进程竞争/宕机、全端/四品类组合、供应商/文件/宿主、安全隐私、性能与独立交付证据 | 记录“待补的验收证据”“近期完整功能节点”及AIN-01原门槛；真实环境需另核授权 |

旧业务有界分页、事件ready、知识assertBound按原日志保留为历史失败、同入口待复核。公共契约消费者原3项旧前提/依赖失败已修，17/17通过；最近protocol-output再次保留原编译断言、用本树源码/私有client解析通过，不外推全仓回归。

## 业务修复保留与边界

- 稳定行计价、冻结历史日历/币种/费用及原核减来源、逐段多营销/券/会员和原价后继、分批实际时点净额、换货新物资格/独立检查/交付/服务容量、资产处置同源恢复均保留。多行共享预算、现价再次换货跨新增期权益、全租期后换货、旧缺历史及复杂套装分摊仍有未开放组合；原缺陷收口不等于这些组合交付。
- 企业全账分页、原父回款/核销/冲销完整来源、现金/企业核销分账及原键恢复已接；存量核账、正式终态重开/复杂超收仍缺。线下实收押金已补原来源/凭证/权限/原键/收据及资金审计同事务，模拟门不放宽；真实预授权、线上押金供应商及实际用量完整结算仍不能称闭环。
- 当前成员/ALS/own-location、主体共同锁和文件冻结/原内容/回收门保持。后台订单命令生命周期、归还原批次跨入口互斥、续租乱序与配货版本、型号照片恢复及服务端归档凭证已修；实际上传、DOM/打印和已登录宿主未验。
- AI显式设置准入保留旧政策/当前权益、原Gateway单账及累计资源。任务中心拒绝已接原runner收尾；重新准备须完整FAILED/NONE拒绝结果，POSSIBLE/UNKNOWN/消费事实仍只核原请求。模型特殊字符凭据泄漏检查已补；真实计数冷启动/供应商及完整场景未外推。

## main侧能力与后续装配

main已有AI配置安全、平台额度申请/SaaS批准/空间分配、BYOK只记调用与Token、租户调用记录、设置简化与客户端授权入口。供应商模型列表/多模型/默认模型配置保留，协议识别候选不等于推理验证。

AI工作中心/Copilot现有前端效果不能代替真实聊天选择→冻结模型引用→原Gateway、正式任务事件及确认消费者接通；需求双入口增量原样保留。main原input_wait冒烟的`input_wait acknowledgement is uncertain`仍按原键/账务定位，真实费率/能力/安全部署未据本修复开放。

## 验证与下一入口

原五项141项、Codex业务166项及末次相关定向、AI39项/完整报价选择9项通过，API六入口/后台九入口noEmit零诊断；不同集合不相加，末次改动只引用其定向复验。实际命令、失败和修法见[业务阶段](../管理后台/管理后台-开发记录.md#local-integration-20261101)。这不是全库修后独立审查或真实DB/HTTP/供应商/浏览器证据，任务百分比保持原表。

AIN-02客户整片固定交付后，源会话按固定SHA独立核原全文；A继续补确切合同缺口，不追活动HEAD、不另开递归审查或恢复旧循环。完整版本/生产者/消费者、成功/拒绝/失效/断线/旧协议及兼容回退证据均按原任务定位，满足原G4才更新百分比，不省略适用实测或独立技术复核。AIN-08由源会话完成本片独立复核及必要修后复验，完整阶段统一登记原记录，不将本片当整项完成。

本轮所有Node仍预加载`tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定`mysql://offline:offline@127.0.0.1:1/rental_os_offline`；当前`output/takeover-20261102-ed5rs4ug/runtime.cjs`设置本树绝对审计、writeRoot、TEMP/TMP/cache并禁compile cache，解析本树shared源码及已保全`output/repair-current-20261101-uotDQk/generated`私有client。未覆盖installed/shared client或dist，不为索引复制或重生成client；旧`ain02-20261030/prisma-current`保留但不能证明新增字段。

文档检查仅验证白名单链接/入口和任务表算术，不证明业务完成；原导航三份缺失历史附件仍保留追溯，不伪造或删引用变绿。本轮不读`.env`、安装、启服务/浏览器、访问真实HTTP/DB/DNS/模型/支付/对象存储、迁移、推送/合main或生产启用。旧隔离容器/服务/专用库不自动复用或清理，资源定位仍在原AIN-01记录。

未来[Runtime/Provider SDK替换](<未来规划/AI Native-Runtime替换方案.md>)与[通用SaaS底座](<../平台底座/未来规划/平台底座-通用化与开源方案.md>)仅设计和回退条件，不授权当前替换、抽离或开源。
