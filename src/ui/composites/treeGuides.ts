/**
 * One span per indent column; the deepest is the elbow into this row's title, and its
 * entry is unused. A `true` entry means the row's ancestor in that column still has
 * siblings below it, so its line carries down past this row.
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

/**
 * The guides a row's children get. A child's elbow claims a column of its own, and the
 * column this row sits in carries a line down only while more siblings follow it. A row
 * with no guides is a root and has no column, so its children start at their own elbow.
 */
export function childTreeGuides(guides: boolean[], isLastChild: boolean): boolean[] {
  if (!guides.length) return [false]
  return [...guides.slice(0, -1), !isLastChild, false]
}
