// Builds every page from src/.
//
//   src/<page>.html   markup + CSS, split at <!--/head--> into head and body
//   src/<entry>.js    the JavaScript that page needs
//
// Each page in PAGES is bundled and written to its own output path. index.html
// is the landing page; work pages get their own directory so the URL is clean.
//
// Run: npm run build

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SITE = {
  url: 'https://anshumanvyas.dev',
  locale: 'en_CA'
};

const PAGES = [
  {
    src: 'src/template.html',
    entry: 'src/main.js',
    out: 'index.html',
    alsoBodyOnly: 'artifact.html',
    base: '',
    title: 'Anshuman Vyas | Aerospace Engineer',
    description:
      'Aerospace engineer in Ottawa working on orbital mechanics, space robotics and ' +
      'the hardware around them. Satellite trajectory models, a 6-DOF capture manipulator, ' +
      'LiDAR reconstruction.',
    image: 'og.png',
    canonical: '/'
  },
  {
    src: 'src/work-l1.html',
    entry: 'src/page.js',
    out: 'work/l1-transfer/index.html',
    base: '../../',
    title: 'Slingshot to L1 | Anshuman Vyas',
    description:
      'Modelling the transfer from a 235 x 19,500 km Earth parking orbit to a halo orbit ' +
      'about the Sun-Earth L1 point: four perigee raises, escape to the sphere of influence, ' +
      'a Lambert arc, and a halo found in the circular restricted three-body problem.',
    image: 'og.png',
    canonical: '/work/l1-transfer/'
  },
  {
    src: 'src/work-lidar.html',
    entry: 'src/page.js',
    out: 'work/lidar-reconstruction/index.html',
    base: '../../',
    title: 'A room from 398 points | Anshuman Vyas',
    description:
      'Reconstructing a room in 3D from 398 laser rangefinder returns: RANSAC plane fitting, ' +
      'Cartesian binning, nearest-neighbour exclusion, SVD flattening and surface extension, ' +
      'validated against a ray-traced virtual room.',
    image: 'og.png',
    canonical: '/work/lidar-reconstruction/'
  },
  {
    src: 'src/work-manipulator.html',
    entry: 'src/page.js',
    out: 'work/capture-manipulator/index.html',
    base: '../../',
    title: 'Reaching ENVISAT | Anshuman Vyas',
    description:
      'A 6-DOF manipulator sized to grapple the derelict ENVISAT satellite: link and ' +
      'joint layout, Denavit-Hartenberg parameters, forward and inverse kinematics, and ' +
      'a capture path planned through joint space and checked against the joint limits.',
    image: 'og.png',
    canonical: '/work/capture-manipulator/'
  },
  {
    src: 'src/work-hab.html',
    entry: 'src/page.js',
    out: 'work/hab-mission/index.html',
    base: '../../',
    title: 'Permission to fly | Anshuman Vyas',
    description:
      'Designing an unmanned aircraft operation to find harmful algae blooms on a city drinking-water ' +
      'reservoir: three-stage platform selection, a nine-phase concept of operations, an emergency ' +
      'escalation table, and a JARUS SORA safety case taken to SAIL II.',
    image: 'og.png',
    canonical: '/work/hab-mission/'
  },
  {
    src: 'src/work-survey.html',
    entry: 'src/page.js',
    out: 'work/whale-survey/index.html',
    base: '../../',
    title: 'Counting whales from 5,000 feet | Anshuman Vyas',
    description:
      'A three-aircraft autonomous survey of the Bay of Fundy: requirements derived from the concept of ' +
      'operations, deconflicted waypoint routes, and an operational volume sized from a total system ' +
      'error budget of path definition, flight technical and navigational error.',
    image: 'og.png',
    canonical: '/work/whale-survey/'
  },
  {
    src: 'src/work-banff.html',
    entry: 'src/page.js',
    out: 'work/banff-lidar/index.html',
    base: '../../',
    title: 'Two passes over Banff | Anshuman Vyas',
    description:
      'Planning a LiDAR topographical survey of two square kilometres of Banff National Park: sensor ' +
      'selection driven by pulse rate and field of view, a WingtraOne Gen II sized to carry it, two survey ' +
      'patterns at different altitudes holding a constant standoff above terrain, and a SAIL IV safety case.',
    image: 'og.png',
    canonical: '/work/banff-lidar/'
  },
  {
    src: 'src/viewer-arm.html',
    entry: 'src/viewer-arm.js',
    out: 'work/capture-manipulator/viewer/index.html',
    base: '../../../',
    title: 'Arm viewer | Reaching ENVISAT',
    description:
      'Interactive 6-DOF arm drawn from its Denavit-Hartenberg table, running the ' +
      'reach, capture and carry path with live joint angles against the joint limits.',
    image: 'og.png',
    canonical: '/work/capture-manipulator/viewer/'
  },
  {
    src: 'src/viewer-l1.html',
    entry: 'src/viewer.js',
    out: 'work/l1-transfer/viewer/index.html',
    base: '../../../',
    title: 'Mission viewer | Slingshot to L1',
    description:
      'Interactive three-act view of the transfer to a halo orbit about Sun-Earth L1: ' +
      'the perigee raises and escape burn, the heliocentric cruise, and halo insertion.',
    image: 'og.png',
    canonical: '/work/l1-transfer/viewer/'
  }
];

