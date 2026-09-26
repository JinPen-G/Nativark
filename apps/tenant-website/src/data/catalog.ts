import type { Category, DemoTenantKey, Product, Store, Tenant } from '../types';
import { PLATFORM_THEME } from '../theme';

const asset = (name: string) => `/assets/${name}.webp`;

export const categories: Category[] = [
  {
    id: 'camera', name: '摄影器材', shortName: '摄影', description: '相机 / 镜头 / 灯光', icon: 'camera',
    image: asset('product-camera'), heroImage: asset('single-camera-hero'),
    heroTitle: '专业摄影器材\n随时租，轻松拍', heroDescription: '从相机到镜头，从灯光到稳定器\n让好设备不再昂贵，让创作更自由', sceneTitle: '记录精彩瞬间', sceneImage: asset('scene-camera'),
    children: [
      { id: 'camera-body', name: '相机机身', description: '全画幅 / 微单 / 单反', image: asset('product-camera') },
      { id: 'lens', name: '镜头', description: '定焦 / 变焦 / 广角', image: asset('product-lens') },
      { id: 'lighting', name: '灯光设备', description: '常亮灯 / 闪光灯', image: asset('product-light') },
      { id: 'stabilizer', name: '稳定器', description: '手持云台 / 影像稳定', image: asset('product-stabilizer') },
      { id: 'drone', name: '无人机', description: '航拍 / 创作', image: asset('product-drone') },
    ],
  },
  {
    id: 'camping', name: '露营装备', shortName: '露营', description: '帐篷 / 桌椅 / 炊具', icon: 'camping',
    image: asset('product-tent'), heroImage: asset('double-camping-hero'),
    heroTitle: '走进自然\n开启另一种生活', heroDescription: '帐篷、桌椅和户外装备都已备好\n轻装出发，享受每一次自在相聚', sceneTitle: '去露营，去自然', sceneImage: asset('scene-camping'),
    children: [
      { id: 'tent', name: '帐篷', description: '双人 / 家庭 / 天幕', image: asset('product-tent') },
      { id: 'camp-chair', name: '桌椅', description: '折叠椅 / 蛋卷桌', image: asset('product-chair') },
      { id: 'camp-cook', name: '炊具', description: '炉具 / 锅具', image: asset('product-tent') },
    ],
  },
  { id: 'vehicle', name: '出行用车', shortName: '用车', description: '汽车 / 电动车 / 自驾', icon: 'car', image: asset('product-car'), heroImage: asset('scene-vehicle'), heroTitle: '自驾出行\n说走就走', heroDescription: '多车型可选，灵活租期', sceneTitle: '自驾出行，说走就走', sceneImage: asset('scene-vehicle'), children: [{ id: 'car', name: '汽车', description: '轿车 / SUV', image: asset('product-car') }] },
  { id: 'digital', name: '数码硬件', shortName: '数码', description: '电脑 / 平板 / 游戏', icon: 'laptop', image: asset('product-laptop'), heroImage: asset('multi-lifestyle-hero'), heroTitle: '好设备，让灵感随行', heroDescription: '灵活租用数码好物', sceneTitle: '好设备，让灵感随行', sceneImage: asset('multi-lifestyle-hero'), children: [{ id: 'computer', name: '电脑', description: '笔记本 / 平板', image: asset('product-laptop') }] },
  { id: 'construction', name: '工程工具', shortName: '工具', description: '电动工具 / 测量设备', icon: 'tool', image: asset('product-drill'), heroImage: asset('scene-camera'), heroTitle: '趁手工具，事半功倍', heroDescription: '按需租用专业工具', sceneTitle: '趁手工具，事半功倍', sceneImage: asset('scene-camera'), children: [{ id: 'power-tools', name: '电动工具', description: '钻孔 / 切割', image: asset('product-drill') }] },
  { id: 'home', name: '家居用品', shortName: '家居', description: '家电 / 生活用品', icon: 'home', image: asset('product-appliance'), heroImage: asset('multi-lifestyle-hero'), heroTitle: '家的需要，按需拥有', heroDescription: '让生活更自在', sceneTitle: '家的需要，按需拥有', sceneImage: asset('multi-lifestyle-hero'), children: [{ id: 'home-appliance', name: '家用电器', description: '家电 / 清洁', image: asset('product-appliance') }] },
  { id: 'baby', name: '母婴用品', shortName: '母婴', description: '婴儿车 / 安全座椅', icon: 'baby', image: asset('product-stroller'), heroImage: asset('multi-lifestyle-hero'), heroTitle: '陪伴成长，轻松一点', heroDescription: '按需选用母婴好物', sceneTitle: '陪伴成长，轻松一点', sceneImage: asset('multi-lifestyle-hero'), children: [{ id: 'stroller', name: '婴儿车', description: '轻便 / 安全', image: asset('product-stroller') }] },
  { id: 'sports', name: '运动户外', shortName: '运动', description: '骑行 / 球类 / 户外', icon: 'sports', image: asset('product-sports'), heroImage: asset('scene-camping'), heroTitle: '随时出发，尽情运动', heroDescription: '更多体验，轻松开始', sceneTitle: '随时出发，尽情运动', sceneImage: asset('scene-camping'), children: [{ id: 'outdoor', name: '户外运动', description: '骑行 / 球类', image: asset('product-sports') }] },
];

