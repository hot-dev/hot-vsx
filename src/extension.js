const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { execFile, spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

/** @type {LanguageClient | null} */
let client = null;
let channel = null;
const CHANNEL_NAME = 'Hot Language Server';
let statusBarItem = null;
let isRunning = false;
let extVersion = 'unknown';
let runningVersion = null;
let installedVersion = null;

/** @type {vscode.ExtensionContext | null} */
let extensionContext = null;

const VERSION_CHECK_URL = 'https://get.hot.dev/releases/latest/version.txt';
const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// REPL terminal management
/** @type {vscode.Terminal | null} */
let replTerminal = null;
const REPL_TERMINAL_NAME = 'Hot REPL';

// Eval result decorations
/** @type {vscode.TextEditorDecorationType} */
let evalResultDecorationType = null;

// Output channel for eval results
/** @type {vscode.OutputChannel | null} */
let evalOutputChannel = null;
const EVAL_CHANNEL_NAME = 'Hot Eval';

/**
 * Format a Hot document using the `hot fmt` command
 * @param {vscode.TextDocument} document
 * @returns {Promise<vscode.TextEdit[]>}
 */
async function formatHotDocument(document) {
    const config = vscode.workspace.getConfiguration('hot');
    const commandPath = config.get('lsp.commandPath', 'hot');
    const content = document.getText();

    return new Promise((resolve, reject) => {
        // Write content to a temp file with .hot extension
        const tmpDir = require('os').tmpdir();
        const tmpFile = path.join(tmpDir, `hot-fmt-${Date.now()}.hot`);

        fs.writeFileSync(tmpFile, content, 'utf8');

        execFile(commandPath, ['fmt', tmpFile], { timeout: 10000 }, (error, stdout, stderr) => {
            try {
                if (error) {
                    // Check if it's just a CHAR-AUDIT warning (formatter still produces output)
                    if (stderr && stderr.includes('CHAR-AUDIT')) {
                        // Read the possibly formatted file
                        if (fs.existsSync(tmpFile)) {
                            const formatted = fs.readFileSync(tmpFile, 'utf8');
                            fs.unlinkSync(tmpFile);

                            if (formatted !== content) {
                                const fullRange = new vscode.Range(
                                    document.positionAt(0),
                                    document.positionAt(content.length)
                                );
                                resolve([vscode.TextEdit.replace(fullRange, formatted)]);
                                return;
                            }
                        }
                    }

                    if (channel) {
                        channel.appendLine(`[hot] Format error: ${error.message}`);
                        if (stderr) channel.appendLine(`[hot] stderr: ${stderr}`);
                    }
                    // Don't reject - just return empty edits
                    resolve([]);
                    return;
                }

                // Read the formatted file
                const formatted = fs.readFileSync(tmpFile, 'utf8');
                fs.unlinkSync(tmpFile);

                if (formatted !== content) {
                    const fullRange = new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(content.length)
                    );
                    resolve([vscode.TextEdit.replace(fullRange, formatted)]);
                } else {
                    resolve([]);
                }
            } catch (e) {
                // Clean up temp file if it exists
                try { fs.unlinkSync(tmpFile); } catch (_) {}
                if (channel) channel.appendLine(`[hot] Format exception: ${e.message}`);
                resolve([]);
            }
        });
    });
}

// ============================================================================
// REPL Functions
// ============================================================================

/**
 * Start the Hot REPL in a VS Code terminal
 */
function startRepl() {
    const config = vscode.workspace.getConfiguration('hot');
    const commandPath = config.get('lsp.commandPath', 'hot');

    // Check if REPL terminal already exists and is still alive
    if (replTerminal) {
        // Try to show it - if it was closed, this will fail silently
        replTerminal.show();
        return replTerminal;
    }

    // Create a new terminal for the REPL
    replTerminal = vscode.window.createTerminal({
        name: REPL_TERMINAL_NAME,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        iconPath: new vscode.ThemeIcon('terminal')
    });

    // Send the repl command
    replTerminal.sendText(`${commandPath} repl`);
    replTerminal.show();

    // Track terminal closure
    const disposable = vscode.window.onDidCloseTerminal(terminal => {
        if (terminal === replTerminal) {
            replTerminal = null;
            disposable.dispose();
        }
    });

    return replTerminal;
}

