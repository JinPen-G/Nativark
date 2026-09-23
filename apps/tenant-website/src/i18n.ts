import type { Category, Product, Tenant, Testimonial } from './types';

export type Language = 'zh' | 'en';

export const LANGUAGE_STORAGE_KEY = 'rental-os-tenant-language';

const dictionary = {
  zh: {
    home: '首页', allProducts: '全部商品', guide: '租赁指南', about: '关于我们', orders: '我的订单',
    rentNow: '立即租赁', searchPlaceholder: '搜索你想租的商品...', searchAria: '搜索商品',
    switchLanguage: '切换语言', chooseLanguage: '选择语言', switchTheme: '切换颜色模式', zhLanguage: '简体中文', enLanguage: 'English',
    closeMenu: '关闭菜单', openMenu: '打开菜单', explore: '立即探索', viewAll: '查看全部', viewMore: '查看更多',
    viewNow: '立即查看', bookNow: '立即租赁', productCategory: '商品分类', categoryAll: '全部',
    featuredCategoryTitle: '热门设备分类', featuredCategorySubtitle: '精选{category}，找到适合你的装备',
    featuredProductsTitle: '热门租赁设备', featuredProductsSubtitleSingle: '精选{category}，让每一次体验更自由',
    featuredProductsTitleGeneral: '热门商品推荐', featuredProductsSubtitleGeneral: '精选优质好物，开启你的精彩生活',
    whyChoose: '为什么选择我们', whyChooseSingle: '专业设备与用心服务，陪你完成每一次体验', whyChooseGeneral: '租得放心，用得尽兴',
    rentalProcess: '租赁流程', rentalProcessSubtitle: '简单四步，轻松租到心仪好物', testimonials: '用户评价',
    testimonialsSubtitle: '以下是演示评价，正式接入后展示租户真实评价', ctaTitle: '好装备，成就更好的你',
    ctaDescription: '发现值得体验的好物，让每一次出发都值得期待。', startRenting: '现在开始租赁',
    authentic: '正品保障', authenticShort: '精选优质设备', authenticDescription: '严格甄选 · 正品保障',
    delivery: '全国配送', deliveryShort: '快速送达', deliveryDescription: '覆盖全国 · 快速送达',
    flexible: '灵活租期', flexibleDescription: '按天 / 按周 / 按月 随心选', service: '专业服务',
    serviceShort: '贴心解答', serviceDescription: '贴心客服 · 随时解答',
    stepChoose: '选择商品', stepChooseDescription: '浏览商品 选择租期', stepBook: '在线预约', stepBookDescription: '填写信息 确认费用',
    stepReceive: '等待收货', stepReceiveDescription: '门店自取 或配送', stepUse: '开始使用', stepUseDescription: '享受精彩时光',
    exploreCollection: '探索好物', discoveryTitle: '发现值得体验的好物', discoveryDescription: '精选好物，灵活租用。从一次体验，开始更多可能。',
    searchProducts: '搜索商品名称或关键词', search: '搜索', itemCount: '共 {count} 件商品', sortLabel: '商品排序',
    recommendedSort: '推荐排序', priceLow: '价格从低到高', priceHigh: '价格从高到低', ratingSort: '评分优先', subcategory: '二级分类',
    noProducts: '暂时没有找到相关商品', tryOther: '试试其他关键词或分类。',
    detailImageNote: '实物交付前均经过检查与整理', featuredGood: '精选好物', available: '可预约 · 可用 {count} 件', unavailable: '暂不可租',
    reviewsCount: '{count} 条评价', depositConfirm: '押金 ¥{amount} · 预约时确认', chooseRentalPlan: '选择租赁方案',
    startDate: '开始日期', endDate: '结束日期', rentalQuantity: '租赁数量', itemUnit: '件', pickupDelivery: '取还方式',
    pickup: '门店自取', deliveryHome: '配送到家', rentalDays: '预计租期', rentalEstimate: '租金估算',
    demoBookingNote: '演示预约只保存在当前浏览器，不会提交给商家或锁定库存。', authenticEquipment: '正品设备', flexibleReturn: '灵活取还', professionalCheck: '专业检查',
    detailTabs: '商品详情', intro: '商品介绍', specs: '规格参数', rentalRules: '租赁须知', depositRules: '押金规则', fulfillment: '取还方式', reviews: '用户评价',
    aboutProduct: '关于这件好物', detailIntroExtra: '选择适合你的租期，完成预约后即可按所选方式取用。实际可租库存、配送范围和最终费用将在未来接入租户后台后实时确认。',
    ruleOne: '租期按所选开始和结束日期计算，当前演示价格为每日单价估算。', ruleTwo: '预约前请确认商品配置与使用要求；交付时检查设备和配件。',
    ruleThree: '如需延长租期，请在到期前联系商家确认可用情况。', depositText: '此商品的参考押金为每件 ¥{amount}。预约页将单独列示押金估算；收取方式、免押条件与退还时间需由商家在正式确认时说明。',
    fulfillmentText: '可选择门店自取或配送到家。取还地点、可选时间、配送范围及费用将由商家根据订单实际情况确认。',
    reviewsText: '演示数据暂未接入商品真实评价。欢迎在下单前咨询客服了解设备状态。', related: '相关推荐', relatedSubtitle: '更多同类好物，等你来发现',
    bookingTitle: '预约租赁', bookingDescription: '选择租期和取还方式，填写联系信息，轻松开启体验。', chooseProduct: '选择商品', chooseTerm: '选择租期', contact: '填写联系人', costConfirm: '确认费用',
    currentDemoQuantity: '当前演示可用数量：{count} 件', termTotal: '租期共 {days} 天', details: '查看详情', pickupDescription: '按商家确认的时间与地址取还', deliveryFeeDescription: '配送费用待商家确认',
    contactName: '联系人姓名', contactPhone: '联系电话', namePlaceholder: '请输入姓名', phonePlaceholder: '请输入 11 位手机号', noteOptional: '备注（选填）', notePlaceholder: '可填写取还时间、配送需求等',
    rentAmount: '租金', subtotal: '租金小计', referenceDeposit: '参考押金', totalEstimated: '预计费用合计', feeNote: '以上为演示估算。配送费、优惠和最终押金规则需商家确认。',
    submitDemo: '提交演示预约', submitNote: '提交后仅保存在当前浏览器，不会发送给商家，也不会锁定库存。', requiredName: '请填写联系人姓名', requiredPhone: '请填写联系电话',
    invalidDate: '结束日期需要晚于开始日期', invalidQuantity: '请选择有效的租赁数量', unavailableError: '当前商品暂不可预约', savedTitle: '演示预约已保存', savedDescription: '这是前端演示流程，商家不会收到预约，商品库存也没有被锁定。',
    orderNumber: '预约编号', bookingInfo: '预约信息', rentalDate: '租赁日期', contactPerson: '联系人', estimatedRent: '租金估算', continueExplore: '继续探索商品',
    myRentalsDescription: '这里展示当前浏览器保存的演示预约记录。', noOrders: '还没有预约记录', noOrdersDescription: '发现喜欢的商品，开始一次新的体验。', browseProducts: '去逛逛',
    missingProduct: '没有找到这件商品', returnProducts: '返回全部商品', missingOrder: '没有找到这笔演示预约', returnOrders: '返回我的订单',
    aboutTitle: '关于 {name}', aboutSelected: '精选好物', aboutSelectedText: '从设备品质到租赁体验，我们希望每一件商品都让你的生活更轻松。',
    aboutFlexible: '灵活租用', aboutFlexibleText: '根据需要选择租期与取还方式，把拥有的负担换成体验的自由。', aboutService: '用心服务',
    aboutServiceText: '从挑选到归还，随时获得清楚的说明与贴心的帮助。', exploreAllProducts: '探索全部商品',
    guideTitle: '租赁指南', guideDescription: '从选商品到归还，只需几个简单步骤。', guideChoose: '挑选好物', guideChooseText: '浏览分类与商品详情，找到适合自己的设备。', guideTerm: '选择租期', guideTermText: '选择开始和结束日期、租赁数量以及取还方式。', guideSubmit: '提交预约', guideSubmitText: '确认联系人与费用估算，提交预约需求。', guideConfirm: '确认取用', guideConfirmText: '未来接入商家系统后，将由商家确认库存、费用与取还安排。', startChoosing: '开始挑选',
    helpTitle: '帮助中心', helpDescription: '关于租期、押金和取还方式，先看看这里。', faqTerm: '租期如何计算？', faqTermText: '当前演示按开始和结束日期均计入租期，实际计价规则以后由租户后台配置。', faqDeposit: '押金什么时候退还？', faqDepositText: '押金规则需要商家根据商品和订单确认。正式接入后会展示明确的支付与退还说明。', faqDelivery: '可以选择配送吗？', faqDeliveryText: '页面已预留配送入口，配送范围、运费和具体时间将由商家确认。', faqContact: '怎样联系商家？', faqContactText: '请拨打 {phone}，或通过 {service} 联系。',
    footerExplore: '探索租赁', footerBrand: '品牌介绍', footerHelp: '帮助中心', footerContact: '联系我们', contactSupport: '联系客服', allRights: '保留所有权利。', footerLegal: '条款与政策',
    docUserAgreement: '用户服务协议', docPrivacyPolicy: '隐私政策', docVersion: '版本：{version}', docExternalLink: '查看完整文件', docNotProvided: '商户暂未提供该文件内容。', docDemoNotice: '演示预览未连接真实商户，暂无该文件。', loginAgreePrefix: '我已阅读并同意', and: '与',
    loginTitle: '登录 / 注册', loginSubtitle: '登录后可查看订单、地址与优惠券，并发起真实预约。', loginDemoNotice: '当前是演示预览，未连接某个真实租户，暂不提供登录。请通过 ?tenantCode= 或租户域名访问以启用账号功能。', backHome: '返回首页',
    loginSms: '验证码登录', loginPassword: '密码登录', loginRegister: '注册', loginPhone: '手机号', loginPasswordField: '密码', loginPasswordPlaceholder: '请输入密码', loginPasswordRule: '至少 8 位密码',
    loginCode: '短信验证码', loginCodePlaceholder: '6 位验证码', loginSendCode: '获取验证码', loginDevCode: '开发环境验证码：{code}（正式环境将通过短信下发）', loginAgree: '我已阅读并同意用户服务协议与隐私政策', loginNeedAgree: '请先同意用户服务协议与隐私政策', loginNeedCode: '请先获取并填写验证码',
    loginFailed: '登录失败，请稍后重试', loginSubmit: '登录', loginRegisterSubmit: '注册并登录', loginFootNote: '登录即表示同意平台的服务条款；账号与数据按租户隔离。', loginRequired: '请先登录', loginCta: '登录', logoutCta: '退出登录',
    loading: '加载中', loadFailed: '加载失败，请稍后重试', quoteFailed: '报价失败，请调整租期或稍后重试', orderFailed: '下单失败，请稍后重试',
    checkAvailability: '查询可租', getQuote: '获取报价', availabilityOk: '所选时段可租', availabilityNo: '所选时段不可租，请调整日期或数量', discount: '优惠', deposit: '押金', preAuth: '预授权', payable: '应付合计', quoteServerNote: '以上金额由服务端按当前价格与库存计算，提交后仍以订单为准。', submitOrder: '提交订单',
    selectAddress: '配送地址', noAddress: '还没有配送地址，', deliveryNeedsAddress: '请选择配送地址', useCoupon: '优惠券', couponNone: '不使用优惠券', couponDeducted: '优惠券抵扣',
    myRentalsRemoteDesc: '这里是你在本商户的真实订单。', orderStatus: '状态：{status}', orderStatus_draft: '待确认', orderStatus_reserved: '已预订', orderStatus_pickup_overdue: '取件逾期', orderStatus_ready_for_pickup: '待取件', orderStatus_renting: '租赁中', orderStatus_return_inspection: '归还验收', orderStatus_settling: '待结算', orderStatus_completed: '已完成', orderStatus_cancelled: '已取消', orderStatus_no_show: '未到店',
    payTitle: '在线支付', payAlipay: '支付宝支付', payWechat: '微信支付', payGo: '去支付', payUnavailable: '当前商户未开通在线支付，请按商户指引线下支付。', paymentCreated: '支付单已创建，请按提示完成支付。', paymentFailed: '发起支付失败，请稍后重试', paySettleNote: '“支付单已创建”不等于已收款，最终以商户到账为准。',
    accountTitle: '账户中心', accountSubtitle: '管理你的地址、优惠券与通知。', accountGreeting: '你好，{name}', save: '保存', delete: '删除', saveFailed: '保存失败，请稍后重试', deleteFailed: '删除失败，请稍后重试',
    addressBook: '配送地址', addAddress: '新增地址', addressEmpty: '还没有配送地址。', addrRecipient: '收件人', addrPhone: '手机号', addrProvince: '省', addrCity: '市', addrDistrict: '区/县', addrDetail: '详细地址', addrDefault: '设为默认', coupons: '优惠券', couponsEmpty: '暂无可用优惠券。', coupon: '优惠券', couponExpires: '有效期至 {date}', notifications: '通知', notification: '通知', notificationsEmpty: '暂无通知。',
  },
  en: {
    home: 'Home', allProducts: 'All products', guide: 'Rental guide', about: 'About us', orders: 'My rentals',
    rentNow: 'Rent now', searchPlaceholder: 'Search for something to rent...', searchAria: 'Search products',
    switchLanguage: 'Switch language', chooseLanguage: 'Choose language', switchTheme: 'Toggle appearance', zhLanguage: '简体中文', enLanguage: 'English',
    closeMenu: 'Close menu', openMenu: 'Open menu', explore: 'Explore now', viewAll: 'View all', viewMore: 'View more',
    viewNow: 'View now', bookNow: 'Rent now', productCategory: 'Categories', categoryAll: 'All',
    featuredCategoryTitle: 'Popular categories', featuredCategorySubtitle: 'Find the right gear in {category}',
    featuredProductsTitle: 'Popular rentals', featuredProductsSubtitleSingle: 'Curated {category} for more freedom in every experience',
    featuredProductsTitleGeneral: 'Popular picks', featuredProductsSubtitleGeneral: 'Quality essentials for the life you want to live',
    whyChoose: 'Why choose us', whyChooseSingle: 'Professional gear and thoughtful service for every experience', whyChooseGeneral: 'Rent with confidence, enjoy every moment',
    rentalProcess: 'How it works', rentalProcessSubtitle: 'Four simple steps to rent what you need', testimonials: 'Customer stories',
    testimonialsSubtitle: 'Demo testimonials for now; real tenant reviews will appear after integration', ctaTitle: 'Better gear, better experiences',
    ctaDescription: 'Find something worth experiencing and make every departure count.', startRenting: 'Start renting',
    authentic: 'Quality checked', authenticShort: 'Curated equipment', authenticDescription: 'Carefully selected · Genuine gear',
    delivery: 'Nationwide delivery', deliveryShort: 'Fast delivery', deliveryDescription: 'Across the country · Delivered fast',
    flexible: 'Flexible terms', flexibleDescription: 'Daily / weekly / monthly options', service: 'Expert support',
    serviceShort: 'Here when you need us', serviceDescription: 'Helpful support · Ready to answer',
    stepChoose: 'Choose a product', stepChooseDescription: 'Browse products and pick your term', stepBook: 'Book online', stepBookDescription: 'Add your details and confirm the cost',
    stepReceive: 'Receive your rental', stepReceiveDescription: 'Pick up in store or get it delivered', stepUse: 'Start using it', stepUseDescription: 'Enjoy the moment',
    exploreCollection: 'EXPLORE THE COLLECTION', discoveryTitle: 'Find something worth experiencing', discoveryDescription: 'Curated essentials, available when you need them.',
    searchProducts: 'Search by product or keyword', search: 'Search', itemCount: '{count} items', sortLabel: 'Sort products',
    recommendedSort: 'Recommended', priceLow: 'Price: low to high', priceHigh: 'Price: high to low', ratingSort: 'Top rated', subcategory: 'Subcategories',
    noProducts: 'No matching products found', tryOther: 'Try another keyword or category.',
    detailImageNote: 'Every item is checked and prepared before handover', featuredGood: 'Featured rental', available: 'Available · {count} in stock', unavailable: 'Currently unavailable',
    reviewsCount: '{count} reviews', depositConfirm: 'Deposit ¥{amount} · confirmed at booking', chooseRentalPlan: 'Choose your rental plan',
    startDate: 'Start date', endDate: 'End date', rentalQuantity: 'Quantity', itemUnit: 'item(s)', pickupDelivery: 'Fulfillment',
    pickup: 'Store pickup', deliveryHome: 'Delivery', rentalDays: 'Rental term', rentalEstimate: 'Estimated rental',
    demoBookingNote: 'Demo bookings are saved in this browser only. They do not reach the tenant or reserve inventory.', authenticEquipment: 'Quality equipment', flexibleReturn: 'Flexible pickup and return', professionalCheck: 'Professionally checked',
    detailTabs: 'Product details', intro: 'Overview', specs: 'Specifications', rentalRules: 'Rental notes', depositRules: 'Deposit policy', fulfillment: 'Pickup and delivery', reviews: 'Reviews',
    aboutProduct: 'About this rental', detailIntroExtra: 'Choose the term that fits, complete your booking, and use the item through your selected fulfillment method. Live inventory, delivery coverage, and final pricing will be confirmed after the tenant backend is connected.',
    ruleOne: 'The rental term is calculated from the selected start and end dates. The demo uses a daily rate.', ruleTwo: 'Check the configuration and usage requirements before booking; inspect the item and accessories at handover.',
    ruleThree: 'Contact the tenant before the due date if you need to extend the rental.', depositText: 'The reference deposit is ¥{amount} per item. The booking page shows an estimate; the tenant will confirm collection, waiver conditions, and refund timing.',
    fulfillmentText: 'Choose store pickup or delivery. The tenant will confirm the location, time window, delivery coverage, and fee for the order.',
    reviewsText: 'Real product reviews are not connected in this demo. Contact support to check the item condition before booking.', related: 'You may also like', relatedSubtitle: 'More rentals in the same category',
    bookingTitle: 'Book a rental', bookingDescription: 'Choose your dates and fulfillment method, add your contact details, and get started.', chooseProduct: 'Choose a product', chooseTerm: 'Choose your dates', contact: 'Contact details', costConfirm: 'Confirm costs',
    currentDemoQuantity: 'Demo availability: {count} item(s)', termTotal: 'Rental term: {days} day(s)', details: 'View details', pickupDescription: 'Pick up and return at the time and address confirmed by the tenant', deliveryFeeDescription: 'Delivery fee to be confirmed by the tenant',
    contactName: 'Name', contactPhone: 'Phone number', namePlaceholder: 'Enter your name', phonePlaceholder: 'Enter your phone number', noteOptional: 'Note (optional)', notePlaceholder: 'Add pickup time or delivery notes',
    rentAmount: 'Rental', subtotal: 'Rental subtotal', referenceDeposit: 'Reference deposit', totalEstimated: 'Estimated total', feeNote: 'This is a demo estimate. Delivery fees, discounts, and the final deposit policy are confirmed by the tenant.',
    submitDemo: 'Submit demo booking', submitNote: 'This is saved in the browser only. It will not be sent to the tenant or reserve inventory.', requiredName: 'Please enter your name', requiredPhone: 'Please enter your phone number',
    invalidDate: 'The end date must be after the start date', invalidQuantity: 'Choose a valid quantity', unavailableError: 'This product is currently unavailable', savedTitle: 'Demo booking saved', savedDescription: 'This is a frontend demo. The tenant did not receive the booking and inventory was not reserved.',
    orderNumber: 'Booking number', bookingInfo: 'Booking details', rentalDate: 'Rental dates', contactPerson: 'Contact', estimatedRent: 'Estimated rental', continueExplore: 'Continue exploring',
    myRentalsDescription: 'Demo bookings saved in this browser appear here.', noOrders: 'No bookings yet', noOrdersDescription: 'Find something you like and start a new experience.', browseProducts: 'Browse products',
    missingProduct: 'We could not find this product', returnProducts: 'Back to all products', missingOrder: 'We could not find this demo booking', returnOrders: 'Back to my rentals',
    aboutTitle: 'About {name}', aboutSelected: 'Curated essentials', aboutSelectedText: 'From equipment quality to the rental experience, every item is chosen to make life easier.',
    aboutFlexible: 'Flexible rentals', aboutFlexibleText: 'Choose the term and fulfillment method you need, and trade the burden of ownership for the freedom of experience.', aboutService: 'Thoughtful service',
    aboutServiceText: 'From choosing to returning, clear guidance and helpful support are always close by.', exploreAllProducts: 'Explore all products',
    guideTitle: 'Rental guide', guideDescription: 'From choosing an item to returning it, it only takes a few simple steps.', guideChoose: 'Choose your item', guideChooseText: 'Browse categories and product details to find the right gear.', guideTerm: 'Choose your term', guideTermText: 'Select dates, quantity, and how you want to receive and return it.', guideSubmit: 'Submit a booking', guideSubmitText: 'Confirm your contact details and estimated costs.', guideConfirm: 'Confirm fulfillment', guideConfirmText: 'After backend integration, the tenant will confirm inventory, pricing, and pickup or delivery.', startChoosing: 'Start browsing',
    helpTitle: 'Help center', helpDescription: 'Find quick answers about rental terms, deposits, pickup, and delivery.', faqTerm: 'How is the rental term calculated?', faqTermText: 'The demo counts both the start and end dates. The tenant backend will define the final pricing rules.', faqDeposit: 'When is the deposit refunded?', faqDepositText: 'The tenant confirms deposit rules for each product and order. The connected site will show clear payment and refund details.', faqDelivery: 'Can I request delivery?', faqDeliveryText: 'The delivery option is ready in the flow. The tenant will confirm coverage, fees, and timing.', faqContact: 'How do I contact the tenant?', faqContactText: 'Call {phone}, or reach out through {service}.',
    footerExplore: 'Explore rentals', footerBrand: 'About the brand', footerHelp: 'Help center', footerContact: 'Contact us', contactSupport: 'Contact support', allRights: 'All rights reserved.', footerLegal: 'Terms & policies',
    docUserAgreement: 'User Agreement', docPrivacyPolicy: 'Privacy Policy', docVersion: 'Version: {version}', docExternalLink: 'View full document', docNotProvided: 'The merchant has not provided this document yet.', docDemoNotice: 'Demo preview is not connected to a real merchant; this document is unavailable.', loginAgreePrefix: 'I have read and agree to the', and: 'and',
    loginTitle: 'Sign in / Register', loginSubtitle: 'Sign in to view orders, addresses and coupons, and to make a real booking.', loginDemoNotice: 'This is a demo preview not connected to a real tenant, so sign-in is unavailable. Open the site via ?tenantCode= or a tenant domain to enable account features.', backHome: 'Back home',
    loginSms: 'Code sign-in', loginPassword: 'Password', loginRegister: 'Register', loginPhone: 'Mobile number', loginPasswordField: 'Password', loginPasswordPlaceholder: 'Enter your password', loginPasswordRule: 'At least 8 characters',
    loginCode: 'SMS code', loginCodePlaceholder: '6-digit code', loginSendCode: 'Get code', loginDevCode: 'Dev code: {code} (sent via SMS in production)', loginAgree: 'I have read and agree to the User Agreement and Privacy Policy', loginNeedAgree: 'Please agree to the User Agreement and Privacy Policy first', loginNeedCode: 'Please request and enter the code first',
    loginFailed: 'Sign-in failed, please try again', loginSubmit: 'Sign in', loginRegisterSubmit: 'Register & sign in', loginFootNote: 'By continuing you accept the platform terms; accounts and data are isolated per tenant.', loginRequired: 'Please sign in first', loginCta: 'Sign in', logoutCta: 'Sign out',
    loading: 'Loading', loadFailed: 'Failed to load, please try again', quoteFailed: 'Quote failed — adjust the term or try again', orderFailed: 'Order failed, please try again',
    checkAvailability: 'Check availability', getQuote: 'Get quote', availabilityOk: 'Available for the selected dates', availabilityNo: 'Unavailable for the selected dates — adjust dates or quantity', discount: 'Discount', deposit: 'Deposit', preAuth: 'Pre-authorization', payable: 'Total payable', quoteServerNote: 'Amounts are calculated by the server from current pricing and inventory; the order is the source of truth.', submitOrder: 'Submit order',
    selectAddress: 'Delivery address', noAddress: 'No delivery address yet, ', deliveryNeedsAddress: 'Please choose a delivery address', useCoupon: 'Coupon', couponNone: 'No coupon', couponDeducted: 'Coupon discount',
    myRentalsRemoteDesc: 'Your real orders with this merchant.', orderStatus: 'Status: {status}', orderStatus_draft: 'Pending', orderStatus_reserved: 'Reserved', orderStatus_pickup_overdue: 'Pickup overdue', orderStatus_ready_for_pickup: 'Ready for pickup', orderStatus_renting: 'Renting', orderStatus_return_inspection: 'Return inspection', orderStatus_settling: 'Settling', orderStatus_completed: 'Completed', orderStatus_cancelled: 'Cancelled', orderStatus_no_show: 'No-show',
    payTitle: 'Online payment', payAlipay: 'Pay with Alipay', payWechat: 'Pay with WeChat', payGo: 'Go to pay', payUnavailable: 'This merchant has no online payment enabled; please pay offline per their guidance.', paymentCreated: 'Payment created — follow the prompt to complete it.', paymentFailed: 'Failed to start payment, please try again', paySettleNote: '"Payment created" does not mean paid; the merchant\'s receipt is the source of truth.',
    accountTitle: 'Account', accountSubtitle: 'Manage your addresses, coupons and notifications.', accountGreeting: 'Hi, {name}', save: 'Save', delete: 'Delete', saveFailed: 'Save failed, please try again', deleteFailed: 'Delete failed, please try again',
    addressBook: 'Delivery addresses', addAddress: 'Add address', addressEmpty: 'No delivery address yet.', addrRecipient: 'Recipient', addrPhone: 'Phone', addrProvince: 'Province', addrCity: 'City', addrDistrict: 'District', addrDetail: 'Detailed address', addrDefault: 'Set as default', coupons: 'Coupons', couponsEmpty: 'No coupons available.', coupon: 'Coupon', couponExpires: 'Valid until {date}', notifications: 'Notifications', notification: 'Notification', notificationsEmpty: 'No notifications.',
  },
} as const;

