import { animate } from 'motion/mini'

const enterEase = [0.22, 1, 0.36, 1] as [number, number, number, number]
const moveEase = [0.2, 0, 0, 1] as [number, number, number, number]
const quickEase = 'easeOut'
const running = new WeakMap<Element, { stop: () => void }>()
let kanbanDragActive = false

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function run(el: HTMLElement, keyframes: Parameters<typeof animate>[1], options: Parameters<typeof animate>[2]): void {
  if (reducedMotion()) return
  running.get(el)?.stop()
  const controls = animate(el, keyframes, options)
  running.set(el, controls)
  void (async () => {
    try {
      await controls
    } finally {
      if (running.get(el) === controls) running.delete(el)
    }
  })()
}

export function setKanbanDragActive(active: boolean): void {
  kanbanDragActive = active
}

export function animateSurfaceIn(el: HTMLElement, index = 0): void {
  run(
    el,
    {
      transform: ['translateY(6px) scale(0.99)', 'translateY(0) scale(1)']
    },
    {
      delay: Math.min(index * 0.025, 0.2),
      duration: 0.22,
      ease: enterEase
    }
  )
}

export function bindLiftMotion(
  el: HTMLElement,
  opts: { y?: number; scale?: number; disabledDuringKanbanDrag?: boolean } = {}
): void {
  if (reducedMotion()) return
  const y = opts.y ?? -3
  const scale = opts.scale ?? 1.012

  el.addEventListener('mouseenter', () => {
    if (opts.disabledDuringKanbanDrag && kanbanDragActive) return
    if (el.classList.contains('pm-dragging')) return
    run(el, { opacity: 1, transform: `translateY(${y}px) scale(${scale})` }, { duration: 0.18, ease: quickEase })
  })

  el.addEventListener('mouseleave', () => {
    if (opts.disabledDuringKanbanDrag && kanbanDragActive) return
    if (el.classList.contains('pm-dragging')) return
    run(el, { opacity: 1, transform: 'translateY(0) scale(1)' }, { duration: 0.16, ease: quickEase })
  })
}

export function animateDragStart(el: HTMLElement): void {
  run(
    el,
    {
      opacity: 0.72,
      transform: 'translateY(-4px) scale(1.025)'
    },
    { duration: 0.12, ease: quickEase }
  )
}

export function animateDragEnd(el: HTMLElement): void {
  run(
    el,
    {
      opacity: 1,
      transform: 'translateY(0) scale(1)'
    },
    { duration: 0.2, ease: enterEase }
  )
}

export function snapshotCardRects(scope: HTMLElement): Map<HTMLElement, DOMRect> {
  const rects = new Map<HTMLElement, DOMRect>()
  if (reducedMotion()) return rects
  scope.querySelectorAll<HTMLElement>('.pm-kanban-card:not(.pm-kanban-card--dragging)').forEach((card) => {
    rects.set(card, card.getBoundingClientRect())
  })
  return rects
}

export function animateCardReorder(scope: HTMLElement, before: Map<HTMLElement, DOMRect>): void {
  if (reducedMotion() || before.size === 0) return

  scope.querySelectorAll<HTMLElement>('.pm-kanban-card:not(.pm-kanban-card--dragging)').forEach((card) => {
    const oldRect = before.get(card)
    if (!oldRect) return

    const newRect = card.getBoundingClientRect()
    const dx = oldRect.left - newRect.left
    const dy = oldRect.top - newRect.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return

    run(
      card,
      {
        transform: [`translate3d(${dx}px, ${dy}px, 0)`, 'translate3d(0, 0, 0)']
      },
      { duration: 0.2, ease: moveEase }
    )
  })
}

export function animateModalIn(el: HTMLElement): void {
  run(
    el,
    {
      opacity: [0, 1],
      transform: ['translateY(10px) scale(0.975)', 'translateY(0) scale(1)']
    },
    { duration: 0.24, ease: enterEase }
  )
}
