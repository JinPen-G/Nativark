# Rental API 宿主

本目录组合公共平台与 Rental 标准包，持有唯一数据库、认证、Guard 和业务实例。独立 Nest 根模块和启动入口已提供；启动前必须通过真实挂载处理器的接点核对。未接齐的处理器会在 Client 构造、连接和监听前拒绝，不能通过漏挂路由或关闭核对来启用。

## 入口与生命周期

| 入口 | 职责 |
| --- | --- |
| [main.ts](src/main.ts)、[bootstrap.ts](src/bootstrap.ts) | 显式执行才启动；只消费进程配置和指定的固定部署锁，不加载 `.env`。校验 MySQL、认证密钥、AI 选择、端口、代理及 CORS 配置。 |
| [app.module.ts](src/app.module.ts) | 挂载公共平台、标准 Core、原 Rental、支付、客户、空间和认证扩展模块；从实际 Controller 元数据核对完整请求政策，再构造同实例服务。 |
| [assembly.ts](src/assembly.ts) | 核定实际标准包与部署锁，组合原应用、公共分流、业务/公开准入和作业权威；不连接、迁移或派发外部请求。 |
| [ai-main.ts](src/ai-main.ts)、[ai-app.module.ts](src/ai-app.module.ts)、[ai-assembly.ts](src/ai-assembly.ts) | 独立的 AI 启用入口；核定锁中的完整选装数据包和原迁移账，组合原 Runtime 与同一 Rental 实例。 |
| [ai-composition.ts](src/ai-composition.ts)、[ai-inspection-transactions.ts](src/ai-inspection-transactions.ts) | 原 AI 工厂、知识权限、检查事务和生命周期参加者；复用当前 Auth、Guard、Core 和业务实例，构造阶段不执行外部调用。 |
| [ai-http-policy.ts](src/ai-http-policy.ts)、[ai-openapi.ts](src/ai-openapi.ts) | 对实际 AI 处理器逐条登记读取/审计/原事务边界；发布相同挂载范围和原成功状态，不以 provider 存在开放路由。 |
| [database.ts](src/database.ts) | 公共 40 模型与 Rental 121 模型组成宿主 Client，公共数据库令牌使用同一连接池；生成物仅归本宿主。 |
| [http-application-views.ts](src/http-application-views.ts) | 向 HTTP 注入原服务方法，隐藏 Nest 生命周期钩子，避免同一业务实例被多个模块重复启动。 |
| [lifecycle.ts](src/lifecycle.ts) | 唯一初始化、预热、配货/到期/文件/限流作业与数据库退出负责人；先停止新任务并排空，再断开连接，排空失败不提前断库。 |
| [deployment-package.ts](src/deployment-package.ts) | 从实际依赖读取固定标准包并核对摘要；源码目录、同名版本或准备结果均不能替代实际部署和物理数据证据。 |
| [http-policy.ts](src/http-policy.ts)、[openapi.ts](src/openapi.ts) | 真实挂载清单同时约束请求包装与旧路径文档许可；逐条核定原方法/处理器，使用 Rental 命名空间并保留原合同缺项。 |
| [package.ts](src/package.ts)、[prepare-deployment.ts](src/prepare-deployment.ts) | 从已构建字节和固定来源形成标准包及候选部署；同源 OpenAPI、完整摘要和原 SQL 必须一致，不安装或执行迁移。 |

启动配置须显式提供 `DATABASE_URL`、`AUTH_TOKEN_SECRET`、`RENTAL_AI_MODE` 和 `RENTAL_DEPLOYMENT_LOCK`。普通 `main.ts` 只接受 `disabled`；`ai-main.ts` 只接受 `enabled`，并要求所选 247 模型 Client 和固定完整 AI 数据包。部署锁使用绝对路径，文件上限 8 MiB。可配置 `API_PORT`、`TRUST_PROXY_HOPS`、`CORS_ALLOWED_ORIGINS`；公共数据、Rental 和基础设施数据模式均只接受 MySQL。启动入口本身不授予连接业务库或发布权限。

原组合宿主的 `PlatformController` 已有客户/空间兼容入口；该宿主不得再次挂载独立客户/空间模块。独立宿主则由本根模块统一挂载。原认证扩展同样不能在同一应用重复登记。

`createRentalHostPackage` 接收实际已构建字节、Core/底座固定来源和公开指南，生成同源 `dist/http-openapi.json` 并沿原标准包检查器核对。部署准备和启动再次核对整包摘要、清单与该文档，缺失或不同源时拒绝。旧路径例外仅来自宿主实际挂载处理器；通用打包、安装、迁移准备入口省略许可时仍要求标准 Core 路径，不从包或锁文件自取例外。候选 SQL 保留原字节和原顺序，`prepared` 不代表已经安装、迁移或运行。

