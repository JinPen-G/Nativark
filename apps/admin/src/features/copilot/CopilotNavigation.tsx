import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLocale } from '@/app/locale';
import { isMotionReduced } from '@/app/motionPreferences';
import { navigationTarget } from './destinations';

/** Wait for the actual authorized view, then reveal its registered anchor once.
 * No arbitrary selectors, hidden tabs, editor opening or mutation dispatch. */
export function CopilotNavigation() {
  const location = useLocation(), { t } = useLocale();
  const [status, setStatus] = useState('');
  useEffect(() => {
    const target = navigationTarget(location.state, location.pathname);
    if (!target) { setStatus(''); return; }
    const started = Date.now(); let timer: ReturnType<typeof setTimeout>, cleanup: ReturnType<typeof setTimeout>;
    let restore: (() => void) | undefined;
    const reveal = (node: HTMLElement, fallback: boolean) => {
      node.classList.add('copilot-located');
      node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: isMotionReduced() ? 'instant' : 'smooth' });
      const tabIndex = node.getAttribute('tabindex'); node.tabIndex = -1; node.focus({ preventScroll: true });
      setStatus(fallback ? t('已打开所属分区，具体设置当前未显示。') : `${t('已定位')}：${t(target.label)}`);
      restore = () => { node.classList.remove('copilot-located'); if (tabIndex === null) node.removeAttribute('tabindex'); else node.setAttribute('tabindex', tabIndex); };
      cleanup = setTimeout(() => { restore?.(); setStatus(''); }, 2400);
    };
    const find = () => {
      const node = document.querySelector<HTMLElement>(`[data-copilot-anchor="${target.anchor}"]`);
      if (node?.getClientRects().length && !node.closest('[inert],[aria-hidden="true"]')) { reveal(node, false); return; }
      if (Date.now() - started > 5000) {
        const fallback = target.fallback ? document.querySelector<HTMLElement>(`[data-copilot-anchor="${target.fallback}"]`) : null;
        if (fallback?.getClientRects().length) reveal(fallback, true);
        else setStatus(t('目标分区当前不可用，请检查页面状态或权限。'));
        return;
      }
      timer = setTimeout(find, 120);
    };
    // Let the side-panel and view transition settle before measuring scroll geometry.
    timer = setTimeout(find, isMotionReduced() ? 0 : 500);
    return () => { clearTimeout(timer); clearTimeout(cleanup); restore?.(); };
  }, [location.key, location.pathname, location.state, t]);
  return status ? <div className="copilot-location-status" role="status">{status}</div> : null;
}
