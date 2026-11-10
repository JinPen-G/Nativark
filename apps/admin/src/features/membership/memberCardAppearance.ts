/** Browser-only card artwork preferences, isolated by account, tenant and plan; never part of membership eligibility. */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CustomerMembershipPlan } from "@rental-os/shared";
import { useAuthStore } from "@/features/auth/authStore";

export const MEMBER_CARD_FACES = [
  { id: "pearl", label: "珍珠白" }, { id: "jade", label: "翡翠绿" }, { id: "champagne", label: "香槟金" },
  { id: "aurora", label: "极光紫" }, { id: "obsidian", label: "曜石黑" }, { id: "carbon", label: "碳纤维" },
] as const;
export type MemberCardFace = typeof MEMBER_CARD_FACES[number]["id"];
const useAppearances = create<{ faces: Record<string, MemberCardFace>; choose: (key: string, face: MemberCardFace) => void }>()(
  persist(set => ({ faces: {}, choose: (key, face) => set(state => ({ faces: { ...state.faces, [key]: face } })) }), { name: "rental-member-card-appearance", partialize: state => ({ faces: state.faces }) }),
);
export function memberCardFace(row: CustomerMembershipPlan): MemberCardFace {
  if (row.targetType === "corporate") return "carbon";
  const rank = row.currentVersion?.levelRank ?? 1;
  return rank <= 1 ? "pearl" : rank === 2 ? "jade" : rank === 3 ? "champagne" : rank === 4 ? "aurora" : "obsidian";
}
export function useMemberCardAppearance(row: CustomerMembershipPlan) {
  const account = useAuthStore(state => state.user?.id);
  const key = JSON.stringify([account ?? "anonymous", row.tenantId, row.id]);
  const chosen = useAppearances(state => state.faces[key]);
  const choose = useAppearances(state => state.choose);
  return { face: MEMBER_CARD_FACES.some(item => item.id === chosen) ? chosen : memberCardFace(row), choose: (face: MemberCardFace) => choose(key, face) };
}
export function savedMemberCardFace(row: CustomerMembershipPlan, account?: string): MemberCardFace {
  const chosen = useAppearances.getState().faces[JSON.stringify([account ?? "anonymous", row.tenantId, row.id])];
  return MEMBER_CARD_FACES.some(item => item.id === chosen) ? chosen : memberCardFace(row);
}
export function saveMemberCardFace(row: CustomerMembershipPlan, face: MemberCardFace, account?: string) {
  useAppearances.getState().choose(JSON.stringify([account ?? "anonymous", row.tenantId, row.id]), face);
}