/**
 * Send text to the REPL terminal
 * @param {string} text - The text to send
 */
function sendToRepl(text) {
    if (!replTerminal) {
        startRepl();
        // Wait a bit for the REPL to start before sending
        setTimeout(() => {
            if (replTerminal) {
                replTerminal.sendText(text);
            }
        }, 1500);
    } else {
        replTerminal.show();
        replTerminal.sendText(text);
    }
}

/**
 * Get the selected text or the current line from the active editor
 * @returns {{ text: string, range: vscode.Range } | null}
 */
function getSelectedTextOrLine() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const selection = editor.selection;

    if (!selection.isEmpty) {
        // Return selected text
        return {
            text: editor.document.getText(selection),
            range: new vscode.Range(selection.start, selection.end)
        };
    } else {
        // Return current line
        const line = editor.document.lineAt(selection.active.line);
        return {
            text: line.text.trim(),
            range: line.range
        };
    }
}

// ============================================================================
// Eval Functions
// ============================================================================

/**
 * Create or get the eval result decoration type
 * @returns {vscode.TextEditorDecorationType}
 */
function getEvalDecorationType() {
    if (!evalResultDecorationType) {
        evalResultDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 1em',
                fontStyle: 'italic'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
    }
    return evalResultDecorationType;
}

/**
 * Evaluate Hot code and return the result
 * Uses LSP if available, falls back to CLI
 * @param {string} code - The Hot code to evaluate
 * @param {string} [namespace] - Optional namespace context
 * @param {string} [fileUri] - Optional file URI for context
 * @returns {Promise<{ success: boolean, result: string, error?: string, namespace?: string, stdout?: string }>}
 */
async function evaluateHotCode(code, namespace, fileUri) {
    // Try LSP first if client is running
    if (client && isRunning) {
        try {
            const result = await client.sendRequest('hot/eval', {
                code: code,
                namespace: namespace || null,
                fileUri: fileUri || null
            });
            return {
                success: result.success,
                result: result.result,
                error: result.error,
                namespace: result.namespace,
                stdout: result.stdout
            };
        } catch (lspError) {
            // Log LSP error and fall back to CLI
            if (channel) {
                channel.appendLine(`[hot] LSP eval failed, falling back to CLI: ${lspError.message}`);
            }
        }
    }

    // Fall back to CLI
    const config = vscode.workspace.getConfiguration('hot');
    const commandPath = config.get('lsp.commandPath', 'hot');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    return new Promise((resolve) => {
        execFile(commandPath, ['eval', code], {
            timeout: 30000,
            cwd: cwd
        }, (error, stdout, stderr) => {
            if (error) {
                resolve({
                    success: false,
                    result: '',
                    error: stderr || error.message
                });
            } else {
                resolve({
                    success: true,
                    result: stdout.trim()
                });
            }
        });
    });
}

/**
 * Display eval result inline as a decoration
 * @param {vscode.TextEditor} editor
 * @param {vscode.Range} range
 * @param {string} result
 * @param {boolean} isError
 * @param {string} [stdout] - Captured stdout output
 */
