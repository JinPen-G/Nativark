# 客户 Action / Booking 显式 HTTP 消费者

从固定 `ae16281d1b7d41fe452356f712f4731f454a1878` 仅快进接续，保留全部 output、锁、previous/temp。不改公共合同、Core、runner、AppModule 或前端。

实际入口：`AiClientEntryModule.registerHttp(dependencies, configuration)`。原 `@Module({})` 无默认 controller/providers；显式工厂要求 server entry.enabled、tasks、client、db、Guard，缺项拒绝。tenant/service/channel/releaseRevision 均来自服务器配置，body 仍经原应用严格 schema，不能自授 actor/scope/config。配置在注册时复制，原应用继续当前 Guard/ALS/政策/权益/gate 验证。

Controller 基路径与七个 POST 路径全部使用已有 `AI_CLIENT_ENTRY_HTTP_DRAFT`：issueAction、createBookingDraft、chooseBookingDraft、readBookingDraft、handoffBookingDraft、readBookingHandoff、readBookingOperation。直接消费原 request-bound application，不实现另一套业务状态机或审批。已知输入/权限/冲突/未知错误映射安全 code；未知内部异常固定 unavailable，响应不透传 reason/message/数据库细节。unknown 返回 retryable:false 与 read_booking_operation，不调用建单或自动重派。

## 验证

只扩已有 `tests/ai-native-lane-a-original-scene-host.test.cjs` 的 client scene authenticates 用例，以实际 module 工厂/controller → 原 Guard/Auth/客户端服务/材料/Booking仓储驱动七个方法。DB/会话存储/Core事实为离线替身，未启动 HTTP。

命令：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates' tests/ai-native-lane-a-original-scene-host.test.cjs`。

首轮旧 Prisma 加载失败：0 pass/1 fail/0 skip/0 todo，exit1，新 run inputReceiptId/resourceOriginRunId 缺类型。父进程 audit/write-root/TEMP/TMP 均本树 output/entry-booking-tmp，原 `node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs scripts/ai-native-generate-local-prisma.cjs` exit0：generated:true、schemaHash48660d96cdee65a423afc0b016c46fc260d3e9aef4a94c02490c53f8b461b39f、guardViolations0、sharedArtifactsUnchanged true。本次残留仅本树，未处理历史锁/backup/temp；此前地址片的违规说明保持原记录。

生成后首轮用例0/1/0/0 exit1：测试错误假设空@Module会写controllers=[]元数据，实际为undefined；改为两种均代表无controller，未改变生产默认关闭行为。最终1 pass/0 fail/0 skip/0 todo/0 cancelled、exit0，覆盖实际handoff读取、无凭据拒绝、body伪造字段拒绝、原COMMIT应答丢失后原键读取及内部异常脱敏。git diff --check exit0。

API Compiler API/noEmit读取原 tsconfig，rootDir/baseUrl 本树、paths 映射本树 shared 源码/私有 Prisma、incremental:false：520入口/0诊断、exit0。不是常规 API 打包或 shared 发布验证。所有 Node 固定无效 DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，原离线 preload、绝对本树 audit/write-root/TEMP/TMP。不读.env、不外联/真实DB/模型/支付、不安装、推送或启用生产。

## 待接与替换边界

原页面仍未消费 handoff；原预约受理收据与 handoff/customer/workspace/inputHash/quoteId/operationKey 的可信关联未交付，submitted 仍无写入者。本模块不注册主 AppModule、不生成支付/资金/审批许可。主线完成公共入口整合后需提供真实依赖与发布政策才可装配；默认不开。

当前自研。Controller 是稳定业务请求消费者，不依赖 Agent Runtime checkpoint 或 Provider SDK 类型；未来两条替换路线分别在编排/Gateway适配层进行，不能借换引擎重发unknown或替代原授权、Core、审批、唯一Gateway预算。回退撤下显式registerHttp，保留原人工预约页及持久草稿/收据。
