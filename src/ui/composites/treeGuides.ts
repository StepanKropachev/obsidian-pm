/**
 * One span per indent column; the last is this row's elbow. A `true` entry carries an
 * ancestor's line down past this row.
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
 * The child's elbow claims a new column, and the column this row sits in keeps its line
 * only while more siblings follow it. A root row has no column of its own.
 */
export function childTreeGuides(guides: boolean[], isLastChild: boolean): boolean[] {
  if (!guides.length) return [false]
  return [...guides.slice(0, -1), !isLastChild, false]
}
