# Codex A 总册接续：人类报价选择

继承 HEAD：69c753084c928e0c48271ccccb62f5c6ac044002（Claude WIP）；原树/原分支，无未完合并。负责人已确认原作者停写。本记录只认领A，不修改主文档、06/07、Gateway或Core。

## 本片实际功能

- 复用独立 AiTaskQuoteSelection 及已提交迁移，未重写迁移。保留当前身份、原请求、task/run、当前Core报价校验、不可变载荷/报价hash和选择幂等键；选择不授审批。
- AiHumanQuoteSelectionModule.registerHttp 可选装配 select/read/reconcile。真实会话与原Guard在仓储内复验；HTTP不接收租约、不暴露发布/审批、不自动注册AppModule。运输目录在A独占 shared 叶子 AI_QUOTE_SELECTION_HTTP_DRAFT，总出口交主线。
- composeHumanQuoteOrder / registerApplication：publishSelectedInput只从持久化选择读取body，派生 quote-selection:<selectionId>，调用原publishOrderInput；prepareSelectedProposal核查原step→input→selection的hash与registrationRef，再调用原受控prepare。不得由外部传另一份order body。运行租约与步骤启动归06，人类审批/提交归07。
- 原task锁下拒绝在已有order输入或已冻结plan的run中创建另一选择；原键重放不替换。需要改需求时重发原请求/新run。
- 发布/准备前后重新验证选择；它们是独立事务，后校验失败可能已留原输入或pending proposal，不能称原子回滚/未提交。此应用不执行订单、不声称端到端已闭环。

## 定向快检

只新增一份两项冒烟，不扩全矩阵。驱动真实Auth/Guard/Subscription、Core报价/匹配、原请求/选择Prisma适配及应用composition；数据库/政策数据为离线替身。

环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/output/lane-a-ca02-audit.log。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-human-quote-selection.test.cjs`

最终2 pass /0 fail /0 skip /0 todo，退出0。先遇到夹具错用getQuote参数、误传Core内部行快照字段、组合缺结果artifact delegate，已修夹具，未放宽产品校验。先前仓储版2/2不能与最终应用版相加。

同preload、audit本树output/lane-a-ca02-types-audit.log：`node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--rootDir','.','--noEmit','--incremental','false'];require('typescript/lib/tsc')"` 退出0。采用已有整树rootDir检查；非默认API build，shared叶子总出口仍缺整合。

## 准确剩余与下一步

CA02仓储/显式应用/运输代码可用；本次未运行合法held lease→真实运行步骤→pending审批的正常组合，也未验证新HTTP网络运输。不能据2项冒烟宣布CA02、CA05或AIN15全链完成。CA01已有原请求代码复用，公共出口等待主线。继续固定81db55a7模型输入依赖与06同租约准备宿主消费，再做CA03/04/05；CA06/07合法业务写端口、CA08客户独立身份链、CA09公共结果需逐一核查，未实现不计完成。

Runtime替换只消费原引用、指纹与租约，不改变本片选择事实/批准提交点。Provider替换仍只在唯一Gateway适配层，本片无SDK类型。回退装配可停止注册新模块，保留持久选择与历史，不重派unknown、不改原审批收据。

未验：MySQL/迁移执行、真实HTTP/模型/支付、浏览器/设备、生产。无安装/启服务/读.env/外联/共享生成物写入。

## CA03：原请求事实到模型输入/计划的装配（本次）

已将固定依赖 `81db55a77f6c6119b6bce19280d1b02a9437e5d9` 合入本线，合并提交为 `0376c084384668053b799aa30850ac8cf94a18b3`。新增 `composeAiOriginalSceneModel` 与 `original-scenes.module.ts` 的可选 `registerModel` 装配：它复用原请求、历史事实、任务收据、持久化模型输入与计划端口，要求同一 inputRef、task revision、身份和受控运行租约；模型输入发布前不启动 runner、不调用供应商模型、不创建审批或业务写入。输入正文以不可信业务数据封装，结果只返回冻结的 registration/input/plan 引用和明确阶段。

### 本片验证

- 人类选择既有定向冒烟：2 pass / 0 fail / 0 skip / 0 todo，退出码 0。
- API 隔离 TypeScript 检查：退出码 0。
- `git diff --check`：在删除临时红测后重跑，预期仅保留行尾提示；本片提交前必须以实际退出码为准。

曾临时尝试用扩大的合成夹具直接驱动 held-lease→模型输入，但因缺少可信预算/动作策略/权限关联而被真实授权门拒绝；已删除该临时测试，不把替身补表当作生产接通证据。CA03 的生产组合代码已完成静态类型验证，真实模型/数据库/运行器组合仍未验，不能称 CA03 或 AIN06/15 完成。下一步继续核对 CA04 订单解释消费入口和 CA06 业务差异准备，缺正式结果/审批端口保持 unavailable。

## CA08：客户身份隔离的只读宿主装配（本次）

