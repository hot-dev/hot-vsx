# CHANGE LOG

## [1.3.0] - 2026-11-04

For Hot 3.0.

- Syntax highlighting for the `where` constraint keyword (Hot 3.0+)
- `Hot: Evaluate Top-Level Form` finds the whole form: a name with its `meta` and `fn` on later lines, a `where` after a closing `}`, and signatures that span lines. Braces in strings and comments no longer count
- `true`, `false` and `null` highlight as constants
- Names that start with a keyword, such as `type-name` and `do-request`, highlight as one name
- `/* */` block comments, including `Toggle Block Comment`
- Nested `{}` no longer end a `meta` block or a `${}` expression early, and templates can nest
- `x ::hot::math/add(1)` no longer reads `x` as a map key, and `::a/Type` highlights as a type
- Send Selection and Send File to REPL work for code that spans lines
- Compile errors from eval no longer show terminal color codes
- Escape only clears an eval result while one is showing, so it closes suggestions and multiple cursors again
- The language server is the only formatter, so format-on-save no longer asks which to use. The CLI formats when `hot.lsp.enabled` is off
- The extension activates for Hot files and projects, not every window
- The status bar shows a stopped analyzer as stopped, and `Hot: Start Analyzer` works after a failed start
- A `.hot` file opened without a folder gets the language server
- The update check no longer polls forever when the Hot CLI isn't installed
- `Hot: Update Hot CLI` restarts the analyzer when the update ends, and a CLI path with spaces works
- Requires VS Code 1.82, as the language client already did

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