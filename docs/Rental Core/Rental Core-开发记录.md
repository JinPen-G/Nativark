# Rental Core 开发记录

建立日期：2026-10-31。来源：原2026-10-18 CLOSE任务、平台正式需求及平台开发记录。本册补齐专项证据入口，不把历史状态重新判定为当前完成度。

[需求](<Rental Core-需求.md>) · [开发任务](<Rental Core-开发任务.md>) · [协作接续](<Rental Core-协作接续.md>)

<a id="pm-readiness-original-transaction-integration-20261112"></a>

## PM按QA方法闭包收回原九项同client读取（2026-11-12）

固定源码为 `483b887dc23dd252ecb423806ac5030204c39812`，原阶段记录为 `c24fd4e848565af87e751046911aedb25f5d7bf1`；main 起点 `b0b586ea07b69bb3b44b2d08ef03bfc84cdaa7fb`。依 QA 在 main `ca760b9e4` 核定的最小闭包，Core 配置仓储只取 readReadinessCoreFacts 接口/完整方法和正式 isRentalCategoryCode 导入，业务配置仓储只取 readReadinessBusinessFacts 接口/完整方法，会员只取 countPlans 原可选 tx 与计数两行，业务服务取原两读取方法并新增 readTenantReadinessSource。其他配置写入/初始化/版本与 045/6390 等未收父实现保持 main 原内容，不整取四文件。

PM 在内存以原方法节点替换、保留原注释边界和文件其余字节，再核四个 LF SHA-256 与 QA 候选完全一致：Core 配置 `2808cc12dc1befb95b932b31c1c5e7c5b28d486a34a65aa6503d047dcf7d568a`；业务配置 `3337bff90029d0d88a1c52210c4524ec60947c5fb80eb9cabea3632f51b9f4bf`；会员 `431ae6f9150003cec817dcaf190608bfe5304f848ed63e3061166f405a371018`；业务服务 `1e02a5074fbb77f6c10222777a1dae5e5e512244059dc3426e778c60f84636eb`。新增来源方法沿 QA 合成位置放类末尾，其他主线独有方法保留。

QA 主审与独立复核已运行固定实际服务/仓储、Auth/Guard及 main 的品类解析，331个固定模块，原 opening-read 17/17 和另十六组同tx/无tx/身份/地点/绑定变化通过。十类查询全部使用调用方 client，根连接和 states 缓存访问0；原会员租户总体与 unavailable/401/403 保持。行为 stdin SHA-256 为 `93ce4478cc4ff2595b6ef84f80f111396724248bc1ee8b18bc4da6a763fe8a53`，退出0。

QA 按同四文件方法闭包、原 shared110根及 MCP 唯一直接声明在内存检查四根/1187源，TypeScript5.9.3零诊断，stdin SHA-256 `42345ffc6de87af1d74fd5f694a2af0310243e83b4d4ccc0506e5e228291a7a2`，退出0、audit0。首轮内存装配缺 category 导入/MCP 声明的失败保留，补齐固定依赖后复验；本次相同候选不重复运行已通过的检查。物理写入仅本片源码和原四册，未创建验证目录、依赖或后台进程。

caller_transaction_reads 仅证明原查询复用 client，不表示九项总修订、数据库快照栅栏或 Outbox 已捕获。SQL/身份/版本行仍为 fixture，真实隔离/并发/锁及原四入口参加者待原门槛。Core 已获原 assignment.issueSource 的可选类型最小窗口，旧自由文本不推结构化短缺；AI-RD 固定 participant/ResourcePorts 已由 PM 单点交 Core，来源为 `b690e4f3` 的原 Outbox 两文件和 `7f4a2f1a` 接口记录。后继源码与直接消费者须另片核验，原 CAT-GOV/CLOSE 分数不变，六项 main WIP 保持。

<a id="readiness-original-transaction-20261112"></a>

## 原九项开业来源的同client读取（2026-11-12）

从已推送核GitHub的800a接续，先按PM要求固定reader时间P2为5b51，四份AIN-17原tx源码固定`483b887dc23dd252ecb423806ac5030204c39812`，由本记录同步交付状态。本片沿原Core窗口修改[Core配置仓储](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)、[业务配置仓储](../../apps/api/src/modules/rental-core/rental-business-config.repository.ts)和[原九项读取](../../apps/api/src/modules/rental-core/rental-business.service.ts)；PM另核五个登记树无重叠，仅授权[会员countPlans](../../apps/api/src/modules/platform/membership.service.ts)的原tx参数/计数两行。其他会员/企业政策、Auth、计数范围、算法及入口不改。

readTenantReadiness/readTenantReadinessSource与两仓储readReadinessCoreFacts/readReadinessBusinessFacts追加可选服务器原事务；绑定前后读、范围核对和全部原事实读取透传同client。会员仍统计原tenant总体的方案，含草稿/空方案，不改成workspace计数。未传参数保留原结果和independent_persisted_reads，传入仅标caller_transaction_reads；不声明总修订、快照栅栏或事件已捕获，不新增锁/事务、扫描、配置写入或缓存，原锁序/当前授权与一致性归调用方。

| 原项目 | 保留的实际来源 | 原tx透传 |
| --- | --- | --- |
| workspace_profile | 当前workspace品类标量，沿原九项判定；完整档案/设置修订仍由独立开业配置口提供 | Core配置仓储的workspace/范围读 |
| accounts_roles | 原启用成员与原角色覆盖口径的两次count | 业务仓储readRentalReadinessAccountFacts |
| fulfillment_network | 原受权地点与已启用履约方count | Core配置仓储 |
| business_rule | 原最近两条签发规则元数据，保留同时间冲突 | 业务配置仓储 |
| business_calendar | 原时区/时间边界下的发布年度count | 业务配置仓储 |
| item_groups | 当前空间启用型号count | Core配置仓储 |
| pricing_groups_rates | 当前定价组与原启用价格目标引用，不读金额JSON | Core/业务配置仓储均同client |
| price_version | 原查询时点适用的价格版本引用 | 业务配置仓储 |
| membership_base | 原租户总体方案count，含草稿/空方案 | MembershipService.countPlans |

API原noEmit退出0，原ai-native-ain08-opening-read.test.cjs 17项全部通过，没有改用例/断言。原fixture限定实际服务/仓储/会员/解析器调用退出0：根连接禁止下观察到workspace、sql、items、locations、pricingGroups、membership、rules、calendars、accounts、priceVersion十类查询，原九项及无写入/缓存保持；旧无tx/legacy不补绑定，原client透传到明确版本正文读取，后继绑定/范围变化及跨租户前置拒绝通过。首次变版断言失败是限定夹具只修改返回副本，保留失败后改为原rows共享修订持有者，不放松生产复核。

源码/规范化hash、命令/输出及原失败唯一见[同client证据](../../worktree/rental-core/output/category-governance/readiness-original-transaction-20261112.json)，audit0、退出暂存/缓存已删除；仅本片改动行规范LF，源码内容不变。查询、权限行和版本正文仍为fixture，真实SQL/隔离/并发/锁及原四入口Outbox参加者未验证/接入。固定后交AI作者消费原client，继续真实counter/资源短缺/参加者、CAT-GOV原08及两个不同动态组合；不重建045/864运行包、不读取环境或迁移，原完整结项0/14不变。

<a id="pm-allocation-pickup-main-integration-20261112"></a>

## PM按QA复验收回单资产与原领取依据（2026-11-12）

main 起点为 `ca760b9e47cd1bb5ba2927f71dd816c7b639b524`。来源按 `6d35ab7489daa6403da30956d776a5a6331bedb1`、`800a38925f7dd1a81d6e87af02301517eff5fd50`、`5b51b90dd01feae189d06d8c66d59875c8172401` 固定闭包，只接 CoreService 两段、FactRepository 四个差异块与最终 reader 全文；没有整取两份大文件或引入 045/6390 及 AIN-17 后继。两个合成文件的 LF SHA-256 分别精确匹配 QA 的 `c8f53b77c22c94f8b818d41834c2d8be99e67ba19d11eb50744a04f0d17bff34`、`876e215baa7a97b7e54099c6b071f86edb9d0169ffd9d244fe3a32715431ab92`，最终 reader 为 `8528d0d653e9792f0fd2f11011314dd8221c2ccfa0db3c948e47c88f1f5e4caf`。原行换行和主线独有实现保留。首次内存应用要求两边上下文均匹配而未找到一个未收祖先邻接行，在任何写入前中止；改用唯一原变更及已有一侧上下文，并以 QA 全文 hash 核定后才落盘。

QA 已独立核定原订单/分配/检查权限、当前单资产字段定义与缺值、required/unique/options/unit、原冻结模板/领取记录/有效修正链和范围反例。own 查询只对明确 assetId 做原工单存在性检查，地点/当前 ALS 复核保持，不枚举全租户资产。原仓储与实际 ALS 的五组组合 stdin SHA-256 `e64ca873d1e9d96fe716fef58e3e11b36008d872fa258bda4ad5310b92277c7b` 退出0；该组 reader 是记录谓词的 fixture，实际 reader 组单独留证。普通旧记录缺 pickupItems 显式绑定仍为 not_recorded，不能称所有历史领取均已补齐。

