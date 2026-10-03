interface SourceDisplay { id: string; version: string; title: string; location: string; status: string; statusLabel: string; }
type SourceHandler = (ref: { resourceId: string; version: string }) => Promise<void>;
Component({
  properties: { sources: { type: Array, value: [] }, openHandler: { type: null, value: null } },
  data: { visibleSources: [] as SourceDisplay[], opening: false, errorLabel: "", generation: 0, alive: true },
  lifetimes: { attached() { this.project(); }, detached() { this.setData({ alive: false, visibleSources: [], errorLabel: "", generation: this.data.generation + 1 }); } },
  observers: { "sources,openHandler"() { if (!this.data.alive) return; this.setData({ generation: this.data.generation + 1, errorLabel: "" }); this.project(); } },
  methods: {
    project() {
      if (!this.data.alive) return;
      this.setData({ visibleSources: (this.data.sources as Record<string, unknown>[]).slice(0, 50).filter(item => item && typeof item.id === "string" && typeof item.version === "string").map(item => {
        const readable = item.status === "published";
        const statusLabel = item.status === "withdrawn" ? "已撤回" : item.status === "no_access" ? "无权限" : readable ? "已发布" : "来源失效/不可用";
        return { id: String(item.id).slice(0, 128), version: String(item.version).slice(0, 128), status: typeof item.status === "string" ? item.status : "unavailable", statusLabel,
          title: readable && typeof item.title === "string" ? item.title.slice(0, 200) : "来源不可用",
          location: readable && typeof item.location === "string" ? item.location.slice(0, 200) : "不可用" };
      }) });
    },
    async onOpen(event: WechatMiniprogram.CustomEvent): Promise<void> {
      const dataset = event.currentTarget.dataset;
      const id = dataset.id ?? (dataset.source as { id?: string } | undefined)?.id;
      const source = this.data.visibleSources.find(item => item.id === id);
      const handler = this.data.openHandler as SourceHandler | null;
      if (!source || source.status !== "published" || !this.data.alive || this.data.opening || typeof handler !== "function") return;
      const generation = this.data.generation; const reference = { resourceId: source.id, version: source.version };
      this.setData({ opening: true, errorLabel: "" });
      try { await handler(reference); if (this.data.alive && generation === this.data.generation) this.triggerEvent("open", reference); }
      catch { if (this.data.alive && generation === this.data.generation) this.setData({ errorLabel: "来源打开失败" }); }
      finally { if (this.data.alive) this.setData({ opening: false }); }
    },
  },
});
