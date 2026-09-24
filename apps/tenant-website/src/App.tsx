import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SiteProvider } from './SiteContext';
import { AuthProvider } from './AuthContext';
import { SiteLayout } from './components/SiteLayout';
import { ErrorBoundary } from './components/ErrorBoundary';

// 路由级分包：首屏只加载首页所需代码，其余页面按需加载，减小初始包体。
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
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
  return <div className="shell route-fallback" role="status">正在加载…</div>;
}

export function App() {
  return <BrowserRouter><SiteProvider><AuthProvider><SiteLayout>
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
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
      </Suspense>
    </ErrorBoundary>
  </SiteLayout></AuthProvider></SiteProvider></BrowserRouter>;
}
