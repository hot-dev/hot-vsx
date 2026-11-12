const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const oniguruma = require('vscode-oniguruma');
const vsctm = require('vscode-textmate');

const GRAMMAR = path.join(__dirname, '..', 'syntaxes', 'hot.tmLanguage.json');

let grammar;

before(async () => {
    await oniguruma.loadWASM(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer);
    const registry = new vsctm.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
            createOnigString: (text) => new oniguruma.OnigString(text)
        }),
        loadGrammar: async () => vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR)
    });
    grammar = await registry.loadGrammar('source.hot');
});

function tokens(text) {
    let state = vsctm.INITIAL;
    const found = [];
    for (const line of text.split('\n')) {
        const result = grammar.tokenizeLine(line, state);
        for (const token of result.tokens) {
            found.push({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes });
        }
        state = result.ruleStack;
    }
    return found;
}

function scopeOf(source, text) {
    const token = tokens(source).find((t) => t.text === text);
    assert.ok(token, `no token ${JSON.stringify(text)} in ${JSON.stringify(source)}`);
    return token.scopes[token.scopes.length - 1];
}

test('true, false and null are constants', () => {
    assert.strictEqual(scopeOf('x true', 'true'), 'constant.language.boolean.hot');
    assert.strictEqual(scopeOf('x false', 'false'), 'constant.language.boolean.hot');
    assert.strictEqual(scopeOf('x null', 'null'), 'constant.language.null.hot');
    assert.strictEqual(scopeOf('`${f(true)}`', 'true'), 'constant.language.boolean.hot');
});

test('a name that starts or ends with a keyword is one name', () => {
    for (const name of ['type-name', 'meta-data', 'fn-name', 'ns-list', 'lazy-load', 'cond-x', 'match-result', 'some-where', 'true-ish', 'null-safe']) {
        assert.strictEqual(scopeOf(`x ${name}`, name), 'variable.other.readwrite.hot');
    }
    assert.strictEqual(scopeOf('do-request(1)', 'do-request'), 'entity.name.function.hot');
});

test('keywords are still keywords', () => {
    assert.strictEqual(scopeOf('f fn (a: Int) { a }', 'fn'), 'keyword.declaration.hot');
    assert.strictEqual(scopeOf('f fn cond (a: Int) { a }', 'cond'), 'keyword.control.flow.hot');
    assert.strictEqual(scopeOf('f fn cond-all (a: Int) { a }', 'cond-all'), 'keyword.control.flow.hot');
    assert.strictEqual(scopeOf('match x { }', 'match'), 'keyword.control.flow.hot');
    assert.strictEqual(scopeOf('T type { a: Int } where gt(%.a, 0)', 'where'), 'keyword.other.where.hot');
});

test('a key may be named like a keyword', () => {
    assert.strictEqual(scopeOf('{match: 1}', 'match'), 'variable.other.property.hot');
});

test('a value that is a namespace path is not a map key', () => {
    assert.strictEqual(scopeOf('x ::hot::math/add(1)', 'x'), 'variable.other.readwrite.hot');
    assert.strictEqual(scopeOf('x ::hot::math/add(1)', '::hot::math'), 'support.class.hot');
});

test('a capitalized name after the slash is a type', () => {
    assert.strictEqual(scopeOf('::a::b/Foo(1)', '/Foo'), 'entity.name.type.hot');
    assert.strictEqual(scopeOf('::a::b/foo(1)', '/foo'), 'entity.name.function.hot');
});

test('block comments span lines', () => {
    const found = tokens('/* a type\nfn b */ x');
    for (const text of [' a type', 'fn b ']) {
        assert.ok(found.find((t) => t.text === text).scopes.includes('comment.block.hot'), text);
    }
    assert.strictEqual(scopeOf('/* a */ x', 'x'), 'variable.other.readwrite.hot');
});

test('braces inside a template expression do not end it', () => {
    const found = tokens('`a ${ {b: 1}.b } c`');
    const end = found.find((t) => t.text === ' c');
    assert.ok(end, 'the text after the expression is its own token');
    assert.ok(!end.scopes.includes('meta.embedded.expression.hot'));
    assert.ok(found.find((t) => t.text === '1').scopes.includes('meta.embedded.expression.hot'));
});

test('a template inside a template expression is a template', () => {
    const inner = tokens('`${f(`in`)} tail`').find((t) => t.text === 'in');
    assert.strictEqual(inner.scopes[inner.scopes.length - 1], 'string.template.hot');
});

test('nested braces inside meta do not end it', () => {
    const doc = tokens('meta {ctx: {a: 1}, doc: """Text"""}').find((t) => t.text === 'Text');
    assert.ok(doc.scopes.includes('meta.annotation.brace.hot'));
});

test('a brace inside a meta string does not end it', () => {
    const doc = tokens('meta {doc: """A } brace""", tags: ["a"]}').find((t) => t.text === 'a');
    assert.ok(doc.scopes.includes('meta.annotation.brace.hot'));
});

