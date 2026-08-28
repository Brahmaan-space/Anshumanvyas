/* Arm viewer for the capture manipulator page.
 *
 * The arm on screen is not a model of a robot. It is the Denavit-Hartenberg
 * table, evaluated every frame. src/arm-data.json carries the DH parameters,
 * the Table 1 joint limits and the six waypoint configurations that
 * tools/compute_arm.py solved out of the inverse kinematics; this file runs the
 * forward kinematics in the browser and hangs geometry off the frames it gets
 * back. If the table were wrong the arm would come out wrong, which is the
 * point of drawing it this way.
 *
 * Between waypoints the joint vector is the report's linear interpolation,
 * q(t) = (1 - t) q_i + t q_(i+1). Playback eases the rate so the arm does not
 * start and stop instantly, but the path through joint space is unchanged.
 */

import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Vector3, Matrix4, Quaternion, Euler,
  BufferGeometry, Float32BufferAttribute,
  Line, LineBasicMaterial, LineSegments, EdgesGeometry,
  Mesh, MeshStandardMaterial, MeshBasicMaterial,
  CylinderGeometry, BoxGeometry, SphereGeometry, CircleGeometry, RingGeometry,
  DirectionalLight, HemisphereLight, DoubleSide, MathUtils
} from 'three';

import DATA from './arm-data.json';

const ACCENT = 0x52d6e8;
const AMBER  = 0xff9e4a;
const SLATE  = 0x5c6b88;
const PALE   = 0xd6deee;
const LINE   = 0x223252;

const DH = DATA.dh;
const LIMITS = DATA.limitsDeg;
const WP = DATA.waypoints;
const NSEG = WP.length - 1;
const STEP = DATA.stepsPerSegment - 1;      // track indices per segment

/* ------------------------------------------------------------------ timing */
// A dwell at each waypoint and a move between them. The moves are not equal:
// the two long reaches get more time than the 40 mm final approach, which is
// the part worth watching closely rather than the part that takes longest.
const DWELL = [0.9, 0.7, 0.5, 1.1, 0.6, 1.8];
const MOVE  = [4.2, 2.3, 1.9, 2.5, 4.3];

const MARKS = [];       // MARKS[i] = { in, out } wall-clock times for waypoint i
let clock = 0;
for (let i = 0; i < WP.length; i++) {
  MARKS.push({ in: clock, out: clock + DWELL[i] });
  clock += DWELL[i];
  if (i < NSEG) clock += MOVE[i];
}
const DUR = clock;

const CAPTURE = 3;                                   // waypoint index
const T_CAPTURE = MARKS[CAPTURE].in;

const CHAPTERS = [
  { id: 'reach',   label: 'Reach',   t0: 0 },
  { id: 'capture', label: 'Capture', t0: MARKS[2].in - 0.2 },
  { id: 'carry',   label: 'Carry',   t0: MARKS[CAPTURE].out - 0.2 }
];

const ease = (u) => u * u * (3 - 2 * u);

/** Wall-clock time to path parameter in [0, NSEG]: integers are waypoints. */
function pathAt(t) {
  for (let i = 0; i < WP.length; i++) {
    if (t <= MARKS[i].out) return i;
    if (i === NSEG) return NSEG;
    const u = (t - MARKS[i].out) / MOVE[i];
    if (u < 1) return i + ease(u);
  }
  return NSEG;
}

/** The report's linear joint interpolation, evaluated at path parameter s. */
function qAt(s) {
  const i = Math.min(NSEG - 1, Math.floor(s));
  const u = Math.min(1, Math.max(0, s - i));
  const a = WP[i].q, b = WP[i + 1].q;
  const q = new Array(6);
  for (let j = 0; j < 6; j++) q[j] = (1 - u) * a[j] + u * b[j];
  return q;
}

/* -------------------------------------------------------- forward kinematics */
// One 4x4 per joint, exactly the A_i of the writeup, multiplied in order.
const _A = new Matrix4();
function fk(q, out) {
  const T = out.base;
  T.identity();
  for (let i = 0; i < 6; i++) {
    const { a, alpha, d, theta } = DH[i];
    const th = theta + q[i];
    const ct = Math.cos(th), st = Math.sin(th);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    _A.set(
      ct, -st * ca,  st * sa, a * ct,
      st,  ct * ca, -ct * sa, a * st,
       0,       sa,       ca,      d,
       0,        0,        0,      1
    );
    out.frames[i].multiplyMatrices(i === 0 ? T : out.frames[i - 1], _A);
  }
  return out;
}

