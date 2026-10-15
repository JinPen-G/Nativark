# Rental OS 客户端 API 接口说明

## 版本记录

| 版本 | 日期 | 编辑 | 变更 |
| --- | --- | --- | --- |
| v1.14 | 2026-09-20 | Codex | 同步当前 main：客户端渠道后台页、租户级配置、公开文档、微信/短信登录、地址簿、费用响应、JSAPI 支付、地点坐标及小程序展示投影均已进入代码主线；当前剩余任务改由《客户端共用开发任务》和《微信小程序开发任务》维护，重点是真库组合、真实 Provider 与宿主验收。 |
| v1.13 | 2026-09-19 | Claude | CLIENT-CHANNEL-01：启动配置改读**租户级客户端渠道配置**（品牌/客服/协议/帮助/横幅/发布服务，小程序与 APP 共用），`GET /public/bootstrap` 加 `client=wechat_miniprogram\|app` 参数并返回 `client`、`help`、`banner`、协议 `hasBody`；`wechat_phone` 登录与 `capabilities.wechatPay` 仅小程序且微信凭证就绪时为真。新增公开 `GET /public/documents/{kind}`（`user_agreement`/`privacy_policy`/`help` 正文与 FAQ，游客可读、客户端内渲染）。运营端 `/platform/mini-program-channel` 收窄为微信凭证；租户级配置走 `GET/PUT /platform/client-channel`（`system:integration:manage`）。代码与自动化验收通过，未提交、迁移未应用共享库。 |
| v1.12 | 2026-09-19 | Claude | 落地小程序首期六项契约（代码与自动化验收，未提交、迁移未应用共享库）：公开启动配置 `GET /public/bootstrap`、公开游客目录 `GET /public/catalog` 与图片、用途化验证码 `POST /auth/challenges`、短信登录 `POST /auth/sms-login`、微信手机号登录 `POST /auth/wechat/phone-login` 与绑定 `POST /auth/wechat/bind`、本人注销三接口、地址簿三接口、检查费用投影与本人确认/异议、小程序 JSAPI 支付（`mini-program-payment-intents` 从预留 503 改为真实创建，缺可信微信身份返回 409 `wechat_identity_required`）；`/config.features` 增 `delivery/feeResponse/accountClosure/wechatBinding`，报价请求增 `deliveryAddressId`，订单视图增 `deliveryAddress` 快照，目录增 `fulfillment`。 |
| v1.11 | 2026-09-19 | Claude | 验证码挑战补按身份与租户的配额：同一（租户, 手机号/邮箱）5 次/小时、10 次/天，租户每日短信挑战预算默认 2000（`CLIENT_SMS_DAILY_BUDGET_PER_TENANT`），超限 `429`；`purpose=login` 不再以 404/403 暴露手机号是否注册或已停用，统一返回 pending 响应且不发短信，验证时只回"验证码错误或已过期"；验证码落库改为以服务端密钥 HMAC 存储，升级时未完成的挑战直接失效需重新获取；来源地址取 Express `request.ip`，代理之后由 `TRUST_PROXY_HOPS` 决定是否采信 `X-Forwarded-For`。 |
| v1.10 | 2026-09-19 | Claude | 为小程序 V2 设计稿补最小展示投影：`GET /catalog` 的每个商品新增可选 `startingPrice`（`{ amount, unit, currency }`，当前生效价格版本中该型号或其所属启用定价分组的最低基础单价；无生效版本或无费率时缺省，客户端不得以 0 元替代，实际金额仍以报价为准），地点新增可选 `address`、`businessHours`、`contactPhone`、`capabilities`（pickup/return/storage/delivery），不返回经营主体信息；`GET /my/orders` 每行新增可选 `itemSummary`（首个型号 id/名称、行数与件数之和），不含资产编号与金额明细。 |
| v1.9 | 2026-09-19 | Claude | 补齐控制器已有但本文档未列出的三条接口：`GET /my/orders`（个人客户跨本租户各服务空间的本人订单只读索引，与当前空间 `GET /orders` 职责分开）、`POST /orders/{id}/cancel/preview`（取消费预览，不改变订单）、`POST /orders/{id}/mini-program-payment-intents`（小程序支付预留契约，当前固定返回 503）。 |
| v1.8 | 2026-09-18 | Claude | 新增 `PUT /profile` 作为 PATCH 的等价别名（微信小程序宿主不支持 PATCH）；登录/刷新/切换空间的会话响应新增可选 `workspace` 字段，返回本次会话实际绑定的服务空间，客户端据此记录当前服务而不凭请求参数推断（旧客户端可忽略）。小程序客户端 `apps/miniprogram` 按需求重建，只消费本文档已列接口；渠道启动配置、微信手机号登录、短信登录、公开目录、地址簿、费用响应与注销仍为拟新增契约，未在 v1 提供。 |
| v1.7 | 2026-09-17 | Claude | 同步租户统一会员契约及自动化/本地开发库验收状态；补充小程序完整需求引用。微信手机号/短信登录、JSAPI、公开目录、地址簿和统一本人订单等渠道新增能力仍是MP任务，不能当作现行v1已提供，也不代表生产放行。 |
| v1.6 | 2026-09-15 | Codex | 补充经营空间收款方式启用矩阵：客户端配置可返回线下现金、线下转账、支付宝、微信；线下方式是否启用由空间设置决定，支付宝/微信仍必须同时满足租户默认 Provider 已启用且通过 `passed + live` 校验。客户端支付意图仍只接受支付宝/微信，线下收款由运营端资金事件登记并记录方式。 |
| v1.5 | 2026-09-15 | Codex | 新增客户端订单凭证接口：报价、交付、归还检查、结算四类凭证统一复用服务端快照渲染器，并提供历史目录读取；按 `snapshotId` 读取指定不可变版本时仍先校验当前会员订单归属、租户/经营空间和凭证类型，不接受客户端传入 `workspaceId`，结算只返回本人订单的汇总资金事实。 |
| v1.4 | 2026-09-14 | Codex | 补客户端 API 跨实例固定时间窗限流：公开认证接口按来源地址分级限制，登录后接口按客户端会话限制，计数只保存不可逆 scopeKey 并由数据库原子递增；客户端令牌验签改为常量时间比较并校验 JWT 头部，超限返回 HTTP 429。 |
| v1.3 | 2026-09-14 | Codex | 明确客户端支付仍只负责支付意图创建、查单补偿和关闭；真实退款由运营端高风险资金接口按订单资金事实执行，并补充受理、成功和内部资金待恢复的边界；新增资质附件上传会话、完成和下载地址接口，固定校验当前会员归属与证件类型。 |
| v1.2 | 2026-09-13 | Codex | 接入租户选择的支付宝/微信支付意图、支付状态查询和支付回调边界；补充真实短信、文件上传会话与下载地址说明。 |
| v1.1 | 2026-09-13 | Codex | 补齐客户端资料、联系人、会员方案/权益、企业身份、运行配置与支付能力接口，并整理 v1 全量接口用途。 |
| v1.0 | 2026-09-13 | Codex | 建立独立客户端认证、目录、报价、下单、订单履约和开发资金模拟接口。 |

