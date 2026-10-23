/** Inline the public Rental OS protocol artifact, not the complete shared runtime or its source tree. */
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../tsdown.client.ts'

const preset = clientBundle(import.meta.dirname, ['lib/types/index.js'])
export default (options: Parameters<typeof preset>[0]) => {
  const configs = preset(options)
  const rows = Array.isArray(configs) ? configs : [configs]
  return rows.map(config => ({ ...config, plugins: [{
    name: 'rental-public-protocol',
    resolveId(source: string) {
      if (source === '@rental-os/shared/agent-desktop') return fileURLToPath(new URL('../../../../../../packages/shared/dist-agent-desktop/agent-desktop.js', import.meta.url))
      return null
    },
  }, ...config.plugins ?? []] }))
}
