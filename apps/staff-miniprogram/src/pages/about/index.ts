import { themeBehavior } from "../../core/theme-behavior";

Page({
  behaviors: [themeBehavior],
  data: { section: "", version: "0.1.0" },
  onLoad(query: Record<string, string>) { this.setData({ section: query.section ?? "" }); }
});
