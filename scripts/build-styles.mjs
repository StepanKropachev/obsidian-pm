import { watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from 'lightningcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src/styles/index.css')
const stylesDir = join(root, 'src/styles')

const prod = Boolean(process.env['PRODUCTION'])
const vaultPath = process.env['VAULT_PATH']
const outDir = vaultPath ? `${vaultPath}/.obsidian/plugins/project-manager` : root
const outFile = join(outDir, 'styles.css')

function build() {
  const { code } = bundle({ filename: entry, minify: prod })
  writeFileSync(outFile, code)
}

build()
console.log(`styles.css -> ${outFile}`)

if (process.argv.includes('--watch')) {
  let timer
  watch(stylesDir, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        build()
        console.log('styles.css rebuilt')
      } catch (error) {
        console.error(error.message)
      }
    }, 50)
  })
  console.log('watching src/styles')
}
