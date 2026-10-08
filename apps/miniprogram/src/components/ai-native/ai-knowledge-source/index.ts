import { identityRows } from "../identity-rows";
interface SourceDisplay { id: string; version: string; rowKey: string; title: string; location: string; status: string; statusLabel: string; }
type SourceHandler = (ref: { resourceId: string; version: string }) => Promise<void>;
Component({
  properties: { sources: { type: Array, value: [] } },
  data: { hostAvailable: false, visibleSources: [] as SourceDisplay[], opening: false, errorLabel: "", generation: 0, alive: true },
  lifetimes: { attached() { this.project(); }, detached() { unbindHostAction(this); this.setData({ hostAvailable: false, alive: false, visibleSources: [], errorLabel: "", generation: this.data.generation + 1 }); } },
  observers: { "sources"() { if (!this.data.alive) return; this.setData({ generation: this.data.generation + 1, errorLabel: "" }); this.project(); } },
  methods: {
    attachHost(action: (input: unknown) => Promise<void>) {
      bindHostAction(this, action);
      this.setData({ hostAvailable: true, generation: this.data.generation + 1, errorLabel: "" });
    },
    detachHost() {
      unbindHostAction(this);
      this.setData({ hostAvailable: false, generation: this.data.generation + 1, errorLabel: "" });
    },
    project() {
      if (!this.data.alive) return;
      this.setData({ visibleSources: identityRows(this.data.sources, ["id", "version"]).map(item => {
        const readable = item.status === "published";
        const statusLabel = item.status === "withdrawn" ? "已撤回" : item.status === "no_access" ? "无权限" : readable ? "已发布" : "来源失效/不可用";
        return { id: item.id as string, version: item.version as string, rowKey: JSON.stringify([item.id, item.version]), status: typeof item.status === "string" ? item.status : "unavailable", statusLabel,
          title: readable && typeof item.title === "string" ? item.title.slice(0, 200) : "来源不可用",
          location: readable && typeof item.location === "string" ? item.location.slice(0, 200) : "不可用" };
      }) });
    },
    async onOpen(event: WechatMiniprogram.CustomEvent): Promise<void> {
      if (!this.data.alive) return;
      const dataset = event?.currentTarget?.dataset;
      if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return;
      const id = dataset.id ?? (dataset.source as { id?: string } | undefined)?.id;
      const version = dataset.version ?? (dataset.source as { version?: string } | undefined)?.version;
      const matches = this.data.visibleSources.filter(item => item.id === id && (version === undefined || item.version === version));
      const source = matches.length === 1 ? matches[0] : undefined;
      const handler = hostAction(this) as SourceHandler | null;
      if (!source || source.status !== "published" || !this.data.alive || this.data.opening || typeof handler !== "function") return;
      const generation = this.data.generation; const reference = { resourceId: source.id, version: source.version };
      this.setData({ opening: true, errorLabel: "" });
      try { await handler(reference); if (this.data.alive && generation === this.data.generation) this.triggerEvent("open", reference); }
      catch { if (this.data.alive && generation === this.data.generation) this.setData({ errorLabel: "来源打开失败" }); }
      finally { if (this.data.alive) this.setData({ opening: false }); }
    },
  },
});
import { bindHostAction, unbindHostAction, hostAction } from "../host-binding";
