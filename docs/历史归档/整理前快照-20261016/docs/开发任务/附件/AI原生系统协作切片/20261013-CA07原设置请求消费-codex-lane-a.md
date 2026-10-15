# CA07 原通知设置请求消费

本包只改 A 树 request-bound-scenes.application.ts/original-scenes.module.ts。固定依赖 f801 已包含；不追活动主线、不安装 Runtime/SDK、不改公共核心/Controller/shared/测试脚本。

## 实际入口

`composeRequestBoundSettingsTask(dependencies, options, configuration)` 与 `AiOriginalScenesModule.registerRequestBoundSettingsTask` / 本地 token `AI_ORIGINAL_SETTINGS_TASK_REQUESTS`。

方法：readCurrent、prepareChange、readChangeReceipt、readBusiness，以及对齐原公开路由名的 startSettingsTask、readSettingsConfirmation、decideSettingsProposal、readSettingsDecision、continueSettingsConfirmation、reconcileSettingsTask、cancelSettingsTask。当前请求 Bearer 经原 bindRequests/ALS，凭据只在本次请求内有效；host/task/change/limits 只从服务器配置深拷贝。任务动作绑定固定 taskId/runId；readBusiness 也核 preparation 所属任务，不借另一设置任务的数据。

使用原 composeApprovedSettingsApplication、composeTaskSettingsHost 与 settings-business-consumer；不套 order confirmation，不自行批准/写活动配置，不创建第二运行器/资源账本。prepareChange 是原受权不可变变更准备，不代表 Task 已创建/审批或发布；原 changeKey 收据不因未观察到而重发。执行仍须原持久输入/计划/权限与审批消费/Core 事务具备。

## 实际发现与修复

首个内联冒烟：读取当前设置提前构造 runner，缺执行 plan source 时 RESOURCE_UNAVAILABLE。修为 lazy host：readCurrent/prepareChange/readChangeReceipt 只构造合法设置应用；只有任务动作/聚合收据才构造原 host。默认模块/factory 零动作，缺执行依赖仍拒绝。

复验直接 `node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e <实际模块/provider/request调用>`，ts-node非transpileOnly；固定无效 DATABASE_URL，本树绝对audit/write-root/TEMP/TMP。实际 Auth/Guard/ALS/设置domain消费者：readCurrent读revision1、原changeKey不存在保持not_observed、跨task start拒绝、撤权read拒绝；change/operation表无新增。数据库及Core当前配置源为离线替身。**exit0**；不是 settings审批/执行全正向。

必要 Compiler API noEmit根original-scenes.module.ts，API tsconfig、本树shared源/隔离Prisma声明：lazy修正后0 diagnostics/exit0；diff check通过。tests/fixtures无变更，没有新增脚本；不运行全仓回归。

## 精确未接依赖

1. 原 `original-scenes.controller.ts` 七个settings路由目前属于旧fullModel Controller（配置包含旧model runtime）。正式持久模型ActionsController没有这些settings路由。当前独立token可被服务器注入，但不是新HTTP端点；主线已明确认领独立 settings-task.controller.ts/settings-task-http.module.ts，固定交付后由A组合消费。现七方法已对齐原路由名，不能把本地注入说成HTTP已接通，不能重复注册同七路由。
2. 此消费者不创建任务元数据或seed plan政策；宿主须提供原变更→Task关联及完整当前授权/审批政策。没有这些不会自动启动；准备成功不代表运行/发布。
3. 当前settings执行正向、COMMIT应答不明、真正MySQL/HTTP/模型/支付均未验。

## 固定 HTTP 依赖接入

已同步主线 c269479dbcf61e2246f7e1bda52e6236007bf18f，merge 58f5d0bc8e0ed3a81f6a130daa6f96b2e23d7fad；包含主线固定音频/政策等历史，仅同步保留，不宣称A实现/验收这些能力。未修改主线新 Controller/HTTP module。

新增 `AiOriginalScenesModule.registerHttpSettingsTask(input?)`：无参数/未启用时消费公共模块默认关闭分支，无 controllers/providers；显式enabled时把本线 registerRequestBoundSettingsTask 和实际export token交公共 AiSettingsTaskHttpModule，由原 alias factory严格校验并绑定七方法。它是独立替代旧fullModel settings七路由的宿主选项，宿主不得双注册；不装配AppModule或自行启用。

一次直接内联实际新组合→本线provider→公共alias→真实AiSettingsTaskController：默认关闭、current revision读回、changeKey缺记录not_observed、跨task start 403、撤权current读取拒绝、无任何change/operation写入。缺执行plan source的confirmation返回404/AI_RESOURCE_UNAVAILABLE，首轮误期望403/503导致exit1；修正证据分类后exit0，不改生产拒绝或越过缺依赖，不将该动作拒绝说成撤权正向。此处Core配置和DB仍为旧离线替身；本线没有再重复主线的完整WAITING_CONFIRMATION冒烟。

必要noEmit根original-scenes.module.ts再次0 diagnostics/exit0；diff check0、tests/fixtures无变更。主线c269的实际等待正向属于主线作者证据，本线只证明消费者HTTP接线与上述范围；批准后Core执行、COMMIT应答不明和真实HTTP仍未验。

## 客户链只读核查与下一步

现有 client-request 已有create/read/choose/handoffBookingDraft、readBookingPreparation/Operation和原人工页accept/submission消费，不重写。ClientApiService:985 的 createQuote 当前消费正式Core，但现有client-scene仅公开getQuote只读，没有原AI操作key的受权R1签发/原键读取消费；不能把后台quote authority移给客户，也不能unknown后再createQuote。后续先向主线报该调用点与原操作关联需求，再复用已有客户Booking链，不造通用客户权限或新HTTP协议。