export type TranslationKey = keyof typeof dictionary.zh;

export function createTranslator(language: Language) {
  return (key: TranslationKey, values?: Record<string, string | number>) => {
    let result: string = dictionary[language][key] || dictionary.zh[key];
    Object.entries(values || {}).forEach(([name, value]) => { result = result.replaceAll(`{${name}}`, String(value)); });
    return result;
  };
}

const categoryEnglish: Record<string, { name: string; shortName: string; description: string; heroTitle: string; heroDescription: string; sceneTitle: string; children: Record<string, { name: string; description: string }> }> = {
  camera: { name: 'Camera gear', shortName: 'Camera', description: 'Cameras / lenses / lighting', heroTitle: 'Professional camera gear\nReady when you are', heroDescription: 'From cameras and lenses to lights and stabilizers\nCreate more, own less', sceneTitle: 'Capture the moment', children: { 'camera-body': { name: 'Camera bodies', description: 'Full-frame / mirrorless / DSLR' }, lens: { name: 'Lenses', description: 'Prime / zoom / wide angle' }, lighting: { name: 'Lighting', description: 'Continuous / flash lights' }, stabilizer: { name: 'Stabilizers', description: 'Handheld gimbals / image stability' }, drone: { name: 'Drones', description: 'Aerial capture / creative work' } } },
  camping: { name: 'Outdoor gear', shortName: 'Outdoors', description: 'Tents / tables / camp cooking', heroTitle: 'Step into nature\nLive another kind of life', heroDescription: 'Tents, chairs, and outdoor essentials are ready\nTravel light and gather freely', sceneTitle: 'Go camping, go outside', children: { tent: { name: 'Tents', description: 'Two-person / family / canopies' }, 'camp-chair': { name: 'Tables and chairs', description: 'Folding chairs / roll-top tables' }, 'camp-cook': { name: 'Camp cooking', description: 'Stoves / cookware' } } },
  vehicle: { name: 'Cars and travel', shortName: 'Travel', description: 'Cars / EVs / road trips', heroTitle: 'Drive out\nWhenever you are ready', heroDescription: 'Flexible vehicles and rental terms', sceneTitle: 'Take the road your way', children: { car: { name: 'Cars', description: 'Sedans / SUVs' } } },
  digital: { name: 'Digital hardware', shortName: 'Digital', description: 'Computers / tablets / gaming', heroTitle: 'The right tools for your ideas', heroDescription: 'Rent digital essentials when you need them', sceneTitle: 'Tools that keep ideas moving', children: { computer: { name: 'Computers', description: 'Laptops / tablets' } } },
  construction: { name: 'Tools and equipment', shortName: 'Tools', description: 'Power tools / measuring gear', heroTitle: 'The right tool gets more done', heroDescription: 'Professional tools, available on demand', sceneTitle: 'Work with the right tools', children: { 'power-tools': { name: 'Power tools', description: 'Drilling / cutting' } } },
  home: { name: 'Home and living', shortName: 'Home', description: 'Appliances / everyday essentials', heroTitle: 'Make home work for you', heroDescription: 'Rent practical essentials as needed', sceneTitle: 'Everything home needs', children: { 'home-appliance': { name: 'Home appliances', description: 'Appliances / cleaning' } } },
  baby: { name: 'Baby and family', shortName: 'Family', description: 'Strollers / safety seats', heroTitle: 'Make growing up a little easier', heroDescription: 'Baby essentials when you need them', sceneTitle: 'More ease for growing families', children: { stroller: { name: 'Strollers', description: 'Lightweight / safe' } } },
  sports: { name: 'Sports and outdoors', shortName: 'Sports', description: 'Cycling / ball sports / outdoors', heroTitle: 'Get outside and move', heroDescription: 'More ways to start an active day', sceneTitle: 'Make room for movement', children: { outdoor: { name: 'Outdoor sports', description: 'Cycling / ball sports' } } },
};