/** 演示门店：真实模式下门店来自后端公开目录的 locations（见 remoteSite）。 */
export const demoStores: Store[] = [
  { id: 'store-city', name: '城西旗舰门店', nameEn: 'West City Flagship', address: '市中心 · 创意园 A 座 1 层', addressEn: 'Downtown · Creative Park, Block A, F1', businessHours: '09:00–21:00', contactPhone: '400-000-0001', capabilities: ['pickup', 'return', 'storage'] },
  { id: 'store-lake', name: '东湖社区店', nameEn: 'East Lake Community', address: '东湖新区 · 湖畔广场 B2', addressEn: 'East Lake District · Lakeside Plaza B2', businessHours: '10:00–20:00', contactPhone: '400-000-0002', capabilities: ['pickup', 'return'] },
  { id: 'store-station', name: '高铁南站取还点', nameEn: 'South Railway Point', address: '高铁南站 · 到达层便民服务区', addressEn: 'South Railway Station · Arrival Level', businessHours: '08:00–22:00', contactPhone: '400-000-0003', capabilities: ['pickup', 'return'] },
  { id: 'store-airport', name: '机场配送仓', nameEn: 'Airport Delivery Hub', address: 'T2 航站楼 · 物流配送中心', addressEn: 'Terminal 2 · Logistics Hub', businessHours: '全天配送', contactPhone: '400-000-0004', capabilities: ['delivery', 'storage'] },
];

const sharedTenant = {
  name: 'Rental OS', logo: '/brand/logo-horizontal.png', logoCompact: '/brand/logo-mark.png',
  slogan: '好物相伴，更好生活', primaryColor: PLATFORM_THEME.primaryColor, secondaryColor: PLATFORM_THEME.secondaryColor,
  phone: '400-000-0000', customerService: '在线客服', address: '欢迎联系门店了解取还方式',
  footerText: '好物相伴，更好生活。按需租用，让每一次体验都恰到好处。',
  heroImage: asset('multi-lifestyle-hero'), heroTitle: '需要的时候\n租一件就好',
  heroDescription: '数码、户外、家电、工具、母婴，\n按需租用，用完归还。',
  stores: demoStores,
};

