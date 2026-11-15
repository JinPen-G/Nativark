/** Original inspection locators must distinguish absent storage from failed
 * I/O. These synchronous ports never grant permission or retry an operation;
 * callers own the original-key comparison and confirmation after writes. */
export function readInspectionOriginalStorage(key: string): unknown {
  const value: unknown = wx.getStorageSync(key);
  return value === '' || value === null || value === undefined ? undefined : value;
}

export function writeInspectionOriginalStorage(key: string, value: unknown): void {
  wx.setStorageSync(key, value);
}

export function removeInspectionOriginalStorage(key: string): void {
  wx.removeStorageSync(key);
}