QA 的原三入口最小组合类型在 main `0530f7f65` 上使用 Shared110/desktop1/MCP59 原声明内存生成，三个 Core 入口1188源、TypeScript5.9.3零诊断，stdin SHA-256 `7c8f2be4b7f21bfbd274d5e49d8fdb2bfcb9028f106521d755c6acca4f659bcb`，退出0；0530至ca760没有改这两份Core前像。日期补片只复验该实际反例，不重复已绿全量类型/广域回归。

时间戳 P2 由 QA 原实际 reader/外层方法复现并由 Core 修复。QA 最终 stdin SHA-256 `33b3ce7b58aad30919820646941eab5294c705bdc399b837989c28f9c786be14` 退出0：资产/型号只更新 updatedAt 的两窗口由错误放行转409；订单/分配/资产/型号的变化、缺失和无效十二组、前后型号缺失两组均拒绝，同值新 Date 通过；false、0、缺值、冻结km及领取0保留。全局 requestFingerprint/历史幂等键未改，P2 按本固定修复关闭。准确原稿仍位于本树工作目录的三个来源 JSON，当前链接只调整到唯一原稿，不复制证据环境。

SQL/ORM/ALS 为明确 fixture，真实 MySQL 并发、Auth/HTTP/DI及媒体宿主未验，单目标不等于目录完整覆盖，原 CAT-GOV/CLOSE/AIN-19 门槛不变。五树本地/实际远端已核，无进行中的合并或暂存异常，main六项他人WIP保持；本片未创建临时目录/进程。AIN-17 四源码 `483b887d` 与记录 `c24fd4e8` 已另交 QA 核最小前置，AI-RD提供原participant/ResourcePorts固定合同后由Core继续，不从问题文本猜短缺或持锁重入扫描。

<a id="allocation-pickup-date-fences-20261112"></a>

## 单资产读取的显式时间复核（2026-11-12）

QA按6d35/800a实际reader与外层Core确认P2：原requestFingerprint将Date视为空对象，最后一次资产或关联型号仅updatedAt变化仍返回旧recorded投影；原反例stdin SHA为`5454b7c82fb287bd0edbcddee20c5c77781fd3a544331065c452d41986918906`，其退出0表示反例成立。本片仅修[原reader](../../apps/api/src/modules/rental-core/rental-order-allocation-pickup.read.ts)，从已推送的800a接续，不改全局指纹、历史幂等键、范围/资源算法或字段/冻结模板/修正链。

初次读取即捕获订单、分配、资产和关联型号的有效毫秒时间，最终ORM复读显式校验Date有效性及getTime相等；缺/坏日期和单独时间变化按原来源不可核对拒绝。其余字段继续原指纹，原已记录/未记录分区保持，日期对象引用相同或不同不代替时间比较。记录修订/时间、原SQL时间绑定的既有复核不变。

隔离原API类型866根/2011源诊断0，四AIN-17源码WIP以800a原blob在内存排除；限定实际reader与外层Core调用退出0：四类行的时间变化、缺日期、无效日期共12组拒绝，同值新Date实例通过，原字段规则、零读数和冻结km单位保持，并确认历史指纹Date语义未改变。SQL/Auth/行均为既有明确替身，不扩写测试或重跑广域/QA原16拒绝组；这些原组留原固定证据，本片只复验P2影响范围。

源码hash、短命令/结果与QA反例引用唯一见[时间复核证据](../../worktree/rental-core/output/category-governance/allocation-pickup-date-fences-20261112.json)，audit0、退出暂存已删除。固定最小后继交PM/QA复验，与6d35/800a同核，不将reader半片记作完整AIN-19或CAT/CLOSE结项。AIN-17四源码原tx透传已完成类型/原17项/限定同client验证，保留待单独固定；当前不重建045运行包、执行真实DB/宿主或改其他并行作者文件。

<a id="allocation-pickup-field-rules-20261112"></a>

## 单资产当前字段的原规则与缺值定义（2026-11-12）

从已推送核GitHub的reader `6d35ab7489daa6403da30956d776a5a6331bedb1`接续，按AI-RD/PM反馈仅修改[原投影](../../apps/api/src/modules/rental-core/rental-order-allocation-pickup.read.ts)：当前受权单资产的每个已定义字段保留原required/unique/options/unit，true、false和省略语义分别透传，选项复制不暴露可变定义。无值不再删除定义，valueState明确not_recorded，value/normalizedValue为null；合法零/false仍recorded。未新增VIN/车牌格式或唯一规则，不用当前定义补领取历史，也不把单分配项的完整投影当作资产目录全覆盖。

限定字段调用退出0，核原规则/选项、必填无值、省略与显式false、零/false、选项独立副本及领取缺失分区。API沿原配置作内存类型：只把两份未提交AIN-17仓储WIP恢复为6d35原文件，866根/2011源诊断0，证明本reader后继不依赖未提交透传片；没有复制工作目录或生成包。源码hash、实际短命令及结果唯一见[字段规则证据](../../worktree/rental-core/output/category-governance/allocation-pickup-field-rules-20261112.json)，audit0、退出暂存已删除。原6d35六SQL替身/范围/历史证据保留，当前仍未执行真实SQL/Auth/媒体/模型/宿主或独立Review。

后继交AI-RD/PM，由QA合核6d35与本片，再由AI作者接公共/StaffFactory/provider消费。AIN-17两Core仓储的原tx透传另为WIP；PM已核五树无重叠并授权membership.service.ts仅countPlans原tx参数/原租户总体计数两行，尚未接完整九项/参加者，不夹入本reader提交或抬CAT-GOV/CLOSE进度。

<a id="allocation-pickup-core-source-20261112"></a>

## 单资产资料与原领取依据的只读接点（2026-11-12）

按已协调的AIN-19必要Core窗口，从已核GitHub的`1bffc40821c253738e719691c3ae1d73cc1b907f`接续。最小闭包为[Core入口](../../apps/api/src/modules/rental-core/rental-core.service.ts)、[事实仓储](../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts)及[有界读取与投影](../../apps/api/src/modules/rental-core/rental-order-allocation-pickup.read.ts)。`readOrderAllocationPickupBasis(tenantId, orderId, allocationId)`沿当前原operator/staff Guard/ALS、tenant/workspace、地点及dataScope读取一个明确分配项；精确资产ID与原可见条件同时保留，own范围只查询该资产的原工单存在性，不枚举全空间资产。

输出分为原allocation引用/更新时间、当前受权单资产资料、原领取依据。当前资产只投影当前定义的字段、原序列号及Core规范化值，带当前categoryVersionId/adoptionRevision/definitionVersion；退役属性不泄露。原领取从持久record、显式pickupItems关联及原订单/报价或对应已应用换货的冻结模板读取，返回原recordId/revision/time、template id/code/version、resourceBinding及冻结单位，不使用当前资产属性或当前模板补历史。projectionHash只是本次持久投影的SHA-256，不编造历史版本/hash，也不授予执行权。

无资产、无原分配领取绑定、缺冻结计量字段/单位或原读数均明确not_recorded；多资源整单读数不冒充单资产基线。原结果与有效修正读数分开，修正链核原from/to及记录引用，不输出自由原因、操作人或文件下载授权。复用原optionalUsageReading/usageDelta，合法零保留，非法负数/倒退或矛盾原差值拒绝；没有基线不补零、不解释为可换表结算。单项JSON在传输前限64KiB，计量字段/读数/修正各100项、资源与冻结模板各200项，重复记录/绑定、坏源或超限拒绝。超限用不匹配的JSON容器表示，避免与合法动态字段名冲突；前后核订单、分配、资产/型号、record、当前定义与ALS，仍是有界观察，不冒称同事务快照。

最终API原`tsc -p apps/api/tsconfig.json --noEmit --incremental false --pretty false`退出0；原`rental-inspection-resource.test.cjs`、`rental-inspection-usage-correction.test.cjs`、`rental-usage-reading-validation.test.cjs`均退出0。复用原inspection-differential fixture的限定实际Core/仓储调用退出0：精确资产/own/地点条件、六条有界SQL替身、零值及原单位、合法同名字段、原/有效修正链、缺字段/单位/绑定、多资源歧义、坏读数、后继定义及当前身份变化拒绝。SQL/权限数据为明确替身，未执行真实MySQL；首次合成定义误用目录对象形状的失败保留，仅改限定调用按实际数组取值，没有改生产实现迎合夹具或新增/扩写测试文件。

源码hash、实际命令/输出、首次失败及Shared/自持Client保护hash唯一见[阶段证据](../../worktree/rental-core/output/category-governance/allocation-pickup-core-source-20261112.json)。audit0，退出暂存和编译缓存已核实删除；此前组合命令被自动审批以blocked by policy拒绝且未执行，随后改为明确路径、逐文件/空目录非递归清理完成。本片未重建API，864文件研发包仍045阶段；Shared/StaffFactory/provider、AI私有消费、HTTP/DI及宿主由原作者接固定成果。没有真实DB/Auth/并发、媒体/模型、浏览器/微信或独立Review证据，不提升原CAT-GOV-14项/CAT-A22项或CLOSE门槛。