const productEnglish: Record<string, Partial<Product>> = {
  'camera-a7': { name: 'Sony A7M4', subtitle: 'Full-frame mirrorless camera', tags: ['Full-frame', 'Photography'], badges: ['Popular'], description: 'A full-frame mirrorless camera for portraits, travel, and commercial shoots. Ready to rent and ready to create.', specs: { Type: 'Full-frame mirrorless', Accessories: 'Body, strap, battery, charger', Fulfillment: 'Store pickup or delivery' } },
  'lens-rf': { name: 'Canon RF 24–70mm', subtitle: 'F2.8 L zoom lens', tags: ['Lens', 'Photography'], description: 'A versatile everyday focal range with a balance of portability and image quality.', specs: { FocalLength: '24–70mm', Aperture: 'F2.8', Accessories: 'Caps, hood, lens bag' } },
  'camera-light': { name: 'Professional light kit', subtitle: 'Two-light softbox setup', tags: ['Lighting', 'Photography'], description: 'Soft, reliable light for portraits and still-life shoots.', specs: { Equipment: 'Two-light kit', Accessories: 'Stands, softboxes, power cables' } },
  'camera-stabilizer': { name: 'Handheld stabilizer', subtitle: 'Lightweight camera gimbal', tags: ['Video', 'Photography'], description: 'Keep moving shots steady and make every take feel more considered.', specs: { Type: 'Three-axis handheld gimbal', Accessories: 'Case, charging cable' } },
  'camera-drone': { name: 'Lightweight camera drone', subtitle: 'Aerial gear for travel and creative work', tags: ['Drone', 'Photography'], description: 'Capture travel and creative work from a fresh perspective.', specs: { Type: 'Lightweight camera drone', Accessories: 'Controller, batteries, case' } },
  'camp-tent': { name: 'Naturehike Cloudland tent', subtitle: 'Four-season tent for 3–4 people', tags: ['Camping', 'Family'], badges: ['Featured'], description: 'Roomy, easy to pitch, and made for weekend camping and family trips.', specs: { Capacity: '3–4 people', Accessories: 'Tent, stakes, guy lines, carry bag' } },
  'camp-chair': { name: 'Helinox lightweight folding chair', subtitle: 'Outdoor camping chair', tags: ['Camping', 'Lightweight'], description: 'Easy to pack and carry for a comfortable outdoor moment anywhere.', specs: { Type: 'Lightweight folding chair', Accessories: 'Seat, frame, carry bag' } },
  'vehicle-suv': { name: 'City SUV', subtitle: 'Comfortable space · flexible road trips', tags: ['Road trip', 'Travel'], description: 'Comfortable and spacious for city drives and short weekend trips.', specs: { Type: 'Five-seat SUV', Fulfillment: 'Store handover' } },
  'digital-laptop': { name: 'Lightweight laptop', subtitle: 'High-performance mobile work', tags: ['Work', 'Digital'], description: 'A balance of performance and portability for short-term work, travel, and presentations.', specs: { Type: 'Lightweight laptop', Accessories: 'Power adapter, laptop bag' } },
  'tool-drill': { name: 'Power hammer drill', subtitle: 'Professional power tool', tags: ['Construction', 'Tools'], description: 'Ready for home improvement and professional tasks.', specs: { Type: 'Multi-purpose hammer drill', Accessories: 'Tool case, drill bits' } },
  'home-appliance': { name: 'Portable home appliance', subtitle: 'Flexible rental for easier living', tags: ['Home'], description: 'Rent practical equipment when it fits your life.', specs: { Type: 'Home equipment', Fulfillment: 'Store pickup or delivery' } },
  'baby-stroller': { name: 'Lightweight stroller', subtitle: 'Compact and easy to fold', tags: ['Family', 'Travel'], description: 'Light to push and easy to fold for simpler family trips.', specs: { Type: 'Lightweight stroller', Accessories: 'Stroller, sun canopy' } },
  'sport-outdoor': { name: 'Outdoor sports kit', subtitle: 'A good partner for the weekend', tags: ['Outdoors', 'Sports'], description: 'Bring more outdoor experiences into every weekend.', specs: { Type: 'Outdoor sports equipment', Fulfillment: 'Store pickup or delivery' } },
};

