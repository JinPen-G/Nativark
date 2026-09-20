/**
 * 定位与门店距离（MP-04 附近服务点）。
 *
 * - 位置只在用户主动触发时请求一次，拒绝授权就退回“不显示距离、按列表顺序展示”，不反复弹窗。
 * - 距离用 Haversine 估算直线距离，仅用于排序与“约 x km”展示，不代表导航里程。
 * - 导航调用 wx.openLocation，必须要门店经纬度；没有坐标的门店只显示地址、不提供导航。
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** 只读缓存：一次会话内复用已授权拿到的位置，避免每页重复弹窗。 */
let cachedLocation: GeoPoint | undefined;

export function cachedUserLocation(): GeoPoint | undefined {
  return cachedLocation;
}

/**
 * 请求用户位置：已缓存则直接返回；否则调用 wx.getLocation。
 * 用户拒绝、无授权或接口失败都返回 undefined（调用方按“无距离”降级），不抛错、不重复请求。
 */
export function requestUserLocation(): Promise<GeoPoint | undefined> {
  if (cachedLocation) return Promise.resolve(cachedLocation);
  return new Promise((resolve) => {
    wx.getLocation({
      type: "gcj02",
      success: (res) => {
        if (typeof res.latitude === "number" && typeof res.longitude === "number") {
          cachedLocation = { latitude: res.latitude, longitude: res.longitude };
          resolve(cachedLocation);
        } else {
          resolve(undefined);
        }
      },
      fail: () => resolve(undefined)
    });
  });
}

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 两点直线距离（米）。入参非法时返回 undefined。 */
export function distanceMeters(a: GeoPoint | undefined, b: GeoPoint | undefined): number | undefined {
  if (!a || !b) return undefined;
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** “约 800 m / 约 3.2 km”；无距离返回空串。 */
export function formatDistance(meters: number | undefined): string {
  if (meters === undefined || !Number.isFinite(meters)) return "";
  if (meters < 1000) return `约 ${Math.max(1, Math.round(meters / 10) * 10)} m`;
  return `约 ${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** 打开地图查看/导航到门店；缺坐标时提示并返回 false，不静默失败。 */
export function openLocationOnMap(point: GeoPoint | undefined, name: string, address?: string): boolean {
  if (!point) {
    wx.showToast({ title: "该门店暂无位置坐标", icon: "none" });
    return false;
  }
  wx.openLocation({ latitude: point.latitude, longitude: point.longitude, name, address: address ?? "", scale: 15, fail: () => wx.showToast({ title: "无法打开地图", icon: "none" }) });
  return true;
}

/** 仅供测试重置会话缓存。 */
export function resetGeoForTest(): void {
  cachedLocation = undefined;
}
