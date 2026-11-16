# Rental Core

`@rental-os/rental-core` 是原租赁业务源码的独立归属。当前已迁入原核心聚合、报价/营销服务与配置DTO、合同、品类身份与发布/历史解析、营业日、计价、器材、能力执行/条件判定、恢复快照、原操作收据、配置及订单/资产/库存/检查/工单、报价/券/奖励/通知事实仓储、资金事实门禁、企业应收核销、服务容量、原换货批准与检查同意，以及检查、换货、续租、优惠和资金规则。原共享包和 API 通过兼容出口消费同一实现。配货/确认、Controller、数据、页面、作业和标准 Core 装配继续逐片迁移。

## 阅读路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [核心聚合](src/mysql-core-runtime.ts)、[宿主接点](src/core-runtime-ports.ts) | `/mysql-core-runtime` 持有原配置、库存、订单、交接及结算裁定；原Nest入口供给同一13项依赖，Controller/AI/企业及各端继续消费原签名 |
| [报价/营销聚合](src/mysql-business-runtime.ts)、[宿主接点](src/business-runtime-ports.ts) | `/mysql-business-runtime` 维护价格、日历、规则、报价、券、奖励和通知恢复；原Nest入口供给14项依赖，当前与历史价格分别读取 |
| [配置运行时DTO](src/config-request.dto.ts) | `/configuration-dto` 与原API共用字段、嵌套校验和装饰器元数据；规则候选采用同一类，审批、业务规则及保存仍由所属服务处理 |
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
| [业务事实仓储](src/mysql-business-facts.ts)、[本表视图与宿主接点](src/business-fact-storage.ts) | `/mysql-business-facts` 保存报价原依据、券占用/核销及预算、奖励/权益余额、推荐和通知原流水；当前空间/订单可见性、配置读取和原事件由宿主提供，保留调用方事务 |
| [报价能力事实](src/mysql-quote-capabilities.ts)、[库存对象依据](src/quote-inventory-basis.ts) | `/mysql-quote-capabilities` 在原事务复核启用实例及冻结条件，`/quote-inventory-basis` 使用有界配置读取核对商品/套装；新报价与历史动作各用原依据，不给旧报价补当前事实 |
| [核心事实仓储](src/mysql-core-facts.ts)、[本表视图](src/core-fact-storage.ts)、[当前身份接点](src/fact-request-context.ts) | `/mysql-core-facts` 读写订单聚合、资产/库存、归还处置、工单、检查和续租/换货事实；宿主提供原当前身份/范围、组织算法、检查事件及调用方事务 |
| [冻结检查依据](src/mysql-order-inspection-basis.ts)、[单件配货依据](src/mysql-order-allocation-pickup.ts) | MySQL子出口只读原订单关联的冻结来源，在库侧限制JSON与结果范围，并复验原完整身份和对象修订；缺历史不改用当前模板或属性 |
| [读数](src/usage-reading.ts)、[占用](src/occupancy.ts)、[承运期间](src/carrier-shipment.ts) | 纯规则子出口保留原数值校验、占用期间及承运起讫算法，原API再导出同一实现 |
| [订单排序](src/mysql-order-list-sort.ts)、[编号](src/mysql-order-number.ts)、[规则缺省](src/rule-defaults.ts)、[金额](src/money.ts)、[工单范围](src/work-order-assignee-scope.ts) | 原库侧排序/编号、规则缺省、金额精度和处理人范围继承，不新增业务状态或授权；编号继续在订单原事务中分配 |
| [冻结检查模板](src/inspection-template-snapshot.ts)、[检查结果](src/inspection-result-validation.ts)、[换货检查](src/exchange-inspection.ts)、[检查证据](src/inspection-evidence.ts) | 原必填/观察/读数及原商品、替换商品的检查依据；证据ID整理不授予文件访问权，文件ACL和履约提交由调用方核验 |
| [续租生命周期](src/extension-lifecycle.ts)、[重定价依据](src/repricing-context.ts)、[换货价格段](src/exchange-pricing-source.ts)、[原报价行](src/quote-line-source.ts) | 原有效期间、冻结价格/规则和剩余段裁定；当前配置不冒充历史依据，原Core服务继续调用同一规则 |
| [优惠取舍](src/discount-selection.ts)、[换货优惠](src/exchange-discount.ts)、[押金与预授权](src/security-deposit.ts)、[免赔](src/damage-waiver.ts) | 原资格、互斥/叠加、行分摊与资金计算；会员/券的原依据及历史减免保留，计算规则不执行收退款 |
| [服务目录](src/service-catalog.ts)、[服务发生项](src/service-occurrence.ts)、[服务取消](src/service-cancellation.ts)、[客户资格](src/qualification.ts)、[资产有效期](src/asset-validity.ts) | 原服务适用性、计费单位、条件强制和条款快照；容量、人员、支付及真实Provider仍由所属服务执行 |
| [报价访问](src/quote-access.ts)、[线下收款方式](src/mysql-offline-payment-method.ts) | 正式子出口接收原服务端身份/地点范围和原资金事务；报价来源不是授权，收款设置锁定读取不重开事务 |
| [分配政策](src/allocation-policy.ts)、[日历范围](src/calendar-range.ts)、[调价](src/price-adjustments.ts)、[示范数据](src/category-samples.ts)、[已批准续租端口](src/approved-extension-ports.ts) | 原纯规则、品类样例及批准后执行声明；分配作业、当前授权、批准核验和持久化仍由正式调用方负责 |
| [当前绑定写入](src/mysql-category-write.ts)、[采用政策](src/mysql-category-policy.ts)、[履约准入](src/mysql-fulfillment-admission.ts) | 正式 MySQL 子出口持有原父锁→空间锁、发布版本/采用范围和当前地点/主体读取；原宿主提供身份和事务，历史快照及实物归还使用各自原依据 |
| [品类属性](src/category-attributes.ts) | `/category-attributes` 校验当前属性、保留不可改写的历史值并准备唯一声明；实体与唯一值仍由原写入事务一起提交 |
| [配置共同依据](src/configuration-basis.ts)、[规则版本链](src/rule-version-chain.ts) | `/configuration-basis` 维护原绑定修订及读取上限，`/rule-version-chain` 保留租期时点匹配、展示状态、发布/编辑/作废边界及追加版本号；原API转接同一实现 |
| [审计仓储](src/capability-audit.ts)、[内置能力组合](src/capabilities/index.ts) | `/capability-audit` 通过本表窄端口写放行/拒绝审计和读历史，`/capabilities` 显式登记当前及兼容实现。原 Nest provider 供给同一数据源和调用方事务 |
| [品类治理合同](src/category-governance.ts) | `/category-governance` 持有原发布、采用、准备和收据声明，原 shared 出口再导出同一对象 |
| [品类解析](src/category-runtime.ts)、[只读存储端口](src/category-storage.ts) | `/category-runtime` 提供原发布正文校验、历史引用、推荐版本、当前空间绑定和开通选项。各方法只要求自己使用的事务读取项，绑定与采用权限由原调用者核验 |
| [品类身份](src/category-identity.ts)、[扩展一致性](src/rental-extension-registry.ts)、[空间展示名称](src/workspace-names.ts) | `/category-identity` 和 `/extensions` 供原订阅/会员及发布/启动消费。根出口保留原默认展示名称，旧 shared 再导出同一常量 |
| [专业商品属性规则](src/item-group-validation.ts) | `/item-group-validation` 登记原露营容量与工程额定载荷限制。原商品保存流程在通用字段校验后调用，品类规则随 Rental 模块维护 |
| [原业务服务入口](../../apps/api/src/modules/rental-core/README.md) | 当前持久化、事务、Controller、能力和作业，继续逐片移入本包 |
| [资金事实服务](src/mysql-funding.ts)、[资金事件规则](src/funding-events.ts)、[存储与应收接点](src/funding-storage.ts) | `/mysql-funding` 保留原余额、收退款/保证金门禁、原收据与企业现金核销；`/funding-events` 保留独立账和金额算法。外部支付、原身份/可见范围与企业应收由正式接点供给 |
| [服务容量](src/mysql-service-capacity.ts)、[容量存储与身份接点](src/service-capacity-storage.ts) | `/mysql-service-capacity` 管理原服务/地点/时段数量、预留与确认、部分履约和释放收据。报价只读观察不维护账；写入复用原品类锁和调用方事务 |
| [企业应收核销](src/mysql-order-receivables.ts)、[完整原账](src/mysql-corporate-ledger.ts)、[回款收据](src/corporate-payment-receipts.ts)、[冻结结算依据](src/corporate-settlement-basis.ts) | 对应四个正式子出口；核原付款主体、币种及回款/逐单分配/冲销，完整分页不漏账。资金与债权同事务提交，企业回款分配不再次计为现金 |
| [检查准备与同意合同](src/exchange-inspection-preparation.ts)、[同意依据](src/exchange-inspection-consent-basis.ts) | 正式 /exchange-inspection-preparation 与 /exchange-inspection-consent-basis；原准备、文件来源、客户同意和执行收据分别保留，材料指纹不授予费用或履约权 |
| [原换货批准](src/mysql-approved-exchange.ts)、[企业政策接点](src/approved-exchange-policy.ts)、[参与者合同](src/approved-exchange-ports.ts) | /mysql-approved-exchange 核原费用确认、检查/客户同意和当前企业政策，唯一WeakMap把依据绑定到原事务；调用方不得以JSON或新事务替代 |
| [设置批准合同](src/approved-settings-ports.ts)、[设置输入校验](src/approved-settings-validation.ts) | /approved-settings-ports 与 /approved-settings-validation 维护原修订、批准/消费、原操作与unknown语义，宿主事务类型按真实组合实例化 |

