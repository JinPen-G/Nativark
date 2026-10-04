# AI Native 离线验收入口收口（2026-10-04）

## 归属与基线

唯一施工树 `.claude/worktrees/claude-ai-native-foundation`，专项分支 `ai/ai-native-contracts-s01-20261002`，基线 `338a3c4c`。恢复时工作区为主线此前未提交的runner修复与C03接线，无其他可达Claude写入会话；不把会话列表当操作系统排他锁。Codex新交付B15截止d00b9243只读核对，尚未纳入本片测试；B16 A–J长批已按用户请求在对话交付，未跨会话发送、未写其树。

## 实际修复

- B14 runner从TAP/spec两种摘要读取todo/skipped；无摘要时countsAvailable=false，不冒充已观测为零。进程启动错误即使携带status=0也记失败。
- 工程检查先于依赖产物的测试执行，避免缺少两端新组件编译产物导致假性集成失败。工程检查本身失败仍传播失败，不能被后续测试覆盖。
- NODE_OPTIONS给npm、编译器和Node子进程继承主线preload；网络、DNS、fetch、环境文件读取被阻止。AI_OFFLINE_AUDIT在启动子进程前固定为绝对路径，不受工作目录切换影响。保护不声称覆盖任意非Node二进制的I/O。
- Admin Vite新增显式ai-offline模式：不调用loadEnv，envDir=false阻止自动环境文件加载；输出dist-ai-offline，与发布dist隔离，该目录加入gitignore。普通开发/发布模式保持原行为。
- tests/ai-native-offline-runner-boundary.test.cjs使用真实嵌套Node进程验证四种阻止边界；合成.env路径从未创建，读取在FS调用前被拦，测试临时审计文件单独保留在临时目录并清理。

## 实际验证

上轮会话终止无任务完成记录、任务输出空；在项目output找到其完整JSON报告：125测试文件+8检查，132通过、1失败。失败是相对AI_OFFLINE_AUDIT断言，不掩盖为通过。

修复路径后，任务btet09vin：
- runner/跨子进程定向12/12通过；
- 实际统一验收125个测试文件+8工程检查，133/133通过，todo/skipped均0，退出0；
- 报告 output/ai-native-b14-resume-acceptance.log（本地忽略产物）。工程检查包含Admin类型与无.env构建、两小程序typecheck/build/static；不是125项单测，测试文件内的断言数量另由各文件报告。
- Admin离线构建此前独立执行也退出0，保留既有大chunk与插件耗时警告。Node Windows npm.cmd启动仍有DEP0190提示：执行列表来自本地固定代码，不接受HTTP或模型输入，本片不宣称任意shell命令安全。

没有独立审查通过结论；此前独立任务接口失败记录继续保留，不反复派审。本片由主Claude自查、定向和实际统一验收。

## 边界与下一步

B14 runner只统计B02–B14辅助文件，不代表所有主线AI Native测试或AIN-01～28验收完成。真实HTTP、数据库/迁移、模型/支付、浏览器/微信宿主/真机与生产灰度均未执行。下一步单独完成C03接线全量、保存主线切片，再合入用户已交付的B15固定提交，构建后验收。B16活动修改不提前合入。
