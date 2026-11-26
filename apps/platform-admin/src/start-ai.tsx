/** Optional SaaS settings entry. The shared session and existing page slot remain authoritative. */
import { createPublicPlatformModelSettingsPage } from "@rental-os/ai-native-admin/platform-model-settings/public-application";
import { createPublicAdminApp } from "./App";
import { mountPublicAdmin } from "./main";
import { session } from "./session";

mountPublicAdmin(createPublicAdminApp(createPublicPlatformModelSettingsPage(session.runtime, { finance: true })));
