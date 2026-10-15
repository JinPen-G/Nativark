# CA05/CA09 原订单模型到只读事实的场景消费

基线 ebc036ea81cf01f3f8e60cc5120338affcfff75e；仅 codex-ai-native-lane-a / ai/codex-ai-native-lane-a-20261007。复用五树固定整合成果，不恢复旧stash，不改中央进度或完成率。

## 可调用入口与实际链

`composeAiOriginalSceneModel(serverDependencies).createModelOrderApplication(host, runDependencies)` 返回 `start(originalRef)`、`recover(originalRef)`、`readOrderResult(originalRef)`、`readScene(originalRef)`、`readNextSteps(originalRef)`。此为显式server-only入口，不注册HTTP/worker/AppModule，不接受messages、task/run、lease、limits、actor或scope。原 `createApplication` 单模型流程保持不变。

新增 scenes/original-model-order-scene.composition.ts，连接主线原 composePersistedModelOrderTaskRunner，而不是复制执行引擎。当前身份/原请求/当前task读取与原hash/revision绑定，目标订单由原请求取得。新启动从受权prepareTaskMaterial与同scope/scene/version政策取材料/限额，至少允许两步骤/调用；已存在计划或任何该run动作输入时拒绝重新准备，不能覆盖原单模型计划。

原组合在领取同一run后，先冻结 `scene-model:<inputRef>` 和 `scene-order:<inputRef>` 两个输入，再保存不可变两步计划。唯一Gateway/原预算单账执行模型，模型仅提出固定order.explain候选；原组合校验原模型收据与预登记订单输入一致后调用原Guard/ALS/Core订单reader，保存持久结果。不创建新run，不建第二账本/审批或业务写操作。

恢复和读回从同scope/task/run持久计划、原model输入/指纹重建宿主，核对计划hash与固定步骤，沿原 `recoverOriginal` 与 `readOrderResult` 调用。不重新读当前事实来发布新输入，不续派unknown，不换引擎/ID。订单结果由服务器解析原order步骤/resultRef，不查最新其他任务结果；unknown/failed/未执行候选/实际事实/stale保持不同，业务语义始终readonly_not_business_commit。

任务中心复用 composeAiTaskCenterScene，新增可选orderFacts正式reader和readOrderFacts方法，原请求/task/run读前后绑定复验；旧未配置consumer输出保持不变。新场景readScene由服务器选择原model resultId，聚合原snapshot/游标、model候选与实际orderFacts，独立读取不宣称原子快照，不把SUCCEEDED当Core committed。读回生成文本仍不可信，不覆盖事实。

下一步入口消费原 tools.orderNextSteps(orderId).read(currentContext)：返回有来源的candidates_only/人工出口、缺当前allowed-actions依据，不执行动作、不发审批。报价选择→原quote receipt→人类审阅/批准/原order结果和通知settings准备/decision/operation消费者在固定基线中已经接通，直接复用 request-bound-scenes/human-quote-order/settings-business-consumer，不重造同义类。通用分区配置执行依赖未交付，保持不可用，不借order.commit。

## 验证（不增改任何测试脚本/fixture）

双preload：prisma-offline-preload.cjs、lane-b-local-runtime.cjs；DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT=A树绝对路径；TEMP/TMP=本树output；AI_OFFLINE_AUDIT亦本树绝对路径。

直接 `node -r ... -r ... -e <inline smoke>`，只复用既有 originalModelApplicationHarness，ts-node transpileOnly:false。配置两工具政策在创建原请求之前完成；实际原场景、runner、Prisma仓储适配、Gateway业务组合执行，数据库/transport/财务边界仍原离线替身。首轮exit1因inline准备在创建原请求后修改policy，正确触发AI_REVISION_CONFLICT，不计产品缺陷，未放宽政策。修正准备顺序后执行原请求启动/原结果读取/原聚合，exit0。

最后相同受影响直接冒烟（audit output/ca-model-order-final-20261013.audit）exit0：实际两步骤成功，model调用1、run1；非法task字段拒绝；重复start拒绝；重建宿主recover不重发、plan不变；原order result与场景model/orderFacts均available，下一步candidates_only/not_attempted；撤权后读取拒绝。不增加测试脚本、不跑全矩阵、不声称Node test pass数量。

源码检查：直接node -e TypeScript Compiler API，现有API tsconfig仅JSON，noEmit/incremental:false、rootDir/baseUrl=A树、shared映射源码、Prisma映射本树隔离client；根入口original-scene-model.composition.ts及其实际依赖，0diagnostics、exit0。非全API/build。git diff --check exit0；tests/fixtures diff为空。无共享生成物变更。

## 装配要求与未验

调用方必须提供server scene=order_explanation、gatewayScene.orderExplainTool=true、真实当前授权/计划政策、priceVersion、唯一runtime以及financialEvidence.readDispatch和正式AiTaskInputSource；不以默认成功/恒真授权代替缺依赖。原source要求两工具政策及足够持久累计资源限额。材料/工具/价格不由前端或模型自授。

HTTP发布、选择此双步骤host的公共request-bound接口归主线；本片仅server组合，不改公共合同。原运行器恢复仍负责lease/fencing/unknown；领取后但计划未保存的故障恢复需要主线原runner/输入证据判定，不由场景重发或伪造完成。没有验证真实故障矩阵、MySQL行锁、HTTP/模型/支付或部署/生产。

Runtime替换时保持原请求、两登记输入、plan hash、step/result和Gateway收据作为Rental OS持久事实；新Runtime不能替换成另一套checkpoint判定或同时双跑。ProviderSDK仅原Gateway传输适配，当前不安装/迁移；本片不依赖SDK类型。不宣称AIN05/06/09或整个底座验收完成。
