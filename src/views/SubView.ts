export interface SubView {
  render(): void
  destroy?(): void
  handleKeyDown?(e: KeyboardEvent): void
}
