import { Chip } from '../primitives/Chip'

export type DueUrgency = 'normal' | 'near' | 'overdue'

/** Orange when near, solid red when overdue. The caller formats the label. */
export function renderDueChip(parent: HTMLElement, label: string, urgency: DueUrgency, size: 'md' | 'sm' = 'md'): Chip {
  const chip = new Chip(parent).setLabel(label).setSize(size)
  if (urgency === 'near') {
    chip.setVariant('solid').setColor('var(--color-orange)')
  } else if (urgency === 'overdue') {
    chip.setVariant('solid').setColor('var(--color-red)').setStrong()
  }
  return chip
}
