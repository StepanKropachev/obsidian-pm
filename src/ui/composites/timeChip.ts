import { Chip } from '../primitives/Chip'

/** Logged/estimate hours chip; goes red solid when logged exceeds the estimate. */
export function renderTimeChip(
  parent: HTMLElement,
  logged: number,
  estimate: number,
  size: 'md' | 'sm' = 'md'
): Chip | null {
  if (logged <= 0 && estimate <= 0) return null
  const label = estimate > 0 ? `${logged}/${estimate}h` : `${logged}h`
  const chip = new Chip(parent).setLabel(label).setSize(size)
  if (estimate > 0 && logged > estimate) {
    chip.setVariant('solid').setColor('var(--color-red)').setStrong()
  }
  return chip
}
