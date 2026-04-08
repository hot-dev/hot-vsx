# CHANGE LOG

## [1.2.0] - 2026-04-06

- Triple-backtick template literal support (indent-aware templates)
- Syntax highlighting for property access (`user.name`), spread operator (`...`), and `meta` keyword
- Richer template expression highlighting (function calls, constants, pipe operator inside `${}`)
- Editor improvements: word-aware selection for hyphenated identifiers, bracket colorization, brace auto-indent, region folding

## [1.1.0] - 2026-02-19

- Triple-quote string support (Hot 1.1.0+)
- Fix `Go To Definition`
- `Hot: Create AI Hints` now delegates to `hot ai add` CLI command
- Add `Hot: Update Hot CLI` command with automatic update checking
- Display Hot CLI version in status bar tooltip (from LSP server info)
- Add `hot.checkForUpdates` setting (default: on, checks once per 24 hours)

## [1.0.1] - 2026-01-12

- Bug Fixes

## [1.0.0] - 2025-12-15

- Syntax Highlighting: Keywords, types, flows, namespaces, strings, and more
- Language Server Protocol (LSP): Diagnostics, autocomplete, hover info, go-to-definition
- Markdown Support: Syntax highlighting in fenced code blocks