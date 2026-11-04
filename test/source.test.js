const assert = require('node:assert');
const { test } = require('node:test');
const { documentNamespace, replInput, stripAnsi, topLevelFormAt } = require('../src/source');

const DOC = `::t ns
meta {
    doc: """Top } of file."""
}

::re ::hot::regex

add
meta {
    doc: """Adds { two numbers."""
}
fn (a: Int, b: Int): Int {
  sum a
  sum
}

// A comment

one fn (a: Int): Int {
  a
}

Pt type { x: Int }
where gt(%.x, 0)

withdraw fn (amount: Int, balance: Int)
  where lte(%.amount, %.balance)
  : Int where gte(%, 0)
{
  sub(balance, amount)
}

braces fn (a: Str): Str {
  "}" // }
  \`\${ {b: "}"}.b } {\`
}

test-a
meta ["test"] fn () {
  1
}
test-b
meta {
    doc: "b"
} fn () {
  2
}
test-c meta ["test"] fn () {
  3
}

limit
100

/* a { block
comment */
last 1
`;

const lines = DOC.split('\n');

function formAt(text) {
    const line = lines.findIndex((l) => l.includes(text));
    assert.notStrictEqual(line, -1, text);
    const form = topLevelFormAt(lines, line);
    return lines.slice(form.start, form.end + 1).join('\n');
}

test('a name, its meta and its fn are one form from any of their lines', () => {
    const expected = lines.slice(7, 15).join('\n');
    assert.ok(expected.startsWith('add\n') && expected.endsWith('}'));
    for (const line of ['add', 'Adds {', 'fn (a: Int, b: Int)', 'sum a']) {
        assert.strictEqual(formAt(line), expected);
    }
});

test('a form on one line stops at its closing brace', () => {
    assert.strictEqual(formAt('one fn'), 'one fn (a: Int): Int {\n  a\n}');
});

test('a where line belongs to the form above it', () => {
    assert.strictEqual(formAt('where gt'), 'Pt type { x: Int }\nwhere gt(%.x, 0)');
});

test('a signature can span lines before its body', () => {
    const form = formAt('withdraw');
    assert.ok(form.endsWith('sub(balance, amount)\n}'));
    assert.strictEqual(formAt('sub(balance'), form);
});

test('braces in strings, comments and templates do not count', () => {
    const form = formAt('braces fn');
    assert.ok(form.endsWith('{`\n}'));
});

test('a value can follow meta on the line that closes it', () => {
    assert.strictEqual(formAt('test-a'), 'test-a\nmeta ["test"] fn () {\n  1\n}');
    assert.strictEqual(formAt('test-b'), 'test-b\nmeta {\n    doc: "b"\n} fn () {\n  2\n}');
    assert.strictEqual(formAt('test-c'), 'test-c meta ["test"] fn () {\n  3\n}');
});

test('a value on its own line belongs to its name', () => {
    assert.strictEqual(formAt('100'), 'limit\n100');
});

test('a block comment is not code', () => {
    assert.strictEqual(formAt('last 1'), 'last 1');
});

test('a comment between forms takes the form above', () => {
    assert.ok(formAt('// A comment').startsWith('add\n'));
});

test('the namespace and its meta are one form', () => {
    assert.ok(formAt('Top }').startsWith('::t ns\nmeta {'));
});

test('an import is its own form', () => {
    assert.strictEqual(formAt('::re'), '::re ::hot::regex');
});

test('nothing above the first form', () => {
    assert.strictEqual(topLevelFormAt(['', 'x 1'], 0), null);
});

test('the document namespace ignores imports', () => {
    assert.strictEqual(documentNamespace(['::re ::hot::regex', '::my::app ns']), '::my::app');
    assert.strictEqual(documentNamespace(['::a::b meta {doc: "x"} ns']), '::a::b');
    assert.strictEqual(documentNamespace(['x 1']), null);
});

test('terminal colors are removed', () => {
    assert.strictEqual(stripAnsi('\x1b[31m[error]\x1b[0m \x1b[38;5;246mline\x1b[0m'), '[error] line');
});

test('code on several lines goes to the REPL as a paste', () => {
    assert.strictEqual(replInput('x 1\n'), 'x 1');
    assert.strictEqual(replInput('f fn () {\n  1\n}\n'), '\x1b[200~f fn () {\n  1\n}\x1b[201~');
});
