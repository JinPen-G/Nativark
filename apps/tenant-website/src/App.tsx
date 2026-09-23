import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SiteProvider } from './SiteContext';
import { AuthProvider } from './AuthContext';
import { SiteLayout } from './components/SiteLayout';
import { HomePage } from './pages/HomePage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { BookingPage } from './pages/BookingPage';
import { LoginPage } from './pages/LoginPage';
import { AboutPage, GuidePage, HelpPage, OrderDetailPage, OrdersPage } from './pages/InfoPages';

export function App() {
  return <BrowserRouter><SiteProvider><AuthProvider><SiteLayout><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/products" element={<ProductsPage />} />
    <Route path="/category/:categoryId" element={<ProductsPage />} />
    <Route path="/product/:productId" element={<ProductDetailPage />} />
    <Route path="/booking/:productId" element={<BookingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/orders" element={<OrdersPage />} />
    <Route path="/orders/:orderId" element={<OrderDetailPage />} />
    <Route path="/about" element={<AboutPage />} />
    <Route path="/guide" element={<GuidePage />} />
    <Route path="/help" element={<HelpPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></SiteLayout></AuthProvider></SiteProvider></BrowserRouter>;
}