## 使用与构建

核心聚合从 `@rental-os/rental-core/mysql-core-runtime` 导入。核心/事实仓储、恢复、Hook、资金与服务容量使用本包的同一实例，会员、企业支出/授信、文件生命周期与企业续租报价按 [实际端口](src/core-runtime-ports.ts) 供给。原Nest provider保留原构造顺序和初始化钩子；恢复在模块初始化读取，配置预热在全部回填之后运行，事务内配置读取不发布进程缓存。历史订单没有能力快照时保留空执行名单，当前新能力不反向影响旧订单。HTTP权限仍由原Guard裁定，业务方法继续接收调用方已有事务。[原Nest接线](../../apps/api/src/modules/rental-core/rental-core.service.ts) · [核心验证](../../tests/rental-core-v01.test.cjs) · [换货/续租历史验证](../../tests/rental-exchange-segment-pricing.test.cjs)

报价/营销服务从 `@rental-os/rental-core/mysql-business-runtime` 导入，配置、事实和核心配置仓储使用同一实例；会员、企业币种核验、密文及短信通过 [实际端口](src/business-runtime-ports.ts) 供给。原14项构造顺序与两个初始化钩子保留，配置/事实按同一刷新队列装载，续租事务上下文沿用模块级ALS。报价来源每次从同一公共可信身份读取，detached配置不发布进程缓存；`delivery_uncertain` 只按原投递记录查询，尝试次数与租约仍分别处理。[原Nest接线](../../apps/api/src/modules/rental-core/rental-business.service.ts) · [报价/营销验证](../../tests/rental-business-v1.test.cjs) · [通知恢复验证](../../tests/rental-notification-lease.test.cjs)

