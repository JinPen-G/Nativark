# 销售 CRM Core

`@rental-os/crm-core` 是独立、租户范围的销售 CRM。公共平台提供身份、成员授权、绑定事务、后台外壳及审计；CRM 拥有业务合同、配置、数据迁移和页面。公共平台不导入本包，宿主按所选组合显式装配。

当前 `0.1.0` 提供首次设置与日常配置：业务时区、默认币种、初始来源、不可覆盖的初始销售流程、修订冲突检查及原操作收据。客户、线索、商机、活动、提醒、导入导出尚未交付。自动化获客、自动化客户维护和 **CRM Agent 均为必备交付范围**，目前仍待实现。它是开发中的首个功能切片，不能据此认定完整销售 CRM 或生产安装已经验收。

CRM Agent 的目标能力是接受业务目标，分析获权资料，拆解并执行计划，根据客户回复调整后续行动，持续完成潜客发现、资料补全、触达转化及客户跟进、复访和沉默唤醒。计划、工作记忆、等待与人工接管须可持久恢复；真实业务结果以原领域和渠道收据为准。范围内自动执行须有明确委托、额度与停止条件，超范围动作重新核定批准。

Agent 工具和销售策略由本 Core 提供，宿主通过公开出口组合公共 Runner 与原 AI Native 的 Gateway、预算、批准和持久化参加者。当前清单尚无 AI 入口或工具，不能把上述目标能力视为已经接通。固定底座的完整 AI 装配仍有 Rental 依赖及租户级 Gateway 范围缺口，须先完成可独立消费的公共接点，不能伪造 Rental workspace、复制模型网关或将 CRM 写入底座。手工 CRM 可独立于模型运行；完整 CRM 交付仍须包含 Agent 的实际获客与维护闭环。

## 入口与依赖

| 正式出口 | 用途 |
| --- | --- |
| 根出口、`/server` | 清单、生命周期与领域配置服务；无自动宿主注册 |
| `/contracts` | CRM 的请求、响应和运行时校验 |
| `/http`、`/openapi` | 同源 HTTP 政策及接口资料 |
| `/mysql` | 参数化 SQL 仓储、事务、物理结构与移除依赖观察 |
| `/platform-host` | 真实公共身份、Core 使用权、绑定和审计适配 |
| `/nest` | 由宿主显式注册的 HTTP 模块 |
| `/admin` | 配置页贡献，使用公共 React/UIArc 页面与表单 |
| `/package` | 生成并检查标准 Core 归档 |

领域入口只消费 `core-contracts`、Zod 和 Node 标准库。SQL、Nest、公共身份及 React 依赖位于对应适配出口，不依赖 Rental、AI、行业 Prisma 模型或另一工作树的生成物。构建先准备所选正式公共包，`npm run build` 只编译本包，不触发公共包重建。

源码链路：[HTTP声明](src/http.ts) → [Nest适配](src/nest.ts) → [配置服务](src/service.ts) → [窄端口](src/ports.ts) → [MySQL](src/mysql.ts)。[平台适配](src/platform-host.ts)提供当前身份与授权租约，[生命周期](src/server.ts)在原绑定事务中初始化；[后台页面](admin/index.tsx)是直接消费者。

## 宿主装配

