import { Chip } from '../primitives/Chip'

export interface ProjectChipProps {
  title: string
  color: string
  /** Opens the project. Stops the click from reaching the row or card underneath. */
  onClick?: () => void
}

/** Which project something belongs to. The only way to render a project token. */
export function renderProjectChip(parent: HTMLElement, props: ProjectChipProps): Chip {
  const chip = new Chip(parent)
    .setLabel(props.title)
    .setVariant('outline')
    .setSize('sm')
    .setDot(true)
    .setColor(props.color)
  const onClick = props.onClick
  if (onClick) {
    chip.setTooltip(`Open ${props.title}`).onClick((e) => {
      e.stopPropagation()
      onClick()
    })
  }
  return chip
}
