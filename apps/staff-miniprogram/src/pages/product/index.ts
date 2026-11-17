/** Original catalog-only product view. A URL reference filters the already
 * authorized catalog; it never grants asset, inventory, quote or edit access. */
import type { RentalItemGroup } from '@rental-os/shared';
import { listItemGroups } from '../../api/context';
import { blockedState, errorState, loadingState, readyState, handleCommonViewAction, type ViewState } from '../../core/page';
import { can, currentSession, isSignedIn, sessionEvents, contextVersion } from '../../core/session';
import { themeBehavior } from '../../core/theme-behavior';
import { ROUTES, buildUrl, relaunch } from '../../core/ui';
const display = (value: string) => Array.from(value).slice(0, 255).join('')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '');
const owner = () => { const session = currentSession(); return JSON.stringify([session?.tenant, session?.currentWorkspaceId,
  session?.user, contextVersion()]); };
Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, itemGroupId: '', code: '', name: '', unit: '', status: '' },
  visible: false, generation: 0, releaseSession: undefined as (() => void) | undefined,
  onLoad(query: Record<string, string>) {
    const id = query.itemGroupId ?? '';
    this.setData({ itemGroupId: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(id) ? id : '' });
    this.releaseSession = sessionEvents.on(() => { this.generation++; this.clear(); });
  },
  onShow() { this.visible = true; if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  onHide() { this.visible = false; this.generation++; this.clear(); },
  onUnload() { this.visible = false; this.generation++; this.clear(); this.releaseSession?.(); },
  clear() { this.setData({ code: '', name: '', unit: '', status: '', view: blockedState('请重新读取当前商品', '身份或页面上下文已变化', '重新读取', 'refresh') }); },
  async load() {
    if (!this.visible || !isSignedIn()) return;
    if (!can('rental-core:catalog:view', 'rental-core:catalog:manage')) { this.clear(); this.setData({ view: blockedState('无商品查看权限', '请联系管理员') }); return; }
    if (!this.data.itemGroupId) { this.clear(); this.setData({ view: blockedState('商品引用无效', '请从原商品入口重新进入') }); return; }
    const generation = ++this.generation, identity = owner(), target = this.data.itemGroupId;
    const current = () => this.visible && generation === this.generation && owner() === identity
      && can('rental-core:catalog:view', 'rental-core:catalog:manage') && this.data.itemGroupId === target;
    this.setData({ view: loadingState(), code: '', name: '', unit: '', status: '' });
    try {
      const rows: RentalItemGroup[] = await listItemGroups(true); if (!current()) return;
      const item = rows.find(row => row.id === target);
      if (!item) { this.setData({ view: blockedState('当前商品不可用', '原目录未返回该商品') }); return; }
      this.setData({ view: readyState(), code: display(item.code), name: display(item.name), unit: display(item.unit),
        status: item.status === 'enabled' ? '启用' : '停用' });
    } catch (error) { if (current()) this.setData({ view: errorState(error), code: '', name: '', unit: '', status: '' }); }
  },
  onRetry() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.product, { itemGroupId: this.data.itemGroupId }) })) void this.load(); },
});
