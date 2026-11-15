/** Rental 品类目录和当前绑定的只读存储端口，调用方事务可提供同一组读取方法。 */
export interface RentalCategoryVersionBody {
  categoryCode: string;
  structureVersion: number;
  status: string;
  definition: unknown;
}

type StoredCategoryJson = string | number | boolean | null | Record<string, unknown> | unknown[];

interface PublishedCategoryWhere {
  versions: { some: { status: { in: string[] } } };
  code?: { in: string[] };
  OR?: Array<
    { openingScope: string; openingTenantIds?: { array_contains: string } } |
    { workspaces: { some: { tenantId: string } } }
  >;
}

/** 现有会员和订阅配置读取品类身份，采用资格由原业务提交点另行核验。 */
export interface RentalCategoryIdentityReader {
  rentalCategoryDefinition: {
    findMany(input: {
      where: PublishedCategoryWhere;
      select: { code: true; name: true; recommendedVersion: { select: { status: true; definition: true } } };
      orderBy: { code: "asc" };
    }): PromiseLike<Array<{
      code: string;
      name: string;
      recommendedVersion: { status: string; definition: StoredCategoryJson } | null;
    }>>;
    count(input: { where: PublishedCategoryWhere }): PromiseLike<number>;
  };
}

/** 封闭对象类型让原存储适配的条件类型保留 include 关系投影。 */
type OpeningCategoryQuery = {
  where: {
    status: { in: string[] };
    category: { is: { OR: Array<{ openingScope: string; openingTenantIds?: { array_contains: string } }> } };
    policy: { is: { OR: Array<{ createScope: string; createTenantIds?: { array_contains: string } }> } };
    OR?: Array<
      { categoryCode: { contains: string } } |
      { versionLabel: { contains: string } } |
      { definition: { path: string; string_contains: string } }
    >;
  };
  include: { category: { select: { recommendedVersionId: true } } };
  orderBy: Array<{ categoryCode: "asc" } | { publishedAt: "desc" } | { id: "asc" }>;
  take: number;
};

/** 目录表归 Rental，租户接点只核目标ID存在，当前操作者授权由原入口提供。 */
export interface RentalCategoryStore {
  rentalCategoryDefinition: {
    findFirst(input: { where: { code: string } }): PromiseLike<{ recommendedVersionId: string | null } | null>;
  };
  rentalCategoryVersion: {
    findUnique(input: { where: { id: string } }): PromiseLike<RentalCategoryVersionBody | null>;
    findMany(input: OpeningCategoryQuery): PromiseLike<Array<RentalCategoryVersionBody & {
      id: string;
      versionLabel: string;
      category: { recommendedVersionId: string | null };
    }>>;
  };
  businessWorkspace: {
    findFirst(input: {
      where: { tenantId: string; id: string; status: "ACTIVE" };
      select: { categoryCode: true; categoryVersionId: true; categoryAdoptionRevision: true };
    }): PromiseLike<{
      categoryCode: string;
      categoryVersionId: string | null;
      categoryAdoptionRevision: number;
    } | null>;
  };
  tenant: {
    findUnique(input: { where: { id: string }; select: { id: true } }): PromiseLike<{ id: string } | null>;
  };
}

export interface RentalCategoryVersionReader {
  rentalCategoryVersion: Pick<RentalCategoryStore["rentalCategoryVersion"], "findUnique">;
}

export interface RentalCategoryCreationReader extends RentalCategoryVersionReader {
  rentalCategoryDefinition: RentalCategoryStore["rentalCategoryDefinition"];
}

export interface RentalCategoryBindingReader extends RentalCategoryVersionReader {
  businessWorkspace: RentalCategoryStore["businessWorkspace"];
}