const tenantEnglish: Record<string, { slogan: string; footerText: string; heroTitle: string; heroDescription: string; customerService: string; address: string }> = {
  'tenant-single': { slogan: 'Professional gear, ready when you are', footerText: 'Professional camera gear, ready when you are. Rent what you need and create more freely.', heroTitle: 'Professional camera gear\nReady when you are', heroDescription: 'From cameras and lenses to lights and stabilizers\nCreate more, own less', customerService: 'Online support', address: 'Contact the store for pickup and return details' },
  'tenant-double': { slogan: 'Better gear, bigger adventures', footerText: 'Camera gear and outdoor essentials for every trip, story, and weekend.', heroTitle: 'Bring the right gear\nDiscover a bigger world', heroDescription: 'Camera gear × outdoor essentials\nMake every departure easier', customerService: 'Online support', address: 'Contact the store for pickup and return details' },
  'tenant-multiple': { slogan: 'Good things, ready when you need them', footerText: 'Good things, ready when you need them. Rent what fits the moment and live more freely.', heroTitle: 'Good things do not need to be owned\nThey can be ready anytime', heroDescription: 'Digital, outdoors, home, tools, and family essentials…\nRent what you need and make life easier', customerService: 'Online support', address: 'Contact the store for pickup and return details' },
};

