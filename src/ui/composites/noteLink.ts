export interface NoteLinkProps {
  label: string
  /** The note the link stands for, kept in `data-href` for Obsidian's link handling. */
  path: string
  /** What activating the link opens. There is no href, so click and Enter/Space both land here. */
  open: () => void
  cls?: string
}

/** A link to a note the plugin draws itself: a task's dependencies, its subtasks. */
export function renderNoteLink(parent: HTMLElement, props: NoteLinkProps): HTMLAnchorElement {
  const el = parent.createEl('a', {
    cls: props.cls ? `pm-note-link internal-link ${props.cls}` : 'pm-note-link internal-link',
    text: props.label,
    attr: { 'data-href': props.path, role: 'link', tabindex: '0' }
  })
  el.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    props.open()
  })
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    props.open()
  })
  return el
}
