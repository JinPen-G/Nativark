import { Injectable, NotFoundException, type CanActivate } from "@nestjs/common";

/** Incomplete governance/adoption preparation remains an explicit non-production preview. */
@Injectable()
export class CategoryGovernancePreviewGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.NODE_ENV === "production" || process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW !== "true") {
      throw new NotFoundException("品类治理预览尚未开放");
    }
    // Existing global identity/permission guards still apply; this is not authorization.
    return true;
  }
}