配置DTO从 `@rental-os/rental-core/configuration-dto` 导入，原API路径再导出同一运行时类。宿主按原Nest启动先加载 `reflect-metadata`，此子出口使用兼容的 `class-transformer` 和 `class-validator`；构建保留 `experimentalDecorators` 与 `emitDecoratorMetadata`，数组和嵌套对象沿原显式 `Type` 与 `ValidateNested` 校验。完整字段由 [原DTO门禁](../../scripts/validate-dto-coverage.cjs) 扫描实际源码，HTTP/OpenAPI字段继续引用原声明。[原HTTP入口](../../apps/api/src/modules/rental-core/rental-config-request.dto.ts)

资金服务从 `@rental-os/rental-core/mysql-funding` 接入，宿主提供同一数据源、每次请求的原身份/订单可见范围，以及已启用企业业务的原应收参与者。已有事务原样传入；服务自开事务时保持原ReadCommitted，资金解释保持原RepeatableRead有界快照。实款、演练、企业回款分配和预授权各按原依据读取，缺供应商核验不显示真实可用余额。[原Nest接线](../../apps/api/src/modules/rental-core/rental-funding.service.ts) · [资金门禁验证](../../tests/rental-funding-gates.test.cjs) · [事件算法验证](../../tests/rental-funding-events.test.cjs)

