# Kinematics for the 6-DOF capture arm.
#
# Emits src/arm-data.json: DH table, joint limits, the capture waypoints, the
# joint solution at each waypoint, and the interpolated trajectory the viewer
# plays back.
#
# The report solves this in three parts and so does this file:
#   forward kinematics   T = A1 A2 A3 A4 A5 A6
#   inverse kinematics   wrist centre -> theta1..3, then R36 -> theta4..6
#   path planning        linear interpolation between waypoint joint vectors
#
# Run: python3 tools/compute_arm.py

import json
import math
import numpy as np

PI = math.pi

# ---------------------------------------------------------------- DH table
#
# Niryo One geometry, from the mechanical specification and the serial-manipulator
# reference listed in the report. Columns are (a, alpha, d, theta_offset) in metres
# and radians. theta_i = theta_offset_i + q_i, so q = 0 is the home pose.
#
# The table printed in the report (Table 2) will not close: it puts a 0.902 m link
# in the forearm of a 0.44 m robot and carries twist angles of a few degrees where
# the Niryo One has right angles. Rebuilt here from the cited source so the arm on
# the page is the arm the report describes.
DH = [
    (0.0,    -PI / 2, 0.103,  0.0),
    (0.210,   0.0,    0.0,   -PI / 2),
    (0.0415, -PI / 2, 0.0,    0.0),
    (0.0,     PI / 2, 0.180,  0.0),
    (0.0,    -PI / 2, 0.0,    0.0),
    (0.0,     0.0,    0.0237, 0.0),
]

# Table 1 of the report, degrees.
LIMITS_DEG = [
    (-175.0, 175.0),
    (-90.0, 36.7),
    (-80.0, 90.0),
    (-174.0, 175.0),
    (-100.0, 110.0),
    (-147.5, 147.5),
]
LIMITS = [(math.radians(a), math.radians(b)) for a, b in LIMITS_DEG]

D1 = DH[0][2]        # base to shoulder
A2 = DH[1][0]        # upper arm
A3 = DH[2][0]        # elbow offset
D4 = DH[3][2]        # forearm
D6 = DH[5][2]        # wrist centre to tool tip

# The forearm is the elbow offset and the wrist offset taken together, so the
# planar two-link solve uses its length and the angle it sits at.
L3 = math.hypot(A3, D4)
PHI = math.atan2(A3, D4)


def dh_matrix(a, alpha, d, theta):
    ct, st = math.cos(theta), math.sin(theta)
    ca, sa = math.cos(alpha), math.sin(alpha)
    return np.array([
        [ct, -st * ca,  st * sa, a * ct],
        [st,  ct * ca, -ct * sa, a * st],
        [0.0,      sa,       ca,      d],
        [0.0,     0.0,      0.0,    1.0],
    ])


def forward(q):
    """Joint origins in the base frame plus the end effector pose."""
    T = np.eye(4)
    frames = [T.copy()]
    for (a, alpha, d, off), qi in zip(DH, q):
        T = T @ dh_matrix(a, alpha, d, off + qi)
        frames.append(T.copy())
    return frames


def ee(q):
    return forward(q)[-1]


# ---------------------------------------------------------------- inverse
#
# Inverse position problem: back the tool tip off along its own z to get the
# wrist centre, then solve the shoulder and elbow as a planar two-link chain.
# Inverse orientation problem: strip the first three joints off the target
# rotation and read the last three angles out of what is left.

def inverse(T_target, elbow_up=True, shoulder_front=True, wrist_flip=False):
    p = T_target[:3, 3]
    R = T_target[:3, :3]
    wc = p - D6 * R[:, 2]

    t1 = math.atan2(wc[1], wc[0])
    u = math.hypot(wc[0], wc[1])
    if not shoulder_front:
        t1 += PI
        u = -u
    v = wc[2] - D1

    # Shoulder and elbow are a planar two-link chain in the plane theta1 swept
    # out. Angles here are measured from the base z axis, which is where q2 = 0
    # puts the upper arm, so they drop straight into the joint variables.
    c = (u * u + v * v - A2 * A2 - L3 * L3) / (2.0 * A2 * L3)
    if abs(c) > 1.0:
        return None                      # target is outside the reachable shell
    s = math.sqrt(max(0.0, 1.0 - c * c))
    if elbow_up:
        s = -s
    delta = math.atan2(s, c)             # elbow bend

    t2 = math.atan2(u, v) - math.atan2(L3 * s, A2 + L3 * c)
    t3 = delta - PI / 2 + PHI

    # Orientation. R30 comes straight out of the forward pass with the wrist
    # zeroed, so there is no second derivation to keep in step with the first.
    R30 = forward([t1, t2, t3, 0.0, 0.0, 0.0])[3][:3, :3]
    R36 = R30.T @ R

    # Two wrist branches reach the same orientation: joint 5 positive with one
    # pair of outer angles, or negative with both of them turned half a turn.
    sin5 = math.hypot(R36[2, 0], R36[2, 1])
    if wrist_flip:
        sin5 = -sin5
    t5 = math.atan2(sin5, R36[2, 2])
    if abs(sin5) < 1e-8:
        t4 = 0.0                          # wrist singularity, spend it all on joint 6
        t6 = math.atan2(-R36[0, 1], R36[0, 0]) * (1.0 if R36[2, 2] > 0 else -1.0)
    else:
        t4 = math.atan2(-R36[1, 2] / sin5, -R36[0, 2] / sin5)
        t6 = math.atan2(-R36[2, 1] / sin5,  R36[2, 0] / sin5)

    return [t1, t2, t3, t4, t5, t6]