const POSE = { base: new Matrix4(), frames: Array.from({ length: 6 }, () => new Matrix4()) };
const originOf = (m, v) => v.setFromMatrixPosition(m);
const axisOf = (m, col, v) => v.setFromMatrixColumn(m, col).normalize();

/* -------------------------------------------------------------------- scene */
const stage = document.getElementById('stage');
const scene = new Scene();
const camera = new PerspectiveCamera(38, 1, 0.02, 40);

const renderer = new WebGLRenderer({ antialias: true, alpha: false });
renderer.setClearColor(0x04060d, 1);
stage.appendChild(renderer.domElement);

scene.add(new HemisphereLight(0x9fb4dd, 0x0a1020, 0.85));
const key = new DirectionalLight(0xffffff, 1.5);
key.position.set(1.4, 1.1, 1.6);
scene.add(key);
const rim = new DirectionalLight(0x52d6e8, 0.55);
rim.position.set(-1.6, 0.5, -1.1);
scene.add(rim);

// Three.js takes y as up. The kinematics are worked in the robot's own frame
// with z up, so everything hangs off a group turned a quarter turn about x and
// no coordinate has to be swapped by hand anywhere below.
const world = new Group();
world.rotation.x = -Math.PI / 2;
scene.add(world);

/* ------------------------------------------------------------------- deck */
const deck = new Group();
world.add(deck);

const plate = new Mesh(
  new CircleGeometry(0.50, 96),
  new MeshStandardMaterial({ color: 0x0c1424, roughness: 0.95, metalness: 0.05 })
);
plate.position.z = -0.001;
deck.add(plate);

// The reachable envelope, at the widest radius the tip touches on this path.
const envelope = new Mesh(
  new RingGeometry(0.418, 0.421, 128),
  new MeshBasicMaterial({ color: LINE, transparent: true, opacity: 0.9, side: DoubleSide })
);
deck.add(envelope);

const gridPts = [];
for (let i = -6; i <= 6; i++) {
  const u = i * 0.1;
  const h = Math.sqrt(Math.max(0, 0.48 * 0.48 - u * u));
  gridPts.push(u, -h, 0, u, h, 0, -h, u, 0, h, u, 0);
}
const grid = new LineSegments(
  new BufferGeometry().setAttribute('position', new Float32BufferAttribute(gridPts, 3)),
  new LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.28 })
);
deck.add(grid);

/* -------------------------------------------------------------------- arm */
const arm = new Group();
world.add(arm);

const matLink = new MeshStandardMaterial({ color: PALE, roughness: 0.42, metalness: 0.55 });
const matJoint = new MeshStandardMaterial({ color: 0x1d2b45, roughness: 0.5, metalness: 0.6 });
const matTool = new MeshStandardMaterial({ color: AMBER, roughness: 0.4, metalness: 0.4 });

// Cylinders are built along y, so every bone and hub gets oriented by pointing
// its local y at the direction it should span. One helper, used everywhere.
const Y = new Vector3(0, 1, 0);
const _q = new Quaternion();
function span(mesh, from, to) {
  const d = new Vector3().subVectors(to, from);
  const len = d.length();
  if (len < 1e-5) { mesh.visible = false; return; }
  mesh.visible = true;
  mesh.position.copy(from).addScaledVector(d, 0.5);
  mesh.quaternion.copy(_q.setFromUnitVectors(Y, d.normalize()));
  mesh.scale.y = len;
}
function place(mesh, at, axis) {
  mesh.position.copy(at);
  mesh.quaternion.copy(_q.setFromUnitVectors(Y, axis));
}

const BONE_R = [0.030, 0.024, 0.021, 0.019, 0.016, 0.014];
const bones = BONE_R.map((r) => {
  const m = new Mesh(new CylinderGeometry(r, r, 1, 20), matLink);
  arm.add(m);
  return m;
});