服务容量从 `@rental-os/rental-core/mysql-service-capacity` 接入，宿主供给本表数据源、原Auth/ALS身份和空间解析。订单预留、确认、取消及履约方法传入调用方已有事务；容量编辑直接复用包内原品类绑定锁。`readAvailabilityForQuote` 只观察原服务发生项，返回指纹与是否可用，不释放超时预留或新占容量；原写入/维护入口才处理过期账。换货和部分履约沿原收据处理，不按服务ID合并历史。[原Nest接线](../../apps/api/src/modules/rental-core/rental-service-capacity.service.ts) · [容量写入验证](../../tests/category-service-capacity-write.test.cjs) · [原预留/换货验证](../../tests/category-service-capacity-reserve.test.cjs) · [发生项验证](../../tests/rental-service-occurrence.test.cjs)

已启用企业业务的宿主从 `@rental-os/rental-core/mysql-order-receivables` 创建原应收仓储，并把同一实例交给资金服务。`corporatePaid` 读取原总回款关联的有效逐单核销，`reconcileCash` 只随本次已持久实款在原订单事务调整债权；原差异或缺收据须核对，不扫描补账。企业账通过 `/mysql-corporate-ledger` 在原授信锁内按500行完整分页，回款与冲销规则从 `/corporate-payment-receipts` 复用。公共人员、权限、企业授信业务入口及外部付款仍由正式调用方处理。[原Nest接线](../../apps/api/src/modules/rental-core/rental-order-receivable.repository.ts) · [私有存储](src/corporate-receivable-storage.ts) · [原资金/企业/文档消费者](../../tests/rental-order-receivable.test.cjs)

检查/换货合同从 /exchange-inspection-preparation 导入，原 @rental-os/shared 再导出同一声明。费用批准的参与者只处理原批准消费；/mysql-approved-exchange 在同一事务读取原费用确认和客户检查同意，生成仅本实例、本事务可用的依据，执行前后再次核对原关联。恢复读取已消费批准与原费用收据，不重新报价、不把旧TTL当今日新业务资格。设置批准使用 /approved-settings-ports 和 /approved-settings-validation，复用原修订与操作键。[原批准接线](../../apps/api/src/modules/rental-core/rental-approved-exchange-authorization.ts) · [客户同意入口](../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts)

原客户端继续从 `@rental-os/shared` 读取租赁合同。Rental 自身实现可从本包根出口取合同，从 `@rental-os/rental-core/business-day` 取营业日函数。新业务 Core 使用公共平台和 Core 合同，不必依赖 Rental。

核心/业务配置的私有MySQL声明使用所选宿主schema的生成类型，当前仍对应原API组合schema。准备已配置的独立开发环境后，先沿原宿主执行 `npm run db:generate`，再构建本包；它只生成声明/客户端，不执行迁移。完整Core schema与迁移链继续拆分。领域根出口及公共底座构建不加载这些MySQL适配。[当前schema](../../apps/api/prisma/schema.prisma) · [生成命令](../../apps/api/package.json)

```sh
npm run build -w @rental-os/rental-core
npm run lint -w @rental-os/rental-core
```

