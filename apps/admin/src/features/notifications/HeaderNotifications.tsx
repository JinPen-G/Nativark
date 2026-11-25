/** 原业务待办和演示详情由 Rental 宿主提供，公共铃铛不读取行业接口。 */
import { HeaderNotifications as SharedHeaderNotifications } from "@rental-os/platform-admin/source/features/notifications/HeaderNotifications";
import { useNotifications } from "./NotificationProvider";
import { NoticeActions } from "./NoticeActions";
export { formatNoticeTime } from "@rental-os/platform-admin/source/features/notifications/HeaderNotifications";
export function HeaderNotifications() {
  return <SharedHeaderNotifications inbox={useNotifications()} renderDetails={id => <NoticeActions id={id} />} />;
}
