# ADR 0005 — Korean and English presentation

Status: accepted for the unpublished 0.1.0 alpha update, 2026-10-24.

## Context

The product is packaged as a macOS host, React workspace and local Figma plugin.
Users need Korean and English controls and a workflow guide in each language.
Changing the interface language must not change captured source text, user-authored
names, annotations, review decisions, machine identifiers or export contracts.

## Decision

- Use explicit `ko` and `en` catalogs for product-owned presentation. English is
  the fallback for unsupported preferences. A first preferred language beginning
  with `ko` selects Korean before an explicit preference exists.
- Keep browser preference in `localStorage` under `fsb-locale`; storage failure
  leaves the current session usable. Set the document language for accessibility.
- The macOS host stores the same preference key in its own UserDefaults. It
  injects `window.__FSB_DESKTOP_LOCALE__` only into its trusted workspace. This
  preference takes precedence over the browser preference in the embedded view.
- The web selector posts `{locale}` through the `fsbLocale` handler. The host
  accepts only `ko`/`en` from the current trusted main workspace frame. Native
  changes dispatch `fsb-locale-change` with a validated locale string. Update
  presentation without reloading/remounting the editor or discarding drafts.
- The Figma plugin has an independent preference in `figma.clientStorage`, using
  bounded UI-to-main messages. Never persist the pairing token with preferences.
- Localize native controls, plugin controls, application labels and status
  messages. Preserve source content, stored diagnostics and unknown error details
  verbatim; local explanatory text may accompany these records. Display enum
  labels separately from stored enum values. MCP/JSON contracts stay stable.
- Ship `user-guide.ko.md` and `user-guide.en.md`, matching installation guides and
  README navigation. Include both Markdown guides and self-contained offline HTML
  in the app and release assets. The native User Guide opens the active language.
  Offline HTML remains escaped, script-free and without external resource loads.

## Acceptance

Both languages must cover each product surface. Switching language must preserve
unsaved input and stored revisions, survive normal restart, and keep source text
unchanged. Test preference precedence and catalog parity, browser workflows,
plugin message boundaries, native preference handling, packaged guide language
and artifact integrity. Verify installed app/menu synchronization and the native
Figma selector separately from unit/browser tests. Existing license/publication
and platform/access limitations remain unchanged.