新增 `apps/api/src/modules/ai-native/client-scene.composition.ts`。该叶子只接现有 `ClientApiService` 和由 `ClientAuthService`/客户端路由创建的 `AiClientSessionSource`：游客只能读取已发布渠道 bootstrap/catalog；登录客户只通过当前会话读取白名单目录、可用性、本人订单、本人订单详情和企业身份候选。每次成员操作重新取得会话，拒绝缺失/非 active/非 personal-or-corporate 上下文；订单归属和发布过滤仍由现有 ClientApiService 复核。

适配器不接受模型传入 tenant/workspace/customer/token，不复用 operator/staff 工具，不注册路由，不执行报价、支付、取消或业务写操作。当前仅完成可被未来客户宿主显式导入的实际组合，真实客户端 HTTP 接入与匿名登录迁移仍未接通；不把该组合称为 AIN-21/22 完成。

## CA04：订单解释结果校验边界修复（本次）

修复 `AiOrderExplanationPreparationService.validateGenerated`：金额或支付来源被拒绝/未加载时，事实对象只有 coverage、没有 `value`，校验器现在保持 unavailable，不再对缺失值执行 `Object.entries` 或把缺失金额当作零。已有可用来源仍按订单/支付记录 ID 和精确字段值校验；文本始终标记为未验证且不得执行。

定向验证：API 隔离 TypeScript 检查退出码 0，`git diff --check` 退出码 0。未接真实模型结果读取、浏览器或生产支付；CA04 的真实模型→结果读回仍受 R/P 的结果端口约束。

## CA09：任务中心只读场景聚合（本次）

新增 `task-center-scene.composition.ts`，组合已有有界任务列表、原请求 `readHistorical`、任务收据和恢复读者。它输出原请求版本/scope/audience、任务元数据、恢复下一步和结果可用性声明；所有读取继续走原仓储授权与逐次复核，不创建新 run、不重连、不批准、不执行。`resultAvailable` 只表示存在受权结果引用，不把任务元数据当结果正文。

`AiBusinessScenesModule.registerClient` 现提供显式 opt-in 注册；仍不注册 AppModule/HTTP。定向验证：API 隔离 TypeScript 检查退出码 0，`git diff --check` 退出码 0。R/P 的正式 result/approval DTO 尚未在本线提供，真实结果正文、事件 cursor 与公开任务 HTTP 仍保持 unavailable；没有把 CA09 适配器宣称为完整任务中心。

另补客户端组合装配检查：缺任一现有只读 client service 方法即在装配时 fail closed，而不是在请求中途抛出未定义方法。该修复同样以隔离 TypeScript 0、diff check 0 验证。

## CA04/CA09 接续：实际持久模型结果消费

固定依赖已接回：主线81f66af1/64dba2cf/827dc0eb，本树对应a8341795/c4003053/732ab29b；未追随主线活动HEAD。

新增 `AiOriginalSceneResultService.read({original,resultId})`，组合主线实际 `AiTaskResultRepository`。订单解释结果按原请求、task/run/step/action、不可变模型输入、身份hash、意图fingerprint、Gateway invocation及配置/价格版本绑定读取。只返回有完整计量的completed文本；unknown/failed不返回正文、不自动重派。订单结果重新调用原受权准备服务，比较实际事实、版本和coverage；变化返回stale，不展示旧答案。仅排除明确的查询观察时间，不排除业务日期/金额/版本。生成文本始终不是业务执行证据，不输出Gateway凭据/供应商配置或原始异常。

实际入口：`composeAiOriginalSceneModel(deps).readModelResult(command)`；任务中心可注入 `modelResults: {read: model.readModelResult}` 后调用 `readModelResult(command)`。缺该读取器返回AI_RESOURCE_UNAVAILABLE。装配需要显式提供已有 `aiTaskResultArtifact` delegate，不自动注册生产模块。订单外的模型场景结果尚未实现此业务事实复核，不冒称全场景完成。

未新增测试脚本，仅在既有 `tests/ai-native-lane-a-original-scene-host.test.cjs` 加一个组合冒烟。先运行4 pass/1 fail，发现把含routeScene的binding传给严格text policy导致CONFIG_INVALID；本片已投影到正式policy字段。最终命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-original-scene-host.test.cjs`

5 pass /0 fail /0 skip /0 todo，退出0。覆盖实际结果仓储与场景/任务中心正常读取、跨调用绑定拒绝、unknown不展示和注销拒绝；数据/事务为离线替身，没有真实模型派发证据。

API命令（同preload）：`node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--rootDir','.','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`，退出0。固定无效DATABASE_URL；审计路径本树output/scene-result-smoke.log、output/scene-result-types.log；不提交output。

已按负责人授权向主线对话报告CA06/CA07正式配置/资料提案和执行端口缺口；主线确认由其核查和交付固定接口，本线维持prepared_not_submitted/unavailable。不改审批合同、不复用order.commit批准资料。下一步核对CA05选定报价到原受控审批/Core接法。未验MySQL、真实HTTP/模型/支付、浏览器/设备、生产；本片不代表AIN13或CA队列整项验收。
