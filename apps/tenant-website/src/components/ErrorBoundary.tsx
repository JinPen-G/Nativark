import { Component, type ReactNode } from 'react';

interface State { error: Error | null; }

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
      return (
        <div className="shell error-fallback" role="alert">
          <h1>页面出错了</h1>
          <p>抱歉，这个页面暂时无法显示。请刷新重试，或返回首页。</p>
          <div className="error-fallback-actions">
            <button type="button" className="button button-dark" onClick={() => window.location.reload()}>刷新页面</button>
            <a className="button button-outline" href="/">返回首页</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
