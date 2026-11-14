# Rental Core 开发记录

建立日期：2026-10-31。来源：原2026-10-18 CLOSE任务、平台正式需求及平台开发记录。本册补齐专项证据入口，不把历史状态重新判定为当前完成度。

[需求](<Rental Core-需求.md>) · [开发任务](<Rental Core-开发任务.md>) · [协作接续](<Rental Core-协作接续.md>)

<a id="core-frozen-main-20261114"></a>
## Core 冻结版本完整合并与冲突核定（2026-11-14）

负责人要求全部冻结树合main并在最终版本review。第二父固定 `30b192764f8f26f792a819b959953a37805beec4`，主线输入 `b824303eaf1b00b1b765b5152450fe73efffdc47`。本次接回46份产品/构建及既有测试增量，四册记录原位归并；三份历史main最小patch继续保留在来源Git历史，不在main复制过程文件。原作者仅受托核定11处固定冲突，工作树/分支/索引保持不变，核定后回原暂停，不实施原报价配置一致性未完项。

固定清单与验证摘要的Git blob为 `abb0d1825c561871b8bd2bcb46c05e7dbbb2f839`，产品候选树为 `16d08e2b93dd07506d7c1a7885336ec4fecc5889`。八个后端冲突采用已含main原补片的Core冻结正文，保留可信平台身份/权限/CAS、短输入捕获、企业委托/续租服务和历史依据。去掉自动合并重复的readTenantReadinessSource；小程序构建组合保留main异步AI运行时和Core受控out-dir、失败清理、正式收据vendor；原Shared四匹配函数与新增两选择函数按AST提取，同一归属校验和原dispose/取消清理保持。

作者固定Git对象/内存验证：API932根/2088源、Shared113根/321源、小程序108根/299源均零诊断。原准备/治理脚本、续租12/12、采用后配置读取7/7和12组原函数/打包/路径/异步退出验证通过，审计0。首次进程句柄丢失无结论不计通过，API初轮漏固定environment.d.cts补齐后通过，runtime初轮使用错误.js转译后以.ts复验通过。结果分别固定为 `47ea39281e5f9c249e1e05903cedb1cf36615c10`、`62c6df1ddf3b42bff7e80aa7b92ee45bb5fdc7a8`、`949e031a7f9ec55448bf329fd3d448a41eb02eb8`；未改原断言或生成Client。

原报价取得旧业务配置后读到新价格的独立反例仍未修，CAT-GOV/原CLOSE完整门槛不变；源码合入不是MySQL/多实例/微信/实际资金验收，不执行DDL。后续AI固定源的原参加者装配按同一来源继续串行接入，最终main再交QA。六份旧WIP与后台品牌小片保持，未停AI开发。

作者自建暂存原生删除被自动审批blocked by policy拒绝，10文件62972字节已归集至主树唯一 `output/.cleanup-pending/rental-core/fixed-main-core-conflict-20261114/`，原路径已迁出且hash核同，仍未删除。PM未新增临时环境。原未解决反例及暂停记录完整保留。

<a id="core-pause-closeout-20261113"></a>

## 收口暂停与未修复反例（2026-11-13）