const testimonialEnglish: Record<string, Testimonial> = {
  '器材状态很好，取还方便。周末出门拍照再也不用纠结要不要买新镜头。': { name: 'Ms. Chen', context: 'Weekend photography', text: 'The gear was in great condition and pickup was easy. I can shoot on weekends without wondering whether to buy another lens.' },
  '需要的机身和镜头都能找到，租期选择也很灵活，拍摄准备轻松不少。': { name: 'Mr. Zhao', context: 'Short film shoot', text: 'I found the body and lenses I needed, and the flexible terms made shoot prep much easier.' },
  '第一次租相机也能很快看懂流程，设备拿到手就可以出发拍摄。': { name: 'Ms. Lin', context: 'Travel stories', text: 'The process was easy to understand even for a first-time camera rental. I was ready to shoot as soon as I picked it up.' },
  '第一次带家人露营，装备准备得很齐全，按需租比囤在家里省心多了。': { name: 'Mr. Wang', context: 'Family camping', text: 'Everything was ready for our first family camping trip. Renting what we needed was much easier than storing it all at home.' },
  '相机和露营装备一次挑齐，出发前准备更从容，周末过得很尽兴。': { name: 'Mr. Lin', context: 'Outdoor shoot', text: 'I picked camera and camping gear in one place, so the weekend started with much less preparation.' },
  '临时需要设备时能快速找到合适的选择，预约流程清楚，服务也很及时。': { name: 'Ms. Lin', context: 'Short-term project', text: 'It was quick to find the right equipment for a last-minute project. The booking flow was clear and support was responsive.' },
};