## 1. 使用范围

客户端 API 供小程序、预约网站、APP 或其他客户自助端使用。同租户一个小程序，登录一次切换服务空间不再入会；租户统一会员已经进入现行实现。微信小程序完整功能及首期页面见[《微信小程序需求说明》](微信小程序需求说明.md)；共用接口和真实 Provider 的未完成项见[《客户端共用开发任务》](开发任务/客户端共用开发任务.md)，微信宿主与页面任务见[《微信小程序开发任务》](开发任务/微信小程序开发任务.md)。微信手机号/短信登录、注销、游客目录、地址簿、费用响应、小程序 JSAPI 支付和运营后台客户端渠道配置已有代码；真实 AppID/商户、最新真库组合与宿主验收仍须单独完成。客户端 API 与运营后台分开：

- 基础路径：`/api/client/v1`。
- 客户端使用客户账号令牌，不使用运营账号令牌，也不携带运营角色、数据范围或权限矩阵。
- 客户端 access token 是独立签名的短期 JWT；服务端验签使用常量时间比较，并在数据库中复核会话、账号、租户、当前服务空间及租户会员。客户端不能自行构造或延长令牌。
- 公开注册以 `tenantCode` 为目标，`workspaceCode` 可选，仅作来源或初始服务空间；登录后的经营空间仍由服务端验证并写入客户端 session，不因会员共享而信任任意空间参数。
- 会员身份、方案、授予和企业员工关系按租户与当前客户校验；订单、报价、优惠券、资金及凭证仍按 `tenantId + workspaceId + customerId` 校验。客户端不能提交内部 `tenantId`、`workspaceId` 扩大范围，非本人订单不能读，包括幂等回放。
- 普通 JSON 响应沿用系统响应包装：`{ data, requestId }`；`/api/openapi.json` 是原始 OpenAPI 文档，不加包装。

