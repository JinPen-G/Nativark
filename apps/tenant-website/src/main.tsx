/** Rental 客户网站的 React 挂载入口。App 薄宿主提供同一客户会话与公开配置，
 * 页面来自 Rental 网站贡献，客户端请求由该宿主的正式接口与权限范围承接。 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