构建先生成公共合同与公共服务，再生成本包 JS/声明。根出口提供领域合同与常量，营业日和品类治理按子出口加载。服务端计价、器材及能力执行/条件子出口使用可选 peer `@nestjs/common`，沿用原 HTTP 异常类型，调用宿主和源码构建须提供兼容版本。核心聚合与换货批准子出口使用可选 peer @rental-os/platform-server 的正式 /request-identity，原Guard/API与Rental共用同一ALS实例；领域根出口不加载它。公共请求指纹从 `@rental-os/platform-contracts/request-fingerprint` 复用，已保存的条件 hash 沿用原算法。

品类解析和身份子出口同样使用服务端 peer。宿主供给本表只读方法后创建 `RentalCategoryResolver`，普通读取使用同一数据源，业务提交点传入自己的事务视图。`forVersion` 定位原发布引用，`forWorkspace` 每次重读当前绑定，`openingOptions` 返回最多100项及明确截断状态。旧 API 的 Nest provider 继续承担这条装配。[原 provider](../../apps/api/src/modules/rental-core/rental-category-resolver.service.ts)

宿主创建 `CapabilityHookRuntime` 时提供当前租户/空间的实例 reader 和审计 writer，再调用 `registerRentalCapabilityHooks(runtime)` 完成内置组合。业务服务通过 `evaluate` 传入判定对象、原主体引用及自己的事务，放行审计随业务提交。原 API 的 Nest provider 是这条接线的兼容消费者。历史订单继续按冻结版本和配置执行，缺原实现版本时明确拒绝。

空间能力服务通过仓储的正式方法读当前实例、保存变更和初始化。保存继续核当前品类绑定、依赖、互斥及预期修订，实例和审计由同一事务提交。重复初始化只补缺项，保留管理员后来暂停或停用的状态。原 API 的服务与仓储 provider 供给同一实现。[原服务接线](../../apps/api/src/modules/rental-core/workspace-capability.service.ts) · [原持久适配](../../apps/api/src/modules/rental-core/workspace-capability.repository.ts)

MySQL 快照与收据子出口使用可选 peer `@prisma/client` 的原 SQL/JSON runtime，不加载生成模型或实例化数据库客户端；领域总出口不加载这些适配。宿主提供本表的窄存储视图、真实范围解析及原事务。保存 Core 快照时传入已有事务，品类锁、行修订和原事件捕获一起提交；未传入时才由仓储按原 ReadCommitted 方式开事务。收据 `record` 必须传入业务事务，重试先读原键，缺收据保持未知。[原快照接线](../../apps/api/src/modules/rental-core/rental-state.repository.ts) · [原收据接线](../../apps/api/src/modules/rental-core/rental-idempotency.repository.ts)

业务动作执行器接收原事务端口和幂等仓储。`executeInTransaction` 参与调用方已有事务，`readReceipt` 只读原操作；`executeWithReplayFlag` 区分首次提交与回放，通知等外部副作用由原调用者处理。唯一约束竞争读原赢家，已证实写冲突按原键有限重试，未分类错误原样抛出。Tenant共享锁保留原企业政策的并发围栏，不替代当前角色、Core准入或业务对象授权。[原动作接线](../../apps/api/src/modules/rental-core/rental-idempotent-action.service.ts)

业务配置仓储只通过自身存储视图读写原配置。现有事务传给写入方法后，配置、规则/日历版本及审计由同一调用者提交；没有现有事务时保留原方法自己的事务方式。范围、当前品类绑定和事件捕获从原宿主提供，公开成员视图只读取原开业账号计数。规则版本链按原租期时点及冻结引用匹配，历史规则不被当前默认值改写。[原配置接线](../../apps/api/src/modules/rental-core/rental-business-config.repository.ts) · [原配置写入验证](../../tests/category-rule-write.test.cjs) · [规则链验证](../../tests/rental-rule-version-chain.test.cjs)

