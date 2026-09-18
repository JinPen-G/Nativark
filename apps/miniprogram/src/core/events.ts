/** 极简事件总线：页面在 onLoad/onShow 订阅，onUnload/onHide 取消。不做队列、不做重放。 */
export type Listener<T> = (payload: T) => void;

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  off(listener: Listener<T>): void {
    this.listeners.delete(listener);
  }

  emit(payload: T): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(payload);
      } catch {
        // 监听方的异常不能打断其他监听者，也不能让触发方失败。
      }
    }
  }
}
