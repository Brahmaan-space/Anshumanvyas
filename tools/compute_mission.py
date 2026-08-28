"""Compute every leg of the L1 mission and emit the polylines the viewer draws.

Nothing here is invented. The parking orbit, the four perigee raises and the
escape burn come from the report's own maneuver table; the heliocentric leg is a
Lambert arc; the halo is the differentially corrected orbit from section 08. The
output is src/mission-data.json, which build.mjs inlines into the viewer.

Run: python3 tools/compute_mission.py
"""

import json
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import brentq

# ----------------------------------------------------------------- constants
MU_EARTH = 398600.0            # km^3/s^2
RE       = 6378.0              # km
R_SOI    = 925000.0            # km, Earth's sphere of influence
MU_SUN_L = 1.3271e11           # km^3/s^2, as used by the report's Lambert solver
AU       = 1.496e8             # km, as used by ConvertToHeliocentric
V_EARTH  = 29.78               # km/s

# CR3BP constants (section 05/08 of the writeup)
MU_SUN_C   = 132712440018.0
MU_EARTH_C = 398600.4418
MU   = MU_EARTH_C / (MU_SUN_C + MU_EARTH_C)
DIST = 149597870.7
TU   = np.sqrt(DIST**3 / (MU_SUN_C + MU_EARTH_C))

INC     = np.radians(19.2)
ARGP    = np.radians(346.6)
# perigee/apogee ALTITUDES, km -- the report's maneuver table
STAGES  = [(235, 19500), (245, 22459), (282, 40225), (296, 71767), (256, 121973)]
T_TRANSFER = 110 * 86400.0     # s
OMEGA_E    = 2 * np.pi / (365.25 * 86400.0)

Rx = np.array([[1, 0, 0], [0, np.cos(INC), -np.sin(INC)], [0, np.sin(INC), np.cos(INC)]])
Rz = np.array([[np.cos(ARGP), -np.sin(ARGP), 0], [np.sin(ARGP), np.cos(ARGP), 0], [0, 0, 1]])
ROT = Rx @ Rz


def twobody(mu):
    def f(t, y):
        r = np.linalg.norm(y[:3])
        return [y[3], y[4], y[5], *(-mu * y[:3] / r**3)]
    return f


def thin(arr, n):
    """Downsample a polyline to n points, always keeping both ends."""
    if len(arr) <= n:
        return arr
    idx = np.unique(np.linspace(0, len(arr) - 1, n).round().astype(int))
    return arr[idx]


def r3(a):
    return [[round(float(v), 3) for v in p] for p in a]


# ============================================================ phase 1: raises
# Every burn happens at the same physical perigee point: position cannot jump,
# only speed changes. That is why r0 is computed once and reused.
r0 = ROT @ np.array([RE + STAGES[0][0], 0.0, 0.0])

raises, vp_last = [], None
for alt_p, alt_a in STAGES:
    rp, ra = RE + alt_p, RE + alt_a
    a = 0.5 * (rp + ra)
    vp = np.sqrt(MU_EARTH * (2.0 / rp - 1.0 / a))
    v0 = ROT @ np.array([0.0, vp, 0.0])
    T = 2 * np.pi * np.sqrt(a**3 / MU_EARTH)
    sol = solve_ivp(twobody(MU_EARTH), [0, T], [*r0, *v0],
                    rtol=1e-10, atol=1e-6, dense_output=True)
    # Uniform in TIME, not in solver steps: the viewer advances one index per
    # frame, so the craft has to slow at apogee on its own.
    pts = sol.sol(np.linspace(0, T, 260)).T[:, :3]
    raises.append({'apogee_km': round(ra - RE), 'pts': r3(pts)})
    vp_last = vp
print(f'phase 1: {len(raises)} orbits, final apogee {STAGES[-1][1]:,} km alt')

# ============================================================ phase 2: escape
rp5 = RE + STAGES[4][0]
v_esc = np.sqrt(2 * MU_EARTH / rp5)          # exactly escape speed, per the report
dv_esc = v_esc - vp_last
v0 = ROT @ np.array([0.0, v_esc, 0.0])

soi = lambda t, y: np.linalg.norm(y[:3]) - R_SOI
soi.terminal, soi.direction = True, 1
sol = solve_ivp(twobody(MU_EARTH), [0, 60 * 86400], [*r0, *v0],
                rtol=1e-10, atol=1e-6, events=soi, dense_output=True, max_step=3600)
