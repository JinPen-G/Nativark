# LB31 版本及解析生命周期

起点049a2ce1，正确B线分支，status干净，无MERGE_HEAD；无额外WIP被覆盖。沿原门面增加parserCapabilities/versionStatus，均由原HumanKnowledgeModule和persistent human composition可调用。

格式声明直接来自实际KnowledgeTextParser：UTF-8 text/plain、text/markdown，可选charset=utf-8；262144字节、200000 UTF-16字符、2000字符/chunk、200 chunks。限制常量与实际parser共用。不支持PDF/OCR/Office，不伪造页坐标，section是解析生成的定位标识而非正式标题树。

versionStatus区分当前版本、待解析版本、当前已发布已索引且在生效期内的版本。仅持久状态说明，不代表search授权。未返回历史列表，历史可见性枚举缺正式政策；原版本记录不覆盖。失败状态引导合法revise新版本，unknown原parseOperation保留reconcile。

修复原newVersion可覆盖未核对parseOperation的问题：有pending解析收据时拒绝新修订，result_unknown；不换operationId掩盖旧提交。附件修订仍通过原revise+attachmentId正式动作授权，无权限拒绝。

定向：双离线preload、固定无效DATABASE_URL、本树output/lb31-audit绝对目录，`node --test tests/ai-native-knowledge-lane-b-version-lifecycle.test.cjs`，pass2/fail0/skip0/todo0，退出0（ts-node真实类型）。实际服务与Prisma仓储执行替身：PDF拒绝→合法新版本→解析、附件拒绝、原版本保留、unknown禁止覆盖。diff --check退出0；必要API隔离类型检查本批末执行。

正式授权政策/有界文件生产者仍必须主线提供；真实数据库、文件、模型未验。未修改公共schema/Guard/根注册。
