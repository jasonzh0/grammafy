/**
 * Rasterize assets/icon.svg into public/icons/*.png.
 * Uses macOS Quick Look + sips so there are no npm dependencies.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = resolve(root, 'assets/icon.svg');
const out = resolve(root, 'public/icons');
const tmp = resolve(tmpdir(), 'grammafy-icons');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });

execFileSync('qlmanage', ['-t', '-s', '512', '-o', tmp, svg], { stdio: 'ignore' });
const big = resolve(tmp, 'icon.svg.png');
for (const size of [128, 48, 32, 16]) {
  const target = resolve(out, `icon_${size}.png`);
  copyFileSync(big, target);
  execFileSync('sips', ['-z', String(size), String(size), target], { stdio: 'ignore' });
}
console.log('icons written to public/icons/');
