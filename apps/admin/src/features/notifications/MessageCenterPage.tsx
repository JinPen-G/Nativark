/** 原消息中心绑定唯一通知状态；页面正文由 Rental 提供。 */
import { createRentalMessageCenterPage } from "@rental-os/rental-core/admin/browser-notifications/source/MessageCenterPage";
import { rentalBrowserSession } from "@/api/http";
import { useNotifications, NotificationNoticeActions } from "./NotificationProvider";
export default createRentalMessageCenterPage({ session: rentalBrowserSession }, useNotifications, NotificationNoticeActions);
