# Rental Core

`@rental-os/rental-core` 是原租赁业务源码的独立归属。当前已迁入原领域与品类治理合同、品类标识、企业预约历史依据、营业日、计价策略、器材富化、5个能力实现及其执行器、条件判定和审计仓储。原共享包和 API 通过兼容出口消费同一实现。完整业务服务、数据、页面、作业和标准 Core 装配继续逐片迁移。

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
| [审计仓储](src/capability-audit.ts)、[内置能力组合](src/capabilities/index.ts) | `/capability-audit` 通过本表窄端口写放行/拒绝审计和读历史，`/capabilities` 显式登记当前及兼容实现。原 Nest provider 供给同一数据源和调用方事务 |
| [品类治理合同](src/category-governance.ts) | `/category-governance` 持有原发布、采用、准备和收据声明，原 shared 出口再导出同一对象 |
| [原业务服务入口](../../apps/api/src/modules/rental-core/README.md) | 当前持久化、事务、Controller、能力和作业，继续逐片移入本包 |

## 使用与构建

原客户端继续从 `@rental-os/shared` 读取租赁合同。Rental 自身实现可从本包根出口取合同，从 `@rental-os/rental-core/business-day` 取营业日函数。新业务 Core 使用公共平台和 Core 合同，不必依赖 Rental。

```sh
npm run build -w @rental-os/rental-core
npm run lint -w @rental-os/rental-core
```

构建先生成正式公共合同，再生成本包 JS/声明。根出口提供领域合同与常量，营业日和品类治理按子出口加载。服务端计价、器材及能力执行/条件子出口使用可选 peer `@nestjs/common`，沿用原 HTTP 异常类型，调用宿主和源码构建须提供兼容版本。公共请求指纹从 `@rental-os/platform-contracts/request-fingerprint` 复用，已保存的条件 hash 沿用原算法。

宿主创建 `CapabilityHookRuntime` 时提供当前租户/空间的实例 reader 和审计 writer，再调用 `registerRentalCapabilityHooks(runtime)` 完成内置组合。业务服务通过 `evaluate` 传入判定对象、原主体引用及自己的事务，放行审计随业务提交。原 API 的 Nest provider 是这条接线的兼容消费者。历史订单继续按冻结版本和配置执行，缺原实现版本时明确拒绝。

必要兼容验证覆盖能力执行、条件与历史依据、计价、器材及检查。源码测试优先 `.ts`，正式消费者使用本版构建产物。拆前合同与运行时导出按固定 Git 对照，实际证据和剩余边界沿 PCH 记录维护。[原能力执行器](../../tests/capability-hook-runtime.test.cjs) · [条件与历史依据](../../tests/category-capability-conditions.test.cjs) · [原计价测试](../../tests/rental-pricing-strategy.test.cjs) · [原器材测试](../../tests/capability-equipment.test.cjs) · [检查资源](../../tests/rental-inspection-resource.test.cjs) · [用量纠正](../../tests/rental-inspection-usage-correction.test.cjs) · [PCH 记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-rental-domain-package-20261115)
