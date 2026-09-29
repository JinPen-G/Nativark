import { isSignedIn } from "../../core/session";
import { dismissSubscriptionReminder, loadSubscription, subscriptionEvents, subscriptionLoadStatus, subscriptionReminder, subscriptionSummary } from "../../core/subscription";
import { themeBehavior } from "../../core/theme-behavior";
import { navigate, ROUTES } from "../../core/ui";

const lifecycles = new WeakMap<object, { off: () => void; timer?: ReturnType<typeof setInterval> }>();

Component({
  behaviors: [themeBehavior],
  options: { addGlobalClass: true },
  properties: { reminderOnly: { type: Boolean, value: false } },
  data: { summary: subscriptionSummary(), reminder: subscriptionReminder(), failed: false },
  lifetimes: {
    attached() { lifecycles.set(this, { off: subscriptionEvents.on(() => this.render()) }); this.start(); },
    detached() { this.stop(); lifecycles.get(this)?.off(); lifecycles.delete(this); }
  },
  pageLifetimes: { show() { this.start(); }, hide() { this.stop(); } },
  methods: {
    render() { this.setData({ summary: subscriptionSummary(), reminder: subscriptionReminder(), failed: subscriptionLoadStatus() === "error" }); },
    start() {
      this.stop();
      const lifecycle = lifecycles.get(this);
      if (!lifecycle) return;
      this.render();
      void this.refresh();
      lifecycle.timer = setInterval(() => { if (isSignedIn()) void this.refresh(); }, 30_000);
    },
    stop() { const lifecycle = lifecycles.get(this); if (lifecycle?.timer) clearInterval(lifecycle.timer); if (lifecycle) lifecycle.timer = undefined; },
    async refresh() {
      if (!isSignedIn()) return;
      await loadSubscription(subscriptionLoadStatus() !== "loading").catch(() => undefined);
      if (lifecycles.has(this)) this.render();
    },
    onOpen() { navigate(ROUTES.subscription); },
    onRetry() { void this.refresh(); },
    onDismiss() { dismissSubscriptionReminder(this.data.reminder.key); }
  }
});