function showInlineResult(editor, range, result, isError, stdout) {
    const decorationType = getEvalDecorationType();

    // Combine stdout and result for display
    let displayResult = result;
    if (stdout && stdout.trim()) {
        // If there's stdout, show it before the result
        displayResult = stdout.trim() + (result && result !== 'null' ? ` => ${result}` : '');
    }

    // Truncate long results
    const maxLen = 80;
    displayResult = displayResult.replace(/\n/g, ' ↵ ');
    if (displayResult.length > maxLen) {
        displayResult = displayResult.substring(0, maxLen) + '…';
    }

    const decoration = {
        range: new vscode.Range(range.end.line, range.end.character, range.end.line, range.end.character),
        renderOptions: {
            after: {
                contentText: stdout ? displayResult : `=> ${displayResult}`,
                color: isError ? new vscode.ThemeColor('errorForeground') : new vscode.ThemeColor('terminal.ansiGreen'),
                fontStyle: 'italic'
            }
        }
    };

    editor.setDecorations(decorationType, [decoration]);

    // Clear decoration after a delay (or on next edit)
    const disposable = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === editor.document) {
            editor.setDecorations(decorationType, []);
            disposable.dispose();
        }
    });

    // Also clear after 10 seconds
    setTimeout(() => {
        editor.setDecorations(decorationType, []);
        disposable.dispose();
    }, 10000);
}

/**
 * Get or create the eval output channel
 * @returns {vscode.OutputChannel}
 */
function getEvalOutputChannel() {
    if (!evalOutputChannel) {
        evalOutputChannel = vscode.window.createOutputChannel(EVAL_CHANNEL_NAME);
    }
    return evalOutputChannel;
}

/**
 * Show eval result in output channel
 * @param {string} code
 * @param {string} result
 * @param {boolean} isError
 * @param {string} [stdout] - Captured stdout output
 */
function showResultInOutputChannel(code, result, isError, stdout) {
    const output = getEvalOutputChannel();
    const timestamp = new Date().toLocaleTimeString();

    output.appendLine(`[${timestamp}] Evaluating:`);
    output.appendLine(`  ${code.split('\n').join('\n  ')}`);
    output.appendLine('');
    if (stdout && stdout.trim()) {
        output.appendLine(`Output:`);
        output.appendLine(`  ${stdout.trim().split('\n').join('\n  ')}`);
        output.appendLine('');
    }
    if (isError) {
        output.appendLine(`Error: ${result}`);
    } else {
        output.appendLine(`=> ${result}`);
    }
    output.appendLine('─'.repeat(60));
    output.appendLine('');
}

/**
 * Extract namespace declaration from a Hot document
 * @param {vscode.TextDocument} document
 * @returns {string | null}
 */
function extractNamespaceFromDocument(document) {
    const text = document.getText();
    const lines = text.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        // Match patterns like "::namespace::path ns" or "::namespace::path #{"doc": ...} ns"
        if (trimmed.startsWith('::') && (trimmed.endsWith(' ns') || trimmed.includes('#'))) {
            // Extract the namespace part
            const nsEnd = trimmed.indexOf('#') !== -1 ? trimmed.indexOf('#') : trimmed.lastIndexOf(' ns');
            if (nsEnd > 0) {
                const ns = trimmed.substring(0, nsEnd).trim();
                if (ns.startsWith('::')) {
                    return ns;
                }
            }
        }
    }

    return null;
}

/**
 * Try to find the top-level form at cursor position
 * This is a simplified version - a full implementation would need proper parsing
 * @param {vscode.TextEditor} editor
 * @returns {{ text: string, range: vscode.Range } | null}
 */
function getTopLevelForm(editor) {
    const document = editor.document;
    const position = editor.selection.active;

    // Simple heuristic: find the form by looking for balanced braces/parens
    // Start from current line and expand outward

    let startLine = position.line;
    let endLine = position.line;

    // Find the start: go up until we hit a line that starts a definition
    // (a line that starts with an identifier, not indented)
    for (let i = position.line; i >= 0; i--) {
        const line = document.lineAt(i);
        const text = line.text;

        // Skip empty lines and comments
        if (text.trim() === '' || text.trim().startsWith('//')) {
            continue;
        }

        // If line starts at column 0 with a word character or ::, this is likely a top-level form start
        if (/^[a-zA-Z_:]/u.test(text)) {
            startLine = i;
            break;
        }
    }

    // Find the end: look for balanced braces
    let braceCount = 0;
    let parenCount = 0;
    let foundBody = false;

    for (let i = startLine; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        for (const ch of text) {
            if (ch === '{') { braceCount++; foundBody = true; }
            if (ch === '}') { braceCount--; }
            if (ch === '(') { parenCount++; }
            if (ch === ')') { parenCount--; }
        }

        endLine = i;

        // If we've found a body and braces are balanced, we're done
        if (foundBody && braceCount === 0 && parenCount <= 0) {
            break;
        }

        // Also stop at the next top-level definition
        if (i > startLine && /^[a-zA-Z_:]/u.test(text) && text.trim() !== '' && !text.trim().startsWith('//')) {
            endLine = i - 1;
            break;
        }
    }

    const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );

    const text = document.getText(range).trim();

    // Don't return namespace declarations
    if (text.endsWith(' ns') || text.match(/^::[^\s]+ ns$/)) {
        return null;
    }

    return { text, range };
}

