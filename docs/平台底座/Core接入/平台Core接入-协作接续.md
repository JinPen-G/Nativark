# 平台 Core 接入当前协作接续

更新时间：2026-11-14。

> 状态：负责人已授权“开始拆吧”，工程进入 PCH-01/02。独立清单合同、只读包检查与公共指纹兼容抽取已实现，`codex/platform-core-extraction` 的阶段提交 `a8da7ae1e47b289e9b8cc72f607b74e14cbdf4b6` 已推送并回读远端；完整宿主和业务接入仍待后续。源码、主线更新、必要测试及未完项见[开工记录](平台Core接入-开发记录.md#core-contract-first-20261114)。

开源主体为公共底座，Rental Core 是首个业务 Core 示范。现有 Nativark README/MIT 与品牌原稿已在 main，负责人已另开命名对话继续选择名称；本片沿现有技术包 scope，不因命名讨论改运行标识。品牌固定来源见[许可记录](平台Core接入-开发记录.md#nativark-mit-20261114)与[main合并](平台Core接入-开发记录.md#pch-frozen-main-20261114)。

N/A/B 原稿完整保留在 `8f4c45b3a5f637256afac9363ca13a4cd2232a5c` 及当前资产目录，[N保留记录](平台Core接入-开发记录.md#nativark-logo-n-retained-20261114)与[两版设计记录](平台Core接入-开发记录.md#nativark-logo-core-options-20261114)保留来源及验证。运行Logo的Preview黑白适配归原后台作者，本片不接管品牌设计。

> 正式依据：[需求v1.3](平台Core接入-需求.md)、[开发任务v1.3](平台Core接入-开发任务.md)。原PCH编号、依赖、顺序及G1～G4计分保留，新增标准化/兼容/源码/API/分发与独立更新要求已映射到原任务和验收；文档准备不计研发进度，不继承AIN/CAT-GOV完成度。

负责人要求接入手册与每片代码同步，实际文件/命令/预期结果/错误处理应能直接交给开发Agent。当前可执行的清单/包检查见[契约包说明](../../../packages/core-contracts/README.md)，完整五步业务接入仍按原任务逐片落地。只做必要测试的规则已补入根[AGENTS](../../../AGENTS.md#修改验证与交付)。

## 1. 当前目标与已明确的边界

建设比脚手架更完整、对开发者和开发AI友好的AI Native SaaS底座，交付真实公共能力、正式合同、样例及可独立接手的资料。无Core可启动、登录和进入公共后台，未获Core授权时提示联系管理员，不开放无Core通用Agent任务。

开发者受控注册Core→SaaS管理员直接授权租户→租户管理员分配成员可用Core→按Core内角色与数据范围使用。同部署/同租户可并存多个Core，新Core不自动分配全员；首期不新增Core申请流程，原订阅申请保留。Core共用租户订阅期限，开通/停用分别控制；停用保留数据、配置、原绑定和收据，重开核当前条件，不重复初始化或重放旧操作。续费不恢复主动停用、成员撤权或账号冻结；客户等其他audience沿原专用授权，必要历史和在途/unknown按原权限收尾。

Core各自定义业务分区，Rental经营空间/品类/地点留在Rental内部；AI工具可选，缺少时普通后台可用，Agent不能查询/操作该Core。多Core导航可切换或分组，权限、状态与缓存须隔离。首期同仓独立模块和受控组合构建，可同进程同库；跨Core互通本期只固定接点，具体场景留未来。

拆分按[功能对照与切片门槛](平台Core接入-开发任务.md#compatibility-slices)保护所有已支持功能；旧失败/未验项保留原归属。先做[标准包及本地安装](平台Core接入-开发任务.md#core-package-standard)，再接GitHub Release下载和 `nativark-core` Topic发现。开发者从[五步指南](平台Core接入-开发任务.md#core-quick-start)和[Agent任务模板](平台Core接入-开发任务.md#core-agent-template)开始。AI Native未完成不阻止无关切片，其最小固定接点按[并行边界](平台Core接入-开发任务.md#ai-parallel-boundary)办理。

按[源码整理](平台Core接入-开发任务.md#source-organization)核收整个平台的可读性和简洁实现，API与源码/例子同版本。无Core租户登录和公共设置须真实可用，轻量工单/工作流由Core承载。底座和各Core按[独立更新](平台Core接入-开发任务.md#independent-upgrades)分别升级，保留下游Core、配置、授权与数据；不将源码合并成功当部署升级通过。

[品类治理](<../../Rental Core/品类治理/品类治理-协作接续.md>)、AI Native、MCP、Harness及Runtime/SDK仍按原专项和作者推进。PCH不重派其任务，不把它们全项完成当作开工前置。

## 2. 写入归属与固定来源

- 当前独占树为 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，分支 `codex/platform-core-extraction`，开工后已从4720前进到实际远端main `6ca19ac34a3260405ba24388a4aa2a933450e70b`。后续每个阶段先获取最新已提交main、核对差异和WIP后整合，保护既有作者成果。
- 本片经PM明确的唯一源文件窗口为 `packages/core-contracts`、必要root lock、`common/request-fingerprint.ts`、`operation-log.service.ts`、`integrations/file-content-binding.ts` 与 `rental-idempotency.repository.ts` 的等价指纹再导出。根规则和本册/记录随负责人要求维护，正式需求/任务身份与门槛保持。
- shared总index、OpenAPI、AuthGuard、AppModule/AI providers及AI任务目录属于AI/PM既有窗口；未调整其源码，AI可继续使用原Rental指纹出口。平台服务/仓储、schema与后台壳的后续修改先取得对应固定窗口，本片不覆盖他人WIP或接管其专项。
- 已有品牌/文档固定来源和两轮12份前像均在Git。覆盖前接续原文保存在上述main基线同路径，未解决事项在本册及原记录继续有入口，不重复复制历史。

## 3. 下一入口与待交付

1. 01继续补齐全平台数据所有者、迁移链、调用/页面/API/事件/作业消费者及实际功能基线。已完成固定文件集合与关键链路核定，完整逐模块说明和全部正常/既有失败/未验对照尚未完成，不把源码数量作为完成度。
2. 02已交付清单schema/正式包、版本/对象命名空间、目录检查与说明；下一步固定真实服务模块、HTTP贡献、当前授权、生命周期和受限事务合同，核对Rental与最小非租赁的真实消费者。样例已冻结为租户范围的轻量工单创建→分派→处理→关闭，字段/角色/修订见开工记录。
3. 下一公共片的最小候选依次为：`platform.repository.ts` 的 `findUserForLogin/listTenants` 公共投影及独立租户初始化；`auth.service.ts` 的会话业务范围提供者和 `api-auth.guard.ts` 的Core授权策略入口；`app.module.ts` 的受控组合；`openapi-document.ts` 的平台/Core贡献组合。分别消费独立合同并保留Rental兼容适配，具体hunk与固定候选准备后由PM逐项协调。新合同先走独立包，shared总出口暂不增加重复定义。
4. 沿原03/04→05/06及07固定上下文→08 Rental适配逐片推进，兼容适配先行；每片整理职责与重复逻辑、补准确源码备注和API说明并验证受影响功能，保留必要校验、事务、历史、缓存和唯一执行者。09按原业务出口与AI固定接点处理可选工具及已有任务恢复。
5. 先验证本地标准包与非租赁真实持久化，再接Release固定包下载安装及Topic发现。10/11由独立开发者或Agent只凭简明指南和业务要求接手，在干净宿主重现安装→授权→业务；12核收全功能前后对照、源码/API可理解性、底座跟随上游与Core单独升级、配置/定制/数据保留、回退/分发失败及原独立审查门槛。
6. 不同租户/成员、撤权、停用重开、统一期限、有/无工具、迟到响应与unknown验证组合继续保留；部署移除、停用、订阅到期和成员撤权分别判定。

独立包可进行清单/目录静态检查；它尚非完整运行SDK。完整功能/源码基线、API贡献/离线资料、运行模块合同、独立宿主、多Core授权与UI/AI适配、工单持久化样例、安装/发现/实际独立更新、独立接手和兼容回退继续待交付。后续只补必要测试，现有用例/短命令优先，不增加成批测试脚本。

## 4. 验证边界与保留事项

本片已有独立合同类型/离线包检查、旧/新指纹22例对照及文件绑定消费者证据，见[开工记录](平台Core接入-开发记录.md#core-contract-first-20261114)。没有安装依赖、启动服务、读取实际环境或执行数据库/模型/供应商验证；完整API/页面构建、持久化/浏览器、独立接手和独立审查仍待相应阶段。合同测试产物集中在本树单一任务目录并由退出清理删除，无后台进程或复制依赖。

原MCP审计的额外隔离执行/清理命令被自动审批在启动前拒绝，返回`blocked by policy`，对应目录未创建；该项保持未验，没有替换脚本或换壳绕过。已完成的纯指纹对照和旧路径导入不能替代原MCP整体审计回归。

原PCH准备、标准化与品牌固定证据继续见[准备记录](平台Core接入-开发记录.md#pch-preparation-20261112)、[标准化记录](平台Core接入-开发记录.md#core-standardization-20261114)及[main归并复核](平台Core接入-开发记录.md#pch-preparation-main-integration-20261113)。此前总导航三份历史附件及AI接续output缺失仍保留原归属；旧失败/未验项不由本次清单测试关闭。

初版与两轮原文分别见[方案基线](历史归档/方案基线/2026-10-31/README.md)、[初次修订前像](历史归档/需求澄清/2026-11-09/manifest.json)、[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)。旧记录中的缺失附件、历史临时验证材料去向及未验工程继续由原所有者核明；本片不接管未知产物。保留所有Rental、AI Native、旧方案和测试。
