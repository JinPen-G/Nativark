import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../../SiteContext';
import type { HeroScene } from '../../data/heroScenes';

// 通用整屏视频场景：Hero 与后续编号场景共用同一组件（variant 由 scene.kind 决定）。
// 播放策略：IntersectionObserver 进入视口才 play()、离开 pause()，任一时刻基本只有当前屏在放。
// 兜底：视频缺失/加载失败 → 隐藏 <video> 露出 posterFallback 底图 → 再退到深色底，绝不破布局。
export function VideoScene({ scene }: { scene: HeroScene }) {
  const { href } = useSite();
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const video = videoRef.current;
          if (entry.isIntersecting) {
            section.classList.add('is-inview');
            video?.play().catch(() => {}); // 自动播放被浏览器拒绝时保留 poster/首帧静态，不抛错
          } else {
            video?.pause();
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(section);
    return () => io.disconnect();
  }, []);

  function scrollToNext() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sectionRef.current?.nextElementSibling?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  const style = {
    '--scene-fallback': `url("${scene.posterFallback}")`,
    '--scene-pos': scene.objectPosition ?? 'center center',
    '--scene-pos-mobile': scene.objectPositionMobile ?? scene.objectPosition ?? 'center center',
  } as CSSProperties;

  return (
    <section
      ref={sectionRef}
      className={`v2-scene v2-scene-${scene.kind}${ready ? ' v2-scene-ready' : ''}`}
      style={style}
      aria-label={scene.eyebrow || scene.titleLines.filter(Boolean).join(' ')}
    >
      <video
        ref={videoRef}
        className="v2-scene-video"
        src={scene.video}
        poster={scene.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setReady(true)}
      />
      <div className="v2-scene-scrim" aria-hidden="true" />
      <div className="v2-scene-content">
        {scene.eyebrow && <p className="v2-scene-eyebrow">{scene.eyebrow}</p>}
        <h2 className="v2-scene-title">
          {scene.titleLines.map((line, i) =>
            line === ''
              ? <span key={i} className="v2-title-gap" aria-hidden="true" />
              : <span key={i} className="v2-title-line">{line}</span>,
          )}
        </h2>
        {scene.subtitle && <p className="v2-scene-subtitle">{scene.subtitle}</p>}
        {scene.cta && (scene.cta.to === '#next'
          ? <button type="button" className="v2-scene-cta" onClick={scrollToNext}>{scene.cta.label} <span aria-hidden="true">↓</span></button>
          : <Link className="v2-scene-cta" to={href(scene.cta.to)}>{scene.cta.label} <span aria-hidden="true">→</span></Link>
        )}
      </div>
    </section>
  );
}