PM已确认b869类型/892两源码随企业来源进入main `3647fd0ed5e978921a483c9ba4cc26077d8a25aa`，随后企业签源guard单文件进入`34f8ec9efa99d515bfb0fea56f2ac623d9d63cf6`，均已普通推送回读；本树按后一个固定提交核原Core三blob一致，不追main活动HEAD。PM报告20路径Shared/MCP/API/admin/portal诊断0、后继guard类型0；这不是完整执行/HTTP/真库验收，也没有整收6390/045及其他祖先。当前继续AIN-17业务/会员九项原client、真实counter/资源短缺参加者与CAT-GOV主线；原08采用、两动态编码不同组合及0/14完整结项保持。

<a id="pm-merchant-delegation-source-runtime-integration-20261112"></a>

## PM按QA最小闭包收回商户委托Core基础（2026-11-12）

只接固定 `b869f72b1117b4511a330af4937f11ecf6710756` 的 `approved-order-transaction.ports.ts` 及 `89261ed60993e41c0595519c6bb0dd6e46fb2835` 的 authority/原确认服务；main 起点 `fda3d1ee103fe2e5aaf003c19360bd4683d63517`，同时收回企业已审来源闭包，见[企业阶段](../企业客户后台/企业客户后台-开发记录.md#ecp-main-delegation-source-integration-20261112)。Core 三文件 blob 分别为 `4528bc483bdd53f4bcd020692b8d42a63fbfae58`、`b8c805b30eec3150ce9983df4eb4db1905fae445`、`b4464f24ab68cb22442e92f207394850eedcb9fb`。PM 逐一核与 QA 固定源码一致，没有整取 Core 分支活动 HEAD 或 6390/045 配置事务祖先。

QA 独立确认原确认服务负责生成并登记真实 binding，不能只取校验文件；原 proof/binding 双 WeakMap、当前 operator/tenant/workspace、D=K、原 request/quote/使用人及参加者方法约束保留。正常/批准旧调用参数可选，原五阶段、Core 事务/资格/库存/服务/资金语义保持。到期或 consumed 恢复只读原来源和原收据，不新 prepare、不换 K/ALS。后继企业政策必须用原 Core proof/binding 对象接 helper，再核持久源；本片不将 fixture policy 的成功当真实企业 guard 已装配。

QA 对固定 main `179fb4941` 加上述三文件的 Shared/MCP 内存声明和原 API noEmit/incremental=false 独立验证：TypeScript 5.9.3，901 根/2051 编译源，零诊断，Node 最终退出 0，stdin SHA-256 `7fc9f0ab23ad3f27903c40fbc408a4e2fd6e71bd77f7be064ce6f96e42885058`。首次类型驱动转义解析失败保留，修正字面替换后才进入同组合编译。作者两模式/五阶段/回滚/失应答/双 TTL 及十二类坏源证据唯一保留在本树工作目录的[来源证据](../../worktree/rental-core/output/category-governance/merchant-delegation-core-runtime-20261112.json)，QA 读取时 SHA-256 为 `14c419732e3bce1352be08c681aa411d3233fc2482871078bf9977e34dfd2d2a`，未复制环境。后续 QA 对 main `fda3d1ee1` 实际二十路径候选已独立完成 Shared/MCP/API/admin/portal 原配置，全部零诊断、退出 0；准确清单、编译器、stdin 哈希与未验边界见[企业同组合](../企业客户后台/企业客户后台-开发记录.md#ecp-main-delegation-source-integration-20261112)，不是将此前三文件证据扩大。

保留来源完整阶段和原失败记录，仅新增段统一 LF，并将必要证据链接指向唯一原稿，未改旧历史正文；QA 所报新文档行尾 P3 在主线新增段处理。源码集成不改变 CAT-GOV/CLOSE 的原任务及 0/14，真实 SourceOwner、企业 guard、应用/HTTP/MySQL/宿主/资金仍按后继证据。Core 继续 AIN-17/CAT-GOV，新增 AIN-19 的单资产/原领取依据 reader 已由 PM 协调给原 Core RD，不因 main 整合停止。

<a id="merchant-delegation-core-sealed-runtime-20261112"></a>

## 商户委托的Core封存来源与原binding闭包（2026-11-12）

从已核GitHub的类型片`b869f72b1117b4511a330af4937f11ecf6710756`接续，最小安全闭包为[Core authority/端口](../../apps/api/src/modules/rental-core/rental-merchant-delegated-order.authority.ts)与[原确认服务](../../apps/api/src/modules/rental-core/rental-order-confirmation.service.ts)两文件。authority私有mint只能沿宿主提供的既有企业私有源读取/严格prepare到达；原确认入口才把证明注入并登记真实binding。只交类型/校验文件不能固定该原入口来源，拆出任意callback造binding会削弱封存约束，因此两文件同交，企业policy和公共宿主仍归原作者。

`assertCoreMerchantDelegationProof(proof, binding)`核原proof与原binding的WeakMap登记、当前operator ALS/身份指纹、tenant/workspace、D=K、原request/quote/个人使用人及同一参加者方法。`bindCoreMerchantDelegationProof(authority, binding)`只接受Core已封存authority，固定原binding/request；普通字段相等、JSON/structuredClone复制、保留真实proof但重建binding、更换participant或方法均不能授予委托权。mint不导出；输入/秘密不从HTTP或模型取得，不另建公共源DTO、不保存Authorization。类型标记只是编译约束，企业policy须使用原Core运行时对象校验。

宿主端口`RentalMerchantDelegatedOrderPort.execute(actorAuth, reference, userName, context)`及`readOriginal(actorAuth, reference)`消费企业固定`86dc23917336b35b1842c2873ed6ac0c7790549d`的私有读与原participant。read提供原签发1/当前state与revision，prepare仍去掉state/issuedRevision：Core从私有read固定签发，再比较prepare原修订/不可变请求及hash关联。执行调用原`createApprovedOrder`受控分支，保留当前operator和不可变个人使用人、原企业付款/quote/身份、资格、库存、服务容量、资金及原Core事务；原结果只读同D/K及source/participant recover/replay，consumed/TTL后不新prepare、不换K/ALS。未观察到原结果保持unknown或待核对，不转成重新提交权限。

原批准Core fixture的限定实际服务调用退出0：per_order/without_per_order正常创建、Tenant X先于库存、五阶段同事务消费；proof/authority复制、匹配普通binding、替换callback及裸callback拒绝；订单/批准失败回滚；提交失应答保留一次订单，Core收据过期和原source自然TTL后恢复不重复准备/创建；过期issued只读unknown且不写。另一限定调用拒绝12类版本/tenant/workspace/D/K/source/basis/request hash/个人/企业/quote/签发矛盾，以及错operator/把当前2当签发1。SourceOwner、policy、Auth/SQL/锁、库存和资金均是声明fixture，未记真实企业guard或外部服务通过。

当前API原noEmit退出0、audit0，源码hash和实际命令唯一见[闭包证据](../../worktree/rental-core/output/category-governance/merchant-delegation-core-runtime-20261112.json)。原夹具/断言不改；首次未注册TS、重复注册后编译JS被再当TS、夹具展开导致proof观察值不更新均保留为装配失败，限定修正后只复验相关调用。各次退出暂存已删除，当前864文件研发包仍是045配置事务阶段，本片未更新包或改AppModule/shared-index/OpenAPI/企业policy/商户Controller/admin。PM送QA；企业唯一作者接guard后再核相同正反例、真实权限/事务/宿主，完整execute/result交付仍不由本片源fixture替代，CAT-GOV/CLOSE原门槛和0/14不变。

<a id="merchant-delegation-core-proof-type-20261112"></a>

## 商户单次委托的Core内部证明类型（2026-11-12）

按PM确认的唯一作者窗口，从已核GitHub的`045ff2114b1a25943419b88dd153e7d94685fd18`接续，独立类型片`b869f72b1117b4511a330af4937f11ecf6710756`已普通推送核远端并交企业作者；[原五阶段参加者类型](../../apps/api/src/modules/rental-core/approved-order-transaction.ports.ts)只加`ApprovedOrderBinding.merchantDelegation`可选字段，不改变authorize/recover/prepare/commit/replay签名或普通批准语义。`ApprovedOrderMerchantDelegation`含version/purpose、D、sourceHash/basisHash/requestHash、quoteId、原签发expectedRevision、personalCustomerId/corporateCustomerId及原operator actorUserId；tenant/workspace和K仍在原binding。当前源版本只接受原签发1，consumed/revoked当前2不替代它。

证明带模块私有unique-symbol类型标记，仅Core由真实私有读结果/原请求校验后封存注入。类型转换、HTTP/Shared DTO或普通callback自填字段不获得运行时来源；企业政策必须使用Core运行时`assertCoreMerchantDelegationProof(proof, binding)`校验原proof对象，再逐字段核持久源和当前operator。原binding复制给五阶段参加者只携带投影，不以其JSON复制作为授权。这一运行时接点与确认服务仍是本树WIP，待对应固定实现，不声明类型本身已完成执行链。

现有API原noEmit退出0、audit0，含当前Core实现WIP，类型hash/命令与退出清理唯一见[类型证据](../../worktree/rental-core/output/category-governance/merchant-delegation-core-types-20261112.json)。本阶段仅提交类型和既有记录/接续；确认服务与sealed端口未混入类型片，也未生成新包或改企业政策/共同入口。企业私有读取已固定`86dc23917336b35b1842c2873ed6ac0c7790549d`：read返回原request/hash、issuedRevision/state/当前revision，prepare复用read后去掉state/issuedRevision并保留原prepared形状。Core沿该固定来源完成执行/原结果，恢复不走新prepare、不改ALS userId；完整正常、失应答、TTL及当前权限/原Core事务验证仍未完成。

<a id="pm-exchange-guarantee-integration-20261112"></a>
## PM换货保证金准入固定整合（2026-11-12）

main起点与实际GitHub均为`7772d302003697dfe2a0de2da8f4ee104933baaa`，来源`5d6c6dffdfaf11b0bc6d759ab87ae983d31edd0c`已核包含于实际Core远端`045ff2114b1a25943419b88dd153e7d94685fd18`。仅收[Core服务](../../apps/api/src/modules/rental-core/rental-core.service.ts)的七行增量，不取尚未核收的配置、counter或来源父文件。普通换货只增加押金或预授权时也进入原企业新支出门闸；租金补差仍按原值传入，显式0不省略，保证金不并入租金授信。已核的本次换货批准仍走原事务内封存authority，旧建单批准不能替代新支出批准。

PM在main以`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e`复用[作者唯一证据](../../worktree/rental-core/output/category-governance/exchange-guarantee-gate-20261112.json)的`completeCategoryPreviewProbe.inlineCommand`，仅把其ts-node注册替换为内存main源码装载。两种真实Core预览均为租金增量0、相应保证金增量100；逐单政策拒绝旧批准、免逐单仍以0复验、当前关系停用拒绝、伪造authority拒绝及原订单不变均通过，退出0。复用命令SHA-256为`e861dfd101f0c5b5df1969e3e1702f60c443d888ae8d4616bba3fabc70af70f1`。首次装载误读既有src同名JS而退出1，改为优先实际TS后通过；未改、删除或覆盖这些既有产物及原测试断言。

TypeScript5.9.3按原shared108根内存检查/emit及API900根noEmit检查，诊断0、退出0，未写物理dist、Client或缓存。限定预览/准入检查在原后续订单修订门闸停止，SQL、当前政策来源与存储为fixture，不代表完整换货、真实事务/资金或全专项验收。所有本片进程退出，临时目录未创建；main六项他人WIP逐文件哈希保持，旧已集中残留仍未删除。原CLOSE/CAT-GOV/ECP门槛不变。

后续企业三端服务与点击冻结按空快照前置核收。完整委托新增的最小政策窗口由企业RD独占`EnterprisePolicyService.assertOrderCreation`签源分支；Core独占服务器封存authority和`ApprovedOrderBinding`证明类型。证明必须匹配原来源/请求/报价/依据/签发修订及当前operator，普通五阶段callback不能自行取得委托权；历史原键读取区分原签发修订与consumed当前修订。两作者继续独占研发，固定合同及组合证据完成后再收main。

<a id="pm-extension-empty-snapshot-integration-20261112"></a>
## PM新续租服务空快照固定整合（2026-11-12）

来源为实际GitHub任务分支已包含的`3ed71c1ade0fc3447d26608ea3b108dcc024e863`，main起点`b527ef20a0b5c0669f6a022a336b7e66ee0b4d2a`。只按来源两源码增量整合，保留main已核的经营/币种/资格修复和六项他人WIP，不取Core活动配置事务、编码、counter或完整来源父文件。直接消费者仍沿原Core续租报价/持久化及企业批准。两种普通新续租解析原服务目录，只有解析器确认无新增才保存`[]`；旧缺失/核减模式继续缺失，不以0金额补历史。

PM复用来源唯一JSON的fixtureMatrix原命令，以固定main内存装载复验两种模式的空明细与持久化、必选遗漏拒绝、已选零价服务保留、原报价不变及旧单缺明细，通过、退出0。批准保存原命令首次遇到main已核的原币种门闸（来源fixture订单缺currency），保留该拒绝；仅在原正常订单fixture加入与priced一致的真实币种后，实际批准保存空明细/原预览指纹通过，退出0，不改产品门闸或原用例。最初装载被用例内部ts-node注册替换而产生诊断，复验只保留既有固定snapshot装载，不改原测试/runner/断言。最终脚本SHA-256为`bb337b792d5478ccd93a2cf6f902cd5c5653ca8de73e5dc5248174e45d2e0a43`及`f48f71d03689de28a17a9aa12b7486f59d881db4ab656bfc06d0e6436f27c097`。

TypeScript5.9.3原shared108根完整内存检查/emit216产物和API900根noEmit诊断0，退出0；未改物理dist/Client或访问真实HTTP/DB。SQL/授权/事务/批准仍为fixture，不证明真实锁/并发、库存/资金或完整ECP；来源原续租脚本同步getter及期待undefined的已知失败仍保留。源码候选blob为business `5cd2ed9f05986fbb1221656ed2618e55d5b15879`、facts `311214f417ae35d8b382b1d7618ae64bdcda6402`。唯一原JSON沿下方来源链接保留，不复制output；本轮未创建任务临时目录，验证进程已退出。原CLOSE/CAT-GOV/ECP完整门槛不变，下一片核保证金门闸及企业服务/点击消费者。

<a id="extension-service-empty-snapshots-20261112"></a>

## 新续租的服务解析与明确空快照（2026-11-12）

按PM明确窗口，从已核GitHub的`b659aa857088e01cab277d4270390e9845eeaead`接续，只改[报价服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)与[事实仓储](../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts)。新增时段独立续租及普通原价全租期补差均解析本空间服务目录，即使请求未选服务也检查必选规则；明确无新增服务返回`[]`，不调用空服务容量检查。已有核减/重价模式保持原语义，不隐式追加服务。

新续租持久化保留解析所得的空数组；旧`undefined/null`仍写`Prisma.DbNull`，不由金额补快照，不改原订单服务发生项。直接消费者为CoreController续租预览/申请、ClientApiService本人及企业续租报价/核对和Core批准生效；沿原报价、服务容量及幂等链，未扩Shared、DTO、OpenAPI或企业政策签名。

原续租服务fixture的限定装配覆盖两种模式：无新增服务的报价及持久化、遗漏必选拒绝、已选择零价必选服务保留、已有核减模式和旧缺失保留、原报价不变，退出0；实际批准申请保存空快照和原预览指纹的限定调用退出0。仅补原异步getter与同空间库存读取夹具，SQL/授权/事务/批准仍为替身。API原tsconfig完整emit退出0，864份自持JS逐文件核对，更新本片2份，四项Shared/Client保护未变；当前源码hash与构建清单一致。命令、首次失败、源码及产物hash唯一见[阶段证据](../../worktree/rental-core/output/category-governance/extension-service-snapshots-20261112.json)。

原`tests/rental-extension-services.test.cjs`直接运行仍在旧同步getter导致的`defaultUnit`处退出1；限定调用保留`:160`期待`undefined`、实际`[]`的原断言失败，不修改测试或回退已批准的空快照语义。固化证据后867份退出文件/缓存及42个暂存目录已删除。原CAT-GOV-04/13动作矩阵和CLOSE/企业完整验收仍需真实事务、权限及消费者证据；本片不抬完整结项比例，R08后续Core源码尚未纳入本次包验证。

<a id="pm-preparation-receipt-integration-20261112"></a>
## PM固定原准备批次收据整合（2026-11-12）

固定来源为已核实际GitHub任务分支的`b659aa857088e01cab277d4270390e9845eeaead`，main起点`212df5bd6b463f62f98d040c18afea9088543f87`。仅收两份批次源码及对应四份原记录/接续增量，不取Core活动HEAD或未完服务/保证金/配置事件WIP。准备服务的来源父文件仅比main多前一a0编码片的解码替换，该差异与本批次修复无调用依赖；三方应用只加入b659回执增量，未取a0/619祖先或整份父文件。批次纯函数blob与来源一致，准备服务保留main编码实现；四份文档冲突保留main完整历史，仅加入固定批次阶段，原记录的源码/环境证据不改成当前main全量验收。

实际入口为原准备Controller/权限→CategoryAdoptionPreparationService.readBatch/saveBatch→category-preparation-batches.readCategoryPreparationBatchResult。结果必须匹配原准备集合、目标、批次、输入指纹及原输入修订，合法零计数保留，未知字段/坏JSON/不合法修订不能作为saved返回。原记录不重写，缺行仍unknown且不授重发权。写入接口的原键重试先复验当前采用资格/来源；独立历史GET仍按当前人员/空间读原收据，不重新要求目标资格。

PM在固定main组合以已有离线preload、不可达数据库、纯内存TypeScript装载复用原`category-preparation-batches.test.cjs`和`category-preparation-batch-service.test.cjs`，两份脚本均退出0、原文件/断言未改：部分累积、撤回、原事实/唯一性、原键回放、资格/修订冲突、回滚、显式重置及legacy覆盖拒绝通过。复用作者阶段清单的最终boundary原命令，九类坏回执、缺指纹、原输入修订矛盾和改输入拒绝，当前资格收窄时写入重试拒绝、历史GET仍可读，缺收据unknown及原记录不变均通过，退出0。三份内存脚本SHA-256依次为`2a8e43b09ff7054d12e3e17b36e707de422bc05e0a2a37495490a135e00494a0`、`01e09cfd4a6bb61084fdc74e7839726e8a05a943eda3788ab982cecb7210b228`、`ab1e417cc905c0dbf3c98654ee14de855db714eeb987a6451702c1c19937352f`。SQL、Auth/事务存储仍为原fixture，测试不证明真实MySQL锁、并发、最终采用或浏览器。

shared原TypeScript5.9.3配置完整内存检查/emit108根、217产物诊断0；API消费内存新声明按原900根noEmit诊断0、退出0，未覆盖物理dist/Client。四份文档新阶段链接/显式锚点、原内容保留及格式按固定main核验；源码与两个原测试哈希保持。作者唯一原始JSON证据仍在其树，链接明确指向这份单一原稿，不复制整个output/环境；必要main独立结论和命令哈希保存在本段。所有本轮自有验证进程退出、任务临时目录未创建，六项他人main WIP逐哈希保持；旧集中待清理残留仍未删除，不绕过此前自动审批拒绝。

原14项完整结项仍0/14，实现百分比待核实。本次巡检四树本地提交均与实际GitHub一致，AI仍推进14四分区提案/18受权待办，企业推进原本人委托源及参与者，Core继续新服务空快照/纯保证金门闸后转AIN-17四入口真实counter/同事务参加者。未完成成果保留任务分支，a0/619其余固定前置按原记录另片核收；不以本片收据修复代替这些核心功能或经营放行。

<a id="preparation-receipt-validation-core-20261112"></a>

## 原批次回执校验收口与Core提交链接续（2026-11-12）

两份Core源码完成原批次JSON/标识绑定校验，原写入重试的资格/来源门槛保持，独立历史GET继续原授权；原消息兼容及错误顺序尝试均按原测试纠正，详见[唯一品类记录](品类治理/品类治理-开发记录.md#preparation-receipt-validation-20261112)。API864文件完整编译/逐文件核对，2份更新，原两批次脚本与限定坏回执检查通过；各次暂存已删除，CLOSE/CAT完整门槛不变。

PM最新指定下一优先：原scanOrder→recordIssue→saveOrderAggregate同事务履约参加者；upsertProfile真实配置行counter/默认与非默认边界及开业参加者；persistBusinessConfig原tx及settingsRevision/开业分区参加者；saveCoreState原tx/scoped原子counter与必要回填兼容。先固定最小内部字段合同和Core可证明的resource_shortage判定，供PM与AI-RD读取；缺已发布临近政策不捕获，不解析issue文本、不把九项独立读取当单事务总版本。公共符号/装配新增须另报具体窗口，原真实环境许可未增加。

<a id="pm-core-intake-and-dependencies-20261112"></a>
## PM固定阶段依赖核查与跨专项来源协调（2026-11-12）

本次核定四个实际Git工作树，main已将企业原补款固定`846d16e89`收回为`9b616d8e5d5932bffdc26eabce8ab3a47b1627da`，将AI原展示固定`7332875c9`收回为`0e9f9394225feea9190eb437afccee1b18764572`，两次普通推送后均回读GitHub包含。对应独立模拟/类型及未验环境分别见[企业原补款](../企业客户后台/企业客户后台-开发记录.md#ecp-main-consumed-extension-integration-20261112)与[AI展示](<../AI Native/AI Native-开发记录.md#ain12-main-display-integration-20261112>)，不计作Core原任务完成度。

Core固定`a0a0451754d77b7454de4dad9f5044a4e70c3949`的15源码/4文档已核在实际任务远端。main试应用这一增量时，五个源码冲突暴露未收前置：草稿仍用原lockActiveCategoryBinding，来源已改lockCategoryContext；治理尚缺versionValidation及Auth/Platform装配；默认配置仓储缺readDefaultWorkspaceInitialization；原事实仓储缺readQuotedInspectionTemplates；续租reader缺原订单/报价/配置同源核查。四份文档也冲突。冲突不能只取来源正文，否则把父阶段和未收口counter检查点一并带入。

PM已核归属后仅撤回本次19个候选路径到上述固定main，未重置分支、清理工作树或覆盖其他成果。main六项他人WIP逐哈希保持、暂存区与冲突均清空。a0编码片和后继`619f50c5a04f2af805f84f3977e78dc4683cfb81`必选/历史Hook片继续保留在任务分支，尚未合main。要求Core作者在既有记录给出b6aa09ad3治理、16d080e48续租、9331582b7历史检查、00f19015a草稿、f0e69b960默认初始化等最小固定前置及原证据，区分5e8d52325/fe65ac652未收口的配置/资源检查点；按固定依赖顺序串行核收，作者继续自己的树。

已明确下一核心优先：当前采用回执片收口后，Core提供AIN-17此前已批准的四入口真实configurationRevision/settingsRevision、原业务同事务可选参加者及必要backfill兼容。allocation原recordIssue不能重入scan/另开事务，只有Core真实可证明的资源不足及已发布临近政策才捕获；profile默认/非默认、state scoped版本和九项独立读取分别有界，缺行不造版1、updatedAt/seed不充总版本。AI-RD继续私有store/桥接和18授权消费者，由其协调两助手，PM只向RD协调。

企业三端新增服务又暴露准确Core来源缺口：两个新续租报价无选中服务时目前省略serviceSnapshots，原测试第160行也期待undefined；新企业投影只读持久化快照，不能由零金额/当前catalog补齐。因此已交Core最小新报价窗口，核真实适用及强制服务规则后才记录明确空数组；有服务继续原费用/容量/版本/条款/计划。line_cancellation等复用不隐式新增服务，旧订单/报价/consumed批准/原键及指纹不回填，旧缺数组仍unavailable。原第252行旧订单不凭空补数组门槛保留；原测试/runner/断言不改，不排除类型或skip伪造绿色。

企业作者继续已批服务选择/正常有服务/拒绝恢复片，原缺空快照留记录，不等待Core整项。另核准其网站换货进度、小程序换货与订单三处仅补consumed状态显示，approved才可确认的原门闸及Core执行保持。新Shared/schema/公开入口或其他范围须报精确窗口。此次PM未读环境、启停服务、安装依赖、访问真实业务或生成产物，未创建临时文件/新后台进程；旧集中待清理残留未删除。原CLOSE/CAT完整门槛与百分比待核实保持。

<a id="workspace-resolver-main-integration-20261112"></a>
## PM固定当前品类读取修订校验整合（2026-11-12）

巡检在四个实际登记工作树核对分支、HEAD、索引、merge/cherry-pick、上游及GitHub。main起点为已推送的`3a06c8861a25398072c98f8da4e3733c25b5b6a3`，Core可独立交付来源为已核远端的`cb96a636b61497243d75032e98d0e301ff3d31a0`。只收本提交`rental-category-resolver.service.ts`的`forWorkspace`差异，完整目标文件与固定来源Git blob一致；不收Core配置counter、唯一声明/草稿锁辅助函数或其他父提交。来源原阶段及未验事项可在[固定Core记录](https://github.com/JinPen-G/rental-OS/blob/cb96a636b61497243d75032e98d0e301ff3d31a0/docs/Rental%20Core/Rental%20Core-%E5%BC%80%E5%8F%91%E8%AE%B0%E5%BD%95.md#workspace-resolver-binding-20261112)核对。

读取正文前拒绝缺失/非法版本ID、非字符串编码及非负安全整数以外的采用修订，合法初始0保留。版本ID/修订在异步读取同一不可变正文前捕获，避免观察对象后续变化造成版本正文与返回绑定混杂；历史`forVersion`不读取当前空间最新版。与前一写锁修复共同维护读写合法性，当前授权与业务提交点复验不变。

PM独立将原`category-version-resolver.test.cjs`通过内存TS映射指向main实际源码，完整原解析/空间/历史版本/客户公开投影断言退出0，原文件和断言未改。五组限定调用退出0，覆盖当前/事务内/历史读取区分、初始0、损坏修订在版本IO前拒绝、缺绑定身份拒绝及异步正文读取不混入后继绑定；脚本SHA-256为`85ccaeca39f690aa51dd626fe3bc08ec7515a4d19c824e003a53e97baadf5ee8`。原API tsconfig、TypeScript5.9.3、895根`--noEmit --incremental false`诊断0。最终源码SHA-256为`cd7d9fe043a43046c950b48f9e14a4e4b82e4cbd8a07d9de62c3ac4ffe5e9a32`，与作者阶段证据相同。纯排版在核对时恢复固定来源，不改变测试逻辑。

SQL/事务/授权来源为明确fixture，不将原用例或类型检查作为真实DB/并发/完整CAT-GOV验收。六份变更记录/接续无新增链接错误，Core记录及三份接续无链接错误，原品类记录两项与后台记录267项历史断链保持。各Node使用原offline preload、固定不可达数据库和关闭缓存，audit0，验证目录未创建，子进程全部退出。main六项他人WIP逐文件SHA-256保持，另外三树继续独占研发。AI Native的12/17/18生产者、公开消费者和原人类grant仍在WIP；企业本单材料选择继续推进；没有据此新增任务或提高完成度。Core继续原同源定义、全部写入口/08存量采用及已协调的财务原核定读源。

<a id="active-binding-main-integration-20261112"></a>
## PM固定采用修订校验整合（2026-11-12）

来源源码`9380d1bab95e2d78ecb64d0390cfcd03af2ca0f4`及记录固定`709c69b58f288deed3d31c8387c888f3e6ef2153`已核在任务远端，main起点为已推送的`3cf502b7cc7e6443d6ebeaee2442cc2a6e24816e`。本片只取`category-active-write.ts`的12行差异，`lockActiveCategoryBinding`完整函数与固定来源一致；main未有的原UniqueClaims/Context辅助函数和配置修订/Outbox祖先不随此片收回。非法期望修订在取锁前拒绝，存储缺值/负值/字符串/非整数/重复空间行在读版本或返回可信binding前拒绝，合法初始0保留；原锁序、权限和后续字段/媒体规则不改。

PM独立以main真实源码复核原`config-workspace-scope.test.cjs`三项和四组限定行为，均退出0；四组覆盖正常0/后继、损坏存储修订、非法期望值在锁前拒绝及缺失/重复/坏状态行不读版本。四组脚本SHA-256为`89f7d7f4d46dde4fb5367851c2c5ede042e9517d9b1b17d4626c6acadc92a97e`，main目标源码SHA-256为`a54d36bb6dedc8cdf63d247dc8db2e547c4df79f2d0ee33ad988676ec8da002a`。原API tsconfig、TypeScript5.9.3、895根`--noEmit --incremental false`诊断0。旧`category-active-write.test.cjs`仍在第20行的锁次数断言失败：既有Tenant父锁使实际为两次，期望为一次；main原基线和本片结果完全相同，未改原断言/测试或删除父锁来补绿，其后断言不称本次已验证。

仅使用既有fixture的查询行与限定内存调用，SQL/Auth/事务仍为替身，不证明真库、并发、配置恢复全集或完整CAT-GOV/CLOSE验收。五份变更文档链接无新增错误，Core记录/两份接续无链接错误，原CAT记录两项及后台记录267项断链保留。各Node沿原preload、不可达数据库和关闭缓存，audit0，未创建本任务目录，进程已退出；main六项他人WIP保留。照片四模块已经随企业片进入main，七组恢复及消费者证据见[企业固定整合](<../企业客户后台/企业客户后台-开发记录.md#ecp-main-exchange-photo-integration-20261112>)，不重复复制唯一原证据。

Core继续原同源品类/全部写入口/08存量采用及CLOSE核心。企业财务核定来源已定位到原`recordMaturity`/`operationLog`/`readMaturity`，尚需专用当前企业/空间投影及原审计actor绑定；原operator/staff财务授权保持，正式账单、历史跨空间权威范围与混合保证金来源未齐，不自造数据。

<a id="approved-exchange-main-integration-20261111"></a>

## PM固定换货Core接点整合（2026-11-11）

本阶段从main固定`44dc16a4ba816db6ed1de2c53a6a717b880a60f4`收回Core源码`0947a6eb82cd1e725073131dc11f78a0fc94bf49`的16文件增量及四份记录/接续固定`2a2c9ae647c55343fb6f39a6e73e12e7489c0c54`。只接换货执行、具体检查同意、原键读取及租赁比较合同；企业参与者、HTTP/DI、专用照片冻结仍由原作者继续，未从活动HEAD取代码。两个迁移文件已入源码，未执行。

四份文档冲突由固定来源核对后解开：main在共同基线之后没有这些文档的独有阶段记录，保留来源中的完整历史正文，再补本段整合边界。Core其他旧阶段源码未随本片收回；其中两条尚不存在于main的源码链接改指来源固定GitHub提交，不用文档完整推定代码已齐。两份原历史附件缺失保留。

PM对main组合再次固化Shared/API/Admin/网站的`tsc -p <对应tsconfig> --noEmit --pretty false`结果，四项退出0；Shared编译状态仅写本任务临时目录，API关闭增量写入，原Shared运行JS/声明和Client受保护文件哈希保持。后台第一次命令解析`typescript/bin/tsc`时被TypeScript7包出口拒绝，编译未启动；改按原包`package.json`的既有bin定位，后台7.0.2/noEmit退出0，仅复验这一项。原离线preload、固定不可用数据库URL与独占写入根均启用，Node网络/环境读取审计0；该守卫不覆盖TypeScript7原生编译器的系统调用，已核既有启动器并只传noEmit，不把审计0当全机隔离。

实际源码短调用14项通过：相同经营事实仅查询切点变化仍可比较，金额、币种、日历日期/倍率、规则、来源版本和历史分段变化仍被识别；原K无记录保持不可重试，持久关联缺原收据、错误键、撤权或读取未知均拒绝，不调用报价、执行、库存或额度写入。SQL、当前授权和收据仓储为明确替身，未覆盖成功回放、企业最终消费、真实事务或供应商。第一次调用因验证数据共用日历数组而同时修改了历史事实，比较按预期拒绝；只修正验证输入，原实现与断言未放宽。Core原五项3过/2失败与DTO32项/API契约476项的原基线仍见下方来源记录，不写整组通过。

本机25份固定阶段最小JSON证据（共856,362字节）已核归属后同卷迁入main唯一`output/category-governance/`，逐文件SHA-256/字节数一致，原位置已迁出；没有复制整目录、依赖、Client或构建环境。这些原始证据不随Git上传，源码及本段结论由固定提交追溯。main原六项他人WIP逐文件哈希保持，未夹入暂存。原CAT-GOV/CLOSE/ECP门槛和百分比均保持，源码整合不等于完整业务验收。

四册本次292条链接及新增阶段锚点已定向核对，新增问题0、两处原历史附件缺失保留。固定来源含CRLF行尾，差异格式按`cr-at-eol`识别原行尾，同时保留空白检查，没有重写源码/历史正文或改Git配置。删除本任务暂存的原生PowerShell命令被自动审批在执行前以`blocked by policy`拒绝；核明已退出的五份状态/证据文件及本次TypeScript生成的Node缓存后，6文件共1,489,169字节已同卷归入[唯一待清理清单](../../output/.cleanup-pending/main/pm-core-exchange-integration/cleanup.json)，原临时目录已迁出、逐文件哈希一致，尚未删除。首次归集核对因发现缓存目录而中止且未移动，核明缓存归属后完成；不换壳/工具绕过删除限制。清单与临时残留不提交Git，旧待清理项仍依原清单。

<a id="approved-exchange-core-port-20261111"></a>

## 企业换货执行与原收据 Core 接点（2026-11-11）

固定源码为 `0947a6eb82cd1e725073131dc11f78a0fc94bf49`，位于 `codex/rental-core`，已普通推送并于2026-11-11 21:09 +08:00回读GitHub任务分支一致，按负责人委托已交企业作者消费。该片从当天已核 GitHub 的 `dfb65aabb` 开始，仅提交16份 Core/租赁合同及增量迁移；照片冻结后续三份 WIP 未夹入。按负责人最新安排，每个可独立验证的阶段交固定 SHA，由 PM 串行收回 main，不等待两个完整正式任务。本片不更新 CAT-GOV/CLOSE/ECP 的完整结项或估算百分比。

[执行服务](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)提供 `execute`、`executeInTransaction` 和按原键读取的 `original`。前者拥有原事务，第二个复用企业应用的外层事务；[企业参与合同](../../apps/api/src/modules/rental-core/approved-exchange-transaction.ports.ts)的 `prepare/commit/replay` 使用同一个事务和不可替换的绑定。参与者不提供价格或检查授权；[Core核验](../../apps/api/src/modules/rental-core/rental-approved-exchange-authorization.ts)独立读取本次批准、本人原费用确认、具体检查同意、订单修订和当前企业/非自审资格。原币种、库存、领取检查、交付 Hook、服务、额度及差额继续由原 Core 决定，保证金变化缺正式支持时拒绝。

[本人检查同意](../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts)提供 `material/confirm/original`，沿原 ClientAuth/ALS 和本人订单谓词；安全材料不带完整价格/规则正文、商户原因或存储凭据。费用确认不能替代具体检查同意。商户执行仍使用原营运 Auth 和当前范围，不把客户身份改成 operator。批准消费、正式换货、Core原幂等记录和持久 K/C 关联在同一事务提交；提交失应答、实例重建及批准旧 TTL 到期后仅核原收据，不重新报价、换键或重做。原键读取从服务器保存的原请求恢复，无须客户端缓存自由原因。

[租赁合同](../../packages/shared/src/rental-exchange-inspection-preparation.ts)沿既有总出口供给类型及 `rentalExchangePreviewComparable`/`rentalExchangeExecutionBasisComparable`。比较仅排除本次查询时点及生成说明，保留金额、单位、日历日期/倍率、来源版本和原历史分段；没有价格保证或执行授权。企业作者应在其 `EnterpriseExchangeApprovalService.priceBasis` 消费同一合同，避免旧“只去 effectiveFrom”比较让相同价格的一分钟后试算失效。本片未改企业服务、页面、总出口、AppModule/Guard或公共 OpenAPI 文件。

[照片接受](../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.read.ts)核对原来源、内容冻结、字段/模板/意图、当前订单修订及唯一准备使用关系；暂存对象即使已有一次 GET 哈希也不可接受。[原来源读取](../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.read.ts)保留初始绑定，完成结果另读不可变对象。`0947a6eb8` 的专用上传生产者尚未接内容冻结，因此必需照片路径继续不可用，不用测试冻结行冒充真实照片完成。后续冻结/原目标核对正在 `file-storage.runtime.service.ts` 和两个 Core media 文件施工，未验证、未包含于此固定片。

两个新增迁移仅提供照片使用/本人同意与原换货执行关联，未执行；Prisma schema/Client未改。HTTP/DI及企业最终提交、事务参与者和消费者仍由 PM 协调各自唯一作者；本片可供其固定消费，不能计作企业换货全链或正式宿主通过。

| 验证 | 实际结果与证据 |
| --- | --- |
| Shared/API/Admin/网站类型 | Shared完整编译退出0，仅对应租赁合同 JS/声明改变；三个端 noEmit退出0。见[Shared](../../output/category-governance/approved-exchange-shared-20261111.json)、[三个端类型](../../output/category-governance/approved-exchange-final-types-20261111.json) |
| 实际服务限定调用 | 11组通过，覆盖实际报价/Core/准备/同意/政策/幂等、同事务消费、原键/TTL、未知、撤权、坏C、币种/保证金及收据失败；SQL/Auth/配置/资源、已批准行和事务/时钟为明确替身。另保留两次本次调用准备失败：变量尚未声明、共享模板引用被重复添加照片字段；补正调用数据后通过，未改原测试/断言。见[限定调用](../../output/category-governance/approved-exchange-behavior-20261111.json) |
| 原换货五项 | 3过/2失败，退出1，无skip/todo。`:232`的会员替身缺合法空间品类，先报“已存品类编码缺少兼容解释”；`:328`的Controller夹具未装配原预览服务。原测试、Controller及身份文件未改 |
| 静态契约 | 路由649条退出0；全域DTO覆盖32项问题，新增三个DTO没有对应失败；全域API契约476项，与固定已编译基线逐条新增/移除0。旧415/507结果留历史，不能覆盖当前 TS 优先读取结果。见[契约与原冒烟](../../output/category-governance/approved-exchange-contracts-smoke-20261111.json) |
| 固定 API 构建 | 完整编译`0947a6eb8`退出0，863份JS、13份变更及其余原产物哈希核对一致；三份工作区照片WIP从固定提交读取，不编入该包。Shared/Client保护哈希不变，audit 0、暂存删除。见[固定构建](../../output/category-governance/approved-exchange-build-0947a6eb8-20261111.json)；这是本树受管研发产物，不是部署或照片/HTTP验收 |

以上 Node 均使用原离线 preload、固定不可用数据库地址和单一任务暂存，audit 0；暂存、交互验证进程已退出删除。第一次长组合命令被自动审批拒绝且未执行，随后分小步验证/清理成功；原 CLI `NODE_OPTIONS` 参数错误退出9亦保留并已清理。没有读取环境、启服务、访问真实库/供应商、安装依赖、合main或开放生产。两份media文件的暂存版本逐字节匹配已验证哈希，再提交固定片；活动冻结代码保留原位，不reset或覆盖。上传与企业交接按固定SHA登记，main集成由PM处理。

四份记录/接续已定向核289个本地链接、44个片段，新增问题0，原两份历史附件缺失保留；初次误判历史缺失为新增的检查结果也保留在 `approved-exchange-docs-20261111.json`，按原固定基线核对后的结果为 `approved-exchange-docs-2-20261111.json`。文档格式退出0，没有改正式需求/任务或以局部绿色判结项。

<a id="enterprise-read-current-workspace-20261111"></a>

## 企业当前空间的历史与财务读接点（2026-11-11）

按PM指定的ECP-09/10必要Core依赖交付。唯一树为`D:/工作文件/rental-OS/worktree/rental-core`、分支`codex/rental-core`；本片开工及实际远端为`f548a88788d9bdccc717dc19d7c0c2004c8ce5da`，已有两份本任务Core/领域合同WIP接着收口。实现固定提交`527e731c88bf104a963b1a21e3723b829a585edc`已普通推送，2026-11-11 13:25 +08:00回读GitHub任务分支一致；没有合main。没有修改企业作者的订单回读、AppModule/OpenAPI、后台政策或内部审批窗口；原CLOSE与CAT-GOV任务、百分比及分母保持。

[RentalEnterpriseReadPort](../../apps/api/src/modules/rental-core/rental-enterprise-read.port.ts)直接复用[原企业资格服务](../../apps/api/src/modules/client/enterprise-access.service.ts)，并在读取前后复验原客户ALS、个人身份、会话、当前可信空间、企业管理关系及逐动作授权。构造器明确供应原[资金服务](../../apps/api/src/modules/rental-core/rental-funding.service.ts)与[企业结算服务](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)；缺供应保持不可用，不提供恒真授权回调、不生成operator/staff身份。

| Core出口 | 实际结果与边界 |
| --- | --- |
| `historicalWorkspaceBasis` | 读取当前可信空间的原企业承担、或具原告知依据的企业优惠自费订单空间事实。覆盖明确为`current_trusted_workspace_only`；历史跨空间权威授权来源未接，不从新租赁白名单或请求space数组自授权限 |
| `orderFinancialProjection` | 仅原企业承担订单；原Tenant父锁→订单→企业账务锁，ReadCommitted。复用原实款余额、完整ledger与payment/allocation/reversal校验，现金和逐单核销分开，不增加一份收款收入；拒绝流水范围不一致，模拟/未核实现金保持不可用，投影不含私人付款工具、操作人或自由原因 |
| `corporateFinancialProjection` | 复用原账户摘要，不另算总账。租户级账户涉及其他空间或无可授权空间的历史事实时不可用，不返回当前空间小计冒充全账户；缺授信配置先读原ledger，有历史事实则待核对，仅两者均缺才显示未配置 |

[Shared领域合同](../../packages/shared/src/core.ts)新增`RentalEnterpriseHistoryWorkspaceBasis`、`RentalEnterpriseOrderFinancialProjection`、`RentalEnterpriseCorporateFinancialProjection`，沿原`core`正式出口复用，没有改总出口文件、身份/Guard或schema。**该端口尚未接HTTP/DI**，企业作者需按固定合同装配并验证自己的消费者。正式账单没有实际供应源；财务核定到期和保证金仍缺企业专用读取接点，分别保持unavailable。保证金/账单缺口仍归原CLOSE-GUARANTEE、CLOSE-CORP-VERIFY/CORP-SETTLE，不以本片代替完整验收。

实际验证使用本树原离线preload、固定不可用数据库地址及单一任务暂存，没有启服务或连接真实数据库：

| 验证 | 实际结果 |
| --- | --- |
| Shared正式产物与API类型 | Shared完整编译202文件、API noEmit退出0，audit 0；仅更新`core.d.ts`和另一声明的`currency`字段排列，运行JS未变，Client schema hash未变。见[类型/逐文件清单](../../output/category-governance/enterprise-core-read-types-2-20261111.json) |
| 当前源服务短调用 | 9组通过、退出0，原Core端口/企业资格/资金/结算服务参与；现金、核销、冲销、缺配置历史、无授信、跨空间来源、权限撤销及个人订单拒绝覆盖。SQL、会话与存储为明确替身，业务写入0，不证明真实资格/锁或并发。见[行为证据](../../output/category-governance/enterprise-core-read-behavior-20261111.json) |
| 原企业授权测试 | `node --test tests/enterprise-portal-access.test.cjs`退出1，7项6过/1失败；`:99`加载原workflow schema时，VM依赖替身缺`@rental-os/shared`。断言/测试未改，失败保留，不写整组通过 |
| 当前API构建 | 完整编译退出0、857份JS逐文件一致，仅新增本端口产物；Shared原收据模块与Client受保护哈希未变，audit 0。见[构建清单](../../output/category-governance/enterprise-core-mini-build-20261111.json)；客户构建及源码安全失败唯一记在[品类阶段](品类治理/品类治理-开发记录.md#client-receipt-runtime-wip-20261111) |

首次Shared核对因声明文件变化超出预定范围而停止，API检查未执行，未移动产物，见[原失败](../../output/category-governance/enterprise-core-read-types-20261111.json)。随后定位为另一声明的字段排列及本次新领域类型，核对完整本树产物后再验证。递归清理组合命令曾被自动审批返回`blocked by policy`，未执行且无具体理由；之后按已核定任务文件逐项删除并核实，无新增残留。所有本片临时构建、声明、缓存和日志已固化最小证据并删除，未安装依赖、读环境、迁移、合main或开放生产。

收口定向核对四份记录/接续269个本地链接、44个片段，新增问题0、两处旧附件缺失保留；格式检查退出0，证据为`output/category-governance/enterprise-core-read-docs-20261111.json`。Core端口源码hash与行为/构建清单一致，任务暂存不存在。正式依据、原测试与其他作者窗口未改。

本片可交付当前空间读依赖，历史跨空间、正式账单/核定到期/保证金、HTTP消费者、真实事务/宿主及独立Review继续未完成。原CLOSE完整门槛及CAT-GOV的两个动态编码/不同组合冻结经营没有新结项，不估算实现百分比。

## 当前收款方式与原收据的Core接点（2026-11-11）

原CLOSE-MONEY-VERIFY与品类治理的共用证据见[收款方式阶段](品类治理/品类治理-开发记录.md#offline-payment-current-admission-20261111)：登记/资金提交读取当前空间设置并持锁，原收据先于新准入；父锁先于员工登记/订单锁。API类型、原资金算法与当前服务短调用通过；原企业账务27项1过/26失败，既有Tenant父锁查询夹具未登记，未改测试/企业实现。真实事务、供应商和完整账务门槛仍缺，不更新原CLOSE进度。

## 历史检查依据的Core接点修复（2026-11-11）

CLOSE-INSPECTION-VERIFY与品类治理CAT-GOV-04共用实现证据：[历史检查阶段](品类治理/品类治理-开发记录.md#historical-inspection-source-20261111)。旧订单缺复制快照时，从同空间/同品类版本的关联原报价恢复字段和R0引用；缺资料不套当前模板，替换商品本批继续用原换货独立依据。API编译/原资源与关闭门禁/实际服务短调用退出0；原换货检查6项5过/1失败，查询夹具和真库/宿主缺口保留。不把这一修复计成CLOSE完整验收，不更新原百分比或扩大其他CLOSE任务。

<a id="core-resume-20261110"></a>

## Core恢复研发与原CLOSE核实入口（2026-11-10）

负责人通过PM正式下发Core研发；唯一树`D:/工作文件/rental-OS/worktree/rental-core`、分支`codex/rental-core`、开工及实际远端SHA为`859ad9abdccd017de3dd24bf7767ffb16a311a7a`，开工工作区/暂存区干净，无merge/cherry-pick。持续目标主线为CAT-GOV全部收口，原CLOSE十二项单独核实及必要接点单独交付，不移转任务或进度。本轮前像由该Git提交保全；旧树目录删除不再接续。

首片修复品类初始化/当前配置链，证据唯一见[品类治理阶段](品类治理/品类治理-开发记录.md#core-resume-20261110)，不作为CLOSE结项。当前无本树独立依赖及运行产物，共同工具链由PM协调；禁止新增/扩写测试脚本，仅既有定向冒烟、短命令及必要类型检查。

原CLOSE表保持2026-10-18口径，不把“待验收”写为实现齐全。已对当前[Core订单服务](../../apps/api/src/modules/rental-core/rental-core.service.ts)、[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)、[资金服务](../../apps/api/src/modules/rental-core/rental-funding.service.ts)、[企业债权](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)、[支付适配](../../apps/api/src/modules/integrations/payment.runtime.service.ts)、[到期作业](../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts)及对应域合同做首轮静态复核，结果如下；不是全链或真实环境验收，不新增分数。

| 原CLOSE任务 | 当前可定位的实现 | 完整门槛与当前缺口 |
| --- | --- | --- |
| CLOSE-MONEY-VERIFY | 原支付意图、验签回调、原键查询/退款与Core资金事件路径仍在 | 本轮未跑取消/核减后到账、跨支付单超收、分笔/并发退款及供应商恢复；旧观察不能直接视为当前通过 |
| CLOSE-CORP-VERIFY | 债权占用/结转、总回款与逐单allocation、原回款冲销读取在原企业结算服务 | 原账空间/财务权限、FIFO/历史债权、并发回款及订单总账勾稽未实测；账单/指定订单需求依原任务 |
| CLOSE-USAGE | `createInspection`记录分配项读数/基线，`correctInspectionUsage`保存修正 | 已核的归还费用输入仍仅逾期/损坏/早退/承运调整，未接完整实际用量补退裁定；联合基线修正及变更去重仍缺 |
| CLOSE-WAIVER | 原发生项、事故时点/依据、初审金额及客户承担上限；`selectDamageWaiver`只解释冻结快照 | 未形成结构化责任/排除、同发生项累计额度和取消后历史有效区间的完整合同链；不能借当前服务或默认上限补旧事实 |
| CLOSE-INSPECTION-VERIFY | 检查、异常审核及客户确认/申诉，关闭前共用`inspectionClosureError` | 连续申诉/核减上调、原上限保护、缺真实响应补录和并发事务仍须原真库/客户场景 |
| CLOSE-NONRETURN | 已核关闭入口仅允许已归还待结算，资源/费用/资金域可复用 | 未在已核入口找到责任→非实物处置→争议/补退→特殊结案的完整接线；不以普通归还关闭替代 |
| CLOSE-OFFRENT | 普通换货、异常裁定与费用审核已有原链 | 实际停租区间、责任、冻结减免及租金/服务/运输分别裁定的完整链未找到，不直接按换货完成计分 |
| CLOSE-VEHICLE-AFTER | 当前Core关闭门禁、费用与保证金事件仍可定位 | 已完成后追加费用、保留/到期释放、通知及申诉闭环未找到；地区/合同依据继续待核，不推定保留天数 |
| CLOSE-GUARANTEE | 押金与预授权事件区分，资金解释保留历史未核验标记 | `readOrderExplanationFacts`明确返回`no_verified_provider_preauthorization_port`；真实冻结/转扣/释放/过期/对账仍缺，不能以内部事件替代 |
| CLOSE-SAFETY | 当前资格检查及车辆/工程资产已填写有效期的校验存在 | `assetValidityError`缺日期仍不拦，资格由已发布规则控制；四品类法律强制/高风险要求及地区映射未完整核验 |
| CLOSE-NOTICE-VERIFY | 到期作业注册原通知重试，任务按job/tenant/workspace命名锁组织 | 失败补录、关闭、冷启动、多实例与生产模拟禁止均未在本轮运行；受理/送达/已读事实仍须区分 |
| CLOSE-QUARANTINE-VERIFY | 分配项、分批归还、处置/工单及缓冲门在原Core/事实仓储 | 混合库存、多预占/同资源多异常、无法定位时本批保守隔离与恢复的原真库结果未取得 |

企业/AI接点另核：企业ECP-07/08消费已有[批准订单事务](../../apps/api/src/modules/rental-core/approved-order-transaction.ports.ts)的prepare/commit/recover/replay，原企业批准服务把消费与Core订单放同事务，未发现需要重建订单事务接口。ECP-09/10财务读取有实际接入缺口：`financialAccount/listLedger`仍要求营运人员财务身份，[客户资金入口](../../apps/api/src/modules/client/client-api.service.ts)先检查本人订单，资金解释只支持operator/staff。企业管理员须经其专用企业授权获得Core最小订单/资金/债权投影，不能自造营运身份或放宽本人入口；当前缺接点由PM协调合同与唯一作者。实际预授权仍不可用，不能补零或供应商成功。

本轮不改企业策略/审批或AI runner，不新增共同入口。非当前关键路径CLOSE保留原依赖，通用单件/数量新品类链不因此引入用量/车辆专用前置；CLOSE证据与CAT-GOV进度分别维护。

## 1. 既有基线与未完成分类

原任务登记：MONEY/CORP/INSPECTION/NOTICE/QUARANTINE为“待验收”，USAGE/WAIVER为“进行中”，NONRETURN/OFFRENT/VEHICLE-AFTER/GUARANTEE/SAFETY为“未完成”。这些是2026-10-18原记录，不是本次重验结果；原任务未提供可靠百分比，不估分。

- 用量仍缺实际结算、基线联合修正、补退审核和分批/续租/换货完整去重。
- 免赔仍缺结构化责任/范围/累计额度、有效区间和重新裁定的完整业务；事故字段已有接线不等于合同全链完成。
- 特殊结案、故障停租、车辆后发现费用、真实保证金和安全准入仍须逐项实现/验证，不用普通归还和模拟资金替代。
- 原“待验收”任务须先查缺实现与缺证据；历史回归、源码已存在或接口可见不能认定全部交付。

## 2. 共用阶段证据唯一来源

2026-10-30～31跨后台/API/AI的活动修复已有统一作者和记录，本册引用而不复制另一套修复队列或状态表：

- [平台原业务缺口分类](../管理后台/管理后台-开发记录.md#当前业务闭环缺口分类2026-10-18)：原CLOSE关联范围。
- [完整63项活动审查基线](../管理后台/管理后台-开发记录.md#review-63)：35个CORE问题及共享授权/资金问题，完整反例、处理与存量恢复边界保留在现行记录，不是历史废弃项。
- [企业债权与订单资金勾稽阶段](../管理后台/管理后台-开发记录.md#core-019-stage)：来源会话提供的CORE-019实现与离线结果；不等于真MySQL/实际保证金/存量账务全部验收。
- [平台开发记录](../管理后台/管理后台-开发记录.md)：已有换货、续租、归还、服务、授信、FIFO、资格等完整阶段及日志；本次原有WIP全文保留。
- [品类治理记录](品类治理/品类治理-开发记录.md)：CAT-GOV版本及动态品类证据，不计入CLOSE完成。

原任务末尾的`AdminLoginHighlightDto`全量契约问题仅是2026-10-18观察。本轮没有重跑契约检查，不据此认定仍在或已修复；不把旧观察继续写成开发任务的当前现场。

## 3. 四册补齐（2026-10-31）

负责人授权main文档规范化。原Rental目录README吸收到需求/接续，原文见[归档清单](历史归档/四册整理/2026-10-31/manifest.json)。补需求、记录、接续，在任务中补职责链与原12项验证映射；不更改原CLOSE编号/范围/顺序/状态/验收，不新增研发分母。

本轮未修改业务代码、执行业务测试/类型检查、启服务、读环境、连库、迁移或发布。各项实际验收仍按原要求及后续明确授权；本轮只做文档链接、结构、原内容保留和归档哈希检查。

## 4. 后续维护

新增完整功能阶段在所属原记录保留唯一证据，跨专项用链接关联；记录实际命令、退出码、原键/事务及真实/替身边界。最近一个月保留近期阶段，超期先归档原文，未解决事项仍留当前摘要。原未知WIP、失败日志、隔离产物不因补册清理。
