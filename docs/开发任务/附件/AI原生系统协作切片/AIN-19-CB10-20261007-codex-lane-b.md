# CB-10 员工检查请求级装配

接续 1b385339。功能优先，未新增测试脚本或测试框架。

实际入口：InspectionAssistModule.registerStaffRequests(serverPorts) 导出 StaffInspectionRequestFactory。未来合法员工处理器注入 factory，使用服务器收到的 request.headers.authorization 和服务器 requestId 调用 open；try 中调用返回的 templates/drafts/evidence/recognition/submission，finally 调用 close。不从业务 body、模型、客户端 scope/actor 接受授权。已有共享检查请求继续由各实际服务严格校验。

每次 open 独立快照凭据，audience 固定 staff，实际 Auth/Guard/ALS 每次重新核验；构造和 open 不读取、不写草稿、不启动任务。close 幂等并释放本实例 token 引用；后续调用及等待后的权限复核拒绝。关闭不证明远端动作已取消或事务未提交，结果不明仍查询原 operation receipt，不能换操作重派。其他请求不受其 close 影响。

既有 register 保留兼容并导出 factory；推荐服务器采用 registerStaffRequests，避免单例共享可变 credentials。没有注册 Controller、员工路由白名单、AppModule、定时器或生产开关。

验证：复用 tests/ai-native-inspection-persistent-application.test.cjs，仅增加一项实际请求装配冒烟。node --test 该文件：7 pass / 0 fail / 0 skip / 0 todo，退出码0。真实 Auth/Guard/服务/Prisma adapter，数据库/Core为受控替身。ts-node transpileOnly:false 检查本次加载源码，不是全 API tsc。prisma-offline-preload + lane-b-local-runtime；DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=本树 output/cb10-audit；TEMP/TMP=本树 output/inspection-lb05-tmp。新增模块注册后相关复验仍7/0/0/0。git diff --check退出码0。

待主线：正式员工HTTP入口/白名单与适用能力政策；InspectionObjectReader正式非URL存储生产者；媒体Gateway intent与真实识别证据。现有recognition.prepare不是模型派发；本片不将其称为图像识别已上线，不改变原人工检查流程。真实DB、文件存储、模型、设备和生产未验。
