# CB07 冻结模型输入的知识消费复验

前置 `25357603`。仅本线knowledge两服务、既有测试与本记录；不改A、model-input、runner、Gateway/shared/schema。

## 已有真实消费者（不重写）

`composeKnowledgeFileApplication.sceneKnowledge(includePreferences)`沿213d26ce返回同一Knowledge专用文件runtime/政策/Memory依赖，供现有 `composeAiOriginalSceneModel` 的 `knowledge` 参数消费。

实际既有链：`prepareHeldRun`→`knowledge.collect`→原业务事实/知识/偏好分区→`taskModelMaterialSchema`→原`model.publish`持久冻结→原`savePlan`。执行器读取原`AiTaskActionInput.payload`、`parseTaskModelInput`和`readOriginalSceneEnvelope`后，执行前、原routing.assertCurrent发送前回调、执行后分别调用同一`knowledge.revalidate`；结果服务再复验并用原source入口重开。这些A/公共文件本次仅只读，未新增第二消费者或冻结格式，代码存在不等于本轮跑了整条真实模型链。

## 实际补齐

- 红测证实：保留read_body/resolve_source、撤销search后，旧scene知识包原本仍能复验成功。
- `HumanKnowledgeContextService.revalidate`现复验当前全局search、逐文档search及正文/版本/hash/ACL，正文等待后再核验文档，末次全局search grant保持一致。独立open仍只要求原来源打开权限，不把已知引用打开与再次检索消费混淆。
- 第二红测证实：知识复验完成后，在Memory确认读取await期间撤销search，旧组合包仍可能返回。`HumanKnowledgeInputService.collect/revalidate`在实际偏好读取后有界重验原知识材料；不静默换版本/片段，不修改旧指纹。
- 上述方法由既有persistent composition及原scene revalidate自动消费，无孤立类、无新端口、无新模型调用。旧Memory确认/到期/撤销验证原样复用。

## 快检

复用原文件单项：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='first creation uses' tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`。

固定无效DATABASE_URL，AI_OFFLINE_AUDIT/TEMP/TMP在本树output/inspection-lb05-tmp。第一次红pass0/fail1/skip0/todo0 exit1（search撤权未拒绝）；修后追加同一项的偏好await场景，红pass0/fail1/skip0/todo0 exit1；完整修后同项pass1/fail0/skip0/todo0 exit0。该项同时驱动原附件上传、文档创建/解析/索引/发布、正式确认记录、原scene collect/revalidate及withdraw；DB/Auth持久来源/对象传输为显式离线替身，无新增测试脚本。

API原tsconfig noEmit程序检查（本树私有Prisma/shared源码映射）DIAGNOSTICS=0、exit0；git diff --check exit0。未运行全仓矩阵、真实MySQL、S3、模型、HTTP或设备。

## 保留边界

复验与模型派发不是跨资源数据库原子事务；原消费者已在Gateway当前路由检查回调重复复验，但不能声称跨系统零时间窗口。正式动作政策的可信置备、文件配置、Memory政策/确认及Gateway依赖仍由合法服务器装配，缺则unavailable；不得用本次测试grant当生产授权。已公开消费接口存在，无需主线新造DTO或端口；本次不安装LangGraph/SDK、不登记invocation、不扣第二账本。
