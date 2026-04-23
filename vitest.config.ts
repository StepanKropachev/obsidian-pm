import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./test/obsidian-stub.ts', import.meta.url))
    }
  },
  test: {
    exclude: ['build', 'node_modules'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/migration.ts', 'src/views/**', 'src/modals/**', 'src/ui/**', 'src/components/**', 'src/settings.ts', ...coverageConfigDefaults.exclude],
      provider: 'v8',
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0
      }
    },
    testTimeout: 30000
  },
  plugins: [tsconfigPaths()]
})