export const demoTenants: Record<DemoTenantKey, Tenant> = {
  single: { ...sharedTenant, id: 'tenant-single', categories: categories.slice(0, 1), heroImage: categories[0].heroImage, heroTitle: categories[0].heroTitle, heroDescription: categories[0].heroDescription, testimonials: [
    { name: '陈女士', context: '周末摄影创作', text: '器材状态很好，取还方便。周末出门拍照再也不用纠结要不要买新镜头。' },
    { name: '赵先生', context: '短片拍摄', text: '需要的机身和镜头都能找到，租期选择也很灵活，拍摄准备轻松不少。' },
    { name: '林女士', context: '旅行记录', text: '第一次租相机也能很快看懂流程，设备拿到手就可以出发拍摄。' },
  ] },
  double: { ...sharedTenant, id: 'tenant-double', categories: categories.slice(0, 2), heroImage: categories[1].heroImage, heroTitle: '带上好装备\n去发现更大的世界', heroDescription: '摄影器材 × 露营装备\n让每一次出发，都更简单', testimonials: [
    { name: '陈女士', context: '周末摄影创作', text: '器材状态很好，取还方便。周末出门拍照再也不用纠结要不要买新镜头。' },
    { name: '王先生', context: '家庭露营出行', text: '第一次带家人露营，装备准备得很齐全，按需租比囤在家里省心多了。' },
    { name: '林先生', context: '户外拍摄', text: '相机和露营装备一次挑齐，出发前准备更从容，周末过得很尽兴。' },
  ] },
  multiple: { ...sharedTenant, id: 'tenant-multiple', categories, testimonials: [
    { name: '陈女士', context: '周末摄影创作', text: '器材状态很好，取还方便。周末出门拍照再也不用纠结要不要买新镜头。' },
    { name: '王先生', context: '家庭露营出行', text: '第一次带家人露营，装备准备得很齐全，按需租比囤在家里省心多了。' },
    { name: '林先生', context: '短期项目使用', text: '临时需要设备时能快速找到合适的选择，预约流程清楚，服务也很及时。' },
  ] },
};

