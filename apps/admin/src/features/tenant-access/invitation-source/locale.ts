/** 原版组件的宿主语言适配，保留业务姓名、角色与邮箱原文。 */
import { useLocale } from "@/app/locale";
const chinese: Record<string, string> = {
  "People to invite": "待邀请人员", "Emails or names": "邮箱地址", "Suggested": "建议",
  "Suggestions": "邮箱建议", "Invite by email": "通过邮箱邀请",
  "Separate with commas, or paste a whole list": "可用逗号分隔，或粘贴邮箱列表",
  "Remove invalid": "移除无效邮箱", "Reset preview": "清空本次选择", "Send invites": "发送邀请",
  "Send": "发送", "invite": "封邀请", "invites": "封邀请", "Pending ": "邀请状态 ",
  "Revoke invite": "撤回邀请", "No pending invites": "暂无待接受邀请", "Team": "团队",
  "Role": "角色", "Remove": "移除", " can’t be invited": " 项无法邀请", "Select an entry to fix it": "选择邮箱进行修改",
  "On the team": "已在团队中", "Invited": "已邀请", "Selected": "已选择", "Sending": "发送中",
  "Sent just now": "刚刚发送", "Joined": "已加入", "Preview reset": "已清空本次选择",
  "The invitation could not be completed": "邀请未能完成", "Add more": "继续添加",
  "No one matches “": "未找到“", "”. Type a full email to invite them.": "”。请输入完整邮箱地址。"
};
const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
  [/^(.+) is already on the team$/u, name => `${name} 已在团队中`],
  [/^(.+) already has a pending invite$/u, name => `${name} 已有待接受邀请`],
  [/^(.+) isn’t (?:an email address|a valid email address)$/u, value => `${value} 不是有效邮箱地址`],
  [/^(.+) is missing a name before the @$/u, value => `${value} 缺少 @ 前的账号`],
  [/^(.+) is missing a domain$/u, value => `${value} 缺少邮箱域名`],
  [/^(.+) needs a full domain, like (.+)$/u, (value, domain) => `${value} 需要完整域名，例如 ${domain}`],
  [/^Added (\d+) (?:person|people)$/u, count => `已添加 ${count} 人`],
  [/^(\d+) (?:entry|entries) need a fix$/u, count => `${count} 项需要修改`],
  [/^[Ss]kipped (\d+) duplicates?$/u, count => `已跳过 ${count} 项重复内容`],
  [/^Sending (\d+) invites?$/u, count => `正在发送 ${count} 封邀请`],
  [/^Added (.+)$/u, name => `已添加 ${name}`],
  [/^Removed (.+)$/u, name => `已移除 ${name}`],
  [/^Editing (.+)$/u, name => `正在修改 ${name}`],
  [/^(\d+) invites? sent$/u, count => `已发送 ${count} 封邀请`],
  [/^(.+) will join as (.+)$/u, (name, role) => `${name} 将以${role}角色加入`]
];
export function useInviteText() {
  const { locale } = useLocale();
  const translate = (value: string): string => {
    if (locale !== "zh-CN") return value;
    if (chinese[value]) return chinese[value];
    for (const [pattern, format] of patterns) {
      const match = value.match(pattern);
      if (match) return format(...match.slice(1));
    }
    return value;
  };
  return (value: string) => {
    const whole = translate(value);
    return whole !== value ? whole : value.split(", ").map(translate).join(locale === "zh-CN" ? "，" : ", ");
  };
}
