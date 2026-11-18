/** 客服邮件采用本地 UIArc Inbox / Support conversation 原布局样式，宿主仅读取原邮件事实。
 * 同步为显式只读IMAP操作；首期不提供模拟回复、派工或关闭结果。 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Mail } from "lucide-react";
import { useLocale } from "@/app/locale";
import { tenantSupportApi } from "@/api/tenantMessaging";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ActionButton, Alert, App, Button, Empty, Pagination, SearchField } from "@/components/ui";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { useNavigate } from "react-router-dom";
import inbox from "./source/inbox/classes.json";
import thread from "./source/conversation/classes.json";
import inboxCss from "./source/inbox/original.css?inline";
import conversationCss from "./source/conversation/original.css?inline";
import styles from "./Support.module.css";

export function CustomerSupportPage() {
  const { t, locale } = useLocale(), navigate = useNavigate(), cache = useQueryClient(), { message } = App.useApp();
  const [keyword, setKeyword] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string>();
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => { const timer = setTimeout(() => { setSearch(keyword); setPage(1); }, 250); return () => clearTimeout(timer); }, [keyword]);
  const emails = useQuery({ queryKey: ["tenant-support-emails", search, page], queryFn: () => tenantSupportApi.emails({ search, page, pageSize: 30 }) });
  const rows = emails.data?.rows ?? [], activeId = selected && rows.some(row => row.id === selected) ? selected : rows[0]?.id;
  const detail = useQuery({ queryKey: ["tenant-support-email", activeId], enabled: Boolean(activeId), queryFn: () => tenantSupportApi.detail(activeId!) });
  const sync = useMutation({ mutationFn: tenantSupportApi.sync, onSuccess: async result => {
    await cache.invalidateQueries({ queryKey: ["tenant-support-emails"] });
    message.success(result.hasMore ? t("本批邮件已同步，还有待同步邮件，可继续同步。") : t("邮箱同步完成"));
  }, onError: (error: { response?: { data?: { message?: string } }; message?: string }) => message.error(error.response?.data?.message ?? error.message ?? t("邮箱同步失败")) });
  const chooseWithKeyboard = (event: KeyboardEvent, index: number) => {
    if (!["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) return;
    event.preventDefault(); const offset = ["ArrowDown", "j"].includes(event.key) ? 1 : -1;
    const next = rows[(index + offset + rows.length) % rows.length];
    if (next) { setSelected(next.id); rowButtons.current.get(next.id)?.focus({ preventScroll: true }); }
  };
  const current = detail.data;
  const storageError = (emails.error as { response?: { data?: { message?: string } } } | undefined)?.response?.data?.message;
  return <>
    <PageHeader title={t("客服中心")} description={t("邮件客诉")} tools={<>
      <ActionButton label={t("同步邮件")} intent="refresh" variant="secondary" pending={sync.isPending} disabled={!emails.data?.receiverConfigured}
        onAction={() => sync.mutateAsync()} />
      <Button type="text" onClick={() => navigate("/tenant/integrations")}>{t("邮箱配置")}</Button>
    </>} />
    {emails.data && !emails.data.receiverConfigured && <Alert type="info" showIcon title={t("尚未启用客服邮箱接收")}
      description={t("请在第三方服务的邮箱配置中填写 IMAP 服务器与收件文件夹，启用接收并测试连接。已有邮件仍可查看。")} />}
    {storageError ? <Alert type="error" showIcon title={storageError} /> : <QueryState loading={emails.isLoading} error={emails.error}>
      <div className="tenant-support-source">
        <style>{`@scope (.tenant-support-source) { ${inboxCss}\n${conversationCss} }`}</style>
      <section className={`${inbox.page} ${styles.workspace}`} aria-label={t("客诉邮件")}>
        <div className={styles.listColumn}>
          <div className={inbox.toolbar}><div className={inbox.toolbarLayer}><SearchField label={t("查找客诉邮件")} placeholder={t("发件人或邮件主题")} value={keyword} onValueChange={setKeyword} /></div></div>
          <div className={styles.listMeta}><span>{t("客诉邮件")} {emails.data?.total ?? 0}</span>
            {emails.data?.lastSyncedAt && <span>{t("上次同步")} {new Date(emails.data.lastSyncedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span>}</div>
          <div className={`${inbox.scroller} ${styles.mailList}`}>
            <ul className={inbox.rows}>{rows.map((row, index) => <li className={inbox.rowItem} key={row.id}>
              <button ref={node => { if (node) rowButtons.current.set(row.id, node); else rowButtons.current.delete(row.id); }}
                type="button" className={`${inbox.rowButton} ${styles.row}`} aria-current={activeId === row.id ? "true" : undefined}
                onClick={() => setSelected(row.id)} onKeyDown={event => chooseWithKeyboard(event, index)}>
                <span className={styles.avatar}>{row.senderName.slice(0, 1)}</span><span className={inbox.rowMain}>
                  <span className={inbox.rowTop}><span className={inbox.rowName}>{row.senderName}</span><span className={inbox.rowTime}>{new Date(row.receivedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}</span></span>
                  <span className={inbox.rowSubject}>{row.subject}</span><span className={inbox.rowPreview}>{row.preview || t("无正文")}</span>
                  <span className={inbox.rowMeta}><Mail size={12} />{row.senderEmail}{row.attachmentCount > 0 && <span> · {row.attachmentCount} {t("附件")}</span>}</span>
                </span>
              </button>
            </li>)}</ul>
            {!rows.length && <Empty description={t("暂无客诉邮件")} />}
          </div>
          <div className={styles.pagination}><Pagination current={page} pageSize={30} total={emails.data?.total ?? 0} onChange={setPage} /></div>
        </div>
        <div className={`${thread.page} ${styles.threadColumn}`}>
          <QueryState loading={detail.isLoading} error={detail.error}>
            {current ? <ContentTransition value={current.id} className={styles.threadContent}>
              <div className={`${thread.column} ${styles.threadContent}`}>
                <header className={thread.intro}><h2 className={thread.subject}>{current.subject}</h2>
                  <div className={thread.introMeta}><span className={thread.metaItem}><Mail size={14} />{t("邮件")}</span><span>{new Date(current.receivedAt).toLocaleString(locale)}</span></div></header>
                <div className={`${thread.scroller} ${styles.messageScroll}`}>
                  <article className={thread.messageRow}><div className={styles.avatar}>{current.senderName.slice(0, 1)}</div>
                    <div className={thread.messageBody}><div className={thread.messageMeta}><span className={thread.author}>{current.senderName}</span><span className={thread.time}>{current.senderEmail}</span></div>
                      <div className={`${thread.bubble} ${styles.body}`}>{current.bodyText || t("无正文")}</div>
                      {current.attachments.length > 0 && <ul className={styles.attachments}>{current.attachments.map((file, index) => <li key={index} className={thread.fileCard}>
                        <FileText size={18} /><span>{file.name}<small className={thread.fileSize}>{Math.ceil(file.size / 1024)} KB · {file.contentType}</small></span>
                      </li>)}</ul>}
                    </div></article>
                  <dl className={styles.envelope}><div><dt>{t("收件人")}</dt><dd>{current.recipient}</dd></div>
                    {current.messageId && <div><dt>{t("邮件编号")}</dt><dd>{current.messageId}</dd></div>}</dl>
                  {current.attachments.length > 0 && <p className={styles.note}>{t("此处显示附件信息，附件文件仍保留在原邮箱。")}</p>}
                </div>
              </div>
            </ContentTransition> : <div className={styles.emptyDetail}><Empty description={t("选择一封邮件查看内容")} /></div>}
          </QueryState>
        </div>
      </section>
      </div>
    </QueryState>}
  </>;
}