test('open after type or enum is part of the declaration', () => {
    assert.strictEqual(scopeOf('Method type open "GET" | "POST"', 'open'), 'keyword.declaration.modifier.hot');
    assert.strictEqual(scopeOf('Method type open | "PUT"', 'open'), 'keyword.declaration.modifier.hot');
    assert.strictEqual(scopeOf('Animal enum open { Dog }', 'open'), 'keyword.declaration.modifier.hot');
    assert.strictEqual(scopeOf('Animal enum open { Dog }', 'enum'), 'keyword.declaration.hot');
    // Anywhere else it is a name.
    assert.strictEqual(scopeOf('x open', 'open'), 'variable.other.readwrite.hot');
    assert.strictEqual(scopeOf('open-file(1)', 'open-file'), 'entity.name.function.hot');
    assert.strictEqual(scopeOf('T type opener', 'opener'), 'variable.other.readwrite.hot');
});

test('a typed binding is a name, not a key', () => {
    for (const line of [
        'limit: Int 3 where gt(%, 0)',
        '    limit: Int 3',
        'limit: All<Vec> parallel {',
        'limit: Str? null',
        'limit: Map<Str, Vec<Int>> load()',
        'limit: ::model/User find(1)',
        'limit: Int | Dec 3'
    ]) {
        assert.strictEqual(scopeOf(line, 'limit'), 'variable.other.readwrite.hot', line);
    }
    assert.strictEqual(scopeOf('vals: All<Vec> parallel {', 'All'), 'entity.name.type.hot');
    assert.strictEqual(scopeOf('vals: All<Vec> parallel {', 'parallel'), 'keyword.control.flow.hot');
    // A field, a parameter on its own line and a map entry are keys.
    for (const line of [
        '    limit: Int,',
        '    limit: Int',
        '    limit: Str? where ne(%, "")',
        '    limit: Int // the most',
        '    limit: Foo(1)',
        '    limit: Shape.Dot',
        '    limit: 3',
        'T type { limit: Int }',
        'p Point(limit: 1)'
    ]) {
        assert.strictEqual(scopeOf(line, 'limit'), 'variable.other.property.hot', line);
    }
});

test('a named argument is a property', () => {
    assert.strictEqual(scopeOf('p Point(x: 1, y: add(a, 2))', 'y'), 'variable.other.property.hot');
    assert.strictEqual(scopeOf('c Shape.Circle(radius: 5.0)', 'radius'), 'variable.other.property.hot');
    assert.strictEqual(scopeOf('c Shape.Circle(radius: 5.0)', 'Circle'), 'entity.name.type.variant.hot');
});

test('a member of the placeholder is a property', () => {
    assert.strictEqual(scopeOf('f fn (amount: Int) where gt(%.amount, 0) { 1 }', 'amount'), 'variable.other.property.hot');
    const found = tokens('map(items, %.name)');
    assert.strictEqual(found.find((t) => t.text === '%').scopes.at(-1), 'variable.language.placeholder.hot');
    assert.strictEqual(found.find((t) => t.text === 'name').scopes.at(-1), 'variable.other.property.hot');
});

test('spread in a vec, a map and a call', () => {
    for (const line of ['xs [...f(x), 0]', 'm {...base, c: 3}', 'add(...xs)']) {
        assert.strictEqual(scopeOf(line, '...'), 'keyword.operator.spread.hot', line);
    }
    assert.strictEqual(scopeOf('xs [...f(x), 0]', 'f'), 'entity.name.function.hot');
});

test('an enrollment names a variant', () => {
    const found = tokens('Bird -> Animal.Bird');
    assert.deepStrictEqual(
        found.filter((t) => t.text.trim() !== '').map((t) => t.scopes.at(-1)),
        ['entity.name.type.hot', 'keyword.operator.coercion.hot', 'entity.name.type.hot', 'punctuation.accessor.hot', 'entity.name.type.variant.hot']
    );
    assert.strictEqual(scopeOf('Date -> Str fn (d: Date): Str { "x" }', 'Str'), 'entity.name.type.hot');
});

test('a block string and a block template have no escapes', () => {
    // The backslash is text, so the string ends at its closing quotes.
    assert.strictEqual(scopeOf('doc """C:\\dir\\""" x', 'x'), 'variable.other.readwrite.hot');
    assert.ok(!tokens('doc """a\\n"""').some((t) => t.scopes.includes('constant.character.escape.hot')));
    // `\${x}` in a block template is a backslash and an expression.
    const x = tokens('t ```a \\${x} b```').find((t) => t.text === 'x');
    assert.ok(x.scopes.includes('meta.embedded.expression.hot'));
    // A string and a template keep their escapes.
    assert.ok(tokens('s "a\\n"').some((t) => t.scopes.includes('constant.character.escape.hot')));
    const escaped = tokens('t `a \\${x} b`').find((t) => t.text.includes('x'));
    assert.ok(!escaped.scopes.includes('meta.embedded.expression.hot'));
});
