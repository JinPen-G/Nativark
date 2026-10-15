# Lane B 03：离线审计摘要与评测证据分层

前置 `1f24635f`。新增 evaluation/evaluation-audit.ts 与 tests/ai-native-lane-b-audit.test.cjs，不修改公共 DTO、生产审计、审批/预算/鉴权。

实际能力：严格、封闭、有界的离线审计记录校验和快照；只允许输入/授权 hash、plan/tool 引用、scope、结果状态/码。拒绝正文、提示词、密钥、内部授权对象、模型思维链和额外字段；UNKNOWN 不能记录为成功。评测统计只接离线服务/模拟 transport/静态契约证据，不接受 live 或模型评分，语言质量明确未采样，真实出网/数据库未验。

这不是授权入口、可信摘要生产者或持久审计落库。调用者仍需使用正式授权和脱敏生产者；本片不能把调用者声明的 hash 当权限证明。既有生产审计接口待主线装配，本片不注册模块或写接口。

验证使用 LB01 的两 preload、固定无效 DATABASE_URL、本树绝对 output/lane-b-audit-{red,green}.audit。

- `node --test tests/ai-native-lane-b-audit.test.cjs` 红测：模块尚未实现，pass0/fail3/skip0，退出1；不是已有生产缺陷复现。
- 同命令实现后：pass3/fail0/skip0/todo0，退出0；实际调用严格 TypeScript 实现和 zod schema，网络尝试断言为空。
- 全 API strict TS：以 TypeScript readConfigFile/parseJsonConfigFileContent/createProgram 读取 apps/api/tsconfig.json，noEmit=true、incremental=false，baseUrl 本树，paths 指向本树 shared 源码与本树隔离 Prisma Client；删除 rootDir 以容纳正式 shared 源码。`ts.getPreEmitDiagnostics(program)` 为0，退出0。没有调用 Vite/build/env 加载，无文件生成。
- `git diff --check`：退出0。

独立复核待主线；不宣称 AIN-24 完成。后续统一威胁集必须执行实际入口用例，不能以本片格式测试替代业务安全验证。
