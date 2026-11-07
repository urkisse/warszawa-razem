// Builds a login-free copy of the editing panel in ./.admin-test/ for trying changes to admin/config.yml
// or admin/index.html. It uses Sveltia CMS's "test-repo" backend (an in-browser sandbox, nothing is sent
// anywhere) pre-filled with the real places and photos from content/.
//   node tools/admin-test.mjs && python3 -m http.server 4190 -d .admin-test   ->  http://localhost:4190/
// In the panel choose "Work with Test Repository". Edits stay in the browser only. To reset the sandbox,
// run in the browser console: (await navigator.storage.getDirectory()).removeEntry('sveltia-cms-test', {recursive: true})
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.admin-test');
fs.mkdirSync(OUT, { recursive: true });
// empty the folder but keep the folder itself, so a running `http.server` keeps working
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });

// the panel itself (bundle + chunks), same as in the real build
fs.cpSync(path.join(ROOT, 'node_modules/@sveltia/cms/dist'), OUT, { recursive: true, filter: (s) => !s.endsWith('.map') && !s.endsWith('.mjs') });

// page + config: same as admin/, but with the sandbox backend and a seed list
const page = fs.readFileSync(path.join(ROOT, 'admin/index.html'), 'utf8').replace('</head>', '    <link href="./seed.json" rel="cms-seed-url">\n  </head>');
fs.writeFileSync(path.join(OUT, 'index.html'), page);
const cfg = fs.readFileSync(path.join(ROOT, 'admin/config.yml'), 'utf8').replace(/^backend:\n(?:[ \t]+.*\n)+/m, 'backend:\n  name: test-repo\n');
fs.writeFileSync(path.join(OUT, 'config.yml'), cfg);
// other files the config refers to (logo etc.)
for (const f of fs.readdirSync(path.join(ROOT, 'admin'))) if (!['index.html', 'config.yml'].includes(f)) fs.cpSync(path.join(ROOT, 'admin', f), path.join(OUT, f), { recursive: true });

// seed: content/ (without the 30 MB map) is made available and listed
fs.mkdirSync(path.join(OUT, 'content'));
const files = [];
for (const sub of ['places', 'photos', 'videos']) {
  fs.symlinkSync(path.join(ROOT, 'content', sub), path.join(OUT, 'content', sub));
  for (const f of fs.readdirSync(path.join(ROOT, 'content', sub))) files.push(`content/${sub}/${f}`);
}
fs.writeFileSync(path.join(OUT, 'seed.json'), JSON.stringify({ files }));
console.log(`.admin-test ready: ${files.length} files seeded. Serve it:  python3 -m http.server 4190 -d .admin-test`);