请求建议携带：

```http
Authorization: Bearer <client-access-token>
Content-Type: application/json
Idempotency-Key: <unique-key-for-mutating-action>
```

客户端接口的限流由服务端执行，不由客户端自行计算：登录每个来源地址 10 次/10 分钟，注册验证码挑战 5 次/5 分钟，验证码校验 15 次/5 分钟，其他公开客户端请求 180 次/分钟；已登录会话另按会话限制 240 次/分钟。验证码挑战（`/auth/challenges`、`/auth/registration/challenges`）在来源地址之外还按目标身份计数：同一租户内同一手机号/邮箱 5 次/小时、10 次/天，且每个租户每日短信挑战预算默认 2000 条（环境变量 `CLIENT_SMS_DAILY_BUDGET_PER_TENANT`）；这些配额在调用短信服务商之前判定。超限返回 `429`，客户端应等待后重试，不应通过更换幂等键绕过。

公开接口的计数只使用服务端看到的请求来源地址（Express `request.ip`；部署在反向代理之后须配置 `TRUST_PROXY_HOPS`，否则所有客户端共用代理地址的桶）；登录后的计数使用租户、经营空间和客户端会话的不可逆组合；按身份的配额使用租户与目标身份的不可逆哈希。数据库唯一键和原子递增保证多 API 实例共享同一限流边界，限流桶定期清理。IP、手机号、令牌和密钥不会写入限流表。

注册请求的幂等键放在请求体 `idempotencyKey`，按目标租户绑定已验证身份与请求内容；换来源空间不得重复消费验证码证明、创建账号/会员或重置审核。订单创建、取消、续租和资金操作使用 `Idempotency-Key`，资金模拟接口必须提供该请求头；包括已有结果与并发重放在内，返回前仍要校验当前租户、服务空间及本人订单归属。

## 2. 认证与会话