const HUB_R = [0.045, 0.038, 0.031, 0.026, 0.023, 0.020];
const HUB_H = [0.052, 0.058, 0.050, 0.042, 0.038, 0.032];
const hubs = HUB_R.map((r, i) => {
  const m = new Mesh(new CylinderGeometry(r, r, HUB_H[i], 24), matJoint);
  arm.add(m);
  return m;
});
// A bright band round each hub so the joint axes read at a glance.
const bands = HUB_R.map((r, i) => {
  const m = new Mesh(
    new CylinderGeometry(r * 1.04, r * 1.04, HUB_H[i] * 0.24, 24),
    new MeshBasicMaterial({ color: ACCENT })
  );
  arm.add(m);
  return m;
});

const pedestal = new Mesh(
  new CylinderGeometry(0.072, 0.086, 0.030, 32),
  new MeshStandardMaterial({ color: 0x16223a, roughness: 0.7, metalness: 0.4 })
);
pedestal.rotation.x = Math.PI / 2;
pedestal.position.z = 0.015;
world.add(pedestal);

// Gripper: two fingers that close as the arm reaches the fixture.
const tool = new Group();
world.add(tool);
const palm = new Mesh(new CylinderGeometry(0.019, 0.022, 0.020, 20), matTool);
palm.position.y = 0.010;
tool.add(palm);
const fingers = [-1, 1].map((sgn) => {
  const g = new Group();
  const f = new Mesh(new BoxGeometry(0.008, 0.042, 0.018), matTool);
  f.position.y = 0.021;
  g.add(f);
  g.position.set(sgn * 0.017, 0.020, 0);
  tool.add(g);
  return { g, sgn };
});

/* ----------------------------------------------------------------- debris */
// A stand-in for the ENVISAT body: a bus, one boom-mounted panel, and a grapple
// post standing off the bus for the gripper to close around.
//
// The post is the whole reason this reads correctly. Grabbing a flat face means
// the fingers have to end up inside the body, because the fingers run forward of
// the tool tip and the tip is what the inverse kinematics aims. A post gives the
// fingers somewhere to be that is not inside the satellite, which is why real
// capture hardware has one.
//
// Local frame: +x runs out along the post, -y out along the boom.
const debris = new Group();
world.add(debris);

const BUS = 0.062;                 // half of the bus is 31 mm, so the face is at x = 0.0425
const POST_R = 0.005;
const GRASP_X = 0.098;             // where on the post the fingers close
const POST_END = 0.130;

const bus = new Mesh(
  new BoxGeometry(0.085, BUS, BUS),
  new MeshStandardMaterial({ color: 0x2b3752, roughness: 0.75, metalness: 0.35 })
);
debris.add(bus);
debris.add(new LineSegments(
  new EdgesGeometry(bus.geometry),
  new LineBasicMaterial({ color: SLATE, transparent: true, opacity: 0.7 })
));

const matHW = new MeshStandardMaterial({ color: 0x8593ad, roughness: 0.45, metalness: 0.7 });

// Post: a base collar on the bus face, the shaft, and an end flange that stops
// the gripper running off the end of it.
const collar = new Mesh(new CylinderGeometry(0.014, 0.017, 0.014, 20), matHW);
collar.rotation.z = -Math.PI / 2;
collar.position.x = 0.047;
debris.add(collar);

const post = new Mesh(
  new CylinderGeometry(POST_R, POST_R, POST_END - 0.047, 16), matHW);
post.rotation.z = -Math.PI / 2;
post.position.x = (0.047 + POST_END) / 2;
debris.add(post);

const flange = new Mesh(new CylinderGeometry(0.012, 0.012, 0.007, 20), matHW);
flange.rotation.z = -Math.PI / 2;
flange.position.x = POST_END;
debris.add(flange);

// The band the fingers actually close on, marked so the target is obvious.
const fixture = new Mesh(
  new CylinderGeometry(POST_R * 1.15, POST_R * 1.15, 0.020, 18),
  new MeshBasicMaterial({ color: ACCENT })
);
fixture.rotation.z = -Math.PI / 2;
debris.add(fixture);

const boom = new Mesh(new CylinderGeometry(0.004, 0.004, 0.055, 10),
  new MeshStandardMaterial({ color: SLATE, roughness: 0.6, metalness: 0.5 }));
