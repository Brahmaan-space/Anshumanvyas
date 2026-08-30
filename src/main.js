import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Vector3, Color,
  BufferGeometry, BufferAttribute, Points, PointsMaterial, AdditiveBlending,
  SphereGeometry, MeshBasicMaterial, Mesh, BackSide, ShaderMaterial,
  LineBasicMaterial, Line, LineSegments, EdgesGeometry, WireframeGeometry,
  EllipseCurve, CylinderGeometry, BoxGeometry, IcosahedronGeometry,
  MathUtils, SRGBColorSpace, TorusGeometry
} from 'three';

const PAL = {
  accent: 0x52d6e8,
  amber: 0xff9e4a,
  ink: 0xe8edf7,
  violet: 0x9a8ce0,
  dim: 0x2b3a58
};

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = window.matchMedia('(hover: none)').matches;
const lowPower = isTouch || window.innerWidth < 760;

/* ------------------------------------------------------------------ scene */
const canvas = document.getElementById('gl');
const renderer = new WebGLRenderer({ canvas, antialias: !lowPower, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 1.75));
renderer.outputColorSpace = SRGBColorSpace;

const scene = new Scene();
const camera = new PerspectiveCamera(42, 1, 0.1, 400);
camera.position.set(0, 1.1, 7.4);
scene.add(camera);

/* ---------------------------------------------------------------- starfield */
function makeStars(count, spread, size, color, opacity) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = spread * (0.55 + Math.random() * 0.45);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.7;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  const m = new PointsMaterial({
    color, size, sizeAttenuation: true, transparent: true,
    opacity, depthWrite: false, blending: AdditiveBlending
  });
  return new Points(g, m);
}

const starsFar = makeStars(lowPower ? 900 : 2600, 120, 0.32, PAL.ink, 0.55);
const starsNear = makeStars(lowPower ? 260 : 700, 46, 0.5, PAL.accent, 0.42);
scene.add(starsFar, starsNear);

/* -------------------------------------------------------------------- body */
const bodyGroup = new Group();
bodyGroup.position.set(2.15, -0.35, 0);
scene.add(bodyGroup);

const core = new Mesh(
  new SphereGeometry(1.35, 48, 32),
  new MeshBasicMaterial({ color: 0x060a14 })
);
bodyGroup.add(core);

const grid = new LineSegments(
  new WireframeGeometry(new SphereGeometry(1.352, 26, 14)),
  new LineBasicMaterial({ color: PAL.accent, transparent: true, opacity: 0.16 })
);
bodyGroup.add(grid);

