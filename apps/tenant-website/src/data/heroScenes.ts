// 官网 2.0 沉浸式首页的场景配置（集中管理，增删视频只改这里，不动组件）。
// 视频/poster 用户后续自备，放入 public/assets/video 与 public/assets/poster；
// 现在文件不存在时由 posterFallback（现有 webp）→ 深色底 兜底，不破布局。

/** 首页默认版本：2 = 沉浸式视频首页；1 = 旧 SaaS 首页。`?home=1|2` 可临时覆盖。 */
export const DEFAULT_HOME_VERSION = 2;

export interface HeroScene {
  id: string;
  /** 'hero' = 首屏大标题场景；'scene' = 后续编号场景。 */
  kind: 'hero' | 'scene';
  video: string;
  poster: string;
  /** 视频与 poster 都缺失时的兜底底图（用现有 webp，保证现在就有画面）。 */
  posterFallback: string;
  /** 场景编号/眼眉，如 "01 / VEHICLE" 或 hero 留空。 */
  eyebrow?: string;
  /** 英文主视觉，逐行渲染；空串 "" 表示一处留白间隔。 */
  titleLines: string[];
  /** 副标题（中文或英文小字），字号明显小于主视觉。 */
  subtitle?: string;
  /** 文本式 CTA；to 以 '#next' 表示滚动到下一屏，否则作为站内路由。 */
  cta?: { label: string; to: string };
  /** 桌面/移动端视频裁切位，防主体被切。 */
  objectPosition?: string;
  objectPositionMobile?: string;
}

export const heroScenes: HeroScene[] = [
  {
    id: 'hero',
    kind: 'hero',
    video: '/assets/video/hero-01.mp4',
    poster: '/assets/poster/hero-01.webp',
    posterFallback: '/assets/multi-lifestyle-hero.webp',
    titleLines: ['RENT', 'ANYTHING.', '', 'MANAGE', 'EVERYTHING.'],
    subtitle: '面向多品类租赁业务的新一代管理平台',
    cta: { label: 'Explore', to: '#next' },
    objectPosition: 'center center',
    objectPositionMobile: 'center center',
  },
  {
    id: 'vehicle',
    kind: 'scene',
    video: '/assets/video/hero-02.mp4',
    poster: '/assets/poster/hero-02.webp',
    posterFallback: '/assets/scene-vehicle.webp',
    eyebrow: '01 / VEHICLE',
    titleLines: ['VEHICLE'],
    subtitle: '车辆租赁',
    cta: { label: 'View', to: '/products' },
    objectPosition: 'center center',
    objectPositionMobile: 'center center',
  },
  {
    id: 'equipment',
    kind: 'scene',
    video: '/assets/video/hero-03.mp4',
    poster: '/assets/poster/hero-03.webp',
    posterFallback: '/assets/scene-camera.webp',
    eyebrow: '02 / EQUIPMENT',
    titleLines: ['EQUIPMENT'],
    subtitle: '设备 · 摄影器材 · 工具租赁',
    cta: { label: 'View', to: '/products' },
    objectPosition: 'center center',
    objectPositionMobile: 'center center',
  },
  {
    id: 'mobility',
    kind: 'scene',
    video: '/assets/video/hero-04.mp4',
    poster: '/assets/poster/hero-04.webp',
    posterFallback: '/assets/cta-mountains.webp',
    eyebrow: '03 / MOBILITY',
    titleLines: ['MOBILITY'],
    subtitle: '两轮出行 · 自行车 · 电动车',
    cta: { label: 'View', to: '/products' },
    objectPosition: 'center center',
    objectPositionMobile: 'center center',
  },
  {
    id: 'anything',
    kind: 'scene',
    video: '/assets/video/hero-05.mp4',
    poster: '/assets/poster/hero-05.webp',
    posterFallback: '/assets/double-camping-hero.webp',
    eyebrow: '04 / ANYTHING',
    titleLines: ['ANYTHING'],
    subtitle: 'One OS. Every Rental Business.',
    cta: { label: 'Explore products', to: '/products' },
    objectPosition: 'center center',
    objectPositionMobile: 'center center',
  },
];
