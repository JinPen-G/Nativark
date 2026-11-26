/** Explicit zero-Core AI settings host. The default API never loads the optional SDKs. */
import "reflect-metadata";
import { PublicPlatformModelSettingsModule, createPlatformModelSettingsOpenApi,
  withPublicPlatformModelSettingsHttpAccess } from "@rental-os/ai-native-server/public-platform-model-settings";
import { PublicPlatformFinanceModule, createPlatformFinanceOpenApi,
  withPublicPlatformFinanceHttpAccess } from "@rental-os/ai-native-server/public-platform-finance";
import { PublicTenantModelSettingsModule, createPublicTenantModelSettingsOpenApi,
  withPublicTenantModelSettingsHttpAccess } from "@rental-os/ai-native-server/public-tenant-model-settings";
import { createSelectedPlatformAppModule } from "./app.module";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";
import { bootstrapPlatform } from "./main";
import { selectPublicAiData } from "./ai-data";

export async function selectPublicAiPlatform(config: { lockFile: string; dataDirectory: string; profileId: string }) {
  const { lockFile, dataDirectory, profileId } = config;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(profileId)) throw new Error("须指定平台模型 Profile ID");
  const assertDataAvailable = await selectPublicAiData(lockFile, dataDirectory);
  return createSelectedPlatformAppModule({
    extendHttp: access => withPublicTenantModelSettingsHttpAccess(withPublicPlatformFinanceHttpAccess(withPublicPlatformModelSettingsHttpAccess(access))),
    extendOpenApi: document => createPublicTenantModelSettingsOpenApi(createPlatformFinanceOpenApi(createPlatformModelSettingsOpenApi(document))),
    modules: platformServer => {
      const host = { imports: [platformServer, PlatformDatabaseModule], inject: [PlatformDatabaseClient],
        useFactory: (db: PlatformDatabaseClient) => ({ db, assertDataAvailable, profileId }) };
      return [PublicPlatformModelSettingsModule.register(host), PublicPlatformFinanceModule.register(host), PublicTenantModelSettingsModule.register(host)];
    }
  });
}

if (require.main === module) void bootstrapPlatform(() => selectPublicAiPlatform({
  lockFile: process.env.CORE_DEPLOYMENT_LOCK_FILE ?? "",
  dataDirectory: process.env.PLATFORM_AI_DATA_PACKAGE_DIR ?? "",
  profileId: process.env.PLATFORM_AI_PROFILE_ID ?? ""
}));
