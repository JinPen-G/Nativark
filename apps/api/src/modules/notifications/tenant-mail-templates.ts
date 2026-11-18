/** 邮件模板只由服务端构建，参数按文本转义；预览使用同一模板但移除激活凭证。 */
export const OPERATOR_INVITATION_TEMPLATE_VERSION = "operator-invitation-1";
const escape = (value: string) => value.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const paragraphs = (value: string) => value.split(/\r?\n/u).map(line => `<p style="margin:0 0 12px;line-height:1.65">${escape(line) || "&nbsp;"}</p>`).join("");

function frame(brand: string, heading: string, body: string, footer: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(heading)}</title></head><body style="margin:0;padding:32px 16px;background:#f7f7f7;color:#242424;font:14px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif"><table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border-collapse:separate;border-spacing:0"><tr><td style="padding:0 0 20px;font-size:17px;font-weight:600">${escape(brand)}</td></tr><tr><td style="padding:32px;background:#fff;border:1px solid #e6e6e6;border-radius:12px"><h1 style="margin:0 0 20px;font-size:24px;line-height:1.35;font-weight:600">${escape(heading)}</h1>${body}<p style="margin:28px 0 0;border-top:1px solid #eeeeee;padding-top:20px;color:#747474;font-size:12px">${escape(footer)}</p></td></tr><tr><td style="padding:20px 4px;color:#888;font-size:12px">此邮件由 ${escape(brand)} 发送。</td></tr></table></body></html>`;
}

export function renderOperatorInvitation(input: {
  tenantName: string; inviteeName: string; inviterName: string; roleNames: string[]; workspaceNames: string[]; expiresAt: string; activationUrl?: string;
}) {
  const greeting = input.inviteeName ? `${input.inviteeName}，你好：` : "你好：";
  const description = `${input.inviterName} 邀请你加入 ${input.tenantName}，成为运营用户。`;
  const expiry = new Date(input.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const fields = [{ label: "角色", value: input.roleNames.join("、") }, { label: "经营空间", value: input.workspaceNames.join("、") }, { label: "有效期至", value: `${expiry}（北京时间）` }];
  const details = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0">${fields.map(row => `<tr><td style="padding:9px 0;border-bottom:1px solid #eeeeee;color:#777;width:84px;vertical-align:top">${row.label}</td><td style="padding:9px 0;border-bottom:1px solid #eeeeee">${escape(row.value)}</td></tr>`).join("")}</table>`;
  const button = input.activationUrl
    ? `<a href="${escape(input.activationUrl)}" style="display:inline-block;padding:11px 24px;background:#242424;border-radius:8px;color:#fff;font-weight:600;text-decoration:none">接受邀请</a><p style="margin:18px 0 0;color:#777;font-size:12px">按钮无法打开时，将下方链接复制到浏览器：</p><p style="margin:6px 0 0;font-size:12px;word-break:break-all">${escape(input.activationUrl)}</p>`
    : `<span style="display:inline-block;padding:11px 24px;background:#242424;border-radius:8px;color:#fff;font-weight:600">接受邀请</span><p style="margin:18px 0 0;color:#777;font-size:12px">邀请链接已在历史预览中隐藏，仅原收件人可以使用。</p>`;
  const text = `${greeting}\n\n${description}\n\n${fields.map(row => `${row.label}：${row.value}`).join("\n")}\n\n接受邀请后自行设置登录密码。\n${input.activationUrl ?? "[邀请链接已隐藏]"}\n\n如果你不认识邀请人，请忽略此邮件。`;
  return { subject: `${input.inviterName} 邀请你加入 ${input.tenantName}`.slice(0, 200),
    text, html: frame(input.tenantName, "你收到了一份运营邀请", `${paragraphs(`${greeting}\n${description}`)}${details}<p style="margin:0 0 20px">接受邀请后，请设置你的登录密码。你的邮箱将用作登录账号。</p>${button}`, "如果你不认识邀请人，请忽略此邮件。邀请被撤回或到期后，链接将不可使用。") };
}
