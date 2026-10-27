/** Deployment-owned admin URL. Absent configuration preserves the upstream product; malformed configuration refuses startup. */
export interface RentalDesktopConfig { adminUrl: string; downloadOrigins: string[] }

/** Resolve the approved Web deployment without reading credentials or an environment file. */
export function rentalDesktopConfig(manifest: unknown, development: boolean, override?: string): RentalDesktopConfig | undefined {
  const configured = typeof manifest === 'object' && manifest !== null && 'rentalDesktop' in manifest ? manifest.rentalDesktop : undefined
  const raw: unknown = development && override !== undefined ? { adminUrl: override } : configured
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['adminUrl', 'downloadOrigins'].includes(key))
    || !('adminUrl' in raw) || typeof raw.adminUrl !== 'string') throw new Error('Invalid Rental OS desktop configuration')
  const url = new URL(raw.adminUrl)
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
    && !(development && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('Rental OS admin requires an approved HTTPS deployment')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  const origins: unknown = 'downloadOrigins' in raw ? raw.downloadOrigins : []
  if (!Array.isArray(origins) || origins.length > 20) throw new Error('Invalid Rental OS download origins')
  const downloadOrigins = origins.map(value => {
    if (typeof value !== 'string') throw new Error('Invalid Rental OS download origin')
    const target = new URL(value)
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Rental OS downloads require explicit HTTPS origins')
    return target.origin
  })
  return { adminUrl: url.href, downloadOrigins }
}
