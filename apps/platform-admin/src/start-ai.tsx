/** Optional platform and tenant AI settings on the same verified browser session. */
import { createPublicPlatformModelSettingsPage } from "@rental-os/ai-native-admin/platform-model-settings/public-application";
import { createPublicTenantModelSettingsPage } from "@rental-os/ai-native-admin/tenant-model-settings/public-application";
import { createPublicAdminApp } from "./App";
import { mountPublicAdmin } from "./main";
import { session } from "./session";

mountPublicAdmin(createPublicAdminApp(createPublicPlatformModelSettingsPage(session.runtime, { finance: true }),
  createPublicTenantModelSettingsPage(session.runtime)));
