# Rental Core

`@rental-os/rental-core` 是原租赁业务源码的独立归属。当前已迁入完整原领域合同、品类标识、企业预约历史依据、营业日、计价策略、器材富化及5个原能力实现；原共享包和 API 通过兼容出口消费同一实现。持久服务、数据、页面、作业和标准 Core 装配仍在逐片迁移，当前包还不能作为完整 Rental Core 安装交付。

## 阅读路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [正式出口](src/index.ts)、[合同](src/contracts.ts) | 原商品/资产、报价订单、履约检查、价格资金、日历与客户会员定义和运行时常量；[shared 兼容出口](../shared/src/core.ts)继续服务原 API、各客户端和 AI |
| [品类标识](src/rental-category-code.ts) | 原稳定格式及内置常量，格式合法不代表注册、发布或采用权限 |
| [企业预约依据](src/enterprise-booking.ts) | 原告知确认和冻结企业依据；[企业政策合同](../shared/src/enterprise-policy.ts)单源引用，不重算资金或授予权限 |
| [营业日](src/business-day.ts) | 原 IANA 时区、日界与营业时段算法；[旧 API 入口](../../apps/api/src/modules/rental-core/rental-business-day.ts)转接，报价/日历/作业继续使用同一实现 |
| [计价策略](src/pricing.ts)、[器材富化](src/equipment.ts) | `/pricing` 与 `/equipment` 保留原时间/用量/阶梯/封顶算法和属性投影，不读取数据库或改变价格计划/能力授权；旧 API 路径转接 |
| [摄影兼容](src/capabilities/camera-compatibility.ts)、[摄影交接](src/capabilities/camera-kit-handover.ts)、[通用套装](src/capabilities/kit-handover.ts)、[露营清点](src/capabilities/camping-kit-integrity.ts)、[清洁周转](src/capabilities/camping-cleaning-turnaround.ts) | 正式 `/capabilities/<模块名>` 子出口；只返回原版本判定，不写Core事实，原[登记器](../../apps/api/src/modules/rental-core/capability-hook.registrar.ts)继续单次登记当前及兼容版本 |
| [原业务服务入口](../../apps/api/src/modules/rental-core/README.md) | 当前持久化、事务、Controller、能力和作业，继续逐片移入本包 |

## 使用与构建

原客户端继续从 `@rental-os/shared` 读取租赁合同。Rental 自身实现可从本包根出口取合同，从 `@rental-os/rental-core/business-day` 取营业日函数。新业务 Core 使用公共平台和 Core 合同，不必依赖 Rental。

```sh
npm run build -w @rental-os/rental-core
npm run lint -w @rental-os/rental-core
```

构建先生成正式公共合同，再生成本包 JS/声明。包不依赖 shared、Prisma、管理后台或 AI，不连接数据库、不注册权限、不执行迁移。根出口只导出真实领域合同及常量，营业日按子出口按需加载；这两个入口不加载Nest。服务端 `/pricing`、`/equipment` 为保留原HTTP异常类型，使用可选peer `@nestjs/common`，调用它们的宿主须提供兼容版本。源码构建也需该peer，不向浏览器合同入口加载服务端模块。

能力工厂通过正式子出口供Rental运行时登记，模块导入本身不登记或执行Hook。历史版本仍由原登记器明确保留，旧订单继续使用原冻结依据；其他业务Core无需采用Rental的品类或能力。Hook执行器、当前空间实例读取及同事务审计仍在原宿主，不能只加载工厂就跳过当前授权/审计。

必要兼容验证为[原计价测试](../../tests/rental-pricing-strategy.test.cjs)、[原器材测试](../../tests/capability-equipment.test.cjs)、[检查资源](../../tests/rental-inspection-resource.test.cjs)和[用量纠正](../../tests/rental-inspection-usage-correction.test.cjs)。源码测试优先 `.ts`，防止仓库既有同名 JS 被误当当前源码；正式消费者使用本版构建产物。拆前合同与运行时导出按固定 Git 对照，实际证据和剩余边界见[PCH 记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-rental-domain-package-20261115)。
