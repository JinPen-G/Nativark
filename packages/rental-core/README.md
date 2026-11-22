# Rental Core

`@rental-os/rental-core` 是原租赁业务源码的独立归属。当前已迁入原核心聚合、报价/营销服务、配置与业务请求DTO、订单确认及商户委托、配货/办理锁及自动扫描、工作台/报表与到期作业、换货试算、检查准备/专用影像与不可变凭证、经营空间边界、合同、品类身份与发布/历史解析、营业日、计价、器材、能力执行/条件判定、恢复快照/历史回填、员工线下收款与归还计价、客户主档/账号/会员与企业客户资格/订单/财务投影及读取审计、原债权核定收据、原操作收据、配置及订单/资产/库存/检查/工单、报价/券/奖励/通知事实仓储、资金事实门禁、企业应收核销、服务容量、原换货批准、客户检查同意及批准执行、绑定规则/日历草稿、批准设置应用及品类草稿/发布/开通政策、采用准备与最终提交链，以及检查、换货、续租、优惠和资金规则。原共享包和 API 通过兼容出口消费同一实现。常规 Rental 标准包已包含原 Controller、数据/迁移、各端贡献和作业接点，由独立宿主显式选择；AI Native 另按可选组合装配。完整兼容与独立更新验证按实际支持范围继续收口。