boom.position.y = -0.058;
debris.add(boom);

const panel = new Mesh(
  new BoxGeometry(0.062, 0.150, 0.005),
  new MeshStandardMaterial({ color: 0x14305c, roughness: 0.35, metalness: 0.65 })
);
panel.position.y = -0.160;
debris.add(panel);
const panelEdge = new LineSegments(
  new EdgesGeometry(panel.geometry),
  new LineBasicMaterial({ color: 0x3f6ea8, transparent: true, opacity: 0.8 })
);
panelEdge.position.copy(panel.position);
debris.add(panelEdge);

/* ------------------------------------------------------------- tip trace */
// The whole path is uploaded once and revealed with a draw range, so the trace
// never has to reallocate mid-play.
const traceGeo = new BufferGeometry();
{
  const pts = [];
  const P = new Vector3();
  for (const q of DATA.track) {
    fk(q, POSE);
    originOf(POSE.frames[5], P);
    pts.push(P.x, P.y, P.z);
  }
  traceGeo.setAttribute('position', new Float32BufferAttribute(pts, 3));
}
const trace = new Line(traceGeo, new LineBasicMaterial({
  color: ACCENT, transparent: true, opacity: 0.95
}));
world.add(trace);

// Where each waypoint sits, so the path reads as a plan and not just a smear.
const WP_WORLD = WP.map((w) => {
  fk(w.q, POSE);
  return originOf(POSE.frames[5], new Vector3());
});
for (const p of WP_WORLD) {
  const m = new Mesh(
    new SphereGeometry(0.0055, 12, 8),
    new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55 })
  );
  m.position.copy(p);
  world.add(m);
}

/* ------------------------------------------------- debris resting placement */
const _m4 = new Matrix4();
const _v = new Vector3();

// The tool tip is not the grasp point. The fingers start 20 mm forward of the
// tip and run to 62 mm, so what they close on is about 38 mm out along the tool
// axis. Aiming the inverse kinematics at the tip and then putting the payload at
// the tip is what made the gripper look like it was reaching into the body.
const GRASP_OFFSET = 0.038;

const CAPTURE_POINT = WP_WORLD[CAPTURE].clone();     // where the tool tip goes
const APPROACH = new Vector3();                      // tool z at capture, world
const GRASP_POINT = new Vector3();
{
  fk(WP[CAPTURE].q, POSE);
  axisOf(POSE.frames[5], 2, APPROACH);
  GRASP_POINT.copy(CAPTURE_POINT).addScaledVector(APPROACH, GRASP_OFFSET);
}

const FIXTURE_LOCAL = new Vector3(GRASP_X, 0, 0);
fixture.position.copy(FIXTURE_LOCAL);

// Orientation is derived, not typed in. Local +x runs back up the approach axis
// so the post points straight at the incoming gripper, and the boom is laid
// along the horizontal direction pointing away from the base, which keeps the
// panel clear of both the deck and the arm.
const DEBRIS_REST_Q = new Quaternion();
{
  const X = APPROACH.clone().negate().normalize();
  const outward = new Vector3(GRASP_POINT.x, GRASP_POINT.y, 0).normalize();
  // Remove whatever part of `outward` lies along the post before using it.
  outward.addScaledVector(X, -outward.dot(X)).normalize();
  const Y = outward.clone().negate();               // boom sits on local -y
  const Z = new Vector3().crossVectors(X, Y);
  DEBRIS_REST_Q.setFromRotationMatrix(
    new Matrix4().makeBasis(X, Y, Z)
  );
}

const DEBRIS_REST_POS = GRASP_POINT.clone()
  .sub(FIXTURE_LOCAL.clone().applyQuaternion(DEBRIS_REST_Q));

// Offset from the tool frame to the debris frame, frozen at the capture instant
// so the payload picks up exactly where it was rather than snapping.
const HOLD = new Matrix4();
{
  fk(WP[CAPTURE].q, POSE);
  const restM = new Matrix4().compose(
    DEBRIS_REST_POS, DEBRIS_REST_Q, new Vector3(1, 1, 1)
  );
  HOLD.copy(POSE.frames[5]).invert().multiply(restM);
}

