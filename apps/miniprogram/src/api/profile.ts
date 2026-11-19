/** 原客户运输供给当前会话与范围，业务请求由 Rental 小程序工厂维护。 */
import { createRentalMiniProgramProfileApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";

export const {
  fetchProfile,
  updateProfile,
  fetchMembershipPlans,
  fetchMembershipAssignments,
  fetchMembershipBenefits,
  fetchQualificationTypes,
  fetchQualifications,
  submitQualification,
  createQualificationUpload,
  completeQualificationUpload,
  qualificationFileUrl,
} = createRentalMiniProgramProfileApi({ request });
