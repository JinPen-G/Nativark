# CA05 持久请求双步骤订单解释宿主接入

共同固定基线b0ed18f3c3b4c8ba40a220b93284c494d9a8c24e，A树/ai/codex-ai-native-lane-a-20261007。只改认领的request-bound-scenes.application.ts、original-scenes.module.ts、original-model-order-scene.composition.ts及本记录；tests/fixtures、公共HTTP合同、Auth/Guard、model-input/runner、Gateway/budget/shared/schema/UI不改。旧output保留。

## 装配与真实调用

在原 `composeRequestBoundPersistedOriginalSceneModel` 增加 **server-only** `options.orderReadChain={enabled:true,inputSource:<正式源>}`，未配置继续旧单模型application。原Bearer解析、请求私有credentials、Guard/ALS、原请求/task绑定沿用；原 `composePersistedTaskCallGateway` 生产唯一持久runtime/priceVersion/financialEvidence，不接受调用者runtime或runServices，也不注入恒真依赖。

服务器选双步后调用原model.createModelOrderApplication(host,{inputSource,financialEvidence,clock,monotonic})。真实inputSource方法在装配时绑定，缺方法、非order_explanation、非tools策略或structuredOutput冲突拒绝。新启动的材料、两工具policy/limits和当前资格由原源复核。历史读取使用readHistorical和task当前read动作，不把创建政策/新effect gate当历史结果读取许可；start仍在原prepareTaskMaterial中核验有效创建政策。

原根对外可调用start/recover/reconcile/readExecution，双步附加readOrderResult/readTaskScene/readNextSteps/readTaskSnapshot；model结果与原来源读取同样只传originalRef，服务器解析原model步骤/resultRef，再走原result/source当前授权服务。外部不能给task/run、工具、prompt、Runtime或limits。已有旧单模型plan不能通过此入口升级；当前双步read/restore仍核验固定原两步plan hash，不新建run/改plan/派发重连。

新增 `AiOriginalScenesModule.registerPersistedOrderReadChain` 复用原registerPersistedRequestModel provider factory，导出专用AI_ORIGINAL_ORDER_READ_REQUESTS token；没有controllers、AppModule或worker。必须显式给orderReadChain，否则拒绝。原 `registerHttpPersistedModel` 拒绝双步选项，防止把仅原引用方法硬绑定旧单模型HTTP形状；公共HTTP冻结发布由主线处理，不猜地址，不同时双驱动。

取消直接转原root.taskTransitions当前动作权限/CAS，只返回requested_not_rollback；不另造cancel状态或无证据结算。双步没有独立合法输入resume/refresh、quote或人工holder接管协议时明确RESOURCE_UNAVAILABLE，不回落旧单模型方法、重发或伪造成功。接管所需公共补丁：原双步组合安全暴露task/run/current revision+fencing绑定的holder转换与旧输入固定恢复入口，由主线runner负责，A未修改底座。

## 验证和准确失败

未新增或修改任何测试脚本/fixtures。内联 `node -e` 通过原双preload、固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_WRITE_ROOT=A树，TEMP/TMP=本树output，AI_OFFLINE_AUDIT绝对本树路径。使用既有originalModelApplicationHarness与createTaskInputStore作为数据库/外部边界替身。

定向source Compiler API noEmit初次exit1/4诊断：新增应用方法变mandatory使旧Controller结构类型不兼容，且双步/旧单步返回值的泛型推断不兼容。只调整本片新方法为双步选项下存在、async统一union推断，保留旧返回形状；后续0diagnostics/exit0。只检查original-scenes.module.ts和实际依赖源码，不宣称全API/build。

直接冒烟首轮exit1：inline数据库替身缺ProviderProfile完整Prisma delegate，正式生产者正确抛AI_PROFILE_PRISMA_UNAVAILABLE，不能算产品红测。仅在inline采用原store完整delegate，不改生产检查/测试文件。最终audit=output/ca-bound-order-smoke-final-20261013.audit，exit0：正常request-bound原order facts/model result/source reopening/recover/scene聚合；非法task绑定拒绝；takeover缺端口拒绝；撤权拒绝；run保持1、formal adapter派发0。原合成结果由前一既有两步宿主在离线transport/财务替身下先产生，再由正式请求root实际composePersistedTaskCallGateway及原仓储读回；绝不能称这是正式Gateway首次模型＋真实预算成功或live能力通过。

本片未提供真实发布配置/能力/预算证据，所以正式新start正向链及unknown lease宕机恢复没有运行验收；原恢复实际调用既有recoverOriginal，不重发逻辑保持，但本次终态读回冒烟不能替代unknown故障证明。这些由主线集中组合验收补齐，不用“只剩环境”笼统替代缺证据。无真实HTTP/DB/DNS/存储/模型/支付、迁移执行、生成或生产启用。

git diff --check exit0；tests/fixtures diff为空。仅提交认领四文件；命令级core.hooksPath指向本树output/ai-native-no-hooks，避免未知hook读取env/启服务，不称常规hook通过。

## 主线精确依赖与可替换性

主线需冻结/发布双步原ref动作readOrderResult/readTaskScene/readNextSteps/readTaskSnapshot/model-result/source-read的公共合同/Controller/OpenAPI/Guard，以及受控选择此模块的server配置。当前专用token为可调用内部应用，不是已上线HTTP。tools live能力证据、财务calls政策/priceVersion、当前权益、正式inputSource和单赢家派发证据仍必须真实装配，缺依赖拒绝。

Runtime替换只换原组合内部宿主，不改变原request/input/两步骤plan/artifact/账本事实，也不在旧unknown上双跑；Provider类型仍局限原Gateway适配，server root只消费稳定生产者。当前不安装Runtime/Provider SDK，不生成空通用平台。源码交付不等于AIN整项验收。