const BANNER = `<!--
  GENERATED FILE. Do not edit this file directly.
  Edit the matching file in src/, then run: npm run build
-->`;

const MARK = '<!--/head-->';

// Function replacer on purpose: the minified Three.js bundle contains a variable
// named `$`, and a plain string replacement would let JavaScript expand $& / $` / $'
// inside it and silently corrupt the code. That produced a blank page once already.
const inject = (s, js) => s.replace('/*__BUNDLE__*/', () => js);

// Interior project pages share one stylesheet so they cannot drift apart.
// Same function-replacer rule applies: CSS can contain $ too.
const PAGE_CSS = readFileSync('src/page.css', 'utf8');
const injectCss = (s) => s.replace('/*__PAGECSS__*/', () => PAGE_CSS);

for (const page of PAGES) {
  const bundleFile = `bundle.${page.out.replace(/[\/.]/g, '_')}.js`;
  execSync(
    `npx esbuild ${page.entry} --bundle --minify --format=iife --target=es2019 --outfile=${bundleFile}`,
    { stdio: 'inherit' }
  );

  const tpl = readFileSync(page.src, 'utf8');
  const js = readFileSync(bundleFile, 'utf8');

  if (!tpl.includes(MARK)) throw new Error(`${page.src} is missing the ${MARK} marker`);
  const [rawHead, body] = tpl.split(MARK);
  const head = injectCss(
    rawHead.replace(/<title>[\s\S]*?<\/title>/, `<title>${page.title}</title>`)
  );

  const b = page.base;
  const meta = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#04060D">
<meta name="description" content="${page.description}">
<meta name="author" content="Anshuman Vyas">
<link rel="canonical" href="${SITE.url}${page.canonical}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Anshuman Vyas">
<meta property="og:locale" content="${SITE.locale}">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${SITE.url}${page.canonical}">
<meta property="og:image" content="${SITE.url}/${page.image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Anshuman Vyas, aerospace engineer">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${page.title}">
<meta name="twitter:description" content="${page.description}">
<meta name="twitter:image" content="${SITE.url}/${page.image}">

<link rel="icon" href="${b}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${b}apple-touch-icon.png">
`;

  const doc = `<!doctype html>
${BANNER}
<html lang="en">
<head>
${meta}${head.trim()}
</head>
<body>
${inject(body, js).trim()}
</body>
</html>
`;

  mkdirSync(dirname(page.out) === '.' ? '.' : dirname(page.out), { recursive: true });
  writeFileSync(page.out, doc);
  if (page.alsoBodyOnly) writeFileSync(page.alsoBodyOnly, inject(tpl.replace(MARK, ''), js));
  console.log('wrote', page.out);
}
