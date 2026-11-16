# Rental Core

`@rental-os/rental-core` 是原租赁业务源码的独立归属。当前已迁入原合同、品类身份与发布/历史解析、营业日、计价、器材、能力执行/条件判定、恢复快照、原操作收据、核心配置与业务配置仓储。原共享包和 API 通过兼容出口消费同一实现。完整业务服务、数据、页面、作业和标准 Core 装配继续逐片迁移。

## 阅读路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [正式出口](src/index.ts)、[合同](src/contracts.ts) | 原商品/资产、报价订单、履约检查、价格资金、日历与客户会员定义和运行时常量；[shared 兼容出口](../shared/src/core.ts)继续服务原 API、各客户端和 AI |
| [品类标识](src/rental-category-code.ts) | 原稳定格式及内置常量，格式合法不代表注册、发布或采用权限 |
| [企业预约依据](src/enterprise-booking.ts) | 原告知确认和冻结企业依据；[企业政策合同](../shared/src/enterprise-policy.ts)单源引用，不重算资金或授予权限 |
| [营业日](src/business-day.ts) | 原 IANA 时区、日界与营业时段算法；[旧 API 入口](../../apps/api/src/modules/rental-core/rental-business-day.ts)转接，报价/日历/作业继续使用同一实现 |
| [计价策略](src/pricing.ts)、[器材富化](src/equipment.ts) | `/pricing` 与 `/equipment` 保留原时间/用量/阶梯/封顶算法和属性投影，不读取数据库或改变价格计划/能力授权；旧 API 路径转接 |
| [摄影兼容](src/capabilities/camera-compatibility.ts)、[摄影交接](src/capabilities/camera-kit-handover.ts)、[通用套装](src/capabilities/kit-handover.ts)、[露营清点](src/capabilities/camping-kit-integrity.ts)、[清洁周转](src/capabilities/camping-cleaning-turnaround.ts) | 正式 `/capabilities/<模块名>` 子出口；只返回原版本判定，不写Core事实，原[登记器](../../apps/api/src/modules/rental-core/capability-hook.registrar.ts)继续单次登记当前及兼容版本 |
| [能力执行器](src/capability-runtime.ts)、[条件依据](src/capability-conditions.ts) | `/capability-runtime` 与 `/capability-conditions` 执行原启用实例、必需能力和冻结版本判定。实例由宿主提供，业务服务持有当前授权及事务 |
| [空间能力服务](src/workspace-capabilities.ts)、[仓储端口](src/workspace-capability-port.ts) | `/workspace-capabilities` 管理原能力状态、配置、版本、就绪总览及初始化。声明、实现、启用分别判定，存储和当前范围经窄端口供给 |
| [空间能力仓储](src/workspace-capability-repository.ts)、[存储视图](src/workspace-capability-storage.ts) | `/workspace-capability-repository` 持有实例与生命周期审计读写，保留修订冲突、同事务初始化及原重试分类。宿主供给原空间解析、品类锁和同一数据源 |
| [恢复快照](src/mysql-state.ts)、[快照存储视图](src/state-storage.ts) | `/mysql-state` 保存原空间恢复副本及行修订，保留参数化 SQL、当前品类绑定锁和调用方事务；恢复副本不替代正式业务事实或授权 |
| [原操作收据](src/mysql-idempotency.ts)、[收据存储视图](src/idempotency-storage.ts) | `/mysql-idempotency` 按租户/空间/动作/原键读取结果，收据写入参与原业务事务；同键异输入冲突，未获安全保留依据时拒绝按年龄删除 |
| [业务动作执行器](src/mysql-idempotent-actions.ts)、[事务端口](src/idempotent-action-storage.ts)、[共享父锁](src/mysql-business-fence.ts) | `/mysql-idempotent-actions` 协调原事务外预检/事务内重查与回放；`/mysql-business-fence` 保留Tenant共享锁，业务当前授权及副作用仍由原调用方处理 |
| [业务配置仓储](src/mysql-business-configuration.ts)、[存储与宿主接点](src/business-configuration-storage.ts) | `/mysql-business-configuration` 持有原定价/优惠/服务、日历/规则版本及通知模板读写，原身份、范围、品类锁和配置事件由宿主供给；原事务、发布审计和历史正文保护保持 |
| [核心配置仓储](src/mysql-core-configuration.ts)、[存储与宿主接点](src/core-configuration-storage.ts) | `/mysql-core-configuration` 维护档案、经营空间、商品/套装、定价组、地点/主体、券与检查模板及有界配置读取；同一事务复核当前品类，保留配置修订和首次初始化限制 |
| [当前绑定写入](src/mysql-category-write.ts)、[采用政策](src/mysql-category-policy.ts)、[履约准入](src/mysql-fulfillment-admission.ts) | 正式 MySQL 子出口持有原父锁→空间锁、发布版本/采用范围和当前地点/主体读取；原宿主提供身份和事务，历史快照及实物归还使用各自原依据 |
| [品类属性](src/category-attributes.ts) | `/category-attributes` 校验当前属性、保留不可改写的历史值并准备唯一声明；实体与唯一值仍由原写入事务一起提交 |
| [配置共同依据](src/configuration-basis.ts)、[规则版本链](src/rule-version-chain.ts) | `/configuration-basis` 维护原绑定修订及读取上限，`/rule-version-chain` 保留租期时点匹配、展示状态、发布/编辑/作废边界及追加版本号；原API转接同一实现 |
| [审计仓储](src/capability-audit.ts)、[内置能力组合](src/capabilities/index.ts) | `/capability-audit` 通过本表窄端口写放行/拒绝审计和读历史，`/capabilities` 显式登记当前及兼容实现。原 Nest provider 供给同一数据源和调用方事务 |
| [品类治理合同](src/category-governance.ts) | `/category-governance` 持有原发布、采用、准备和收据声明，原 shared 出口再导出同一对象 |
| [品类解析](src/category-runtime.ts)、[只读存储端口](src/category-storage.ts) | `/category-runtime` 提供原发布正文校验、历史引用、推荐版本、当前空间绑定和开通选项。各方法只要求自己使用的事务读取项，绑定与采用权限由原调用者核验 |
| [品类身份](src/category-identity.ts)、[扩展一致性](src/rental-extension-registry.ts)、[空间展示名称](src/workspace-names.ts) | `/category-identity` 和 `/extensions` 供原订阅/会员及发布/启动消费。根出口保留原默认展示名称，旧 shared 再导出同一常量 |
| [专业商品属性规则](src/item-group-validation.ts) | `/item-group-validation` 登记原露营容量与工程额定载荷限制。原商品保存流程在通用字段校验后调用，品类规则随 Rental 模块维护 |
| [原业务服务入口](../../apps/api/src/modules/rental-core/README.md) | 当前持久化、事务、Controller、能力和作业，继续逐片移入本包 |