def wrap(a):
    return (a + PI) % (2 * PI) - PI


def overrun(q):
    """Total radians by which a configuration breaks the Table 1 joint limits."""
    return sum(max(0.0, lo - v) + max(0.0, v - hi)
               for v, (lo, hi) in zip(q, LIMITS))


def solve(T_target, near=None):
    """Every branch of the inverse solution, scored.

    Eight configurations reach the same pose. Rank them by joint limits first,
    then by how far they sit from the previous waypoint. Ignoring the second
    test lets the arm flip between branches mid-path, which is the sort of thing
    that reads as a smooth interpolation on paper and throws the elbow through
    the payload in the simulation.
    """
    best = None
    for elbow_up in (True, False):
        for front in (True, False):
            for flip in (False, True):
                q = inverse(T_target, elbow_up, front, flip)
                if q is None:
                    continue
                q = [wrap(v) for v in q]
                dp, da = pose_error(q, T_target)
                if dp > 1e-9 or da > 1e-7:
                    continue
                travel = (sum(abs(v - p) for v, p in zip(q, near)) if near
                          else sum(abs(v) for v in q))
                score = (round(overrun(q), 9), travel)
                if best is None or score < best[0]:
                    best = (score, q)
    return best[1] if best else None


def solve_pose(p, look, near=None, rolls=72):
    """Solve for a tip position and tool direction, leaving the roll free.

    Spin about the tool axis does not change where the gripper points, so the
    roll is a free parameter and picking it is part of the planning problem, not
    a given. Sweep it and keep the configuration that stays inside the limits.
    """
    best = None
    for i in range(rolls):
        roll = 2 * PI * i / rolls
        T = pose(p, look, roll)
        q = solve(T, near)
        if q is None:
            continue
        travel = (sum(abs(v - r) for v, r in zip(q, near)) if near
                  else sum(abs(v) for v in q))
        score = (round(overrun(q), 9), travel)
        if best is None or score < best[0]:
            best = (score, q, T)
    return (best[1], best[2]) if best else (None, None)


def pose_error(q, T_target):
    T = ee(q)
    dp = float(np.linalg.norm(T[:3, 3] - T_target[:3, 3]))
    dR = T[:3, :3].T @ T_target[:3, :3]
    c = (np.trace(dR) - 1.0) / 2.0
    da = float(math.acos(max(-1.0, min(1.0, c))))
    return dp, da


# ---------------------------------------------------------------- waypoints

def pose(p, look, roll=0.0):
    """Tool frame at p with its z axis along `look`, spun by `roll` about it."""
    z = np.array(look, dtype=float)
    z /= np.linalg.norm(z)
    up = np.array([0.0, 0.0, 1.0])
    if abs(float(z @ up)) > 0.95:
        up = np.array([1.0, 0.0, 0.0])
    x = np.cross(up, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    c, s = math.cos(roll), math.sin(roll)
    x, y = c * x + s * y, -s * x + c * y
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2] = x, y, z
    T[:3, 3] = np.array(p, dtype=float)
    return T


# The debris drifts past off the front right of the base. The arm reaches out to
# meet it, closes on the grapple fixture, lifts it clear of its drift path and
# swings it round to the stowage point on the other side.
DEBRIS = np.array([0.270, -0.132, 0.190])
APPROACH_AXIS = np.array([0.62, -0.30, -0.72])     # tool z at the fixture
BERTH = np.array([0.054,  0.254, 0.330])

