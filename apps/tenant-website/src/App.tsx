import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SiteProvider } from './SiteContext';
import { AuthProvider } from './AuthContext';
import { SiteLayout } from './components/SiteLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RouteTransition } from './components/RouteTransition';
import { RouteProgress } from './components/RouteProgress';
import { ToastProvider } from './components/Toast';

// 路由级分包：首屏只加载首页所需代码，其余页面按需加载，减小初始包体。
const HomePageV2 = lazy(() => import('./pages/HomePageV2').then(m => ({ default: m.HomePageV2 })));
const ProductsPage = lazy(() => import('./pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage').then(m => ({ default: m.ProductDetailPage })));
const BookingPage = lazy(() => import('./pages/BookingPage').then(m => ({ default: m.BookingPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })));
const DocumentPage = lazy(() => import('./pages/DocumentPage').then(m => ({ default: m.DocumentPage })));
const OrdersPage = lazy(() => import('./pages/OrderPages').then(m => ({ default: m.OrdersPage })));
const OrderDetailPage = lazy(() => import('./pages/OrderPages').then(m => ({ default: m.OrderDetailPage })));
const AboutPage = lazy(() => import('./pages/InfoPages').then(m => ({ default: m.AboutPage })));
const GuidePage = lazy(() => import('./pages/InfoPages').then(m => ({ default: m.GuidePage })));

function RouteFallback() {
  // 轻骨架代替「正在加载…」大字：chunk 加载时不打断连续感（配合顶部进度条）。
  return <div className="shell route-fallback" role="status" aria-label="加载中">
    <div className="sk-page" aria-hidden="true">
      <div className="sk-line sk-line-lg" />
      <div className="sk-line sk-line-md" />
      <div className="sk-block" />
    </div>
  </div>;
}

export function App() {
  return <BrowserRouter><SiteProvider><AuthProvider><ToastProvider>
    <RouteProgress />
    <SiteLayout>
      <ErrorBoundary>
        <RouteTransition>
          {location => <Suspense fallback={<RouteFallback />}>
            <Routes location={location}>
              <Route path="/" element={<HomePageV2 />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/category/:categoryId" element={<ProductsPage />} />
              <Route path="/product/:productId" element={<ProductDetailPage />} />
              <Route path="/booking/:productId" element={<BookingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:orderId" element={<OrderDetailPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/guide" element={<GuidePage />} />
              <Route path="/help" element={<DocumentPage kind="help" />} />
              <Route path="/agreement" element={<DocumentPage kind="user_agreement" />} />
              <Route path="/privacy" element={<DocumentPage kind="privacy_policy" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>}
        </RouteTransition>
      </ErrorBoundary>
    </SiteLayout>
  </ToastProvider></AuthProvider></SiteProvider></BrowserRouter>;
}