## 阅读路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [完整应用](src/application.ts)、[仓储组合](src/application-repositories.ts)、[领域基础](src/application-domain.ts)、[独立宿主](../../apps/rental-api/src/assembly.ts) | 完整应用以同一数据库组合仓储、资金、事实和业务服务，事件沿调用方事务传播。独立宿主取得该服务图，分别管理构造、启动与退出。 |
| [客户应用](src/application-customers.ts)、[客户端应用](src/application-client.ts)、[企业应用](src/application-enterprise.ts)、[品类应用](src/application-category.ts) | 完整应用复用同一客户主档、会员、企业政策和资金，再组合客户端、企业及品类服务。业务读写沿各服务的当前权限、原键和事务执行。 |
| [HTTP选择器](src/application-http.ts)、[平台选择器](src/application-platform.ts)、[AI业务源](src/application-ai-sources.ts)、[启用AI的宿主组合](../../apps/rental-api/src/ai-composition.ts) | HTTP和平台选择器供独立宿主复用同一实例。AI业务源由完整应用构造并返回，启用AI的宿主通过显式Provider别名选择原业务服务。 |
| [应用参加者](src/application-participants.ts)、[宿主生命周期](../../apps/rental-api/src/lifecycle.ts) | 原到期作业和后台服务由宿主启动；退出先停止新tick，再等空间枚举、命名锁及已进入业务全部返回，最后断开同一数据库。不会取消已提交操作或重做unknown。 |
| [HTTP文档贡献](src/http-openapi.ts)、[原操作](src/http-openapi-operations.ts)、[同源schema](src/http-openapi-schemas.ts) | `/http-openapi` 提供平台可组合的 Rental 机器契约、原组合兼容出口与明确字段/路由缺口 |
| [商品与资产前端](admin/catalog/README.md)、[统一页面贡献](admin/index.tsx)、[请求与图片](admin/catalog/client.ts) | `/admin/catalog` 持有商品、资产、库存、照片与状态历史，七个窄出口提供页面、请求、上下文、图片、列表能力及纯术语；统一贡献组合九页，宿主提供当前身份、经营空间及原鉴权传输 |
| [定价与营销前端](admin/commercial/README.md)、[七页声明](admin/commercial/pages.ts)、[请求与上下文](admin/commercial/client.ts) | `/admin/commercial` 提供定价组、价格版本/调价、优惠、券和服务容量；宿主提供同一会话与经营空间，表单和主操作复用公共呈现，旧地址和价格管理权限保持 |
| [品类与业务规则前端](admin/governance/README.md)、[页面声明](admin/governance/pages.ts)、[请求与上下文](admin/governance/page-context.tsx) | `/admin/governance` 提供品类、规则、日历、奖励规则和通知设置；旧页面与 API 消费同一实现，保存、发布、采用和历史读取保持各自原权限与操作收据 |
| [客户端与官网前端](admin/channels/README.md)、[页面声明](admin/channels/pages.ts)、[当前会话](admin/channels/page-context.tsx) | `/admin/channels` 提供品牌、协议、发布服务、微信凭证和官网配置；同一页面贡献复用原保存 Promise、版本与品牌刷新，登录前 bootstrap 由独立公共传输消费同一请求工厂 |
| [开业配置前端](admin/setup/README.md)、[页面声明](admin/setup/pages.ts)、[受控目标](admin/setup/navigation.ts) | `/admin/setup` 提供当前空间的就绪状态和九项配置入口；状态由服务端裁定，业务目标经登记页面及当前权限解析，公共账号入口由宿主供给 |
| [支付对账前端](admin/payment-reconciliation/README.md)、[页面声明](admin/payment-reconciliation/pages.ts)、[四请求](admin/payment-reconciliation/client.ts) | `/admin/payment-reconciliation` 共用原批次列表/详情、CSV导入和差异表单；当前财务权限与空间、原支付事实、处理原因及单次异步提交保持 |
| [企业Web客户端](clients/enterprise/README.md)、[正式入口](clients/enterprise/index.ts)、[会话协调](clients/enterprise/session.tsx) | `/clients/enterprise` 提供企业会话、请求与原操作门闸；公共web-client仍持有唯一客户会话和网络层，企业授权、单次写入及原键恢复保持 |
| [官网认证与本人资料](clients/website/auth/README.md)、[登录态业务](clients/website/session/README.md) | `/clients/website` 提供认证、账户与原业务请求工厂；宿主供给同一客户会话、可信请求与原引用清理，业务授权及原收据沿服务端核验 |
| [完整客户网站](clients/website-ui/README.md)、[网站入口](clients/website-ui/index.ts)、[浏览器薄宿主](../../apps/tenant-website/README.md) | `/clients/website-ui` 提供原15路由、页面、语言和样式；宿主供给同一客户会话、公开配置、可靠存储与资产映射，官网和AI业务请求继续沿原协议 |
| [企业门户前端](clients/enterprise-portal/README.md)、[应用入口](clients/enterprise-portal/index.ts)、[原薄宿主](../../apps/enterprise-portal/README.md) | `/clients/enterprise-portal` 提供完整企业门户，页面使用精确子出口；宿主供给同一客户会话和公共UI，企业/本人/空间及原材料权限沿真实服务核验，不依赖旧后台源码 |
| [营业时区](clients/time.ts)、[微信打包](../../scripts/miniprogram-shared-types.cjs) | `/clients/time` 是原生CommonJS与声明出口，复用原时区/DST/回退算法；微信构建仅在实际引用时带入同一时间模块，费用仍由服务端裁定 |
| [标准包工厂](src/package.ts)、[清单工厂](src/manifest.ts) | `/package` 按实际文件形成发行清单。随包 Markdown 的链接在计算归档摘要前固定到源码或单独指定的公开文档提交，根 README 保留本页锚点 |
| [客户认证](clients/miniprogram/auth/README.md)、[正式客户入口](clients/miniprogram/index.ts) | `/clients/miniprogram` 提供密码/短信/微信、用途验证码、注册与本人注销；宿主供给原渠道、请求和会话采用，一次性凭证及原错误保持 |
| [客户AI请求](clients/miniprogram/README.md)、[员工AI请求](clients/staff/README.md) | 两个原生客户端出口提供任务、取消、报价、目标、预约交接及检查/入口动作工厂；宿主供给同一运输、当前会话和原生成校验器，准备、明确提交、取消与原结果沿各自原协议 |
| [会员请求](admin/membership/client.ts)、[客户请求](admin/membership/customer-client.ts) | `/admin/membership/client` 与 `/admin/membership/customer-client` 提供原57项请求；传入宿主唯一认证请求，保留租户会员、客户主档、账号状态、敏感资料、企业账务及原冲销收据边界 |
| [订单前端](admin/orders/README.md)、[订单请求](admin/orders/client.ts) | `/admin/orders` 提供列表、新建、详情及原配货/资金/检查/单据链；宿主提供当前身份、经营空间、原请求与跨领域组件，旧地址消费同一实现 |
| [养护工单前端](admin/work-orders/README.md)、[页面贡献](admin/work-orders/index.tsx)、[客户端工厂](admin/work-orders/client.ts) | `/admin/work-orders` 提供原列表/看板/详情与六类表单；宿主供给当前权限/经营空间及唯一请求，旧路由和十二HTTP方法薄适配同一实现 |
| [履约网络前端](admin/locations/README.md)、[地点贡献](admin/locations/index.tsx)、[客户端与范围](admin/locations/client.ts) | `/admin/locations` 持有地点与经营主体、两表单、原列表/卡片及导入导出；统一贡献供给七页，宿主提供当前范围和原组织查看/映射权限 |
| [能力治理前端](admin/capabilities/README.md)、[页面贡献](admin/capabilities/index.tsx)、[请求工厂](admin/capabilities/client.ts) | `/admin/capabilities` 提供原能力目录、配置、升级及审计；宿主供给当前范围和原会话刷新，配置入口保留查看/管理权限与原修订，卡片复用原生 UIArc |
| [统一HTTP装配](src/http.module.ts)、[服务组合](src/http-assembly.ts)、[原组合宿主](../../apps/api/src/app.module.ts) | `/http` 一次提供19个原Controller与九组应用接线；原宿主已通过正式模块取得同一业务实例，必需服务缺失时拒绝装配，原可选依赖保持 |
| [客户管理门面](src/application-customer-management.ts)、[客户HTTP](src/http-customers.controller.ts)、[模块](src/http-customers.module.ts) | `/customer-management` 从完整应用选择原客户实例；35条原平台客户路径保留状态权限、敏感审计、合并与企业财务范围。旧 PlatformController 继承同一处理器，不重复挂载新模块 |
| [空间管理门面](src/application-workspace-management.ts)、[空间仓储](src/mysql-workspace-management.ts)、[空间HTTP](src/http-workspaces.controller.ts)、[模块](src/http-workspaces.module.ts) | `/workspace-management` 与 `/mysql-workspace-management` 保留品类版本、必选能力及空间档案同事务创建，账号/角色/多空间授权仍为原 Serializable 事务。11条路径和原DTO由独立模块供给，旧入口薄适配；公开平台租户管理不依赖此门面 |
| [支付HTTP模块](src/http-payments.module.ts)、[支付运行](src/mysql-payment-runtime.ts)、[对账文件](src/mysql-payment-reconciliation-file.ts) | `/http-payments` 提供原回调、退款和对账三个Controller；宿主供给同一支付、对账及经营空间解析实例。资金、原操作和回调台账归Rental，签名及供应商请求复用公共运输 |
| [核心HTTP](src/http-core.controller.ts)、[业务HTTP](src/http-business.controller.ts)、[应用接点](src/http-applications.ts)、[快照与操作键](src/http-context.ts) | `/http-core` 与 `/http-business` 持有原履约、报价、规则和营销HTTP；宿主绑定同一业务/数据库实例，Guard/ALS及原动作继续核权限、事务和原收据 |
| [空间能力HTTP](src/http-workspace-capabilities.controller.ts)、[员工收款HTTP](src/http-staff-payments.controller.ts)、[服务接点](src/http-service-ports.ts)、[空间能力DTO](src/http-workspace-capability.dto.ts) | 正式HTTP子出口持有原8条路径与校验；宿主Guard先形成可信身份，再通过同一原服务实例处理。原API只再导出，Controller注册不取得额外业务权限 |
| [企业读取HTTP](src/http-enterprise-read.controller.ts)、[商户决策HTTP](src/http-enterprise-merchant.controller.ts)、[行政交接HTTP](src/http-enterprise-handoff-merchant.controller.ts)、[客户工作流HTTP](src/http-enterprise-workflows.controller.ts) | 四个正式子出口保留客户与营运两套鉴权、原149操作、材料前后复验和原收据；[21项实际接点](src/http-enterprise-applications.ts)由宿主绑定同一服务/数据库 |
| [渠道HTTP](src/http-channels.controller.ts)、[渠道请求类](src/http-channel.dto.ts)、[四项应用接点](src/http-channel-applications.ts)、[渠道合同](src/channel-contracts.ts) | `/http-channels` 与 `/http-channel-dto` 保留原三渠道及图片上传的八个HTTP动作；宿主通过[原接线](../../apps/api/src/modules/client/channel-http.providers.ts)复用同一配置/图片实例，原权限与2MB限制保持 |
| [客户端配置](src/mysql-client-channel-profile.ts)、[官网配置](src/mysql-website-channel-profile.ts)、[微信凭证](src/mysql-mini-program-channel.ts)、[私有存储](src/client-channel-ports.ts) | 发布经营空间、默认服务及官网目录归Rental；公共外观仍写同一事实。原修订校验、事务、密钥只写不读、AppID绑定保护和一次凭据测试保持 |
| [客户HTTP](src/http-client.controller.ts)、[八项实际接点](src/http-client-applications.ts) | `/http-client` 保留原客户 v1 路径、本人/企业读取及返回前的会话复验；宿主以同一 Auth、业务、微信、地址、注销、企业和 Guard 实例接线 |
| [员工认证HTTP](src/http-staff-auth.controller.ts)、[员工附件HTTP](src/http-staff-uploads.controller.ts)、[原键观察合同](src/staff-upload-observation.ts) | `/http-staff-auth`、`/http-staff-uploads` 与 `/staff-upload-observation` 保留原staff身份、五组上传场景、地点/本人/检查绑定及原始body校验；宿主供给同一会话、文件、数据库和观察解析器 |
| [客户认证](src/mysql-client-auth.ts)、[统一注册](src/mysql-customer-registration.ts)、[注册事务](src/mysql-customer-registration-transaction.ts)、[私有参加者](src/client-session-ports.ts) | 客户令牌、用途证明、会员/账号与原客户行锁单源；后台和自助注册共用同一规则，Serializable 冲突只作原有限重试 |
| [微信客户认证](src/mysql-client-wechat-auth.ts)、[私有参加者](src/client-wechat-ports.ts) | `/mysql-client-wechat-auth` 保留原手机号登录/绑定、同一客户与当前会话、渠道和AppID水印核验；微信运输从公共 `/integration-wechat` 供给 |
| [客户限流](src/mysql-client-rate-limit.ts)、[官网图片](src/mysql-client-website-assets.ts) | 原数据库配额、来源地址和唯一清理实例；日桶保留完整24小时窗口，清理不重置当日额度。图片按原字节/格式/2MB 与租户规则读取，公开路径保持兼容 |
| [企业请求DTO](src/http-enterprise-request.dto.ts)、[订单查询DTO](src/http-enterprise-order-query.dto.ts)、[客户请求DTO](src/http-client-request.dto.ts) | 原企业申请/成员、客户注册/报价/履约及文件完成校验单源；续租、换货、委托与交接DTO各从同名HTTP子出口使用，输入校验不授予执行权 |
| [本人地址与交付快照](src/mysql-client-delivery-address.ts)、[本人注销](src/mysql-client-account-closure.ts)、[配送区域](src/client-delivery-service-area.ts)、[宿主参加者](src/client-lifecycle-ports.ts) | 客户地址按租户与本人校验，报价/订单快照保持原值；注销沿原短信证明、会员/账号状态及会话撤销顺序。原客户Controller、报价及AI场景消费同一实现 |
| [浏览器会话与页面装配](admin/browser/README.md)、[认证合同](src/auth-contracts.ts) | 一个宿主创建一份真实会话、刷新运输和查询缓存，向十二组页面供给当前服务端身份；旧后台消费同一实现，登录、空间切换及本机存储命名空间保持 |
| [清单与页面权限](src/permissions.ts)、[清单工厂](src/manifest.ts) | `/permissions` 同源声明原权限及页面 OR 准入，`/manifest` 生成固定来源的发行清单；标准码只投影当前原租户/空间权限，声明不授予Core，原HTTP码保持 |
| [存量授权准备](src/legacy-access-preparation.ts) | `/legacy-access-preparation` 在同库只读快照中对照原身份、空间权限与现有 Rental 授权/绑定，给出缺失候选和差异；实际变更仍需原管理事务 |
| [存量单项接管](src/legacy-access-adoption.ts) | `/legacy-access-adoption` 将确认的单项候选交回原管理服务，在同一事务复验来源、当前身份和修订，沿原操作键保存授权/分配/绑定及审计 |
| [经营空间会话权威](src/mysql-workspace-principal.ts)、[原仓储入口](../../apps/api/src/modules/platform/platform.repository.ts) | `@rental-os/rental-core/mysql-workspace-principal` 提供可进入空间、默认空间、成员权限及会话复验，构造时传入同一数据库与原账号/角色投影回调。原 Auth、Guard 和 MCP 沿六个仓储入口消费同一实例，角色及权限锁沿原事务顺序 |
| [主应用工厂](src/mysql-primary-application.ts)、[原宿主接线](../../apps/api/src/modules/rental-core/rental-primary-application.providers.ts) | `/mysql-primary-application` 构造同一对核心与报价/营销实例，显式提供真实配置快照、数据库和参加者；旧服务令牌、HTTP及AI消费这两个实例 |
| [独立API宿主](../../apps/rental-api/README.md)、[唯一根模块](../../apps/rental-api/src/app.module.ts)、[请求政策](src/http-access-policy.ts) | 组合公共平台与同一Rental应用、身份和数据库；按真实处理器区分身份维护、公开、业务与管理准入，未接齐的必要处理器在连接和监听前拒绝。原事务、提交收据和返回前字段复验分别保留 |
| [核心聚合](src/mysql-core-runtime.ts)、[宿主接点](src/core-runtime-ports.ts) | `/mysql-core-runtime` 持有原配置、库存、订单、交接及结算裁定；主应用工厂供给原依赖，Controller/AI/企业及各端继续消费原签名 |
| [报价/营销聚合](src/mysql-business-runtime.ts)、[宿主接点](src/business-runtime-ports.ts) | `/mysql-business-runtime` 维护价格、日历、规则、报价、券、奖励和通知恢复；主应用工厂保留原正文维护读取器，当前与历史价格分别读取 |
| [订单确认](src/mysql-order-confirmation.ts)、[确认接点](src/order-confirmation-ports.ts)、[批准合同](src/approved-order-transaction.ports.ts) | `/mysql-order-confirmation` 与 `/approved-order-ports` 保留原报价消费、库存/容量、券、批准和幂等同事务提交，客户/企业参加者由宿主供给 |
| [商户委托](src/merchant-delegation.ts)、[服务端报价访问](src/server-quote-access.ts) | `/merchant-delegation` 与 `/server-quote-access` 共用公共Auth/ALS及原封存来源；历史结果只核对原键/原消费关系，字段或JSON复制不能取得执行权 |
| [配货与扫描](src/mysql-allocation.ts)、[私有存储/事件](src/allocation-storage.ts) | `/mysql-allocation` 保留原候选、预分配/改配/锁定/释放、办理锁、已记录异常及自动扫描；宿主只登记一个执行者，失败事件参加同一事务 |
| [工作台规则](src/workbench.ts) | `/workbench` 聚合原订单/工单/退款/通知待办并保留角色范围判断；调用方先过滤真实订单/资金，规则不读库或授予权限 |
| [经营报表](src/mysql-reports.ts)、[只读存储](src/report-storage.ts)、[CSV](src/report-csv.ts) | `/mysql-reports` 读取原订单/资产/数量库存；普通报表保持全区间分页，AI入口有5000单上限，超量不返部分总数。`/report-csv` 仅渲染同一已获权结果，中和前导空白/控制字符后的文本公式前缀，数字金额保持原值 |
| [到期作业](src/mysql-due-jobs.ts)、[实际依赖](src/due-job-ports.ts) | `/mysql-due-jobs` 保留五项任务、同连接命名锁、租户/空间ALS及原操作键；宿主只登记一个执行者，未选择Rental时不加载 |
| [换货候选与试算](src/mysql-exchange-preview.ts)、[事务与服务视图](src/exchange-preview-ports.ts)、[候选合同](src/exchange-choices.ts) | /mysql-exchange-preview在原订单锁内读取当前候选及冻结价格依据，保留容量、整行和币种限制；试算不批准、不执行、不收款 |
| [换货检查准备](src/mysql-exchange-inspection-preparation.ts)、[准备与照片消费](src/exchange-inspection-preparation.read.ts)、[严格DTO](src/exchange-inspection-preparation.dto.ts) | /mysql-exchange-inspection-preparation、/exchange-inspection-preparation-read与/exchange-inspection-dto保留原操作者、订单锁、冻结模板、照片消费及原收据同事务；检查事实不授予费用、客户同意或履约权 |
| [专用检查影像](src/mysql-exchange-inspection-media.ts)、[原影像读取](src/exchange-inspection-media.read.ts)、[当前身份/文件/事务接点](src/exchange-inspection-ports.ts) | /mysql-exchange-inspection-media与/exchange-inspection-media-read核原来源、文件/会话、占用与完成；原文件适配负责私有计划、单次暂存读取和冻结目标核对 |
| [附件 ACL](src/file-access.ts)、[业务读取](src/file-business-access.ts)、[引用存在性](src/file-business-reference.ts)、[读取参加者](src/file-access-ports.ts) | `/file-access` 持有原商品公开图、客户敏感附件及订单/资产/检查等对象范围；公共文件表和字节存储不能授予 Rental 业务读权 |
| [文件兼容应用](src/file-application-runtime.ts) | `/file-application-runtime` 持有原合法上传场景、原键/冻结/下载、专用参加者和按租户清理；原宿主只提供同一数据库、配置、身份与知识/检查参加者及唯一定时器 |
| [企业凭证/检查字节](src/file-application-rental-evidence.ts)、[员工原键观察](src/file-application-staff-observation.ts) | `/file-application-rental-evidence` 与 `/file-application-staff-observation` 读取原上传者/空间、冻结摘要与当前ACL；观察不续签，检查只消费宿主受控对象reader和原解码器 |
| [检查对象读取](src/inspection-object-reader.ts)、[原组合入口](../../apps/api/src/modules/integrations/inspection-object-reader.ts) | `/inspection-object-reader` 核原文件/上传会话、订单空间、MIME、精确长度和冻结摘要，返回流前与流末复验；请求签名来自公共 `/files`，当前业务授权由检查与员工文件消费者裁定，宿主提供实际配置和运输 |
| [运营集成应用](src/integration-runtime.ts)、[私有仓储](src/mysql-integrations.ts)、[设备与交换合同](src/integration-contracts.ts)、[HTTP 装配](src/http-integrations.ts) | Rental 持有打印参加者、TBox、交换模板与结果构建，文件/通知/作业使用同一公共台账；HTTP 消费当前配置、租户身份和业务文件读取权威 |
| [租户集成业务参加者](src/integration-business-participant.ts)、[原宿主入口](../../apps/api/src/modules/integrations/rental-integration-business.participant.ts) | 结算币种来自原租赁设置，provider 停用与身份变更使用配置行锁所在的同一事务，核支付/退款、短信队列与公共文件/上传依赖 |
| [凭证合同](src/document-contracts.ts)、[纯渲染](src/document-renderer.ts)、[归档与历史](src/mysql-documents.ts)、[本表读写视图](src/document-storage.ts) | /document-contracts与/document-renderer不依赖数据库；/mysql-documents保留逐字段释放、稳定内容摘要、同内容唯一归档和当前订单/空间/财务历史门禁 |
| [经营空间边界](src/mysql-workspace-scope.ts) | `/mysql-workspace-scope` 核请求空间所属租户及跨空间写入；原初始化/恢复只读取默认空间，原Guard先裁定请求授权 |
| [配置运行时DTO](src/config-request.dto.ts) | `/configuration-dto` 与原API共用字段、嵌套校验和装饰器元数据；规则候选采用同一类，审批、业务规则及保存仍由所属服务处理 |
| [业务请求DTO](src/core-request.dto.ts)、[订单请求DTO](src/order-request.dto.ts)、[企业告知DTO](src/enterprise-disclosure.dto.ts) | `/core-dto`、`/order-dto` 与 `/enterprise-disclosure-dto` 提供原商品/工单、订单/检查/资金请求的同一运行时类；API、客户与企业嵌套告知共用同一元数据，字段校验不替代当前业务授权 |
| [文件清理权威](src/application-file-cleanup-authority.ts)、[应用接线](src/application-integrations.ts) | `/application-file-cleanup-authority` 只核原过期上传、完成暂存与待删除三类善后。先锁租户/Core、原对象/经营空间，再核配置、知识来源和文件/会话；归属来自原持久对象，停用不授予新上传或业务权 |
| [数据发行与迁移摘要](src/data.ts)、[MySQL 数据计划](src/mysql-data.ts) | `/data` 核发行合同、迁移对应与原始字节摘要，保留包内目录名并生成正式 `deploymentMigrationNames`。`/mysql-data` 用正式账名供给原 Prisma 收据观察，复用公共物理读取核验 Rental 表，跨域外键由宿主传给公共数据计划 |
| [固定包读取](src/data-package.ts) | `/data-package` 从受控普通目录一次读取并核定完整包摘要、清单、模型与原迁移。更新准备消费本次核定的文件快照，宿主启动只保留所需的数据与文档材料 |
| [正式出口](src/index.ts)、[合同](src/contracts.ts) | 原商品/资产、报价订单、履约检查、价格资金、日历与客户会员定义和运行时常量；[shared 兼容出口](../shared/src/core.ts)继续服务原 API、各客户端和 AI |
| [品类标识](src/rental-category-code.ts) | 原稳定格式及内置常量，格式合法不代表注册、发布或采用权限 |
| [会员应用](src/mysql-membership.ts)、[私有存储/参加者](src/membership-ports.ts)、[状态审计接点](src/customer-operations-ports.ts) | `/mysql-membership` 持有租户共享会员、注册审核、当前资质、方案版本/授予及报价权益；业务风险、客户锁和企业政策使用同一原实例，金额/订单执行仍由订单域裁定 |
| [客户状态仓储](src/mysql-customer-operations.ts)、[门户授权](src/mysql-enterprise-portal.ts)、[会员HTTP](src/http-membership.controller.ts)、[HTTP参加者](src/http-membership-applications.ts) | 状态与历史按原事务/CAS组合，敏感访问审计独立保存；门户开通/动作授权、原操作收据和会员路由由Rental维护，宿主通过同一服务别名接线 |
| [客户治理](src/mysql-customer-governance.ts)、[合并与注销检查](src/mysql-customer-merge.ts)、[私有参加者](src/customer-governance-ports.ts) | `/mysql-customer-governance` 与 `/mysql-customer-merge` 复用同一主档、状态仓储和原事务；保留当前空间/地点范围、敏感审计、账号/会员独立状态、租户父锁与注销事实核验，合并只写映射与状态，历史引用不搬迁 |
| [客户经营分析](src/mysql-customer-insights.ts) | `/mysql-customer-insights` 读取已授权的原订单谓词，按币种分别汇总原应付金额与UTC月份；缺金额不补零，不将应付金额解释为收款 |
| [企业资料与订单主体](src/mysql-customer-corporate.ts)、[授信结算与原回款](src/mysql-customer-corporate-settlement.ts)、[私有存储和参加者](src/corporate-application-storage.ts) | `/mysql-customer-corporate` 与 `/mysql-customer-corporate-settlement` 持有原开票、合同、授信主档、主体归属及账务应用；宿主供给同一客户主档、事务、净实收和当前权限读取，原API只保留Nest适配 |
| [客户头像](src/mysql-customer-avatar.ts)、[头像HTTP](src/http-customer-avatar.controller.ts)、[实例别名](src/http-customer-avatar-applications.ts) | `/mysql-customer-avatar` 与 `/http-customer-avatar` 保留原2条客户管理路由、5MB位图/内容检查、文件读取后复验及原参数化SQL；生产模式仍须装配受控存储，宿主通过原Guard和同一头像实例接线 |
| [客户主档与会员](src/mysql-customer-master.ts)、[本表事务视图](src/customer-master-storage.ts) | `/mysql-customer-master` 是五个客户模型的唯一写入口，保留原租户共享、创建归属、普通资料CAS与企业关系修订；同一事务供给注册/合并/状态/企业链，客户共享不开放跨空间订单或其他Core读权 |
| [企业客户资格](src/mysql-enterprise-access.ts)、[客户上下文](src/client-context.ts) | `/mysql-enterprise-access` 从原客户会话、企业成员关系和明确动作读取资格；原客户Auth供给可信上下文，角色名称不自动取得入口或营运权限 |
| [企业订单读取](src/mysql-enterprise-orders.ts)、[财务投影](src/mysql-enterprise-finance.ts)、[私有存储](src/enterprise-read-storage.ts) | `/mysql-enterprise-orders` 与 `/mysql-enterprise-finance` 保留原告知字段、本人/企业和当前空间范围，读取前后复验；资金和授信来源由宿主供给，缺原依据返回不可用 |
| [企业原命令](src/mysql-enterprise-command.ts)、[收据解释](src/enterprise-receipt.ts)、[读取审计](src/mysql-enterprise-reader-audit.ts) | `/mysql-enterprise-command` 保持租户父锁、同事务原操作键及结果回读；`/mysql-enterprise-reader-audit` 通过公共日志持久化授权投影，写入失败或最终撤权不释放敏感数据 |
| [企业政策](src/mysql-enterprise-policy.ts)、[政策合同](src/enterprise-policy.ts)、[预约依据](src/enterprise-booking.ts) | `/mysql-enterprise-policy` 在原事务核商户/企业/成员交集及原报价、建单/续租批准，原键只读保存结果；合同不提供价格、保证金或新的业务权限 |
| [邀请与成员](src/mysql-enterprise-members.ts)、[管理员连续性](src/enterprise-administrator-continuity.ts)、[原交接结果](src/enterprise-transfer-decision.ts) | `/mysql-enterprise-members` 保留原邀请额度/一次性原码、成员修订和已接受交接；关系写入调用同一客户仓储，不复活旧授权或重放原K/C |
| [企业申请](src/mysql-enterprise-application.ts)、[管理请求](src/mysql-enterprise-management-request.ts)、[付款证明来源](src/enterprise-payment-proof-source.ts) | 对应正式子出口保留原申请材料、主体映射、首次管理员绑定、明确审核和原订单/冻结附件；管理审核不直接变更政策、授信或确认付款 |
| [企业待办](src/mysql-enterprise-task-center.ts)、[行政交接](src/mysql-enterprise-rental-handoff.ts)、[成员审计](src/mysql-enterprise-membership-audit.ts)、[原交接投影](src/enterprise-transfer-receipt-projection.ts) | 原持久对象和收据经[私有端口](src/enterprise-workflow-ports.ts)形成待办与历史。加入待办沿原事务维护到期请求，消息复验当前个人会话，企业队列复验原关系、修订和所需动作。 |
| [预约批准](src/mysql-enterprise-approval.ts)、[续租费用批准](src/mysql-enterprise-extension-approval.ts)、[换货费用批准](src/mysql-enterprise-exchange-approval.ts) | 三个正式MySQL子出口保留原申请/审核/费用确认和原结果；明确提交才参加Core原事务，费用批准不代替资金、检查同意或履约权限 |
| [企业商户委托](src/mysql-enterprise-merchant-delegation.ts)、[明确委托提交](src/mysql-enterprise-merchant-order-submission.ts)、[实际参加者](src/enterprise-approval-ports.ts) | 原D/K、持久报价与客户告知绑定同一批准/确认实例；当前商户身份由原Auth供给，unknown及已消费结果只查原来源和收据 |
| [客户API合同](src/client-contracts.ts)、[续租费用](src/enterprise-expense.ts)、[换货费用](src/enterprise-exchange.ts) | `/client-contracts`、`/enterprise-expense`、`/enterprise-exchange` 是纯业务声明及原运行时投影；原shared兼容再导出，客户无需加载MySQL或Nest服务 |
| [原委托来源](src/enterprise-order-delegation-source.ts)、[委托合同](src/enterprise-order-delegation.ts)、[客户续租请求](src/client-order-requests.ts) | 原委托按报价/原D/K及指纹精确读取；`/enterprise-order-delegation` 和 `/client-order-requests` 是同源业务合同，原shared各端入口兼容再导出 |
| [营业日](src/business-day.ts) | 原 IANA 时区、日界与营业时段算法；[旧 API 入口](../../apps/api/src/modules/rental-core/rental-business-day.ts)转接，报价/日历/作业继续使用同一实现 |
| [计价策略](src/pricing.ts)、[器材富化](src/equipment.ts) | `/pricing` 与 `/equipment` 保留原时间/用量/阶梯/封顶算法和属性投影，不读取数据库或改变价格计划/能力授权；旧 API 路径转接 |
| [摄影兼容](src/capabilities/camera-compatibility.ts)、[摄影交接](src/capabilities/camera-kit-handover.ts)、[通用套装](src/capabilities/kit-handover.ts)、[露营清点](src/capabilities/camping-kit-integrity.ts)、[清洁周转](src/capabilities/camping-cleaning-turnaround.ts) | 正式 `/capabilities/<模块名>` 子出口；只返回原版本判定，不写Core事实，原[登记器](../../apps/api/src/modules/rental-core/capability-hook.registrar.ts)继续单次登记当前及兼容版本 |
| [能力执行器](src/capability-runtime.ts)、[条件依据](src/capability-conditions.ts) | `/capability-runtime` 与 `/capability-conditions` 执行原启用实例、必需能力和冻结版本判定。实例由宿主提供，业务服务持有当前授权及事务 |
| [空间能力服务](src/workspace-capabilities.ts)、[仓储端口](src/workspace-capability-port.ts) | `/workspace-capabilities` 管理原能力状态、配置、版本、就绪总览及初始化。声明、实现、启用分别判定，存储和当前范围经窄端口供给 |
| [空间能力仓储](src/workspace-capability-repository.ts)、[存储视图](src/workspace-capability-storage.ts) | `/workspace-capability-repository` 持有实例与生命周期审计读写，保留修订冲突、同事务初始化及原重试分类。宿主供给原空间解析、品类锁和同一数据源 |
| [恢复快照](src/mysql-state.ts)、[快照存储视图](src/state-storage.ts) | `/mysql-state` 保存原空间恢复副本及行修订；规范化宿主启动只核原完整键和关联，缺迁移依据时保留原资料并拒绝开放。恢复副本不替代正式业务事实或授权 |
| [历史快照回填](src/mysql-snapshot-backfill.ts)、[本表事务视图](src/snapshot-backfill-storage.ts) | `/mysql-snapshot-backfill` 保留原完整键、主档映射、品类来源/修订及单空间原事务；宿主只按原顺序登记一次，错误可见，恢复不重做业务 |
| [员工线下收款](src/mysql-staff-payments.ts)、[原事务接点](src/staff-payment-storage.ts)、[请求DTO](src/http-staff-payment.dto.ts) | `/mysql-staff-payments`、`/http-staff-payment.dto` 保留原地点/凭证/余额、待确认额度、当前收款方式及原资金收据；登记与确认分开，同键不重复收款 |
| [归还价格来源](src/return-pricing.ts)、[到期核定收据](src/corporate-maturity-receipt.ts) | `/return-pricing` 只投影原分配的冻结价格段，`/corporate-maturity-receipt` 核原债权与审计，不重新计价、核定或修改原账 |
| [原操作收据](src/mysql-idempotency.ts)、[收据存储视图](src/idempotency-storage.ts) | `/mysql-idempotency` 按租户/空间/动作/原键读取结果，收据写入参与原业务事务；同键异输入冲突，未获安全保留依据时拒绝按年龄删除 |
| [业务动作执行器](src/mysql-idempotent-actions.ts)、[事务端口](src/idempotent-action-storage.ts)、[共享父锁](src/mysql-business-fence.ts) | `/mysql-idempotent-actions` 协调原事务外预检/事务内重查与回放；`/mysql-business-fence` 保留Tenant共享锁，业务当前授权及副作用仍由原调用方处理 |
| [业务配置仓储](src/mysql-business-configuration.ts)、[存储与宿主接点](src/business-configuration-storage.ts) | `/mysql-business-configuration` 持有原定价/优惠/服务、日历/规则版本及通知模板读写，原身份、范围、品类锁和配置事件由宿主供给；原事务、发布审计和历史正文保护保持 |
| [核心配置仓储](src/mysql-core-configuration.ts)、[存储与宿主接点](src/core-configuration-storage.ts) | `/mysql-core-configuration` 维护档案、经营空间、商品/套装、定价组、地点/主体、券与检查模板及有界配置读取；同一事务复核当前品类，保留配置修订和首次初始化限制 |
| [业务事实仓储](src/mysql-business-facts.ts)、[本表视图与宿主接点](src/business-fact-storage.ts) | `/mysql-business-facts` 保存报价原依据、券占用/核销及预算、奖励/权益余额、推荐和通知原流水；当前空间/订单可见性、配置读取和原事件由宿主提供，保留调用方事务 |
| [通知草稿合同](src/notification-draft.ts)、[核验缓存](src/notification-log-cache.ts)、[恢复投影](src/notification-snapshot.ts) | 三个通知子出口共用原草稿、原删除收据与无正文缓存；正文保留策略及删除账由宿主原维护读取器核验，缓存副本不授予发送或正文读取权 |
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
| [品类治理服务](src/mysql-category-governance.ts)、[私有存储/身份接点](src/category-governance-storage.ts)、[创建模板](src/category-creation-templates.ts)、[定义差异](src/category-definition-diff.ts) | `/mysql-category-governance` 保留平台草稿/不可变发布、独立开通/采用政策及原收据；当前SaaS身份、角色和原数据源由宿主供给，发布不变更商户绑定 |
| [采用准备](src/mysql-category-preparation.ts)、[最终采用](src/mysql-category-adoption.ts)、[宿主接点](src/category-adoption-ports.ts)、[当前权限](src/category-adoption-access.ts) | `/mysql-category-preparation` 保存预备数据和原批次，`/mysql-category-adoption` 持有最终事务及原收据。两项从宿主复用同一Auth、商业读取和实际业务实例，准备数据与历史来源沿原键保留。 |
| [采用提交阶段](src/category-adoption-transaction-phase.ts)、[最终配置校验](src/category-adoption-final-compatibility.ts)、[共同读取](src/category-adoption-compatibility-reader.ts) | 当前身份→商业目录→品类/政策→空间锁，实际候选/完整字段/关联/规模复核后，实体/唯一声明/能力/绑定/审计/原收据同提交 |
| [准备批次](src/category-preparation-batches.ts)、[候选实体](src/category-adoption-records.ts)、[唯一声明](src/category-adoption-entity-writer.ts)、[能力提交](src/category-adoption-capability-writer.ts) | 只合并明确的预备字段，保留旧批次依据。最终采用同事务提交实体、受影响唯一声明和能力配置，历史属性和准备资料保留。 |
| [配置兼容](src/category-adoption-business-compatibility.ts)、[价格结构](src/category-adoption-price-structure.ts)、[商业依赖](src/category-adoption-commercial.ts) | 以原当前/排期配置和代码登记的依赖核目标兼容，详细检查沿共同reader查找；不改当前规则或给旧报价补今天的配置 |
| [规则结构](src/category-adoption-rule-structure.ts)、[规则参数](src/category-adoption-rule-parameters.ts)、[营销引用](src/category-adoption-marketing-references.ts)、[价格引用](src/category-adoption-price-references.ts) | 验证原规则结构/参数与当前、排期的价格及营销引用，复用原DTO和执行规则。 |
| [商品关系](src/category-adoption-product-graph.ts)、[容量配置](src/category-adoption-service-capacity.ts)、[设置执行](src/category-adoption-settings-execution.ts)、[履约引用](src/category-adoption-fulfillment-references.ts)、[能力引用](src/category-adoption-references.ts) | 商品/资产、服务容量、营业日/配货、履约关系与能力引用分别返回局部检查结果，完整门槛由共同读取器和最终采用复核汇总。 |
| [品类治理合同](src/category-governance.ts) | `/category-governance` 持有原发布、采用、准备和收据声明，原 shared 出口再导出同一对象 |
| [品类解析](src/category-runtime.ts)、[只读存储端口](src/category-storage.ts) | `/category-runtime` 提供原发布正文校验、历史引用、推荐版本、当前空间绑定和开通选项。各方法只要求自己使用的事务读取项，绑定与采用权限由原调用者核验 |
| [品类身份](src/category-identity.ts)、[扩展一致性](src/rental-extension-registry.ts)、[空间展示名称](src/workspace-names.ts) | `/category-identity` 和 `/extensions` 供原订阅/会员及发布/启动消费。根出口保留原默认展示名称，旧 shared 再导出同一常量 |
| [专业商品属性规则](src/item-group-validation.ts) | `/item-group-validation` 登记原露营容量与工程额定载荷限制。原商品保存流程在通用字段校验后调用，品类规则随 Rental 模块维护 |
| [原业务服务入口](../../apps/api/src/modules/rental-core/README.md) | 旧API业务模块转接本包同一持久化服务、Controller、能力与作业，从原导读继续定位合同、调用方和恢复入口。 |
| [资金事实服务](src/mysql-funding.ts)、[资金事件规则](src/funding-events.ts)、[存储与应收接点](src/funding-storage.ts) | `/mysql-funding` 保留原余额、收退款/保证金门禁、原收据与企业现金核销；`/funding-events` 保留独立账和金额算法。外部支付、原身份/可见范围与企业应收由正式接点供给 |
| [支付运行](src/mysql-payment-runtime.ts)、[原参加者](src/payment-storage.ts)、[支付合同](src/payment-contracts.ts)、[公共支付运输](../platform-server/src/modules/integrations/payment-provider-transport.ts) | 原支付/退款引用、订单和配置锁、资金同事务、回调缓存、原键与unknown恢复，宿主供给当前Auth/ALS、原资金和失败出箱，签名与受控供应商请求沿公共支付运输执行。 |
| [支付HTTP](src/http-payments.ts)、[退款请求](src/http-payment-refund.dto.ts)、[对账请求](src/http-payment-reconciliation-file.dto.ts)、[对账文件](src/mysql-payment-reconciliation-file.ts) | 原付款/退款回调、运营动作和对账路径，服务实例从明确令牌供给。原CSV解析、批次幂等与差异审核沿当前完整经营空间财务权执行 |
| [支付精度](src/payment-money.ts)、[Stripe金额/收据](src/stripe-payment.ts)、[对账权限](src/payment-reconciliation-access.ts) | 原舍入、分值、特殊币种、可信收据和完整经营空间财务授权，同一次请求返回前与提交点继续复验 |
| [服务容量](src/mysql-service-capacity.ts)、[容量存储与身份接点](src/service-capacity-storage.ts) | `/mysql-service-capacity` 管理原服务/地点/时段数量、预留与确认、部分履约和释放收据。报价只读观察不维护账；写入复用原品类锁和调用方事务 |
| [企业应收核销](src/mysql-order-receivables.ts)、[完整原账](src/mysql-corporate-ledger.ts)、[回款收据](src/corporate-payment-receipts.ts)、[冻结结算依据](src/corporate-settlement-basis.ts) | 对应四个正式子出口；核原付款主体、币种及回款/逐单分配/冲销，完整分页不漏账。资金与债权同事务提交，企业回款分配不再次计为现金 |
| [检查准备与同意合同](src/exchange-inspection-preparation.ts)、[同意依据](src/exchange-inspection-consent-basis.ts) | 正式 /exchange-inspection-preparation 与 /exchange-inspection-consent-basis；原准备、文件来源、客户同意和执行收据分别保留，材料指纹不授予费用或履约权 |
| [客户检查同意](src/mysql-exchange-inspection-consent.ts)、[身份/文件接点](src/exchange-inspection-ports.ts) | /mysql-exchange-inspection-consent 复用原ClientAuth/ALS与本人订单，材料、照片和确认分别核当前依据；同意与原键同事务，历史只读原收据 |
| [批准换货执行](src/mysql-approved-exchange-execution.ts)、[窄参加者](src/approved-exchange-execution-ports.ts) | /mysql-approved-exchange-execution 在同一事务提交Core变更、授信、批准消费和原收据，提交后才发布；失应答/到期后的恢复不重新准备、计价或执行 |
| [原换货批准](src/mysql-approved-exchange.ts)、[企业政策接点](src/approved-exchange-policy.ts)、[参与者合同](src/approved-exchange-ports.ts) | /mysql-approved-exchange 核原费用确认、检查/客户同意和当前企业政策，唯一WeakMap把依据绑定到原事务；调用方不得以JSON或新事务替代 |
| [规则绑定草稿](src/bound-rule-draft.ts)、[日历绑定草稿](src/bound-calendar-draft.ts)、[私有本表/事务视图](src/bound-draft-storage.ts) | /bound-rule-draft 与 /bound-calendar-draft 保留完整候选复核、精确目标版本/CAS与原操作收据；规则历史恢复为新草稿，草稿保存不发布或授予业务权限 |
| [批准设置应用](src/mysql-approved-settings.ts)、[真实路由授权桥](src/approved-settings-route-authority.ts)、[参加者合同](src/approved-settings-ports.ts)、[严格输入](src/approved-settings-validation.ts) | /mysql-approved-settings 与 /approved-settings-route-authority 复用原Guard/ALS，通知配置CAS、批准消费与原操作同事务，历史读取不以当前配置或过期重做 |