## 使用与构建

原客户端继续从 `@rental-os/shared` 读取租赁合同。Rental 自身实现可从本包根出口取合同，从 `@rental-os/rental-core/business-day` 取营业日函数。新业务 Core 使用公共平台和 Core 合同，不必依赖 Rental。

核心/业务配置的私有MySQL声明使用所选宿主schema的生成类型，当前仍对应原API组合schema。准备已配置的独立开发环境后，先沿原宿主执行 `npm run db:generate`，再构建本包；它只生成声明/客户端，不执行迁移。完整Core schema与迁移链继续拆分。领域根出口及公共底座构建不加载这些MySQL适配。[当前schema](../../apps/api/prisma/schema.prisma) · [生成命令](../../apps/api/package.json)

```sh
npm run build -w @rental-os/rental-core
npm run lint -w @rental-os/rental-core
```

构建先生成正式公共合同，再生成本包 JS/声明。根出口提供领域合同与常量，营业日和品类治理按子出口加载。服务端计价、器材及能力执行/条件子出口使用可选 peer `@nestjs/common`，沿用原 HTTP 异常类型，调用宿主和源码构建须提供兼容版本。公共请求指纹从 `@rental-os/platform-contracts/request-fingerprint` 复用，已保存的条件 hash 沿用原算法。

品类解析和身份子出口同样使用服务端 peer。宿主供给本表只读方法后创建 `RentalCategoryResolver`，普通读取使用同一数据源，业务提交点传入自己的事务视图。`forVersion` 定位原发布引用，`forWorkspace` 每次重读当前绑定，`openingOptions` 返回最多100项及明确截断状态。旧 API 的 Nest provider 继续承担这条装配。[原 provider](../../apps/api/src/modules/rental-core/rental-category-resolver.service.ts)

