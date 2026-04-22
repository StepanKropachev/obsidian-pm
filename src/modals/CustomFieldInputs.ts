import { Menu } from 'obsidian'
import type PMPlugin from '../main'
import type { Project, Task, CustomFieldDef } from '../types'
import { stringifyCustomValue } from '../utils'

export function renderCustomFieldInput(
  cf: CustomFieldDef,
  task: Task,
  project: Project,
  plugin: PMPlugin
): HTMLElement {
  const currentVal = task.customFields[cf.id]
  const wrap = createDiv('pm-prop-value')
  switch (cf.type) {
    case 'text':
    case 'url': {
      const input = wrap.createEl('input', { type: cf.type === 'url' ? 'url' : 'text', cls: 'pm-prop-text' })
      input.value = stringifyCustomValue(currentVal)
      input.placeholder = cf.name
      input.addEventListener('change', () => {
        task.customFields[cf.id] = input.value
      })
      break
    }
    case 'number': {
      const input = wrap.createEl('input', { type: 'number', cls: 'pm-prop-text' })
      input.value = stringifyCustomValue(currentVal)
      input.addEventListener('change', () => {
        task.customFields[cf.id] = parseFloat(input.value)
      })
      break
    }
    case 'date': {
      const input = wrap.createEl('input', { type: 'date', cls: 'pm-prop-date' })
      input.value = stringifyCustomValue(currentVal)
      input.addEventListener('change', () => {
        task.customFields[cf.id] = input.value
      })
      break
    }
    case 'checkbox': {
      const input = wrap.createEl('input', { type: 'checkbox', cls: 'pm-prop-checkbox' })
      input.checked = Boolean(currentVal)
      input.addEventListener('change', () => {
        task.customFields[cf.id] = input.checked
      })
      break
    }
    case 'select': {
      const sel = wrap.createEl('select', { cls: 'pm-prop-select' })
      sel.createEl('option', { value: '', text: '\u2014' })
      for (const opt of cf.options ?? []) {
        const o = sel.createEl('option', { value: opt, text: opt })
        if (opt === currentVal) o.selected = true
      }
      sel.addEventListener('change', () => {
        task.customFields[cf.id] = sel.value
      })
      break
    }
    case 'multiselect': {
      const vals = Array.isArray(currentVal) ? (currentVal as string[]) : []
      const renderMulti = () => {
        wrap.empty()
        for (const v of vals) {
          const chip = wrap.createEl('span', { cls: 'pm-tag pm-tag--removable', text: v })
          const rm = chip.createEl('button', { text: '\u2715', cls: 'pm-tag-rm' })
          rm.addEventListener('click', () => {
            const idx = vals.indexOf(v)
            if (idx > -1) vals.splice(idx, 1)
            task.customFields[cf.id] = [...vals]
            renderMulti()
          })
        }
        const addBtn = wrap.createEl('button', { text: '+ add', cls: 'pm-prop-add-btn' })
        addBtn.addEventListener('click', (e) => {
          const menu = new Menu()
          for (const opt of cf.options ?? []) {
            if (!vals.includes(opt)) {
              menu.addItem((item) =>
                item.setTitle(opt).onClick(() => {
                  vals.push(opt)
                  task.customFields[cf.id] = [...vals]
                  renderMulti()
                })
              )
            }
          }
          menu.showAtMouseEvent(e)
        })
      }
      renderMulti()
      break
    }
    case 'person': {
      const input = wrap.createEl('input', { type: 'text', cls: 'pm-prop-text' })
      input.value = stringifyCustomValue(currentVal)
      input.placeholder = 'Person name'
      const all = [...new Set([...project.teamMembers, ...plugin.settings.globalTeamMembers])]
      input.setAttribute('list', `pm-persons-${cf.id}`)
      const dl = wrap.createEl('datalist', { attr: { id: `pm-persons-${cf.id}` } })
      for (const m of all) dl.createEl('option', { value: m })
      input.addEventListener('change', () => {
        task.customFields[cf.id] = input.value
      })
      break
    }
  }
  return wrap
}
