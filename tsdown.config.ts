import builtins from 'builtin-modules'
import { defineConfig } from 'tsdown'

const prod = Boolean(process.env['PRODUCTION'])

export default defineConfig({
  entry: 'src/main.ts',
  format: 'cjs',
  target: 'es2022',
  outDir: '.',
  platform: 'node',
  dts: false,
  minify: prod,
  sourcemap: prod ? false : 'inline',
  clean: false,
  hash: false,
  outExtensions: () => ({ js: '.js' }),
  deps: {
    neverBundle: [
      'obsidian',
      'electron',
      '@codemirror/autocomplete',
      '@codemirror/collab',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/lr',
      ...builtins
    ]
  }
})
