# Rental 门户文件材料

[客户端](../file-evidence.ts)从 `@rental-os/rental-core/clients/enterprise` 提供两种上传用途的 `createEnterpriseEvidenceUploadClient`、原引用解码、本人管理申请凭证读取与具体换货检查照片读取。

[授权／回款凭证上传](../../../../../apps/enterprise-portal/src/AuthorityUpload.tsx)供给原企业 `read/write`、当前身份/证明范围、原引用 getter 与可靠保存/退役回调、公开随机原键、URL 解析和 PUT。上传与观察必须由原页面 Web Lock 的 `run` 执行，原 namespace、objectRevision、权限修订及经营空间保持；先可靠保存 stage 再派发，失应答沿原键观察，明确完成只派发一次。PDF/PNG/JPEG 和 20MiB 门槛沿原客户端。

[本人申请反馈凭证](../../../../../apps/enterprise-portal/src/ManagementRequestFeedback.tsx)调用 `readEnterpriseManagementEvidence`，供给原 customerFetch、材料寿命与 evidenceFileIds/当前三权限核对回调。Core 读取登记原申请/文件路径并核类型、大小，宿主同步创建下载 DOM、点击及 finally 释放 URL。

[具体检查照片](../../../../../apps/enterprise-portal/src/ExchangeApprovalsPage.tsx)调用 `readEnterpriseExchangeInspectionPhoto`，供给同源认证读取、当前材料/会话检查、同一 read controller 寿命和 SHA-256。Core 核原引用、PNG/JPEG、20MiB 与原 contentHash，宿主同步建立 Blob URL；只有原 img onLoad 才设置 onShown，离页和替换仍释放旧 URL。

Browser File/Blob、fetch、crypto、DOM、Web Lock/localStorage 和 React effect/ref 由宿主供给，PUT 保留 credentials omit、redirect error 与原 signal。调用链沿原页面 → 本客户端 → 公共 web-client/企业请求 → 原受权 Controller 与文件/检查来源；资金、审批、成员权限和文件冻结由服务端裁定。

定向验证复用[企业消费者](../../../../../tests/enterprise-consumers.test.cjs)的原上传失应答用例及本片前后对照，核两种用途、scope/键、未知观察、完成、凭证和照片字节/URL寿命。必要类型沿企业宿主与实际正式出口。真实浏览器、对象存储、HTTP/DB和完整业务验收需对应环境证据。