function buildTooltip() {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;
    const state = isRunning ? 'Running' : 'Stopped';
    md.appendMarkdown(`**Hot Analyzer** — ${state}  \n`);
    md.appendMarkdown(`Extension: \`${extVersion}\`  \n`);
    if (runningVersion) {
        md.appendMarkdown(`Hot CLI: \`${runningVersion}\``);
        if (installedVersion && installedVersion !== runningVersion) {
            md.appendMarkdown(` (restart needed — installed: \`${installedVersion}\`)`);
        }
        md.appendMarkdown('  \n');
    } else if (installedVersion) {
        md.appendMarkdown(`Hot CLI: \`${installedVersion}\`  \n`);
    }
    md.appendMarkdown('\n');
    if (isRunning) {
        md.appendMarkdown('[$(debug-restart) Restart](command:hot.restartAnalyzer)  \n');
        md.appendMarkdown('[$(debug-stop) Stop](command:hot.stopAnalyzer)  \n');
    } else {
        md.appendMarkdown('[$(play) Start](command:hot.startAnalyzer)  \n');
    }
    md.appendMarkdown('[$(output) Open Logs](command:hot.showLogs)');
    return md;
}

function updateStatus(text, tooltip, command) {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
        statusBarItem.name = 'hot-analyzer';
        statusBarItem.command = 'hot.restartAnalyzer';
        statusBarItem.show();
    }
    statusBarItem.text = text;
    statusBarItem.tooltip = tooltip;
    if (command) statusBarItem.command = command;
}

function startClient() {
    if (client) {
        return;
    }

    const config = vscode.workspace.getConfiguration('hot');

    // Check if LSP is explicitly disabled
    const lspEnabled = config.get('lsp.enabled', true);
    if (!lspEnabled) {
        if (channel) {
            channel.appendLine('[hot] LSP is disabled via settings (hot.lsp.enabled = false)');
        }
        updateStatus('$(circle-slash) hot', buildTooltip(), 'hot.startAnalyzer');
        return;
    }

    // For multi-root workspaces, only start ONE client for the first workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    if (workspaceFolders.length === 0) {
        if (channel) {
            channel.appendLine('[hot] No workspace folders found, cannot start LSP');
        }
        return;
    }

    // Use the FIRST workspace folder as the primary one
    const primaryWorkspace = workspaceFolders[0].uri.fsPath;

    channel = channel || vscode.window.createOutputChannel(CHANNEL_NAME);
    channel.appendLine(`[hot] Starting LSP for primary workspace: ${primaryWorkspace}`);

    const commandPath = config.get('lsp.commandPath', 'hot');
    channel.appendLine(`[hot] Total workspace folders: ${workspaceFolders.length}`);

    /** @type {string[]} */
    const extraArgs = config.get('lsp.extraArgs', []);

    if (commandPath.includes(' ')) {
        const msg = 'hot.lsp.commandPath should be a single executable (e.g., "hot" or "cargo"), not include arguments. Use hot.lsp.extraArgs for additional args.';
        channel.appendLine(`[hot] Warning: ${msg} Current: ${commandPath}`);
        vscode.window.showWarningMessage(msg);
    }

    // Place extraArgs BEFORE subcommand so cargo works: cargo <extraArgs> -- lsp ...
    const baseArgs = [...extraArgs, 'lsp'];
    const serverOptions = {
        command: commandPath,
        args: baseArgs,
        transport: TransportKind.stdio,
        options: { cwd: vscode.workspace.rootPath || process.cwd() }
    };

    channel.appendLine(`[hot] Launching LSP: ${serverOptions.command} ${serverOptions.args.join(' ')}`);

    const clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'hot' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.hot')
        },
        outputChannel: channel,
        // CRITICAL: Set workspaceFolder to prevent multiple clients in multi-root workspaces
        workspaceFolder: workspaceFolders[0]
    };

    client = new LanguageClient(
        'hotLanguageServer',
        'Hot Language Server',
        serverOptions,
        clientOptions
    );

    isRunning = false;
    updateStatus('$(sync~spin) hot', buildTooltip(), 'hot.restartAnalyzer');

    client.onDidChangeState((e) => {
        // 1 = Starting, 2 = Running, 3 = Stopped
        if (e.newState === 2) {
            isRunning = true;
            try {
                const serverInfo = client.initializeResult?.serverInfo;
                if (serverInfo?.version) {
                    runningVersion = serverInfo.version;
                }
            } catch (_) {}
            updateStatus('$(check) hot', buildTooltip(), 'hot.restartAnalyzer');
        } else if (e.newState === 1) {
            isRunning = false;
            updateStatus('$(sync~spin) hot', buildTooltip(), 'hot.restartAnalyzer');
        } else {
            isRunning = false;
            runningVersion = null;
            updateStatus('$(circle-slash) hot', buildTooltip(), 'hot.startAnalyzer');
        }
    });

    client.start();
}

