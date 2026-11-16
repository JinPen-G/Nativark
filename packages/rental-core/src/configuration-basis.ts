/** Rental配置读写的共同版本依据，绑定修订不代替授权或业务配置行修订。 */
export interface CategoryWriteBinding { categoryVersionId: string; adoptionRevision: number }

export const RENTAL_READINESS_FACT_LIMIT = 10000;