export function localizeCategory(category: Category, language: Language): Category {
  if (language === 'zh') return category;
  const copy = categoryEnglish[category.id];
  return {
    ...category, name: category.nameEn || copy?.name || category.name, shortName: category.shortNameEn || copy?.shortName || category.shortName, description: category.descriptionEn || copy?.description || category.description,
    heroTitle: category.heroTitleEn || copy?.heroTitle || category.heroTitle, heroDescription: category.heroDescriptionEn || copy?.heroDescription || category.heroDescription, sceneTitle: category.sceneTitleEn || copy?.sceneTitle || category.sceneTitle,
    children: category.children.map(child => ({ ...child, name: child.nameEn || copy?.children[child.id]?.name || child.name, description: child.descriptionEn || copy?.children[child.id]?.description || child.description })),
  };
}

export function localizeProduct(product: Product, language: Language): Product {
  if (language === 'zh') return product;
  return { ...product, ...productEnglish[product.id], name: product.nameEn || productEnglish[product.id]?.name || product.name, subtitle: product.subtitleEn || productEnglish[product.id]?.subtitle || product.subtitle, tags: product.tagsEn || productEnglish[product.id]?.tags || product.tags, badges: product.badgesEn || productEnglish[product.id]?.badges || product.badges, description: product.descriptionEn || productEnglish[product.id]?.description || product.description, specs: product.specsEn || productEnglish[product.id]?.specs || product.specs };
}

export function localizeTenant(tenant: Tenant, language: Language): Tenant {
  if (language === 'zh') return tenant;
  const copy = tenantEnglish[tenant.id];
  return {
    ...tenant,
    ...(copy || {}),
    name: tenant.nameEn || tenant.name,
    slogan: tenant.sloganEn || copy?.slogan || tenant.slogan,
    customerService: tenant.customerServiceEn || copy?.customerService || tenant.customerService,
    address: tenant.addressEn || copy?.address || tenant.address,
    footerText: tenant.footerTextEn || copy?.footerText || tenant.footerText,
    heroTitle: tenant.heroTitleEn || copy?.heroTitle || tenant.heroTitle,
    heroDescription: tenant.heroDescriptionEn || copy?.heroDescription || tenant.heroDescription,
    categories: tenant.categories.map(category => localizeCategory(category, language)),
    testimonials: tenant.testimonials.map(review => review.textEn ? { ...review, name: review.nameEn || review.name, context: review.contextEn || review.context, text: review.textEn } : testimonialEnglish[review.text] || review),
  };
}