/**
 * Called when the extension is activated
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    extensionContext = context;
    try {
        extVersion = context && context.extension && context.extension.packageJSON && context.extension.packageJSON.version || extVersion;
    } catch (e) {}

    fetchInstalledVersion();
    checkForUpdates();

    context.subscriptions.push(vscode.commands.registerCommand('hot.startAnalyzer', () => {
        startClient();
        if (channel) channel.show(true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.stopAnalyzer', async () => {
        if (client) {
            const c = client; client = null;
            isRunning = false;
            updateStatus('$(sync~spin) hot', buildTooltip(), 'hot.startAnalyzer');
            await c.stop().catch(() => {});
            updateStatus('$(circle-slash) hot', buildTooltip(), 'hot.startAnalyzer');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.restartAnalyzer', async () => {
        if (client) {
            const c = client; client = null;
            updateStatus('$(sync~spin) hot', buildTooltip(), 'hot.restartAnalyzer');
            await c.stop().catch(() => {});
        }
        startClient();
        if (channel) channel.show(true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.openSettings', async () => {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'hot');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.showLogs', async () => {
        channel = channel || vscode.window.createOutputChannel(CHANNEL_NAME);
        channel.show(true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.createAIHints', async () => {
        await createAIHints();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.updateHot', () => {
        updateHot();
    }));

    // ========================================================================
    // REPL Commands
    // ========================================================================

    context.subscriptions.push(vscode.commands.registerCommand('hot.startRepl', () => {
        startRepl();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.sendToRepl', () => {
        const selection = getSelectedTextOrLine();
        if (selection && selection.text) {
            sendToRepl(selection.text);
        } else {
            vscode.window.showWarningMessage('No text selected or cursor not on a line with content.');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.sendFileToRepl', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'hot') {
            vscode.window.showWarningMessage('No Hot file is currently active.');
            return;
        }

        // Get all the file content
        const content = editor.document.getText();
        sendToRepl(content);
    }));

    // ========================================================================
    // Eval Commands
    // ========================================================================

    context.subscriptions.push(vscode.commands.registerCommand('hot.evalSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        const selection = getSelectedTextOrLine();
        if (!selection || !selection.text) {
            vscode.window.showWarningMessage('No text selected or cursor not on a line with content.');
            return;
        }

        // Get file context for LSP eval
        const fileUri = editor.document.uri.toString();
        const namespace = extractNamespaceFromDocument(editor.document);

        // Show progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Evaluating...',
            cancellable: false
        }, async () => {
            const result = await evaluateHotCode(selection.text, namespace, fileUri);

            // Show inline result (with captured stdout)
            showInlineResult(editor, selection.range, result.success ? result.result : result.error, !result.success, result.stdout);

            // Also log to output channel
            showResultInOutputChannel(selection.text, result.success ? result.result : result.error, !result.success, result.stdout);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.evalTopLevelForm', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'hot') {
            vscode.window.showWarningMessage('No Hot file is currently active.');
            return;
        }

        const form = getTopLevelForm(editor);
        if (!form || !form.text) {
            vscode.window.showWarningMessage('Could not find a top-level form at cursor position.');
            return;
        }

        // Get file context for LSP eval
        const fileUri = editor.document.uri.toString();
        const namespace = extractNamespaceFromDocument(editor.document);

        // Show progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Evaluating...',
            cancellable: false
        }, async () => {
            const result = await evaluateHotCode(form.text, namespace, fileUri);

            // Show inline result (with captured stdout)
            showInlineResult(editor, form.range, result.success ? result.result : result.error, !result.success, result.stdout);

            // Also log to output channel
            showResultInOutputChannel(form.text, result.success ? result.result : result.error, !result.success, result.stdout);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.resetReplSession', async () => {
        if (client && isRunning) {
            try {
                await client.sendRequest('hot/resetRepl', {});
                vscode.window.showInformationMessage('Hot REPL session reset.');
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to reset REPL session: ${e.message}`);
            }
        } else {
            vscode.window.showWarningMessage('Hot analyzer is not running.');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.evalToOutputPanel', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        const selection = getSelectedTextOrLine();
        if (!selection || !selection.text) {
            vscode.window.showWarningMessage('No text selected or cursor not on a line with content.');
            return;
        }

        const output = getEvalOutputChannel();
        output.show(true);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Evaluating...',
            cancellable: false
        }, async () => {
            const result = await evaluateHotCode(selection.text);
            showResultInOutputChannel(selection.text, result.success ? result.result : result.error, !result.success, result.stdout);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.clearEvalDecorations', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && evalResultDecorationType) {
            editor.setDecorations(evalResultDecorationType, []);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('hot.showEvalOutput', () => {
        getEvalOutputChannel().show(true);
    }));

    // Register document formatting provider for Hot files
    // This enables format-on-save when the user has it configured
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('hot', {
            async provideDocumentFormattingEdits(document) {
                return formatHotDocument(document);
            }
        })
    );

    // Register a command to manually format the current Hot document
    context.subscriptions.push(vscode.commands.registerCommand('hot.formatDocument', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'hot') {
            vscode.window.showWarningMessage('No Hot file is currently active.');
            return;
        }

        const edits = await formatHotDocument(editor.document);
        if (edits.length > 0) {
            const edit = new vscode.WorkspaceEdit();
            edits.forEach(e => edit.replace(editor.document.uri, e.range, e.newText));
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('Hot file formatted.');
        } else {
            vscode.window.showInformationMessage('File already formatted.');
        }
    }));

    // Add settings gear menu via status bar item command override
    updateStatus('$(circle-slash) hot', buildTooltip(), 'hot.openSettings');

    // Auto-start on activation; will no-op if already running
    startClient();
}

/**
 * Called when the extension is deactivated
 */
