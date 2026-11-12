// Reads Hot source text without parsing it. Nothing here depends on VS Code, so
// the tests can run it directly.

const NAME = '[\\p{L}_$][\\p{L}\\p{N}_$-]*';

/** A line that holds only a name: its value is on a later line. */
const NAME_ONLY = new RegExp(`^${NAME}\\s*(?://.*)?$`, 'u');

/** A name with its `meta` on the same line: its value is still to come. */
const NAME_WITH_META = new RegExp(`^${NAME}\\s+meta\\s*[{[]`, 'u');

const META = /^meta\s*[{[]/u;

/** Keywords that open a value, so they can't start a new top-level form. */
const VALUE_KEYWORD = /^(?:fn|type|enum|lazy|do|serial|parallel|cond-all|cond|match-all|match)(?![\p{L}\p{N}_$-])/u;

const FORM_START = /^(?:::|[\p{L}_$])/u;

const WHERE = /^\s*where(?![\p{L}\p{N}_$?!-])/u;

const NAMESPACE = /^(::\S+)\s+(?:meta\b.*\s)?ns(?![\p{L}\p{N}_$-])/u;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Advance `stack` over one line. Each entry is an open bracket, string,
 * template or block comment, so an empty stack means the line ended at the top
 * level. Returns where the line first came back to the top level, or -1.
 * @param {string} text
 * @param {string[]} stack
 * @returns {number}
 */
function scanLine(text, stack) {
    let i = 0;
    let closedAt = -1;
    while (i < text.length) {
        const mode = stack.length > 0 ? stack[stack.length - 1] : 'code';
        const rest = (s) => text.startsWith(s, i);

        if (mode === 'code') {
            if (rest('//')) return closedAt;
            if (rest('/*')) { stack.push('block'); i += 2; continue; }
            if (rest('"""')) { stack.push('tripleString'); i += 3; continue; }
            if (rest('"')) { stack.push('string'); i += 1; continue; }
            if (rest('```')) { stack.push('tripleTemplate'); i += 3; continue; }
            if (rest('`')) { stack.push('template'); i += 1; continue; }
            const ch = text[i];
            if (ch === '{' || ch === '[' || ch === '(') stack.push('code');
            if ((ch === '}' || ch === ']' || ch === ')') && stack.length > 0) {
                stack.pop();
                if (stack.length === 0 && closedAt === -1) closedAt = i + 1;
            }
            i += 1;
            continue;
        }

        if (mode === 'block') {
            if (rest('*/')) { stack.pop(); i += 2; } else { i += 1; }
            continue;
        }

        // A block string and a block template have no escapes.
        if (text[i] === '\\' && (mode === 'string' || mode === 'template')) { i += 2; continue; }

        if (mode === 'string' && rest('"')) { stack.pop(); i += 1; continue; }
        if (mode === 'tripleString' && rest('"""')) { stack.pop(); i += 3; continue; }
        if (mode === 'template' && rest('`')) { stack.pop(); i += 1; continue; }
        if (mode === 'tripleTemplate' && rest('```')) { stack.pop(); i += 3; continue; }
        if ((mode === 'template' || mode === 'tripleTemplate') && rest('${')) {
            stack.push('code');
            i += 2;
            continue;
        }
        i += 1;
    }
    return closedAt;
}

/**
 * Whether a line at the top level begins a new form. `form` is the one before
 * it: a value on its own line, `meta`, or a `where` belongs to that form.
 * @param {string} text
 * @param {{ awaitingValue: boolean } | null} form
 * @returns {boolean}
 */
function startsForm(text, form) {
    if (!form) return true;
    if (form.awaitingValue) return false;
    if (WHERE.test(text)) return false;
    return FORM_START.test(text) && !META.test(text) && !VALUE_KEYWORD.test(text);
}

/**
 * The line ranges of a document's top-level forms, such as `name fn (...) {...}`
 * or a name followed by its `meta` and `fn` on later lines.
 * @param {string[]} lines
 * @returns {{ start: number, end: number, awaitingValue: boolean }[]}
 */
function topLevelForms(lines) {
    const forms = [];
    const stack = [];
    let form = null;

    lines.forEach((text, i) => {
        const trimmed = text.trim();
        const atTop = stack.length === 0;
        const isCode = trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('/*');

        if (atTop && isCode) {
            if (startsForm(text, form)) {
                form = {
                    start: i,
                    end: i,
                    awaitingValue: NAME_ONLY.test(trimmed) || NAME_WITH_META.test(trimmed)
                };
                forms.push(form);
            } else {
                form.end = i;
                form.awaitingValue = form.awaitingValue && META.test(trimmed);
            }
        } else if (!atTop && stack[0] !== 'block' && form) {
            form.end = i;
        }

        const closedAt = scanLine(text, stack);

        // A value can follow `meta` on the line that closes it: `meta ["test"] fn () {`
        if (form && form.awaitingValue && closedAt !== -1) {
            const after = text.slice(closedAt).trim();
            form.awaitingValue = after === '' || after.startsWith('//');
        }
    });

    return forms;
}

/**
 * The top-level form at a line. On a blank line or comment between forms, this
 * is the form above it.
 * @param {string[]} lines
 * @param {number} line
 * @returns {{ start: number, end: number } | null}
 */
function topLevelFormAt(lines, line) {
    let found = null;
    for (const form of topLevelForms(lines)) {
        if (form.start > line) break;
        found = form;
    }
    return found;
}

/**
 * The namespace a form or document line declares, such as `::myapp::greeter`.
 * @param {string} text
 * @returns {string | null}
 */
function declaredNamespace(text) {
    const match = text.trim().match(NAMESPACE);
    return match ? match[1] : null;
}

/**
 * The first namespace a document declares.
 * @param {string[]} lines
 * @returns {string | null}
 */
function documentNamespace(lines) {
    for (const line of lines) {
        const namespace = declaredNamespace(line);
        if (namespace) return namespace;
    }
    return null;
}

/**
 * Remove terminal colors, which the server adds to compile errors.
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
    return text.replace(ANSI, '');
}

/**
 * Text to send to the REPL. It reads a line at a time, so code that spans lines
 * goes as one bracketed paste.
 * @param {string} text
 * @returns {string}
 */
function replInput(text) {
    const code = text.replace(/\s+$/u, '');
    return code.includes('\n') ? `\x1b[200~${code}\x1b[201~` : code;
}

module.exports = {
    declaredNamespace,
    documentNamespace,
    replInput,
    stripAnsi,
    topLevelFormAt,
    topLevelForms
};