核心配置仓储接收本表存储视图、当前身份/范围和原配置事件。默认空间只在首次创建时初始化当时的成员，重读档案不补回撤销成员或更换旧绑定；配置保存保留原CAS与调用方事务。地点/主体状态在原锁中重读，普通编辑不恢复被停用的状态；商品唯一属性和套装组成与实体一起写入。报价、开业和报表读取沿有界接口取得实际配置，恢复快照不代替当前事实。[原核心配置接线](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts) · [初始化验证](../../tests/category-space-initialization.test.cjs) · [配置范围验证](../../tests/config-workspace-scope.test.cjs) · [履约准入验证](../../tests/rental-fulfillment-admission.test.cjs)

业务事实仓储由宿主供给本表方法、当前空间、每次生成的订单可见范围、库存配置 reader 和原通知事件。报价保存锁住原经营空间，只有首次创建分支复核当前履约/能力/库存，已保存报价保留来源、金额与历史快照；券预算、奖励和余额写入继续使用调用方事务及原 Decimal 精度。通知流水先持久化，认领只占租约，原投递结果才累计尝试次数；租约过期不证明可以重新发送。外部短信执行和批准仍由原业务服务处理。[原事实接线](../../apps/api/src/modules/rental-core/rental-business-fact.repository.ts) · [报价恢复验证](../../tests/rental-quote-recovery-review.test.cjs) · [短信限流验证](../../tests/sms-rate-limit.test.cjs)

核心事实仓储接收本表方法与明确的宿主接点。宿主返回原服务端完整身份，范围读取与冻结指纹使用原对象；订单/资产/处置的锁序、聚合与库存流水、检查事件继续在原事务提交。手工资料维护不能释放独立隔离，检查更正保留原读数和更正历史，续租保持原约定期间与冻结价格。库存作业、处置恢复和工单处理由原领域入口核当前权限。[原核心事实接线](../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts) · [订单编号](../../tests/rental-order-number.test.cjs) · [资产历史](../../tests/rental-asset-status-history.test.cjs) · [库存作业](../../tests/rental-stock-operations.test.cjs) · [处置恢复](../../tests/rental-stock-disposition.test.cjs) · [工单](../../tests/rental-work-order.test.cjs) · [检查读数](../../tests/rental-usage-reading-validation.test.cjs)

业务规则使用各自正式子出口，例如 `@rental-os/rental-core/service-catalog`、`/discount-selection` 和 `/security-deposit`。报价访问接收 `RentalQuoteAccessContext`，宿主供给每次请求的原已验证身份与地点范围，旧API函数保持原签名。线下收款方式只接原资金事务的 `$queryRaw`，使用原SQL runtime；设置共享锁保留到原资金提交，缺设置或配置无效明确拒绝。[报价兼容接线](../../apps/api/src/modules/rental-core/rental-quote-access.ts) · [收款兼容接线](../../apps/api/src/modules/rental-core/rental-offline-payment-method.ts)

规则验证沿原消费者复用，覆盖服务计费/条款、优惠取舍、押金/预授权、换货冻结检查及资产和证据边界。[服务目录](../../tests/rental-service-catalog.test.cjs) · [优惠取舍](../../tests/rental-discount-selection.test.cjs) · [资金规则](../../tests/rental-security-deposit.test.cjs) · [换货检查](../../tests/rental-exchange-inspection.test.cjs) · [资产有效期](../../tests/rental-asset-validity.test.cjs) · [检查证据](../../tests/rental-inspection-evidence.test.cjs)

必要兼容验证覆盖能力执行、条件与历史依据、计价、器材及检查。源码测试优先 `.ts`，正式消费者使用本版构建产物。拆前合同与运行时导出按固定 Git 对照，实际证据和剩余边界沿 PCH 记录维护。[原能力执行器](../../tests/capability-hook-runtime.test.cjs) · [条件与历史依据](../../tests/category-capability-conditions.test.cjs) · [原计价测试](../../tests/rental-pricing-strategy.test.cjs) · [原器材测试](../../tests/capability-equipment.test.cjs) · [检查资源](../../tests/rental-inspection-resource.test.cjs) · [用量纠正](../../tests/rental-inspection-usage-correction.test.cjs) · [PCH 记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-rental-domain-package-20261115)
