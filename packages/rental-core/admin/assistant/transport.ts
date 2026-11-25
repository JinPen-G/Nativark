/** 原 Rental 会话运输与 AI 展示端口，均由同一显式宿主提供。 */
import type { RentalBrowserAdminSession } from "../browser";
import type { AiAdminHost } from "@rental-os/ai-native-admin/host";
export interface RentalAssistantTransport { session: RentalBrowserAdminSession; aiHost: AiAdminHost }
