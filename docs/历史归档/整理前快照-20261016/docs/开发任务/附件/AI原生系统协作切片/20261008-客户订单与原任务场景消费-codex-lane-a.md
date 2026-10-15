# CA08 客户订单与原任务场景消费

父32daf820；仅A树。主线续派客户受权场景消费，本片不接CA06/07公共冲突、不改原Client/Auth/Core/schema。

## 可调用功能

现有`composeRequestBoundClientApplication`增加：

- `readOrderExplanation(request,{orderId,question:'status'|'fees'})`：当前发布渠道→真实ClientAuth/ApiAuthGuard/ALS→ClientApiService.getOrder本人归属检查→封闭事实投影→读后身份/发布空间复验。status不回金额，fees只保留原ClientOrderView金额字段；零保留，缺失/非法金额unknown，不计算实收、退款或收费。
- `readTaskScene(request,{creationKey,materialRef,question})`：现有持久材料scope/session绑定及当前来源复读→原client task policy.read→原AiTaskCreationRepository.readCreation→对应订单事实→同一创建收据再读复验。不按taskId任意找任务、不借operator权限、不新建任务/租约/模型。unknown仍unknown，不从订单状态推出task成功。

来源有原orderId/字段/updatedAt（缺版本明确null），无客户姓名、地址、内部备注、成本、其他会员及操作人；未实现付款/退款/历史报价/allowed-actions保持明确缺口。不生成模型文本，不创建审批/取消/支付行为。capabilities说明只支持原创建收据和订单事实，不伪称已实现客户事件/恢复/模型。

## 快检

没有新增测试脚本，扩既有`client scene authenticates`实际组合：真实ClientAuthService、ApiAuthGuard、ClientApiService和任务创建仓储，底层session/业务/事务为离线替身。

定向1pass/0fail/0skip/0todo，退出0：本人订单、零/缺金额、status最小字段、未知问题拒绝、其他客户拒绝、读期间注销、原任务读回不增create、allowRead撤销拒绝、会话变更拒绝。此前原测试的COMMIT应答丢失及原键核对断言保留。

环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT为本树output/ca08-client-consumer.audit；TEMP/TMP为本树output/lane-a-original-request-tmp。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates' tests/ai-native-lane-a-original-scene-host.test.cjs`

API源码noEmit：原apps/api/tsconfig.json strict不变，rootDir/baseUrl为本树，paths只改到本树shared/src/index.ts及私有Prisma/index.d.ts，noEmit:true/incremental:false，getPreEmitDiagnostics=0/exit0（output/ca08-client-types.audit）。diff check退出0；未写共享生成物。无新增深度矩阵。

## 尚缺正式依赖

任务创建读回不是当前任务状态/事件/执行结果。现有客户政策只提供create/read及原creation收据；需要主线给客户动作授权、owner/session/channel绑定的task snapshot/event/terminal-result正式端口及运输合同，不能复用operator task facade。当前材料五分钟有效期/同session约束仍保留，历史长期读回与重新登录迁移没有放宽。

客户资金、历史quote、检查异常来源需原ClientApi合法专用入口；本片不调用运营orderPayments/inspections。真实HTTP host未注册，模型/runner/审批未启动，MySQL/供应商/支付/浏览器/微信/设备/生产未验。Runtime可继续消费此业务应用；Provider仍归唯一Gateway，当前不安装或迁移。

## 2026-10-09 Action 与 Booking Draft 后端包（待主线组合复验）

起点实测 `f10e80daa65315487ff18a9770889903f7929c49`，四辅助树相对该固定点均0/0、tracked/index干净、无MERGE_HEAD/CHERRY_PICK_HEAD；仅历史output保留。本会话按负责人确认的 **codex A原树对话** 认领，不按所用模型名称另行推断写入者；主线确认独占。本包对应需求v1.6 §18A及任务v1.9 0A，不改原28项状态、不重做已整合任务中心。

### 入口与实际边界

公共叶子为 `packages/shared/src/ai-entry-action-draft.ts`、`ai-booking-draft.ts`，版本分别为 `ain-entry-action-draft-1` / `ain-booking-draft-1`。产品audience到既有授权audience的映射显式导出；本包只消费customer/client。注册表中只有OPEN_ORDER、CREATE_BOOKING_DRAFT、OPEN_BOOKING具备后端接线，其余代码明确unavailable；注册表不是执行授权，也不代表端页面已注册。

现有 `composeRequestBoundClientApplication` 新增服务端配置 `entry:{enabled:true,releaseRevision}`，省略即关闭新入口；同时必须提供原 `tasks` 依赖、当前客户场景政策、三级gate及ai.native.use权益。web映射tenant_website、wechat_miniprogram映射client_miniprogram；app和跨端转移保持不可用。既有材料/任务/只读订单入口不被移除。没有AppModule、HTTP、Worker、模型工具或前端页面注册。

