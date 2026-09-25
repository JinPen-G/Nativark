import { resolveImage } from "../../core/images";

/**
 * 受保护/远程图片的统一懒加载组件：内部封装 resolveImage（带令牌下载）+ 三态。
 * - loading：骨架占位（尊重 prefers-reduced-motion，走全局 .skeleton）
 * - ok：展示图片，加载失败(binderror)回落空态
 * - empty：无 source 或解析失败 → 中性占位（文案或回落图标），绝不卡在“加载中”，也不用他图冒充。
 * source 变化会重新解析；解析用自增令牌防止迟到响应覆盖新 source。
 */
interface LazyImageInstance {
  _token: number;
  data: { phase: "loading" | "ok" | "empty"; path: string; source: string };
  setData(data: Record<string, unknown>): void;
  load(source: string): void;
  onError(): void;
}

Component({
  options: { addGlobalClass: true },
  properties: {
    source: {
      type: String,
      value: "",
      observer(this: LazyImageInstance, next: string) {
        this.load(next);
      }
    },
    mode: { type: String, value: "aspectFill" },
    emptyText: { type: String, value: "暂无图片" },
    /** 空/失败时若给了图标名则渲染图标（如订单卡按品类图标兜底），否则渲染 emptyText。 */
    fallbackIcon: { type: String, value: "" },
    iconColor: { type: String, value: "muted" },
    iconSize: { type: Number, value: 48 }
  },
  data: { phase: "empty" as "loading" | "ok" | "empty", path: "" },
  lifetimes: {
    attached(this: LazyImageInstance) {
      this._token = 0;
      this.load(this.data.source);
    }
  },
  methods: {
    load(this: LazyImageInstance, source: string) {
      const token = (this._token = (this._token ?? 0) + 1);
      if (!source) {
        this.setData({ phase: "empty", path: "" });
        return;
      }
      this.setData({ phase: "loading" });
      resolveImage(source).then((path) => {
        if (token !== this._token) return;
        this.setData(path ? { phase: "ok", path } : { phase: "empty", path: "" });
      });
    },
    onError(this: LazyImageInstance) {
      this.setData({ phase: "empty", path: "" });
    }
  }
});
