# anshumanvyas.dev

Personal site for Anshuman Vyas. Landing page v1: one persistent WebGL scene (Three.js)
with a scroll-driven camera, a project index where each row owns an object in the scene,
and a point-scan portrait in the contact section.

Everything ships as a single self-contained `index.html`. No framework, no runtime
dependencies, nothing fetched at load except Google Fonts.

## Layout

    src/template.html   markup and all CSS, split at <!--/head--> into head and body
    src/main.js         the Three.js scene and every page behaviour, plain ES modules
    build.mjs           bundles main.js and composes index.html
    index.html          built output, committed so hosting needs no build step
    404.html            standalone, hand-written, no bundle
    portrait.b64        the contact portrait as a data URI
    og.png              social card, 1200x630
    favicon.svg         browser tab icon
    CNAME               custom domain for GitHub Pages
    .nojekyll           stops GitHub Pages running the files through Jekyll

## Build

    npm install
    npm run build       # regenerates index.html and artifact.html
    npm run dev         # builds, then serves on http://localhost:5173

`build.mjs` emits two files. `index.html` is the real page, a complete document with the
meta tags, canonical URL, Open Graph card and icons. `artifact.html` is the same page as
body-only markup, for pasting into a preview host that supplies its own document shell.
It is gitignored.

Page metadata lives in the `SITE` object at the top of `build.mjs`. Change the
description or social card there, not in the markup.

## Hosting

`index.html` is committed and self-contained, so there is nothing to build at deploy time.

**Vercel.** Import the repo. Framework preset **Other**, build command empty, output
directory empty. Add `anshumanvyas.dev` under Settings, Domains, then point the registrar
at Vercel. You get a preview URL on every push, which is the reason to prefer this.

**GitHub Pages.** Requires a public repo on the free plan. Settings, Pages, Source:
Deploy from a branch, `main`, `/ (root)`. The `CNAME` file already claims the domain;
GitHub will show the exact A records for the apex plus a CNAME for `www`. Tick Enforce
HTTPS once the certificate provisions.

Either way, delete `CNAME` if you are not using the custom domain yet, or Pages will keep
trying to serve from a domain that does not resolve.

## How the scene is built

- `starsFar` / `starsNear` are two point layers that parallax against each other
- `bodyGroup` holds the planet core, wireframe grid, fresnel atmosphere shell, terminator
  ring, and three inclined orbits carrying satellites
- `focus` is parented to the camera so it holds position on screen, and contains one
  object per row of the work index: orbit and spacecraft, the 6-DOF arm, a 400-point
  LiDAR cloud, and two placeholders for the open slots
- `KEYS` is one keyframe per section, holding camera position, look target and fov, plus
  where the planet sits and how bright its atmosphere is at that point in the scroll.
  Editing this array re-choreographs the entire page.

Camera and mouse are damped toward their targets every frame rather than snapped, which
is what makes the motion feel like it has mass.

## The contact portrait

The `#scan` canvas samples an image into a point field and redraws it each frame with an
amber acquisition band sweeping down the frame. Points repel from the cursor.

The source is a base64 data URI in the canvas's `data-src` attribute, kept alongside in
`portrait.b64`. To replace it: remove the background from a photo, save as PNG around
264x330, base64 it, and swap the attribute. Nothing else changes.

Sampling uses local contrast rather than raw brightness, so a bright shirt cannot swamp
a darker face. It still needs a photo with directional light and visible eyes to read as
a likeness rather than a silhouette.

## Performance

- One persistent canvas; points are instanced; draw calls stay well under 100
- Device pixel ratio clamped to 1.75, and 1.5 on mobile
- A low-power path cuts star counts and drops the per-project focus objects entirely
- `prefers-reduced-motion` renders a composed static frame with all content intact
- Rendering pauses on `visibilitychange` and when a canvas scrolls out of view

## One trap worth knowing

`build.mjs` inlines the bundle with a **function** replacer:

    tpl.replace('/*__BUNDLE__*/', () => js)

The minified Three.js bundle contains a variable named `$`, so a plain string replacement
lets JavaScript expand `$&` inside the code and silently corrupts it. That produced a
blank page once. Do not simplify that line.

## Not done yet

The work rows do not navigate anywhere. Project pages at `/work/<slug>`, a research page
and the resume timeline as their own routes are the next piece of work, which is a
Next.js port where this scene moves into React Three Fiber and lives in the root layout
so navigation retargets the camera instead of reloading it.
