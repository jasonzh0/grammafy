import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// field.ts touches DOM types only at runtime; `shift` is pure.
const result = await build({
  stdin: {
    contents: "export { shift } from './src/field';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { shift } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString(
    'base64'
  )}`
);

const c = (start, end, original) => ({
  start,
  end,
  original,
  replacement: 'x',
  type: 'grammar',
});

test('typing after all corrections leaves them untouched', () => {
  const out = shift([c(2, 5, 'abc')], 'x abc y', 'x abc y!');
  assert.deepEqual(out, [c(2, 5, 'abc')]);
});

test('typing before a correction shifts it', () => {
  const out = shift([c(6, 9, 'abc')], 'hello abc', 'hello, abc');
  assert.deepEqual(out, [c(7, 10, 'abc')]);
});

test('editing inside a correction drops it', () => {
  const out = shift([c(6, 9, 'abc')], 'hello abc', 'hello aXbc');
  assert.deepEqual(out, []);
});

test('deleting text before a correction shifts it back', () => {
  const out = shift([c(6, 9, 'abc')], 'hello abc', 'hey abc');
  assert.deepEqual(out, [c(4, 7, 'abc')]);
});
