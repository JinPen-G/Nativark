/** 原 Nest 装配入口。宿主延迟解析原 Auth 实例，业务权威由 Rental 包提供。 */
export { RentalFileApplicationParticipant, isRentalStaffFileBinding, type RentalFileWorkspaceAuthority } from "@rental-os/rental-core/file-application-participant";

export const RENTAL_FILE_AUTHORITY = Symbol("RENTAL_FILE_AUTHORITY");
