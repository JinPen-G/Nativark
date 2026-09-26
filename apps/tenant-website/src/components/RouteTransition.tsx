import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, type Location } from 'react-router-dom';

// 全局路由过渡：旧内容轻微淡出下沉(fast) → 切换 + 滚动到顶 → 新内容淡入上移(normal)。
// 壳(Header/Footer)在外层不参与，避免重挂载/白屏。reduced-motion 下瞬切。
const FAST_MS = 150; // 与 --motion-fast 对齐

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function RouteTransition({ children }: { children: (location: Location) => ReactNode }) {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [stage, setStage] = useState<'idle' | 'leaving' | 'entering'>('idle');

  useEffect(() => {
    // 同一页面（仅查询参数变化，如筛选）：直接更新、不做过渡。
    if (location.pathname === displayLocation.pathname) {
      if (location !== displayLocation) setDisplayLocation(location);
      return;
    }
    if (reducedMotion()) {
      setDisplayLocation(location);
      window.scrollTo(0, 0);
      return;
    }
    setStage('leaving');
    const timer = window.setTimeout(() => {
      setDisplayLocation(location);
      window.scrollTo(0, 0);
      setStage('entering');
    }, FAST_MS);
    return () => window.clearTimeout(timer);
  }, [location, displayLocation]);

  useEffect(() => {
    if (stage !== 'entering') return;
    const timer = window.setTimeout(() => setStage('idle'), 340);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const cls = stage === 'leaving' ? 'route-view is-leaving' : stage === 'entering' ? 'route-view is-entering' : 'route-view';
  return <div className={cls}>{children(displayLocation)}</div>;
}