`createRentalDeploymentFiles` 与命令共用同一准备入口。省略 AI 数据包得到 161 模型；提供已核固定完整 AI 数据发行与包，得到 247 模型及按原顺序追加的 58 份迁移。命令的新迁移目录必须直接位于本宿主根目录，例如 `apps/rental-api/prisma-candidate`，且尚未存在；其中 schema 的 `../generated/client` 与本宿主编译、运行使用同一个 Client。准备只写新目录，失败清理本次候选，不覆盖有效部署。

公共、Core 管理与 Rental 文档在唯一 OpenAPI 入口组合；576 个已描述操作对应 576 个原处理器。客户头像读/写及员工检查证据绑定已采用同源媒体合同；无 AI 宿主的检查绑定保留明确 503。原未挂的品类选项路径保留为未挂说明；原宽泛合同按 `RENTAL_HTTP_SCHEMA_GAPS` 明确标为 `incomplete`。这些缺口不伪造请求/响应字段，也不将路由挂载视为当前部署或业务授权通过。

## 请求、事务与响应

[请求作用域](src/http-request-scope.ts) 位于原身份/员工路由 middleware 之后、唯一 Guard 之前。Guard 形成原可信身份后绑定一次实际处理器；拦截器位于原响应信封内部。请求不能重复订阅、切换路径或借另一应用的作用域；断线只结束请求范围，不证明在途工作已经回滚。

[处理器政策](../../packages/rental-core/src/http-access-policy.ts) 固定绑定原 Controller/handler、方法与路径，客户端不能声明自己的准入种类。

- 身份维护仅限原运营/员工认证和本人订阅入口，保留原 audience、密码、限流、会话与空间切换规则，不要求活跃业务 Core，也不授予业务权。
- 公开客户入口沿原 Guard 公开清单及[公开准入](../../packages/rental-core/src/application-public-access.ts)，从原可信租户、渠道或刷新会话核定目标，不伪造成员身份。
- 原五个支付回调在原签名、商户和金额校验后进入[原结果范围](../../packages/rental-core/src/application-payment-callback-access.ts)，从持久支付/退款单定位租户、空间和订单，复核签名配置修订及实际部署。Core 停用只允许此处原结果入账，不开放新订单、支付或退款；租户/空间冻结仍拒绝。
- 普通业务沿[应用准入](../../packages/rental-core/src/application-access.ts)，原角色、tenant/workspace、地点、客户/企业对象权和字段投影继续生效。原业务事务的 [Tenant 父锁](../../packages/rental-core/src/mysql-business-fence.ts) 内复核当前 Core 授权、适用成员分配、绑定和实际部署。
- 原订单历史、履约收尾、结算和原支付结果由实际处理器绑定[善后声明](../../packages/rental-core/src/application-recovery-policy.ts)。登记为 `disabled` 的 Core 可使用这些入口；缺失授权仍拒绝。当前原 Auth/ClientAuth 主体先锁定，随后核 Core，再锁原 Order → Workspace → 原支付/退款单；原地点、本人范围、状态机和幂等规则继续裁定结果。草稿订单不能借善后声明进入履约。
- SaaS 管理沿原 `PlatformPrincipalAuthority`，先锁当前管理主体与有序目标租户，再进入业务父锁。全局品类定义治理不伪造租户授权，目标空间治理不伪造成员分配。
- 纯读返回前复核；审计读取把原 required audit 和权限复核放在同一短事务；维护型读取仅允许已登记的到期状态或原内容快照归档。审计已提交而最终拒绝返回时，原审计仍可能保留。
- 写请求保留原事务、幂等键和提交收据，不在提交后增加 Core 拒绝。外部调用只在原派发准入确认后发生，已派发的成功/未知结果沿原定位和 CAS 收口；超时、租约或 TTL 不授权自动重发。

原图片、附件、CSV 头和跳转使用[有限响应缓冲](../../packages/rental-core/src/http-native-response.ts)，持有原处理器生成的字节、字符串和响应头，复核后一次发送。读取失败、撤权或断线丢弃缓冲；不允许流或提前发送。文件仍沿原对象 ACL、内容指纹、配置和 required audit，不以缓冲替代文件授权。

型号图片增删在原配置事务中合并锁定的当前相册，确认提交后才更新缓存；解绑同时将原资产标记待删除，由原文件清理器单独处理。结果未知时保留原资产和上传会话供核对。奖励、余额及券列表直接读取当前持久事实；报价只将所选券放入独占计算副本，最终仍按原事务占券。规范化宿主的订单提交后不再重新预热全量缓存；原回执重读单独复核当前权限，不能借回放重新执行命令。

[作业权威](../../packages/rental-core/src/application-worker-authority.ts) 使用真实系统任务主体。已登记停用 Core 只允许原配货扫描、待支付到期、领取逾期、支付意图到期及耐久通知重试；原执行器和动作均固定，调价及新增业务继续拒绝。支付先 Tenant/Core，再原 Order，最后工作空间和操作复核；不把 Workspace 锁提前到 Order 之前。通知保留原耐久占用、派发、结果定位及 unknown 语义，停止作业不丢弃已派发原结果。

