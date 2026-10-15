# CA05/CA09 原订单解释三步请求与 HTTP 消费

施工：codex-ai-native-lane-a / ai/codex-ai-native-lane-a-20261007。只提交本线两个消费文件与本记录；历史 output 保留，tests/fixtures 无变更。

## 固定同步与归属

- c07bf52f35959fd1e81386d5622e8a1e3ac06af1：合并 e24d7c2b。按主线逐 hunk 授权保留新 preparation/cancel/takeover/三步核心，同时首模型结果绑定首 registration input，不泛查全部 text-model 步骤。
- 718b548dd0f40beb1ddcd17b240af31d199dd511：合并 5475848e672a0dbf21dc5a1a872026e72b0a8972；5cecddea 删除自动合并重复的旧读取方法，保留主线 input ID 与 fingerprint 核验。以上是固定同步，不算本包重新实现核心。
- original-model-order-scene 核心其后冻结归主线。本包只接 request-bound-scenes.application.ts 与 original-scenes.module.ts。

## 实际入口

`AiOriginalScenesModule.registerHttpOrderReadChain(dependencies, options)` 复用既有 AiOriginalOrderReadHttpModule 和 OriginalOrderReadHttpRequests，不注册 AppModule/worker，不新增协议。

服务器 options.orderReadChain 为 `{ enabled:true, inputSource, answerRoundTrip:true }` 时，接实际三步原场景；未给 answerRoundTrip 保留两步，不升级历史计划。HTTP body 仅原引用/正式控制命令，不能注入 runtime、holder、模型或派发权限。

已接：start/recover、首模型结果/来源、原订单结果、原 scene/snapshot/next、最终 readAnswer、readPreparation/resumePrepared、takeover/readTakeoverReceipt、requestCancel/readCancellationReceipt、settleUnstartedCancellation/readCancellationSettlementReceipt。

普通 recover/reconcile 仍是原恢复，不转 repair。澄清/报价专用动作没有借单模型 fallback 跑通；缺正式能力拒绝。接管和取消只消费主线原端口与收据，预算占用/unknown 不在消费层退还或重派。生成文字明确非 Core 事实，只读完成不是业务建单成功。

## 实际快检

环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT、AI_OFFLINE_AUDIT、TEMP/TMP 均本树绝对路径；Node v24.13.0。

- 源码 Compiler API `node -e`：API tsconfig 选项、根 original-scenes.module.ts，noEmit=true/incremental=false，shared 本树源与本树隔离 Prisma 声明。首次 3 个 union 返回类型诊断；调整消费 await 后复验 **0 diagnostics / exit 0**。不忽略诊断，不执行会读环境文件的构建。
- 直接内联冒烟：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e <实际场景与 Controller 调用>`，入口内 `require('ts-node').register({transpileOnly:false,compilerOptions:{module:'commonjs',moduleResolution:'node',target:'es2022',experimentalDecorators:true,emitDecoratorMetadata:true}})`。初次错误地使用不存在的 apps/api/node_modules/ts-node preload，exit 1；改用既有解析入口后 **exit 0**。
- 实际三步场景：首候选→受权原订单读取→最终模型文字，3 个实际 step、2 次替身 transport。通过真实动态模块/provider factory/Controller 读取 preparation、answer、首模型/来源、订单结果、snapshot、scene；这些读取新 transport=0。伪造额外 taskId 返回 400，当前身份撤销返回 403。没有新增测试文件；这是内联行为断言，不是 node:test 计数，也不是正式持久预算派发验收。
- `git diff --check` exit 0；`git diff --name-only -- tests` 为空。

## 尚未验证与明确依赖

离线三步执行使用既有事务、路由/准入/金额预算和模型 transport 替身；真实会计证据适配与产品运行器未替换。正式 request-bound HTTP 使用持久 Gateway 根读取已有原结果，但未验证从正式配置/可信价格上界/完整预算政策开始的首派发正向与 unknown 全窗口；不可把已产出 artifact 的读取等同正式首派发成功。

原 takeover/取消/settlement receipt 方法已装配并经源码类型验证，本次没有宣称全部控制竞态行为通过。真实 MySQL、HTTP 服务、模型、设备/浏览器、生产配置均未验；不执行迁移、不启用生产，不宣称 AIN 项结项。

## 接续队列

按主线追加授权，当前完整包收口后再同步固定 f59ecabb41325e6553ea8c5de2b650e60cc47ef7；继续实际报价/审批消费、最小事实与来源、开业/资料、Customer 与后端具备后的默认关闭端侧消费。复用已有能力，不改公共核心、不增加测试脚本；缺公共依赖给方法/字段/调用位置，不造成功。