/* ------------------------------------------------------------------ update */
const AX = new Vector3(), O = new Vector3(), OPREV = new Vector3();
const origins = Array.from({ length: 7 }, () => new Vector3());

function update(t) {
  const s = pathAt(t);
  const q = qAt(s);
  fk(q, POSE);

  origins[0].set(0, 0, 0);
  for (let i = 0; i < 6; i++) originOf(POSE.frames[i], origins[i + 1]);

  for (let i = 0; i < 6; i++) {
    span(bones[i], origins[i], origins[i + 1]);
    // Joint i turns about the z axis of the frame before it, at that frame's
    // origin. Frame 0 is the base, so its axis is straight up.
    if (i === 0) AX.set(0, 0, 1);
    else axisOf(POSE.frames[i - 1], 2, AX);
    place(hubs[i], origins[i], AX);
    place(bands[i], origins[i], AX);
  }

  // Gripper rides the last frame.
  tool.position.copy(origins[6]);
  tool.quaternion.setFromRotationMatrix(_m4.extractRotation(POSE.frames[5]));
  tool.quaternion.multiply(_q.setFromUnitVectors(Y, new Vector3(0, 0, 1)));

  // Fingers close over the last stretch of the approach and stay closed.
  const grip = MathUtils.clamp((s - 2.45) / 0.5, 0, 1);
  for (const f of fingers) {
    f.g.position.x = f.sgn * (0.017 - 0.008 * grip);
    f.g.rotation.z = -f.sgn * 0.20 * grip;
  }

  // Debris: tumbling until the arm has matched it, then rigid on the gripper.
  if (t < T_CAPTURE) {
    // Tumble amplitude is wound off over the approach, which is what matching
    // rates with the target would look like from outside.
    const settle = MathUtils.clamp((s - 1.0) / 2.0, 0, 1);
    const amp = 0.16 * (1 - ease(settle));
    debris.position.copy(DEBRIS_REST_POS);
    debris.quaternion.copy(DEBRIS_REST_Q);
    if (amp > 1e-4) {
      debris.quaternion.multiply(
        _q.setFromEuler(new Euler(amp * Math.sin(t * 1.30),
                                  amp * Math.sin(t * 0.87 + 1.1),
                                  amp * Math.sin(t * 1.07 + 2.3)))
      );
    }
  } else {
    _m4.copy(POSE.frames[5]).multiply(HOLD);
    debris.position.setFromMatrixPosition(_m4);
    debris.quaternion.setFromRotationMatrix(_m4);
  }

  // Trace, revealed up to where the tip has got to.
  traceGeo.setDrawRange(0, Math.max(2, Math.round(s * STEP) + 1));

  camera_(t, s);
  hud(t, s, q);
}

/* ----------------------------------------------------------------- camera */
// A slow orbit rather than a fixed view: a still camera on a six-jointed arm
// hides whichever joint happens to be edge-on. Framing is keyed to the path
// parameter, not to wall-clock time, so it stays put when the sequence is
// scrubbed or a chapter is jumped to.
//
// s     where to look                    how far off   elevation
const SHOTS = [
  [0.0, new Vector3(0.05, -0.03, 0.23), 0.94, 24, -0.55],
  [1.0, new Vector3(0.14, -0.08, 0.21), 0.92, 21, -0.32],
  [3.0, new Vector3(0.17, -0.09, 0.19), 0.78, 16, -0.08],
  [4.0, new Vector3(0.13, -0.04, 0.24), 0.90, 22,  0.20],
  [5.0, new Vector3(0.06,  0.09, 0.28), 0.98, 26,  0.60]
];