## 组合约束与验证边界

普通宿主使用无 AI 的 161 模型；客户检查出箱用 `null` 表达未选择，`undefined` 或残缺参加者会拒绝。AI 启用入口使用 247 模型，通过原实际工厂组合失败出箱、同事务事件、通知草稿、知识读取和原请求服务。公共数据库视图仍限定原 40 模型；两个 Client 的运行时模型图互不覆盖，正文加密沿各自实际模型关系处理嵌套数据。

启用宿主的 HTTP 清单见 [AI 处理器政策](src/ai-http-policy.ts)：运营/员工场景目录、原输入与任务创建、原任务恢复、报价澄清、开业诊断、订单解释、任务中心、场景计划与任务动作策略、租户模型配置及明确列出的手动检查操作。三个执行入口分别消费原专用请求工厂与持久 runner，不同时挂载旧的宽泛模型执行器。每个路由仍通过原 Auth/Guard，后续原场景、owner、对象、能力、任务策略和模型配置分别核定。场景目录只公布确实挂载的请求工厂；原服务端配置未启用、未提供的客户或供应商能力保持不可用。

原输入保存/换发、Task 变更、可见事件和模型配置在各自原事务中先锁当前 Auth/Tenant，再复核 Core 与原业务来源，保留原 CAS、幂等键及未知收据。模型目录探测沿原有有界运输，调用前后分别复核当前授权，运输不占用数据库事务。原知识结果/来源只将 `ai-sensitive-read` 必需审计接入当前请求的短事务；文件与知识 ACL、同意依据、原身份及返回前复核继续生效，撤权不返回正文、不重复对象 GET。

原模型启动和人工输入续程保留同一请求身份，准入事务在原 Scope/Task/Plan 锁前取得当前 Auth/Tenant/Core 与原任务来源围栏。原 Gateway 财务单账、任务累计资源、计划、租约、回答收据和恢复修订继续裁决执行；请求断开、TTL、取消或 unknown 不产生重发权。报价澄清不会批准订单，开业诊断不会发布经营设置，订单解释使用原只读业务投影。

场景计划的读取与变更，以及原任务动作策略的读取、配置和清除，分别挂载原两个 Controller 的五个操作。计划写入在原 Serializable 事务的 Scope/策略锁前取得 Auth/Tenant/Core；任务动作写入继续先核原订单与空间，再执行原策略 CAS 和审计，提交前同事务复验。策略配置不启动任务、不授予模型额度；提交失回复仍按原操作收据核对。定向行为入口为 [策略事务回归](../../packages/ai-native-server/test/scene-policy-transactions.test.cjs)。

`build`/`lint` 与 `build:ai`/`lint:ai` 使用 [所选 Client 编译入口](../../scripts/build-selected-prisma.cjs)。先由宿主按锁定 schema 生成专属 Client，再显式提供绝对 `RENTAL_PRISMA_CLIENT`；同一 npm 前置链共用选择，不回退默认生成物。纯 schema 首次准备见 [准备入口](../../scripts/prepare-selected-prisma-schema.cjs)，独立 Linux 部署上下文见 [打包入口](../../scripts/package-rental-host.cjs)；准备文件与上下文均不表示已执行迁移或镜像构建。

无 AI 宿主的原检查证据绑定处理器由固定政策在执行前返回 503；其他处理器仍按真实元数据核对，未知接点继续拒绝。该政策不能证明启用 AI 的检查绑定已接通。同源善后声明当前列出89个读取/收尾处理器，其中新增11个文件/承运证据、单订单员工收款、审批原结果及企业回款凭证GET。宿主须从同一实例供给 `originalHistory` 的文件、批准、续租/换货及回款材料定位者，保留当前原ACL、企业授权和订单范围复核；缺少参加者返回不可用。原材料定位与处理器登记不证明当前已装配、迁移或完成全部兼容验收。

定向验证入口为 [AI 装配与请求回归](test/ai-composition.test.cjs)、[原输入事务回归](../../packages/ai-native-server/test/original-scene-transactions.test.cjs)、[原场景执行回归](../../packages/ai-native-server/test/original-scene-execution.test.cjs)、[所选 Client 编译回归](../../tests/selected-prisma-build.test.cjs) 和 [Linux 部署上下文回归](../../tests/rental-host-package.test.cjs)。覆盖离线原服务/Controller/请求管线、同事务撤权与未知结果、所选 schema 严格类型、实际模块依赖注入和单次生命周期。真实数据库锁竞争、迁移、供应商调用、HTTP 监听及生产发布须另行验证；准备数据不能写作迁移成功，提交推送也不能写作已部署。
