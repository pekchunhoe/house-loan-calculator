import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg']) await copyFile(file, `dist/${file}`);
await cp('src', 'dist/src', { recursive: true });
console.log('Static site built in dist/. Deploy to GitHub Pages or Vercel.');