实际调用顺序：

1. OPEN_ORDER：原 `prepare(request,{operationKey,command:{kind:'order',orderId}})` 得到持久materialRef；`issueAction(request,{actionCode:'OPEN_ORDER',materialRef})` 签发。`readAction(request,action)` 用于展示复验，`consumeOrderAction(request,action)` 返回固定code/orderId/surface/scope，不返回任意URL，不宣称导航或业务已完成。
2. Booking：原 `prepare(request,{operationKey,command:{kind:'booking_quote',selection}})` 接收用户明确条件；selection必含本人已有quoteId、timeZone、绝对startAt/endAt、履约方式/地点、明确预约身份及1～20条商品数量。相对时间、伪造source/确认/金额字段拒绝；时区必须等于正式目录空间时区，不用设备时区猜测。此调用只保存AI材料，不调用createQuote。
3. `issueAction(...,{actionCode:'CREATE_BOOKING_DRAFT',materialRef})` → `createBookingDraft(request,{operationKey,action})`，生成draft_created。Action全量严格schema校验，绑定当前Auth/Guard、发布空间、端、资源内容指纹、输入/主体/政策指纹和有效期；客户端回传不能授信，task/proposal非适用关联明确null。
4. `chooseBookingDraft(request,{operationKey,bookingDraftId,expectedRevision,inputFingerprint,decision:'continue_booking'})` 是显式人工选择入口，不注册为模型工具。CAS成功后user_selected，selectionRevision=1，返回OPEN_BOOKING。`decision:'abandon'` 只终止草稿。
5. `handoffBookingDraft(request,{operationKey,action})` 生成同端短期handoffRef，状态handed_to_booking_page；`readBookingHandoff(request,{handoffRef})` 是原页面读取接点，再验所有事实，仅输出有界已确认字段及quoteId。引用最多60秒且不超过草稿期限，可重复读取但不刷新期限；这是后端交接，不是页面已经打开或请求已提交。
6. `readBookingDraft(request,{bookingDraftId})` 复验原材料与当前事实；`readBookingOperation(request,{operationKey})` 仅按当前身份/发布范围查询原键的最小持久收据，不输出草稿字段或可执行Action，不由收据推出业务成功。未观察到仍unknown/retryable:false，不重发。收据中的handoffRef仍必须走有权限且未过期的readBookingHandoff才能取得字段。

原 `client-scene.composition.ts` 只增加受Guard前后保护的 `GET quotes/:id`、`GET membership/booking-options` 消费；继续实际调用ClientApiService.getQuote、bookingOptions、catalog、availability。订单/报价/可用性不从模型生成；报价金额、币种、规则/价格引用原样取正式结果，缺必需依据拒绝，缺可选版本明确null；不推算价格、押金、库存或成功。

`client-booking-material.ts` 将显式选择与本人报价request/membershipSnapshot逐项核对，复查当前公开商品、取还地点能力、空间时区、企业有效关系和同条件可用性。输出只含最少事实及原值/内容指纹，不保存报价中的完整会员资料、地址、条款或内部库存明细。正式默认/Core规范化（例如省略归还地点）与用户明确字段分别标来源；模型候选不能通过客户端自报升级为确认。目录/可用性无原生修订号的部分使用**观察内容哈希**，不是虚构业务版本；未被观察到的短暂变更不能据此声称已检测。

### 持久化、幂等与失效

追加三模型及独占迁移 `20261009130000_ai_client_booking_drafts`；旧模型只加AiClientSceneMaterial反向关系。PrismaClientBookingRepository使用参数化Prisma.sql/$queryRaw/$executeRaw，未虚构生成delegate。材料→草稿→操作/交接复合外键包含tenant/workspace/channel/principalKind/principalHash，RESTRICT；迁移字段字符集/排序规则与原材料表匹配，操作键/引用区分大小写。

- materialRef唯一，防同一CREATE_BOOKING_DRAFT Action换键产生第二草稿；原操作键+hash防同键异参。事务中创建草稿和原操作收据，选择/交接/放弃用锁及revision/state CAS并在同事务写收据。重复交接复用唯一handoffRef，不延长TTL。
- 主链为draft_created→user_selected→handed_to_booking_page；stale/expired/abandoned不可复活。读取观察到依据/企业关系/权限变化时记录stale；期限到达记录expired；重新准备需新的材料/原操作键，不能改旧行恢复。
- Action来源观察到失效后，以原材料仓储追加保留 `entry-invalid:<materialRef>` 私有失效收据，不修改或删除旧材料。签发/展示/消费都查该收据，已观察到的失效不会因库存后来恢复而重新变为有效Action。它不是公共material kind或新业务动作。
- 保存事务COMMIT应答丢失、写后授权复验失败均保留unknown，核对原键；无自动报价/建单/支付/退款、无换ID或换Runtime重派。内存SQL替身不证明真实MySQL串行化、锁或故障行为。
- 草稿最多五分钟且不超过原材料、报价、政策和租期起点；交接最多一分钟。到期代表不可再用，不删除业务/审计事实；生产留存清理仍需按既有政策整合，本包不新增清理作业或永久客户端缓存。

