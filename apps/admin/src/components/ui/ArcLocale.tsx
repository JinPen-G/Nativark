import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "@/app/locale";

/** Localize upstream chrome without changing vendor motion or document/file contents. */
const chrome: Record<string, string> = {
  "Weak": "弱", "Fair": "一般", "Good": "良好", "Strong": "强", "Too short": "过短",
  "Success": "成功", "Info": "提示", "Warning": "警告", "Error": "错误", "In progress": "处理中",
  "Choose country": "选择国家或地区", "Search countries": "搜索国家或地区", "Suggested": "推荐", "All countries": "所有国家或地区",
  "Search countries or calling codes": "搜索国家、地区或区号", "Clear search": "清空搜索", "Close country list": "关闭国家或地区列表", "Countries": "国家和地区",
  "Password strength": "密码强度", "Password requirements": "密码要求", "No password yet": "尚未输入密码",
  "Dismiss notification": "关闭提示",
  "Clear selections": "清空选择", "Clear selection": "清空选择", "Select options": "选择选项",
  ", not met": "，未满足", ", met": "，已满足", " more": " 个待补",
  "Show password": "显示密码", "Hide password": "隐藏密码",
  "Browse": "浏览文件", "Uploading": "上传中", "Uploaded": "已上传", "Ready": "待提交", "Failed": "上传失败",
  "Previous page": "上一页", "Next page": "下一页", "Previous month": "上个月", "Next month": "下个月",
  "Today": "今天", "Apply": "应用", "Cancel": "取消", "Reset": "重置", "Clear": "清空", "Choose a day": "选择日期", "Not started": "未开始", "Completed": "已完成",
  "Bold": "加粗", "Italic": "斜体", "Strikethrough": "删除线", "Link": "链接", "Unlink": "移除链接",
  "Undo": "撤销", "Redo": "重做", "Paragraph": "段落", "Heading 1": "一级标题", "Heading 2": "二级标题", "Heading 3": "三级标题",
  "Bullet list": "无序列表", "Numbered list": "有序列表", "Quote": "引用", "Code": "代码", "Code block": "代码块",
  "Hue": "色相", "Opacity": "透明度", "Color format": "颜色格式", "Save swatch": "保存色板"
};
export function ArcLocale({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const localize = (value: string) => {
      if (locale !== "zh-CN") return Object.entries(chrome).find(([, translated]) => translated === value)?.[0] ?? value.replace(/^第 (\d+) 页$/, "Page $1").replace(/^关闭：/, "Dismiss: ").replace(/^重试：/, "Retry ").replace(/^移除：/, "Remove ").replace(/^今天，/, "Today, ").replace(/ 日历$/, " calendar");
      return chrome[value] ?? value.replace(/^Sorted by (.*), ascending$/, "已按 $1 升序排列").replace(/^Sorted by (.*), descending$/, "已按 $1 降序排列").replace(/^Sort by /, "排序：").replace(/, currently ascending$/, "，当前升序").replace(/, currently descending$/, "，当前降序").replace(/^Page (\d+)$/, "第 $1 页").replace(/^Dismiss: /, "关闭：").replace(/^Retry /, "重试：").replace(/^Remove /, "移除：").replace(/^Today, /, "今天，").replace(/ calendar$/, " 日历").replace(/, digit (\d+) of (\d+)$/, "，第 $1 位，共 $2 位");
    };
    const translate = () => {
      for (const element of node.querySelectorAll<HTMLElement>("[aria-label], [title], [aria-valuetext], [placeholder]")) {
        if (element.closest("[contenteditable]")) continue;
        for (const attribute of ["aria-label", "title", "aria-valuetext", "placeholder"]) {
          const value = element.getAttribute(attribute);
          if (value) { const next = localize(value); if (next !== value) element.setAttribute(attribute, next); }
        }
      }
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const parent = text.parentElement;
        if (!parent || parent.closest("[contenteditable], output, input, textarea") || !parent.closest("button, [class*='srOnly'], [class*='browse'], [class*='statusWord'], .arc-date-field, .arc-password-strength [class*='wordText'], .arc-password-strength [class*='remainingText'], .arc-phone-field [class*='groupLabel']")) continue;
        const original = text.textContent ?? "";
        const next = localize(original);
        if (next !== text.textContent) text.textContent = next;
      }
    };
    translate();
    const observer = new MutationObserver(translate);
    observer.observe(node, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "title", "aria-valuetext", "placeholder"] });
    return () => observer.disconnect();
  }, [locale]);
  // Display contents keeps the source layout and original animation measurements.
  return <div ref={root} style={{ display: "contents" }}>{children}</div>;
}