## 历史与业务收尾

现有 Rental 租户接入标准授权前，从 `/legacy-access-preparation` 的 `createRentalLegacyAccessPreparation({ database, authentication })` 取得准备器，再调用 `prepare(tenantId)` 和 `compare(previous)`。宿主提供同一数据库与原身份仓储；输出固定原角色、空间/地点、品类修订、订阅及 Core 记录，保留已停用授权、已撤销成员与原绑定。`prepared` 或 `unchanged` 只说明只读对照结果，后续授权、成员分配和绑定须在原管理事务重新核验来源及原收据。[实现与返回类型](src/legacy-access-preparation.ts) · [必要行为用例](test/legacy-access-preparation.test.cjs)

确认单项候选后，宿主从 `/legacy-access-adoption` 创建 `createRentalLegacyAccessAdoption({ database, authentication, audit, term, deployment, registrations, authorizeContainer })`。这些依赖须与原平台管理和 Rental 宿主同源：`authentication` 为原 `RentalMysqlAuthenticationRepository`，容器授权使用原 `platformHost.authorizeContainer`。调用 `grantTenant`、`assignMember` 或 `bindScope`，传入 `confirmed: { tenantId, sourceFingerprint, coreFingerprint }`、本次 `operationId`、`expectedRevision` 及该单项的 `userId` 或 `workspaceId`；管理主体由当前原会话取得。每次完成后重新准备和确认下一单项，原已停用授权、已撤销成员及既有绑定保持原处理。

