// Renders the built manipulator page and the landing page at several widths and
// reports anything that would show up as a layout or wiring fault.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });

const noise = (s) => /ERR_TUNNEL|ERR_NAME|fonts\.g|cdnjs/.test(s);

for (const [name, path] of [
  ['manipulator', 'work/capture-manipulator/index.html'],
  ['landing', 'index.html']
]) {
  const p = await b.newPage({ viewport:{width:1280,height:900} });
  const errs = [];
  p.on('console', m => { if (m.type()==='error' && !noise(m.text())) errs.push(m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('file:///home/claude/site/' + path);
  await p.waitForTimeout(1200);

  console.log(`\n--- ${name} ---`);
  console.log('console errors:', errs.length, errs.slice(0,4).join(' | '));

  for (const w of [390, 768, 1024, 1280, 1600]) {
    await p.setViewportSize({ width:w, height:900 });
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => {
      const de = document.documentElement;
      const over = [...document.querySelectorAll('body *')]
        .filter(el => el.getBoundingClientRect().right > de.clientWidth + 1)
        .map(el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.'+el.className.split(' ')[0] : ''));
      const shells = [...document.querySelectorAll('.shell')].map(el => {
        const b = el.getBoundingClientRect();
        return Math.round(b.left - (de.clientWidth - b.width)/2);
      });
      return { hscroll: de.scrollWidth - de.clientWidth,
               over: [...new Set(over)].slice(0,4),
               centring: [...new Set(shells)] };
    });
    console.log(`  ${String(w).padStart(4)}px  hscroll ${r.hscroll}  ` +
                `shell off-centre ${r.centring.join(',')}  ` +
                (r.over.length ? 'overflow: '+r.over.join(' ') : ''));
  }

  if (name === 'manipulator') {
    const links = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')));
    console.log('  links:', [...new Set(links)].join(' '));
    const eq = await p.evaluate(() => ({
      total: document.querySelectorAll('.eq .tex').length,
      rendered: document.querySelectorAll('.eq .katex').length
    }));
    console.log(`  equations ${eq.rendered}/${eq.total} typeset (0 rendered offline is expected: KaTeX is a CDN script)`);
    const rev = await p.evaluate(() => ({
      total: document.querySelectorAll('[data-rev]').length,
      shown: document.querySelectorAll('[data-rev].in').length
    }));
    console.log(`  reveal: ${rev.shown}/${rev.total} elements revealed above the fold`);
  }
  await p.close();
}
await b.close();
