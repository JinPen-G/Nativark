# Rental 员工业务附件

[附件工厂](../uploads.ts)从 `@rental-os/rental-core/clients/staff` 提供 `createRentalStaffUploadsApi`，保留原上传、原引用观察、明确完成及下载地址四个方法。原[员工入口](../../../../../apps/staff-miniprogram/src/api/uploads.ts)供给 `request`、`newKey`、生成的观察校验器/固定路由与真实微信 `readFile`、`putFile`。页面继续使用原具名方法和 `StaffUploadHooks`。

`RentalStaffUploadsPorts` 的观察校验与路由沿[原 inspection-wire](../../../../../apps/staff-miniprogram/src/components/ai-native/inspection-wire.ts)。文件请求与摘要复用平台正式 `files` 合同，原引用与封闭观察字段复用[本 Core 观察合同](../../../src/staff-upload-observation.ts)。宿主供给当前生命周期、阶段/原引用回调及中止句柄，原字节 I/O 保留微信错误和回调顺序。

五种上传场景、`businessModule: "rental-core"`、业务对象及 metadata 沿原输入。创建保留原 191 长度键，写请求关闭认证重放。首次 provider pending 上传只读取一次本地文件并核大小，再 PUT 一次；freeze_pending 或 completed 沿原 session/file 引用明确完成，核返回资产 ID。阶段与原引用按原顺序回调，PUT 地址和 headers 保持在当前内存。

失应答保留原引用，只观察原键或原 session；观察不能补发文件，明确完成也不另发 PUT。当前页面变化继续拒绝迟到结果。模拟存储的下载地址仍返回空串，文件状态与冻结证据沿原服务端结果。

调用链为原员工页面 → 薄入口/微信 I/O → 本工厂 → [原 Staff 请求](../../../../../apps/staff-miniprogram/src/core/http.ts) → [员工附件 HTTP](../../../src/http-staff-uploads.controller.ts) → 原文件服务、暂存与冻结端口。原检查、地点、本人和当前权限由服务端复核。

定向行为覆盖原四方法、五场景、原键/metadata、观察/完成和 I/O/回调顺序；[原员工验证入口](../../../../../tests/staff-miniprogram-static.test.cjs)保留已有断言。类型沿[Native 配置](../../../tsconfig.native-clients.json)和员工宿主声明消费路径。真实微信文件、对象存储、HTTP、权限事务和冻结结果需对应环境证据。