const atmo = new Mesh(
  new SphereGeometry(1.62, 48, 32),
  new ShaderMaterial({
    transparent: true, side: BackSide, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(PAL.accent) }, uPower: { value: 3.2 }, uAlpha: { value: 1 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uAlpha;
      varying vec3 vN; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), uPower);
        gl_FragColor = vec4(uColor, f * 0.85 * uAlpha);
      }`
  })
);
bodyGroup.add(atmo);

// terminator sliver
const limb = new Mesh(
  new TorusGeometry(1.4, 0.006, 6, 96),
  new MeshBasicMaterial({ color: PAL.amber, transparent: true, opacity: 0.5 })
);
limb.rotation.x = Math.PI * 0.5;
limb.rotation.z = 0.42;
bodyGroup.add(limb);

/* ------------------------------------------------------------------ orbits */
function ellipseLine(a, b, color, opacity) {
  const pts = new EllipseCurve(0, 0, a, b, 0, Math.PI * 2, false, 0).getPoints(190);
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = p.y; });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(arr, 3));
  return new Line(g, new LineBasicMaterial({ color, transparent: true, opacity }));
}

const sats = [];
const orbitDefs = [
  { a: 2.5, b: 2.5, inc: 0.36, raan: 0.0, sp: 0.20, col: PAL.accent, op: 0.30 },
  { a: 3.4, b: 3.1, inc: -0.62, raan: 0.9, sp: 0.13, col: PAL.accent, op: 0.18 },
  { a: 4.5, b: 4.2, inc: 0.22, raan: 2.1, sp: 0.085, col: PAL.violet, op: 0.16 }
];
orbitDefs.forEach((d) => {
  const g = new Group();
  g.rotation.x = d.inc; g.rotation.y = d.raan;
  g.add(ellipseLine(d.a, d.b, d.col, d.op));
  const sat = new Mesh(new BoxGeometry(0.05, 0.05, 0.05), new MeshBasicMaterial({ color: d.col === PAL.violet ? PAL.violet : PAL.amber }));
  g.add(sat);
  sats.push({ sat, ...d });
  bodyGroup.add(g);
});

/* ------------------------------------------------- project focus objects */
const focus = new Group();
focus.position.set(1.52, 0.44, -3.5);
focus.scale.setScalar(0.88);
camera.add(focus);

function lineMat(c, o) { return new LineBasicMaterial({ color: c, transparent: true, opacity: o }); }

// 01 orbit + spacecraft
function objOrbit() {
  const g = new Group();
  g.add(new Mesh(new SphereGeometry(0.22, 24, 16), new MeshBasicMaterial({ color: 0x070c18 })));
  g.add(new LineSegments(new WireframeGeometry(new SphereGeometry(0.222, 14, 8)), lineMat(PAL.accent, 0.22)));
  const path = ellipseLine(0.72, 0.5, PAL.accent, 0.5);
  path.rotation.x = 0.5; path.rotation.z = 0.2;
  g.add(path);
  const sc = new Group();
  sc.add(new Mesh(new BoxGeometry(0.06, 0.06, 0.08), new MeshBasicMaterial({ color: PAL.amber })));
  [-0.11, 0.11].forEach((x) => {
    const p = new Mesh(new BoxGeometry(0.13, 0.005, 0.05), new MeshBasicMaterial({ color: PAL.accent }));
    p.position.x = x; sc.add(p);
  });
  path.add(sc);
  g.userData.tick = (t) => {
    const a = t * 0.55;
    sc.position.set(Math.cos(a) * 0.72, 0, Math.sin(a) * 0.5);
    sc.rotation.y = -a;
    g.rotation.y = Math.sin(t * 0.12) * 0.25;
  };
  return g;
}

// 02 six-dof arm
function objArm() {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: 0x0b1424 });
  const joints = [];
  function seg(parent, len, r) {
    const j = new Group(); parent.add(j);
    const link = new Mesh(new CylinderGeometry(r, r * 0.86, len, 10), mat);
    link.position.y = len / 2; j.add(link);
    j.add(new LineSegments(new EdgesGeometry(new CylinderGeometry(r, r * 0.86, len, 10)), lineMat(PAL.accent, 0.42)).translateY(len / 2));
    const tip = new Group(); tip.position.y = len; j.add(tip);
    joints.push(j);
    return tip;
  }
  const base = new Mesh(new CylinderGeometry(0.17, 0.2, 0.06, 20), mat);
  base.position.y = -0.42; g.add(base);
  g.add(new LineSegments(new EdgesGeometry(new CylinderGeometry(0.17, 0.2, 0.06, 20)), lineMat(PAL.accent, 0.35)).translateY(-0.42));
  const root = new Group(); root.position.y = -0.39; g.add(root);
  let t1 = seg(root, 0.30, 0.062);
  let t2 = seg(t1, 0.34, 0.052);
  let t3 = seg(t2, 0.26, 0.044);
  let t4 = seg(t3, 0.16, 0.036);
  const ee = new Mesh(new BoxGeometry(0.07, 0.05, 0.07), new MeshBasicMaterial({ color: PAL.amber }));
  t4.add(ee);
  const target = new Mesh(new IcosahedronGeometry(0.055, 0), new MeshBasicMaterial({ color: PAL.amber, wireframe: true }));
  target.position.set(0.55, 0.28, 0.1); g.add(target);
  g.userData.tick = (t) => {
    joints[0].rotation.y = Math.sin(t * 0.35) * 0.9;
    joints[1].rotation.z = Math.sin(t * 0.4) * 0.42 - 0.25;
    joints[2].rotation.z = Math.sin(t * 0.5 + 1.1) * 0.55 + 0.35;
    joints[3].rotation.z = Math.sin(t * 0.6 + 2.0) * 0.5;
    joints[4] && (joints[4].rotation.y = t * 0.6);
    target.rotation.set(t * 0.5, t * 0.4, 0);
    target.position.y = 0.28 + Math.sin(t * 0.45) * 0.12;
  };
  return g;
}

// 03 lidar room point cloud (400 points, matching the real dataset size)
function objCloud() {
  const N = 400, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const face = i % 5, u = Math.random() - 0.5, v = Math.random() - 0.5, s = 0.95;
    let x, y, z;
    if (face === 0) { x = u * s; y = -0.45; z = v * s; }
    else if (face === 1) { x = -s / 2; y = v * 0.9; z = u * s; }
    else if (face === 2) { x = u * s; y = v * 0.9; z = -s / 2; }
    else if (face === 3) { x = s / 2; y = v * 0.9; z = u * s; }
    else { x = u * s; y = 0.45; z = v * s; }
    pos[i * 3] = x + (Math.random() - 0.5) * 0.02;
    pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.02;
    pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.02;
  }
  const g = new Group();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  g.add(new Points(geo, new PointsMaterial({ color: PAL.accent, size: 0.028, transparent: true, opacity: 0.95, depthWrite: false })));
  const box = new LineSegments(new EdgesGeometry(new BoxGeometry(0.95, 0.9, 0.95)), lineMat(PAL.amber, 0.28));
  g.add(box);
  const sweep = new Mesh(new BoxGeometry(0.96, 0.004, 0.96), new MeshBasicMaterial({ color: PAL.amber, transparent: true, opacity: 0.5 }));
  g.add(sweep);
  g.userData.tick = (t) => {
    g.rotation.y = t * 0.22;
    sweep.position.y = Math.sin(t * 0.7) * 0.45;
  };
  return g;
}

// placeholder slot
function objSlot() {
  const g = new Group();
  g.add(new LineSegments(new WireframeGeometry(new IcosahedronGeometry(0.5, 1)), lineMat(PAL.dim, 0.75)));
  const d = new Mesh(new SphereGeometry(0.035, 12, 8), new MeshBasicMaterial({ color: PAL.amber, transparent: true, opacity: 0.7 }));
  g.add(d);
  g.userData.tick = (t) => {
    g.rotation.set(t * 0.1, t * 0.16, 0);
    d.position.set(Math.cos(t * 0.8) * 0.5, Math.sin(t * 0.55) * 0.5, Math.sin(t * 0.8) * 0.5);
  };
  return g;
}

// 04 lake survey: operational volume, survey track and the aircraft flying it
function objSurvey() {
  const g = new Group();
  const dot = new SphereGeometry(0.011, 8, 6);
  const dotMat = new MeshBasicMaterial({ color: PAL.accent, transparent: true, opacity: 0.85 });

  // the lake, a closed loop under the track
  const lake = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    lake.push(new Vector3(Math.cos(a) * 0.15, -0.19, Math.sin(a) * 0.33));
  }
  g.add(new Line(new BufferGeometry().setFromPoints(lake), lineMat(PAL.accent, 0.45)));

  // flight geography plus contingency volume
  g.add(new LineSegments(new EdgesGeometry(new BoxGeometry(0.60, 0.44, 0.84)), lineMat(PAL.amber, 0.26)));

  // survey track with waypoints on it
  const P = (u) => new Vector3(Math.sin(u * Math.PI * 2) * 0.15, 0.02, (u - 0.5) * 0.68);
  const track = [];
  for (let i = 0; i <= 90; i++) track.push(P(i / 90));
  g.add(new Line(new BufferGeometry().setFromPoints(track), lineMat(PAL.ink, 0.34)));
  for (let i = 0; i <= 8; i++) {
    const s = new Mesh(dot, dotMat); s.position.copy(P(i / 8)); g.add(s);
  }

  const craft = new Mesh(new BoxGeometry(0.05, 0.014, 0.085), new MeshBasicMaterial({ color: PAL.amber }));
  g.add(craft);
  g.userData.tick = (t) => {
    const u = (t * 0.12) % 1;
    craft.position.copy(P(u));
    craft.rotation.y = Math.cos(u * Math.PI * 2) * 0.5;
    g.rotation.y = Math.sin(t * 0.11) * 0.3 + 0.3;
  };
  return g;
}

// 05 three aircraft on deconflicted routes at separated altitudes
function objFleet() {
  const g = new Group();
  const cols = [PAL.accent, PAL.amber, PAL.violet];
  const dot = new SphereGeometry(0.009, 8, 6);
  const craft = [];
  for (let k = 0; k < 3; k++) {
    const amp = 0.13 + k * 0.05, ph = k * 0.9, y = -0.13 + k * 0.13, len = 0.62;
    const P = (u) => new Vector3(Math.sin(u * Math.PI * 2 + ph) * amp, y, (u - 0.5) * len);
    const pts = [];
    for (let i = 0; i <= 90; i++) pts.push(P(i / 90));
    g.add(new Line(new BufferGeometry().setFromPoints(pts), lineMat(cols[k], 0.45)));
    const dm = new MeshBasicMaterial({ color: cols[k], transparent: true, opacity: 0.8 });
    for (let i = 0; i <= 6; i++) { const s = new Mesh(dot, dm); s.position.copy(P(i / 6)); g.add(s); }
    const mm = new Mesh(new BoxGeometry(0.042, 0.011, 0.07), new MeshBasicMaterial({ color: cols[k] }));
    g.add(mm);
    craft.push({ mm, P, ph, sp: 0.1 + k * 0.02 });
  }
  g.userData.tick = (t) => {
    craft.forEach((c) => {
      const u = (t * c.sp) % 1;
      c.mm.position.copy(c.P(u));
      c.mm.rotation.y = Math.cos(u * Math.PI * 2 + c.ph) * 0.6;
    });
    g.rotation.y = Math.sin(t * 0.1) * 0.34 + 0.28;
  };
  return g;
}

// each focus object gets a wrapper so the fade-scale never fights its base transform
const FOCUS_FIT = [[0.94, 0.02], [0.74, -0.26], [0.70, -0.04], [0.86, 0.00], [0.82, 0.00]];
const focusObjs = [objOrbit(), objArm(), objCloud(), objSurvey(), objFleet()].map((inner, i) => {
  const w = new Group();
  inner.scale.setScalar(FOCUS_FIT[i][0]);
  inner.position.y = FOCUS_FIT[i][1];
  w.add(inner);
  w.userData.tick = inner.userData.tick;
  return w;
});
focusObjs.forEach((o) => { o.visible = false; o.scale.setScalar(0.001); focus.add(o); });
let activeFocus = 0, focusAmt = 0, focusTargetAmt = 0;

/* -------------------------------------------------------- camera keyframes */
const KEYS = [
  { id: 'hero',     pos: [0, 1.05, 7.4],    look: [1.1, -0.2, 0],  fov: 42, body: [2.15, -0.35, 0],   bs: 1.00, atm: 1.00 },
  { id: 'about',    pos: [-1.9, 0.65, 6.0], look: [0.9, -0.35, 0], fov: 40, body: [2.80, -0.55, -1.2], bs: 0.95, atm: 0.80 },
  { id: 'caps',     pos: [-0.6, 1.7, 6.6],  look: [1.4, -0.5, 0],  fov: 44, body: [3.60, -1.70, -4.6], bs: 0.85, atm: 0.55 },
  { id: 'work',     pos: [-3.5, 0.2, 4.6],  look: [-0.4, -0.3, 0], fov: 46, body: [-6.4, -1.60, -8.0], bs: 0.80, atm: 0.32 },
  { id: 'research', pos: [-1.2, -1.3, 6.2], look: [1.2, 0.2, 0],   fov: 40, body: [6.60, -2.10, -8.4], bs: 0.75, atm: 0.32 },
  { id: 'track',    pos: [0.4, 2.4, 7.0],   look: [1.6, -0.9, 0],  fov: 44, body: [-8.20, -5.60, -17.0], bs: 0.62, atm: 0.22 },
  { id: 'contact',  pos: [0, 0.5, 12.5],    look: [1.0, -0.1, 0],  fov: 38, body: [1.60, -0.50, -3.0], bs: 0.92, atm: 0.90 }
];
const nodes = KEYS.map((k) => document.getElementById(k.id));

const camPos = new Vector3().fromArray(KEYS[0].pos);
const camLook = new Vector3().fromArray(KEYS[0].look);
const tgtPos = camPos.clone();
const tgtLook = camLook.clone();
let tgtFov = KEYS[0].fov;
const tgtBody = new Vector3().fromArray(KEYS[0].body);
let tgtBS = KEYS[0].bs, tgtAtm = KEYS[0].atm;

const smooth = (x) => x * x * (3 - 2 * x);

function updateTargets() {
  const mid = window.innerHeight * 0.42;
  let i = 0;
  for (let k = 0; k < nodes.length; k++) {
    if (nodes[k] && nodes[k].getBoundingClientRect().top <= mid) i = k;
  }
  const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const na = nodes[i], nb = nodes[Math.min(i + 1, nodes.length - 1)];
  let t = 0;
  if (na && nb && nb !== na) {
    const ta = na.getBoundingClientRect().top - mid;
    const tb = nb.getBoundingClientRect().top - mid;
    t = tb === ta ? 0 : MathUtils.clamp((0 - ta) / (tb - ta), 0, 1);
  }
  const e = smooth(t);
  tgtPos.set(
    MathUtils.lerp(a.pos[0], b.pos[0], e),
    MathUtils.lerp(a.pos[1], b.pos[1], e),
    MathUtils.lerp(a.pos[2], b.pos[2], e)
  );
  tgtLook.set(
    MathUtils.lerp(a.look[0], b.look[0], e),
    MathUtils.lerp(a.look[1], b.look[1], e),
    MathUtils.lerp(a.look[2], b.look[2], e)
  );
  tgtFov = MathUtils.lerp(a.fov, b.fov, e);
  tgtBody.set(
    MathUtils.lerp(a.body[0], b.body[0], e),
    MathUtils.lerp(a.body[1], b.body[1], e),
    MathUtils.lerp(a.body[2], b.body[2], e)
  );
  tgtBS = MathUtils.lerp(a.bs, b.bs, e);
  tgtAtm = MathUtils.lerp(a.atm, b.atm, e);

  const workEl = document.getElementById('work');
  if (workEl) {
    const r = workEl.getBoundingClientRect();
    const inView = r.top < window.innerHeight * 0.55 && r.bottom > window.innerHeight * 0.3;
    focusTargetAmt = inView && !lowPower ? 1 : 0;
  }
}

/* ------------------------------------------------------------ mouse parallax */
let mx = 0, my = 0, mxS = 0, myS = 0;
if (!isTouch && !reduce) {
  window.addEventListener('pointermove', (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });
}

/* ------------------------------------------------------------------- resize */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  focus.position.x = w / h < 1.05 ? 0 : 1.52;
  focus.position.y = w / h < 1.05 ? 1.25 : 0.44;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize, { passive: true });
resize();
updateTargets();
window.addEventListener('scroll', updateTargets, { passive: true });

/* --------------------------------------------------------------------- loop */
let t0 = performance.now(), clock = 0, running = true;
function frame(now) {
  requestAnimationFrame(frame);
  if (!running) return;
  const dt = Math.min((now - t0) / 1000, 0.05); t0 = now;
  clock += dt;

  const k = reduce ? 1 : 1 - Math.pow(0.0016, dt);
  camPos.lerp(tgtPos, k);
  camLook.lerp(tgtLook, k);
  mxS += (mx - mxS) * (reduce ? 1 : 1 - Math.pow(0.004, dt));
  myS += (my - myS) * (reduce ? 1 : 1 - Math.pow(0.004, dt));

  camera.position.set(camPos.x + mxS * 0.42, camPos.y - myS * 0.28, camPos.z);
  camera.lookAt(camLook);
  if (Math.abs(camera.fov - tgtFov) > 0.01) { camera.fov += (tgtFov - camera.fov) * k; camera.updateProjectionMatrix(); }

  bodyGroup.position.lerp(tgtBody, k);
  const bs = bodyGroup.scale.x + (tgtBS - bodyGroup.scale.x) * k;
  bodyGroup.scale.setScalar(bs);
  const ua = atmo.material.uniforms.uAlpha;
  ua.value += (tgtAtm - ua.value) * k;
  grid.material.opacity = 0.16 * (0.35 + 0.65 * ua.value);
  limb.material.opacity = 0.5 * (0.3 + 0.7 * ua.value);

  if (!reduce) {
    bodyGroup.rotation.y = clock * 0.035;
    grid.rotation.y = clock * 0.02;
    starsFar.rotation.y = clock * 0.004;
    starsNear.rotation.y = -clock * 0.009;
    limb.rotation.z = 0.42 + Math.sin(clock * 0.15) * 0.1;
    sats.forEach((s) => {
      const a = clock * s.sp;
      s.sat.position.set(Math.cos(a) * s.a, 0, Math.sin(a) * s.b);
    });
  }

  focusAmt += (focusTargetAmt - focusAmt) * (reduce ? 1 : 1 - Math.pow(0.006, dt));
  focusObjs.forEach((o, i) => {
    const want = i === activeFocus ? focusAmt : 0;
    const cur = o.scale.x;
    const next = cur + (want - cur) * (reduce ? 1 : 1 - Math.pow(0.004, dt));
    o.scale.setScalar(Math.max(next, 0.0001));
    o.visible = next > 0.02;
    if (o.visible && o.userData.tick && !reduce) o.userData.tick(clock);
  });
  focus.rotation.y = mxS * 0.18;

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { running = !document.hidden; t0 = performance.now(); });

/* ============================================================= DOM behaviour */

// reveal on scroll
const io = new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
document.querySelectorAll('[data-rev]').forEach((el) => io.observe(el));

// nav scrollspy
const navLinks = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));
const spy = new IntersectionObserver((es) => {
  es.forEach((e) => {
    if (e.isIntersecting) {
      navLinks.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id));
    }
  });
}, { rootMargin: '-45% 0px -50% 0px' });
['work', 'research', 'track', 'contact'].forEach((id) => { const el = document.getElementById(id); if (el) spy.observe(el); });

// work rows -> focus object
const rows = Array.from(document.querySelectorAll('.row'));
function setActive(i) {
  if (i === activeFocus) return;
  activeFocus = i;
  rows.forEach((r, j) => r.classList.toggle('on', j === i));
  const meta = document.getElementById('focus-meta');
  if (meta && rows[i]) {
    // Set only what the panel actually has. This used to assume every field was
    // present and threw on .fm-note, which does not exist in the markup, on
    // every single row hover.
    const put = (sel, val) => { const el = meta.querySelector(sel); if (el) el.textContent = val || ''; };
    put('.fm-id', rows[i].dataset.idx);
    put('.fm-name', rows[i].dataset.short);
    put('.fm-stat', rows[i].dataset.stat);
    put('.fm-note', rows[i].dataset.note);
  }
}
rows.forEach((r, i) => {
  r.addEventListener('click', (e) => { if (r.getAttribute('href') === '#') { e.preventDefault(); setActive(i); } });
  r.addEventListener('pointerenter', () => setActive(i));
  r.addEventListener('focusin', () => setActive(i));
});
if (isTouch) {
  const rio = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) setActive(rows.indexOf(e.target)); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  rows.forEach((r) => rio.observe(r));
}
setActive(0);

/* ------------------------------------------------------------------- path
   The Sun does not sit still: it runs through the galaxy at roughly 230 km/s
   toward the solar apex, so every planet's real track is a helix trailing
   behind it. This section is that picture. Each role is a planet on its own
   orbit; scrolling advances the Sun, the planets sweep round it, and their
   wakes stretch out to the left. Pinned vertical scroll drives the horizontal
   card track. Narrow screens and reduced-motion get a plain stack instead. */
const hs = document.querySelector('.hs');
if (hs) {
  const pin = hs.querySelector('.hs-pin');
  const cv = hs.querySelector('.hs-sky');
  const track = hs.querySelector('.hs-track');
  const cards = Array.from(hs.querySelectorAll('.hs-card'));
  const ticks = Array.from(hs.querySelectorAll('.tick'));
  const fillEl = hs.querySelector('.rail-fill');
  const markEl = hs.querySelector('.rail-mark');
  const legEl = document.getElementById('hs-leg');
  const tEl = document.getElementById('hs-t');
  const N = cards.length;
  const YEARS = 8.2;

  const flat = () =>
    window.matchMedia('(max-width:1000px)').matches ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, p = 0, pS = 0, raf = null, visible = false;

  // one planet per post: radius, angular rate, size, colour, starting phase
  const PL = [
    { r: 0.13, w: 2.05, s: 3.4, c: '#9FB0C8', ph: 0.7 },
    { r: 0.22, w: 1.45, s: 4.4, c: '#9A8CE0', ph: 2.4 },
    { r: 0.32, w: 1.02, s: 5.4, c: '#52D6E8', ph: 4.1 },
    { r: 0.43, w: 0.74, s: 6.6, c: '#FF9E4A', ph: 5.6 }
  ];

  let stars = [];
  function seedStars() {
    stars = [];
    const n = Math.round((W * H) / 5200);
    for (let i = 0; i < n; i++) {
      const layer = i % 3;
      stars.push({
        x: Math.random(), y: Math.random(),
        r: [0.6, 0.95, 1.5][layer] * (0.7 + Math.random() * 0.6),
        a: [0.20, 0.36, 0.62][layer] * (0.6 + Math.random() * 0.5),
        v: [0.10, 0.28, 0.62][layer]
      });
    }
  }

  function fit() {
    const r = pin.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedStars();
  }

  function draw() {
    if (!W) return;
    const sunX = W * 0.70, cy = H * 0.44;
    const RU = Math.min(W * 0.5, H * 0.92);
    const world = pS * 2600;
    const spin = pS * 7.4;

    ctx.clearRect(0, 0, W, H);

    const band = ctx.createLinearGradient(0, cy - H * 0.42, 0, cy + H * 0.42);
    band.addColorStop(0, 'rgba(82,214,232,0)');
    band.addColorStop(0.5, 'rgba(70,120,170,.075)');
    band.addColorStop(1, 'rgba(82,214,232,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, cy - H * 0.42, W, H * 0.84);

    for (let i = 0; i < 3; i++) {
      const nx = ((0.3 + i * 0.42) * W - world * 0.05) % (W * 1.7);
      const ny = cy + (i - 1) * H * 0.2;
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, W * 0.26);
      g.addColorStop(0, i === 1 ? 'rgba(154,140,224,.055)' : 'rgba(82,214,232,.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      let x = (st.x * W - world * st.v) % W;
      if (x < 0) x += W;
      ctx.globalAlpha = st.a;
      ctx.fillStyle = '#E8EDF7';
      ctx.fillRect(x, st.y * H, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(34,50,82,.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(sunX, cy); ctx.stroke();
    ctx.setLineDash([]);

    const leg = Math.min(N - 1, Math.max(0, Math.round(pS * (N - 1))));

    PL.forEach((pl, i) => {
      const R = pl.r * RU, RY = R * 0.30;
      const on = i === leg;
      const th = pl.ph + spin * pl.w;

      ctx.strokeStyle = on ? pl.c : 'rgba(34,50,82,.85)';
      ctx.globalAlpha = on ? 0.5 : 1;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(sunX, cy, R, RY, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      const STEPS = 132, dx = (sunX + R) / STEPS;
      ctx.beginPath();
      for (let k = 0; k <= STEPS; k++) {
        const a = th - k * pl.w * 0.052;
        const x = sunX - k * dx + Math.cos(a) * R;
        const y = cy + Math.sin(a) * RY;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = pl.c;
      ctx.globalAlpha = on ? 0.5 : 0.14;
      ctx.lineWidth = on ? 1.5 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      const px = sunX + Math.cos(th) * R;
      const py = cy + Math.sin(th) * RY;
      if (on) {
        ctx.strokeStyle = pl.c; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, pl.s + 9, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = pl.c;
      ctx.globalAlpha = on ? 1 : 0.5;
      ctx.beginPath(); ctx.arc(px, py, on ? pl.s + 1 : pl.s, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    });

    const sg = ctx.createRadialGradient(sunX, cy, 2, sunX, cy, 78);
    sg.addColorStop(0, 'rgba(255,214,150,.95)');
    sg.addColorStop(0.16, 'rgba(255,158,74,.55)');
    sg.addColorStop(1, 'rgba(255,158,74,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sunX, cy, 78, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFE7C2';
    ctx.beginPath(); ctx.arc(sunX, cy, 9, 0, Math.PI * 2); ctx.fill();
  }

  function apply() {
    raf = null;
    const r = hs.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    p = span > 0 ? MathUtils.clamp(-r.top / span, 0, 1) : 0;

    if (flat()) {
      cards.forEach((c) => c.classList.add('on'));
      return;
    }

    pS += (p - pS) * 0.18;
    if (Math.abs(p - pS) < 0.0004) pS = p;

    // hold each card still for the first and last quarter of its segment, and
    // travel through the middle, so there is time to read before the next leg
    const t = pS * (N - 1);
    const idx = Math.min(N - 2, Math.max(0, Math.floor(t)));
    let f = MathUtils.clamp(((t - idx) - 0.22) / 0.56, 0, 1);
    f = f * f * (3 - 2 * f);
    track.style.transform = `translate3d(${-(idx + f) * 100}vw,0,0)`;

    const leg = MathUtils.clamp(f < 0.5 ? idx : idx + 1, 0, N - 1);
    cards.forEach((c, i) => c.classList.toggle('on', i === leg));
    ticks.forEach((t, i) => t.classList.toggle('on', i <= leg));
    if (fillEl) fillEl.style.width = (pS * 100).toFixed(2) + '%';
    if (markEl) markEl.style.left = (pS * 100).toFixed(2) + '%';
    if (legEl) legEl.textContent = `${leg + 1} / ${N}`;
    if (tEl) tEl.textContent = `${(pS * YEARS).toFixed(1)} yr`;

    draw();
  }

  function loop() {
    apply();
    if (visible && !flat()) raf = requestAnimationFrame(loop);
    else raf = null;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  ticks.forEach((t, i) => t.addEventListener('click', () => {
    const r = hs.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    const target = window.scrollY + r.top + span * (i / (N - 1));
    window.scrollTo({ top: target, behavior: 'smooth' });
  }));

  fit();
  apply();
  window.addEventListener('resize', () => { fit(); pS = p; apply(); }, { passive: true });
  window.addEventListener('scroll', kick, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      es.forEach((e) => { visible = e.isIntersecting; if (visible) kick(); });
    }, { rootMargin: '10% 0px' }).observe(hs);
  } else { visible = true; kick(); }
}

// copy email
const copyBtn = document.getElementById('copy-mail');
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.mail);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy address'; }, 1800);
    } catch (e) {
      copyBtn.textContent = 'Select it manually';
    }
  });
}

// boot: fade the loader once the first frame is on screen
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.body.classList.add('ready');
}));

/* ============================================ scan portrait (contact section)
   Samples a source image into a point field and redraws it every frame with a
   sweeping acquisition band, the way the LiDAR page treats its cloud. Swap the
   placeholder for a real photo by putting a URL in the canvas's data-src.      */
(function scanPortrait() {
  const cv = document.getElementById('scan');
  if (!cv) return;
  const ctx = cv.getContext('2d', { alpha: true });

  const SW = 200, SH = 250, STEP = 3;
  const src = document.createElement('canvas');
  src.width = SW; src.height = SH;
  const sctx = src.getContext('2d', { willReadFrequently: true });

  function placeholder(c) {
    c.clearRect(0, 0, SW, SH);
    const g = c.createRadialGradient(SW * 0.34, SH * 0.24, 4, SW * 0.55, SH * 0.62, SH * 0.85);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, '#d5dfee');
    g.addColorStop(0.58, '#7e8ea8');
    g.addColorStop(0.82, '#3b4a67');
    g.addColorStop(1, '#111a2c');
    c.fillStyle = g;
    // shoulders, running off both edges of the frame
    c.beginPath();
    c.moveTo(-SW * 0.04, SH * 1.02);
    c.bezierCurveTo(SW * 0.02, SH * 0.80, SW * 0.28, SH * 0.68, SW * 0.5, SH * 0.68);
    c.bezierCurveTo(SW * 0.72, SH * 0.68, SW * 0.98, SH * 0.80, SW * 1.04, SH * 1.02);
    c.closePath(); c.fill();
    // neck, tapered
    c.beginPath();
    c.moveTo(SW * 0.415, SH * 0.50);
    c.lineTo(SW * 0.585, SH * 0.50);
    c.lineTo(SW * 0.625, SH * 0.72);
    c.lineTo(SW * 0.375, SH * 0.72);
    c.closePath(); c.fill();
    // head
    c.beginPath();
    c.ellipse(SW * 0.5, SH * 0.31, SW * 0.235, SH * 0.205, 0, 0, Math.PI * 2);
    c.fill();
  }

  let buckets = [];          // [{color, pts:[{x,y,s}]}]
  const NB = 6;
  const blur = document.createElement('canvas');
  blur.width = SW; blur.height = SH;
  const bctx = blur.getContext('2d', { willReadFrequently: true });

  function sample(drawInto) {
    // second pass, blurred, so we can separate local structure from flat brightness
    bctx.clearRect(0, 0, SW, SH);
    bctx.filter = 'blur(4px)';
    drawInto(bctx);
    bctx.filter = 'none';

    const d = sctx.getImageData(0, 0, SW, SH).data;
    const g = bctx.getImageData(0, 0, SW, SH).data;
    const n = SW * SH;
    const L = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      A[i] = d[k + 3] / 255;
      L[i] = (d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114) / 255;
      B[i] = (g[k] * 0.299 + g[k + 1] * 0.587 + g[k + 2] * 0.114) / 255;
      if (A[i] > 0.3) { sum += L[i]; cnt++; }
    }
    const mean = cnt ? sum / cnt : 0.5;

    const C0 = [30, 56, 96], C1 = [234, 240, 250];
    buckets = Array.from({ length: NB }, (_, i) => {
      const t = Math.pow(i / (NB - 1), 0.9);
      const r = Math.round(C0[0] + (C1[0] - C0[0]) * t);
      const gg = Math.round(C0[1] + (C1[1] - C0[1]) * t);
      const b = Math.round(C0[2] + (C1[2] - C0[2]) * t);
      return { color: `rgb(${r},${gg},${b})`, pts: [] };
    });

    for (let y = 0; y < SH; y += STEP) {
      for (let x = 0; x < SW; x += STEP) {
        const i = y * SW + x;
        if (A[i] < 0.3) continue;
        const t = Math.max(0, Math.min(1, 0.38 + (L[i] - mean) * 0.85 + (L[i] - B[i]) * 3.0));
        const j = Math.min(NB - 1, Math.floor(t * NB));
        buckets[j].pts.push({ x: x / SW, y: y / SH, s: 0.5 + t * 1.85 });
      }
    }
  }

  placeholder(sctx);
  sample(placeholder);

  const url = cv.dataset.src;
  if (url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const paint = (c) => {
        c.clearRect(0, 0, SW, SH);
        const r = Math.max(SW / img.width, SH / img.height);
        const w = img.width * r, h = img.height * r;
        c.drawImage(img, (SW - w) / 2, (SH - h) / 2, w, h);
      };
      paint(sctx);
      sample(paint);
    };
    img.src = url;
  }

  let W = 0, H = 0, dpr = 1;
  function fit() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let t = 0, hov = 0, hovT = 0, px = 0.5, py = 0.5, pxS = 0.5, pyS = 0.5;
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    px = (e.clientX - r.left) / r.width;
    py = (e.clientY - r.top) / r.height;
    hovT = 1;
  }, { passive: true });
  cv.addEventListener('pointerleave', () => { hovT = 0; }, { passive: true });

  function render() {
    if (!W) fit();
    if (!W) return;
    ctx.clearRect(0, 0, W, H);

    // acquisition band sweeps top to bottom, with a pause below the frame
    const cyc = 1.55;
    const scanY = reduce ? -9 : ((t * 0.115) % cyc) - 0.16;
    const band = [];

    for (let b = 0; b < buckets.length; b++) {
      const bu = buckets[b];
      ctx.fillStyle = bu.color;
      for (let i = 0; i < bu.pts.length; i++) {
        const p = bu.pts[i];
        const d = Math.abs(p.y - scanY);
        if (d < 0.055) { band.push(p); continue; }
        let x = p.x, y = p.y;
        if (hov > 0.01) {
          const dx = x - pxS, dy = y - pyS;
          const f = hov * Math.exp(-(dx * dx + dy * dy) * 34) * 0.55;
          x += dx * f; y += dy * f;
        }
        ctx.fillRect(x * W, y * H, p.s, p.s);
      }
    }

    // the band itself: brighter, amber, slightly larger
    if (band.length) {
      ctx.fillStyle = 'rgba(255,158,74,.92)';
      for (let i = 0; i < band.length; i++) {
        const p = band[i];
        let x = p.x, y = p.y;
        if (hov > 0.01) {
          const dx = x - pxS, dy = y - pyS;
          const f = hov * Math.exp(-(dx * dx + dy * dy) * 34) * 0.55;
          x += dx * f; y += dy * f;
        }
        ctx.fillRect(x * W, y * H, p.s + 1.1, p.s + 1.1);
      }
      ctx.strokeStyle = 'rgba(255,158,74,.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, scanY * H); ctx.lineTo(W, scanY * H);
      ctx.stroke();
    }
  }

  let raf = null;
  function loop() {
    t += 1 / 60;
    hov += (hovT - hov) * 0.08;
    pxS += (px - pxS) * 0.12;
    pyS += (py - pyS) * 0.12;
    render();
    raf = requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => { fit(); if (reduce) render(); }, { passive: true });
  fit();
  if (reduce) { render(); }
  else if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (e.isIntersecting) { if (raf === null) loop(); }
        else if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      });
    }, { threshold: 0 }).observe(cv);
  } else { loop(); }
})();
