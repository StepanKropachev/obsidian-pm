import { getIconIds, setIcon } from 'obsidian'
import { Popover } from '../../primitives/Popover'
import { renderGlyph, renderOptionRow } from './optionList'

export interface IconControlOpts {
  container: HTMLElement
  value: string
  onChange: (icon: string) => void
  /** Tints the preview, so the trigger reads the way the icon will in the app. */
  color?: string
}

/** Enough of the set to browse; the search field is how you reach the rest. */
const GRID_LIMIT = 96

/** Anything that isn't a plain icon name is taken literally, which is how emoji get in. */
function isGlyphQuery(query: string): boolean {
  return query.length > 0 && !/^[a-z0-9 -]+$/i.test(query)
}

/** Backs the status and priority icon fields: a preview that opens a searchable icon grid. */
export function renderIconControl(opts: IconControlOpts): void {
  let value = opts.value
  const trigger = opts.container.createEl('button', { cls: 'pm-prop-inline pm-icon-trigger' })

  const drawTrigger = (): void => {
    trigger.empty()
    trigger.toggleClass('pm-prop-inline--empty', !value)
    if (value) renderGlyph(trigger, { icon: value, color: opts.color })
    else setIcon(trigger.createSpan({ cls: 'pm-glyph-icon' }), 'plus')
    const chevron = trigger.createSpan({ cls: 'pm-prop-chevron' })
    setIcon(chevron, 'chevron-down')
  }
  drawTrigger()

  let pop: Popover | null = null
  trigger.addEventListener('click', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    const popover = new Popover({ anchor: trigger, width: 268, onClose: () => (pop = null) })
    pop = popover

    const commit = (icon: string): void => {
      value = icon
      drawTrigger()
      opts.onChange(icon)
      popover.close()
    }

    const search = popover.contentEl.createEl('input', {
      cls: 'pm-pop-field',
      attr: { placeholder: 'Search icons or paste an emoji', spellcheck: 'false' }
    })
    const clearRow = popover.contentEl.createDiv()
    const grid = popover.contentEl.createDiv('pm-icon-grid')
    const hint = popover.contentEl.createDiv({ cls: 'pm-icon-grid-hint' })

    const matches = (query: string): string[] => {
      const q = query.trim().toLowerCase()
      return q ? getIconIds().filter((id) => id.includes(q)) : getIconIds()
    }

    const renderGrid = (): void => {
      const query = search.value.trim()
      grid.empty()
      hint.empty()

      clearRow.empty()
      renderOptionRow(clearRow, {
        label: 'No icon',
        icon: 'ban',
        selected: !value,
        onPick: () => commit('')
      })

      if (isGlyphQuery(query)) {
        const cell = grid.createEl('button', { cls: 'pm-icon-cell pm-icon-cell--glyph', text: query })
        cell.toggleClass('pm-icon-cell--selected', query === value)
        cell.setAttribute('aria-label', `Use ${query}`)
        cell.addEventListener('click', () => commit(query))
      }

      const found = matches(query)
      for (const id of found.slice(0, GRID_LIMIT)) {
        const cell = grid.createEl('button', { cls: 'pm-icon-cell', attr: { 'aria-label': id } })
        cell.toggleClass('pm-icon-cell--selected', id === value)
        setIcon(cell, id)
        cell.addEventListener('click', () => commit(id))
      }

      if (found.length > GRID_LIMIT) {
        hint.setText(`Showing ${GRID_LIMIT} of ${found.length}. Keep typing to narrow.`)
      } else if (found.length === 0 && !isGlyphQuery(query)) {
        hint.setText('No icon matches that.')
      }
    }

    search.addEventListener('input', () => renderGrid())
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      const query = search.value.trim()
      if (isGlyphQuery(query)) commit(query)
      else if (query) {
        const first = matches(query)[0]
        if (first) commit(first)
      }
    })

    renderGrid()
    popover.open()
    search.focus()
  })
}
