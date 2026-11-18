// Bundelt functions/src (inclusief de gedeelde code uit ../src/model en ../src/lib) naar lib/index.js.
// Pakketten uit node_modules blijven extern: Firebase installeert die zelf bij het deployen.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})
