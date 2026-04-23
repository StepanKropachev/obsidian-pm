import { builtinModules } from 'node:module'
import { defineConfig } from 'tsdown'

const prod = Boolean(process.env['PRODUCTION'])
const vaultPath = process.env['VAULT_PATH']
const outDir = vaultPath ? `${vaultPath}/.obsidian/plugins/project-manager` : '.'

export default defineConfig({
  entry: 'src/main.ts',
  format: 'cjs',
  target: 'es2022',
  outDir,
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
      ...builtinModules
    ]
  }
})