### 明确不可用及公共整合补丁

1. `ClientApiService.createQuote` 有正式持久副作用且当前接口没有本包可用的原操作键查询契约，所以只消费本人已有quote，绝不把createQuote当只读重试。
2. `submitted` 只在合同状态表中保留，本包没有写入者，也没有接收submitted布尔值的API。缺的是**原预约页面/ClientApiService.createOrder正式受理收据与handoffRef、客户、空间、输入哈希的可验证关联**；consumedOrderId或导航本身不能证明本次交接提交。主线补齐前能力为unavailable_original_page_acceptance_receipt_missing。
3. 含配送地址/一次性地址的报价暂拒绝：当前认领的ClientApiService消费端口没有地址最新归属/版本复验。含增值服务的报价也暂拒绝：当前availability只覆商品，不覆服务容量。需要主线冻结这些当前事实读取合同后再装配，不绕到内部Core或文件服务；未将这两类说成已支持。
4. 主线需在 `packages/shared/src/index.ts` 精确追加 `export * from './ai-entry-action-draft';` 与 `export * from './ai-booking-draft';`；再将本包scenes中指向这两个叶子的相对导入统一改成公共 `@rental-os/shared` 导入，并整合对应OpenAPI/端固定Action映射。当前仅本树源码路径验证，不声称正式shared发布或API构建完成。
5. 真实浏览器/微信导航、原预约页字段消费、真实DB迁移/并发/故障/外键、模型/支付均未验。无生产开启授权；传统预约页面原入口完全保留。

### 本包实际验证（不可升级证据等级）

- 只扩原 `tests/ai-native-lane-a-original-scene-host.test.cjs` 的client scene authenticates用例，未新建测试脚本；覆盖合同拒绝、受权签发/重复消费、草稿创建/明确选择/交接、原键丢ACK、同键异参、观察到库存变化后的失效不复活、企业撤权、跨会话、到期及无submitted/建单。底层SQL/会话/业务事实为明确替身。
- 首片执行原定向命令（与上节同名用例）：**0 pass / 1 fail，退出1**，在模块加载时因旧私有Prisma缺少RentalTenantBusinessSettings.settingsRevision发生9项TS错误，尚未运行用例体。不改transpileOnly:false、不忽略诊断。新增最终Booking断言尚未获得运行通过证据；不反复重跑同一已知编译阻塞。
- 对8个本包TS入口用Compiler API/noEmit、原strict、shared源码及本树私有Prisma路径验证。首轮本包1项“location.capabilities可能缺失”已改成缺失即拒绝；复验本包入口0诊断，依赖仍25项旧client不匹配诊断（settingsRevision、通知/退款revision、aiBusinessFailureOutbox等），**整体退出1，不是类型全绿**。两份明细保留在本树 `output/entry-booking-tmp/types.json` / `types-final.json`，不是提交内容。
- 最终既有测试文件 `node --check` 退出0，仅语法证据；git diff --check退出0。源码最后增加的失效时间复查不改变公共类型。
- 每条Node均带原prisma-offline-preload；固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT、TEMP、TMP为本树绝对output/entry-booking-tmp，cache为其cache子目录，audit分别指定该目录action.audit/types.audit/types-final.audit/syntax.audit。preload仅拒绝时写audit，未生成文件不伪称有审计文件。
- 主线已确认：保留遗留生成锁、client.previous与temp；没有可交付的新隔离生成入口，本包先交源码并单列阻塞，由主线认领后处理联合schema/client复验。未运行生成器、安装依赖、启服务、读.env、真实外联、改共享生成物、运行迁移、push或合main。

### Runtime / Provider 独立替换与回退

当前继续自研，不安装LangGraph或Provider SDK。Runtime仅编排稳定Action、客户材料、Booking应用和原Task/Tool/Proposal/Core端口，不持有客户权限裁决或新业务提交权；Draft/Operation/Handoff与失效收据是持久事实，不是框架checkpoint。Provider类型仍只允许Gateway适配层，本包不触Provider协议、唯一Gateway或预算单账。

未来替换Runtime只替换上游编排，保留原Auth/Guard、发布空间、客户/企业复验、唯一Gateway/预算、审批/Core及原键收据；未知结果不得换引擎重发。Provider迁移独立，不影响Action或草稿合同。停用回退为撤下entry显式装配/当前政策并保留原人工页面；不删除旧源码、测试或已写收据，不将旧草稿迁给新身份/新端，也不把未验证状态交给新Runtime续跑。
