// Obsidian injects `activeDocument` / `activeWindow` as globals (aliases for the
// active workspace window's document/window). The plugin's `src/utils.ts` uses
// `activeDocument`; declare it so the CLI typecheck of that shared file resolves.
// The CLI never executes those DOM helpers.

declare const activeDocument: Document
declare const activeWindow: Window & typeof globalThis
