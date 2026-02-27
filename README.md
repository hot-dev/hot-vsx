# Hot Language Support

Full language support for [Hot](https://hot.dev) — a functional, expression-based language for backend workflows.

## Features

- **Syntax Highlighting** — Keywords, types, flows, namespaces, strings, and more
- **Language Server** — Diagnostics, autocomplete, hover info, go-to-definition
- **Markdown Support** — Syntax highlighting in fenced code blocks

## Quick Start

1. Install the [Hot CLI](https://hot.dev/docs/getting-started)
2. Open a `.hot` file
3. The language server starts automatically

## Syntax Overview

```hot
::myapp::greeter ns

// Variables (no = sign)
greeting "Hello"

// Functions
greet fn (name: Str): Str {
  `${greeting}, ${name}!`
}

// Conditional flow
classify fn cond (x: Int): Str {
  lt(x, 0) => { "negative" }
  => { "positive" }
}

// Type with coercion
Date type { year: Int, month: Int, day: Int }

Date -> Str fn (d: Date): Str {
  `${d.year}-${d.month}-${d.day}`
}
```

## Commands

| Command | Description |
|---------|-------------|
| `Hot: Start Analyzer` | Start the LSP server |
| `Hot: Stop Analyzer` | Stop the LSP server |
| `Hot: Restart Analyzer` | Restart the LSP server |
| `Hot: Show Logs` | Open the output channel |
| `Hot: Create AI Hints` | Set up AI coding support (`AGENTS.md` + `.skills/`) |
| `Hot: Update Hot CLI` | Update the Hot CLI to the latest version |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `hot.lsp.enabled` | `true` | Enable the Language Server (requires Hot CLI) |
| `hot.lsp.commandPath` | `hot` | Path to the Hot CLI executable |
| `hot.lsp.extraArgs` | `[]` | Additional LSP server arguments |
| `hot.checkForUpdates` | `true` | Check for Hot CLI updates on startup (once per 24h) |

## Links

- [Hot Docs](https://hot.dev/docs)
- [Hot Language Reference](https://hot.dev/docs/language)