注册及验证码请求中的 `target.tenantCode` 必填，`target.workspaceCode` 可选；服务端解析编码并校验归属，省略空间不改变租户级身份验证与注册幂等边界。来源空间不是会员归属，亦不能用来扩大全部后续业务范围。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/tenants/{tenantCode}/workspaces` | 获取租户下可公开展示的服务空间，供可选初始空间或登录后服务切换使用，不代表逐空间入会。 |
| POST | `/auth/registration/challenges` | 按目标租户为手机号或邮箱创建注册验证码挑战；`tenantCode` 必填、`workspaceCode` 可选。开发环境返回一次性 `developmentCode`；生产环境需接短信/邮件 provider。`purpose=login`（含 `/auth/challenges`）时无论手机号是否注册或账号是否停用都返回同样的 `pending_verification` 响应，不以 404/403 暴露账号存在性；不可登录的号码不发送短信，其 `challengeId` 校验时固定返回"验证码错误或已过期"。 |
| POST | `/auth/registration/challenges/{challengeId}/verify` | 校验验证码并换取租户级短期一次性 `verificationToken`，不能跨租户使用或因切换来源空间重复消费。验证码本身不能直接用于注册。 |
| POST | `/auth/register` | 以 `tenantCode` 为目标、可选 `workspaceCode` 记录来源，创建或复用租户内个人主档、账号及唯一租户会员；租户人工审核模式返回待激活，自动模式返回正常。 |
| POST | `/auth/login` | 用租户内客户手机号和密码登录，可指定初始服务空间编码；服务端确定可信当前空间并返回 access/refresh token 及绑定的 `workspace`，不创建新的空间会员。 |
| POST | `/auth/refresh` | 使用 refresh token 轮换客户端会话。旧 refresh token 会失效，并发重复刷新只有一次成功。 |
| POST | `/auth/logout` | 撤销当前 refresh token。 |
| POST | `/auth/switch-workspace` | 切换同租户可用服务空间；服务端复核空间归属、启用状态与客户状态后更新客户端 session，不再次注册或入会。 |
| GET | `/auth/me` | 获取当前客户的租户会员状态、租户审核记录、资质状态及可用服务空间；来源空间不是会员身份范围。 |
| POST | `/auth/change-password` | 修改当前客户账号密码。服务端只保存口令哈希。 |
| POST | `/auth/challenges` | 用途化验证码挑战：`purpose` 为 `registration`（缺省）或 `login`；证明只能用于创建时声明的用途，注册证明不能登录。`account_closure` 用途不接受客户端提交手机号，只能经 `POST /auth/closure/challenge` 由登录态对本人手机号发起。校验仍走 `/auth/registration/challenges/{challengeId}/verify`。 |
| POST | `/auth/sms-login` | 短信验证码登录：`verificationToken` 须为 `login` 用途、本租户、该手机号的一次性证明，手机号必须已注册；成功返回与密码登录相同的会话响应（含 `wechatBound`）。 |
| POST | `/auth/wechat/phone-login` | 微信手机号一键登录：只提交 `wx.login` 的 `loginCode` 与手机号授权组件的 `phoneCode`，openid/unionid/手机号由服务端持商户 AppSecret 向微信换取；同手机号复用既有客户/账号/会员，openid 或手机号已绑定其他客户时拒绝改绑（409）；新客户按租户注册审核策略创建。需商户已配置并启用小程序渠道，否则 503。 |
| POST | `/auth/wechat/bind` | 已登录客户把当前微信身份绑定到本人（短信/密码登录后需要小程序内微信支付时使用）；`loginCode` 一次性，凭证无效返回 400，不视为会话失效。绑定后当前会话立刻带微信身份。 |
| GET | `/auth/closure/preview` | 本人注销预检：返回是否可注销、阻断项（在途订单、押金/预授权、待退款、欠款等）与需客户显式确认的人工核对项。 |
| POST | `/auth/closure/challenge` | 向当前账号手机号发送 `account_closure` 用途验证码；不接受客户端指定号码。 |
| POST | `/auth/closure` | 确认注销：`loginIdentifier` 须与当前账号手机号一致、`verificationToken` 为 `account_closure` 用途证明、`acknowledgedManualChecks` 必须为 true；服务端复跑可注销性检查后关闭租户会员与账号并撤销全部会话，写操作日志。历史订单/资金/审计依法保留。 |

## 3. 客户资料与客户端能力配置

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/config` | 获取当前租户/空间、品类、时区、租户级注册审核模式、客户端已开放功能和支付能力。客户端启动时使用，避免把能力开关写死在页面。 |
| GET | `/payment/capabilities` | 单独读取当前经营空间启用的收款方式；可返回 `offline_cash`、`offline_transfer`、`alipay`、`wechat_pay` 以及开发环境的 `simulation`。支付宝/微信只有在对应租户默认 Provider 已启用且通过 `passed + live` 校验后才返回，不暴露商户密钥。 |
| GET | `/profile` | 获取当前客户的租户共享资料、账号状态、租户会员状态、脱敏证件号、企业资料摘要和联系人。 |
| PATCH | `/profile` | 修改当前客户允许自助维护的姓名和 Email。手机号、身份号码、企业主体和认证状态不能通过此接口修改。 |
| PUT | `/profile` | 与 PATCH 完全相同的部分更新别名：微信小程序 `wx.request` 不支持 PATCH。请求体、校验与鉴权一致，不是整体替换语义。 |
| GET | `/profile/contacts` | 获取当前客户的有效联系人。手机号只返回脱敏值。 |
| PUT | `/profile/contacts` | 新增或更新当前客户自己的联系人；传 `id` 时更新，不传时新增。`isPrimary=true` 会取消同用途的其他主联系人。 |
| DELETE | `/profile/contacts/{contactId}` | 软停用当前客户自己的联系人，不删除历史记录，也不能操作其他客户联系人。 |
| GET | `/profile/addresses` | 本人配送地址簿（租户内共享，不是联系人）；手机号只返回脱敏值，每条带 `revision`。 |
| PUT | `/profile/addresses` | 新增或更新本人地址：传 `id` + `revision` 时更新（版本不一致返回 409），`isDefault=true` 取消其他默认；上限 20 条；`phone` 必填。 |
| DELETE | `/profile/addresses/{addressId}` | 软删除本人地址；已提交订单上的交付快照不受影响。 |
| GET | `/public/bootstrap` | **公开**启动配置（`tenantCode` 必填，`appId` 可选）：商户展示名/Logo/客服电话与时段、已发布服务与默认服务、协议名称/版本/外链、登录方式、能力开关（`publicCatalog/wechatPay/delivery/feeResponse/accountClosure`）与 `source`（`channel` 或未配置渠道时的 `workspace_directory` 回退，只带租户名与启用空间）。 |
| GET | `/public/catalog` | **公开**游客目录（`tenantCode`、`service` 必填）：只对已发布到渠道的服务开放，字段与 `/catalog` 一致但图片地址指向公开图片接口；未发布返回 404，客户端显示“登录后查看”。 |
| GET | `/public/catalog/items/{itemGroupId}/images/{imageId}` | 公开商品图片（带 `tenantCode`、`service` 查询参数），同样只对已发布服务开放。 |

