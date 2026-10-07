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
