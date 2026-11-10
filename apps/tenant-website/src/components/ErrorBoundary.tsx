import { Component, type ReactNode } from 'react';
import { useSite } from '../SiteContext';
import { PageState } from './PageState';

interface State { error: Error | null; }

function ErrorFallback() {
  const { href, language, t } = useSite();
  return <div className="shell not-found-page"><PageState heading="h1" error title={language === 'en' ? 'This page could not be displayed' : '页面暂时无法显示'} description={language === 'en' ? 'Refresh to try again, or return to the home page.' : '请刷新页面重试，或返回首页继续浏览。'}><button type="button" className="button button-dark" onClick={() => window.location.reload()}>{language === 'en' ? 'Refresh page' : '刷新页面'}</button><a className="button button-outline" href={href('/')}>{t('backHome')}</a></PageState></div>;
}

/** 兜底错误边界：任一页面渲染抛错时展示可恢复的提示，而不是整站白屏。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // 交给浏览器控制台，便于排查；不上报第三方。
    console.error('[tenant-website] render error:', error);
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
