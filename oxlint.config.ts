import { axiom } from '@2bad/axiom'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [axiom],
  jsPlugins: ['eslint-plugin-obsidianmd'],
  rules: {
    'no-new': 'off',
    'import/no-default-export': 'off',
    'jsdoc/require-param': 'off',
    'jsdoc/require-returns': 'off',
    'typescript/no-non-null-assertion': 'warn',
    'promise/prefer-await-to-then': 'warn',
    'promise/prefer-await-to-callbacks': 'warn',
    'obsidianmd/commands/no-command-in-command-id': 'error',
    'obsidianmd/commands/no-command-in-command-name': 'error',
    'obsidianmd/commands/no-default-hotkeys': 'error',
    'obsidianmd/commands/no-plugin-id-in-command-id': 'error',
    'obsidianmd/commands/no-plugin-name-in-command-name': 'error',
    'obsidianmd/detach-leaves': 'error',
    'obsidianmd/editor-drop-paste': 'error',
    'obsidianmd/hardcoded-config-path': 'error',
    'obsidianmd/no-forbidden-elements': 'error',
    'obsidianmd/no-static-styles-assignment': 'error',
    'obsidianmd/no-tfile-tfolder-cast': 'error',
    'obsidianmd/object-assign': 'error',
    'obsidianmd/platform': 'error',
    'obsidianmd/prefer-abstract-input-suggest': 'error',
    'obsidianmd/prefer-active-doc': 'warn',
    'obsidianmd/prefer-active-window-timers': 'warn',
    'obsidianmd/prefer-get-language': 'error',
    'obsidianmd/regex-lookbehind': 'error',
    'obsidianmd/settings-tab/no-manual-html-headings': 'error',
    'obsidianmd/settings-tab/no-problematic-settings-headings': 'error',
    'obsidianmd/ui/sentence-case': 'error',
    'obsidianmd/ui/sentence-case-json': 'warn',
    'obsidianmd/vault/iterate': 'error'
  }
})