接管沿原 ReadCommitted 管理事务：先核原身份和 Tenant/Core 锁及原收据，再锁定并核对完整来源，授权事实、操作收据与审计共同提交。来源账号使用 MySQL `FOR UPDATE NOWAIT`；锁冲突或不支持该语法时操作失败，不自动重试。仅补标准映射；既有绑定复用原实例，缺失绑定遇新增行业初始化器时拒绝。源码离线验证不替代真实 MySQL 锁行为与部署验收。[单项应用与参数](src/legacy-access-adoption.ts) · [原事务行为验证](test/legacy-access-adoption.test.cjs)

应答未知时使用 `readTenantGrantOperation`、`readMemberAssignmentOperation` 或 `readBindingOperation` 查询原 `operationId`。原结果仍受当前原管理权限约束，来源之后发生变化不会触发第二次写入或初始化；收据未观察到不证明未提交。接管只提供服务器装配接口，现有管理 HTTP 不接受准备指纹，也不自动批量应用。

[善后声明](src/application-recovery-policy.ts)与[当前权威](src/application-recovery-authority.ts)只接实际登记处理器。89个原读取/收尾入口分别绑定订单、空间或企业历史，新增的文件/承运证据、审批原结果及企业回款凭证通过原材料定位订单。员工收款历史绑定本次真实 `orderId` 查询；旧操作和 unknown 不取得新订单权。

