## Before you submit

This plugin is maintained by one person in their spare time with a specific design vision and strict code standards. Please read this before opening a PR.

**PRs without a linked issue are closed without review.** New features and non-trivial changes must be discussed in an issue first — no exceptions.

**AI-generated bulk PRs are closed immediately.** If your PR rewrites large chunks of existing code, adds generic boilerplate, or ignores the project style, it will be closed with no further explanation.

---

## What this PR does

<!-- One paragraph. What problem does it solve and why does it matter? -->

## Linked issue

Fixes #<!-- Issue number — required -->

## Checklist

- [ ] I discussed this change in an issue and got a thumbs-up before writing code.
- [ ] `npm run build` passes with zero errors.
- [ ] `npx eslint src/` passes with zero warnings — includes no inline styles, sentence-case UI text, no unnecessary non-null assertions.
- [ ] New UI follows the Quiet Architect design system (no emojis, no hard corners, no 1px dividers, no pure black text, depth via tonal stacking).
- [ ] New modals are created through `ModalFactory`, never instantiated directly.
- [ ] No `element.style.*` assignments — CSS classes only.
- [ ] No dynamic `await import()` — static imports only.
- [ ] Dates use `YYYY-MM-DD` format; UTC operations only (`T00:00:00Z`, `setUTCDate()`).
- [ ] This PR is focused on one logical change. Unrelated cleanup is in a separate PR.
