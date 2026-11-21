import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { build } from 'vite';

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const paths = ['index.html', ...(await readdir('dist/assets')).map(path => 'assets/' + path)];
const assets = Object.fromEntries(await Promise.all(paths.map(async path => {
  const type = contentTypes[extname(path)];
  if (!type) throw new Error('Unsupported build asset: ' + path);
  return [path === 'index.html' ? '/' : '/' + path, { type, body: await readFile('dist/' + path, 'utf8') }];
})));
const generated = 'worker/assets.generated.mjs';
await writeFile(generated, 'export const assets = ' + JSON.stringify(assets) + ';\n');
try {
  await build({ configFile: false, build: {
    outDir: 'dist/server', emptyOutDir: true, copyPublicDir: false,
    lib: { entry: 'worker/index.mjs', formats: ['es'], fileName: () => 'index.js' },
    target: 'es2022',
  } });
} finally {
  await unlink(generated);
}
