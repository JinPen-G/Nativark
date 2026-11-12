import { identityRows } from "../identity-rows";
import { boundedText } from "../display-format";
const detachedViews = new WeakSet<object>();
function inspectionValue(value: unknown): string {
  if (value === null || value === undefined) return "缺失";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? String(value) : "非法值";
  if (typeof value === "bigint") { const exact = value.toString(); return exact.length <= 4000 ? exact : "非法值"; }
  if (typeof value === "string") return boundedText(value);
  return "非法值";
}
Component({
  properties: { items: { type: Array, value: [] }, missing: { type: Array, value: [] }, readonly: { type: Boolean, value: true },
    candidateActions: { type: Boolean, value: false }, revision: { type: Number, value: 0 } },
  data: { visibleItems: [] as { key: string; label: string; candidate: string; humanValue: string; sourceLabel: string;
    sourceLabels: string[]; differenceLabel: string; reviewMessages: string[];
    candidateId: string; candidateActionable: boolean; candidateCanAccept: boolean; decisionLabel: string; error: string }[], visibleMissing: [] as string[] },
  lifetimes: { attached() { detachedViews.delete(this); this.project(); }, detached() { detachedViews.add(this); } },
  observers: { "items,missing"() { this.project(); } },
  methods: {
    project() {
      if (detachedViews.has(this)) return;
      const items = identityRows(this.data.items, ["key"], 64).map(item => ({
        key: item.key as string, label: typeof item.label === "string" ? boundedText(item.label, 200) : "检查项不可用",
        candidate: inspectionValue(item.candidate), humanValue: inspectionValue(item.humanValue),
        sourceLabel: typeof item.sourceLabel === "string" ? boundedText(item.sourceLabel, 200) : "来源不可用",
        sourceLabels: Array.isArray(item.sourceLabels) ? item.sourceLabels.slice(0, 100)
          .filter((value): value is string => typeof value === 'string').map(value => boundedText(value, 512)) : [],
        differenceLabel: typeof item.differenceLabel === 'string' ? boundedText(item.differenceLabel, 200) : '',
        reviewMessages: Array.isArray(item.reviewMessages) ? item.reviewMessages.slice(0, 100)
          .filter((value): value is string => typeof value === 'string').map(value => boundedText(value, 768)) : [],
        error: typeof item.error === "string" ? boundedText(item.error, 200) : "",
        candidateId: typeof item.candidateId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(item.candidateId) ? item.candidateId : "",
        candidateActionable: item.candidateActionable === true,
        candidateCanAccept: item.candidateCanAccept === true,
        decisionLabel: item.decision === "accepted" ? "人工采用" : item.decision === "rejected" ? "人工拒绝" : item.decision === "modified" ? "人工更正" : item.decision === "manual" ? "人工填入" : "尚待核实",
      }));
      const missing: unknown[] = Array.isArray(this.data.missing) ? this.data.missing : [];
      this.setData({ visibleItems: items, visibleMissing: missing.slice(0, 50).filter((item): item is string => typeof item === "string").map(item => boundedText(item, 200)) });
    },
    onHumanInput(event: WechatMiniprogram.CustomEvent) {
      if (detachedViews.has(this) || this.data.readonly || typeof event?.detail?.value !== "string") return;
      const key = event.currentTarget?.dataset?.key;
      if (!this.data.visibleItems.some(item => item.key === key)) return;
      this.triggerEvent("draftchange", { key, humanValue: boundedText(event.detail.value) });
    },
    onCandidateDecision(event: WechatMiniprogram.TouchEvent) {
      if (detachedViews.has(this) || this.data.readonly || !this.data.candidateActions) return;
      const { key, candidate, decision, revision } = event.currentTarget.dataset;
      if (!Number.isSafeInteger(revision) || revision < 1 || revision !== this.data.revision
        || !["accepted", "rejected"].includes(decision)) return;
      const item = this.data.visibleItems.find(row => row.key === key);
      if (!item?.candidateActionable || !item.candidateId || item.candidateId !== candidate) return;
      if (decision === 'accepted' && !item.candidateCanAccept) return;
      this.triggerEvent("candidatedecision", { key, candidateId: candidate, decision, revision });
    },
  },
});