export const products: Product[] = [
  { id: 'camera-a7', name: 'Sony A7M4', subtitle: '全画幅微单相机', cover: asset('product-camera'), categoryId: 'camera', subCategoryId: 'camera-body', tags: ['全画幅', '摄影'], price: 60, priceUnit: '天', deposit: 2000, rating: 4.9, reviewCount: 128, stockStatus: 'available', availableQuantity: 5, badges: ['热门'], description: '适合人像、旅行和商业拍摄的全画幅微单。随租随拍，轻松记录精彩瞬间。', specs: { 类型: '全画幅微单', 配件: '机身、肩带、电池、充电器', 取还: '门店自取或配送' } },
  { id: 'lens-rf', name: 'Canon RF 24–70mm', subtitle: 'F2.8 L 镜头', cover: asset('product-lens'), categoryId: 'camera', subCategoryId: 'lens', tags: ['镜头', '摄影'], price: 80, priceUnit: '天', deposit: 1800, rating: 4.9, reviewCount: 76, stockStatus: 'available', availableQuantity: 3, badges: [], description: '覆盖日常拍摄常用焦段，兼顾便携与画质。', specs: { 焦段: '24–70mm', 光圈: 'F2.8', 配件: '前后盖、遮光罩、镜头包' } },
  { id: 'camera-light', name: '专业影像灯套装', subtitle: '双灯柔光拍摄组合', cover: asset('product-light'), categoryId: 'camera', subCategoryId: 'lighting', tags: ['灯光', '摄影'], price: 50, priceUnit: '天', deposit: 800, rating: 4.8, reviewCount: 45, stockStatus: 'available', availableQuantity: 4, badges: [], description: '为人像与静物拍摄提供柔和稳定的光线。', specs: { 设备: '双灯套装', 配件: '灯架、柔光箱、电源线' } },
  { id: 'camera-stabilizer', name: '手持稳定器', subtitle: '轻量化影像云台', cover: asset('product-stabilizer'), categoryId: 'camera', subCategoryId: 'stabilizer', tags: ['视频', '摄影'], price: 70, priceUnit: '天', deposit: 1000, rating: 4.8, reviewCount: 62, stockStatus: 'low', availableQuantity: 2, badges: [], description: '稳定记录移动画面，让创作更从容。', specs: { 类型: '三轴手持云台', 配件: '收纳盒、充电线' } },
  { id: 'camera-drone', name: '轻量航拍无人机', subtitle: '旅行创作航拍设备', cover: asset('product-drone'), categoryId: 'camera', subCategoryId: 'drone', tags: ['无人机', '摄影'], price: 90, priceUnit: '天', deposit: 1500, rating: 4.9, reviewCount: 57, stockStatus: 'available', availableQuantity: 3, badges: [], description: '从全新视角记录旅行与创作。', specs: { 类型: '轻量航拍无人机', 配件: '遥控器、电池、收纳包' } },
  { id: 'camp-tent', name: 'Naturehike 云境帐篷', subtitle: '四季帐篷 3–4 人', cover: asset('product-tent'), categoryId: 'camping', subCategoryId: 'tent', tags: ['露营', '家庭'], price: 40, priceUnit: '天', deposit: 500, rating: 4.9, reviewCount: 93, stockStatus: 'available', availableQuantity: 7, badges: ['精选'], description: '空间宽敞，搭建方便，适合周末露营与家庭出行。', specs: { 容量: '3–4 人', 配件: '帐篷、地钉、风绳、收纳袋' } },
  { id: 'camp-chair', name: 'Helinox 轻量折叠椅', subtitle: '户外露营椅', cover: asset('product-chair'), categoryId: 'camping', subCategoryId: 'camp-chair', tags: ['露营', '轻量'], price: 20, priceUnit: '天', deposit: 200, rating: 4.8, reviewCount: 81, stockStatus: 'available', availableQuantity: 10, badges: [], description: '易收纳、易携带，随时享受舒适的户外时光。', specs: { 类型: '轻量折叠椅', 配件: '椅面、支架、收纳袋' } },
  { id: 'vehicle-suv', name: '城市出行 SUV', subtitle: '舒适空间 · 灵活自驾', cover: asset('product-car'), categoryId: 'vehicle', subCategoryId: 'car', tags: ['自驾', '用车'], price: 299, priceUnit: '天', deposit: 3000, rating: 4.9, reviewCount: 49, stockStatus: 'available', availableQuantity: 3, badges: [], description: '舒适宽敞，适合城市出行和周末短途旅行。', specs: { 车型: '五座 SUV', 取还: '门店交接' } },
  { id: 'digital-laptop', name: '轻薄笔记本电脑', subtitle: '高性能移动办公', cover: asset('product-laptop'), categoryId: 'digital', subCategoryId: 'computer', tags: ['办公', '数码'], price: 80, priceUnit: '天', deposit: 2500, rating: 4.8, reviewCount: 54, stockStatus: 'available', availableQuantity: 4, badges: [], description: '性能与便携兼备，适合短期办公、出差和展示。', specs: { 类型: '轻薄笔记本', 配件: '电源适配器、电脑包' } },
  { id: 'tool-drill', name: '大有 电锤', subtitle: '专业工程电动工具', cover: asset('product-drill'), categoryId: 'construction', subCategoryId: 'power-tools', tags: ['施工', '工具'], price: 35, priceUnit: '天', deposit: 400, rating: 4.7, reviewCount: 34, stockStatus: 'available', availableQuantity: 6, badges: [], description: '家装和工程作业都能轻松应对。', specs: { 类型: '多功能电锤', 配件: '工具箱、钻头' } },
  { id: 'home-appliance', name: '家用便携设备', subtitle: '灵活租用，轻松生活', cover: asset('product-appliance'), categoryId: 'home', subCategoryId: 'home-appliance', tags: ['家居'], price: 45, priceUnit: '天', deposit: 500, rating: 4.7, reviewCount: 29, stockStatus: 'available', availableQuantity: 3, badges: [], description: '按需租用，享受便捷生活。', specs: { 类型: '家居设备', 取还: '门店自取或配送' } },
  { id: 'baby-stroller', name: '轻便婴儿推车', subtitle: '轻巧易折叠', cover: asset('product-stroller'), categoryId: 'baby', subCategoryId: 'stroller', tags: ['母婴', '出行'], price: 30, priceUnit: '天', deposit: 600, rating: 4.9, reviewCount: 42, stockStatus: 'available', availableQuantity: 5, badges: [], description: '轻巧好推，让亲子出行更省心。', specs: { 类型: '轻便婴儿推车', 配件: '推车、遮阳篷' } },
  { id: 'sport-outdoor', name: '户外运动装备', subtitle: '周末出发好伙伴', cover: asset('product-sports'), categoryId: 'sports', subCategoryId: 'outdoor', tags: ['户外', '运动'], price: 25, priceUnit: '天', deposit: 300, rating: 4.8, reviewCount: 37, stockStatus: 'available', availableQuantity: 8, badges: [], description: '把更多户外体验带到每一个周末。', specs: { 类型: '户外运动装备', 取还: '门店自取或配送' } },
];