const camTgt = new Vector3();
function camera_(t, s) {
  let i = 0;
  while (i < SHOTS.length - 2 && s >= SHOTS[i + 1][0]) i++;
  const A = SHOTS[i], B = SHOTS[i + 1];
  const u = ease(MathUtils.clamp((s - A[0]) / (B[0] - A[0]), 0, 1));

  camTgt.copy(A[1]).lerp(B[1], u);
  const dist = A[2] + (B[2] - A[2]) * u;
  const el = MathUtils.degToRad(A[3] + (B[3] - A[3]) * u);
  // A slow constant drift on top of the keyed azimuth, so the view is never
  // completely still even while the arm dwells at a waypoint.
  const az = (A[4] + (B[4] - A[4]) * u) + 0.10 * (t / DUR);

  // Framing rather than a fixed distance: a narrow window needs the camera
  // further back to hold the same subject, and that falls out of the aspect
  // ratio instead of being guessed per breakpoint.
  const aspect = Math.max(0.55, stage.clientWidth / Math.max(1, stage.clientHeight));
  const pull = dist * MathUtils.clamp(1.45 / aspect, 1, 2.1);

  const tw = camTgt.clone().applyMatrix4(world.matrixWorld);
  camera.position.set(
    tw.x + pull * Math.cos(el) * Math.cos(az),
    tw.y + pull * Math.sin(el),
    tw.z + pull * Math.cos(el) * Math.sin(az)
  );
  camera.lookAt(tw);
}

/* -------------------------------------------------------------------- hud */
const capPhase = document.getElementById('cap-phase');
const capNote = document.getElementById('cap-note');
const jointBox = document.getElementById('joints');

const rows = LIMITS.map((lim, i) => {
  const name = document.createElement('span');
  name.className = 'jn';
  name.textContent = 'J' + (i + 1);
  const track = document.createElement('span');
  track.className = 'jt';
  const zero = document.createElement('i');
  zero.className = 'jz';
  zero.style.left = (100 * (0 - lim[0]) / (lim[1] - lim[0])) + '%';
  const mark = document.createElement('i');
  mark.className = 'jm';
  track.append(zero, mark);
  const val = document.createElement('span');
  val.className = 'jv';
  const wrap = document.createElement('span');
  jointBox.append(name, track, val);
  return { name, track, mark, val, lim };
});

let shownPhase = -1;
function hud(t, s, q) {
  // Dwelling on a waypoint names that waypoint. Moving between two names the
  // one being moved to, which is what the caption is for.
  const at = Math.abs(s - Math.round(s)) < 1e-6
    ? Math.round(s)
    : Math.min(NSEG, Math.ceil(s));
  if (at !== shownPhase) {
    shownPhase = at;
    capPhase.textContent = WP[at].name;
    capNote.textContent = WP[at].note;
  }

  for (let i = 0; i < 6; i++) {
    const r = rows[i];
    const deg = q[i] * 180 / Math.PI;
    const u = (deg - r.lim[0]) / (r.lim[1] - r.lim[0]);
    r.mark.style.left = (100 * MathUtils.clamp(u, 0, 1)) + '%';
    r.val.textContent = (deg >= 0 ? '+' : '') + deg.toFixed(1) + '°';
    // Flag a joint inside ten per cent of either stop.
    r.name.parentElement.classList.toggle('near', u < 0.10 || u > 0.90);
    r.name.classList.toggle('near', false);
    r.track.classList.toggle('near', u < 0.10 || u > 0.90);
    r.val.classList.toggle('near', u < 0.10 || u > 0.90);
    r.mark.classList.toggle('near', u < 0.10 || u > 0.90);
  }

  const f = t / DUR;
  fill.style.width = (100 * f) + '%';
  bar.setAttribute('aria-valuenow', Math.round(100 * f));
  bar.setAttribute('aria-valuetext', WP[at].name);

  let ch = 0;
  for (let i = 0; i < CHAPTERS.length; i++) if (t >= CHAPTERS[i].t0) ch = i;
  chaps.forEach((b, i) => b.classList.toggle('on', i === ch));
}

/* --------------------------------------------------------------- controls */
const shell = document.getElementById('shell');
const playBtn = document.getElementById('play');
const bar = document.getElementById('bar');
const fill = document.getElementById('fill');
const chaps = Array.from(document.querySelectorAll('.chap'));

for (const m of MARKS) {
  const tick = document.createElement('i');
  tick.className = 'wp';
  tick.style.left = (100 * m.in / DUR) + '%';
  bar.appendChild(tick);
}

let time = 0;
let playing = false;
let allowed = false;
let last = 0;