`/profile` 不会返回密码、明文手机号、明文证件号、明文统一社会信用代码或后台账号资料。

**CLIENT-CHANNEL-01（已实现，代码与自动化验收）：** `GET /public/bootstrap` 增加 `client` 参数（`wechat_miniprogram` 缺省、`app`），品牌/客服/协议/帮助/横幅/发布服务改读**租户级**客户端渠道配置（小程序与 APP 共用），响应含 `client`、`help`、`banner` 与协议 `hasBody`；`wechat_phone` 登录方式与 `capabilities.wechatPay` 只在小程序渠道且微信凭证就绪时为真。公开 `GET /public/documents/{kind}`（`user_agreement`、`privacy_policy`、`help`）返回名称、版本、正文、可选外链与帮助 FAQ，供客户端内直接渲染（游客可读）；商户未提供时 404。运营端读写走 `GET/PUT /platform/client-channel`。**未纳入（可裁剪的后续小切片）：** `/auth/me` 的“协议已更新需重新同意”提示，仅登录时按当时版本留痕，尚未做版本升级后的强制重新同意。

## 4. 会员、企业身份与资质

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/membership/status` | 获取当前客户的唯一租户会员、租户注册审核和资质摘要，审核来源空间仅供追溯。 |
| GET | `/membership/plans` | 获取当前租户已发布且允许 APP 展示的个人/企业免费方案版本，包含逐条金额权益的 tenant/workspaces/categories 范围。草稿、停用版本和不可见版本不返回；展示不等于当前空间全部可用。 |
| GET | `/membership/assignments` | 获取当前个人客户在租户内的会员方案授予历史及其权益快照，不按当前服务空间复制授予。 |
| GET | `/membership/benefits` | 解析个人当前有效方案，并按当前服务空间/品类匹配权益范围；传 corporateCustomerId 时先校验同租户有效员工及企业会员，再解析该企业当前方案。一次预约选择一套方案、同类金额减免取最大不叠加。 |
| GET | `/membership/corporates` | 获取当前个人客户在租户内有效加入的企业身份、员工角色、部门和员工编号，供预约选择，不要求另建空间员工关系。 |
| GET | `/membership/booking-options` | 获取当前客户可选的个人预约和有效企业员工预约身份，按目标空间解释权益适用性；它是本人的轻量下单选择器，不开放其他客户维护。 |
| GET | `/membership/qualification-types` | 获取目标服务空间/品类/capability 适用的证件 Type，包括通用身份资料及驾驶证、从业资格证、工程设备操作证等类型。 |
| GET | `/membership/qualifications` | 获取当前客户在租户内已提交的资格 Ref、当前事实与审核状态；目标订单仍复核 Type、空间/capability 和有效期。 |
| POST | `/membership/qualifications` | 提交或重新提交一项资质，保存证件类型、脱敏号码、有效期、来源和审核任务。`evidenceRef` 只能传受保护文件服务产生的不透明引用，不能传本地路径或公开文件 URL。 |
| POST | `/membership/qualifications/files` | 为当前客户创建资质附件上传会话。客户端只提交证件类型和文件元数据，租户、客户和 `client-qualification` 上传场景由服务端绑定；返回短时上传信息，不返回长期密钥或对象存储路径。 |
| POST | `/membership/qualifications/files/{sessionId}/complete` | 完成当前客户的资质附件上传。服务端校验上传会话、当前客户归属、会话有效期和对象存在性，未完成或其他客户的会话不能被确认。 |
| GET | `/membership/qualifications/files/{fileAssetId}/download-url` | 为当前客户生成本人资质附件的短时下载地址。仅允许当前租户、当前会员、`client-qualification` 场景且已完成的文件，跨会员引用按“文件不存在”处理。 |

企业员工是同租户个人会员与企业客户之间的关系，不会创建第二个企业登录账号；可在不同服务空间复用有效关系，但不能由客户端自报企业编号绕过校验，企业身份也不授予读取其他员工订单的权限。

金额权益逐条声明 `scope=tenant/workspaces/categories`，指定列表必须非空，空间归属由服务端校验。个人和企业分别解析当前有效方案，使用哪套由本次预约身份决定；未命中范围的权益不能应用，旧订单快照与金额不随后续方案/授予/范围变更重算。

资格 Ref 及本人附件在租户内共享，来源空间或来源品类不是拒绝通用身份证资料复用的理由；目标资格 Type、空间/capability、状态与有效期仍必须满足。附件始终绑定当前租户、本人和证件类型；完成上传时复核会话状态，下载和提交审核只接受已完成文件，不能借共享资料访问其他客户文件。

租户会员暂停限制全部空间新业务，但不自动停用客户账号；账号状态与业务资格分别校验，保留按授权读取本人历史及处理允许善后的能力，不因可登录就允许新报价下单。

## 5. 目录、可用性与报价

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/catalog` | 获取当前空间可对客户展示的商品型号（含可选参考起价 `startingPrice`：生效价格版本中该型号/定价分组的最低基础单价，仅供列表展示）、定价组、增值服务、履约地点（含地址、营业时段、门店电话与取还能力等公开信息）和优惠方案。 |
| GET | `/catalog/items/{itemGroupId}/images/{imageId}` | 读取已授权商品型号图片；返回图片二进制，不公开本地存储路径。 |
| POST | `/availability` | 按地点、起止时间、商品型号和数量检查可租资源。只返回服务端计算结果，不能据此直接占库存。 |
| POST | `/quotes` | 按当前空间价格版本、日历、会员身份、服务、优惠券和资格规则生成报价。客户端不提交最终金额。 |
| GET | `/quotes/{id}` | 读取当前客户自己的报价快照，供确认下单或展示报价明细。 |
| GET | `/coupons` | 获取当前客户在当前空间可见的优惠券。 |
| POST | `/coupons/{templateId}/claim` | 领取当前空间允许领取的优惠券；预算、限领次数和状态由服务端校验。 |

