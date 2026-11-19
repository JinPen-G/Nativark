/** 原列表能力转接各业务 Core，当前权限和服务端载荷沿原调用链。 */
import { RentalInventoryMode, type RentalAttributeDefinition } from "@rental-os/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import {
  locationCapabilities as createLocationCapabilities,
  operatorCapabilities as createOperatorCapabilities,
} from "@rental-os/rental-core/admin/locations/list-capabilities";
import { catalogCapabilities as createCatalogCapabilities } from "@rental-os/rental-core/admin/catalog/list-capabilities";
import {
  personalImport as createPersonalImport,
  corporateImport as createCorporateImport,
  planBatchActions as createPlanBatchActions,
} from "@rental-os/rental-core/admin/membership/list-capabilities";
import { membershipApi } from "@/api/membership";
import { useAuthStore } from "@/features/auth/authStore";

type Translator = (key: string) => string;
type Complete = () => Promise<unknown>;
const permitted = (permission: string) => () => useAuthStore.getState().hasPermission(permission);
const membershipDependencies = { api: membershipApi, getSession: useAuthStore.getState };
export function personalImport(t: Translator, onComplete: Complete, supported: boolean) {
  return createPersonalImport(t, onComplete, supported, membershipDependencies);
}
export function corporateImport(t: Translator, onComplete: Complete) {
  return createCorporateImport(t, onComplete, membershipDependencies);
}
export function catalogCapabilities(
  t: Translator,
  fields: RentalAttributeDefinition[],
  onComplete: Complete,
  modes: RentalInventoryMode[],
  fixedMode?: RentalInventoryMode,
  fixedUnit?: string,
) {
  return createCatalogCapabilities(
    t,
    fields,
    onComplete,
    { api: rentalCoreApi, allowed: permitted("rental-core:catalog:manage") },
    modes,
    fixedMode,
    fixedUnit,
  );
}

export function operatorCapabilities(t: Translator, onComplete: Complete) {
  return createOperatorCapabilities(t, onComplete, {
    api: rentalCoreApi,
    allowed: permitted("rental-os:station:manage"),
  });
}

export function locationCapabilities(t: Translator, locationTypes: string[], onComplete: Complete) {
  return createLocationCapabilities(t, locationTypes, onComplete, {
    api: rentalCoreApi,
    allowed: permitted("rental-os:station:manage"),
  });
}
export function planBatchActions(onComplete: Complete) {
  return createPlanBatchActions(onComplete, membershipDependencies);
}