t_soi = sol.t_events[0][0]
exit_r = sol.y_events[0][0][:3]
exit_v = sol.y_events[0][0][3:]
escape_pts = thin(sol.sol(np.linspace(0, t_soi, 1400)).T[:, :3], 320)
print(f'phase 2: SOI at {np.linalg.norm(exit_r):,.0f} km after {t_soi/86400:.1f} d, '
      f'escape burn {dv_esc*1000:.0f} m/s')

# ================================================= halo (needed to aim phase 3)
def cr3bp(t, y):
    x, yy, z, vx, vy, vz = y
    r1 = np.sqrt((x + MU)**2 + yy*yy + z*z)
    r2 = np.sqrt((x - 1 + MU)**2 + yy*yy + z*z)
    return [vx, vy, vz,
            2*vy + x - (1-MU)*(x+MU)/r1**3 - MU*(x-1+MU)/r2**3,
            -2*vx + yy - (1-MU)*yy/r1**3 - MU*yy/r2**3,
            -(1-MU)*z/r1**3 - MU*z/r2**3]

def half_period(x0, z0, vy0):
    s = solve_ivp(cr3bp, [0, 1e-3], [x0, 0, z0, 0, vy0, 0],
                  rtol=3e-13, atol=1e-14, method='DOP853').y[:, -1]
    ev = lambda t, y: y[1]
    ev.terminal, ev.direction = True, 0
    b = solve_ivp(cr3bp, [1e-3, 10], s, rtol=3e-13, atol=1e-13, method='DOP853', events=ev)
    return b.t_events[0][0], b.y_events[0][0]

def correct(x0, z0, vy0, tol=1e-9):
    for it in range(1, 61):
        th, sh = half_period(x0, z0, vy0)
        if abs(sh[3]) < tol and abs(sh[5]) < tol:
            return x0, vy0, th
        d = 1e-6
        _, s1 = half_period(x0 + d, z0, vy0)
        _, s2 = half_period(x0, z0, vy0 + d)
        J = np.array([[(s1[3]-sh[3])/d, (s2[3]-sh[3])/d],
                      [(s1[5]-sh[5])/d, (s2[5]-sh[5])/d]])
        dl = np.linalg.solve(J, -np.array([sh[3], sh[5]]))
        # Damped early, same as cr3bp/differential_correct.m. An undamped first
        # step overshoots the basin and the corrector never comes back.
        scale = min(1.0, 0.5 + 0.1 * it)
        x0 += scale * dl[0]; vy0 += scale * dl[1]
    raise RuntimeError('halo corrector did not converge')

coll = lambda x: x - (1-MU)*(x+MU)/abs(x+MU)**3 - MU*(x-1+MU)/abs(x-1+MU)**3
xL1 = brentq(coll, 0.98, 1 - MU - 1e-9, xtol=1e-15, rtol=8.9e-16)

AZ = 120000.0 / DIST
x0, vy0, t_half = correct(xL1 - 0.0008, AZ, 0.009)   # basin-safe seed, see section 08
period = 2 * t_half
s0 = np.array([x0, 0, AZ, 0, vy0, 0])
loops = solve_ivp(cr3bp, [0, 3 * period], s0, rtol=3e-13, atol=1e-13,
                  method='DOP853', dense_output=True)
halo_nd = loops.sol(np.linspace(0, period, 600)).T[:, :3]
print(f'halo: x0={x0:.10f} vy0={vy0:.10f} period={period*TU/86400:.3f} d')

# where the transfer should aim: the halo's own insertion point, in km,
# measured in the rotating frame from the barycentre
halo_km = halo_nd * DIST
insert_rot = halo_km[0]

