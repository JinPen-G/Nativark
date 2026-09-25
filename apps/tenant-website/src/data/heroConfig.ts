// 首页 2.0「预约型沉浸式 Hero」的集中配置。
// 目标：品类↔视频联动、单/多品类自适应、缺视频不破布局。
// 为未来「租户后台装修」预留配置缝——媒体与文案都可后续接配置 API，组件不写死。

import type { Category } from '../types';

/** 2.0 为默认首页；?home=1 回退 1.0。 */
export const DEFAULT_HOME_VERSION = 2;

/** Hero 视频交叉淡入时长（ms）。 */
export const HERO_CROSSFADE_MS = 900;
/** 空闲时背景视频自动轮播间隔（ms）；用户主动选品类后停止。 */
export const HERO_AUTOPLAY_MS = 7000;

/** 每品类视觉媒体覆盖。未列出的品类走默认路径约定 + 品类底图兜底，新增品类无需改这里。 */
interface HeroMediaOverride {
  video?: string;
  poster?: string;
  /** 桌面端视频/底图主体裁切位（object-position）。 */
  objectPosition?: string;
  /** 移动端裁切位；缺省沿用桌面。避免主体（车/人/设备）在竖屏被裁没。 */
  objectPositionMobile?: string;
}

const MEDIA: Record<string, HeroMediaOverride> = {
  vehicle: { objectPosition: 'center 55%', objectPositionMobile: '62% center' },
  camera: { objectPosition: 'center center' },
  camping: { objectPosition: 'center 58%', objectPositionMobile: '55% center' },
  digital: { objectPosition: 'center center' },
  construction: { objectPosition: 'center center' },
  home: { objectPosition: 'center center' },
  baby: { objectPosition: 'center center' },
  sports: { objectPosition: 'center 45%' },
};

export interface HeroMedia {
  videoSrc: string;
  posterSrc: string;
  /** 视频/封面加载失败时的底图（品类现有 webp），保证不黑屏、不破布局。 */
  fallbackImage: string;
  objectPosition: string;
  objectPositionMobile: string;
}

/** 解析某品类的 Hero 媒体：显式覆盖 > 约定路径；底图兜底用品类现有图。 */
export function resolveHeroMedia(category: Category): HeroMedia {
  const override = MEDIA[category.id] ?? {};
  const objectPosition = override.objectPosition ?? 'center center';
  return {
    videoSrc: override.video ?? `/assets/video/${category.id}.mp4`,
    posterSrc: override.poster ?? `/assets/poster/${category.id}.webp`,
    fallbackImage: category.heroImage || category.image,
    objectPosition,
    objectPositionMobile: override.objectPositionMobile ?? objectPosition,
  };
}