按固定版本的[公开 Core 接入手册](https://github.com/JinPen-G/Zelo/blob/bdf4956b79e18b37d6d2cc3ce184b49ba8c5cee7/packages/core-contracts/README.md)准备公共底座和显式部署锁。首片尚未提供独立 `apps/crm-api` / `apps/crm-admin` 运行入口；本包提供以下真实装配接点，不默认加载到零 Core 应用。

1. 从已检查的 CRM 标准包取得清单；对当前代码使用 `createCrmManifest` 时，必须传真实固定源码仓库和提交。使用 `createCrmHttpContribution` 登记受控 HTTP 政策，数据库观察接入 `readCrmPhysicalData`。
2. 使用 `composeCrmPlatformHost`，注入公共数据库、用户、审计、订阅与部署可用性；`deploymentForTransaction` 复用当前原事务，避免持锁时重新等待根连接。
3. 使用公共 `composePlatformCoreBindings` 的实际返回值，将其 `resolveTransaction(handle, scope)` 传给 CRM。它必须与 HTTP 绑定入口的运行时是同一个实例。注册表、部署目录和运行时可在宿主同步构造阶段通过闭包连接，构造结束前不能接收业务请求。不要把 opaque 句柄强制转换为数据库客户端，不在 initializer 中开启新事务。
4. 公共 `composePlatformCoreApplication` 的返回类型未暴露事务解析器；消费方可使用细粒度公共组合，并让 `application.management.bindings` 指向上一步实际运行时。不能从另建的绑定实例解析已有句柄。配置接口装配 `CrmHttpModule.registerFactory`，同一 `service/principals` 供 HTTP 使用，继续保留公共 Guard 和响应信封。
5. 后台通过 `registerCoreAdminPages([{ manifest, contribution: createCrmAdmin() }])` 将页面交给 `createPlatformAdminApplication`；Vite、主题和样式沿公共 `platformAdminVite()` 与正式样式出口，不新建后台壳。

首次绑定由公共租户管理资格、CRM 成员分配及订阅准入决定；配置管理权不能代替绑定资格。初始化在同一事务建立默认来源“手工录入”、流程版本 1 及“需求确认 → 方案沟通 → 商务协商 → 待决策”四个开放阶段。公共绑定、初始化事实、绑定收据和审计一起提交或回滚。

日常配置须当前 `crm:settings:manage`，只修改业务时区和默认币种，不授予对象读权、不编辑公共角色、不修改已有流程版本、来源字典或历史快照。首版录入币种为 CNY、HKD、USD、EUR、JPY、GBP、SGD、AUD、CAD、TWD；没有换汇、税费或支付计算。流程发布与来源编辑将在相应业务切片补齐。

## 数据与恢复

[迁移](migrations/001-crm.sql)只创建 CRM 自有三表：`crm_pipeline_versions`、`crm_settings`、`crm_setting_operations`。主键、索引、关联与每条业务查询均含租户边界。迁移必须经过所选 Core 的原部署流程，不能追加到零 Core 平台迁移或应用启动逻辑。

HTTP 路由为 `GET /api/cores/crm/settings`、`POST /api/cores/crm/settings`、`GET /api/cores/crm/operations/:operationId`，全部仅面向 `operator`。首次绑定仍走公共绑定接口。配置页的 `purpose: configuration` 只控制页面准入；配置 HTTP 使用 `business`，原收据使用 `original_receipt`。

配置更新先核原权限，再锁配置行；业务修改、收据和审计同事务。请求包含原 `expectedRevision` 与 `operationId`，同键同内容读取原结果，不同内容拒绝。返回读取结果和提交写入前都重新核权限。原收据须当前管理权且属于本人，停用后的核对不重新开放普通业务。

日常配置在请求派发前将最小原操作编号存入按租户、成员、Core 和操作意图隔离的浏览器存储；不保存表单或凭据。Web Locks 防止同浏览器多个标签页换键提交同一未决意图。存储不可用或结果未知时暂停新提交，刷新或重新进入后先核原结果；收据暂不可用不表示未提交。首次绑定复用公共 `useCoreBinding` 的会话内原操作引用及绑定唯一性。

业务就绪实际读取配置、有效默认来源与被引用流程版本。缺失、损坏或读取失败保持不可用，物理结构和迁移账仍由宿主另行核定。移除检查保留配置、流程和原收据依赖，不因停用删除历史。

## 验证与发行

源码工作区可使用已有依赖执行，不启动服务、生成 Client 或连接业务库：

```sh
node packages/crm-core/test/settings.test.cjs --deps /absolute/path/to/existing/node_modules
node scripts/check-selected-prisma-types.cjs --deps /absolute/path/to/existing/node_modules --mode platform --config packages/crm-core/admin/tsconfig.json
```

第一条复用仓库现有内存构建器，按正式包配置编译公共依赖及 CRM，并通过真实领域/SQL/公共绑定运行时验证提交、回滚、幂等、修订、隔离、就绪及接口一致性。SQL 运输和授权租约是测试 fixture，不代替真实 MySQL 或完整 Auth 验收。全部测试产物留在内存，临时目录必须保持不存在。第二条依赖公共后台源码 SDK 的开发配置；发行的后台入口只包含 `admin/index.tsx`，由消费者自己的宿主构建配置处理。

构建后使用 `node dist/metadata.js manifest <仓库HTTPS地址> <固定提交>` 或 `openapi` 生成元数据；使用 `package <仓库HTTPS地址> <固定提交> <底座来源JSON> <新包.tgz>` 生成标准归档。命令核源码与固定提交一致，不覆盖已有归档。迁移摘要随原字节核验，归档只收清单声明文件，不包含根 `docs/`、测试依赖、环境或用户数据。

真实数据库迁移、独立宿主启动、浏览器操作、标准包安装/升级/恢复与多 Core 并存验收仍须取得各自证据；静态包检查或离线通过不表示这些步骤已完成。
