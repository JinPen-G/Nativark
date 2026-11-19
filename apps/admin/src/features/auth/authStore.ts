/** 原后台使用 Rental 浏览器工厂创建的同一 Zustand 会话。 */
import { rentalBrowserSession } from "@/api/http";

export const useAuthStore = rentalBrowserSession.useAuthStore;
