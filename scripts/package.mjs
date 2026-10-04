import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Package and manifest versions must match.');

// Explicit files keep tests, local notes, launch drafts, and hidden files out of the upload.
const files = [
  'manifest.json', 'popup.html', 'popup.css', 'popup.js', 'calendar-paste.js',
  'lib/capture.js', 'lib/clipboard.js', 'lib/event.js', 'lib/find.js', 'lib/page-text.js', 'lib/structured.js',
  'lib/time.js', 'lib/zones.js',
  ...[16, 32, 48, 128].map((size) => `icons/${size}.png`), 'LICENSE'
];
for (const file of files) if (!statSync(path.join(root, file)).isFile()) throw new Error(`Missing package file: ${file}`);
const dist = path.join(root, 'dist');
mkdirSync(dist, { recursive: true });
const temporary = path.join(dist, `package-${process.pid}.zip`);
const output = path.join(dist, 'add-to-proton-calendar.zip');
try {
  const result = spawnSync('zip', ['-q', '-X', temporary, ...files], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Packaging failed. Install the zip command and try again.');
  renameSync(temporary, output);
  console.log(`Created ${path.relative(root, output)} (${files.length} files, v${manifest.version}).`);
} finally {
  rmSync(temporary, { force: true });
}
