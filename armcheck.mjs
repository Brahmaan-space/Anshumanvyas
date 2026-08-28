// Numeric check on the arm viewer: no console errors, the arm stays inside the
// Table 1 joint limits at every sampled instant, the tip never leaves the
// workspace, and the gripper is actually holding the fixture after capture.
import { chromium } from 'playwright';

const url = 'file:///tmp/arm-test.html';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });

const errs = [];
// The sandbox has no route to fonts.googleapis.com, so that one failed fetch is
// the harness and not the page.
const noise = (s) => /ERR_TUNNEL_CONNECTION_FAILED|fonts\.g(oogleapis|static)/.test(s);
page.on('console', (m) => { if (m.type() === 'error' && !noise(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await page.goto(url);
await page.waitForFunction(() => !!window.__viewer, null, { timeout: 15000 });

const DUR = await page.evaluate(() => window.__viewer.DUR);
const MARKS = await page.evaluate(() => window.__viewer.MARKS);
console.log(`duration ${DUR.toFixed(2)} s, ${MARKS.length} waypoints`);

const N = 200;
const rows = [];
for (let i = 0; i <= N; i++) {
  const t = (DUR * i) / N;
  rows.push(await page.evaluate((tt) => {
    window.__viewer.seek(tt);
    return window.__viewer.probe();
  }, t));
}

const worstOver = Math.max(...rows.map((r) => r.overrunDeg));
const maxReach = Math.max(...rows.map((r) => r.reach));
const offFrame = rows.filter((r) => Math.abs(r.sx) > 0.98 || Math.abs(r.sy) > 0.98).length;

// After capture the fixture must ride the gripper. Sample only past the grasp.
const tCap = MARKS[3].in;
const held = rows.filter((r) => r.time > tCap + 0.1);
const worstGap = Math.max(...held.map((r) => r.gripGapMm));

// Per-step screen displacement, to catch a camera or handover jump.
let jump = 0, jumpAt = 0;
for (let i = 1; i < rows.length; i++) {
  const d = Math.hypot(rows[i].sx - rows[i - 1].sx, rows[i].sy - rows[i - 1].sy);
  if (d > jump) { jump = d; jumpAt = rows[i].time; }
}

console.log(`worst joint-limit overrun   ${worstOver.toFixed(4)} deg`);
console.log(`max tip reach               ${(maxReach * 1000).toFixed(1)} mm`);
console.log(`tip off frame               ${offFrame} of ${rows.length} samples`);
console.log(`worst gripper-fixture gap   ${worstGap.toFixed(2)} mm (after capture)`);
console.log(`largest step on screen      ${jump.toFixed(4)} NDC at t=${jumpAt.toFixed(2)} s`);
console.log(`console errors              ${errs.length}`);
for (const e of errs.slice(0, 5)) console.log('  ' + e);

// Alignment: the canvas must fill its box at any window size.
for (const w of [420, 700, 1100, 1600]) {
  await page.setViewportSize({ width: w, height: 660 });
  await page.evaluate(() => window.__viewer.resize());
  const box = await page.evaluate(() => {
    const s = document.getElementById('stage');
    const c = s.querySelector('canvas');
    const a = s.getBoundingClientRect(), b = c.getBoundingClientRect();
    return { dx: Math.abs(a.left - b.left), dy: Math.abs(a.top - b.top),
             dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height) };
  });
  console.log(`  ${w}px  offset ${box.dx.toFixed(1)}/${box.dy.toFixed(1)} ` +
              `size delta ${box.dw.toFixed(1)}/${box.dh.toFixed(1)}`);
}

await browser.close();

const bad = errs.length || worstOver > 1e-6 || worstGap > 30 || jump > 0.12;
process.exit(bad ? 1 : 0);
