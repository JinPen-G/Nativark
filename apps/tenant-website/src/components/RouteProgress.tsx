import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

// 顶部细进度条：路由切换时给「正在跳转/加载」的即时反馈。非遮罩、跟随主题色。
// 非 data-router，故按 location 变化驱动一段 起→快到 90%→完成淡出 的节奏（感知反馈）。
export function RouteProgress() {
  const location = useLocation();
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const first = useRef(true);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (first.current) { first.current = false; return; } // 首屏不闪进度条
    timers.current.forEach(id => window.clearTimeout(id));
    setActive(true);
    setProgress(8);
    const t1 = window.setTimeout(() => setProgress(90), 60);
    const t2 = window.setTimeout(() => setProgress(100), 240);
    const t3 = window.setTimeout(() => setActive(false), 500);
    const t4 = window.setTimeout(() => setProgress(0), 720);
    timers.current = [t1, t2, t3, t4];
    return () => { timers.current.forEach(id => window.clearTimeout(id)); };
  }, [location.pathname]);

  return <div className={`route-progress${active ? ' is-active' : ''}`} style={{ width: `${progress}%` }} aria-hidden="true" />;
}
