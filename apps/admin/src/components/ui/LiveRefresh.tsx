import { useEffect, useState } from "react";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { Switch } from "./Switch";

export function useLiveRefresh(name: string, paused = false) {
  const scope = useListQueryIdentity();
  const identity = `${name}:${scope}`;
  const [selection, setSelection] = useState({ identity, enabled: false });
  useEffect(() => { setSelection(previous => previous.identity === identity ? previous : { identity, enabled: false }); }, [identity]);
  const enabled = selection.identity === identity && selection.enabled;
  return { scope, enabled, setEnabled: (value: boolean) => setSelection({ identity, enabled: value }), queryOptions: {
    meta: { liveRefresh: enabled },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: enabled && !paused,
    refetchInterval: (query: { state: { error: unknown } }) => {
      const status = (query.state.error as { response?: { status?: number } } | null)?.response?.status;
      return enabled && !paused && !(status && status >= 400 && status < 500 && status !== 408 && status !== 429) ? 10_000 : false;
    }
  } };
}

export function useListQueryIdentity() {
  // Permission order is not an authorization change. Never sort the store's own array.
  return useAuthStore(state => JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id, state.user?.isPlatformAdmin, state.user?.isSaasAdmin, state.user?.dataScope, state.user?.locationScope,
    state.user?.permissions && [...new Set(state.user.permissions)].sort(), state.user?.organizationId]));
}

export function LiveRefresh({ enabled, onChange, busy, updatedAt, paused }: { enabled: boolean; onChange: (value: boolean) => void; busy?: boolean; updatedAt?: number; paused?: boolean }) {
  const { t, locale } = useLocale();
  return <div className="list-live-refresh" title={t(paused ? "正在操作，实时更新暂时暂停" : enabled ? "每 10 秒更新，后台标签页暂停" : "开启后实时获取新数据")}>
    <Switch checked={enabled} onChange={onChange} aria-label={t("实时更新")} />
    <span>{t("实时")}</span>
    <span className="list-live-status" role="status">{busy ? t("更新中") : paused && enabled ? t("已暂停") : updatedAt ? new Date(updatedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : ""}</span>
  </div>;
}