function setPlaying(on) {
  playing = on;
  playBtn.dataset.state = on ? 'playing' : 'paused';
  playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

function seek(t) {
  time = MathUtils.clamp(t, 0, DUR);
  update(time);
}

playBtn.addEventListener('click', () => {
  if (!playing && time >= DUR - 0.01) seek(0);
  allowed = true;
  setPlaying(!playing);
});

function scrubTo(clientX) {
  const r = bar.getBoundingClientRect();
  seek(DUR * MathUtils.clamp((clientX - r.left) / r.width, 0, 1));
}
let scrubbing = false;
bar.addEventListener('pointerdown', (e) => {
  scrubbing = true;
  bar.setPointerCapture(e.pointerId);
  setPlaying(false);
  scrubTo(e.clientX);
});
bar.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e.clientX); });
bar.addEventListener('pointerup', (e) => {
  scrubbing = false;
  bar.releasePointerCapture(e.pointerId);
});
bar.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 2 : 0.4;
  if (e.key === 'ArrowRight') { seek(time + step); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { seek(time - step); e.preventDefault(); }
});

chaps.forEach((b, i) => b.addEventListener('click', () => {
  allowed = true;
  seek(CHAPTERS[i].t0 + 0.02);
  setPlaying(true);
}));

function chapterFromHash() {
  const h = (location.hash || '').replace('#', '');
  const i = CHAPTERS.findIndex((c) => c.id === h);
  return i < 0 ? 0 : i;
}

/* ----------------------------------------------------------------- resize */
function resize() {
  const w = stage.clientWidth || 1;
  const h = stage.clientHeight || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  update(time);
}
window.addEventListener('resize', resize);

/* --------------------------------------------- visibility, in page and out */
// Inside an iframe an IntersectionObserver only sees the iframe's own viewport,
// so the parent tells us when the embed is actually on screen. Standalone, no
// message ever arrives and we simply play.
let heardFromParent = false;
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'viewer-visibility') return;
  heardFromParent = true;
  allowed = !!e.data.visible;
  if (!allowed) setPlaying(false);
  else if (time < DUR - 0.01) setPlaying(true);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPlaying(false);
  else if (allowed && time < DUR - 0.01) setPlaying(true);
});

/* -------------------------------------------------------------------- loop */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (playing) {
    time += dt;
    if (time >= DUR) { time = DUR; setPlaying(false); }
    update(time);
  }
  renderer.render(scene, camera);
}

const reduce = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

resize();
update(0);
setPlaying(false);
requestAnimationFrame((n) => { last = n; frame(n); });

const start = chapterFromHash();
if (start > 0) seek(CHAPTERS[start].t0 + 0.02);

if (reduce) {
  seek(MARKS[CAPTURE].in);
  shell.classList.add('static');
} else {
  setTimeout(() => { if (!heardFromParent) { allowed = true; setPlaying(true); } }, 700);
}

window.__viewer = {
  seek, resize, DUR, CHAPTERS, MARKS,
  get time() { return time; },
  get playing() { return playing; },
  // Numeric probe so the arm can be checked against the kinematics rather than
  // by looking at it: joint angles, tip position, and how far the gripper is
  // from the fixture it is supposed to be holding.
  probe() {
    const s = pathAt(time);
    const q = qAt(s);
    fk(q, POSE);
    const tip = originOf(POSE.frames[5], new Vector3());
    const zAx = axisOf(POSE.frames[5], 2, new Vector3());
    // What the fingers are actually round, not where the tool origin is.
    const grasp = tip.clone().addScaledVector(zAx, GRASP_OFFSET);
    const fx = fixture.getWorldPosition(new Vector3());
    const tipW = tip.clone().applyMatrix4(world.matrixWorld);
    const graspW = grasp.clone().applyMatrix4(world.matrixWorld);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const screen = tipW.clone().project(camera);
    return {
      s, time, qDeg: q.map((v) => v * 180 / Math.PI),
      tip: [tip.x, tip.y, tip.z],
      reach: tip.length(),
      gripGapMm: fx.distanceTo(graspW) * 1000,
      overrunDeg: q.reduce((acc, v, i) => {
        const d = v * 180 / Math.PI;
        return acc + Math.max(0, LIMITS[i][0] - d) + Math.max(0, d - LIMITS[i][1]);
      }, 0),
      sx: screen.x, sy: screen.y
    };
  }
};
