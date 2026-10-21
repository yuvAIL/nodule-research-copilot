// Builds the walkthrough: deck.html (+ s5.html) → deck.built.html → PDF + one PNG per slide.
//   node build.mjs   (needs Playwright's Chromium)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const html = fs.readFileSync(path.join(here, 'deck.html'), 'utf8').replace('<!--S5-->', fs.readFileSync(path.join(here, 's5.html'), 'utf8'));
fs.writeFileSync(path.join(here, 'deck.built.html'), html);
const out = path.resolve(here, '..');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('file://' + path.join(here, 'deck.built.html'));
await p.waitForLoadState('networkidle');
await p.evaluate(() => document.fonts.ready);
// overflow check: any element sticking out of its slide
const issues = await p.evaluate(() => [...document.querySelectorAll('.slide')].flatMap((s, i) => {
  const r = s.getBoundingClientRect();
  return [...s.querySelectorAll('*')].filter((e) => { const q = e.getBoundingClientRect(); return q.width && (q.bottom > r.bottom + 1 || q.right > r.right + 1); }).slice(0, 3).map((e) => `slide ${i + 1}: <${e.tagName.toLowerCase()} class="${e.className}"> overflows`);
}));
console.log(issues.length ? issues.join('\n') : 'no overflow');
await p.pdf({ path: path.join(out, 'Nodule_Research_Copilot_Daniel_Walkthrough.pdf'), width: '1920px', height: '1080px', printBackground: true });
fs.mkdirSync(path.join(here, 'png'), { recursive: true });
const n = await p.locator('.slide').count();
for (let i = 0; i < n; i++) await p.locator('.slide').nth(i).screenshot({ path: path.join(here, 'png', `slide-${i + 1}.png`) });
console.log(`${n} slides`);
await b.close();
