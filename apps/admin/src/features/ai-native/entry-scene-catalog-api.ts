/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/entry-scene-catalog-api";
import { createEntrySceneCatalogReader } from "@rental-os/rental-core/admin/task-center/entry-scene-catalog-api";
import { rentalBrowserSession } from "@/api/http";
export const readEntrySceneCatalog = createEntrySceneCatalogReader(rentalBrowserSession);
