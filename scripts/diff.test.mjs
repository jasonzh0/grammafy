import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const src = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
}

const { diffEdits, changedRatio } = await load('src/diff.ts');

function apply(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.replacement + out.slice(out.slice(0, e.end).length);
  }
  return out;
}

test('identical text yields no edits', () => {
  assert.deepEqual(diffEdits('All good here.', 'All good here.'), []);
});

test('single misspelled word', () => {
  const a = 'I bought two loafs of bread.';
  const b = 'I bought two loaves of bread.';
  const edits = diffEdits(a, b);
  assert.equal(edits.length, 1);
  assert.equal(a.slice(edits[0].start, edits[0].end), 'loafs');
  assert.equal(edits[0].replacement, 'loaves');
  assert.equal(apply(a, edits), b);
});

test('verb agreement and a missing comma are separate edits', () => {
  const a = 'I seen him yesterday at the store and he left';
  const b = 'I saw him yesterday at the store, and he left';
  const edits = diffEdits(a, b);
  assert.equal(edits.length, 2);
  assert.equal(a.slice(edits[0].start, edits[0].end), 'seen');
  assert.equal(edits[0].replacement, 'saw');
  // The inserted comma has no original text, so it widens to the previous word.
  assert.equal(a.slice(edits[1].start, edits[1].end), 'store');
  assert.equal(edits[1].replacement, 'store,');
  assert.equal(apply(a, edits), b);
});

test('adjacent word changes are merged into one suggestion', () => {
  const a = 'their going too the park';
  const b = "they're going to the park";
  const edits = diffEdits(a, b);
  assert.equal(edits.length, 2);
  assert.equal(apply(a, edits), b);
});

test('deleted word produces an empty replacement', () => {
  const a = 'the the cat sat';
  const b = 'the cat sat';
  const edits = diffEdits(a, b);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].replacement.trim(), '');
  assert.equal(apply(a, edits), b);
});

test('capitalization at sentence start', () => {
  const edits = diffEdits('hello world. this is fine.', 'Hello world. This is fine.');
  assert.equal(edits.length, 2);
  assert.deepEqual(
    edits.map((e) => e.replacement),
    ['Hello', 'This']
  );
});

test('whitespace-only differences are ignored', () => {
  assert.deepEqual(diffEdits('a  b', 'a b'), []);
  assert.deepEqual(diffEdits('a b ', 'a b'), []);
});

test('unicode apostrophes and accents survive tokenization', () => {
  const a = 'Its café is dont open';
  const b = 'It’s café isn’t open';
  const edits = diffEdits(a, b);
  assert.equal(apply(a, edits), b);
});

test('changedRatio flags a rewrite', () => {
  const a = 'The quick brown fox jumps over the lazy dog.';
  const b = 'A fast auburn vulpine leaps above a sleepy hound.';
  assert.ok(changedRatio(a, diffEdits(a, b)) > 0.5);
  assert.ok(
    changedRatio(a, diffEdits(a, 'The quick brown fox jumps over the lazy cat.')) < 0.2
  );
});