async function deactivate() {
    if (client) {
        const c = client;
        client = null;
        isRunning = false;
        updateStatus('$(sync~spin) hot', buildTooltip(), 'hot.startAnalyzer');
        await c.stop().catch(() => {});
    }
    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = null;
    }
    if (replTerminal) {
        replTerminal.dispose();
        replTerminal = null;
    }
    if (evalResultDecorationType) {
        evalResultDecorationType.dispose();
        evalResultDecorationType = null;
    }
    if (evalOutputChannel) {
        evalOutputChannel.dispose();
        evalOutputChannel = null;
    }
}

/**
 * Create AI coding support files by invoking `hot ai add`.
 * Delegates to the CLI which creates AGENTS.md and .skills/hot-language/.
 */
async function createAIHints() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
        return;
    }

    const config = vscode.workspace.getConfiguration('hot');
    const commandPath = config.get('lsp.commandPath', 'hot');
    const cwd = workspaceFolders[0].uri.fsPath;

    return new Promise((resolve) => {
        execFile(commandPath, ['ai', 'add'], { timeout: 30000, cwd }, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Failed to create AI hints: ${stderr || error.message}`);
            } else {
                const output = (stdout || '').trim();
                vscode.window.showInformationMessage(output || 'AI coding support is up to date.');
            }
            resolve();
        });
    });

}

/**
 * Fetch the installed CLI version by running `hot version`.
 * Parses output like "hot 0.4.0 (abc1234)" into "0.4.0".
 */
function fetchInstalledVersion() {
    const config = vscode.workspace.getConfiguration('hot');
    const commandPath = config.get('lsp.commandPath', 'hot');

    execFile(commandPath, ['version'], { timeout: 5000 }, (error, stdout) => {
        if (error) return;
        const match = (stdout || '').match(/^hot\s+(\S+)/);
        if (match) {
            installedVersion = match[1];
            updateStatus(
                statusBarItem?.text || '$(circle-slash) hot',
                buildTooltip(),
                statusBarItem?.command || 'hot.openSettings'
            );
        }
    });
}

/**
 * Compare two semver version strings. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b.
 */
function compareSemver(a, b) {
    const pa = a.replace(/^v/, '').split(/[-.]/).map(x => parseInt(x, 10) || 0);
    const pb = b.replace(/^v/, '').split(/[-.]/).map(x => parseInt(x, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na < nb) return -1;
        if (na > nb) return 1;
    }
    return 0;
}

/**
 * Check get.hot.dev for the latest version and notify the user if an update is available.
 * Rate-limited to once per 24 hours using extension globalState.
 */
function checkForUpdates() {
    const config = vscode.workspace.getConfiguration('hot');
    if (!config.get('checkForUpdates', true)) return;

    const lastCheck = extensionContext?.globalState.get('hotLastUpdateCheck', 0);
    if (Date.now() - lastCheck < VERSION_CHECK_INTERVAL_MS) return;

    const waitForVersion = () => {
        if (!installedVersion) {
            setTimeout(waitForVersion, 500);
            return;
        }
        doVersionCheck();
    };

    // Wait briefly for fetchInstalledVersion to complete
    setTimeout(waitForVersion, 1000);
}

function doVersionCheck() {
    https.get(VERSION_CHECK_URL, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            extensionContext?.globalState.update('hotLastUpdateCheck', Date.now());
            const latestVersion = data.trim();
            if (!latestVersion || !installedVersion) return;

            if (compareSemver(installedVersion, latestVersion) < 0) {
                vscode.window.showInformationMessage(
                    `Hot v${latestVersion} is available (current: v${installedVersion})`,
                    'Update'
                ).then((choice) => {
                    if (choice === 'Update') {
                        vscode.commands.executeCommand('hot.updateHot');
                    }
                });
            }
        });
    }).on('error', () => {});
}

/**
 * Run `hot update` in a terminal, then restart the analyzer.
 */
function updateHot() {
    const config = vscode.workspace.getConfiguration('hot');
    const commandPath = config.get('lsp.commandPath', 'hot');

    const terminal = vscode.window.createTerminal({
        name: 'Hot Update',
        iconPath: new vscode.ThemeIcon('cloud-download')
    });
    terminal.sendText(`${commandPath} update`);
    terminal.show();

    const disposable = vscode.window.onDidCloseTerminal((t) => {
        if (t === terminal) {
            disposable.dispose();
            installedVersion = null;
            fetchInstalledVersion();
            vscode.commands.executeCommand('hot.restartAnalyzer');
        }
    });
}

module.exports = {
    activate,
    deactivate
};
