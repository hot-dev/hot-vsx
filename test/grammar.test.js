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
