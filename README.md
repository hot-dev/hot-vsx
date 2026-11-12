# Hot Language Support

Full language support for [Hot](https://hot.dev) — a functional, expression-based language for backend workflows.

## Features

- **Syntax Highlighting** — Keywords, types, flows, namespaces, strings, and more
- **Language Server** — Diagnostics, autocomplete, hover info, go-to-definition, references, rename, the Outline, semantic highlighting, formatting
- **Evaluation** — Run a selection or top-level form and see the result inline, or send code to a REPL
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

// Constraints
Age type { years: Int }
where gte(%.years, 0)
```

## Commands

| Command | Description |
|---------|-------------|
| `Hot: Start Analyzer` | Start the LSP server |
| `Hot: Stop Analyzer` | Stop the LSP server |
| `Hot: Restart Analyzer` | Restart the LSP server |
| `Hot: Open Settings` | Open the Hot settings |
| `Hot: Show Logs` | Open the output channel |
| `Hot: Format Document` | Format the current file |
| `Hot: Evaluate Selection` | Evaluate the selection or current line (`Cmd/Ctrl+Enter`) |
| `Hot: Evaluate Top-Level Form` | Evaluate the form at the cursor (`Cmd/Ctrl+Shift+Enter`) |
| `Hot: Evaluate to Output Panel` | Evaluate the selection and show the result in the output panel |
| `Hot: Show Eval Output` | Open the eval output panel |
| `Hot: Clear Eval Results` | Clear the inline result (`Escape`) |
| `Hot: Start REPL` | Open a REPL in a terminal |
| `Hot: Send Selection to REPL` | Send the selection or current line to the REPL (`Alt+Enter`) |
| `Hot: Send File to REPL` | Send the current file to the REPL |
| `Hot: Reset REPL Session` | Clear what evaluation has defined so far |
| `Hot: Create AI Coding Hints` | Set up AI coding support (`AGENTS.md` + `.skills/`) |
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
