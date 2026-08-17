/**
 * One span per indent column; the deepest is the elbow into this row's title. A `true`
 * entry means an ancestor at that column still has rows below it, so its line continues.
 */
export function renderTreeGuides(cell: HTMLElement, guides: boolean[] | null, isLastChild: boolean): void {
  if (!guides?.length) return
  const elbow = guides.length - 1
  for (let level = 0; level < guides.length; level++) {
    if (level !== elbow && !guides[level]) continue
    const cls = level === elbow ? 'pm-tree-guide pm-tree-guide--elbow' : 'pm-tree-guide'
    const guide = cell.createSpan({ cls })
    if (level === elbow && isLastChild) guide.addClass('pm-tree-guide--last')
    guide.style.setProperty('--level', String(level))
  }
}