负责人要求“先收口暂停，提交最后的代码”。收口核查时，`codex/rental-core`与GitHub实际目标分支均为`8f7f164f7e30c5bd3e9b77642a263eaa5a4c7534`，工作区/暂存区干净、上游0/0、无merge/cherry-pick。最后两片源码分别为[配置副本](#quote-configuration-snapshot-20261113)`5340ce40e`和[普通报价历史保护](#quote-history-immutable-20261113)`a591e7aea`，已提交上传；此后只做只读核查及限定反例，没有开始新的源码修复。暂停收口仅补本记录、接续和品类治理对应两册，不启动新的开发或业务验证，不合main或发跨对话消息。

保留[独立价格读取反例](<../../worktree/rental-core/output/category-governance/quote-atomic-configuration-before-20261113.json>)：报价取得旧业务配置后等待履约读取，价格源推进时可得到`price-later`，同时仍记录计划/规则1.0和履约费10，后继费用为25。限定调用退出0/audit0，使用当前编译报价、原计价和明确配置/价格/容量/保存fixture，不能当作MySQL或真实经营证据。原进程内配置副本修复保持有效，但完整数据库价格、Core配置、能力及检查模板的同源计算/提交复核尚未闭合；原组合、全部写入口及真实并发门槛不变。恢复后先从本反例及原`createQuote`、配置仓储和`persistQuote`继续，不将未实施方案写成已修复。

[暂停核查摘要](<../../worktree/rental-core/output/category-governance/quote-atomic-configuration-pause-summary-20261113.json>)确认反例进程已退出、源码无新增修改、唯一暂存只剩一份零字节audit。原生PowerShell精确删除被CreateProcess自动审批`blocked by policy`拒绝，整条未执行且无具体理由；已安全同卷移至[唯一责任清单](<../../output/.cleanup-pending/rental-core/quote-atomic-configuration-probe-validation/manifest.json>)，[退出证据](<../../worktree/rental-core/output/category-governance/quote-atomic-configuration-pause-cleanup-20261113.json>)核原暂存不存在，已归集未删除。前两片及旧批残留继续原清单责任，不宣称全部清理。

原恢复4/5与库存夹具缺失、续租数据库脚本改写历史的需求冲突、正式ResourcePorts/临近政策/宿主和开业counter/参加者缺口均保留。CAT-GOV完整结项仍0/14、实现百分比待核实；两个动态新编码不同组合冻结经营、真库/容量/锁/回滚/多实例、浏览器/微信及独立Review尚未完成，原CLOSE与企业/AI门槛分别核实。当前目标已暂停；本次收口不降低原范围，也不提供任何新增环境执行许可。

<a id="quote-history-immutable-20261113"></a>

## 普通报价历史与消费保护（2026-11-13）

沿CAT-GOV-04与需求§6.3.1继续核有效报价及旧单依据，从已核GitHub的`721deb6410ec59e22bdd925cb6c4dafb6f3259bc`接续。原[仓储反例](<../../worktree/rental-core/output/category-governance/quote-history-immutable-before-20261113.json>)确认：无原操作键的已保存报价，同ID写入可将金额100改为101、规则1改为2及价格版本改为v2，也可清除已消费时点/订单。原SQL、持久行和事务为明确fixture；反例不证明真实库或授权绕过。

仅修改[原报价事实仓储](../../apps/api/src/modules/rental-core/rental-business-fact.repository.ts)。`upsertQuote`首次await前固定请求副本与期望绑定；所有已保存报价都核对原金额、客户/会员、费用/优惠/券/服务、价格/规则/日历、能力/检查及来源快照、币种和创建/到期时点。普通报价与原键报价同样不可改写，正常回放无写；原键读取仍优先返回已保存原结果，不重跑当前新业务准入。

消费沿原空间互斥入口，只允许添加完整的原消费时点与订单；写入仅更新这两字段。已消费后同结果回放无写，迟到旧副本不可清除、换订单或重置时点；部分/坏时点/空订单明确拒绝。旧四品类大写枚举名复用原兼容解释器比较，保留原存储编码。原decoder明确把部分历史NULL列表投影为空数组，此类无变化回读可接受，但不把空数组写回数据库；来源/库存/检查/能力的未知证据不能补造。未改Shared、DTO/OpenAPI/Schema、Guard/DI、金额算法或测试脚本。

原API配置、受管TypeScript5.9.3最终867根/2012源零诊断，仅安装本仓储必要emit，六份Shared运行时/Client、Core、前片配置副本及能力产物哈希未变，见[类型与安装](<../../worktree/rental-core/output/category-governance/quote-history-immutable-final-compile-20261113.json>)。[当前编译十四组限定行为](<../../worktree/rental-core/output/category-governance/quote-history-immutable-current-behavior-20261113.json>)退出0/audit0，覆盖全业务正文与时间不可变、旧空值无补写、完整消费/已消费保护、首等待前输入、原互斥后赢家、原键回读及空间归属。首轮[失败](<../../worktree/rental-core/output/category-governance/quote-history-immutable-behavior-20261113.json>)暴露旧枚举比较，已修生产兼容；[后续失败](<../../worktree/rental-core/output/category-governance/quote-history-immutable-final-behavior-20261113.json>)经字段诊断定位短调用读回仍引用持久request，仅修其明确JSON传输副本后通过，不改旧断言或放宽拒绝。

[原恢复及纯脚本运行](<../../worktree/rental-core/output/category-governance/quote-history-immutable-original-tests-20261113.json>)使用当前编译仓储和原ts-node源码优先装载，执行`tests/rental-quote-recovery-review.test.cjs`、`tests/rental-quote-validity.test.cjs`、`tests/rental-order-quote-scope.test.cjs`：恢复4/5，两个纯脚本通过，总退出1/audit0。恢复第5项在111行新建夹具报价缺inventoryBasis，未进入本片历史分支；[固定721deb641原仓储对照](<../../worktree/rental-core/output/category-governance/quote-history-immutable-original-baseline-20261113.json>)同4/5、同错误及退出1。保留原失败，不将其写为整组通过。

**待负责人协调的原验证冲突：** [续租数据库脚本](../../tests/rental-renewal-persistence.test.cjs)37～38行通过`upsertQuote`改写旧pricingContext，109行再恢复原稿，与品类治理需求§6.3.1历史保护冲突。本片没有执行真实脚本、改断言或扩大测试维护；下一由PM协调原作者使用独立新报价fixture，保留原持久化覆盖。原其他父锁/异步/宿主及资金失败继续原记录。

全部验证已退出，唯一暂存只剩空audit。原生PowerShell精确删除被CreateProcess自动审批`blocked by policy`拒绝，整条未执行且无具体理由；已安全同卷归[唯一责任清单](<../../output/.cleanup-pending/rental-core/quote-history-immutable-validation/manifest.json>)，[退出证据](<../../worktree/rental-core/output/category-governance/quote-history-immutable-cleanup-20261113.json>)确认原暂存不存在、已归集未删除。旧批继续创建者责任。结果留本对话/原记录供PM主动读取，没有主动消息、合main或新环境执行。

本片仓储及四份记录/接续已固定为`a591e7aea5b1c9caaaed679b73dff31ffa429645`，普通推送`codex/rental-core`并[回读GitHub同SHA](<../../worktree/rental-core/output/category-governance/quote-history-immutable-github-20261113.json>)，工作树干净、上游0/0，未合main。前片配置副本`5340ce40e`与记录`721deb641`仍在本分支。

本片完成已存报价仓储保护，不证明新报价MySQL价格/能力/检查的完整组合、真实消费并发或多实例。完整CAT-GOV仍0/14、实现百分比待核实；全部写入口、真库容量/锁/回滚、两个动态新编码不同组合冻结经营、浏览器/微信和独立Review继续原门槛，CLOSE/企业/AI按原任务分别核实。

<a id="quote-configuration-snapshot-20261113"></a>

## 报价配置副本与提交后缓存（2026-11-13）

沿CAT-GOV-03/04/08核对同源报价和采用并发边界，从已核GitHub的`6993b3c67eae0eb448f2196faf0df2650ce128ac`接续。原[等待反例](<../../worktree/rental-core/output/category-governance/quote-configuration-snapshot-before-20261113.json>)确认：租金计算后等待服务容量期间，另一请求经实际`refreshWorkspaceContext`队列刷新同一缓存，会使本报价保留价格1.0/base80/租金168，却应用后继优惠`later-discount`/5。反例使用当前TS金额函数与真实进程内刷新队列；配置、履约、容量和保存是明确fixture，没有真实数据库或HTTP。

仅修改[原业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)。版本化报价在原权威配置读取的队列回调内克隆价格、优惠、服务、日历、规则、通知配置及所选券，避免等刷新返回后才复制已经被后继请求覆盖的共享对象。原请求、Core上下文、原键/指纹、地址和ALS来源仍在首次等待前捕获；报价副本按服务实例、租户和原空间隔离，明确无版本的吸收路径保留，不据此自授事务或权限。历史报价、奖励、账户和通知历史仍归原仓储/缓存，不复制整个历史，不改变金额、库存、服务容量或历史消费算法。

刷新始终向本次读取的原空间发布；报价成功保存后只向已经存在的同品类缓存补入原结果，不把旧配置副本写回、不因缓存已换品类或缺失而重新seed。保存失败不发布幽灵报价。原懒补落仅在当前同品类缓存六类配置仍与已保存副本相等时标记已保存，后继未保存编辑保持原值及未保存状态。Shared/DTO/OpenAPI/Schema、Guard/DI、其他专项源码与测试文件未改，没有新增或扩写测试脚本。

原API配置、受管TypeScript5.9.3最终867根/2012源零诊断，仅安装本源码必要emit，六份Shared运行时/Client、Core与前片能力/报价仓储保护哈希一致，见[最终类型与安装](<../../worktree/rental-core/output/category-governance/quote-configuration-snapshot-current-compile-20261113.json>)。[当前编译十三组限定行为](<../../worktree/rental-core/output/category-governance/quote-configuration-snapshot-final-behavior-20261113.json>)退出0、audit0：等待中的旧组合、下一新版组合、两并行报价各自配置、另一实例隔离、保存失败、实际空集拒绝、明确无版本路径、原输入捕获，以及提交后换品类/缺缓存、懒补落标记和迟到空间来源均通过。懒补落的保存与SQL端口是声明替身，这些结果不证明真实事务、并发采用或跨实例。

原`node --no-compilation-cache --require <本树preload> --test --test-concurrency=1 --test-reporter=spec tests/category-adoption-context-refresh.test.cjs`七项通过，见[配置读取回归](<../../worktree/rental-core/output/category-governance/quote-configuration-snapshot-configuration-context-original-20261113.json>)；原`node --no-compilation-cache --require <本树preload> tests/rental-extension-services.test.cjs`十二项通过，见[续租服务回归](<../../worktree/rental-core/output/category-governance/quote-configuration-snapshot-extension-services-original-20261113.json>)。两命令均退出0/audit0，原断言保留；原父锁/异步/宿主等其他失败仍在此前记录，不扩称全域通过。

全部验证退出，必要单emit在本树自持产物，原唯一暂存只剩空audit。原生PowerShell精确删除被CreateProcess自动审批`blocked by policy`拒绝，整条未执行且无具体理由；已安全同卷归入[唯一责任清单](<../../output/.cleanup-pending/rental-core/quote-configuration-snapshot-validation/manifest.json>)，[退出证据](<../../worktree/rental-core/output/category-governance/quote-configuration-snapshot-cleanup-20261113.json>)确认原暂存不存在、已归集未删除，旧批继续创建者责任。没有主动跨对话消息、合main或新增环境执行。

本片源码及四份记录/接续已固定为`5340ce40ee76c0d4b74a3f0105bd0f60e1e59d15`，普通推送`codex/rental-core`并[回读GitHub同SHA](<../../worktree/rental-core/output/category-governance/quote-configuration-snapshot-github-20261113.json>)，工作树干净、上游0/0。默认schannel传输两次推送及后续回读出现TLS握手失败；单命令HTTP/1.1普通推送成功，随后用Git自带OpenSSL回读确认，没有修改远端、持久配置或关闭证书检查，未合main。

本片完成进程内配置副本及缓存发布修复；MySQL不可变价格、能力和检查模板仍有独立读取，完整数据库组合及全部写入口并发尚未闭合。完整CAT-GOV保持0/14、实现百分比待核实；真库容量/锁/回滚/多实例、两个动态新编码不同执行组合的同一冻结构建经营、浏览器/微信及独立Review继续原门槛。CLOSE和企业/AI接点单独核实，不以本片计整项完成。

<a id="quote-input-capture-20261113"></a>

## 报价首次等待前的输入与来源捕获（2026-11-13）

继续CAT-GOV-03/04/08的报价完整依据核查。从已核GitHub的`410de8d39049261e8a551cf308de47f40357f78d`接续，前片完整能力提交`c67281023`保留。原[报价入口反例](<../../worktree/rental-core/output/category-governance/quote-input-capture-before-20261113.json>)确认第一次配置刷新等待时改变调用方客户名称/数量，实际报价改用后来输入；不是只读对象污染，原报价/计价方法确实执行。反例使用原吸收式配置与明确履约/库存分页fixture，无真实DB/HTTP或经营写入证据。

仅修改[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)的`createQuote`开头：在首次await前克隆请求、Core上下文与预解析地址，捕获原操作键/指纹及原ALS来源，随后再刷新配置和执行原身份/品类/库存/金额/能力门禁。调用方后来输入继续保留，但不替换本次已捕获意图；原键错误在配置等待前拒绝，原规范化后的指纹检查保持。实际ALS来源在等待后变化仍由原提交前来源比较拒绝，不把捕获的旧身份作为新授权。仅输入生命周期调整，没有改变原价格、规则、计费、营销、保证金或原收据恢复算法，也未改公共合同/DTO/OpenAPI/Schema/Guard/DI及测试文件。

原API配置TypeScript5.9.3检查867根/2012源零诊断，仅安装本源码必要emit；Shared运行时/Client、Core及前片能力提交两产物六份保护哈希一致，见[类型与安装](<../../worktree/rental-core/output/category-governance/quote-input-capture-compile-20261113.json>)。移动已完成后的PowerShell`Test-Path`表达式括号错误只影响结果登记；随后按源不存在/目标与emit哈希一致核实，没有重复覆盖产物。

[当前产物六组限定行为](<../../worktree/rental-core/output/category-governance/quote-input-capture-current-behavior-20261113.json>)退出0、audit0：正常报价保留调用方输入，首等待后改数量/客户不改原金额，上下文币种/商品/品类独立、实际ALS迟到变化在保存前拒绝、原键/指纹和预解析地址独立捕获均通过。首次[目录替身失败](<../../worktree/rental-core/output/category-governance/quote-input-capture-behavior-20261113.json>)把“持久行”直接引用调用方上下文，改名称后正确触发原库存一致性拒绝；[第二次失败](<../../worktree/rental-core/output/category-governance/quote-input-capture-final-behavior-20261113.json>)在独立TS ALS上修改`runWithRequestIdentity`复制前对象，未触发编译服务的来源检查。只纠正短调用目录行分离和同一编译ALS实际store后，[来源复验](<../../worktree/rental-core/output/category-governance/quote-input-capture-source-scope-behavior-20261113.json>)及当前产物通过，不改生产库存/身份门禁或旧断言。

原`node --no-compilation-cache --require <本树preload> tests/rental-extension-services.test.cjs`12项全部通过、退出0/audit0，见[原续租回归](<../../worktree/rental-core/output/category-governance/quote-input-capture-original-tests-20261113.json>)；容量拒绝、独立服务发生、重复去重、历史缺失/明确空快照及补款/企业月结原消费覆盖保持。没有新增/扩写测试脚本；原SQL/配置/容量与等待替身不证明真实库存/资金、并发缓存、HTTP或宿主。

全部验证退出、必要单emit在本树自持产物，唯一暂存剩空audit。原生精确删除被CreateProcess自动审批`blocked by policy`拒绝，整条未执行/无详细理由；已安全同卷归[唯一责任清单](<../../output/.cleanup-pending/rental-core/quote-input-capture-validation/manifest.json>)，[退出](<../../worktree/rental-core/output/category-governance/quote-input-capture-cleanup-20261113.json>)确认原暂存不存在、已归集未删除。旧各批继续创建者责任；没有主动跨对话消息、合main或环境新增执行。

单份源码与四份记录/接续已固定为`006293fcec07a3a0a5074bd018168e0c9dcc6f48`，普通推送`codex/rental-core`并[回读GitHub同SHA](<../../worktree/rental-core/output/category-governance/quote-input-capture-github-20261113.json>)，工作树干净、上游0/0。完整CAT-GOV仍0/14、实现百分比待核实。本片证明原请求生命周期，不证明完整报价配置一致性；业务缓存等待期间、价格/规则/检查与全部写入口的并发组合继续核查，真库容量/锁/多实例、两个动态编码不同执行组合冻结经营、浏览器/微信及独立Review保持原门槛。CLOSE、企业/AI接点分别沿原任务处理。

<a id="quote-capability-commit-20261113"></a>

## 新报价提交的完整能力快照复核（2026-11-13）

继续CAT-GOV-03/04/08的同源执行及并发采用门槛。从已核GitHub的`8c4311db7239263fe13930dc5bf4f0cf5eb4cea8`接续，工作区/暂存区干净、无merge/cherry-pick或任务进程。原[新报价保存反例](<../../worktree/rental-core/output/category-governance/quote-capability-commit-before-20261113.json>)调用当前TS仓储及原履约/库存门禁，确认非条件能力已暂停、版本/配置改变以及普通必选实例缺失时，仍可写新报价。SQL/quote行及事务是明确替身；没有真实数据库写入，不把反例当作权限或真库并发验收。

仅修改[Core能力事实接点](../../apps/api/src/modules/rental-core/category-capability-facts.ts)和[原报价事实仓储](../../apps/api/src/modules/rental-core/rental-business-fact.repository.ts)。新建报价在原空间锁与期望品类绑定核对之后，重读同tenant/workspace全部启用实例，按已登记编码数加一哨兵限定行数，仅取原快照的编码、实现版本、配置版本和配置。与报价已冻结名单做结构等价比较，包括新增启用、暂停/停用、实现/配置变化；同一品类绑定不再被当作能力事实未变的证据。重复/未知编码、不可读配置及版本缺失拒绝，数组顺序或JSON键序不造成假冲突；普通必选和已触发条件必选从报价不可变品类及原条件快照求出，必选未启用拒绝。版本化新报价必须携带显式快照，合法空数组不等于缺失。

原条件商品/套装成员与条件能力复验继续调用，未改其历史消费者。新增门禁只在仓储新建分支调用；已有有效报价、普通消费及原操作键回放先读原持久事实，不重新套当前能力启停，不补造或改写历史快照。原无版本且无能力快照的明确legacy路径保留。未改Shared/DTO/OpenAPI/Schema、Guard/DI、报价金额/库存算法、Hook实现或企业/AI源码；生产AppModule已具有原服务，不新增公共接点。

原API配置、TypeScript5.9.3最终867根/2012源零诊断，两份必要emit已安装；Shared运行时/Client、Core/业务服务及采用Application七份保护产物哈希一致，见[类型与安装](<../../worktree/rental-core/output/category-governance/quote-capability-commit-final-compile-20261113.json>)。[当前产物十六组限定行为](<../../worktree/rental-core/output/category-governance/quote-capability-commit-current-behavior-20261113.json>)退出0、audit0：正常保存不改输入，启停/实现/配置/新启用变化拒绝，普通必选缺失拒绝，显式空/缺失分开、重复/未知码和坏配置拒绝、锁等待期间变化拒绝、原键/已保存消费保留、同空间哨兵查询以及原条件商品独立复验通过。

限定调用[首次失败](<../../worktree/rental-core/output/category-governance/quote-capability-commit-behavior-20261113.json>)来自替身保存Prisma.DbNull/JsonNull原值、未模拟数据库null回读，使原来源保护拒绝消费；只纠正该短调用的JSON传输及无take查询返回，[复验](<../../worktree/rental-core/output/category-governance/quote-capability-commit-final-behavior-20261113.json>)通过，没有调整生产拒绝或旧断言。原`node --no-compilation-cache --require <本树preload> --test --test-concurrency=1 --test-reporter=spec tests/category-capability-conditions.test.cjs tests/capability-hook-runtime.test.cjs tests/rental-category-core-alignment.test.cjs`报告12项通过、退出0/audit0，见[原用例](<../../worktree/rental-core/output/category-governance/quote-capability-commit-original-tests-20261113.json>)。原Hook脚本内部16组覆盖仍保留；测试文件未改，不新增/扩写脚本。完整四品类经营脚本原库存分页夹具缺口及其他旧失败继续保留，不用对齐脚本替代整条经营验收。

全部验证已退出，唯一暂存只剩空audit。原生PowerShell精确删除再次被自动审批`blocked by policy`拒绝，整条未执行且无详细理由；已安全同卷归入[唯一责任清单](<../../output/.cleanup-pending/rental-core/quote-capability-commit-validation/manifest.json>)，[退出证据](<../../worktree/rental-core/output/category-governance/quote-capability-commit-cleanup-20261113.json>)确认原暂存不存在、已归集未删除，旧批责任保持。阶段固定版本/验证/未验/阻塞留本对话及原资料供PM主动读取，没有跨对话消息、合main或新增环境执行。

两份源码与四份记录/接续已固定为`c67281023ef57e0b0effa4c6a7245769cc18b490`，普通推送`codex/rental-core`并[读取GitHub同SHA](<../../worktree/rental-core/output/category-governance/quote-capability-commit-github-20261113.json>)，工作树干净、上游0/0。仍未证明MySQL查询/锁/容量、真实并发采用与新报价、服务进程/缓存、多端宿主或独立Review。当前完整CAT-GOV为0/14、实现百分比待核实；后续继续完整报价的配置/价格/规则/检查组合及全部写入口，两个动态编码不同组合的同一冻结构建经营和原22项验收，CLOSE及企业/AI接点分别核实，不混算。

<a id="adoption-configuration-preflight-20261113"></a>

## 采用配置行数前置与最终候选复核（2026-11-13）

沿CAT-GOV-08继续原规模及原子采用门槛。从已核GitHub的`9b21d3e3cd7b744c7369831ca6c5e4eec979bd14`接续；原[采用反例](<../../worktree/rental-core/output/category-governance/adoption-configuration-preflight-before-20261113.json>)确认定价配置或套装组成超过10000条时，会先执行实体补丁、读取组成，再进入原最终检查拒绝并回滚。反例中的回滚为明确串行事务fixture，没有发生真实库写入，不把它表述为已提交半成品。

仅修改[最终配置检查](../../apps/api/src/modules/rental-core/category-adoption-final-compatibility.ts)、[采用事务阶段](../../apps/api/src/modules/rental-core/category-adoption-transaction-phase.ts)和[准备服务](../../apps/api/src/modules/rental-core/category-adoption-preparation.service.ts)。把原17个配置/关系领域计数抽为同事务检查，保留每领域10000条、合计50000条：实际采用在任何实体补丁及套装/定价成员物化前核对；完整预览/旧整份也在全目录/能力JSON读取前核对。最终检查在候选能力应用后重新计数、复核原配置JSON与完整候选16MiB上限，前置结果不作为最终准入证据。

分批实体保存没有新能力补丁且没有此前能力准备时，不读取活动能力JSON；有新/保留能力准备时先按原领域行数限制其来源，再用原实例修订/实现合同校验，当前经营事实不变。没有用全空间配置超限阻止一条无关实体资料暂存；最终采用仍会明确拒绝超限并保留该暂存。配置JSON上限继续在候选修改后检查，避免把前置旧JSON大小当作阻止合法能力准备修复的额外业务规则。本片未改原上限、公共协议/DTO/OpenAPI/Schema、Auth、Application原键机制或报价/库存算法。

原API配置、TypeScript5.9.3最终867根/2012源零诊断，三份必要emit已安装，Shared运行时/Client、采用Application及前片批次辅助六份保护文件哈希一致，见[最终类型/安装](<../../worktree/rental-core/output/category-governance/adoption-configuration-preflight-final-compile-20261113.json>)。[当前产物十三组限定行为](<../../worktree/rental-core/output/category-governance/adoption-configuration-preflight-current-behavior-20261113.json>)退出0、audit0：价格/规则/定价组、成员/组成分别超限在实体读取/写入前拒绝；合计50000条、全量预览前置、无关超限不拦单条准备、新/保留能力修订复核、写后计数变化回滚、原候选JSON限制、两批1000+1条正常采用/完整声明和已提交原收据不受后继超限影响均通过。

原`node --no-compilation-cache --require <本树preload> --test --test-concurrency=1 --test-reporter=spec tests/category-preparation-batch-service.test.cjs tests/category-adoption-context-refresh.test.cjs`共8项通过、退出0、audit0，见[原回归](<../../worktree/rental-core/output/category-governance/adoption-configuration-preflight-original-tests-20261113.json>)。七项配置读取包含两个独立Core对象采用后同源、旧上下文保留、空集合不造样本、后继绑定拒绝及AI读取单一Core配置；这是原fixture实例，不是真实API进程或MySQL多实例。原测试文件/断言未修改，没有新增或扩写脚本；其他旧父锁/异步/宿主失败保留。

全部验证已退出、三emit在本树自持产物；一份零字节audit原生精确删除被自动审批`blocked by policy`拒绝，整条未执行/无详细理由。已安全同卷归入[唯一责任清单](<../../output/.cleanup-pending/rental-core/adoption-configuration-preflight-validation/manifest.json>)，[退出证据](<../../worktree/rental-core/output/category-governance/adoption-configuration-preflight-cleanup-20261113.json>)确认原任务暂存不存在，已归集未删除；此前各批继续原清单责任。结果仅留本对话及原记录/接续供PM主动读取，没有主动发消息、合main或新环境执行。

三份源码与四份记录/接续已固定为`da06e2463c5da1ee10495dbb1dfda37794fb2bb4`，普通推送`codex/rental-core`并[回读GitHub同SHA](<../../worktree/rental-core/output/category-governance/adoption-configuration-preflight-github-20261113.json>)，工作树干净、上游0/0，未合main。本片补齐已知配置读取顺序，不计整项完成；完整CAT-GOV仍0/14、百分比待核实。剩余包括当前配置/历史动作与全部写入口的并发组合、真库总规模/锁/回滚/多实例、两个动态编码不同执行组合的同一冻结构建经营、浏览器/微信及独立Review；原CLOSE和企业/AI接点另按各自门槛核实。

<a id="preparation-bounded-read-20261113"></a>

## 分批准备的实体读取范围与扫描前门禁（2026-11-13）

沿CAT-GOV-08及需求§6.2.1继续核累计准备和最终事务。开工工作树与GitHub均为`f3300b9b2a478c6dd96b4274a62475a62ac0d059`，无未提交、暂存或merge/cherry-pick。原服务保存一条型号准备也先读取全空间型号/资产及组成；[原入口反例](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-before-20261113.json>)显示本批只含`g0`仍读取3个型号。完整预览和旧整份保存也在物化实体后才进入最终规模检查。没有把此反例当作真实容量或并发结论。

仅修改[原批次辅助](../../apps/api/src/modules/rental-core/category-preparation-batches.ts)和[准备服务](../../apps/api/src/modules/rental-core/category-adoption-preparation.service.ts)。本批补丁与撤回复用原结构校验，按租户/空间及去重ID只读取本批涉及实体的`id/updatedAt`；无实体的原因/能力批次不读取型号/资产。后批保留此前字段与原实体修订，不从今天的资料重基准、不要求无关实体已满足目标必填；已删除实体仍能明确撤回其原准备。能力准备继续复验原实例、执行合同和配置，集合修订/原批次指纹与收据同事务保存，当前经营事实不提前生效。

完整预览和旧整份保存先检查准备容器及发布定义，再在原空间锁内复用最终采用的型号/资产合计10000条和已存属性JSON 16MiB门禁，超限在全量实体读取前拒绝、保留原准备。旧整份不能覆盖版本2集合的原拒绝也前置，不读取经营资料后才通知更换客户端。这些是既有上限的读取顺序调整；累计10000条/2MiB、单批1000条/256KiB、配置领域/总行数及最终候选16MiB限制不变。最终采用仍重读全部当前实体、验证准备后新增/修改、声明与配置并同原绑定/审计/收据提交；本片不改Application、采用事务阶段、Shared/DTO/OpenAPI/Schema或报价算法。

原API配置、受管TypeScript5.9.3最终检查867根/2012源零诊断，只安装上述两份必要emit，六份Shared运行时/Client及原采用应用/事务阶段保护文件哈希未变，见[类型与安装](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-final-compile-20261113.json>)。[当前产物十组限定行为](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-current-behavior-20261113.json>)退出0、audit0：单型号/资产的ID与修订投影、原因独立保存、后批保留陈旧前批且最终采用拒绝、不可暗中重基准、已删来源撤回与原收据、超条数/属性JSON在全读前拒绝、未知结构保留、首等前输入与读取ID一致，以及两批1000+1条累计正常采用、1001条声明和原键重放不新增写。

原`node --no-compilation-cache --require <本树preload> --test --test-concurrency=1 --test-reporter=spec tests/category-preparation-batches.test.cjs tests/category-preparation-batch-service.test.cjs tests/category-adoption-records.test.cjs tests/category-preparation-permission.test.cjs`首次3文件通过、批次服务1文件失败，见[原运行](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-original-tests-20261113.json>)：旧整份覆盖分批集合时先触发新规模查询，旧fixture未登记而遮挡应有的客户端错误。将原拒绝前置后只复验该原文件，[最终批次测试](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-batch-original-final-20261113.json>)退出0、audit0，全部原断言保留。限定调用的[首次失败](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-behavior-20261113.json>)为独立批次回读查询未登记；仅在短调用补其明确SQL替身后复验通过，未改生产收据或测试文件、没有新建/扩写测试脚本。

实现与四份记录/接续已提交为`7cdd6be5c5dd243e9f5c0e3e9b213c016aa7a4b9`，普通推送`codex/rental-core`并[读取GitHub目标分支](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-github-20261113.json>)确认同SHA、上游0/0和工作树干净；未合main或发送对外消息。SQL、Auth行和串行回滚仍为明确fixture；本片未证明MySQL过滤/锁/容量/多实例、完整报价并发、HTTP或宿主，也未取得独立Review。静态核查确认原采用候选合计含配置JSON与实体/兼容结果，原全部写入口/报价和历史经营门槛继续核实。完整CAT-GOV仍0/14、百分比待核实；两个动态编码不同组合的同一冻结构建真实经营及CAT-A01～A22继续原范围。

全部验证已退出、两emit在本树自持产物，唯一暂存只剩零字节audit。原生PowerShell精确删除被CreateProcess自动审批以`blocked by policy`拒绝，整条未执行且无详细理由；安全同卷归入[唯一责任清单](<../../output/.cleanup-pending/rental-core/preparation-bounded-read-validation/manifest.json>)，[退出证据](<../../worktree/rental-core/output/category-governance/preparation-bounded-read-cleanup-20261113.json>)确认原暂存不存在、已归集未删除。旧准备结构空audit本轮重试也被拒绝，原清单已更新；旧批保留创建者清理责任。负责人即时消息规则已取代历史主动回报：本阶段版本、验证和阻塞留本对话及原记录/接续，由PM主动读取，本次没有对外发送消息。

<a id="adoption-preparation-format-20261113"></a>

## 准备结构门禁与原收据保护（2026-11-13）

沿CAT-GOV-08核对准备/采用/恢复。原最终采用把准备JSON当已知结构读取，`formatVersion=999`仍能升级、写一条采用审计及收据；已用原Application/phase/Auth映射与原fixture确认[反例](<../../worktree/rental-core/output/category-governance/adoption-preparation-format-before-20261113.json>)。限定调用只在本fixture记录器补登记原`Tenant LOCK IN SHARE MODE`，不改原用例或生产Auth；SQL/事务仍为明确替身。

本片只改[原批次辅助](../../apps/api/src/modules/rental-core/category-preparation-batches.ts)、[准备服务](../../apps/api/src/modules/rental-core/category-adoption-preparation.service.ts)和[采用事务阶段](../../apps/api/src/modules/rental-core/category-adoption-transaction-phase.ts)。同一容器门禁只识别原无`formatVersion`单份准备及版本2的累计集合；未知版本/字段或非对象明确拒绝，保留原版和准备。预览、实体分页、单份保存/分批保存及最终采用复用该门禁，旧客户端或显式reset不能覆盖未知未来结构。原单份准备采用仍执行1000条/256KiB限制，不能省略版本冒充更大集合；版本2继续沿原10000条/2MiB集合和最终事务门限。

原批次回读及采用收据核对不重新解析今天的准备结构；已成功操作仍按原键、审计、当前权限回读，不重发、不把未知准备当回滚。原升级/恢复权限、目标政策、source/revision、实体/声明和提交机制不变。Shared/DTO/HTTP/Schema未改，不新增业务动作、版本号或测试脚本。

原API TypeScript5.9.3检查867根/2012源零诊断，只安装三个必要emit；Shared运行时/Client、原Application及前片日历两份产物六保护文件哈希未变，见[类型与安装](<../../worktree/rental-core/output/category-governance/adoption-preparation-format-compile-20261113.json>)。当前完整编译产物十组限定行为退出0、audit0：999/字符串2/null/显式1、未知字段拒绝且无写；原单份可采用、超单批旧结构拒绝；两批1001条成功采用并建立声明；预览/分页/两保存未知结构拒绝；已提交原收据在后继准备损坏后仍可读取和重放，见[行为证据](<../../worktree/rental-core/output/category-governance/adoption-preparation-format-behavior-20261113.json>)。SQL/事务/Auth行是原明确替身，不证明真库锁、HTTP或宿主。

原`node --no-compilation-cache --require <本树绝对preload> --test tests/category-preparation-batches.test.cjs tests/category-adoption-records.test.cjs tests/category-preparation-permission.test.cjs`三文件全部通过、退出0、audit0，见[原用例](<../../worktree/rental-core/output/category-governance/adoption-preparation-format-original-tests-20261113.json>)。原采用应用和批次整组的共享父锁夹具失败仍沿历史结果保留，未改断言或把限定调用当整组通过。

全部验证退出，三个必要emit已移入本树在用产物，剩一个空audit。原生PowerShell删除被自动审批`blocked by policy`拒绝，未执行/无详细理由；已同卷归入[唯一责任清单](<../../output/.cleanup-pending/rental-core/adoption-preparation-format-validation/manifest.json>)，原暂存不存在，见[退出](<../../worktree/rental-core/output/category-governance/adoption-preparation-format-cleanup-20261113.json>)。本批及旧批未删除，继续创建者责任。日历main补片`3cbc802d789242a895e9f25046ccdf76e24b2aca`已上传核GitHub并交PM；完整CAT-GOV仍0/14、百分比待核实，08真库/并发及两个动态编码不同组合冻结经营/宿主/独立Review继续原门槛。

<a id="calendar-r0-main-minimal-20261113"></a>

## 日历R0固定main最小闭包（2026-11-13）

PM已核`da3002b2942fa31c6a81631d3f438d8e245d2455`的原合同/验证/GitHub，但该提交相对父版本的两源差异无法直接应用到主版本的仓储268/服务875。按指定固定main `1abf3c6bc7e204b6dd1b1bed1d20ac244982b114`重建仅日历新增合同的[准确补片](<../../worktree/rental-core/output/category-governance/calendar-r0-main-minimal-20261113.patch>)，12969字节，SHA-256 `1551737a6a68a67a9828caeda8fb99ff1b84b858218910789f36a8bfc641f390`；结果与来源见[闭包证据](<../../worktree/rental-core/output/category-governance/calendar-r0-main-minimal-closure-20261113.json>)。本树/主树生产文件未改，父级其他R0、counter、queue及成员来源方法不整取。

最终`rental-business-config.repository.ts` blob为`1c96579b7356432238faf5add50195da75f48869`，`rental-business.service.ts`为`61979bc8504c2d2579ed56dd1ffec7694f0b6ca8`。仓储只加原身份指纹导入、两个来源接口与日历元数据读取/复验；服务只在原`readTenantReadiness`返回附加`calendarSource`。原main已具有所需R0方法、成员计数及可传原client的接点，无其他必要父方法。scope、原九项结果、未采用/缺来源和原发布行语义沿[已冻结合同](#calendar-r0-binding-source-20261113)，AI窄消费归AI-RD。

固定main的1023份原API/正式Shared输入在内存读取，TypeScript5.9.3检查两根/1189源零诊断，见[类型](<../../worktree/rental-core/output/category-governance/calendar-r0-main-minimal-compile-20261113.json>)。对应完整编译两候选加固定main原依赖的十三组来源行为退出0、audit0，见[实际组合行为](<../../worktree/rental-core/output/category-governance/calendar-r0-main-minimal-behavior-20261113.json>)。只在独占临时index应用补片，两个最终blob一致、格式退出0；真实暂存区未动，不用活动main或本树其他服务替代组合。SQL/配置/账号仍为明确替身，不证明真库、HTTP/AI宿主或独立Review。

补片移到唯一交付路径并核哈希后，候选TS/emit/index/audit共6文件/1468005字节已退出。原生PowerShell删除被自动审批`blocked by policy`拒绝，命令未执行、无详细理由；已同卷归入[原唯一责任清单](<../../output/.cleanup-pending/rental-core/calendar-r0-main-minimal-validation/manifest.json>)，原任务暂存不存在、逐文件哈希一致，见[退出结果](<../../worktree/rental-core/output/category-governance/calendar-r0-main-minimal-cleanup-20261113.json>)。其他旧批未删除，继续各清单。本片精确上传批准补片和本专项记录/接续供PM/QA，不夹其他output；原08/两个动态编码不同组合与CAT/CLOSE完整门槛不变。

<a id="calendar-r0-binding-source-20261113"></a>

## 日历R0当前采用来源的窄合同（2026-11-13）

按PM指定的AIN-14/Core接点，只改[业务配置仓储](../../apps/api/src/modules/rental-core/rental-business-config.repository.ts)和[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)。原受权开业读取只按年度统计已发布行数，同年从一个日历版本换到另一个版本时summary/年度集合不变，不能据此证明采用来源未变。本片不改日历发布/采用动作、计价、Schema、Shared出口、Auth/Guard或AI源码；原返回接点先冻结给PM，由AI-RD另行消费。

`readReadinessBusinessFacts.calendarSource`的合同为`rental-calendar-read-source-1`，通过原`readTenantReadiness.calendarSource`及`readTenantReadinessSource.readiness.calendarSource`返回，详见[合同证据](<../../worktree/rental-core/output/category-governance/calendar-r0-binding-contract-20261113.json>)。每个原业务时区请求年度最多读取2个`status=published`的持久行，唯一行才提供`id/year/version/status/revision/publishedAt`；0行明确`not_adopted/binding=null`，2行409冲突，不选最大版本。绑定来自原`rental_business_calendars`当前发布行；其原`publishCalendarVersion`将新行发布/旧行取代放在同一事务，R0不从缓存、summary、默认版号或官方注册表反造采用。

同一行的官方来源ID/版本、来源发布时间和导入时间只提供原存储引用或null；不提供URL、自由原因、发布人、日期明细或金额，不把来源引用当官方注册表验收。缺原发布时点/读取端口503，坏范围/修订/引用或多发布行409；旧显式store没有`calendarSource`时保留字段缺失，不补版1。`sourceHash`使用原`requestFingerprint`绑定协议、tenant/workspace及各年度记录；不含观察时间，同年ID/版本/revision/发布来源变化可核对。原九项开业结果及缺项仍由原渲染逻辑决定。

读取前后核对原ALS完整身份指纹和空间，末次空间查询等待后再次核对；同一个原client末次复读日历元数据，变化拒绝。观察提供开始/结束时间及`independent_persisted_reads`或`caller_transaction_reads`，不新开事务、不新增业务锁，不宣称总开业修订、对象CAS或真实MySQL快照。调用者原事务/锁及所有原写入冲突机制保持。

最终TypeScript5.9.3使用原API配置，867根/2012源零诊断，只安装两个必要emit；Shared/Client及前片地点两份产物六份保护文件哈希不变，见[最终编译/安装](<../../worktree/rental-core/output/category-governance/calendar-r0-binding-final-compile-20261113.json>)。实际仓储及原R0服务十三组限定调用和末次空间查询等待中身份变化各退出0、audit0，见[最终行为](<../../worktree/rental-core/output/category-governance/calendar-r0-binding-final-behavior-20261113.json>)。覆盖同年换版、revision变化、读取中换版、空绑定、重复发布、坏范围/修订、缺发布依据、同原client、官方引用、九项结果和旧store缺来源；SQL/Core配置/账号计数为明确替身，不证明真库或真实权限。

原`node --no-compilation-cache --require <本树绝对preload> --test tests/ai-native-lane-a-diagnostics.test.cjs`十六项全部通过，退出0、audit0，见[原诊断用例](<../../worktree/rental-core/output/category-governance/calendar-r0-binding-original-diagnostics-20261113.json>)。这证明原读取/范围兼容，AI现行schema仍未消费新字段，不能写为AIN-14当前采用来源已端到端接通。没有新增/扩写测试脚本或改原断言。

本批验证已退出，两份emit移入本树在用产物，剩一个空audit。原生PowerShell删除再次被自动审批`blocked by policy`拒绝，命令未执行、无详细理由；已同卷归入[唯一责任清单](<../../output/.cleanup-pending/rental-core/calendar-r0-binding-validation/manifest.json>)，原任务暂存不存在，见[退出结果](<../../worktree/rental-core/output/category-governance/calendar-r0-binding-cleanup-20261113.json>)。本批及旧批未删除，继续原清单留责。地点功能已独立提交/上传`4bc12d3a6971cc43cd6df5c774babe29fb46c7b4`并核GitHub；PM安排QA/集成。本片继续原08、两种动态编码不同组合的冻结经营及真实环境/独立Review门槛，完整0/14与百分比待核实不变。

<a id="location-operator-atomic-save-20261113"></a>

## 地点与名称主体的原子保存（2026-11-13）

支撑CAT-GOV-03/08及新品类履约配置。原[地点保存入口](../../apps/api/src/modules/rental-core/rental-core.service.ts)收到仅有经营主体名称的兼容请求时，先独立写主体、发布缓存，再检查地点能力等字段；已确认地点被拒绝后仍有一条主体写入及新增缓存，见[原反例](<../../worktree/rental-core/output/category-governance/location-operator-atomic-before-20261113.json>)。

本片仅改Core服务与[配置仓储](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)：主体先成为未提交的创建资料，在地点校验、原空间绑定与组织/上级地点范围核对后，随地点在同一ReadCommitted事务落库。任何地点校验/写入失败、采用版本变化均不提交新主体；缓存只在仓储成功后更新。既有主体在持锁后复读启用状态，等待期间停用不沿用旧缓存。服务与仓储在首个等待前复制地点/新主体及期望绑定；缓存按稳定地点ID更新，避免并发刷新替换原对象后误删其他地点。原独立主体保存、身份/空间锁、状态省略保留语义及价格/库存算法继续原实现，Shared/DTO/Controller无新增合同。

TypeScript5.9.3使用本树原API配置，867根/2012源零诊断，只安装两份必要emit，API仍867份JS；Shared运行时/声明、自持Client及原Controller五份保护文件哈希未变，见[编译与安装](<../../worktree/rental-core/output/category-governance/location-operator-atomic-compile-20261113.json>)。首次Node启动因`--no-compilation-cache`不能放在`NODE_OPTIONS`而退出9，未执行编译；已改为原CLI参数并保留[启动失败](<../../worktree/rental-core/output/category-governance/location-operator-atomic-runner-startup-20261113.json>)。

当前TS Core及实际仓储的九组限定调用退出0、audit0，覆盖正常同tx创建、非法地点无写入、地点写失败回滚、采用变版拒绝、持锁后主体停用、组织范围拒绝、等待时原输入修改、并发替换对象后的按ID缓存和仓储请求副本，见[行为证据](<../../worktree/rental-core/output/category-governance/location-operator-atomic-behavior-20261113.json>)。SQL、配置快照和事务回滚为明确替身，未证明真实MySQL、Auth/HTTP或宿主。

原`config-workspace-scope.test.cjs`三个业务组通过；原`rental-fulfillment-admission.test.cjs`九项中4过/5失败，合并runner统计5过/5失败、退出1、audit0，见[原测试结果](<../../worktree/rental-core/output/category-governance/location-operator-atomic-original-tests-20261113.json>)。三项被原共享Tenant父锁的`Unexpected configuration query`阻断，另两项分别把Promise当快照及缺报价库存依据。原文件/断言未修改，没有新增测试脚本，不把限定调用替代整组通过。直接涉及地点锁内主体状态的旧fixture亦须按真实查询合同复核，由PM安排维护范围和QA。

验证全部退出，两份emit已移入本树在用产物，剩余只有一个空audit。定向原生PowerShell删除该明确文件及空目录仍被自动审批以`blocked by policy`拒绝，整条未执行、无详细理由；已同卷归入[唯一责任清单](<../../output/.cleanup-pending/rental-core/location-operator-atomic-validation/manifest.json>)，原暂存不存在，见[退出结果](<../../worktree/rental-core/output/category-governance/location-operator-atomic-cleanup-20261113.json>)。本批及旧批均未删除，等待原生工具恢复后由作者处理。

定价补片的远端来源已单独补齐`f3a3d5fa1b5dc9286d0856dc48826a5c4bdca30a`，只有原批准patch一个文件，Git blob `50e6db127f2953a2a3315b1bdf843cd1d3cd1c76`、10837字节及0faa1642哈希与本地原稿一致，普通推送后GitHub回读一致；`fe89a6920`仅四份文档，不能当补片已上传的证据。PM继续安排QA/main串行整合。原14项/22项完整结项仍0/14，实现百分比待核实；本片未执行迁移、真实环境或生产开放。

<a id="pricing-main-minimal-closure-20261113"></a>

## 定价事务的固定main最小补片（2026-11-13）

按PM指定的主版本闭包要求，基于固定main `2a5c56471abb5714f80715e2cfa0aa236f003f51`交付原定价功能`f4d7fa84eb9045c6c1a31e8c28fa4c84920ac716`的三源必要增量。[准确补片](<../../worktree/rental-core/output/category-governance/pricing-main-minimal-20261113.patch>)为10837字节，SHA-256 `0faa1642efc0cc354a6d05cba86cffbf60db5376f4f30a9cba0a73f98ec0e0a4`；来源、结果blob和核验见[闭包证据](<../../worktree/rental-core/output/category-governance/pricing-main-minimal-closure-20261113.json>)。本树不回main施工，地点/主体两源WIP保留。

| 必要源码 | 固定main应用后的blob |
| --- | --- |
| `rental-core.service.ts` | `5b6bb505e32b00b2cad581ea524c0f271f6740be` |
| `rental-core-config.repository.ts` | `b45cf170692252b3ecadc4aff395fb978826d187` |
| `rental-core.controller.ts` | `75527f286ed28b4fc189b94a4771e00f3d551fb1` |

仓储与Core只读口透传原client，事务视图在缓存发布前返回；分组在该视图核对成员/单位，Controller先完成独立价格上下文，再在原分组/价格事务复验绑定，提交后发布缓存。首个等待前复制请求。固定main原无tx读取、AI/企业接点和价格算法保留，无需整取本树`configurationReadsByWorkspace`或`missingCommittedProfiles`父字段。三个候选只在上述方法及仓储接口改动；未改区域保留原行尾，规范换行后与已验证候选逐字节一致。

TypeScript5.9.3在固定main的1019份源码输入和正式Shared下检查三根/1224源，零诊断，见[类型与必要emit](<../../worktree/rental-core/output/category-governance/pricing-main-minimal-compile-20261113.json>)。对应编译候选及固定main原调用依赖的七组入口模拟退出0、audit0，覆盖正常同tx、价格失败回滚、后继采用拒绝、事务读不发布缓存、缺实际设置拒绝、实际仓储复用client和等待时修改原输入，见[原入口行为](<../../worktree/rental-core/output/category-governance/pricing-main-minimal-runtime-20261113.json>)。保留原行尾后的补片在独占临时index准确应用，三个结果blob一致、格式退出0，真实工作区/暂存区和两源WIP未受影响。SQL、价格写入、身份和事务仍为明确替身；不证明真实MySQL锁、完整定价算法、HTTP/DI或宿主。

原七项配置读取夹具已单独固定并普通推送`3037d919d146bfd6981762eb7ed25eefb01e3922`，GitHub回读一致，证据沿[独立测试阶段](#context-refresh-fixture-contract-20261113)。该单测试与本生产补片分别交PM/QA复验，未降低CAT-GOV/CLOSE原完整门槛。

补片及最小证据已固化，三份候选/三份emit、临时index和空audit共8文件/1459496字节均已退出。原生PowerShell删除再次被CreateProcess自动审批以`blocked by policy`拒绝，整条命令未执行、无详细理由；这8文件已安全同卷移入[唯一责任清单](<../../output/.cleanup-pending/rental-core/pricing-main-minimal-validation/manifest.json>)，原任务暂存不存在、逐文件哈希一致，见[退出结果](<../../worktree/rental-core/output/category-governance/pricing-main-minimal-cleanup-20261113.json>)。旧七批残留也未删除，继续原清单；没有换壳/工具绕过拒绝。完整结项仍0/14，实现百分比待核实，真实环境与独立Review尚缺。

<a id="context-refresh-fixture-contract-20261113"></a>

## 原配置读取七项的本地夹具合同（2026-11-13）

按PM指定的原测试维护范围，仅修改[原context-refresh测试](../../tests/category-adoption-context-refresh.test.cjs)的本地`fixture`，保留七项用例正文及全部原断言。原`category-workspace-auth`共用夹具继续核验其Auth独占锁，本地fixture单独登记`SELECT id FROM Tenant WHERE id=? LOCK IN SHARE MODE`并核对原tenant参数。原生产锁、Auth、Guard及采用实现仍按固定源码执行。

补齐共享父锁后六项通过，最后AI消费项进入Core原R0读口，暴露本地数据库替身缺少有界档案/设置、地点/券和型号属性查询。该fixture仅从原`f.state`的同空间配置与型号行提供这些投影，分别核对tenant/workspace、请求型号和32768/101两个原读取界限；提供本fixture明确的配置时点/编辑人。其Core实例注入原`RentalCategoryResolver`以提供真实版本行的ID/采用修订，未注入时R0只读返回无绑定标记，不能据此要求`v1/v2`事实成立。

最终原七项全部通过、退出0、audit0，blob为`f8430a52167aa7b95a9187b12b1a2c60b932554d`，见[最终原用例](<../../worktree/rental-core/output/category-governance/context-refresh-fixture-resolver-20261113.json>)。实际命令为`node --no-compilation-cache --require D:/工作文件/rental-OS/worktree/rental-core/tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/category-adoption-context-refresh.test.cjs`。原7项全失败的[前片结果](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-original-tests-20261113.json>)、补父锁后6/7的[阶段](<../../worktree/rental-core/output/category-governance/context-refresh-tenant-fixture-20261113.json>)、R0额外参数/投影缺口与缺解析器标记的[后续失败](<../../worktree/rental-core/output/category-governance/context-refresh-fixture-verified-20261113.json>)均保留。

七项原用例正文经AST提取并按规范换行逐字节核对一致，新增9处链接、4处片段及该单测试/现行文档格式检查退出0。验证使用当前本树固定f4d编译产物，数据库、范围和路由为原明确替身。该结果证明原场景在完整夹具合同下执行，不证明真实MySQL锁/多实例或Guard接受。没有改生产源码迁就用例、删除断言或新建测试文件。当前原单一任务目录同时承载仍用于定价main补片的六份候选/emit和空audit，原环境/缓存与退出清理约束继续执行。

本树另两份地点/主体原子保存源码为独立WIP，已确认旧路径在地点拒绝后仍写主体及缓存，尚未完成其类型/行为收口。本阶段仅固定本测试与记录/接续，定价生产补片继续独立；其固定main三源类型3根/1224源零诊断、原入口七组模拟已有结果。原CAT-GOV-01～14、两个动态编码不同组合的冻结经营及真实数据库/宿主/独立Review仍未结项，0/14和实现百分比待核实。

<a id="pricing-group-original-transaction-20261113"></a>

## 定价分组与基本价的原事务读取（2026-11-13）

支撑CAT-GOV-03/08及动态品类建档/定价正常入口。本片仅修改[Core服务](../../apps/api/src/modules/rental-core/rental-core.service.ts)、[配置仓储](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)和[原Controller](../../apps/api/src/modules/rental-core/rental-core.controller.ts)。原`POST pricing-groups`在创建分组的外层事务中独立读配置，写分组取得空间互斥后又调用独立Core/业务上下文读取，形成等待自身空间锁的路径。限定实际入口证明外层事务内存在独立读取dispatch，真实MySQL等待尚未执行，见[已确认调用路径](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-confirmed-20261113.json>)。首次限定夹具缺初始化空间的[失败](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-before-20261112.json>)发生在该读取前。

`loadWorkspaceSnapshot`与`readBusinessContext`可透传服务器原client，继续沿原空间绑定锁、同空间型号/组成/定价成员及实际档案/设置读取。原tx路径直接读取其事务视图，绕过可能等待该写锁的独立读队列，并返回分离的上下文，不写共享缓存、缺档案标记或样本。普通无tx读取保留原串行发布路径。

定价分组在原tx内按该视图核对成员、默认单位、版本和绑定；Controller在取得写锁前完成独立价格上下文读取，原分组与价格写入继续同client复验绑定，并在ReadCommitted事务提交后发布缓存。价格失败或前置上下文与后继采用版本不同均回滚分组。Controller在首个等待前复制分组和基本价请求，调用方后继修改不改变这次输入，价格与库存算法沿原实现。

当前API原配置的TypeScript5.9.3检查867个根/2012个源、零诊断，只安装三份必要emit，本树API仍867份JS，Shared运行时/声明及自持Client四份保护文件哈希一致，见[原三份编译及安装](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-compile-20261113.json>)。最后请求捕获调整后再次检查退出0、零诊断，只更新Controller，SHA-256为`53847404ad7b36bd23b042c23b097686d907c654d0327967802ee0cbe1906015`，见[最终编译](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-final-compile-20261113.json>)。

最终当前编译产物7组限定调用退出0、audit0，覆盖正常分组/基本价同tx、价格失败回滚、采用变版拒绝、原tx绕过独立队列且不发布、缺实际设置拒绝、实际仓储复用原client及等待期间原请求修改，见[最终原入口行为](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-final-runtime-20261113.json>)。首轮六组SQL记录器未识别原`Tenant LOCK IN SHARE MODE`的[失败](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-after-20261113.json>)和补正该明确替身后的[六组结果](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-after-final-20261113.json>)保留。SQL、价格写入、身份和事务回滚为明确替身，未证明真实锁/并发或完整定价算法。

原`category-adoption-context-refresh.test.cjs`7项0过/7失败、退出1，仍因`category-workspace-auth.cjs`只登记`FOR UPDATE`而拒绝原Tenant共享父锁，原文件及断言保留。另一次误用不存在的`rental-config-scope.test.cjs`未执行用例，均见[原脚本结果](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-original-tests-20261113.json>)。正确原`config-workspace-scope.test.cjs`3项全部通过、退出0、audit0，见[空间范围复验](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-original-scope-20261113.json>)。`rental-price-version.test.cjs`会读取环境及连接专用库，其实际价格版本/并发门槛仍须环境授权。

四份记录/接续新增21处链接、7处片段及三组源/emit哈希已核对，源码和现行文档`git diff --check`退出0。验证均使用本树绝对preload、不可用DB地址和原单一临时目录，Node/独立V8缓存关闭，没有新增测试脚本或扩写原断言。两次空audit删除被自动审批以`blocked by policy`拒绝，原因未细化；已同卷归入[同一任务责任清单](<../../output/.cleanup-pending/rental-core/pricing-group-transaction-validation/manifest.json>)，共2文件/0字节，原任务目录不存在，见[最终退出](<../../worktree/rental-core/output/category-governance/pricing-group-transaction-final-cleanup-20261113.json>)。原治理父补片`654a5e35cb010aa15bd164db127b00a1f12835e3`已推送并交PM，等待QA；当前03/08、动态组合、原真库/多实例/宿主与独立Review门槛仍未齐，完整结项0/14，实现百分比待核实。

<a id="extension-services-fixture-guarantee-sources-20261112"></a>

## 续租服务原夹具与保证金来源核查（2026-11-12）

从本树及GitHub均已核实的`48e1b68075dda80743a0abb082d2c41ec83d0671`接续。PM明确授权仅修[原续租服务测试](../../tests/rental-extension-services.test.cjs)的必要夹具与空快照断言。夹具等待`readBusinessContext`，使用原API TypeScript配置及源码优先，并在本测试的吸收式store提供同租户、同空间、精确型号分页。新续租确认没有新增服务时断言`[]`；历史订单及旧续租缺失快照仍断言`undefined`，12个原行为组均保留。

原失败分别发生在夹具的`defaultUnit`和库存分页缺口，均为0个行为组执行，见[原同步上下文失败](<../../worktree/rental-core/output/category-governance/extension-services-fixture-before-20261112.json>)及[库存读口失败](<../../worktree/rental-core/output/category-governance/extension-services-fixture-context-20261112.json>)。上一回合[原12项通过结果](<../../worktree/rental-core/output/category-governance/extension-services-fixture-catalog-20261112.json>)已回读确认。本次首次命令的preload相对路径解析错误，Node在加载守卫和执行用例前退出，见[命令加载失败](<../../worktree/rental-core/output/category-governance/extension-services-fixture-resumed-20261112.json>)。改用本树守卫绝对路径后，当前TypeScript源码的12项原用例全部通过、退出0、audit0，见[恢复复验](<../../worktree/rental-core/output/category-governance/extension-services-fixture-resumed-final-20261112.json>)。

实际命令为`node --no-compilation-cache --require D:/工作文件/rental-OS/worktree/rental-core/tests/fixtures/ai-native/prisma-offline-preload.cjs tests/rental-extension-services.test.cjs`，固定不可用DB地址，audit/TEMP/cache集中于原任务目录，同时设置`NODE_DISABLE_COMPILE_CACHE=1`和`DISABLE_V8_COMPILE_CACHE=1`。原覆盖包括容量不足、两次服务独立发生、重复生效去重、历史缺失、待补款和生效时容量占用。存储、容量及Controller参加者为原明确替身，真实权限、数据库事务、多实例及宿主证据仍缺。

保证金按[ECP-R08](../企业客户后台/企业客户后台-需求.md#ecp-r08员工租赁与原core接通)、CLOSE-GUARANTEE及CLOSE-MONEY-VERIFY核对。`RentalFundingEvent`保存instrument、金额、provider、方式和原键，企业/员工实际出资人、预授权人、合同依据及原供应商授权引用尚无完整保证金合同。`recordOfflineDepositDisposition`已绑定本订单原线下实收事件、同空间有效凭证、原收款方式、可处置额度和原幂等收据；企业租赁付款主体及政策中的`guaranteePayer`不能证明该笔保证金的实际来源。

原`PaymentRuntimeService.createPaymentIntent`和已核外部资金登记仅承接租金/费用。原批准换货核验要求`additionalAmount > 0`且两种保证金增量均为0，纯押金、纯预授权、租金加押金三个输入均被拒绝，仅租金对照继续进入本人确认门禁，四组均无写入、退出0、audit0，见[原资金门禁调用](<../../worktree/rental-core/output/category-governance/exchange-guarantee-source-review-20261112.json>)。该调用的TS blob `88b2bf8d68036b09b924b5137ed31e2b0232d3dd`与当前源码及c24构建源码一致，当前授权JS的SHA-256与原构建清单一致。订单、批准、政策和SQL为明确替身。

下一最小合同由Core/资金负责原事件及供应商引用、实际付款/授权人、金额/币种、合同/裁定、原路径退款或释放、额度及原键失应答恢复；企业域负责合同承担和本人确认、审批消费，Shared/Schema及宿主装配由PM协调唯一作者。真实可信来源、原合同及专用环境证据缺失时，企业保证金变化执行和财务保证金投影继续不可用。原ResourcePorts/临近政策/开业counter及参加者依赖仍由PM协调，当前履约保持原未捕获语义。

四份记录/接续的新增本地链接和片段已定向核对，原12组及两类快照断言检查通过，`git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check`退出0，见[阶段校验](<../../worktree/rental-core/output/category-governance/extension-services-stage-docs-20261112.json>)。

验证已退出。自动审批以`blocked by policy`拒绝包含清理的组合命令及原生PowerShell删除空缓存目录，未提供具体理由。首次加载失败产生一个空Node缓存目录；复验没有新增缓存。一个空audit及该空目录已同卷移入[唯一责任清单](<../../output/.cleanup-pending/rental-core/extension-services-fixture-validation/manifest.json>)，原任务暂存不存在，状态为已归集、未删除。旧任务残留分别沿原清单维护。CAT-GOV原08、同一冻结构建两个动态编码不同组合、真实DB/多实例、浏览器/微信及独立Review仍未收口，完整结项0/14、实现百分比待核实。

<a id="governance-input-detached-20261112"></a>

## 品类治理原输入与创建收据一致性（2026-11-12）

从已推送并核GitHub的`0475af5c547df6d0bf4c7f3139e3fa955f2a2dbb`接续，仅修改[治理服务](../../apps/api/src/modules/rental-core/category-governance.service.ts)的请求副本和文件头，支撑CAT-GOV-05及CAT-A03/A04/A05。原反例在实际编译服务及原创建fixture中确认：首次权限读取等待时修改调用方原键与原因，创建成功却写到后改键下，原键返回unknown，审计原因变为后改值、请求哈希仍指向原输入，见[已确认反例](<../../worktree/rental-core/output/category-governance/governance-input-capture-confirmed-20261112.json>)。此前Shared替身缺权限导出的[首次失败](<../../worktree/rental-core/output/category-governance/governance-input-capture-before-20261112.json>)及本片fixture提取未处理CRLF的[加载失败](<../../worktree/rental-core/output/category-governance/governance-input-capture-reproduction-20261112.json>)均发生在场景执行前，不作为反例成立证据；原fixture文件和断言未改。

创建预览、正式创建、复制草稿、页签补丁、发布、归档、开通政策及版本采用政策共八入口，在首次等待前复制请求；原键/指纹、来源、修订、原因、嵌套字段和租户数组从同一次副本读取。调用方仍可继续编辑自己的对象，服务不回写或冻结其后继输入。原Auth/权限前后复验、Serializable/锁序、P2002原收据恢复、不可变发布、页签归属、正文大小及生产关闭保持；Shared、DTO/OpenAPI、Controller、共同装配及其他源码不改。

原Shared/API配置TypeScript5.9.3检查零诊断（101个Shared根、867个API根/2012个源），仅内存emit并安装本树治理JS，SHA-256为`43268a570e0ed1f5f40acfadc282eb191e9841fc4e0963b056aaf262ed07df23`；Shared运行时及前片分配/两AI产物五份保护文件未变，见[编译/安装证据](<../../worktree/rental-core/output/category-governance/governance-input-capture-compile-20261112.json>)。实际编译服务复用原创建fixture，八入口、原创建/发布回读、同键改内容及当前撤权共10组限定调用退出0，见[最终行为证据](<../../worktree/rental-core/output/category-governance/governance-input-capture-final-20261112.json>)。SQL、Auth/权限和ORM为明确替身，未证明HTTP、真实数据库/并发事务或宿主，不把复制输入等同永久授权。

原`category-governance.test.cjs`退出0；原`category-creation.test.cjs`六项3通过/3失败、退出1：两项缺原身份复核接点，复制来源项缺结构版本。当前失败原样保留，不补恒真生产Auth、不删除断言或将限定调用替代整组，见[原脚本结果](<../../worktree/rental-core/output/category-governance/governance-input-capture-original-tests-20261112.json>)。实际命令均使用`node --no-compilation-cache --require tests/fixtures/ai-native/prisma-offline-preload.cjs`，源码/命令/退出码均在上述最小证据，审计为空、未新增或扩写测试脚本。

本次验证已退出，Node及独立V8缓存均禁用，没有新增缓存/环境，仅一个空audit。原生PowerShell删除再次被自动审批以`blocked by policy`拒绝，命令未执行、无详细理由；该文件同卷归入原治理待清理任务的`confirmed/`，原暂存不存在。该任务连同旧首次失败audit共2文件/0字节，已归集未删除，责任只在[原唯一清单](<../../output/.cleanup-pending/rental-core/governance-input-capture-validation/manifest.json>)，状态见[退出证据](<../../worktree/rental-core/output/category-governance/governance-input-capture-exit-cleanup-20261112.json>)。其他原残留保持，工具恢复后由创建者清理。

前片履约结构化来源固定`0475af5c5`，正式ResourcePorts/临近政策/宿主及开业counter/写入参加者仍需原作者闭合，默认履约not_captured。原08、同一冻结构建两个动态编码不同组合经营、真库/多实例、浏览器/微信及独立Review继续按原门槛；完整结项仍0/14。本片不改变需求、任务、实现百分比或生产开放。

<a id="fulfillment-issue-transaction-participant-20261112"></a>

## 履约结构化来源与原事务参加者（2026-11-12）

从已推送并回读的`16401c422419aa2e0368b914ecb4a4135a0788d8`接续，按PM核准的窄窗口修改[Shared原分配状态](../../packages/shared/src/core.ts)及[Core分配服务](../../apps/api/src/modules/rental-core/rental-allocation.service.ts)，支撑AIN-17的必要Core来源。原扫描、库存与分配算法、自由异常文本、状态机和调度顺序保持；未改其他Shared定义、总出口、AppModule、DTO/OpenAPI、Schema或迁移，不混算CAT-GOV/CLOSE进度。

`assignment.issueSource`是服务器记录的可选只读来源，版本为`rental-fulfillment-issue-1`。原扫描分别记录配置不可用、已分配资源不可用、数量不足或未配齐；保留全部原文本，混合问题依此顺序选择保守的主要原因。原数量检查把缺库存行作为零生成提示，但结构化来源只有真实、有限非负的库存及预占数量才能记为`resource_shortage`，缺源标为`configuration_unavailable`。文本相同但来源变化仍推进原assignment修订；问题恢复、分配动作和办理锁修订清除旧来源。部分取消原有对象重建也不携带旧来源。

原事务内`readRecordedFulfillmentIssue`继续保留`issue_recorded`兼容合同，仅有效版本/原因且存在正数活动分配时提供结构化来源与范围、修订、时点、地点和状态绑定的哈希。历史只有文本、坏版本、额外字段或无活动分配均不授予可信来源；此口不重新扫描、取资源锁或开启事务，也不把提示解释成当前可交付事实。

原聚合写后、提交前调用可选`BusinessFailureOutboxParticipant.fulfillment`，透传同一个原tx和ALS租户/空间。未变化的扫描也可参加原事务，原事件去重由参加者承担；缺参加者直接维持原业务，参加者失败及`result_unknown`向原事务传播，不换键重发或吞异常。仅接入AI固定`b690e4f3751bcaa1beac30cde88b55ea596ec1de`的[参加者](../../apps/api/src/modules/ai-native/business-events/prisma-business-failure-outbox.ts)，blob `10f1d833f98f4e048889ab1c053efc5b349a8ace`，及[scoped存储](../../apps/api/src/modules/ai-native/business-events/prisma-business-failure-resource-store.ts)，blob `1a06a119dd798d1dfa8b43beeb826ff2e5a63f40`；两文件不改原AI算法。

原Shared/API配置的TypeScript5.9.3最终检查零诊断：101个Shared根、867个API根/2012个源。Shared仅更新`core.d.ts`，`core.js`运行时逐字节不变；四份必要emit已安装，本树API现867份JS，Shared仍202文件，其他产物沿c24及原两份输入捕获来源。最终分配JS的SHA-256为`9cbf865230ba88cae7a435d9a579f474b31b52d80680a3388dfad8ae4ca66aad`。首轮四emit及来源在[原编译证据](<../../worktree/rental-core/output/category-governance/fulfillment-source-compile-20261112.json>)，最终类型、分配emit/来源及实际三份保护文件在[最终编译证据](<../../worktree/rental-core/output/category-governance/fulfillment-source-final-compile-20261112.json>)，未重建整套依赖、Client或完整API目录。

原`node --no-compilation-cache --require tests/fixtures/ai-native/prisma-offline-preload.cjs tests/rental-allocation.test.cjs`的14个断言通过，退出0，见[原分配结果](<../../worktree/rental-core/output/category-governance/fulfillment-source-original-allocation-20261112.json>)。首轮实际编译服务的四种原因、混合文本、来源变化/恢复、旧文本未知和同tx失败传播7组退出0，见[原行为证据](<../../worktree/rental-core/output/category-governance/fulfillment-source-behavior-20261112.json>)。最终实际编译Core与固定AI参加者的8组限定调用退出0，覆盖原tx、重复引用原事件、缺政策及可履约观察零捕获、缺库存/无活动分配不授源、append丢收据和来源变化回滚，见[参加者证据](<../../worktree/rental-core/output/category-governance/fulfillment-source-participant-20261112.json>)。审计均为空；候选、DB/Auth、政策、ResourcePorts和回滚为明确替身，scoped存储的真实SQL/约束、权限与事务未运行。未新增或扩写测试脚本、修改原断言。

**直接依赖仍未闭合：**正式ResourcePorts的数据源/宿主装配和已发布临近政策尚缺；当前默认DI构造没有这些资源口，履约保持`not_captured/source_unavailable`，不能以分配偏好代替政策。开业原九项已有同client读取，仍须实际配置行counter及各原写入点参加者闭合，不能把九项合成总修订或把同client当真库快照。真实捕获、消费者、DB/多实例、浏览器/微信及独立Review均未取得本片证据，生产开关和原08、两个动态编码不同组合经营及0/14完整结项不变。

本次验证已退出；原生PowerShell递归及逐文件删除均被CreateProcess自动审批以`blocked by policy`拒绝，命令没有执行、未提供具体理由。原三个新退出文件共2,547,452字节已安全同卷归入原待清理任务的`participant/`，文件哈希一致，原`output/.tmp/rental-core-validation`不存在。该任务连同原残留共8文件、5,096,112字节，**已归集、未删除**；责任只维护[原唯一清单](<../../output/.cleanup-pending/rental-core/fulfillment-source-validation/manifest.json>)，本次状态见[退出证据](<../../worktree/rental-core/output/category-governance/fulfillment-source-exit-cleanup-20261112.json>)。原c24、采用输入及治理首次加载残留仍分别保留原清单；删除工具恢复后由创建者处理。原ts-node使用独立的`v8-compile-cache-lib`，后续必要短调用同时禁用其缓存，避免只关闭Node自身编译缓存仍产生退出文件。

<a id="adoption-input-capture-20261112"></a>

## 采用与准备的原输入、审计及恢复一致性（2026-11-12）

支撑CAT-GOV-08及CAT-A08/A17，未改变原任务或CLOSE门槛。从已推送核远端的`c14d1c6c86fb5aace414783577d0c7e150275ad7`接续，仅改[采用应用](../../apps/api/src/modules/rental-core/category-adoption.application.ts)和[准备服务](../../apps/api/src/modules/rental-core/category-adoption-preparation.service.ts)。原采用先为收据复制输入，却在等Auth/数据库后继续读取调用方对象；限定复现中，调用方在首个Tenant锁处改原因，采用返回adopted、审计写新原因、收据保留旧原因，原键回读因此503。原始[复现证据](<../../worktree/rental-core/output/category-governance/adoption-input-capture-reproduction-20261112.json>)保留；[首次调用](<../../worktree/rental-core/output/category-governance/adoption-input-capture-before-20261112.json>)在原夹具范围内未完成，重新声明原Tenant共享父锁查询后才取得上述复现，首次结果不当作缺陷证据。

正式采用、分批准备及兼容整份准备现在在第一次等待前复制请求，后续执行、原因、期望修订、原键/指纹、嵌套补丁和撤回均使用同一次副本；分批复制在原大小/条数检查后进行。调用方的新输入仍保留，服务不回写或自动采用新输入，不改变原Auth/Guard/ALS复验、事务、政策、幂等/原收据算法或生产关闭条件。直接消费者仍为原准备Controller的保存/批次/采用入口和后台原准备流程，Shared、DTO/OpenAPI与共同装配没有变更。

原API配置/受管TypeScript5.9.3全程序诊断0（866根、2011源），只对两份变更源码用原编译选项emit，未复制依赖或另建完整构建目录。原采用fixture的6组限定实际服务调用退出0、audit0：等待时改原因/原键、来源/准备/政策修订与操作、分批嵌套补丁/撤回、旧整份保存、当前撤权及收据写失败回滚；原键回读/原输入重放无新增写，同键改内容仍拒绝。仅声明原Tenant共享父锁查询，其余Auth映射/业务仓储仍用既有明确替身；这不是真实SQL、Controller/Guard、并发事务或宿主证据，没有新增/扩写测试脚本或修改旧断言。

两份JS已安装到本树自持API，866文件全部hash一致，另外864份沿c24固定构建、4份Shared/Client保护未变。源码、原命令、6组结果、两份emit/hash及安装来源唯一见[最终证据](<../../worktree/rental-core/output/category-governance/adoption-input-capture-final-20261112.json>)。四份记录/接续新增10处本地链接、4处片段均存在，唯一跨树责任清单保留原跨树分类，格式检查退出0。原任务暂存路径不存在；本次3份空审计及1份1385字节中间结果已归集，未删除，责任只见[同一待清理清单](<../../output/.cleanup-pending/rental-core/adoption-input-capture-validation/manifest.json>)。原c24构建的862文件待清理事项仍见下节，不重复保全。完整结项仍0/14；真实采用/恢复、多实例、两动态组合经营及独立Review继续按原门槛，下一独占入口仍为原08及历史保护，assignment.issueSource/AI参加者合同由PM核准后接入。

<a id="api-current-build-cleanup-20261112"></a>

## 当前固定源码的API构建与退出残留（2026-11-12）

从已推送并回读GitHub的`c24fd4e848565af87e751046911aedb25f5d7bf1`完整离线编译本树API，本阶段未改业务源码、Schema或Client。原`tsc -p apps/api/tsconfig.json --outDir <任务暂存>/api --sourceMap false --incremental false --pretty false`退出0，preload审计0；866份JS逐文件核对，9份差异已安装到本树自持`apps/api/dist`，4份Shared/Client保护文件hash不变。完整来源、命令与产物hash唯一见[构建清单](<../../worktree/rental-core/output/category-governance/api-build-c24fd4e84.manifest.json>)。这次没有重跑业务用例，不把编译或包更新记作CAT-GOV/CLOSE验收。

构建及hash核对进程已退出，独占暂存含862文件、12,140,642字节，未含reparse point。原生PowerShell递归删除再次被CreateProcess自动审批以`blocked by policy`拒绝，命令未执行、未给具体理由；没有换壳或改用其他删除工具。按根规则将原目录安全移动到主仓库唯一`output/.cleanup-pending/rental-core/rental-core-validation/residue`，复核文件数/体积不变、无链接且原`output/.tmp/rental-core-validation`不存在。归属、原/现路径、拒绝原因及恢复条件只维护[待清理责任清单](<../../output/.cleanup-pending/rental-core/rental-core-validation/manifest.json>)，没有复制第二套构建环境。**已归集，未删除**；工具恢复后由本对话继续清理，不宣称退出产物全部收尾。

本树当前包已包含原九项同client、单目标资料及商户委托封存补片；此前864份包的证据继续作为原阶段记录，不作为当前包版本。原四入口Outbox参加者、真实配置counter闭环、结构化`resource_shortage`来源及`assignment.issueSource`窗口仍未齐；后者由PM核准后才施工，不从自由issue文本推断短缺。原08采用/恢复、两动态编码不同组合经营、真库/多实例、浏览器/微信和独立Review门槛保持，完整结项仍0/14。阶段与依赖仅向PM一次必要回报，不抄送其他专项。

四份记录/接续的新增导航用原生PowerShell定向核对：7处新增本地链接、5处片段均存在，唯一跨树待清理清单保留跨树分类并核明实际位置；没有放松原检查器或复制证据。`git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check`退出0。本片仅文档和证据收口，不运行应用、业务测试或真实环境。

<a id="opening-original-transaction-20261112"></a>

## 开业配置来源的原事务读取（2026-11-12）

从已核GitHub的`89261ed60993e41c0595519c6bb0dd6e46fb2835`接续，按AIN-17既有Core来源窗口只改[配置仓储](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)和[Core读取](../../apps/api/src/modules/rental-core/rental-core.service.ts)。`readOpeningConfiguration`及`readOpeningConfigurationFacts`追加可选服务器原事务参数：当前范围、配置元数据、分页/计数和品类绑定前后读取均复用该client，不逃出根连接；未传参数仍沿原独立观察语义。

调用方仍负责原Tenant/空间锁序和当前授权，读取不新建事务、追加锁、初始化缓存、扫描经营或捕获事件。实际profile行的`configurationSource/configurationRevision`及原设置行`settingsRevision`保留，缺失/坏结构不补1；这不是九项开业事实的总修订，也不凭同client宣称全部事实已形成真实同事务快照。

API原noEmit退出0。复用原`ai-native-ain08-opening-configuration.test.cjs`fixture，只明确给出当前合成元数据行的真实数值修订/来源，限定实际Core/仓储调用退出0：默认TenantRentalProfile与非默认RentalCoreStateSnapshot两来源透传、Root连接禁止下全部查询/绑定读使用原tx、无新事务/缓存、原归一化与未传tx读取、101哨兵、跨范围/缺失或坏修订及后继绑定拒绝。Source行、SQL/Auth/锁/关系均为fixture；原整组缺新增修订字段及旧读取次数失败仍在[原行修订阶段](<Rental Core-开发记录.md#configuration-row-revision-core-source-20261112>)保留，未改测试或用当前默认补历史。命令/源码hash/结果唯一见[原事务证据](<../../worktree/rental-core/output/category-governance/opening-original-transaction-20261112.json>)，audit0、退出暂存已删除，未生成新包。

企业guard仍在原作者树验证，尚未给Core固定提交，不读取或整合其活动WIP；Core封存892已交企业/PM，QA及正式guard/HTTP/DI/真库/宿主待组合。下一独占入口为AIN-17业务/会员九项来源的原client、真实配置行counter/相关变更及资源短缺参加者；缺正式临近政策/当前权限保持not_captured，原CAT-GOV/CLOSE与0/14门槛不变。

<a id="business-config-original-transaction-20261112"></a>

## 业务配置补落的完整原事务（2026-11-12）

从已核GitHub的`6390f89a9d38b499ca8d43a3b38dccef0641e13c`接续，固定源码`045ff2114b1a25943419b88dd153e7d94685fd18`已普通推送核远端；按PM的AIN-17 Core窗口只改[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)和[业务配置仓储](../../apps/api/src/modules/rental-core/rental-business-config.repository.ts)。`persistBusinessConfig`把基础价格及初始价格版本、优惠、服务及版本、日历、规则、通知模板六类补落纳入同一ReadCommitted事务，先持原Tenant/空间品类锁；新增事务参数沿原方法追加，范围读取也使用同一client，不从根连接逃出。直接消费者仍为`persistScope`和首次报价的原配置补落；普通发布/资金/客户入口及Shared/DI未改，不声明已接入Outbox。

等锁前固定六类配置并拒绝其他商户行。保存期间输入变化在提交前拒绝并回滚，新的输入保留；提交应答期间又变化，则明确保存后冲突，保留已提交事实及新输入，调用方不把它标作已保存，也不假称事务回滚。`configPersisted`仍仅在完整返回后设置，初始价格不单独成为可见前缀，原报价/金额算法与历史版本保护不变。

API原noEmit与最终完整emit退出0；原`config-workspace-scope.test.cjs`3项退出0。原日历脚本源码装配只补合成Tenant父锁叶子，其全部修订/审计/发布范围原断言退出0；未改测试文件。原续租配置fixture的实际服务/六类仓储限定调用退出0：同一tx、末段失败/提交前输入变化回滚及标记未完成、提交后变化保留已提交事实/新输入、初始价格版本同提交、重复persist不重初始化、原报价不变。首次数据库替身不能克隆Prisma.Decimal的失败保留，改为原JSON表达后只复验相关调用；SQL/锁/授权/回滚仍为替身，不当作真库证据。

当前864份自持API完整编译并逐文件核对，累计更新业务配置/业务服务及此前R08 Core/快照共4份，Shared/Client四项保护hash未变。最终提交后复核补入业务服务，其他863文件保持；命令、源码/文件hash、失败及清理状态唯一见[阶段证据](<../../worktree/rental-core/output/category-governance/business-config-original-transaction-20261112.json>)。最终864份退出文件/缓存及40个目录、其余本片退出暂存已删除。原真库价格版本入口读取环境/连接专用库，未获许可未执行；原0/14完整结项及CLOSE门槛不变，真实配置行counter/开业分区、资源短缺和四入口参加者仍未齐。

PM新增的下一Core独占窗口为[订单确认服务](../../apps/api/src/modules/rental-core/rental-order-confirmation.service.ts)与一份Core sealed商户委托authority/端口，必要时仅扩[原参加者合同](../../apps/api/src/modules/rental-core/approved-order-transaction.ports.ts)的服务端字段；公共AppModule/shared-index/OpenAPI、商户Controller/admin由企业作者负责。依据固定企业源`7179bafb0f6fea09e1832ea75ddf2a0a610c28f6`及恢复补片`a130e89fb6c54ff4789a57830b2a028ffa41f7d0`，当前只读核准入口，不继承整个父提交或改企业政策。企业另获准固定私有`readMerchantDelegatedSubmission(actorAuth, reference)`补片，Core等待其固定来源后消费原descriptor/state/状态修订，不以公开view补request，不另建公共Core源合同。下一片保持operator Auth/Guard/ALS、不可变个人使用人、D/K/原quote/签发修订/指纹及同一参加者；执行严格issued/签发修订/期限，原结果用私有read与recover/replay，consumed状态修订和自然TTL不触发新准备，源/批准/订单/Core收据同事务。完成后再继续AIN-17/CAT-GOV，不扩常设或私人保证金委托。

<a id="snapshot-original-transaction-20261112"></a>

## Core快照的原事务复用与固定输入（2026-11-12）

按PM核准的AIN-17四入口顺序，从已核GitHub的`5d6c6dffdfaf11b0bc6d759ab87ae983d31edd0c`接续，源码固定`6390f89a9d38b499ca8d43a3b38dccef0641e13c`并已普通推送核远端；仅改[快照仓储](../../apps/api/src/modules/rental-core/rental-state.repository.ts)。`saveCoreState`允许服务端调用者传入原事务，绑定锁、快照读取及原行CAS在该事务执行，不另开事务/自行提交；未传事务时仍由仓储拥有原ReadCommitted事务。原CoreService恢复备份调用保持，正式宿主尚未消费新增事务参数，不声明四入口参加者已接通。

在第一次等待数据库前固定JSON快照；绑定依据、新建行内容与替换SQL使用同一次输入。修复原新建分支在等锁后再次序列化活缓存、可能混入后继改动的问题；明确档案保留、合法修订范围、无变化不写和饱和拒绝仍沿原CAS，不改Schema/Client或历史事实。

当前API原noEmit退出0。复用原采用fixture的数据库行和回滚装配，限定实际仓储调用退出0：原事务不嵌套、独立调用只开一次、等待时修改原输入不污染新建快照、无变化不写、外空间/饱和/陈旧绑定及坏快照拒绝、原所有者回滚。仅补当前合成Tenant父锁与快照SQL叶子；不解释MySQL表达式、不证明真实锁/DDL/权限。原`tests/rental-state-persistence.test.cjs`在`:37`同步读取`getProfile`、期待camera而得到undefined处退出1，未跑到重启恢复断言；原测试未改。命令、源码hash和原失败唯一见[事务证据](<../../worktree/rental-core/output/category-governance/core-snapshot-original-transaction-20261112.json>)，audit0；5份退出文件/缓存及3个目录已删除，未生成新API包。

**四入口参加者待核的最小合同：** 以下是实际缺口及交PM/AI唯一作者核定的字段/提交点，不是已实现接口或新增任务。

| Core入口 | 原事务来源与下一接点 |
| --- | --- |
| `recordIssue` | 原订单/assignment修订、订单更新时间、起租时点和地点；`resource_shortage`须由Core实际资源判定，现有`issue_recorded`不能按自由文本转成缺货。保存原订单后、提交前调用参加者，问题恢复须使旧来源失效 |
| `upsertProfile` | tenant/workspace、默认或非默认范围、实际`configurationSource/configurationRevision`及是否修改；非默认兼容行空update和重复回填不触发默认档案事件 |
| `persistBusinessConfig` | 所有实际配置和初始价格版本先复用原tx，完成后提供原设置行`settingsRevision`与各规则/日历/价格引用；设置修订不充当九项配置总修订，不回读另一个事务的R0来源 |
| `saveCoreState` | 本片已支持原tx及固定输入；下一步提供实际行修订/相关配置变更依据后接参加者，普通订单/资金备份变化不冒充开业配置改变 |

参加者只在原事务登记待处理事实；缺当前授权、正式临近政策或可靠来源保持not_captured，不能外调模型/通知/扫描全部业务。已接入参加者的写入失败须传播给原事务所有者回滚，不吞成捕获成功。Core提供领域来源合同，AI负责既有Outbox/ResourcePorts适配，公共符号和宿主DI须由PM指定唯一作者；本片没有改AI接口、装配或新增恒真依赖。原CAT-GOV/CLOSE完整门槛不变，08原子采用及两新编码不同组合经营仍必做。

<a id="exchange-guarantee-current-gate-20261112"></a>

## 普通换货纯保证金增额的企业门闸（2026-11-12）

按PM明确窗口，从已推送并回读一致的续租片`3ed71c1ade0fc3447d26608ea3b108dcc024e863`接续，源码固定`5d6c6dffdfaf11b0bc6d759ab87ae983d31edd0c`并已普通推送核远端；仅改[Core正式换货](../../apps/api/src/modules/rental-core/rental-core.service.ts)的新增义务条件。租金补差、押金增额或预授权增额任一为正时，普通入口复用原`assertEnterpriseNewExpense`，继续把本次Core报价的`additionalAmount`作为原第五参数，明确0也保留。保证金增额不计入租金授信，租金核减不抵消保证金增额；未扩[企业政策](../../apps/api/src/modules/enterprise/enterprise-policy.service.ts)签名。

直接消费者仍为CoreController普通换货及[批准换货服务](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)。批准专用路径原sealed authority及事务、范围、订单、输入、C/K核验保持；本片不新增本人委托接口或声明其完整执行链。普通入口需当前企业关系和当前政策，逐单批准不能复用原订单批准，伪造authority不能替代核验。

使用原换货fixture、Shared正式摄影定义及实际PreviewService/BusinessService得到两份正常报价：仅押金+100和仅预授权+100，均租金补差0。限定调用覆盖逐单批准拒绝、免逐单模式继续按0复核、当前企业关系停用及伪造authority拒绝，退出0、无业务前缀写入。仅时钟、SQL/当前关系与库存为替身；在陈旧修订处停止的调用不证明后续库存、收款、批准消费或真实事务。前两次分别因手造预览缺`additionalAmount`及旧fixture缺完整品类字段失败，原失败保留，未改生产门闸/测试断言。命令与结果唯一见[门闸证据](<../../worktree/rental-core/output/category-governance/exchange-guarantee-gate-20261112.json>)。

当前API原`--noEmit --incremental false --pretty false`退出0、audit0，源码hash固定；各次退出暂存已删除。本片未生成新运行包，原864文件研发包只覆盖已提交续租片。CLOSE-CORP/GUARANTEE、CAT-GOV-04/13及企业委托的真实权限、事务、HTTP/宿主与原完整验收仍未收口，不更新完整结项比例。下一优先为AIN-17四入口真实counter/同事务参加者。

<a id="fixed-category-prerequisites-20261112"></a>

## a0编码及619执行依赖的固定前置核收顺序（2026-11-12）

按PM反馈，以固定main `0e9f9394225feea9190eb437afccee1b18764572`作只读对照。本树a0/619已推送不代表可把整份文件覆盖main；同文件里的父功能和counter检查点须分开。以下是可按自身固定差异核收的功能片及依赖入口，不声明原CAT/CLOSE整项完成，不重跑已绿组、不复制环境。

| 建议顺序/固定源码 | 最小功能与源码范围 | 原验证入口/边界 |
| --- | --- | --- |
| 1：8b64f8efa2146ddb53a9e5de8f95f53d926d9cc3 → b6aa09ad368bf55697e67867f9958e57049a5621 | governance.service/controller原SaaS身份头及AuthService/PlatformRepository同事务复验，再接versionValidation/统一业务解码、来源差异和开放资格；原Auth方法须已在宿主存在 | [治理原身份阶段](品类治理/品类治理-开发记录.md#governance-current-authority-20261111)、[结构阶段](品类治理/品类治理-开发记录.md#governance-version-structure-20261111)；原治理脚本及类型、限定真实签名/角色读取替身。不是只复制新增method |
| 2：8fb37b4e4a3b455c143eead3cae95d6ce2b8116d；40eaeb8983955acd5eacaee6b877a4d18567bed9 | 配置仓储/Core/state恢复的本空间profile读取/保存及保留边界，再核缺已提交档案不补模板；这些实际档案接点是下面初始化/续租所需基础 | [空间档案](品类治理/品类治理-开发记录.md#workspace-profile-persistence-20261111)、[缺档案](品类治理/品类治理-开发记录.md#committed-profile-presence-20261111)；原config-workspace-scope、初始化刷新及限定保存/缺源调用。counter未进入此片 |
| 3：f0e69b9600cbb8110bcc0d8b0ede09bbf894477b | CoreConfigStore的readDefaultWorkspaceInitialization合同、仓储实现及Core.initializeTenant原事务重入；缺资料拒绝、原默认绑定不被推荐覆盖 | [默认重入阶段](品类治理/品类治理-开发记录.md#default-initialization-reentry-20261111)；10组有限调用、配置范围3项，原初始化夹具缺读接点失败保留。选版前宿主人员/商业锁缺口另由原平台作者闭合 |
| 4：16d080e48c5ad507f847e4f7b422eb1610725434 | config.loadWorkspace同空间档案及成员/组成读取；business.quoteEnterpriseExtension原订单/报价/配置同源校验。依赖真实本空间profile读取，不带5e counter | [续租同源阶段](品类治理/品类治理-开发记录.md#extension-scoped-config-20261111)；配置范围3项/限定来源通过，原renewal-repricing旧同步getter夹具失败。未执行金额全链或真库 |
| 5：9331582b7506eede97c8ef02c19d8b5528601249 | fact.readQuotedInspectionTemplates、Core检查恢复/本批换货范围、frozen模板解码、R0 order-inspection-basis引用恢复，共4源码文件 | [历史检查阶段](品类治理/品类治理-开发记录.md#historical-inspection-source-20261111)；原inspection-resource/core-closure及限定恢复/空/坏/跨范围通过，exchange-inspection查询记录器一处失败保留。关联原报价JOIN须一起收 |
| 6：00f19015a6751b1847d2c1d9a991ef37cc6aaa24 | category-active-write的lockCategoryContext及规则/日历绑定草稿两个消费者，复验绑定ID/修订/正文；不能只替换main原lockActiveCategoryBinding调用 | [绑定草稿阶段](品类治理/品类治理-开发记录.md#bound-draft-category-context-20261111)；原规则/日历及限定锁口/类型，旧缺标记/别名夹具失败保留。e82的replaceCategoryUniqueClaims不是此helper的函数依赖，同文件不整包带入 |
| 7：cb96a636b61497243d75032e98d0e301ff3d31a0 → a0a0451754d77b7454de4dad9f5044a4e70c3949 → 619f50c5a04f2af805f84f3977e78dc4683cfb81 | 确认主树已收forWorkspace绑定修订片，再按a0自身编码差异接上面已核功能，最后接Runtime/Core/business必选及历史Hook依赖。a0为15源码编码差异，619为3源码执行差异 | [编码](品类治理/品类治理-开发记录.md#canonical-category-code-20261112)、[执行依赖](品类治理/品类治理-开发记录.md#capability-runtime-admission-20261112)；类型/原Hook/限定调用通过，原7项5过/2失败及17项11过/6失败分别保留 |

`34df464ecd3e8f8b5a59fca187eef25b90f5868c`的已发布原收据审计校验另可按[发布回读](品类治理/品类治理-开发记录.md#publication-receipt-integrity-20261111)独立核收；它不是a0编码函数的直接前置。`e82aac6fb75f3749b61db2076038ee6026091fee`的唯一声明/回填helper只随其真实型号/资产/回填消费者另片核，不能借00f/a0收完整父文件。

**继续留作未收口检查点：** `5e8d52325b37cf6b613c103b2e291b25843e35ec`及其记录检查点`61fece91ae007ed42b02b7c96c1f1ab0d1b0140e`涉及配置行counter/回填；`fe65ac652076d5bed4c9ca439d50b563c61d17aa`仅原事务issue_recorded及九项独立读。两者不能标作已经接入四入口参加者、完整短缺判定或同事务开业总版；列/DDL/正式政策及真实资源仍缺相应证据。PM按上述功能差异串行，若应用需counter段即暂停该段核收并另报最小依赖。本树不追main活动HEAD、不改main工作区。

<a id="capability-runtime-admission-core-20261112"></a>

## 必选与历史能力的执行依赖（2026-11-12）

本片支撑原CAT-GOV-03/04/10/13，CLOSE任务身份和进度不变。共用运行时、Core及报价服务修复普通必选缺执行器、已启用实例缺全部登记版本的略过路径；续租按原动作版本/实例执行，两个新空间初始化入口在创建资料/配置/缓存前检查实际执行依赖。详细事实和唯一证据见[品类阶段](品类治理/品类治理-开发记录.md#capability-runtime-admission-20261112)，不复制另一份台账。

当前API864份JS完整编译并逐文件核对，更新3份，其余861份对应a0编码阶段清单；四项Shared/Client保护未变。准入/初始化短调用和原Hook脚本退出0，原组合/初始化/字段17项11过/6失败，前置缺口与断言保留。864份退出暂存文件及42个目录、追加短调用暂存均已删除。本树研发包仍不是真库、供应商、浏览器/微信、独立Review或最终冻结经营证据。

<a id="canonical-category-code-core-20261112"></a>

## 品类身份读写解码与当前API产物（2026-11-12）

本片只支撑原CAT-GOV同源身份及历史/采用入口，CLOSE分母和进度不变。Core内部15份源码去除未登记的大小写推断，复用正式编码解码及四个旧Prisma别名；准备/治理、检查与资质、原报价关联、启动和能力读取沿同一规则。实际修正、固定源码/构建hash和原失败唯一见[品类阶段](品类治理/品类治理-开发记录.md#canonical-category-code-20261112)，不重复维护另一份流水或测试台账。

本树API864份JS已完整编译并逐文件核对，更新15份，其余849份对应原2f1a34897清单，四项Shared/Client保护不变。编码正负调用及四品类合同对齐退出0；原7项冒烟5过/2失败，分别是旧单锁预期和缺权威配置读取器，原断言及生产门闸保留。852份退出暂存文件/缓存和42个目录已删除；不计真实DB/宿主或最终冻结构建，原maturity/照片及其他已登记证据继续保留。

<a id="api-current-core-build-20261112"></a>

## 当前Core与核定到期源码的自持API构建（2026-11-12）

固定来源`2f1a34897614c413ba1aeebed1d8ee3687571b05`已普通推送核远端，包含解析器`cb96a636b`及此前配置行修订/只读来源，本片没有新增源码/Schema/Client变更。先核原863文件照片包逐文件与原清单一致、dist未跟踪且无链接、Shared/Client四个保护文件hash未变，再在唯一任务暂存由原tsconfig完整编译并逐文件迁入本树自持API目录。

`tsc --sourceMap false --incremental false --pretty false`退出0，864份JS每文件安装hash与编译结果一致；更新8份原模块，新增1份maturity纯decoder，其余855份原产物不变。原Shared正式出口/租赁合同及Client schema/归属标记四hash保护通过；没有复制别树产物、启动应用或连接环境。唯一[构建清单](<../../worktree/rental-core/output/category-governance/api-build-maturity-2f1a34897-20261112.json>)保留来源、命令、hash、文件差异及退出清理状态；这只是本树研发包，不是原CAT-A14/A22最终冻结/真库/宿主或发布证据。

当前编译包的CorporateSettlementService/纯decoder/ALS复用原到期fixture，7组限定调用退出0、audit 0，见[包内到期消费](<../../worktree/rental-core/output/category-governance/api-maturity-runtime-final-20261112.json>)。原ID/旧双时间/原键恢复、未知version/actor-time/金额拒绝及原财务门闸保持。第一次包内装配混用src ALS与dist服务导致财务门闸拒绝，改为同一包上下文后只复验相关调用；[首次运行观察](<../../worktree/rental-core/output/category-governance/api-maturity-runtime-checks-20261112.json>)保留，没有改授权/断言或把源码别名称为包消费。

原`node tests/category-version-resolver.test.cjs`用这个当前包退出1，`:156`的Object.create(Core.prototype)未初始化configurationReadsByWorkspace，调用已提交配置读取时访问get失败；其后断言不计通过，没有为夹具懒造生产字段/删断言。原主树不同固定基线的源码映射结果不替代本树整组证据。文档351链接/新锚点无新增问题、原28项分类保留；固化证据后7份本片退出日志/缓存及41个编译/任务目录已删除，暂存路径不存在，864份自持研发产物保留。后续仍须原真实DB/全部实例/各端与两新编码不同组合经营，CLOSE和CAT-GOV分母/完整门槛不变。

<a id="corporate-maturity-evidence-20261112"></a>

## 原财务核定到期收据的纯解码与审计绑定（2026-11-12）

关联CLOSE-CORP-VERIFY及企业ECP-10必要来源，不计CAT-GOV进度。本片从已核GitHub的`8daf022680c8afc42d6e96a8cd4cb5d20c9fb7c1`接续，源码检查点`2f1a34897614c413ba1aeebed1d8ee3687571b05`已独立提交/普通推送核远端；PM准许两源码窗口：[Core纯解码器](../../apps/api/src/modules/rental-core/rental-corporate-maturity-receipt.ts)和[原CorporateSettlementService](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)的maturity委托/收据写入。没有改operator/staff财务授权、其他资金动作、原键、ledger/operationLog/锁序、Schema/Client或企业响应投影。

`corporateCreditMaturityAuditId`保留原SHA-256(JSON.stringify(["corporate.credit.maturity", tenantId, customerId, ledgerId]))字节；`readCorporateCreditMaturityEvidence(log, ledger)`纯读原正债权/原核定审计，返回原Shared receipt及内部audit来源。核原ID/action、tenant/customer/workspace/order/ledger/currency/原Decimal金额精度/basis/key，绑定audit.userId与detail.recordedBy，缺actor/time或矛盾明确不可核验。decoder不查当前用户状态、不读配置或计算dueAt；原操作人后来停用不否定历史审计，当前读取资格仍由原服务前后复验。

旧记录无auditBindingVersion时保留原detail.recordedAt和原audit.createdAt两处时间，不要求应用/DB毫秒相等、不编时差阈值或回写；新核定用同一个服务端Date写两处，并在原JSON存`corporate-credit-maturity-audit-1`绑定版本，严格复核一致。版本属性存在但null/undefined/未知均不可当legacy；只有确定原审计行不存在才沿原readMaturity返回未核定，有行但缺证据仍抛不可核验。原合法收据同键回放不重写/换ID/改旧时间。

原API `--noEmit --incremental false --pretty false`退出0；原credit fixture的7组限定实际服务/decoder调用退出0、audit 0：ID原字节、新写/read/replay一条收据、legacy双时间保留、版本/新时间矛盾、actor/主体/金额缺失、当前撤权/client audience门闸、无行与不可核验区分。源码/fixture/调用hash及原失败唯一见[最终阶段证据](<../../worktree/rental-core/output/category-governance/corporate-maturity-final-20261112.json>)。限定装配仅补当前合成tenant的原父锁返回，其他未知SQL仍拒绝，固定原生Date使原fixture返回与明确写入时间一致；真实SQL/Auth/事务仍为替身，不证明真库/供应商/企业消费。

原`node tests/corporate-credit-settlement.test.cjs`退出1，FakeDb:117不识别既有Tenant LOCK IN SHARE MODE，停在新maturity场景之前；原资金/receipt断言及父锁未改，失败缩入上述最终清单，不记整组通过。没有新增/扩写测试脚本或反复建环境；固化原失败/最终结果/hash后2份本片重复证据删除，10份退出日志/缓存及任务目录删除，暂存路径不存在。本片未生成API/Client产物，原863文件包不能当作新decoder验证。

第二阶段待确认的最小投影：仅在`rental-enterprise-read.port.ts`和Shared `core.ts`提供当前企业finance资格下的单ledger原核定明细，调用方scope绑定tenant/corporateCustomer/workspace、原正债权及真正企业承担订单；读取前后复验原客户会话/permissionRevision。字段限workspaceId、ledgerId、orderId、currency、dueAt、basisRef、原auditId/auditCreatedAt及bindingVersion；coverage固定current_trusted_workspace_only，明确determined/not_determined/unavailable，缺审计不补当前时间/人物，不出自由财务原因、操作键或原operator ID。单债权明细不冒充完整账户/账单/历史空间清单，不重算应收/到期/保证金；对应DTO/OpenAPI/消费者由PM另指唯一作者。公共企业投影尚未开放，原statement/跨历史space/混合payer-guarantee缺口保留。

<a id="workspace-resolver-binding-20261112"></a>

## 唯一品类读取入口的绑定修订与异步一致性（2026-11-12）

关联CAT-GOV-03/04/08及CAT-A01/A08/A10/A17。本片从已核GitHub的`a060f8b928ca3494e399af3f42418cef2c594b5a`接续，源码检查点`cb96a636b61497243d75032e98d0e301ff3d31a0`已独立提交/普通推送核远端，只改[品类解析器](../../apps/api/src/modules/rental-core/rental-category-resolver.service.ts)的`forWorkspace`和现有记录/接续。前片共用写锁已拒绝坏采用修订，但这个元数据/业务读取入口仍直接返回存储值，读写准入不一致。

现在在读取正文前验证真实版本ID/编码及非负安全整数采用修订；缺失/字符串/负值/非整数拒绝，合法初始0保留。先捕获观察到的版本ID/修订，再等待同一不可变正文，避免异步返回混入后来改变的绑定字段。历史`forVersion`继续按原业务明确版本读取，不绑定空间最新版；原当前授权和业务提交点复验保持，无写入/取锁/缓存或政策重建。

原API `--noEmit --incremental false --pretty false`、`node tests/rental-category-core-alignment.test.cjs`均退出0；原resolver fixture的5组限定调用退出0：当前/事务内/历史版本区分、初始0、坏修订不读版本、坏身份不输出、异步正文不混后继绑定。命令/源码/fixture hash和输出见[阶段证据](<../../worktree/rental-core/output/category-governance/workspace-resolver-binding-checks-20261112.json>)。fixture仅返回指定行，不解释SQL，不证明真实DB/权限/并发；原完整resolver脚本仍用旧API产物，本片不将其当作新源码整组结果，没有改用例/断言。文档344链接/新锚点无新增问题，原28项分类保留；证据固化后8份本片日志/缓存及任务目录删除，暂存路径不存在。

PM通知guard `9380d1bab`已按12行增量收固定main `307abf572701f7ad7d3b4a0e0d82710ea528e37f`；本树仅读取该固定文件核清依赖，没有追活动main。父辅助函数不在该增量中：`replaceCategoryUniqueClaims`来源`e82aac6fb75f3749b61db2076038ee6026091fee`，由型号配置仓储、资产事实仓储和回填真调用；`lockCategoryContext`来源`00f19015a6751b1847d2c1d9a991ef37cc6aaa24`，由规则/日历绑定草稿真调用。按消费片另交函数/必要imports及原调用方，不整包带入父提交/counter/schema。

这两helper分别须保持原tenant→workspace→entity事务内唯一声明替换/冲突回滚，以及原Auth+绑定ID/修订+完整正文的一致性核对。前者依赖已有unique表/规范化口径，不能将冲突吞为skip或分开释放旧声明；后者不授权限、不从持资源锁的事务逆取父锁。完整真库/并发/存量采用门槛仍待验，本片不增加CAT-GOV/CLOSE完整结项或待核实百分比。

<a id="active-binding-revision-guard-20261112"></a>

## 当前品类绑定修订损坏时拒绝共用写入口（2026-11-12）

关联CAT-GOV-03/08及原CAT-A06/A08/A10/A17。本片从已核GitHub的`c3c93d0fafafdf0de07ce70dd1e0ce17314c2a9e`接续，源码检查点`9380d1bab95e2d78ecb64d0390cfcd03af2ca0f4`已普通推送并回读任务远端一致，只改[共用活动绑定锁](../../apps/api/src/modules/rental-core/category-active-write.ts)及既有记录/接续。原`lockActiveCategoryBinding`只比较绑定ID，未核存储的`categoryAdoptionRevision`合法性；负值/缺失值可能通过无期望绑定的初始路径，被配置或恢复快照入口继续消费。

现在先拒绝不完整/非法期望绑定，再沿原租户父锁→空间锁读取；存储行必须唯一、有效active状态、完整编码/版本ID和非负安全整数采用修订。坏值/多行不能进入版本读取或返回可信binding；合法初始0及后继修订保留，未改锁序、权限、版本正文或采用事务。

原API `--noEmit --incremental false --pretty false`退出0，原配置空间范围3项通过，原scope fixture的4组限定调用通过：合法0/后继、存储缺失/字符串/负值/非整数、期望坏值在取锁前拒绝、坏状态/缺版本/重复行不读版本。源码hash、命令/退出码及边界见[阶段证据](<../../worktree/rental-core/output/category-governance/active-binding-revision-checks-20261112.json>)。fixture只返回查询行，不解释SQL或证明真库/并发/权限；未改测试或断言，完整门槛及待核实百分比不变。定向文档342链接/新锚点无新增问题，28处原分类保留；证据固化后8份本片日志/缓存和任务目录已删除，暂存路径不存在。

PM指定的企业后继只读来源核查：原财务核定到期事实实际为[CustomerCorporateSettlementService](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)的`recordMaturity`→`operationLog`→`readMaturity`（不是readCreditMaturity）。原收据绑定tenant/workspace/order/ledger/customer/currency/正债权金额，记录actor、dueAt及basisRef；读取前后复验营运财务资格，但该公共入口只接受operator/staff，不可借身份供企业客户端调用。原decoder只检查detail.recordedBy/recordedAt非空/时间合法，尚未核与log.userId/原审计时间的绑定。

可行最小下一接口：在[RentalEnterpriseReadPort](../../apps/api/src/modules/rental-core/rental-enterprise-read.port.ts)提供当前受权空间/企业/原正债权的maturity读取，复用原企业finance权限与会话前后复核，读取原核定收据、共享`CustomerCorporateCreditMaturityReceipt`语义；不自算dueAt、重核定或复制账务。需唯一作者先收口原收据纯读取/actor绑定接点，并协调shared企业投影currently-unavailable分支的最小契约/消费者窗口，本片未改Platform或Shared。

PM后继要求的确定窗口提案（仅设计，公共改码权未开放）：先开两份源码——新增Core纯函数文件`apps/api/src/modules/rental-core/rental-corporate-maturity-receipt.ts`，集中原deterministic audit ID与`readCorporateCreditMaturityEvidence(log, ledger)`；修改原`customer-corporate-settlement.service.ts`的`maturityId`/`maturityReceipt`委托、`recordMaturity`收据写入，以及`readMaturity`/到期准入对同一decoder的消费。decoder无Auth/IO/事务/当前配置，不生成到期日，仍复用原Shared收据类型；营运operator/staff财务门闸、原idempotencyKey/operationLog/ledger锁不改。

旧记录兼容提案：核原ID/action/tenant/customer/workspace/order/正债权ledger/currency/原金额/basis，original audit `userId`须与detail.recordedBy一致，历史操作人后来停用不否定原审计。`createdAt`是可信审计时间，旧detail.recordedAt保留原文并分别标来源，不要求毫秒相等、不编时钟误差阈值。新写入以一个原服务端Date同时写detail.recordedAt与OperationLog.createdAt，增加JSON内审计绑定版本后严格复核；不改Schema、不批量改旧审计。缺userId/createdAt或actor/主体矛盾是已有收据不可核验，不补当前人/当前时间、不当作未核定；只有确定原核定行不存在才明确未核定。未知绑定版本不按legacy忽略。

企业投影后续单独确认窗口：`rental-enterprise-read.port.ts`新增按当前企业finance资格的单ledger原核定读口，取本空间原正债权及真正企业承担订单，复验原客户会话/权限修订；Shared `core.ts`中只扩maturities安全分支和审计来源元数据，消费者/DTO/OpenAPI由PM指定唯一作者。不借operator身份，不把整个客户账或历史空间开放给当前企业会话；原收据中的自由财务原因/操作键不直接进入企业页面。缺完整事实返回unavailable，未核定单独表达。本提案没有实施这些公共/企业改动，也没有修改原测试。

正式账单仍无确认的生产者：当前schema只有企业invoice资料、债权ledger及渠道`PaymentReconciliationLine.statementStatus`，后者不是企业账单；原任务归ECP-10/CLOSE-CORP-VERIFY及原CORP-SETTLE账务接点。历史跨空间授权事实仍仅当前原订单主体/会话空间，不能以会员空间或新租赁allowlist补范围。原payer/guarantee只认可原订单主体、membershipSnapshot及实际资金/供应商记录；混合承担和保证金专用读源未接，继续unavailable，不造账单/账户或改营运授权。

<a id="exchange-photo-core-recovery-20261112"></a>

## 照片完成失败、失应答与过期原来源恢复（2026-11-12）

从已核GitHub的`5983acd3af5c3457dade88fc32515c9a2efc493f`接续，本片未改生产源码或原测试/断言。照片四个生产模块与固定`e2a1a2b9ddc209e763c9bf050eceafbfa1be872d`逐文件Git差异为空；前置正式检查准备/本人同意/原K/C执行合同仍见`0947a6eb82cd1e725073131dc11f78a0fc94bf49`的[原Core阶段](#approved-exchange-core-port-20261111)。交付该固定照片源码及必要前置，不拿本树配置修订/只读合同替代照片依赖。

原七组Core恢复调用现已退出0、audit 0，唯一[阶段证据](<../../worktree/rental-core/output/category-governance/exchange-photo-core-recovery-final-20261112.json>)保留原调用摘要、源码/fixture及命令hash、首次失败与最终结果。实际Core/media/FileStorage服务参加，SQL/Auth/配置/库存/事务和对象传输仍为明确替身，不证明真库、供应商、HTTP/DI或宿主。

已验证：完成收据写入失败时文件/来源完成状态一起回滚，保留原占用和冻结目标；撤权不再请求对象，订单修订变化不能完成或重传；PUT失应答后即使暂存已变，只GET原冻结字节恢复；Core已经提交但返回丢失时按原收据读取、不再IO；没有原冻结意图仍unknown，不重读暂存或PUT；原目标在票据过期后缺失也不能分配新目标/重传。同一次过期检查保留completed来源原键可读且无再次派发。没有换原键、删冻结依据、改业务期限或补造费用/企业批准，原K/C恢复边界不变。

时间替身最终采用原生OriginalDate的Proxy：仅无参构造和now使用指定时间，构造返回原生实例，保留prototype/parse/UTC，finally恢复global.Date。之前缺TS注册的加载失败，以及继承Date/内存SQL时间原型与structuredClone结果不一致造成的末组比较失败，均已缩为阶段证据的失败摘要；没有删改原断言或为了夹具修改生产代码。原分段计价fixture hash `24a8c79d3fa686a9291e3c9acdbf55c1e42d326a970ab7f8a5a761f70c18a0fa`、原文件fixture hash `0c4a7a211d869575ca88c9a4988a16cef85698861438acd77d72177003089d69`不变。最终清单固化后，4份本片重复尝试JSON按hash核对删除；8份退出日志/缓存与任务目录已删除，暂存路径不存在，只保留唯一阶段证据及定向文档检查结果。

原5组正常消费与本7组恢复分开留证；两者不关闭完整CAT-GOV/CLOSE/ECP验收。企业作者继续独占本人photo GET/DI/受权Blob和准备面板接线，真实事务/存储/权限及宿主仍待原门槛；本树转回品类同源定义、历史动作、所有写入口及08存量采用主线，不等待17接点回收或新增模型执行许可。

<a id="core-failure-read-ports-20261112"></a>

## 履约已记录问题与原九项开业的只读来源（2026-11-12）

从已核GitHub的`61fece91ae007ed42b02b7c96c1f1ab0d1b0140e`接续，源码检查点`fe65ac652076d5bed4c9ca439d50b563c61d17aa`已普通推送并回读任务远端一致，PM明确的分配服务/业务服务窗口仅新增无副作用读取合同。没有改原扫描、问题登记、配置持久化或九项判定，没有接入Outbox参加者、改变人工经营事实、生成Client、改事件Schema或调用模型。此前配置行修订源码仍固定在[配置阶段](#configuration-row-revision-core-source-20261112)。

[分配服务](../../apps/api/src/modules/rental-core/rental-allocation.service.ts)的`readRecordedFulfillmentIssue(tenantId, orderId, tx)`必须使用调用方原事务，复用原事实仓储的订单可见范围并前后核对ALS。它只返回原订单ID、真实assignment修订、订单更新时间/起租时点/地点及已登记问题标记，不返回自由问题文本或完整分配资料；缺订单/问题、非待履约阶段、非法修订/时间不补来源。读取不调用`scanOrder`/`recordIssue`、不锁新资源或开事务，不重新计算实时可交付，也不从分配偏好编临近履约阈值。ResourcePorts须结合正式政策和当前授权判定捕获，缺项保持not_captured。

[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)的`readTenantReadinessSource(tenantId)`在业务写锁外调用原`readTenantReadiness`→`renderTenantReadiness`，保留原九项结果；只增加读取起止窗口、`independent_persisted_reads`声明和存在时的真实品类绑定ID/采用修订，前后复验绑定及范围。旧显式legacy宿主不补绑定ID或版1；该结果不宣称事务快照，不写配置/事件，不取代原[Core配置行来源](#configuration-row-revision-core-source-20261112)。原只读调用者继续使用原方法和结果形状。

| 验证 | 实际结果与边界 |
| --- | --- |
| API类型 | 原tsconfig的`--noEmit --incremental false --pretty false`退出0，见[原入口核对](<../../worktree/rental-core/output/category-governance/core-failure-source-original-checks-20261112.json>) |
| 原分配/开业读取 | `node tests/rental-allocation.test.cjs`退出0、原14个断言通过；`node --test tests/ai-native-ain08-opening-read.test.cjs`退出0、17项通过，没有改原用例/断言。仅该两份原入口，不覆盖前片开业配置13项的5过/8失败 |
| 新读取合同限定调用 | [原fixture限定调用](<../../worktree/rental-core/output/category-governance/core-failure-source-bounded-20261112.json>)退出0、5组通过：原事务问题及重复读取不改修订/不扫描写入，缺问题/非法修订不补来源，迟到范围变化/外租户原行拒绝；开业合同保留原九项和独立观察、旧宿主不补绑定，最后一次绑定变化拒绝。实际Core服务参加，原fact/query/事务为明确替身，不解释SQL或证明真实Auth/DB/政策/捕获/模型执行 |

原离线preload、固定不可用DB URL及同一任务暂存/缓存，audit 0。两个原fixture与输入/输出在清单可追踪，没有新增测试脚本。验证进程退出，11份本片日志/缓存及2个任务目录在证据固化后删除，原暂存路径不存在。本片源码尚未编入原863文件API包，不沿用该包作新接点证据；完整品类/AI/CLOSE门槛不变。

下一接点：AI作者在其ResourcePorts消费原事务问题读取及锁外开业来源，先排除在`recordIssue`里重入扫描/另开业务事务的锁环。`persistBusinessConfig`仍只有价格子段共用事务，不提前捕获其余配置尚未提交的九项状态。Core可选参加者尚未接入，需要明确其当前政策/授权、无副作用读源、原事务写入及失败处理；读取可用不等于已捕获，不补默认临近政策/资源ID/修订或让模型改变配置、资源与资金。

<a id="configuration-row-revision-core-source-20261112"></a>

## 配置行修订与原开业读取来源（2026-11-12）

从已核GitHub的`ec42c7bdc7e87628ecedd345009b7405982b0044`接续，源码检查点为`5e8d52325b37cf6b613c103b2e291b25843e35ec`，已普通推送并回读GitHub任务分支一致。PM明确指定[配置仓储](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)、[快照仓储](../../apps/api/src/modules/rental-core/rental-state.repository.ts)和[原回填](../../apps/api/src/modules/rental-core/rental-snapshot-backfill.service.ts)的独占窗口。本片只改这三份Core源码及既有记录/接续，服务端Schema/DDL归AI作者；未修改AI/企业/照片模块、公共入口、Shared、原测试或正式任务。

`TenantRentalProfile.configurationRevision`和`RentalCoreStateSnapshot.configurationRevision`的最小合同均为数据库`Int`、初始创建/结构迁移存储值1，合法范围1～2147483647。它们是各自原行的修订，原`configVersion`品类字符串和快照`state`正文保持原意；不能将字符串/JSON强转修订，读取缺列、缺行或不合法值不补1。发生实际修改时在原写事务内读取当前修订并CAS递增，饱和拒绝修改；相同内容、非默认档案空update及重复回填不凭空增版。结构迁移产生的1只表示开始跟踪该当前行，不证明任何历史报价/品类版本。

已核写入口：默认档案在`upsertProfile`原事务内维护正文/修订；非默认空间保持兼容档案create/空update，自己的显式档案与`saveCoreState`共用快照行CAS。普通快照继续保留已提交的显式档案，只按原绑定更新标记；实际快照正文变化才增加该行修订，不将它当作全部规范化配置的总版本。比较在MySQL中对JSON作二进制比较，避免大小写变化被数据库排序规则忽略；相同档案保留原编辑时间。回填和Seed仍只补缺失兼容档案，回填复验实际存储修订，既有行不覆盖。没有复制/生成Client，本树Schema未改，真实执行必须先由唯一作者应用这两列及DDL。

[原Core开业配置读取](../../apps/api/src/modules/rental-core/rental-core.service.ts)的`readOpeningConfiguration`已经透传仓储结果，本片不改Service：`profile.configurationRevision`及`profile.configurationSource`分别来自当前默认档案行或本空间快照行，来源值为`TenantRentalProfile`/`RentalCoreStateSnapshot`；`settingsRevision`位于读取结果顶层，来自原经营设置行，设置正文及原单位/方式规范化合同不变。缺档案仍为原`profile:null`，不能为签名补来源。原九项判定唯一在[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)的`readTenantReadiness`→`renderTenantReadiness`：workspace_profile、accounts_roles、fulfillment_network、business_rule、business_calendar、item_groups、pricing_groups_rates、price_version、membership_base。没有另造readiness算法，也不把九项独立读取称为单事务快照。

| 验证 | 实际结果与边界 |
| --- | --- |
| 当前API类型 | 原tsconfig的`--noEmit --incremental false --pretty false`退出0，当前三份源文件hash见[最终核对](<../../worktree/rental-core/output/category-governance/configuration-row-revision-final-checks-20261112.json>)。首次设置修订误放正文造成类型失败，已改为原读取元数据层；[首次类型证据](<../../worktree/rental-core/output/category-governance/configuration-row-revision-types-20261112.json>)保留 |
| 原配置空间范围 | `node tests/config-workspace-scope.test.cjs`退出0，原3项通过；未改原断言，见[原配置核对](<../../worktree/rental-core/output/category-governance/configuration-row-revision-checks-20261112.json>) |
| 当前开业来源限定读取 | 原开业fixture的3组限定调用退出0：保留品类字符串/真实数值修订、拒绝缺失/字符串/非法/超范围修订、只投影两种来源并不读取聚合。见[读取证据](<../../worktree/rental-core/output/category-governance/configuration-row-revision-reader-20261112.json>)。实际Core/config读取参加；fixture只返回指定查询行，不解释SQL，不证明真实授权、DDL、事务或AI签名 |
| 原开业整组 | 原入口`node --test tests/ai-native-ain08-opening-configuration.test.cjs`退出1，13项5过/8失败：原元数据fixture未提供新增行修订，原风险读取2次与旧1次预期仍失败。原[失败及输出](<../../worktree/rental-core/output/category-governance/configuration-row-revision-final-checks-20261112.json>)保留；未弱化读取、改fixture/断言或记整组通过 |
| 命令及检查范围错误 | 首次整组额外注册ts-node使编译后的JS再次被当TS检查；改回原自注册入口。限定读取首轮正则误把`JSON_EXTRACT(cs.state,...)`当作裸聚合列，改为仅检查真实裸列/全量SELECT后复验；原失败仍在上述清单。没有改原测试脚本 |

上述有效Node使用原离线preload、固定不可用DB URL、本树同一暂存和写缓存，audit 0。验证进程已退出，2450份本片日志/缓存及5个任务目录在证据固化后逐文件/空目录删除，原暂存路径不存在；只保留上述最小清单，没有复制产物。API产物仍为原863文件照片构建，本片配置修订源码尚未编入，不拿旧包验证新来源。配置写入的正常/无变化、并发CAS、饱和、失败回滚和重放仍缺真库证据；本片不计原CAT-GOV/CLOSE完整结项或提高待核实百分比。

PM后续另准[分配服务](../../apps/api/src/modules/rental-core/rental-allocation.service.ts)的`recordIssue`原事务参加者，以及业务配置/九项源的最小窗口。源码已确认`persistBusinessConfig`只有初始价格计划/价格版本共用事务，其余配置分别写入；`readTenantReadiness`是独立读取。不能在持业务锁时重新调用`scanOrder`或开新业务事务捕获，也不补临近政策/默认阈值。后续先提供无副作用的原来源合同并核AI参加者/ResourcePorts，缺事实/政策/授权保持not_captured；这两处参加者尚未在本片接入。

本片照片完成收据失败/失应答恢复命令未取得有效业务结果：外层工具定位/传递失败，原历史日志的普通读取又被在用文件锁阻断，均不计通过。实际暂存发现一次被离线守卫阻止的目录外写入尝试；递归清理被自动审批以`blocked by policy`拒绝后，已用同一PowerShell入口逐文件/空目录安全回收并核实，见[失败观察](<../../worktree/rental-core/output/category-governance/exchange-photo-core-recovery-2-20261112.json>)。原5组照片消费证据不变，恢复仍待下一限定调用；没有读环境、启服务、真实DB/存储或合main。

<a id="evidence-original-location-20261112"></a>

## 旧证据唯一原稿的跨树现行链接（2026-11-12）

按PM本次明确安排，只修复两份开发记录中25份旧JSON的26处现行引用；原文已由`86c356619570aa083b937d93fff9c58c92e4d500`保全。实际Git登记确认主仓库为`D:/工作文件/rental-OS`，固定合入提交`ca1c6a9fca1bfe8c9aa8465b4eed88189a17501f`可读取，没有追活动主树施工。

这25份JSON是主仓库`output/category-governance`中的唯一跨树原稿，本树当前链接明确指向该位置，逐个核对为普通文件且可读取；未复制证据、运行产物或环境。Core记录使用`../../../../output/category-governance`，品类记录使用`../../../../../output/category-governance`；本树新增照片消费/构建证据仍使用本树原目录。历史两份附件缺失保留，链接修复不代表业务或历史附件验收。

原`validate-docs`按“不得离开当前工作树”将这26处显式跨树引用列为`link-outside`，不会自动变绿；本次沿PM授权对固定唯一原稿作单独路径/普通文件核对，不修改检查器或通用规则。PM收回文档至main时须按main文档所在目录恢复仓库内相对路径，并复核仍指向同一原稿；不能直接照搬本树跨树层级。当前业务进度、原任务和其他WIP不变。

<a id="exchange-photo-core-consumption-20261112"></a>

## 换货照片的 Core 完成与本人读取限定消费（2026-11-12）

从已核 GitHub 的 `5c755c64920217328cea504acde2c19c19296759` 接续，工作树/暂存区干净，无 merge/cherry-pick，恢复后未发现本任务验证残留。沿[照片源码检查点](#exchange-photo-freeze-20261111)复用原分段计价与文件 fixture，本片没有修改生产源码、测试文件/断言、公共登记或正式任务。

实际 Core/预览/准备、专用影像、本人同意和文件服务参与5组限定调用：影像经一次暂存 GET、唯一目标 PUT、目标 GET 完成，原键重复调用不再请求字节；原准备接受该原来源并记录唯一消费，本人从该准备读取精确照片字节；IO期间撤销原客户、改变原订单修订，以及跨空间请求均被拒绝。`boolean false` 检查值保留，没有补造费用确认、企业批准或执行成功。

命令使用原离线 preload、固定不可用数据库 URL、同一任务暂存和 TS 优先解析，退出0、audit 0。原初始化 Call ID、5组输出、源码提交与边界见[消费清单](<../../worktree/rental-core/output/category-governance/exchange-photo-core-calls-20261112.json>)。原 SQL/Auth/配置/库存/事务和对象传输为明确替身；本次证明服务限定消费，不证明真实数据库权限/事务、对象存储、HTTP/DI、页面或微信宿主。Core完成收据失败与失应答的恢复应用尚未在本次5组中验证，沿原完整门槛继续核对。

两份既有 fixture 的SHA-256保持：分段计价 `24a8c79d3fa686a9291e3c9acdbf55c1e42d326a970ab7f8a5a761f70c18a0fa`，文件 `0c4a7a211d869575ca88c9a4988a16cef85698861438acd77d72177003089d69`。证据已固化，暂存删除、验证进程退出；API仍为[当前固定构建](#exchange-photo-freeze-20261111)的863份受管文件。本片不提高CAT-GOV/CLOSE/ECP百分比或完整结项，不合main、不执行真实环境。

<a id="exchange-photo-freeze-20261111"></a>

## 换货照片的原内容冻结与核对接点（2026-11-11）

本片从已回读 GitHub 的 `2a2c9ae647c55343fb6f39a6e73e12e7489c0c54` 接续，源码检查点固定 `e2a1a2b9ddc209e763c9bf050eceafbfa1be872d`，已普通推送并回读 `codex/rental-core` 一致。在唯一工作树保全原照片 WIP及未验接点；没有合 main、修改企业内部实现、公共登记或正式任务。四份源文件哈希与下列行为及类型清单一致；检查点不代表完成应用/本人照片消费者或真实验收。原 CAT-GOV/CLOSE/ECP 完整门槛及百分比保持。

[文件生产者](../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)复用原 v2 的 `blob` 暂存路径和冻结格式：读取有界实际字节并验证图片，先同事务保存唯一冻结目标，再向该目标 PUT 并读回原内容摘要。失应答后的 `reconcileExchangeInspectionUpload` 只 GET 已保存目标，不重读暂存、不重传或分配新目标；目标缺失仍不可用。冻结证据同时核对来源、摘要、大小、类型和尺寸，读取期间文件/会话或配置变化拒绝。旧非受控暂存路径在读取字节前阻断，原记录不重写。

[Core 原来源读取](../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.read.ts)保留初始绑定，并识别同一原完成占用对应的冻结中/已完成文件；[完成服务](../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.service.ts)仅首次获确认的占用执行暂存读取和 PUT，其余调用核对原目标。正式完成、Core 来源结果与当前订单修订仍在原事务复验。[本人同意服务](../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts)新增 `photo` 接点，只允许原本人会话、当前订单和指定准备哈希中的已接受照片，文件 IO 前后复核原客户、材料、订单及照片来源；只返回有界字节和摘要，缺文件供应拒绝。该本人读取接点尚无正常 HTTP/DI/页面消费证据，不写全链通过。

| 验证 | 实际结果与边界 |
| --- | --- |
| 既有文件 fixture 的限定调用 | 5组退出0：一次 GET/PUT/GET 冻结、过期后只读原目标、完成与精确字节/坏元数据拒绝、PUT 成功但失应答的原目标恢复、缺目标不另写。实际 FileStorageRuntimeService；原内存文件/会话/配置/事务及对象传输是明确替身，未证明真实存储或事务。见[清单](<../../worktree/rental-core/output/category-governance/exchange-photo-freeze-bounded-2-20261111.json>) |
| API 类型 | 原 tsconfig 的 `--noEmit --incremental false --pretty false` 退出0，四份源码哈希与行为清单一致。见[类型](<../../worktree/rental-core/output/category-governance/exchange-photo-api-types-2-20261111.json>)。首次类型核对时仍为旧API包，不将它作新行为证据 |
| 当前 API 构建 | 从固定`3efc62884b303c3c0127e9aeb578cb9ece9d9b3e`完整编译，含照片源码检查点`e2a1a2b9d`；863份JS逐文件哈希一致，只更新四个照片模块，其余859份原产物、Shared正式出口/租赁合同和Client schema/归属文件哈希不变。见[固定构建清单](<../../worktree/rental-core/output/category-governance/api-build-photo-e2a1a2b9d-20261111.json>)。audit 0、暂存已删除；仅本树研发产物，不是HTTP/DI/本人照片正常消费、真实库/存储、宿主或正式发布验收 |
| 原文件生命周期整组 | `node tests/file-storage-lifecycle.test.cjs` 退出1，`:567` 在会员替身缺合法空间品类时先报“已存品类编码缺少兼容解释”，尚未运行后面的专用照片断言。原失败唯一位于主树 `output/category-governance/exchange-photo-file-lifecycle-original-2-20261111.json`；此前证据目录不存在的保存失败不计验证通过。测试/断言未改 |
| 首次限定调用失败 | 原专用计划使用文件名暂存键，不符合原冻结校验器的 `blob` 格式，导致冻结后回读拒绝。见[原失败](<../../worktree/rental-core/output/category-governance/exchange-photo-freeze-bounded-20261111.json>)。修复生产者路径后仅复验相关调用，没有放松原冻结校验或修改夹具 |

以上 Node 沿原离线 preload、固定不可用数据库 URL 和单一任务暂存执行，audit 均为0；证据先保存，随后暂存删除，验证进程已退出。既有文件 fixture SHA-256 保持 `0c4a7a211d869575ca88c9a4988a16cef85698861438acd77d72177003089d69`。没有读取环境、启服务、连接真实库/存储、执行迁移或开放生产。Core 完成应用的真实事务、本人照片正常读取/HTTP/DI和浏览器消费仍须原条件验证。

四份记录/接续的首轮定向链接检查退出0，检查300链接、本片8链接及6个照片阶段锚点；与固定开工版本逐项新增问题0，见[文档清单](<../../worktree/rental-core/output/category-governance/exchange-photo-docs-20261111.json>)。当前本树仍有28处旧链接缺失：26处指向25份已集中于主树 `D:/工作文件/rental-OS/output/category-governance` 的旧清单，逐个核实主树文件存在；另2处历史附件缺失保留。旧清单不复制回工作树填绿，按此唯一位置读取，本片新证据仍在本树同名目录。补充唯一位置后的9个本片链接/8个阶段锚点另作最终核对；上述结果不等于四册无缺失或完整文档验收。

原11组 Core限定调用没有另造测试文件：fixture 来自[既有分段计价测试](../../tests/rental-exchange-segment-pricing.test.cjs)，原命令保留在会话日志 `C:/Users/Penn/.codex/sessions/2026/11/09/rollout-2026-11-09T12-28-01-01a1be90-2a5b-77a2-a995-66f3d56e96f2.jsonl` 的21325～21690行。初始化 Call ID `call_zEFTQ6XYui52iwluruhJtMjd`，实际执行 `call_JnWueM6RWqsHPxqnP0SUHINi`，原K/TTL回读 `call_L6GHSu9L1uIljNOWsUkHup30`，汇总 `call_Cqw0R96teXxkcq8Ci3eGEg43`；原交互会话9008已退出，不能当活进程重启。企业参与者在该原调用中是明确替身，企业作者需消费实际 `prepare/commit/replay`，不将其当企业完整业务或独立审查证据。

<a id="pm-context-refresh-fixture-integration-20261113"></a>

## 原配置读取七项夹具的 main 收回（2026-11-13）

固定来源`3037d919d146bfd6981762eb7ed25eefb01e3922`已核GitHub。仅收[原测试](../../tests/category-adoption-context-refresh.test.cjs)，最终blob `f8430a52167aa7b95a9187b12b1a2c60b932554d`；七项原用例正文与断言逐字不变。原fixture补Tenant共享父锁、同空间有界R0档案/设置/地点/券/型号查询和原RentalCategoryResolver注入，生产Auth/锁及Core源码不由本片调整。原6/7、缺R0字段/解析器等失败与修正依据保留于[作者固定阶段](https://github.com/JinPen-G/rental-OS/blob/3037d919d146bfd6981762eb7ed25eefb01e3922/docs/Rental%20Core/Rental%20Core-%E5%BC%80%E5%8F%91%E8%AE%B0%E5%BD%95.md#context-refresh-fixture-contract-20261113)。

QA在固定main `abfe65248`产品源上用该单文件复验原Core/业务/品类采用/SQL与Auth夹具，七项全过，未发现需要f4父生产实现的缺口。覆盖两实例读取新采用且旧上下文冻结、空集无样例重建、旧Core与新业务配置不拼接、空间外组成/型号拒绝、缺持久设置不补默认、当前地点投影及AI单个Core快照。原Node用例回调和断言保持，dist引用按固定main真实源码解析。命令`node --no-compilation-cache -`退出0，stdin SHA-256 `514497f55a8267a37692d2a25637dc5283304c301e6202473e040e4bd083f7d5`，audit为空，任务临时目录不存在。

PM逐blob与范围核收，定向差异和新增链接检查通过；与包含本段的中文提交绑定，普通推送后回读GitHub。生产定价三源补片独立待QA，不由本测试扩大收取；治理身份三源与企业回款已集成的成果保持。此为七项限定离线fixture证据，真实MySQL锁/事务、HTTP/DI与宿主仍未验，原CAT-GOV/CLOSE门槛不变。六份他人WIP未变，本阶段无新临时环境、进程或重复副本。

<a id="pm-governance-authority-main-integration-20261113"></a>

## 治理身份与 AI 原凭据转交的 main 集成（2026-11-13）

以 main `250b545c356f6911eb5a418fe6e7934ae295bb89` 为输入，按 Core `654a5e35cb010aa15bd164db127b00a1f12835e3` 两源码最小补片及 AI `23e4cd71ce16f6289c06eec299571abf142547e5` 单消费者收回。Core补片 SHA-256 `8065ea1629a4a79dddb12e349fe67878caaad8df707e253a6ec40c879e478bc8`，原八句输入副本保留。最终服务 `09eca288fdfdcc66b2ab005199a5c588b4769a5f`、Controller `e4900454be98043074b69301bf3d99a215523e01`、AI人工应用 `3843338a6b759f212253351c35ef9bbd6b9f170c` 与 QA固定版本逐项相同。Auth、平台仓储、Guard、公共出口和DI沿现有main，不整取Core/AI父级未验成果。

治理平台事务复用原签名/会话、SaaS身份及角色权限，Core拥有Serializable与前后复验；缺身份/当前权限拒绝。AI create/patch经原Guard/ALS/DTO/CAS后转交本次捕获的同一authorization，由Core再核，不从body或后续可变对象取得身份。原写入失交付仍为AI_RESULT_UNKNOWN，已提交草稿可按当前人工review核对；原创建K回读不重新创建。

QA六项相关复验逐项闭合：create/patch正常返回draft和CAS修订/原审计；等待期间调用方改header仍用首次捕获凭据；审计等待中撤会话/撤edit回滚且无新增草稿/审计；缺签名/额外authority拒绝；失交付人工review及原创建K两次回读精确同一created/version，读取新增审计0。最终正向/原K/失交付组命令`node --no-compilation-cache -`退出0，stdin SHA-256 `17a40be1ad91aae53189c04a71c9331bbaa37533f758eb375bdc93c0bfb821c2`；三源3根/1206源TypeScript5.9.3零诊断，SHA-256 `0bd389e15c229648c8f5513e1012a425974e3c776cc72832b80908704291a2ec`，退出0。原Core十一组和原创建组三过三失败沿[原QA记录](#pm-governance-authority-qa-blocker-20261113)，不据本片覆盖原失败或判全专项完成。

PM确认原header P2闭合，按QA可集成结论收回本三源，并核差异/最终blob/文档链接。SQL、事务/身份/仓储为明确离线夹具，真实HTTP/DI、MySQL并发及宿主未验。记录与包含本段的中文提交绑定，普通推送后回读GitHub；开发者继续原CAT-GOV/CLOSE/AI范围，原任务档位与完整门槛不变。六份他人WIP保留，本阶段仅Git固定源码和记录，未新增临时环境或进程，旧待清理责任保持。

<a id="governance-authority-main-closure-20261113"></a>

## 治理平台身份的固定main父闭包（2026-11-13）

按PM要求为CAT-GOV-05/07提供原平台身份父闭包。固定来源为`8b64f8efa2146ddb53a9e5de8f95f53d926d9cc3`的治理服务及Controller增量；其两个源文件的父像与固定main `2a5c56471abb5714f80715e2cfa0aa236f003f51`逐字节相同。与QA固定的八句输入副本服务blob `0bdbf0b1bcb03c1a4c2ca0db0705ee95cd9aa6e9`叠加后，交付[准确二文件补片](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-main-closure-20261113.patch)。该补片是本次明确要求的集成交付物，随本阶段纳入Git。

| 文件 | 补片输入blob | 应用后blob |
| --- | --- | --- |
| `apps/api/src/modules/rental-core/category-governance.service.ts` | `0bdbf0b1bcb03c1a4c2ca0db0705ee95cd9aa6e9` | `09eca288fdfdcc66b2ab005199a5c588b4769a5f` |
| `apps/api/src/modules/rental-core/category-governance.controller.ts` | `0c12209f7ffc6b011a5edab301df811664674f53` | `e4900454be98043074b69301bf3d99a215523e01` |

补片20,603字节，SHA-256为`8065ea1629a4a79dddb12e349fe67878caaad8df707e253a6ec40c879e478bc8`。独立临时索引仅登记上述两个固定输入，`git apply --cached --check`及实际应用均退出0，结果blob逐项一致，实际工作树索引和三份定价分组WIP保留。合并时两处冲突已核明并解决，文件头保留请求副本与身份职责，归档同时保留输入复制和`platformTransaction`。见[补片来源及应用证据](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-main-closure-20261113.json)。

所需公共依赖已存在于固定main。`AuthService.resolveTrustedPlatformBrowserPrincipal`及原`verifyAccessToken/sign/tokenSecret`与本树方法正文一致；`PlatformService.getAuthSession/assertTrustedSaasManagement`及`PlatformRepository.getAuthSession/findUserById`来自完全相同的两份平台文件。原Auth签名、operator audience、会话/期限、SaaS账号和当前角色映射由这些原接点提供。固定main的AppModule已登记`AuthService`、`PlatformRepository`、`CategoryGovernanceService`及Controller，补片消费其现有DI。公共文件的准确读取路径、方法哈希和注册核对见[当前API及依赖证据](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/pricing-group-transaction-compile-20261113.json)。

Core的`platformTransaction`承担Serializable、身份/权限前后复验及最后等待后的到期检查，maxWait为10秒、timeout为30秒。原Controller从请求Header传入真实authorization，创建原结果读取也经过当前身份；请求体SaaS字段或自由操作人不授予权限。八个请求副本均保留，缺Auth/Platform注入503，缺会话或签名401，撤销动作权限403，事务冲突保留原输入和原键核对。

两份候选在本树原API类型链的单一程序检查退出0、867个根、零诊断，见[候选类型](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-closure-candidate-compile-20261113.json)。当前API另一次单一程序检查也退出0。首次将两份完整类型程序保留于一个进程导致堆内存不足、退出134，保留[首次类型失败](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-closure-compile-20261113.json)。两份必要完整emit与来源/哈希见[候选产物](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-closure-candidate-emit-20261113.json)。

完整编译候选与原Controller的9组限定调用退出0、audit0，覆盖正常创建/归档、原键在创建开关关闭后回读、同键改变内容、缺DI/会话、坏签名、等待期间撤权及提交前撤权回滚。执行原Auth签名和平台会话/角色映射算法，账号/会话/ORM及事务回滚为明确替身，见[完整编译行为](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-closure-compiled-runtime-20261113.json)。首次限定归档夹具缺`findFirst`的[失败](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-closure-runtime-20261113.json)保留，补齐该原读取后9组[源码调用](https://github.com/JinPen-G/rental-OS/blob/654a5e35cb010aa15bd164db127b00a1f12835e3/output/category-governance/governance-authority-closure-runtime-final-20261113.json)也通过。未新增测试文件或改原断言，尚需QA在main定向复验及原真实环境门槛。

四份记录/接续新增15处本地链接、5处片段已定向核对，阶段`git diff --check`退出0。本片一个临时基线源文件已删除。其余8个已退出候选、emit和临时索引共155,026字节，批量原生删除被自动审批以`blocked by policy`拒绝，未提供具体理由；已同卷归集至[唯一责任清单](../../output/.cleanup-pending/rental-core/governance-authority-main-closure-validation/manifest.json)，状态为已归集、未删除。原单一任务目录仅保留下一独立定价分组验证仍使用的空audit，片尾按原生命周期清理。原CAT-GOV-08、两个动态编码不同组合的冻结经营、真库/多实例、浏览器/微信及独立Review仍未收口，完整结项0/14，实现百分比待核实。

<a id="pm-governance-authority-qa-blocker-20261113"></a>

## 治理身份闭包复验与 AI 直接消费者缺口（2026-11-13）

Core 固定 `654a5e35cb010aa15bd164db127b00a1f12835e3` 的最小补片 SHA-256 `8065ea1629a4a79dddb12e349fe67878caaad8df707e253a6ec40c879e478bc8` 已由 QA 独立核对。严格应用于 main `2a5c56471` 加原八句输入副本后，治理服务 blob `09eca288fdfdcc66b2ab005199a5c588b4769a5f` 与 Controller blob `e4900454be98043074b69301bf3d99a215523e01` 匹配，Auth/PlatformRepository 及 DI 已在主线。

QA 实际 Auth 签名、PlatformService 会话/SaaS 校验、角色映射及 Controller/服务的十一组限定行为全部通过，命令 `node --no-compilation-cache -` 退出 0，stdin SHA-256 `37e756ffc633b15264e60b2c9897e7670b57805db8de6dd934b7d36861c22072`。两源码 noEmit 为 2 根/1194 源零诊断，命令 SHA-256 `1a590048e18fb9c39023d0c43016795bd0aba52b8ce0a94dc400d160dc590d3a`，退出 0。原创建六项仍三过三失败、退出 1，缺 Auth 注入及后段来源结构版本门槛保留，未删除断言补绿。

完整组合暂缓集成：QA 发现 [AI 人工草稿应用](../../apps/api/src/modules/ai-native/category-assist/category-draft.application.ts)的 create/patch 完成 Guard 校验后仅向治理 Controller 传 user，遗漏已捕获的原 authorization。新 Core 门闸正确拒绝，已登记人工入口返回 AI_RESULT_UNKNOWN、零草稿/审计；相同签名/角色/JSON 夹具下旧组合可正常各写一次。反例命令 SHA-256 `02ead9c9ce80c024414efb55c020b60187648b226d4f33fdb98e304d318528fe`，旧对照 `7234101b7377490f87b2279055dac53b7411101387f78d1d8b2c525219ebe8a6`，均退出 0。首次持久化 JSON/Prisma 空字段夹具校准失败由 QA 留证，产品与原测试未改。

PM 已将 P2 交 AI-RD，由其在唯一应用文件转交同一捕获凭据、保留 Guard/ALS/DTO/CAS 和新 Auth，再给固定 blob/必要模拟与类型交 QA 复验；PM 不修改 AI 产品代码或放宽 Core 授权。Core 两源和原输入副本的完整集成等该直接消费者，其他 Core/AI 独占主线继续。原输入候选已作任务分支检查点 `b5c1b3f5214985998252123a12ae95717d2108d4` 并回读 GitHub，主线运行源码尚未提交身份闭包。

SQL/事务、会话/角色行及元数据为明确替身，真实 HTTP/DI、MySQL/并发与宿主未验。记录仅核定当前问题/归属，不改变原 CAT-GOV/CLOSE 范围、百分比或完整门槛。六项其他作者 WIP 保持，本次无新增临时文件或验证进程。

<a id="pm-extension-fixture-main-integration-20261113"></a>

## 原续租服务夹具与空快照断言的 main 集成（2026-11-13）

按 QA 主审与独立静态复核，只收 Core `2767638bfac0a8cbc2da294dba095c7de833806b` 的[原续租服务测试](../../tests/rental-extension-services.test.cjs)，blob `b0864b67072b95e271a99065ac53a33b03ea2798`、SHA-256 `1c08078199fe37391de3f5db09270b1b5005b298351a73e71456fd1d9b9a9b03`。原十二组行为及全部断言保持：等待真实 `readBusinessContext`，精确型号分页只作原 fixture 供应，新解析且无服务的续租保留 `[]`，历史缺失继续断言 `undefined`。

QA 在 main `2a5c56471` 的实际 Core/Business/Controller 及原 absorbing/fulfillment 夹具内执行原测试全文，十二组全通过，`node --no-compilation-cache -` 退出 0，stdin SHA-256 `6c196be93d25870c05ded301978573e6fa80589b46eb80860c619f872381babe`。同装配的旧 main 测试在 defaultUnit 初始化前因未等待上下文失败，原行为组执行 0、退出 1，命令 SHA-256 `6da699af9673e9d3c2f0a0248b0b33b18e82eb759976a626860891da7ec0c34a`。这是完整原断言的限定内存行为证据，ts-node 由固定 loader 接管、metadata 关闭，未执行真实物理 CLI/DI。

仅收本测试及此处阶段记录、接续的新增证据。此前治理输入/身份候选及其四份文档差异保留在主工作区，未夹带入本提交；治理完整组合仍等 AI 直接消费者兼容修复与 QA。测试 blob 与固定版本一致，语法、差异及新增文档链接定向核对。存储/容量/Controller 参加者为显式替身，真实权限、数据库/多实例与宿主未验，完整保证金来源/退款门槛不变。六项其他作者 WIP 保持，本轮无新增临时目录或进程。实际集成提交以包含本段的 Git 对象为准，普通推送后回读 GitHub。

<a id="pm-governance-input-capture-integration-20261112"></a>

## 品类治理八入口输入副本的 main 候选核验（2026-11-12）

QA 已核 Core 固定阶段 `48e1b68075dda80743a0abb082d2c41ec83d0671`。父版本 `0475af5c547df6d0bf4c7f3139e3fa955f2a2dbb` 在等待期间修改调用方的键、原因、修订或嵌套数组后，八个入口均出现输入与实际写入、审计或原收据分离的反例。候选十组限定复验通过，覆盖八个入口、缺 Auth 与错误原修订的拒绝，原创建键回读及同请求发布恢复也使用原输入。实际服务、能力 Hook、模板及原创建夹具在固定源码内存装配，权限、SQL 和 ORM 为替身。候选 stdin SHA-256 为 `fcee602e975b3ea24b44d7ac9cd31a29e2fba5db3db38e154f2a6db5098b1546`，退出 0，121 个固定模块，审计为空且未创建临时目录。

PM 从 main `2a5c56471abb5714f80715e2cfa0aa236f003f51` 仅移植[治理服务](../../apps/api/src/modules/rental-core/category-governance.service.ts)八句首次等待前的请求复制及职责说明，Git blob 为 `0bdbf0b1bcb03c1a4c2ca0db0705ee95cd9aa6e9`。2026-11-13 首次核对时，该候选及四份对应记录、接续尚未提交，main 与 GitHub 为该起点。输入源码现已保全并上传至 `codex/pm-governance-input-checkpoint` 固定 `b5c1b3f5214985998252123a12ae95717d2108d4`，只含本服务十行增量，不代表已合 main。QA 已确认相对原服务 blob `a8dc23fe93f62bde79707c1e328ea0bffacc830c` 恰为十行新增，独立代理静态复核确认首次等待后只使用请求副本。Core 原作者正在固定含原身份持续复核的最小服务与 Controller 闭包，QA 复验后再安排整合。来源完整服务的其他父阶段事务及版本恢复差异继续按各自固定闭包核收。

QA 按 main 的实际等待位置运行原夹具，八个输入变化场景和错误修订拒绝通过，创建原键及发布同请求恢复也成立。stdin SHA-256 为 `f991bb3efc79e1238be210868113731fc05379c383ac36b84ea463e055bc3746`，129 个固定模块，审计为空，临时目录不存在。完整进程退出 1，九项通过、一项额外检查失败。失败检查沿用 Core 父版本的缺 Auth 拒绝场景，而 main 原二参数服务尚未接入父版本的 Auth/platformTransaction 机制，因此完成了归档。QA 将其归为原有前置差异，并明确同意限定集成输入复制。该身份持续复核闭包交 Core 原作者单独处理及 QA 复验。

原 `category-creation.test.cjs` 六项三过、三失败保留，两项缺 Auth 接点、一项缺来源结构版本。原作者 Shared/API 类型检查零诊断仍为作者证据，QA 本片未新增完整 noEmit 结论。真实 MySQL 锁并发、HTTP/DI、浏览器及正式资源口未验。原 CAT-GOV-08、两组不同动态组合和完整结项门槛继续执行。PM 定向核四份文档新增七处本地链接、六处锚点及允许原 CRLF 的差异格式，退出 0。此次 PM 仅写固定源码增量及现有记录、接续，无新增验证环境或临时文件。

<a id="pm-adoption-input-capture-integration-20261112"></a>

## 采用与准备输入副本的主线整合（2026-11-12）

按 QA 的固定结论，从 Core `16401c422419aa2e0368b914ecb4a4135a0788d8` 仅收[采用应用](../../apps/api/src/modules/rental-core/category-adoption.application.ts)及[准备服务](../../apps/api/src/modules/rental-core/category-adoption-preparation.service.ts)的增量，保留 main 既有前置。原调用方在等待锁时改原因，可使采用审计与原收据输入不一致，已提交后原键回读 503；本片在首次等待前固定正式采用、批次及旧整份准备输入，使执行、审计、原键和嵌套准备内容保持一致。

QA 在固定底座 `b0b586ea07b69bb3b44b2d08ef03bfc84cdaa7fb` 复现原问题，六组离线场景覆盖等待时改键/原因、修订和操作变化、嵌套补丁/撤回、旧整份准备、撤权与收据失败回滚；退出 0。限定类型检查为 2 根/1213 源零诊断，Shared/MCP 直接声明通过，退出 0。整合后两份源码的 LF SHA-256 分别为 `3c0f7e2f548d8fa1d489ac5780bde998ffd21694fc6d09ec82eba12a48a2e58d`、`4b2dd9af450433f6753c9615ec34094853abfc2ac55c55bd777f13cda1681db2`，与 QA 固定组合一致；复用已通过的限定检查，没有重复运行。

上述为 QA 主审及离线替身证据，本次没有新增独立复核，真实 MySQL 锁并发、完整 Controller/Guard 和宿主未验。原 CAT-GOV-08、两组不同动态组合及完整结项门槛保持；Core 作者继续后续治理，治理入口 `48e1b6807` 另待 QA，未一并收取。其他 main 工作区改动未纳入本片。

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