宿主从同一业务实例供给 `originalHistory` 和企业授权参加者，按当前身份、Tenant/Core、原Order与Workspace复核，再由原ACL/审批/资金服务处理。材料/归属或当前授权变化时拒绝，缺参加者明确不可用。代码登记、租户停用后的善后与当前部署分别核定，不能把读取原结果当成新业务授权。[文件定位](src/file-business-access.ts) · [宿主接入](../../apps/rental-api/README.md#请求事务与响应)

## HTTP API 文档

正式出口 `@rental-os/rental-core/http-openapi` 提供 `createRentalOpenApi()`，返回 `CoreOpenApiContribution` 的 `paths` 和 `schemas`。宿主使用现有 `composeCoreOpenApi` 与公共平台文档组合，并按实际挂载集合提供精确的旧路由许可。贡献的 operationId、schema 与本地引用统一使用 `rental.` 命名空间。

接口资料沿 [HTTP 操作](src/http-openapi-operations.ts) → [同源 schema](src/http-openapi-schemas.ts) → 各 HTTP Controller、请求 DTO 和应用接点阅读。用途、鉴权、原权限及参数位于每项 operation，`x-requiredPermissions` 沿原合同声明。业务调用仍经当前身份、租户/经营空间、对象范围与原事务核验，开发 Agent 的业务工具接入沿正式工具发布合同管理。各端模块 SDK 从上方对应客户端入口读取。

[旧组合文档](../../apps/api/src/contracts/openapi-document.ts) 使用同一 `RENTAL_HTTP_OPERATIONS` 和 `RENTAL_HTTP_COMPONENT_SCHEMAS`。服务端文档读取地址沿 `GET /api/openapi.json`，内容取决于该宿主的实际文档装配。使用同次构建的包可离线输出 Rental 贡献。

```powershell
node -e "const { createRentalOpenApi } = require('@rental-os/rental-core/http-openapi'); process.stdout.write(JSON.stringify(createRentalOpenApi(), null, 2))"
```

独立贡献包含 576 个已有操作及其 397 个 schema。原宽泛字段由 `RENTAL_HTTP_SCHEMA_GAPS` 列出，涉及的 259 项操作带 `x-schemaStatus=incomplete` 和 `x-schemaGaps`，继续按正式 DTO/响应投影补齐。明确路由缺口从 `RENTAL_HTTP_DOCUMENTATION_GAPS` 读取，当前宿主限制从 `RENTAL_HTTP_OPERATION_AVAILABILITY` 读取。

订单列表与详情复用 [订单响应 schema](src/http-openapi-rental-order-schemas.ts)。列表保留原数组或分页结果及九项查询字段，详情按原订单投影说明字段、历史省略与可空金额。配送电话按原脱敏结果公开，办理锁不释放令牌。规则、检查、会员及能力快照的内部版本结构继续从原关联对象读取；未展开的字段仍由缺口清单标明。

订单凭证的渲染、历史目录和指定版本复用 [凭证响应 schema](src/http-openapi-rental-order-document-schemas.ts)，支持报价、交付、归还与结算四种原类型。渲染 GET 会复用同内容归档或追加不可变版本；历史读取保留原模板、标题、HTML、摘要和时间，含资金明细时复验当前财务权限。纯内存结果可省略版本 ID，快照正文保持原历史结构，字段说明和示例来自同源投影。

支付单、退款与对账沿 [支付操作](src/http-payment-operations.controller.ts) 和 [对账读取](src/http-payment-reconciliation.controller.ts) 的原投影；员工线下登记与确认沿 [员工入口](src/http-staff-payments.controller.ts) 和 [收据 schema](src/http-openapi-rental-payment-schemas.ts)。登记保留原金额精度、凭证及幂等键，确认返回原登记和对应资金事件，重复确认读取同一收据。未知支付结果由原业务核对，接口资料不代替供应商事实。

退款回调按原事件重投，事件完成与退款结果同事务提交。资金入账失败时保留原第三方退款收据供查单恢复。

订单资金的列表、发起、追加、捕获、退款、释放与失败读取同一 [资金入口](src/http-business.controller.ts)及[同源 schema](src/http-openapi-schemas.ts)。可空支付方式、省略字段和缺省值按原 DTO 解释；普通资金金额与押金金额分别沿原精度工具，不从接口示例推算余额。所有写入保留原 201 状态、业务事务和原操作收据。

服务履约的执行更新、执行收据读取与退款沿 [业务 Controller](src/http-business.controller.ts)和原 DTO，说明服务时间、完成状态、客户确认、退款批准及原键。原退款使用明确的 mock 演练路径，金额核对、当前空间方式、资金键和调用方同一事务分别保留。提交后或 unknown 读取原结果，资料不把演练结果当作供应商实款。

| 路由 | 同源描述与当前限制 |
| --- | --- |
| `GET/POST /api/rental/v1/fulfillment-operators`、`PUT /api/rental/v1/fulfillment-operators/{id}` | 新建与兼容 id 更新使用原保存入口，省略状态沿原事务保留已存值；请求/响应示例来自同源 schema |
| `GET/POST/PUT /api/rental/v1/item-groups` 及型号图片操作 | 型号、套装与图片字段沿原 DTO/公开投影；原图字节 200 与受权文件 302/Location 分别描述 |
| `GET/POST /api/platform/customers/{customerId}/avatar` | 已描述单个 5 MiB 位图 multipart 上传、原保存投影及 PNG/JPEG/WebP 原始响应 |
| `GET /api/rental/v1/orders/{id}/documents/{type}` 及其历史目录/指定版本 | 同内容归档复用、事实变化追加版本；指定版本核原订单范围及含资金历史的当前读取权限 |
| `POST /api/staff/v1/uploads/{fileAssetId}/inspection-binding` | 已描述原检查目标和附件修订。独立贡献保留无 AI 宿主的 503，旧组合保留已装配权威的原成功投影 |
| `GET /api/platform/tenant-bootstrap/category-options` | 原合同保留，独立 Rental 宿主未挂载，列入未挂原路径缺口 |

## 使用与构建

Rental HTTP从 `@rental-os/rental-core/http` 的 `RentalHttpModule` 接入，类型 `RentalHttpServiceGroups` 列出宿主需要供给的真实应用。

完整实例从 [application](src/application.ts) 构造，经 [application-http](src/application-http.ts) 与 [application-platform](src/application-platform.ts) 分别供给原 Rental HTTP 和公共模块。宿主显式选择 AI 模式：未启用时客户检查出箱传 `null` 且不装配 AI 参加者；启用时必须提供原失败出箱、事务事件和通知草稿读取器。构造不会启服务或启动作业。独立组合的实际挂载集合及明确路由缺口见 [Rental API](../../apps/rental-api/README.md)。

网站、门户和部分前端出口继续使用 `@rental-os/shared@0.1.0` 的原运行协议。该包是可选 peer，消费这些出口的宿主仍须安装它；只使用其他出口时可按实际依赖选择。租赁值逐项转到已有 Core 正式出口，AI schema 和协调器当前仍由原 Shared 单源提供。

微信客户端工厂可通过 `npm run build:native-clients -w @rental-os/rental-core` 单独构建，类型检查使用 `npm run lint:native-clients -w @rental-os/rental-core`。Native独立入口与两端微信构建复用同一私有声明/Native编译器，读取当前Core、Shared与公共合同源码，不要求先写正式Shared/Core产物。独立入口按真实包出口生成JS、重定位声明与许可，`--check`退出时释放私有产物。[Native配置](tsconfig.native-clients.json) · [客户接入](clients/miniprogram/README.md) · [员工接入](clients/staff/README.md) · [私有准备](../../scripts/miniprogram-shared-types.cjs)

空间切换、开发密码重置和员工订阅上下文由 [独立扩展模块](src/http-extensions.module.ts) 绑定同一认证/订阅实例；它与旧宿主已挂载的三个薄适配路径二选一，公共六项认证继续由公共模块提供。[原 Guard](src/http-auth.ts) 保持角色、客户和空间政策，[application-access](src/application-access.ts) 将当前 Core 授权接入原业务父锁事务；它不代表所有独立写入、媒体流和回调已完成接入。

企业历史读取通过受控HTTP政策登记的8个企业入口接入同一恢复权威，依次锁当前Tenant、Core、原Order（适用时）与Workspace，再在同一事务消费原`requireWorkspaceAction`和订单谓词。宿主向`createRentalRecoveryAuthority`提供同实例`corporateHistory.access`与`corporateHistory.orders`；当前成员、授权修订或动作集合变化时丢弃未释放的数据。财务只读取企业承担的原订单，本人订单权限不能替代企业授权。企业入口缺原参加者时明确不可用。[企业历史政策](src/application-recovery-policy.ts) · [当前主体与原对象](src/application-recovery-authority.ts) · [原订单谓词](src/mysql-enterprise-orders.ts)

企业和客户敏感读取的审计各自在独立短事务中复核当前 Core，并在审计提交后、释放数据前再核原授权。已经提交的客户合并仍使用原事后审计入口，保留成功操作与原收据。客户概览只有订单读取权才查询统计，金额聚合另需原财务权限。[读取审计](src/mysql-enterprise-reader-audit.ts) · [客户审计](src/mysql-customer-operations.ts) · [概览权限](src/mysql-customer-governance.ts)

品牌、官网和微信渠道保存使用原租户父锁及实际修订条件。微信凭据测试在数据库事务外调用原运输，结果只写回同一配置及原测试记录，期间配置变化须重新读取。[品牌渠道](src/mysql-client-channel-profile.ts) · [官网渠道](src/mysql-website-channel-profile.ts) · [微信渠道](src/mysql-mini-program-channel.ts)

1. 按 `rental`、`enterprise`、`client`、`category`、`channels`、`members`、`files`、`staff` 与 `customerAvatar` 九组提供已有服务；所有业务、文件及审计使用同一数据库和当前身份。
2. 在宿主 `imports` 中使用 `RentalHttpModule.registerFactory({ imports, inject, useFactory })`，工厂返回上一步的应用集合。已经完成实例装配的宿主可用 `register(services)`；应用集合只创建一次，必需服务缺失时启动失败，原可选服务保持原处理。
3. 由宿主注册原身份/权限Guard、ALS及Rental HTTP政策，并选择该Core的路由贡献。员工、客户与企业接口沿各自audience和业务范围裁定；HTTP模块与单独品类模块选其一，避免重复Controller。

原组合AppModule从 `/http` 导入同一19个Controller，保留原Controller列表和provider接线；独立宿主从[完整应用](src/application.ts)取得同一服务图、数据和作业，可选 AI 从[独立 AI 组合](../../apps/rental-api/src/ai-composition.ts)供给原参加者。字段、请求验证类和政策从下面各HTTP出口及[OpenAPI源码](../../apps/api/src/contracts/openapi-document.ts)查阅。[统一模块](src/http.module.ts) · [原服务绑定](../../apps/api/src/modules/rental-core/rental-http.providers.ts)

微信客户认证从 `/mysql-client-wechat-auth` 接入，实际事务、渠道凭据、同一客户主档/注册、当前会话和审计经 `/client-wechat-ports` 供给。运输使用 `@rental-os/platform-server/integration-wechat` 的同一类和错误身份，保留原AppID缓存及凭据一次刷新；业务绑定核水印，已登录客户的一次性code错误不重试、不视为会话失效。原[微信Nest接线](../../apps/api/src/modules/client/client-wechat-auth.service.ts)保持八项构造位置。

原文件兼容应用从 `@rental-os/rental-core/file-application-runtime` 导入 `RentalFileStorageApplication`。宿主提供同一文件/业务存储、配置锁、当前 Auth/ACL、审计和原检查解析器。知识权限、修订解析、原键及 unknown 错误工厂可按需供给。新知识上传在写入前核定原错误工厂，原键观察在查询前核定原键和修订解析，缺少所需参加者时明确不可用。原合法任意 module/scene 及历史回执继续沿原权限处理。固定 Staff 场景消费公共文件应用，企业和换货专用依据分别使用所属参加者。原 Nest 类只维护唯一定时器、生命周期与 AI 清理参加者，AI 物理删除仍核原政策和收据。[文件应用](src/file-application-runtime.ts) · [原宿主](../../apps/api/src/modules/integrations/file-storage.runtime.service.ts) · [AI 清理参加者](../../apps/api/src/modules/integrations/file-ai-retention.participant.ts)

型号图片首次解绑在原图片事务中把 active 文件排为 `delete_queued`；已有排队、未定、在途或已删事实保持原收据。唯一清理器占用后才派发删除，Core 移除观察保留未完成作业与 unknown 阻碍。[图片事务](src/mysql-core-configuration.ts) · [移除观察](../../apps/rental-api/src/core-removal-source.ts)

员工原键观察的请求与回执 schema 从 `@rental-os/rental-core/staff-upload-observation` 读取，服务端从 `@rental-os/rental-core/file-application-staff-observation` 导入 `parseStaffUploadObservation`。解析复用原 Ajv 封闭校验、8KiB 描述上限及原上传键 UTF-16 长度和 trim 规则，宿主继续向同一 HTTP/文件参加者供给解析函数。[观察合同](src/staff-upload-observation.ts) · [原键解析与观察](src/file-application-staff-observation.ts)

企业回款文件绑定从 `/file-application-enterprise-payment-proof` 接入。原企业 Controller 提供当前客户、空间及订单依据，参加者覆盖客户端提交的证明元数据，并核完成与重放的原绑定；原文件编排继续维护同一上传键、冻结对象和事务。其他原合法 module/scene 沿现有兼容入口处理。[企业绑定参加者](src/file-application-enterprise-payment-proof.ts) · [原文件编排](../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)

企业凭证与检查字节经 `/file-application-rental-evidence` 读取，宿主供给真实文件配置、业务引用、受控检查对象reader和原媒体解码器。返回前核当前文件、完整大小、原冻结摘要及业务绑定；员工从 `/file-application-staff-observation` 只观察本人/当前空间的原键事实，缺原记录明确返回未观察，不因此放行重传或提供上传地址。原Runtime继续供给同一参加者与唯一清理/扫描实例。

HTTP入口从 `/http-workspace-capabilities`、`/http-staff-payments` 导入；`/http-service-ports` 给出两个服务令牌及实际方法合同。宿主将令牌绑定到原空间能力、原员工收款服务，使用 `useExisting` 保持同一实例；当前 [API装配](../../apps/api/src/app.module.ts) 是兼容示例。原 [Guard](../../apps/api/src/common/api-auth.guard.ts)、员工地点投影、当前空间、事务与原收据仍由原链核验。公共无Core宿主不注册这些Controller。字段与路径继续查 [OpenAPI](../../apps/api/src/contracts/openapi-document.ts)，SDK接点不开放Agent工具。

会员应用从 `@rental-os/rental-core/mysql-membership` 创建 `MembershipService`，依次提供同一存储、状态/风险操作、客户主档、统一注册和企业政策实例。`/membership-ports` 描述实际方法，`/customer-operations-ports` 为状态与审计输入的唯一声明。租户共享会员仍按空间解析业务资质和权益；审核、客户状态及原附件依据在原事务内核定，履约重读当前关系/资质并使用订单原规则，历史快照不替代当前权限。[会员应用](src/mysql-membership.ts) · [原Nest接线](../../apps/api/src/modules/platform/membership.service.ts) · [原Controller](../../apps/api/src/modules/platform/membership.controller.ts)

会员HTTP从 `/http-membership` 登记Controller，`/http-membership-applications` 的两个令牌绑定同一会员和门户服务；请求验证类从 `/http-membership-request.dto`、`/http-enterprise-portal-request.dto` 导入。客户状态仓储从 `/mysql-customer-operations` 创建并传入同一主档写入者，门户授权从 `/mysql-enterprise-portal` 创建并接同一存储。原租户/空间、角色、门户修订及收据规则保持；门户授权不替代企业订单/资金资格。[原同实例接线](../../apps/api/src/modules/rental-core/rental-http.providers.ts) · [原门户验证](../../tests/enterprise-portal-access.test.cjs)

租赁客户仓储从 `@rental-os/rental-core/mysql-customer-master` 创建，传入同一数据源。注册、合并、会员/账号状态和企业流程持有原锁及事务，再把同一事务传给仓储方法；普通姓名变更使用原修订CAS，企业关系变化不恢复旧授权。后台重置口令和客户端自助注册分别沿原规则，不能借重试解除暂停。[原注册入口](../../apps/api/src/modules/platform/customer-registration.service.ts) · [原注册验证](../../tests/customer-registration-unified.test.cjs) · [写入口检查](../../scripts/validate-customer-write-ownership.cjs)

该仓储只属于Rental示范；其他Core维护自己的领域客户或成员模型，不通过相同ID取得这些表的读写权。原API的 `SharedCustomerRepository` 只注入同一数据库，原完整事务类型别名保持；包内存储只消费本表窄视图。

空间版本准备从 `@rental-os/rental-core/mysql-category-preparation` 创建，供给原数据库、同一能力/Hook实例、当前商业reader、原Auth及采用可用状态。`preview` 只检查，`saveBatch` 保存明确预备字段和原批次回执，`readBatch` 核当前操作者读取自己的原结果。准备不激活实体/能力或切换绑定，陈旧来源不能自动覆盖。[准备HTTP入口](../../apps/api/src/modules/rental-core/category-adoption-preparation.controller.ts) · [原批次验证](../../tests/category-preparation-batch-service.test.cjs)

最终采用从 `/mysql-category-adoption` 创建，供给原六项参加者，当前Auth先核整个空间权限；商业锁先于品类/政策/空间锁。在同一ReadCommitted事务复核准备、当前对象/字段/规则/价格/能力与权益，原绑定CAS、审计和幂等收据一起提交，返回前再核原会话。`readOriginal` 只查原键及原审计，后续采用或政策变化不重做旧操作；采用成功和失败均保留准备，原测试入口开关与生产限制保持。[私有接点](src/category-adoption-ports.ts) · [原采用验证](../../tests/category-adoption-application.test.cjs)

品类治理从 `@rental-os/rental-core/mysql-category-governance` 创建，供给同一数据库、能力实现目录、原Web身份解析器和当前账号reader。读取/草稿/发布继续使用原权限，写入在Serializable内先核会话和角色，再锁品类/版本，返回前复验；创建/发布重复请求只核原审计。版本发布、采用政策与商户实际采用分别办理，服务不改商户绑定或初始化。`/category-creation-templates` 和 `/category-definition-diff` 仅处理配置数据，缺原认证时写入拒绝。[原治理Controller](../../apps/api/src/modules/rental-core/category-governance.controller.ts) · [原创建验证](../../tests/category-creation.test.cjs)

品类HTTP从 `/http-category` 接入，将同一治理、准备和采用实例交给 `RentalCategoryHttpModule.register({ governance, preparations, adoptions })`；已有Nest服务模块可用 `registerFactory` 的 imports、inject 和 useFactory 供给同一对象。原API沿三个 `useExisting` 令牌接线，AI及旧HTTP引用同一Controller类。宿主仍提供全局身份/权限Guard，环境开关只控制预览暴露。[HTTP模块](src/http-category.module.ts) · [三项应用接点](src/http-category-applications.ts) · [原宿主接线](../../apps/api/src/modules/rental-core/category-http.providers.ts)

治理请求从 `/http-category-governance.dto`，准备/采用请求从 `/http-category-adoption.dto` 导入；两组共用原15个校验类和字段。`platform/rental-categories` 与 `rental/v1/category-adoption` 的25个方法保持原路径，字段继续消费原OpenAPI，返回结果仍由业务服务裁定。预览默认关闭，生产环境始终关闭。[治理HTTP](src/http-category-governance.controller.ts) · [采用HTTP](src/http-category-adoption-preparation.controller.ts) · [预览门禁](src/http-category-preview.guard.ts) · [原API字段](../../apps/api/src/contracts/openapi-document.ts)

绑定草稿从 `@rental-os/rental-core/bound-rule-draft` 或 `/bound-calendar-draft` 创建，供给同一数据源和原业务服务。调用方先走原规则/日历Guard，再将当前复验函数传给 `review`、`save` 和 `read`。`review` 只返回完整候选及核对摘要，`save` 在原父锁→空间锁内校验摘要与目标版本，业务草稿和原收据同事务；`read` 按原键回读。规则历史恢复产生新草稿，已有草稿使用原CAS，保存不发布、不创建AI任务或批准。[原规则消费者](../../apps/api/src/modules/ai-native/scenes/opening-rule-draft.composition.ts) · [原日历消费者](../../apps/api/src/modules/ai-native/scenes/opening-calendar-draft.composition.ts)

批准通知设置从 `/mysql-approved-settings` 创建，组合 `/approved-settings-route-authority`、原Core和批准参加者。原路由桥每次调用真实Guard及当前凭据，保留staff/operator和权限指纹；配置提交、批准消费与收据使用同一事务。`readAuthorizedChange` 核当前可执行条件，`readHistoricalChange` 只读冻结原材料，`readOperation` 核原批准消费后读原收据；unknown不换键重发。[原设置消费者](../../apps/api/src/modules/ai-native/approval-execution/approved-settings-application.composition.ts) · [原定向验证](../../tests/category-config-write.test.cjs)

这组私有MySQL/路由适配继续使用原Prisma生成模型及Nest ExecutionContext；相关可选peer由实际宿主提供，公共Core清单与领域根出口不加载这些服务。其他业务Core按通用接入合同实现自身领域，不必使用Rental草稿或行业表。

客户同意从 `@rental-os/rental-core/mysql-exchange-inspection-consent` 创建，供给同一存储、幂等、原客户认证和可选冻结照片读取服务。批准执行从 `/mysql-approved-exchange-execution` 创建，供给原Core、试算、业务、检查、幂等、企业政策和授信实例；企业参加者使用 `ApprovedExchangeTransaction<TTransaction>`。普通客户只能对本人的具体检查同意，费用确认与营运执行仍为独立授权。[原客户provider](../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts) · [原执行provider](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts) · [企业直接消费者](../../apps/api/src/modules/enterprise/enterprise-merchant.controller.ts)

两者保留原同事务写入与ReadCommitted。执行的 `executeInTransaction` 使用调用方事务，外层持有者在提交确认后发布缓存/响应；`original` 只核原执行、批准消费、具体同意、正式变更及幂等收据。未记录或损坏的证据不授权重做，已消费批准的旧到期时间不作为历史读取的新支出许可。API继续由原Controller/OpenAPI声明，SDK不赋予业务Agent访问权。

换货检查准备从 `@rental-os/rental-core/mysql-exchange-inspection-preparation` 创建，供给同一数据源、核心、试算、幂等与当前授权实例。影像从 `/mysql-exchange-inspection-media` 创建，供给同一检查实例和原文件服务；两者的[窄接点](src/exchange-inspection-ports.ts)只描述本链需要的方法。`readForExecution` 使用调用方已有事务，准备、照片消费、批准和原收据不会因迁移另开提交边界。[原检查provider](../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.service.ts) · [原影像provider](../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.service.ts)

文件适配返回的完整计划通过 `TPlan` 原样交还该适配，私有配置不进入公共清单或HTTP结果。完成占用先提交，只有本次已确认占用可读取暂存并冻结一次；重启或首响应丢失只核对原冻结目标。没有可信冻结证据时保持unknown，订单修订或当前权限变化继续拒绝。严格输入从 `/exchange-inspection-dto` 复用；HTTP八项路由、权限及字段仍由[原接口声明](../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.schemas.ts)提供，SDK方法不是任意业务Agent的调用许可。[原七项检查消费者](../../tests/enterprise-extension-approval.test.cjs)

普通附件权限从 `@rental-os/rental-core/file-access` 接入同一 `RentalFileBusinessAccessService` 与 `RentalFileBusinessReferences`，供给原事实仓储、报价读取及客户敏感资料参加者。原 [文件权限适配](../../apps/api/src/modules/files/file-business-access.service.ts) 已消费同一实现。未知业务绑定拒绝，租户共享客户资料不开放跨空间订单；公开商品图须有启用空间、已发布渠道和真实媒体绑定。元数据与上传会话使用 [公共文件模块](../platform-server/src/modules/files/README.md)，实名、承运、知识和专用检查沿所属 Controller 与授权入口处理。

员工交接、线下收款和工单凭证从 `/file-application-participant` 接入。宿主供给原数据库事务、当前会话的主体锁及复验、实际文件读取 ACL，并将参加者注册到公共文件应用。参加者按五组固定业务绑定核对权限、地点与原文件回执，主体锁先于文件配置锁。`/business-location-scope` 供原 Guard、Auth 和员工文件共用，按启用组织子树及实际经营空间投影地点范围。[员工文件权威](src/file-application-participant.ts) · [地点投影](src/business-location-scope.ts) · [原宿主接线](../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)

专用换货影像通过 `/file-application-exchange-inspection` 使用同一文件配置、上传事实和受限字节传输。原换货应用先核订单与来源，再把原事务交给文件适配写入暂存记录及完成收据。文件适配先登记冻结目标再写入字节，失应答后只读取该目标，验收后的照片按原摘要读取。通用上传、下载和清理继续隔离该场景。[换货影像文件适配](src/file-application-exchange-inspection.ts) · [原业务入口](src/mysql-exchange-inspection-media.ts)

核心聚合从 `@rental-os/rental-core/mysql-core-runtime` 导入。核心/事实仓储、恢复、Hook、资金与服务容量使用本包的同一实例，会员、企业支出/授信、文件生命周期与企业续租报价按 [实际端口](src/core-runtime-ports.ts) 供给。原Nest provider保留原构造顺序和初始化钩子。有完整规范化读取器时，启动先核历史迁移依据，再读取已提交的配置与事实；合法空集保持空，不从恢复副本或样本补回。旧快照宿主仍按原回填顺序预热，事务内配置读取不发布进程缓存。历史订单没有能力快照时保留空执行名单，当前新能力不反向影响旧订单。HTTP权限仍由原Guard裁定，业务方法继续接收调用方已有事务。[原Nest接线](../../apps/api/src/modules/rental-core/rental-core.service.ts) · [核心验证](../../tests/rental-core-v01.test.cjs) · [换货/续租历史验证](../../tests/rental-exchange-segment-pricing.test.cjs)

报价/营销服务从 `@rental-os/rental-core/mysql-business-runtime` 导入，配置、事实和核心配置仓储使用同一实例；会员、企业币种核验、密文及短信通过 [实际端口](src/business-runtime-ports.ts) 供给。原API的14项构造顺序与两个初始化钩子保留，适配层另把原通知正文保留读取器传给包内构造末尾的可选接点。配置/事实按同一刷新队列装载，续租事务上下文沿用模块级ALS。报价来源每次从同一公共可信身份读取，detached配置不发布进程缓存；`delivery_uncertain` 只按原投递记录查询，尝试次数与租约仍分别处理。[原Nest接线](../../apps/api/src/modules/rental-core/rental-business.service.ts) · [报价/营销验证](../../tests/rental-business-v1.test.cjs) · [通知恢复验证](../../tests/rental-notification-lease.test.cjs)

真实短信沿同一事实仓储认领原通知，核当前租户/Core/空间与原修订，再先提交 `delivery_uncertain`，确认后才调用供应商。结果按该次观察的原范围与修订 CAS 落库；提交失应答、结果写失败、重启或租约过期均只核原记录。HTTP 用 `dispatchCommittedNotification` 消费已确认的入队收据，后续撤权或查询失败时返回最后确认的原收据并提示核对，不把入队改成失败。订单附属通知不能遮盖已提交的订单结果，显式通知重试仍遵守原错误合同。原通知作业已由[标准参加者](src/application-participants.ts)登记，并在原认领、限频和派发事务复验当前作业权威。支付作业沿同一参加者先核父级准入，再由原支付事务锁订单并复核完整空间范围。[通知事实](src/mysql-business-facts.ts) · [业务消费](src/mysql-business-runtime.ts) · [HTTP入队结果](src/http-business.controller.ts)

通知草稿的准备、保存和原结果读取仍由同一业务实例执行，发送是另一个授权动作。宿主通过 `/notification-draft` 的窄接点供给原维护读取器；`/notification-log-cache` 只接收核验过的原行与删除账，产生不可变且无正文的缓存，反序列化副本不会获得核验标记。`/notification-snapshot` 在原恢复写入时剥离草稿正文，普通发送记录保持原值；正文已删除时，原结果返回原删除收据与空正文，不能以缓存内容或空密文推断删除成功。[原维护读取器](../../apps/api/src/modules/ai-native/privacy/retention-notification-draft.ts) · [原缓存适配](../../apps/api/src/modules/rental-core/rental-notification-log-cache.ts)

缓存观察的 `Source` 沿 `rentalNotificationLog.findFirst` 的租户、空间、原行 ID 和原键读取，删除账由原 `aiDataErasure.findUnique` 按稳定收据 ID 查询。这两个窄接点兼容独立组合与原 API 的生成客户端。涉及原通知草稿且缺少维护删除账时明确不可用。[原行合同](src/notification-log-cache.ts) · [删除账接点](src/notification-draft.ts)

订单确认从 `@rental-os/rental-core/mysql-order-confirmation` 导入，供给同一核心、业务、事实、幂等、Hook、客户/会员、服务容量和企业政策实例。新订单在原ReadCommitted事务重查客户/资格、责任主体、地点/经营者、库存和企业政策，再一起提交订单、报价消费、券、容量、原幂等及批准；批准事务保留原等待与执行上限。返回的 `replayed` 供调用方判断是否发送首次下单通知。原键恢复只读取原收据和批准消费关联，失应答不换键重做。[确认Nest接线](../../apps/api/src/modules/rental-core/rental-order-confirmation.service.ts) · [确认范围验证](../../tests/rental-order-quote-scope.test.cjs) · [原批准事务验证](../../tests/ai-native-fork-execution-approved-core.test.cjs)

商户委托端口把原私有企业来源所有者与同一订单确认实例组合，宿主用真实事务类型实例化 `RentalMerchantDelegatedOrderPort<TTransaction>`。当前营运身份、原D/K、请求指纹和参加者回调在同一模块封存；历史读取和已消费委托不进入新提交准备。企业政策使用原Core证明对象，JSON投影只用于参加者的数据传递。原API兼容入口绑定Prisma事务类型并再导出同一构造器和校验函数。[原委托接线](../../apps/api/src/modules/rental-core/rental-merchant-delegated-order.authority.ts) · [企业直接消费者](../../apps/api/src/modules/enterprise/enterprise-merchant-order-submission.service.ts)

配货从 `@rental-os/rental-core/mysql-allocation` 接入，同一数据库、事实仓储和核心实例负责原资源与数量判定。`manage` 使用调用方原事务；办理锁可参加已有事务，释放/解锁仍沿原善后权限。宿主只登记一个配货provider，继承原初始化/销毁钩子，扫描每60秒运行并保留原防重；实际自动变更只在管理员开启时执行。可选失败事件在原聚合写入后参加同一事务；`readRecordedFulfillmentIssue` 只投影原已记录来源，不重新扫描或提供新执行权。[原Nest接线](../../apps/api/src/modules/rental-core/rental-allocation.service.ts) · [原配货验证](../../tests/rental-allocation.test.cjs) · [交接锁验证](../../tests/staff-operation-lock.test.cjs)

停止作业后，原订单扫描返回时再次检查停止标记，阻止开始新的配货事务；已进入的事务等待原结果完成。异常收口同样在新失败事务前检查停止状态，保留已提交的订单、分配修订与原收据。[扫描与排空](src/mysql-allocation.ts) · [原作业恢复验证](../../tests/rental-worker-recovery.test.cjs)

工作台规则从 `@rental-os/rental-core/workbench` 复用，输入由原Controller按当前租户/空间、订单/工单权限和可见订单过滤。退款待办使用原资金依据，通知失败只关联可见父订单，不从消息文本或待办链接扩展读权。[原工作台接点](../../apps/api/src/modules/rental-core/rental-core.controller.ts) · [原工作台验证](../../tests/rental-workbench-todos.test.cjs)

报表从 `@rental-os/rental-core/mysql-reports` 创建，宿主仅提供本表的只读方法，原Auth/ALS供给当前地点及数据范围。每次查询保留租户/空间、草稿排除、订单归属和地点过滤；仅本人范围不能读取混合空间库存快照的整份报表。AI使用固定 `getBoundedOperationReport`，数量或分页证据冲突明确拒绝，不能把部分统计当总数。CSV从 `/report-csv` 复用，币种、筛选和历史口径说明跟随同一结果，导出不重新查询。[原报表Nest接点](../../apps/api/src/modules/rental-core/rental-workspace-report.repository.ts) · [原导出接点](../../apps/api/src/modules/rental-core/rental-workspace-report.csv.ts)

到期作业从 `@rental-os/rental-core/mysql-due-jobs` 接入，原Nest provider供给同一数据库、Core、业务、动作幂等、容量、企业核销及支付实例。GET_LOCK、任务与RELEASE_LOCK仍在同一交互式事务连接，内部业务沿原短事务和操作键；失败释放锁并继续其他任务/空间，不以本地支付过期代替原渠道核验。宿主只登记一个provider并继承原启动/销毁钩子；企业/支付保持原Optional接线，启用相应生产任务须提供原参加者，不能用空成功替代。标准宿主从[应用参加者](src/application-participants.ts)构造同一 allocation 与 dueJobs，并由[唯一生命周期](../../apps/rental-api/src/lifecycle.ts)统一启动和排空。[原作业接点](../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts) · [原离线作业验证](../../tests/rental-due-job-scheduler.test.cjs)

支付到期与手动关单共用 [原支付执行器](src/mysql-payment-runtime.ts)的唯一关单运输收据。准备记录按原支付单派生固定键，在原租户、订单和支付单锁下先提交，再复核当前派发权。收据保存原空间、商户单号、提供方、方式、金额及 Stripe 原 Session。查询和关闭结果提交均核同一快照，原支付状态和渠道应答继续决定结果。准备提交失应答、运输超时或结果落库未确认时，恢复仅查询同一支付单；可信已关闭结果同时收口原意图与关单收据，可信已付结果沿原入账。手动重试和重建 worker 共用该观察，进程退出仍等待已进入运输的原结果。[原作业恢复验证](../../tests/rental-worker-recovery.test.cjs)

调价作业遇到提交应答丢失时，按原租户、空间、价格组和调价计划回读原状态；已执行的计划须关联同范围的原价格版本，返回同一个版本。缺少可信版本或事务结果未定时返回 `unknown`，保留原事实。仍待执行的计划在原锁和当前权限下，只将明确业务拒绝记为失败；读取已提交结果不重新申请新业务执行权限。[调价运行时](src/mysql-business-runtime.ts) · [原作业恢复验证](../../tests/rental-worker-recovery.test.cjs)

| 宿主启动的原执行者 | 业务与存储接点 | 退出及恢复边界 |
| --- | --- | --- |
| `workers.allocation` | [配货](src/mysql-allocation.ts)、[事实/事件](src/allocation-storage.ts)与[当前作业权威](src/application-worker-authority.ts)，同一实例供 HTTP、AI 及自动扫描消费 | 停止扫描并等待原在途工作，原订单、配置开关与失败事件保持原事务边界 |
| `workers.dueJobs` | [五项到期任务](src/mysql-due-jobs.ts)、[服务端口](src/due-job-ports.ts)及[标准参加者](src/application-participants.ts)，涵盖待确认订单、领取逾期、原通知、调价和支付到期 | 停止新 tick，等待空间枚举、同连接命名锁及已进入业务完整返回。停机期间完成的准入查询不再启动后续批次或动作，unknown 沿原操作核对 |
| `integrations.fileCleanup` | [集成生命周期](src/application-integrations.ts)、[文件应用](src/file-application-runtime.ts)与[清理权威](src/application-file-cleanup-authority.ts)，处理原过期上传、完成暂存及待删除对象 | 等待当前清理批次，删除失应答只观察原对象键与修订，AI 知识依赖沿显式选装参加者 |
| `client.rateLimit` | [唯一限流实例](src/mysql-client-rate-limit.ts)，HTTP、客户认证及清理共用原配额表 | 等待当前清理，完整日窗口和原原子递增保留，退出后由宿主关闭同一数据库 |

上述执行者由[宿主生命周期验证](../../apps/rental-api/test/lifecycle.test.cjs)和[原到期任务验证](../../tests/rental-due-job-scheduler.test.cjs)覆盖所选正常、拒绝及排空分支。业务事件从[仓储组合](src/application-repositories.ts)参加原调用方事务，启用 AI 时使用同一[失败出箱](../ai-native-server/src/business-events/prisma-business-failure-outbox.ts)。真实数据库锁、外部运输、进程重启及完整卸载沿各自实际环境核验。

换货候选/试算从 @rental-os/rental-core/mysql-exchange-preview接入，供给同一核心、报价/营销、配货和原事务，使用[私有服务视图](src/exchange-preview-ports.ts)。已有事务原样传入；没有事务时由原数据源开启。候选只释放当前受权商品及可用资产，预留和费用批准分别由原业务入口执行。旧Nest provider保留五项依赖和可选容量；需容量的新服务缺组件时明确拒绝。[原试算接线](../../apps/api/src/modules/rental-core/rental-exchange-preview.service.ts) · [换货计价/历史验证](../../tests/rental-exchange-segment-pricing.test.cjs)

凭证从 @rental-os/rental-core/document-contracts读取类型；/document-renderer只接受公开业务事实并转义HTML，/mysql-documents组合当前订单/检查/资金读端口及[快照表视图](src/document-storage.ts)。相同内容复用原不可变版本，订单变化追加；首次竞争只在原Prisma唯一键错误时读赢家，其他错误继续抛出。历史先核当前订单与空间，含资金版本继续核财务权限，不回读当前价格替代历史。纯渲染构造保持原兼容，真实API归档必须供给存储。[原凭证接线](../../apps/api/src/modules/rental-core/rental-document.service.ts) · [原渲染验证](../../tests/rental-document-renderer.test.cjs) · [原历史验证](../../tests/rental-document-snapshot.test.cjs)

经营空间解析从 `@rental-os/rental-core/mysql-workspace-scope` 复用。有请求空间时重查它属于目标租户，原初始化/恢复只读原default标记，找不到则拒绝；HTTP缺少范围由原Guard先拒绝，解析结果不授予权限。配置写入通过同一 `assertScopedWrite` 核旧对象的租户/空间，避免全局id命中后覆盖他人资料。该空间模型只属于Rental，其他Core使用自己的业务分区。[原空间兼容出口](../../apps/api/src/modules/rental-core/workspace-scope.ts) · [空间范围验证](../../tests/rental-workspace-scope.test.cjs)

请求DTO按用途从 `@rental-os/rental-core/configuration-dto`、`/core-dto` 或 `/order-dto` 导入，原API路径再导出同一运行时类。企业与客户预约的告知从 `/enterprise-disclosure-dto` 复用，嵌套转换继续使用同一个类。宿主按原Nest启动先加载 `reflect-metadata`，此子出口使用兼容的 `class-transformer` 和 `class-validator`；构建保留 `experimentalDecorators` 与 `emitDecoratorMetadata`，数组和嵌套对象沿原显式 `Type` 与 `ValidateNested` 校验。完整字段由 [原DTO门禁](../../scripts/validate-dto-coverage.cjs) 扫描实际源码，HTTP/OpenAPI字段继续引用原声明。[原HTTP入口](../../apps/api/src/modules/rental-core/rental-config-request.dto.ts)

资金服务从 `@rental-os/rental-core/mysql-funding` 接入，宿主提供同一数据源、每次请求的原身份/订单可见范围，以及已启用企业业务的原应收参与者。已有事务原样传入；服务自开事务时保持原ReadCommitted，资金解释保持原RepeatableRead有界快照。实款、演练、企业回款分配和预授权各按原依据读取，缺供应商核验不显示真实可用余额。[原Nest接线](../../apps/api/src/modules/rental-core/rental-funding.service.ts) · [资金门禁验证](../../tests/rental-funding-gates.test.cjs) · [事件算法验证](../../tests/rental-funding-events.test.cjs)

服务容量从 `@rental-os/rental-core/mysql-service-capacity` 接入，宿主供给本表数据源、原Auth/ALS身份和空间解析。订单预留、确认、取消及履约方法传入调用方已有事务；容量编辑直接复用包内原品类绑定锁。`readAvailabilityForQuote` 只观察原服务发生项，返回指纹与是否可用，不释放超时预留或新占容量；原写入/维护入口才处理过期账。换货和部分履约沿原收据处理，不按服务ID合并历史。[原Nest接线](../../apps/api/src/modules/rental-core/rental-service-capacity.service.ts) · [容量写入验证](../../tests/category-service-capacity-write.test.cjs) · [原预留/换货验证](../../tests/category-service-capacity-reserve.test.cjs) · [发生项验证](../../tests/rental-service-occurrence.test.cjs)

企业读取从 `/mysql-enterprise-access`、`/mysql-enterprise-orders`、`/mysql-enterprise-finance` 和 `/mysql-enterprise-reader-audit` 接入，同一宿主供给原数据库、已验证客户上下文、真实资金和授信读取方法。当前客户空间与动作资格在读取前后复验，企业订单只释放已告知字段；原敏感读取审计必须持久化。`/mysql-enterprise-command` 在调用方业务事务内记录原操作结果，重复键只读原收据，不再次办理业务。企业合同由 `/enterprise` 和 `/enterprise-workflows` 提供，原shared再导出同一声明。[原订单入口](../../apps/api/src/modules/enterprise/enterprise-read.controller.ts) · [原企业读取兼容](../../apps/api/src/modules/rental-core/rental-enterprise-read.port.ts) · [资格与接口验证](../../tests/enterprise-portal-access.test.cjs)

企业政策和成员流程分别从 `/mysql-enterprise-policy`、`/mysql-enterprise-members` 创建，传入同一存储、命令和资格实例；成员流程再接客户仓储的 `saveEnterpriseRelation`。原Tenant锁、事务/非事务读取身份、报价/原批准及关系修订保持，宿主不包装成会丢失实例身份的副本。邀请原码仅首次返回；退出、管理员变更及交接恢复只读本主体的原收据，缺原依据明确拒绝。政策、交接结果、委托和续租字段分别从对应纯合同子出口读取，客户端不用加载MySQL服务。公共底座不把企业客户成员当作租户后台人员。[政策兼容接线](../../apps/api/src/modules/enterprise/enterprise-policy.service.ts) · [成员兼容接线](../../apps/api/src/modules/enterprise/enterprise-members.service.ts) · [原政策验证](../../tests/enterprise-policy.test.cjs) · [原工作流验证](../../tests/enterprise-workflows.test.cjs)

企业申请、管理请求、待办、交接和成员审计分别从表内对应子出口创建，仍传入同一数据库、命令及资格实例。待办只读取批准原对象，行政交接调用原客户材料与订单范围读取；传给这些参加者的事务保持原实例。付款证明核原订单修订、冻结附件和当前客户/商户权限，审核不会代替资金入账。沿原Controller进入包内服务，再查私有存储与参加者即可接手这条链。[申请入口](../../apps/api/src/modules/enterprise/enterprise-application.service.ts) · [管理入口](../../apps/api/src/modules/enterprise/enterprise-management-request.service.ts) · [原HTTP与schema](../../apps/api/src/modules/enterprise/enterprise-merchant.controller.ts) · [原冒烟](../../tests/enterprise-workflows.test.cjs)

预约、续租及换货费用批准从 `/mysql-enterprise-approval`、`/mysql-enterprise-extension-approval` 和 `/mysql-enterprise-exchange-approval` 创建，供给同一命令、政策、资格、Core及客户API实例。新提交使用原订单锁、当前修订和调用方事务，批准消费、业务与原收据一起提交；首响应丢失只核对原键。换货费用确认、具体检查同意和商户执行各有自己的授权。[私有参加者](src/enterprise-approval-ports.ts) · [原预约验证](../../tests/enterprise-approval.test.cjs) · [原续租/换货验证](../../tests/enterprise-extension-approval.test.cjs)

企业商户委托从 `/mysql-enterprise-merchant-delegation` 接入原持久来源，从 `/mysql-enterprise-merchant-order-submission` 接入同一封存Core端口。原客户/商户Auth仍提供当前身份，引用或JSON副本不能获得新执行权；历史读取不重新报价或恢复批准。企业续租的原报价、当前价格在已有事务读取，生效时由Core核验资金并占用一次授信；客户端继续处理自己的服务容量。[原委托入口](../../apps/api/src/modules/enterprise/enterprise-merchant-order-submission.service.ts) · [客户续租消费者](../../apps/api/src/modules/client/client-api.service.ts)

已启用企业业务的宿主从 `@rental-os/rental-core/mysql-order-receivables` 创建原应收仓储，并把同一实例交给资金服务。`corporatePaid` 读取原总回款关联的有效逐单核销，`reconcileCash` 只随本次已持久实款在原订单事务调整债权；原差异或缺收据须核对，不扫描补账。企业账通过 `/mysql-corporate-ledger` 在原授信锁内按500行完整分页，回款与冲销规则从 `/corporate-payment-receipts` 复用。公共人员、权限、企业授信业务入口及外部付款仍由正式调用方处理。[原Nest接线](../../apps/api/src/modules/rental-core/rental-order-receivable.repository.ts) · [私有存储](src/corporate-receivable-storage.ts) · [原资金/企业/文档消费者](../../tests/rental-order-receivable.test.cjs)

企业资料从 `/mysql-customer-corporate` 创建，传入同一客户主档及[私有存储](src/corporate-application-storage.ts)。订单主体在原客户稳定锁内校验，默认开票资料、合同修订和授信敞口沿原事务提交。结算从 `/mysql-customer-corporate-settlement` 创建，再供给原净实收与当前主体/经营空间权限读取。新占用核额度及债权到期依据，最终债权、回款与冲销保留原账和原操作键；客户主档共享不授予跨空间财务权限。运行时仅使用原SQL/Decimal库，生成模型类型留在私有适配。[资料接线](../../apps/api/src/modules/platform/customer-corporate.service.ts) · [结算接线](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts) · [原结算验证](../../tests/corporate-credit-settlement.test.cjs)

检查/换货合同从 /exchange-inspection-preparation 导入，原 @rental-os/shared 再导出同一声明。费用批准的参与者只处理原批准消费；/mysql-approved-exchange 在同一事务读取原费用确认和客户检查同意，生成仅本实例、本事务可用的依据，执行前后再次核对原关联。恢复读取已消费批准与原费用收据，不重新报价、不把旧TTL当今日新业务资格。设置批准使用 /approved-settings-ports 和 /approved-settings-validation，复用原修订与操作键。[原批准接线](../../apps/api/src/modules/rental-core/rental-approved-exchange-authorization.ts) · [客户同意入口](../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts)

本人地址从 `/mysql-client-delivery-address` 创建，传入原地址/交付快照两表及事务、当前Rental配置。报价入口先用 `requireOwnAddress` 核本人归属和精确配送区域，再按原报价键固定快照；订单读取使用原快照，客户投影脱敏，运营读取另核空间。本人注销从 `/mysql-client-account-closure` 创建，供给原客户Auth、状态服务、注销门禁及审计；证明先消费，随后关闭会员、账号和会话，失败不自动重发或撤回已提交步骤。`/client-lifecycle-ports` 是宿主私有适配，客户端仅使用 `/client-contracts` 合同。[原Controller](../../apps/api/src/modules/client/client-api.controller.ts) · [原地址接线](../../apps/api/src/modules/client/client-delivery-address.service.ts) · [原注销接线](../../apps/api/src/modules/client/client-account-closure.service.ts) · [API源码与组合文档](../../apps/api/src/contracts/openapi-document.ts)

客户应用从 `/mysql-client-application` 接入目录、报价、本人订单、费用响应和付款等原方法。宿主按 `/client-application-ports` 提供同一数据库及原18项业务实例，检查费用响应另供给同事务出箱；每次调用沿原出箱实例化规则，不在包内加载AI运行时。`/category-client-projection` 提供同一客户字段白名单，原shared的AI一次性地址证据复用 `/client-contracts` 的六字段声明。原客户Auth仍负责可信会话，业务应用继续核本人对象和原收据。[客户应用](src/mysql-client-application.ts) · [实际参加者](src/client-application-ports.ts) · [原Nest接线](../../apps/api/src/modules/client/client-api.service.ts) · [API源码与组合文档](../../apps/api/src/contracts/openapi-document.ts)

客户 HTTP 从 `/http-client` 登记同一 Controller，通过 `/http-client-applications` 的 `RENTAL_CLIENT_HTTP` 绑定八项真实实例；[原接线](../../apps/api/src/modules/client/client-http.providers.ts)使用 `useExisting`，原 Guard/ALS 仍在敏感资料返回前复验同一会话绑定。客户 Auth、后台/自助统一注册、限流及官网图片分别从上表的正式子出口使用；[原认证适配](../../apps/api/src/modules/client/client-auth.service.ts)保留旧构造位置与同一数据源，原刷新令牌只消费一次，临时密码沿原改密路径恢复。客户端读取 `/client-contracts`，不加载这些私有 MySQL/Nest 适配。[认证/注册验证](../../tests/customer-registration-unified.test.cjs) · [原安全验证](../../tests/client-api-security.test.cjs)

验证码先保存原挑战和发送准备，再调用同一短信运输。提供方失应答或已受理后的结果提交失应答，保留原 `provider_pending`；同键只回读原 ID、期限和送达状态，旧失败或到期记录也不重派。明确失败仍返回原错误，已验证或已使用的挑战拒绝重复申请；客户端需区分原结果恢复与明确获取新的挑战。启用 AI 的完整应用须供给原配货失败出箱等真实参加者，缺方法时在构造服务图前拒绝。[验证码应用](src/mysql-client-auth.ts) · [完整装配](src/application.ts)

文件兼容HTTP从 `/http-files` 登记同一Controller，用 `/http-file-applications` 四个令牌绑定原文件台账、存储、数据库及客户范围服务；实名与承运描述从 `/http-file.dto` 使用两项原验证类。公共创建/完成DTO继续单源，普通文件列表复用原业务ACL，实名与承运先核专用对象范围。[原文件接线](../../apps/api/src/modules/files/file-http.providers.ts) · [实名验证入口](../../tests/customer-identity-verification.test.cjs)

员工 HTTP 使用 `/http-staff-auth` 和 `/http-staff-uploads` 的正式Controller及令牌。[原Staff接线](../../apps/api/src/modules/files/staff-http.providers.ts)复用同一Auth、Prisma与文件实例，观察解析器由宿主供给原Ajv/schema，检查参加者缺失时仍拒绝绑定。上传和完成DTO从 `@rental-os/platform-server/file-dto` 取得同一运行时类；员工五组场景继续核地点、交接阶段、本人和原键，原始body含多余选择器不能被全局whitelist剥离后放行。观察合同本身不签发新上传许可。[员工HTTP](src/http-staff-uploads.controller.ts) · [共用上传DTO](../platform-server/src/modules/files/file-upload.dto.ts)

原客户端继续从 `@rental-os/shared` 读取租赁合同。Rental 自身实现可从本包根出口取合同，从 `@rental-os/rental-core/business-day` 取营业日函数。新业务 Core 使用公共平台和 Core 合同，不必依赖 Rental。

运营集成应用接收当前配置、同一台账仓储及文件读取权威，初始化一组公共文件、通知和作业应用。`MysqlRentalIntegrationRepository` 从同一数据库供给公共台账及 Rental 的打印/TBox 存储视图，设备更新与绑定先按租户和 ID 核定归属。持久化默认通知模板按租户派生主键，内存模板使用其演示标识，两者分别维护各自初始化语义。[运营应用](src/integration-runtime.ts) · [存储适配](src/mysql-integrations.ts)

`RentalIntegrationsHttpModule.register` 使用宿主工厂提供同一运营应用，挂载九个 `/integrations` 操作。原 Nest 服务、仓储与 Controller 提供构造兼容入口，打印从公共 `/jobs/print` 消费该应用的打印参加者。交换任务的模拟结果包含 `externalCallSkipped`、文件元数据及校验报告字段，生产调用沿应用和公共台账门禁裁定。日志失败向外传播，已登记的文件和任务供原键核对。[HTTP 组合](src/http-integrations.ts) · [原兼容入口](../../apps/api/src/modules/integrations/README.md) · [公共作业](../platform-server/src/modules/jobs/README.md) · [租户隔离验证](../../tests/integrations-memory-scope.test.cjs)

完整运营 HTTP 由已有 `RentalIntegrationsHttpModule`、`JobsHttpModule` 和 `NotificationsHttpModule` 共同登记。三组工厂均提供宿主已有的 `rental.integrations.ledger`，分别消费同一运营应用的九项集成、六项作业和三项通知方法。`RentalIntegrationsHttpModule` 已在 `@rental-os/rental-core/http-integrations` 导出，公共两组沿各自正式包出口使用。宿主复用这三组 Controller，并将其原 `system:integration:manage` 政策、实际请求边界和同版 OpenAPI 一并组合。[处理器与请求边界](src/http-integration-access.ts) · [公共作业 HTTP](../platform-server/src/modules/jobs/jobs-http.module.ts) · [公共通知 HTTP](../platform-server/src/modules/notifications/notifications-http.module.ts)

运营 `POST /jobs/run-due` 从当前租户台账筛选已到期的 `queued` 任务，顺序执行前十条；单条执行经宿主提供的结果参加者、原 `finishJob` 和后续适配日志完成。交换任务沿原模板生成模拟文件元数据和校验报告，返回 `externalCallSkipped`。文件、任务完成和日志各自保留原提交与回执，后续失败传播给调用方。[公共台账执行](../platform-server/src/modules/jobs/job-ledger.ts) · [Rental 交换与打印结果](src/integration-runtime.ts)

真实通知重试从 `workers.dueJobs` 的 `retry_due_notifications` 进入原业务应用，消费当前租户、经营空间中到期的短信 `queued`／`failed` 记录。原事实仓储按记录范围和版本认领，运输前先提交 `delivery_uncertain`，随后结果沿同一记录与观察版本写回；供应商调用使用原通知操作键。完整宿主在[集成工厂](src/application-integrations.ts)构造通知运行时，由[应用装配](src/application.ts)注入业务应用。[原重试与派发](src/mysql-business-runtime.ts) · [认领与结果仓储](src/mysql-business-facts.ts) · [作业提交围栏](src/application-participants.ts)

请求边界绑定真实 Controller 和 handler。仪表盘和通知模板列表保留默认模板初始化，每次原 upsert 在独立 ReadCommitted 事务内锁定 Tenant/Core，重复维护保留历史主键。任务入队与完成、通知登记、适配日志、打印记录、设备更新与绑定也在各自原提交点使用同事务围栏，随后日志仍独立提交，日志失败保留先前回执。兼容宿主沿原存储办理，标准 Rental 宿主选中的请求权威在每次提交核验租户、Core 和部署状态。共享准入在每个原事务使用同一 Auth 的成员租约锁定并复验当前会话、账号、角色、数据与地点范围，沿 Tenant 共享父锁保持原锁顺序；缓冲读取返回前再次复验。十八项声明分别登记六项纯读取、两项模板维护读取和十项写入的实际参加者，完整宿主组合由 `compileRentalHttpAccessPolicy(...).assertReviewed()`核定。[原成员权威](src/application-member-authority.ts) · [原会话租约](src/auth-service.ts) · [请求边界](src/http-integration-access.ts) · [共享准入](src/application-access.ts) · [原私有提交](src/mysql-integrations.ts)

SQL、Decimal、空值单例、错误类和隔离级别通过正式 `@rental-os/platform-server/prisma-runtime` 复用官方运行库。JSON 写入使用 [Rental 空值桥](src/prisma-null-values.ts)的 `/prisma-null-values`，将同一官方单例连接到所选 Client 的输入类型；公共底座不引用业务生成类型。业务枚举保持原字面值并由生成类型约束；核心/业务私有 MySQL 声明使用所选宿主 schema 的生成类型。首次源码构建可先运行[纯schema准备入口](../../scripts/prepare-selected-prisma-schema.cjs)，选择 `rental`（161模型）或 `rental-ai`（247模型），将 schema 写到 `apps/rental-api` 根下显式指定且尚不存在的直接子目录；它不依赖 `dist`、不生成Client，也不办理迁移或部署。随后由宿主的独立生成流程产生 `apps/rental-api/generated/client`，再开始编译。完整发行包的[部署准备](../../apps/rental-api/src/prepare-deployment.ts)用于已构建发行的核验，不是首次源码生成的前置。

数据发行从 `createRentalDataRelease` 核对受控包的固定版本、可读范围和迁移原文。每项使用 `rental.` 命名空间，文件位于 `prisma/migrations/<name>/migration.sql` 或 `migrations/<name>/migration.sql`，其中 `<name>` 对应原 Prisma `migration_name`。摘要按原始字节计算，换行及编码变化均须作为发行差异处理。结果中的数据合同、账名称和 SQL 保持同一顺序，供宿主接入数据计划。[发行合同与原文核对](src/data.ts)

宿主继续核定 SQL 的表归属、公共关联及实际物理结构，再沿原 Prisma 迁移账读取执行状态。失败和 unknown 保留原迁移、摘要与恢复依据。原 API 的组合迁移涉及公共、Rental 和 AI 数据，存量部署沿其原链及原收据维护，新空库使用所选公共基线与 Rental 自有迁移。[结构核验](../platform-core-host/src/mysql-structure.ts) · [物理观察](../platform-core-host/src/mysql-physical.ts) · [原迁移账读取](../core-host/src/mysql-deployment.ts) · [原组合迁移](../../apps/api/prisma/migrations)

```powershell
# 从仓库根执行；该文件必须是宿主已经生成的真实声明。
$env:RENTAL_PRISMA_CLIENT = (Resolve-Path 'apps/rental-api/generated/client/index.d.ts').Path
npm run build -w @rental-os/rental-core
npm run lint -w @rental-os/rental-core
```

正式[编译入口](../../scripts/build-selected-prisma.cjs)支持 `--project <原tsconfig>`、`--mode rental`、`--client <index.d.ts>` 和 `--noEmit`。npm 前置链通过绝对路径变量 `RENTAL_PRISMA_CLIENT` 继承同一个选择；仅把 `--client` 追加到末端 npm 命令不会传给前置构建。编译器只增加 `@prisma/client` 的精确类型映射，保留原 `rootDir`、输出目录及正式出口；声明、相邻 `schema.prisma`、模型集合或已配置路径不一致时立即失败。编译不读取 `.env`、不生成或运行Client、不启动引擎或连接数据库。发行 `.d.ts` 保留 `@prisma/client`，消费者也须将其解析到自己同一所选Client。

旧 `apps/api` 的原241模型组合沿原生成及运行Client维护；编译依赖包时须显式指定本仓库原默认生成声明，并额外设置 `RENTAL_PRISMA_LEGACY=1`（或CLI传 `--legacy`）。该路径核对生成 schema 与原宿主源码一致，不能把旧241冒充独立247；独立 `rental-api` / `platform-api` 拒绝 legacy。独立构建前应移除该兼容变量。

构建前置按公共合同 → Rental基础合同 → Shared兼容声明 → 公共Core宿主 → Rental完整服务的顺序执行；`npm run build:contracts -w @rental-os/rental-core`只生成Shared实际消费的17个正式合同入口及其内部依赖，避免Shared与完整服务循环构建。该入口保留同一运行时值和正式声明，不创建另一套合同。[合同构建配置](tsconfig.contracts.json) · [内存构建检查](../../scripts/check-rental-package-build.cjs) · [固定版本发行与五端消费核验](../../scripts/verify-rental-distribution.cjs)

独立公开仓库从实际发行提交构建标准包，清单、Tag 和 Release 资产须对应同一来源。公开包声明 `/api/cores/rental/v1` 下已审定的业务操作，部署后的规范路径和原路径进入同一 Controller。包准备、实际部署、注册和租户授权沿现有流程完成。见[规范路径和文档共用入口](src/http-portable.ts)与[宿主接入说明](../../apps/rental-api/README.md)。

公开出包时用 `--source-repository https://github.com/JinPen-G/Nativark` 固定底座和公共资料来源，`--core-repo` 指向独立 Core 仓库。构建与底座 SHA、独立仓的版本 Tag 和新归档路径分别传入；已有安装的来源保持原值，跨仓迁移按明确的来源处置流程办理。

```text
node scripts/verify-rental-distribution.cjs --portable --commit <构建SHA> --platform-commit <底座SHA> --source-repository https://github.com/JinPen-G/Nativark --core-repo <独立仓根目录> --core-commit <版本Tag的SHA> --out <新目录/rental-版本.tgz>
```

独立 Linux 镜像使用[宿主打包入口](../../scripts/package-rental-host.cjs)。先完成正式源码构建、完整 Rental 标准包及[原部署准备](../../apps/rental-api/src/prepare-deployment.ts)，再从仓库根执行以下命令；参数均为实际绝对路径，输出父目录须存在且归档不能已存在。底座 `.tgz` 须使用与原 prepared 锁的 `platform.sha256` 一致的固定源码归档，不能用候选 `platform/` 目录代替。

```text
node scripts/package-rental-host.cjs --ai disabled --deployment <原prepared目录> --platform-package <原固定底座.tgz绝对路径> --rental-package <完整固定Rental包目录> --client <本树apps/rental-api/generated/client/index.d.ts> --platform-client <本树apps/platform-api/generated/client/index.d.ts> --output <新归档绝对路径.tgz>
```

打包核对原锁、完整包摘要、全部迁移原文、所选声明与schema，并沿实际启动入口检查正式运行出口。包内保留原固定Rental全部资产；其他工作区仅带已构建产物、公开说明、许可与公共数据材料，不带依赖目录、作者Client、环境文件或私有资料。原 npm v3 锁按所选宿主依赖闭包投影，保留第三方版本及完整性摘要。AI关闭时实际入口不得强制引用AI运行包，缺文件或错版直接拒绝。

解包后由部署环境执行 `docker build --target runtime -t rental-host .`。Docker构建按原锁安装依赖，在目标Linux内由同一Prisma 5.22生成公共与Rental两个专属Client，避免携带Windows引擎；最终镜像只安装生产依赖并核实际Node解析。镜像不自动迁移；运行配置、原迁移账和物理观察继续由部署负责人办理。打包结果保持 `imageBuild=not-run`、`deployment=pending`，文件摘要记录在随包 `rental-host.context.json`。[离线打包回归](../../tests/rental-host-package.test.cjs)只在内存验证真实产物、固定包与CLI文件运输，不替代Docker、磁盘安装或业务验收。

完整构建生成本包 JS/声明。根出口提供领域合同与常量，营业日和品类治理按子出口加载。服务端计价、器材及能力执行/条件子出口使用可选 peer `@nestjs/common`，沿用原 HTTP 异常类型，调用宿主和源码构建须提供兼容版本。核心聚合与换货批准子出口使用可选 peer @rental-os/platform-server 的正式 /request-identity，原Guard/API与Rental共用同一ALS实例；领域根出口不加载它。公共请求指纹从 `@rental-os/platform-contracts/request-fingerprint` 复用，已保存的条件 hash 沿用原算法。

HTTP宿主登记 `/http-core` 和 `/http-business` 的两个Controller，从 `/http-applications` 取得明确令牌并绑定同一应用实例。原组合的[接线入口](../../apps/api/src/modules/rental-core/rental-http.providers.ts)使用 `useExisting`，不再创建另一套核心、资金、数据库或生命周期执行者；可选检查事件只绑定原方法。文件上传使用原 `@nestjs/platform-express` 适配，生成模型留在私有HTTP/MySQL边界。公共来源日历由 [platform-server只读接点](../platform-server/src/modules/official-calendars/README.md)提供，业务HTTP不取得来源维护方法；原来源合同和DTO兼容出口转接同一公共声明。日志和业务会员/企业结算分别由实际所有者供给。`/http-context` 复用已选Core的原快照与刷新队列，显式操作键保持191字符边界，各动作仍决定默认键与重放方式。原API再导出同一Controller，路径/字段/权限及原操作读取沿[OpenAPI](../../apps/api/src/contracts/openapi-document.ts)保持。

原组合的[服务模块](../../apps/api/src/application-services.module.ts)集中登记原provider、Guard与审计，并导出一组业务应用。`AppModule`用`RentalHttpModule.registerFactory`消费这组应用，使用`RentalPaymentsHttpModule.registerFactory`消费`{ runtime, statements, core }`；两者取得同一个核心实例。`core.resolveWorkspaceId`继续从可信请求范围解析经营空间，不能由退款参数供给。模块的`imports`须包含导出应用令牌的服务模块；父模块本地provider不会自动进入子模块。使用整组`/http`时，不再另行登记其中的单独Controller。

支付应用使用`/mysql-payment-runtime`和`/mysql-payment-reconciliation-file`，宿主供给原数据库、配置、资金、当前Auth/ALS及失败出箱。公共`@rental-os/platform-server/integration-payment`只负责签名、验签和受控运输。退款额度、实款、原回调键和unknown恢复仍由Rental决定；首响应丢失后只核原操作。客户端金额与对账合同从根出口读取，纯金额和Stripe工具分别使用`/payment-money`、`/stripe-payment`。[原支付入口](../../apps/api/src/modules/integrations/README.md) · [公共支付运输](../platform-server/src/modules/integrations/README.md#支付运输)

企业HTTP按需要登记 `/http-enterprise-read`、`/http-enterprise-merchant`、`/http-enterprise-handoff-merchant` 与 `/http-enterprise-workflows`。从 `/http-enterprise-applications` 的 `RENTAL_ENTERPRISE_HTTP` 取得令牌，并按[原企业接线](../../apps/api/src/modules/enterprise/enterprise-http.providers.ts)绑定实际参加者。客户路径仍使用本人/企业授权，商户与行政交接保留各自营运范围；专用文件读取前后复验，缺真实文件配置继续拒绝。财务读取的可选装配保留原不可用状态，类型/声明在[包配置](package.json)逐项对应；普通与可选 AI 的[标准根装配](../../apps/rental-api/src/app.module.ts)已供给实际企业应用和 HTTP，[AI 根](../../apps/rental-api/src/ai-app.module.ts)另行选择原参加者。独立冷安装、真实业务运行和完整兼容验收分别取证。

品类解析和身份子出口同样使用服务端 peer。宿主供给本表只读方法后创建 `RentalCategoryResolver`，普通读取使用同一数据源，业务提交点传入自己的事务视图。`forVersion` 定位原发布引用，`forWorkspace` 每次重读当前绑定，`openingOptions` 返回最多100项及明确截断状态。旧 API 的 Nest provider 继续承担这条装配。[原 provider](../../apps/api/src/modules/rental-core/rental-category-resolver.service.ts)

宿主创建 `CapabilityHookRuntime` 时提供当前租户/空间的实例 reader 和审计 writer，再调用 `registerRentalCapabilityHooks(runtime)` 完成内置组合。业务服务通过 `evaluate` 传入判定对象、原主体引用及自己的事务，放行审计随业务提交。原 API 的 Nest provider 是这条接线的兼容消费者。历史订单继续按冻结版本和配置执行，缺原实现版本时明确拒绝。

空间能力服务通过仓储的正式方法读当前实例、保存变更和初始化。保存继续核当前品类绑定、依赖、互斥及预期修订，实例和审计由同一事务提交。重复初始化只补缺项，保留管理员后来暂停或停用的状态。原 API 的服务与仓储 provider 供给同一实现。[原服务接线](../../apps/api/src/modules/rental-core/workspace-capability.service.ts) · [原持久适配](../../apps/api/src/modules/rental-core/workspace-capability.repository.ts)

MySQL 快照与收据子出口使用可选 peer `@prisma/client` 的原 SQL/JSON runtime，不加载生成模型或实例化数据库客户端；领域总出口不加载这些适配。宿主提供本表的窄存储视图、真实范围解析及原事务。保存 Core 快照时传入已有事务，品类锁、行修订和原事件捕获一起提交；未传入时才由仓储按原 ReadCommitted 方式开事务。收据 `record` 必须传入业务事务，重试先读原键，缺收据保持未知。[原快照接线](../../apps/api/src/modules/rental-core/rental-state.repository.ts) · [原收据接线](../../apps/api/src/modules/rental-core/rental-idempotency.repository.ts)

完整规范化宿主的命令已在原事务保存业务与配置，提交后的 `persist` 不再重复写聚合恢复副本，也不再次检查新业务准入而把原成功收据变成 403。非默认空间档案仍由原配置事务保存。启动遇到未映射的历史主键、订单子关联或内嵌审计，需按原迁移/恢复流程核对；检查只读，不自动回填、重发或删除快照。缺少完整读取器的旧宿主保留原恢复写入，调用方可把同一事务传给业务快照保存。[恢复核验](src/mysql-state.ts) · [已提交结果](src/http-core.controller.ts) · [报价与配置](src/mysql-business-runtime.ts)

业务动作执行器接收原事务端口和幂等仓储。`executeInTransaction` 参与调用方已有事务，`readReceipt` 只读原操作；`executeWithReplayFlag` 区分首次提交与回放，通知等外部副作用由原调用者处理。唯一约束竞争读原赢家，已证实写冲突按原键有限重试，未分类错误原样抛出。Tenant共享锁保留原企业政策的并发围栏，不替代当前角色、Core准入或业务对象授权。[原动作接线](../../apps/api/src/modules/rental-core/rental-idempotent-action.service.ts)

业务配置仓储只通过自身存储视图读写原配置。现有事务传给写入方法后，配置、规则/日历版本及审计由同一调用者提交；没有现有事务时保留原方法自己的事务方式。范围、当前品类绑定和事件捕获从原宿主提供，公开成员视图只读取原开业账号计数。规则版本链按原租期时点及冻结引用匹配，历史规则不被当前默认值改写。[原配置接线](../../apps/api/src/modules/rental-core/rental-business-config.repository.ts) · [原配置写入验证](../../tests/category-rule-write.test.cjs) · [规则链验证](../../tests/rental-rule-version-chain.test.cjs)

核心配置仓储接收本表存储视图、当前身份/范围和原配置事件。默认空间只在首次创建时初始化当时的成员，重读档案不补回撤销成员或更换旧绑定；配置保存保留原CAS与调用方事务。地点/主体状态在原锁中重读，普通编辑不恢复被停用的状态；商品唯一属性和套装组成与实体一起写入。报价、开业和报表读取沿有界接口取得实际配置，恢复快照不代替当前事实。[原核心配置接线](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts) · [初始化验证](../../tests/category-space-initialization.test.cjs) · [配置范围验证](../../tests/config-workspace-scope.test.cjs) · [履约准入验证](../../tests/rental-fulfillment-admission.test.cjs)

业务事实仓储由宿主供给本表方法、当前空间、每次生成的订单可见范围、库存配置 reader 和原通知事件。报价保存锁住原经营空间，只有首次创建分支复核当前履约/能力/库存，已保存报价保留来源、金额与历史快照；券预算、奖励和余额写入继续使用调用方事务及原 Decimal 精度。通知流水先持久化，认领只占租约，原投递结果才累计尝试次数；租约过期不证明可以重新发送。外部短信执行和批准仍由原业务服务处理。[原事实接线](../../apps/api/src/modules/rental-core/rental-business-fact.repository.ts) · [报价恢复验证](../../tests/rental-quote-recovery-review.test.cjs) · [短信限流验证](../../tests/sms-rate-limit.test.cjs)

核心事实仓储接收本表方法与明确的宿主接点。宿主返回原服务端完整身份，范围读取与冻结指纹使用原对象；订单/资产/处置的锁序、聚合与库存流水、检查事件继续在原事务提交。手工资料维护不能释放独立隔离，检查更正保留原读数和更正历史，续租保持原约定期间与冻结价格。库存作业、处置恢复和工单处理由原领域入口核当前权限。[原核心事实接线](../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts) · [订单编号](../../tests/rental-order-number.test.cjs) · [资产历史](../../tests/rental-asset-status-history.test.cjs) · [库存作业](../../tests/rental-stock-operations.test.cjs) · [处置恢复](../../tests/rental-stock-disposition.test.cjs) · [工单](../../tests/rental-work-order.test.cjs) · [检查读数](../../tests/rental-usage-reading-validation.test.cjs)

业务规则使用各自正式子出口，例如 `@rental-os/rental-core/service-catalog`、`/discount-selection` 和 `/security-deposit`。报价访问接收 `RentalQuoteAccessContext`，宿主供给每次请求的原已验证身份与地点范围，旧API函数保持原签名。线下收款方式只接原资金事务的 `$queryRaw`，使用原SQL runtime；设置共享锁保留到原资金提交，缺设置或配置无效明确拒绝。[报价兼容接线](../../apps/api/src/modules/rental-core/rental-quote-access.ts) · [收款兼容接线](../../apps/api/src/modules/rental-core/rental-offline-payment-method.ts)

规则验证沿原消费者复用，覆盖服务计费/条款、优惠取舍、押金/预授权、换货冻结检查及资产和证据边界。[服务目录](../../tests/rental-service-catalog.test.cjs) · [优惠取舍](../../tests/rental-discount-selection.test.cjs) · [资金规则](../../tests/rental-security-deposit.test.cjs) · [换货检查](../../tests/rental-exchange-inspection.test.cjs) · [资产有效期](../../tests/rental-asset-validity.test.cjs) · [检查证据](../../tests/rental-inspection-evidence.test.cjs)

前端宿主调用 `createRentalAdminContribution(version, contexts)` 一次，分别提供订单、养护、能力、地点、商品资产、商业和治理页面的当前上下文 Hook。商品资产使用 `useCatalogContext`，由 `createRentalCatalogPageContext` 共用宿主 `AdminRuntime` 和原图片鉴权传输。商业页面通过 `useCommercialContext` 提供当前 `RentalCommercialPageContext`，由 `createRentalCommercialPageContext` 共用同一运行时及原图片传输。治理页面通过 `useGovernanceContext` 提供 `createRentalGovernancePageContext` 创建的上下文，复用原会话刷新、经营空间与可选 AI/Copilot 插槽。页面声明、旧路由、菜单与标题使用同一来源；Core 作者复用公共外壳和操作驱动。[商品接入](admin/catalog/README.md#宿主接入) · [治理接入](admin/governance/README.md#接入) · [统一贡献接口](admin/index.tsx)

必要兼容验证覆盖能力执行、条件与历史依据、计价、器材及检查。源码测试优先 `.ts`，正式消费者使用本版构建产物。开发新 Core 从[五步接入手册](../core-contracts/README.md#五步快速接入)开始，商品、订单、养护及地点提供真实页面样例。[原能力执行器](../../tests/capability-hook-runtime.test.cjs) · [条件与历史依据](../../tests/category-capability-conditions.test.cjs) · [原计价测试](../../tests/rental-pricing-strategy.test.cjs) · [原器材测试](../../tests/capability-equipment.test.cjs) · [检查资源](../../tests/rental-inspection-resource.test.cjs) · [用量纠正](../../tests/rental-inspection-usage-correction.test.cjs)
