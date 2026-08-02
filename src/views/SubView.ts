export interface SubView {
  render(): void
  /** Re-render in place, keeping scroll and selection. Falls back to render(). */
  refresh?(): void
  destroy?(): void
  handleKeyDown?(e: KeyboardEvent): void
}
