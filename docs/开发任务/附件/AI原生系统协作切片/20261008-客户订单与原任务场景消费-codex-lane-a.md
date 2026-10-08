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