报价只在服务端计算金额。商品、计价单位、会员权益、优惠方案、优惠券、服务、日历和资格任一影响报价的事实发生变化，都应重新请求报价。

## 6. 订单、分配与履约

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/orders` | 将当前客户自己的有效报价转换为订单，并在服务端事务中复核资格、库存、优惠券、预算、服务容量和订单幂等。 |
| GET | `/orders` | 分页查询当前客户在**当前服务空间**可见的订单，可按订单状态过滤。这是当前空间业务列表，用于该空间内的下单后跟进。 |
| GET | `/my/orders` | 个人客户在**本租户全部服务空间**的本人订单只读索引，分页（`page` 1-1000000，`pageSize` 1-50），返回订单号、品类、所属空间、状态与时间摘要，以及可选的商品摘要 `itemSummary`（首个型号与件数，不含资产编号和金额明细）。只按租户与本人身份查询已持久化事实，不切换会话、不授予任何空间访问，也不开放企业其他员工订单；企业账号调用返回 403。订单详情、取消、续租与支付仍须在该订单所属服务空间下通过 `/orders/{id}` 系列接口操作。 |
| GET | `/orders/{id}` | 获取当前客户自己的订单金额、商品行、费用行、分配和状态快照。 |
| GET | `/orders/{id}/fulfillment` | 获取领取/归还时间、地点、分配资产和资源履约进度的轻量视图。 |
| GET | `/orders/{id}/documents/{type}` | 获取当前客户自己订单的最新客户可读凭证快照与 HTML。`type` 支持 `quote`、`delivery`、`return`、`settlement`；可选查询参数 `snapshotId` 用于读取指定历史版本；结算仅返回该订单的汇总资金事实，不返回内部费用裁定、规则快照或证据引用。 |
| GET | `/orders/{id}/documents/{type}/versions` | 获取当前客户自己订单该类凭证的历史目录，只返回版本标识、凭证号、来源订单更新时间、快照时间和内容哈希，不返回 HTML 正文或资金明细。 |
| POST | `/orders/{id}/cancel/preview` | 按当前时间与订单快照预览取消费用，不改变订单、不退款、不释放资源。正式取消时服务端会重新按当时状态与时间计算，预览结果不构成承诺。 |
| POST | `/orders/{id}/cancel` | 在订单状态允许时申请取消；服务端重新计算取消费用、释放优惠券/服务容量并执行幂等处理。 |
| GET | `/orders/{id}/extensions` | 查询订单续租/延期申请和历史结果。 |
| POST | `/orders/{id}/extensions/preview` | 按订单保存的价格与优惠快照预览延期补差，不改变订单。 |
| POST | `/orders/{id}/extensions` | 提交延期/续租申请；服务端校验后续冲突、缓冲时间、价格、优惠、服务容量和结算方式。 |
| POST | `/orders/{id}/extensions/{extensionId}/pay` | 在延期需要先补款时，完成已通过资金校验的延期生效动作。当前资金 provider 仍是开发模拟边界。 |
| GET | `/orders/{id}/fee-items` | 本人订单的检查异常费用投影：阶段、说明、已批准金额、商户调整记录、本人响应状态/历史、凭证数量与待确认数；不返回运营裁定细节。 |
| POST | `/orders/{id}/fee-items/{inspectionId}/{exceptionIndex}/response` | 本人对单项费用确认或提出异议（`decision=confirmed\|disputed`，异议须填原因），复用运营端同一条追加式响应链与幂等动作（`Idempotency-Key` 必填，重放返回 `replayed=true`）；不接受金额或裁定结果，已确认不能改为异议。 |

客户只能在当前服务空间读取自己作为个人使用人或订单主体的订单；企业员工身份不等于企业全部订单访问权。企业关系、企业方案和付款主体由服务端从租户内当前有效关系解析并写入订单快照。订单创建及其他幂等回放在返回旧结果前仍须校验租户、当前空间、报价/订单本人归属，不能通过猜测幂等键读取非本人订单。

## 7. 通知与资金状态

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/notifications` | 分页读取与当前客户订单相关的通知记录。不会返回运营收件人、provider 凭据或其他客户通知。 |
| GET | `/orders/{id}/funding` | 读取订单资金事件和当前资金状态，用于展示租金、押金、预授权、退款或释放进度。 |
| POST | `/orders/{id}/funding/simulate` | 仅开发环境记录模拟收款、押金、预授权、退款或释放事件，供内部经营演练。生产环境拒绝调用。 |
| POST | `/orders/{id}/payment-intents` | 按当前租户启用的支付宝或微信支付创建租金/费用支付意图；返回二维码/收银入口、金额和支付单状态。押金与预授权仍走独立资金能力。请求必须带幂等键。 |
| POST | `/orders/{id}/mini-program-payment-intents` | 微信小程序 JSAPI 支付：校验 `instrument=rental` 与幂等键后，payer openid 只取自服务端可信的 `ClientWechatIdentity`（微信手机号登录或 `/auth/wechat/bind` 绑定），缺失返回 409 且响应体 `code=wechat_identity_required`，客户端应引导先绑定微信，不会回落到 Native 二维码，也不从手机号或 Native 参数推导 openid；支付配置的应用 ID 与小程序 AppID 不一致返回 503。成功返回含 `jsapi` 五参数（由商户私钥即时签名，服务端只保存 prepay_id），`wx.requestPayment` 成功不等于已收款，仍以查单与资金事件为准。 |
| GET | `/orders/{id}/payment-intents/{intentId}` | 查询当前客户自己的支付单状态；最终是否入账以服务端验签回调写入的资金事件为准。 |
| POST | `/orders/{id}/payment-intents/{intentId}/refresh` | 在回调延迟或丢失时向提供方查询支付状态；只有查询到成功且金额一致才入账，不能由客户端直接确认收款。 |
| POST | `/orders/{id}/payment-intents/{intentId}/close` | 关闭尚未支付的支付宝/微信支付单；已入账支付不能关闭。 |