宿主创建 `CapabilityHookRuntime` 时提供当前租户/空间的实例 reader 和审计 writer，再调用 `registerRentalCapabilityHooks(runtime)` 完成内置组合。业务服务通过 `evaluate` 传入判定对象、原主体引用及自己的事务，放行审计随业务提交。原 API 的 Nest provider 是这条接线的兼容消费者。历史订单继续按冻结版本和配置执行，缺原实现版本时明确拒绝。

空间能力服务通过仓储的正式方法读当前实例、保存变更和初始化。保存继续核当前品类绑定、依赖、互斥及预期修订，实例和审计由同一事务提交。重复初始化只补缺项，保留管理员后来暂停或停用的状态。原 API 的服务与仓储 provider 供给同一实现。[原服务接线](../../apps/api/src/modules/rental-core/workspace-capability.service.ts) · [原持久适配](../../apps/api/src/modules/rental-core/workspace-capability.repository.ts)

MySQL 快照与收据子出口使用可选 peer `@prisma/client` 的原 SQL/JSON runtime，不加载生成模型或实例化数据库客户端；领域总出口不加载这些适配。宿主提供本表的窄存储视图、真实范围解析及原事务。保存 Core 快照时传入已有事务，品类锁、行修订和原事件捕获一起提交；未传入时才由仓储按原 ReadCommitted 方式开事务。收据 `record` 必须传入业务事务，重试先读原键，缺收据保持未知。[原快照接线](../../apps/api/src/modules/rental-core/rental-state.repository.ts) · [原收据接线](../../apps/api/src/modules/rental-core/rental-idempotency.repository.ts)

业务动作执行器接收原事务端口和幂等仓储。`executeInTransaction` 参与调用方已有事务，`readReceipt` 只读原操作；`executeWithReplayFlag` 区分首次提交与回放，通知等外部副作用由原调用者处理。唯一约束竞争读原赢家，已证实写冲突按原键有限重试，未分类错误原样抛出。Tenant共享锁保留原企业政策的并发围栏，不替代当前角色、Core准入或业务对象授权。[原动作接线](../../apps/api/src/modules/rental-core/rental-idempotent-action.service.ts)

业务配置仓储只通过自身存储视图读写原配置。现有事务传给写入方法后，配置、规则/日历版本及审计由同一调用者提交；没有现有事务时保留原方法自己的事务方式。范围、当前品类绑定和事件捕获从原宿主提供，公开成员视图只读取原开业账号计数。规则版本链按原租期时点及冻结引用匹配，历史规则不被当前默认值改写。[原配置接线](../../apps/api/src/modules/rental-core/rental-business-config.repository.ts) · [原配置写入验证](../../tests/category-rule-write.test.cjs) · [规则链验证](../../tests/rental-rule-version-chain.test.cjs)

核心配置仓储接收本表存储视图、当前身份/范围和原配置事件。默认空间只在首次创建时初始化当时的成员，重读档案不补回撤销成员或更换旧绑定；配置保存保留原CAS与调用方事务。地点/主体状态在原锁中重读，普通编辑不恢复被停用的状态；商品唯一属性和套装组成与实体一起写入。报价、开业和报表读取沿有界接口取得实际配置，恢复快照不代替当前事实。[原核心配置接线](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts) · [初始化验证](../../tests/category-space-initialization.test.cjs) · [配置范围验证](../../tests/config-workspace-scope.test.cjs) · [履约准入验证](../../tests/rental-fulfillment-admission.test.cjs)

必要兼容验证覆盖能力执行、条件与历史依据、计价、器材及检查。源码测试优先 `.ts`，正式消费者使用本版构建产物。拆前合同与运行时导出按固定 Git 对照，实际证据和剩余边界沿 PCH 记录维护。[原能力执行器](../../tests/capability-hook-runtime.test.cjs) · [条件与历史依据](../../tests/category-capability-conditions.test.cjs) · [原计价测试](../../tests/rental-pricing-strategy.test.cjs) · [原器材测试](../../tests/capability-equipment.test.cjs) · [检查资源](../../tests/rental-inspection-resource.test.cjs) · [用量纠正](../../tests/rental-inspection-usage-correction.test.cjs) · [PCH 记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-rental-domain-package-20261115)