# Approach and retreat run along the tool axis, so the gripper never crabs
# sideways across the fixture.
def along(k):
    v = APPROACH_AXIS / np.linalg.norm(APPROACH_AXIS)
    return DEBRIS - k * v

WAYPOINTS = [
    ("Stowed",   "Folded in against the station. Nothing is loaded.",
     {'q': [0.0, math.radians(-56.0), math.radians(66.0), 0.0,
            math.radians(-16.0), 0.0]}),
    ("Standoff", "Lined up on the grapple fixture and held off by 110 mm.",
     {'p': along(0.110), 'look': APPROACH_AXIS}),
    ("Approach", "Closing straight down the tool axis, so the gripper never crabs sideways across the fixture.",
     {'p': along(0.040), 'look': APPROACH_AXIS}),
    ("Capture",  "Gripper closed on the fixture. The shoulder sits under 4 degrees off its forward limit here.",
     {'p': along(0.0), 'look': APPROACH_AXIS}),
    ("Lift",     "Backed off along the same line, debris off its drift path.",
     {'p': along(0.130), 'look': APPROACH_AXIS}),
    ("Berth",    "Swung round to the stowage point and set down.",
     {'p': BERTH, 'look': [0.10, 0.50, -0.86]}),
]


def interpolate(qa, qb, n):
    """q(t) = (1-t) qa + t qb, the report's linear joint interpolation."""
    return [[(1.0 - t) * a + t * b for a, b in zip(qa, qb)]
            for t in (i / (n - 1) for i in range(n))]


def main():
    solutions = []
    prev = None
    for name, note, spec in WAYPOINTS:
        if 'q' in spec:
            # Home is a joint configuration, not a target in space, so it is
            # given directly and the pose is whatever forward kinematics says.
            q = spec['q']
            T = ee(q)
        else:
            q, T = solve_pose(spec['p'], spec['look'], near=prev)
            if q is None:
                raise SystemExit(f'no reachable solution for waypoint "{name}"')
        prev = q
        dp, da = pose_error(q, T)
        over = [round(math.degrees(max(0.0, lo - v) + max(0.0, v - hi)), 2)
                for v, (lo, hi) in zip(q, LIMITS)]
        solutions.append({
            'name': name,
            'note': note,
            'q': [round(v, 6) for v in q],
            'target': [round(float(v), 5) for v in T[:3, 3]],
            'posErrMm': round(dp * 1000.0, 4),
            'rotErrDeg': round(math.degrees(da), 4),
            'limitOverDeg': over,
        })
        print(f'{name:9s} q(deg) = ' +
              ' '.join(f'{math.degrees(v):7.1f}' for v in q) +
              f'   pos err {dp*1000:7.4f} mm   rot err {math.degrees(da):7.4f} deg' +
              ('   LIMIT VIOLATION' if any(o > 0 for o in over) else ''))

    # One segment per waypoint pair, sampled fine enough that the tip traces a
    # smooth curve rather than a chain of chords.
    STEPS = 60
    track = []
    for i in range(len(solutions) - 1):
        seg = interpolate(solutions[i]['q'], solutions[i + 1]['q'], STEPS)
        if i:
            seg = seg[1:]
        track.extend(seg)

    # Only the joint angles ship. The viewer runs the same forward kinematics in
    # the browser, so the arm you see is drawn from the DH table rather than from
    # a baked list of coordinates. tip[] here is for the checks below only.
    tip = [[float(v) for v in forward(q)[-1][:3, 3]] for q in track]

    # Joint limits are a box and linear interpolation between two points in a box
    # stays in the box, so this should be zero. Checked rather than assumed.
    worst = max(overrun(q) for q in track)
    if worst > 1e-12:
        raise SystemExit(f'path leaves the joint limits by {math.degrees(worst):.3f} deg')

    reach = max(float(np.linalg.norm(np.array(p))) for p in tip)
    print(f'\ntrack: {len(track)} configurations, max tip radius {reach*1000:.1f} mm, '
          f'every configuration inside the Table 1 limits')
    print('joint travel (deg):', [
        round(math.degrees(max(t[j] for t in track) - min(t[j] for t in track)), 1)
        for j in range(6)])

    data = {
        'dh': [{'a': a, 'alpha': al, 'd': d, 'theta': th} for a, al, d, th in DH],
        'limitsDeg': LIMITS_DEG,
        'debris': [round(float(v), 4) for v in DEBRIS],
        'waypoints': solutions,
        'stepsPerSegment': STEPS,
        'track': [[round(v, 5) for v in q] for q in track],
    }
    with open('src/arm-data.json', 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print('wrote src/arm-data.json')


if __name__ == '__main__':
    main()
