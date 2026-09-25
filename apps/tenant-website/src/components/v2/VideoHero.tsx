import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSite } from '../../SiteContext';
import { resolveHeroMedia, HERO_AUTOPLAY_MS } from '../../data/heroConfig';
import { CategorySelector } from './CategorySelector';
import { RentalSearch } from './RentalSearch';
import type { Category } from '../../types';

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 单个视频层：自带底图兜底（视频缺失/未加载时露出品类图，不黑屏）；play 时播放、否则暂停。
function HeroVideoLayer({ category, isFront, play }: { category: Category; isFront: boolean; play: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const media = resolveHeroMedia(category);
  useEffect(() => { setReady(false); }, [media.videoSrc]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (play) video.play().catch(() => {}); else video.pause();
  }, [play, media.videoSrc]);
  const style = {
    backgroundImage: `url("${media.fallbackImage}")`,
    '--hero-pos': media.objectPosition,
    '--hero-pos-mobile': media.objectPositionMobile,
  } as CSSProperties;
  return (
    <div className={`v2-hero-layer${isFront ? ' is-front' : ''}${ready ? ' is-ready' : ''}`} style={style} aria-hidden="true">
      <video key={media.videoSrc} ref={videoRef} className="v2-hero-video" src={media.videoSrc} poster={media.posterSrc}
        muted loop playsInline preload="metadata" onLoadedData={() => setReady(true)} />
    </div>
  );
}

export function VideoHero() {
  const { tenant, t } = useSite();
  const categories = tenant.categories;
  const stores = tenant.stores ?? [];
  const single = categories.length <= 1;
  const rootRef = useRef<HTMLElement>(null);

  const first = categories[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState(first);
  const [catA, setCatA] = useState(first);
  const [catB, setCatB] = useState(first);
  const [front, setFront] = useState<'a' | 'b'>('a');
  const frontRef = useRef<'a' | 'b'>('a');
  const selectedIdRef = useRef(first);
  const [inView, setInView] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // 品类数据异步到位（真实模式）后，若当前选中不在列表则重置到首个。
  useEffect(() => {
    if (categories.length && !categories.some(category => category.id === selectedId)) {
      setSelectedId(first); setCatA(first); setCatB(first);
      frontRef.current = 'a'; setFront('a');
    }
  }, [categories, selectedId, first]);

  // 切换品类：把新品类装进背面层再翻面，两层 opacity 互切形成交叉淡入（非换 src）。
  const transitionTo = useCallback((id: string) => {
    if (!id || id === selectedIdRef.current) return;
    if (frontRef.current === 'a') { setCatB(id); frontRef.current = 'b'; setFront('b'); }
    else { setCatA(id); frontRef.current = 'a'; setFront('a'); }
    selectedIdRef.current = id;
    setSelectedId(id);
  }, []);

  const selectCategory = useCallback((id: string) => { setUserInteracted(true); transitionTo(id); }, [transitionTo]);

  // 空闲自动轮播（6–8s）；用户点选后停止；单品类或 reduced-motion 不轮播。
  useEffect(() => {
    if (single || userInteracted || reducedMotion()) return;
    const timer = setInterval(() => {
      const ids = categories.map(category => category.id);
      const index = ids.indexOf(selectedIdRef.current);
      transitionTo(ids[(index + 1) % ids.length]);
    }, HERO_AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [single, userInteracted, categories, transitionTo]);

  // Hero 离屏暂停视频（性能：不在视口时不空耗解码）。
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.12 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function scrollNext() {
    rootRef.current?.nextElementSibling?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  const activeCategory = categories.find(category => category.id === selectedId) ?? categories[0];
  const categoryA = categories.find(category => category.id === catA) ?? categories[0];
  const categoryB = categories.find(category => category.id === catB) ?? categories[0];
  const heroTitle = single && activeCategory ? activeCategory.heroTitle : t('heroPrompt');
  const heroSubtitle = single && activeCategory ? activeCategory.heroDescription : t('heroPromptSub');

  return (
    <section ref={rootRef} className="v2-hero" aria-label={activeCategory?.name}>
      {categoryA && <HeroVideoLayer category={categoryA} isFront={front === 'a'} play={front === 'a' && inView} />}
      {categoryB && <HeroVideoLayer category={categoryB} isFront={front === 'b'} play={front === 'b' && inView} />}
      <div className="v2-hero-scrim" aria-hidden="true" />
      <div className="v2-hero-inner">
        <div className="v2-hero-copy">
          <h1 className="v2-hero-title">{heroTitle}</h1>
          {heroSubtitle && <p className="v2-hero-sub">{heroSubtitle}</p>}
        </div>
        <CategorySelector categories={categories} activeId={selectedId} onSelect={selectCategory} />
        <RentalSearch category={activeCategory} stores={stores} />
      </div>
      <button type="button" className="v2-hero-scroll" onClick={scrollNext} aria-label={t('heroExplore')}>
        <span>{t('heroExplore')}</span>
      </button>
    </section>
  );
}
