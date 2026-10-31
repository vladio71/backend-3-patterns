// Збирає scheme/scheme.ts у public/scheme.js і копіює docs/architecture.excalidraw у public/scheme.excalidraw.
import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

mkdirSync('public/scheme-assets', { recursive: true });
copyFileSync('docs/architecture.excalidraw', 'public/scheme.excalidraw');
// Стилі і шрифти Excalidraw віддаємо з нашого ж сервера, без CDN.
copyFileSync('node_modules/@excalidraw/excalidraw/dist/prod/index.css', 'public/scheme.css');
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'public/scheme-assets/fonts', { recursive: true });
await build({
  entryPoints: ['scheme/scheme.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'public/scheme.js',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' },
  assetNames: 'scheme-assets/[name]-[hash]',
  logLevel: 'warning',
});
console.log('scheme: public/scheme.js зібрано');
