export interface SubView {
  render(): void
  /** Re-render from current in-memory data, preserving DOM/scroll/selection where possible. Falls back to render(). */
  refresh?(): void
  destroy?(): void
  handleKeyDown?(e: KeyboardEvent): void
}
