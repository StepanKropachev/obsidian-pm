import { axiom } from '@2bad/axiom'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [axiom],
  rules: {
    'no-new': 'off',
    'import/no-default-export': 'off',
    'jsdoc/require-param': 'off',
    'jsdoc/require-returns': 'off',
    'typescript/no-non-null-assertion': 'warn',
    'promise/prefer-await-to-then': 'warn',
    'promise/prefer-await-to-callbacks': 'warn'
  }
})