# ======================================================= phase 3: Lambert arc
def lambert(R1, R2, dt, mu, prograde=True):
    """Universal-variable Lambert solver (Curtis, algorithm 5.2)."""
    r1, r2 = np.linalg.norm(R1), np.linalg.norm(R2)
    c = np.cross(R1, R2)
    dnu = np.arccos(np.clip(np.dot(R1, R2) / (r1 * r2), -1, 1))
    if (prograde and c[2] < 0) or (not prograde and c[2] >= 0):
        dnu = 2 * np.pi - dnu
    A = np.sin(dnu) * np.sqrt(r1 * r2 / (1 - np.cos(dnu)))

    def C(z):
        if z > 0:  return (1 - np.cos(np.sqrt(z))) / z
        if z < 0:  return (np.cosh(np.sqrt(-z)) - 1) / (-z)
        return 0.5

    def S(z):
        if z > 0:
            sq = np.sqrt(z);  return (sq - np.sin(sq)) / sq**3
        if z < 0:
            sq = np.sqrt(-z); return (np.sinh(sq) - sq) / sq**3
        return 1.0 / 6.0

    def y(z):
        return r1 + r2 + A * (z * S(z) - 1) / np.sqrt(C(z))

    def F(z):
        return (y(z) / C(z))**1.5 * S(z) + A * np.sqrt(y(z)) - np.sqrt(mu) * dt

    # y(z) goes negative below some z and F is then NaN, so bracket by scanning
    # the region where y stays positive rather than assuming a fixed lower bound.
    grid = np.linspace(-4 * np.pi**2 + 1e-6, 4 * np.pi**2 - 1e-6, 40000)
    vals = np.full(grid.shape, np.nan)
    for i, zz in enumerate(grid):
        if y(zz) > 0:
            vals[i] = F(zz)
    ok = np.isfinite(vals)
    sign_change = np.where(ok[:-1] & ok[1:] & (np.sign(vals[:-1]) != np.sign(vals[1:])))[0]
    if len(sign_change) == 0:
        raise RuntimeError('Lambert: no bracket for this time of flight')
    i = sign_change[0]
    z = brentq(F, grid[i], grid[i + 1], xtol=1e-12)

    f = 1 - y(z) / r1
    g = A * np.sqrt(y(z) / mu)
    gdot = 1 - y(z) / r2
    V1 = (R2 - f * R1) / g
    V2 = (gdot * R2 - R1) / g
    return V1, V2

R1 = exit_r + np.array([AU, 0.0, 0.0])          # heliocentric, per ConvertToHeliocentric
theta1 = OMEGA_E * T_TRANSFER                   # how far Earth swings during the coast
Rz1 = np.array([[np.cos(theta1), -np.sin(theta1), 0],
                [np.sin(theta1),  np.cos(theta1), 0], [0, 0, 1]])
R2 = Rz1 @ insert_rot                            # aim at the halo, not at L1 itself

V1, V2 = lambert(R1, R2, T_TRANSFER, MU_SUN_L)
sol = solve_ivp(twobody(MU_SUN_L), [0, T_TRANSFER], [*R1, *V1],
                rtol=1e-11, atol=1e-4, dense_output=True)
transfer = sol.sol(np.linspace(0, T_TRANSFER, 900)).T[:, :3]
miss = np.linalg.norm(transfer[-1] - R2)
v_arrive = sol.sol(T_TRANSFER)[3:]
print(f'phase 3: {T_TRANSFER/86400:.0f} d, miss {miss:,.0f} km, '
      f'departure dv {np.linalg.norm(V1 - (exit_v + np.array([0, V_EARTH, 0])))*1000:.0f} m/s')

# ------------------------------------------------------------------- exports
# Act 2 is drawn in the inertial frame and then de-spun into the rotating frame
# for act 3, so the viewer needs the transfer arc in inertial coordinates and
# everything else in rotating coordinates.
earth_helio = AU * np.column_stack([np.cos(OMEGA_E * np.linspace(0, T_TRANSFER, 240)),
                                    np.sin(OMEGA_E * np.linspace(0, T_TRANSFER, 240)),
                                    np.zeros(240)])

data = {
  'meta': {
    'earthRadiusKm': RE,
    'soiKm': R_SOI,
    'auKm': AU,
    'distKm': DIST,
    'xL1Km': xL1 * DIST,
    'earthRotKm': (1 - MU) * DIST,
    'transferDays': T_TRANSFER / 86400.0,
    'escapeDays': round(t_soi / 86400.0, 2),
    'haloDays': round(period * TU / 86400.0, 3),
    'thetaTransfer': theta1,
    'escapeDvMs': round(dv_esc * 1000.0),
    'raiseApogees': [s[1] for s in STAGES],
  },
  # act 1, Earth-centred frame, km
  'raises': raises,
  'escape': r3(escape_pts),
  # act 2, heliocentric inertial frame, km
  'transfer': r3(thin(transfer, 420)),
  'earthOrbit': r3(thin(earth_helio, 240)),
  # act 3, rotating frame, km from the barycentre
  'halo': r3(thin(halo_km, 480)),
}

with open('src/mission-data.json', 'w') as f:
    json.dump(data, f, separators=(',', ':'))
import os
print(f'wrote src/mission-data.json  {os.path.getsize("src/mission-data.json")/1024:.0f} KB')