## 8. 状态码与通用规则

| 状态码 | 含义 |
| --- | --- |
| 400 | 请求字段、时间、金额单位或状态不符合契约。 |
| 401 | 客户端令牌过期、撤销、账号停用或租户已停用。 |
| 403 | 当前客户不是有效会员、没有企业员工关系，或当前动作需要更高业务状态。 |
| 404 | 资源不属于当前客户/当前经营空间，统一按不存在处理，避免泄露其他客户数据。 |
| 409 | 报价过期、库存/服务容量/优惠预算竞争、状态冲突、重复验证码或幂等键冲突。客户端应刷新最新资源或报价后重试。 |
| 503 | 验证码 provider 或其他外部 provider 尚未配置。 |

服务端金额、优惠、订单状态和履约状态是唯一事实来源。客户端不得根据页面金额自行拼接订单，也不得把 `simulation` 响应展示成真实支付成功。

## 9. 当前明确边界

- 客户端 API v1 已覆盖注册、登录（密码/短信/微信手机号）、微信身份绑定、本人注销、空间切换、资料、联系人、配送地址簿、会员方案/权益、企业预约身份、资质及其附件、目录（登录态与已发布服务的公开游客目录）、图片、可用性、报价（含配送地址快照）、优惠券、下单、订单、检查费用确认/异议、订单凭证及历史版本、续租、履约、通知、资金状态、真实支付意图与小程序 JSAPI 支付。空间可在经营设置中启用线下现金、线下转账、支付宝和微信；客户端的线下方式仅作为能力声明，运营端实际收退款必须通过带方式和幂等键的资金事件登记，不能把客户端显示或模拟响应当作真实到账。
- 短信注册验证码已按租户默认短信 provider 发送；文件服务已提供短时上传会话、完成确认和下载地址，并在资质业务上固定绑定当前会员和证件类型。没有配置 provider 时，开发环境才允许明确标记的模拟回退，生产环境直接失败。
- 支付回调和支付查询补偿已提供支付宝异步通知、微信支付 API v3 通知及运营端主动查单；真实退款由运营端 `/api/rental/v1/orders/{orderId}/payment-intents/{intentId}/refunds` 执行，客户端不直接发起退款。退款只有第三方明确成功并完成内部资金事件后才算已退款；“支付意图已创建”“退款已受理”都不能当作已收款/已退款。真实商户沙箱和正式外部发布仍需单独验收。
- 客户端可以提交 `evidenceRef`，但引用必须来自受保护文件服务产生的已完成资质附件；客户端不能直接读取本地上传目录，也不能引用其他会员或其他证件类型的文件。
- 当前 API 版本固定为 `v1`。不兼容变更必须新建版本，不在 v1 中静默改变字段含义。

机器可读契约：`GET /api/openapi.json`。服务端源码中的客户端契约与 DTO 位于 `packages/shared/src/client.ts` 和 `apps/api/src/modules/client/`。
