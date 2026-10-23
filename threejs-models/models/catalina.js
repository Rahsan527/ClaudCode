import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Consolidated PBY-5 Catalina (RAF Catalina Mk I/IB) — летающая лодка Берегового командования RAF, без шасси.
// Масштаб 1:1, метры. Y вверх, нос +X, правое (starboard) крыло +Z. Киль на y = 0, ватерлиния ~0.9 м.
// Длина 19.47 м (нос — руль), размах 31.7 м, высота ~6 м. Поплавки на концах крыла выпущены (на воде).
// Окраска Coastal Command: белые борта и низ, верх — Extra Dark Sea Grey / Dark Slate Grey,
// опознавательные знаки RAF (тип B сверху крыла, C1 на борту, флэш на киле), без номеров и кодов.
// Подвижные части — отдельные группы с нулевым поворотом в покое и началом на оси движения.
// Перед лодкой — швартовый конец с буем (группа Mooring_Gear, её можно скрыть в полёте).

const ATLAS = 2048;
const XH0 = -8.75; // корма лодки
const XH1 = 9.62; // нос лодки
const WY = 4.62; // плоскость хорд крыла
const PROP = { x: 3.6, y: 4.55, z: 3.75, r: 1.84 };

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// кусочно-линейная интерполяция по таблице [[x, v], ...] (x по убыванию или возрастанию)
function tab(table, x) {
  const asc = table[0][0] < table[table.length - 1][0];
  const T = asc ? table : [...table].reverse();
  if (x <= T[0][0]) return T[0][1];
  if (x >= T[T.length - 1][0]) return T[T.length - 1][1];
  for (let i = 1; i < T.length; i++) {
    if (x <= T[i][0]) {
      const t = (x - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
      return lerp(T[i - 1][1], T[i][1], smooth(t) * 0.5 + t * 0.5);
    }
  }
  return T[T.length - 1][1];
}

// ---------------------------------------------------------------------------
// ГЕОМЕТРИЧЕСКИЕ ПОМОЩНИКИ

class Mesher {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }
  v(p, u = 0.5, w = 0.5) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(clamp01(u), clamp01(w));
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  strip(A, B, closed = false) {
    const n = A.length;
    for (let j = 0; j < (closed ? n : n - 1); j++) {
      const k = (j + 1) % n;
      this.quad(A[j], B[j], B[k], A[k]);
    }
  }
  fan(ring, center, flip) {
    for (let j = 0; j < ring.length; j++) {
      const k = (j + 1) % ring.length;
      if (flip) this.tri(center, ring[k], ring[j]);
      else this.tri(center, ring[j], ring[k]);
    }
  }
  build({ orient = true, flip = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const P = this.pos;
    const keep = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < this.idx.length; i += 3) {
      const [i0, i1, i2] = [this.idx[i], this.idx[i + 1], this.idx[i + 2]];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      a.fromArray(P, i0 * 3);
      b.fromArray(P, i1 * 3);
      c.fromArray(P, i2 * 3);
      if (b.sub(a).cross(c.sub(a)).length() > 1e-8) keep.push(i0, i1, i2);
    }
    if ((orient && signedVolume(P, keep) < 0) || flip) {
      for (let i = 0; i < keep.length; i += 3) [keep[i + 1], keep[i + 2]] = [keep[i + 2], keep[i + 1]];
    }
    g.setIndex(keep);
    g.computeVertexNormals();
    return g;
  }
}
function signedVolume(pos, idx) {
  let cx = 0, cy = 0, cz = 0;
  const n = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) {
    cx += pos[i];
    cy += pos[i + 1];
    cz += pos[i + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a] - cx, ay = pos[a + 1] - cy, az = pos[a + 2] - cz;
    const bx = pos[b] - cx, by = pos[b + 1] - cy, bz = pos[b + 2] - cz;
    const qx = pos[c] - cx, qy = pos[c + 1] - cy, qz = pos[c + 2] - cz;
    vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  return vol;
}

// Тело вращения вокруг Y по профилю [[r, y], ...]; r = 0 — полюс; низ с r > 0 открыт, если не bottom
function lathe(profile, seg = 20, { bottom = false, uvScale = [1, 1], uvFixed = null } = {}) {
  const m = new Mesher();
  const n = profile.length;
  const rings = [];
  const UV = (u, v) => (uvFixed ? uvFixed : [u * uvScale[0], v * uvScale[1]]);
  for (let k = 0; k < n; k++) {
    const [r, y] = profile[k];
    const v = k / (n - 1);
    if (r === 0) {
      rings.push(m.v(V3(0, y, 0), ...UV(0.5, v)));
      continue;
    }
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), ...UV(j / seg, v)));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    if (typeof A === 'number') for (let j = 0; j < seg; j++) m.tri(A, B[j], B[j + 1]);
    else if (typeof B === 'number') for (let j = 0; j < seg; j++) m.tri(A[j], B, A[j + 1]);
    else m.strip(A, B);
  }
  const capAt = (k, up) => {
    const [r, y] = profile[k];
    if (r === 0) return;
    const c = m.v(V3(0, y, 0), ...UV(0.5, 0.5));
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ids.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), ...UV(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a))));
    }
    for (let j = 0; j < seg; j++) {
      if (up) m.tri(c, ids[(j + 1) % seg], ids[j]);
      else m.tri(c, ids[j], ids[(j + 1) % seg]);
    }
  };
  capAt(n - 1, true);
  if (bottom) capAt(0, false);
  return m.build();
}
const latheX = (profile, seg, opt) => lathe(profile, seg, opt).rotateZ(-Math.PI / 2);

function rod(a, b, r, seg = 8) {
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

// Обтекаемая стойка: эллиптическое сечение (хорда вдоль X), торцы открыты (уходят внутрь деталей)
function strut(a, b, cw, th, uv = [0.1, 0.258], seg = 10) {
  const m = new Mesher();
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A).normalize();
  const e1 = V3(1, 0, 0).addScaledVector(d, -d.x);
  if (e1.length() < 1e-3) e1.set(0, 0, 1);
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
  const ring = (P) => {
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const f = (j / seg) * Math.PI * 2;
      ids.push(m.v(P.clone().addScaledVector(e1, (cw / 2) * Math.cos(f)).addScaledVector(e2, (th / 2) * Math.sin(f)), ...uv));
    }
    return ids;
  };
  m.strip(ring(A), ring(B), true);
  return m.build({ orient: false, flip: true });
}

// Труба по ломаной (открытые концы)
function tube(points, r, seg = 8, uv = [0.4, 0.26]) {
  const m = new Mesher();
  const rings = [];
  let prevN = null;
  for (let i = 0; i < points.length; i++) {
    const P = points[i];
    const d = (i < points.length - 1 ? points[i + 1].clone().sub(P) : P.clone().sub(points[i - 1])).normalize();
    let n1 = prevN ? prevN.clone().addScaledVector(d, -prevN.dot(d)) : V3(0, 1, 0).addScaledVector(d, -d.y);
    if (n1.length() < 1e-4) n1 = V3(0, 0, 1);
    n1.normalize();
    prevN = n1;
    const n2 = new THREE.Vector3().crossVectors(d, n1);
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const f = (j / seg) * Math.PI * 2;
      ids.push(m.v(P.clone().addScaledVector(n1, r * Math.cos(f)).addScaledVector(n2, r * Math.sin(f)), ...uv));
    }
    rings.push(ids);
  }
  for (let i = 0; i < rings.length - 1; i++) m.strip(rings[i], rings[i + 1], true);
  return m.build({ orient: false, flip: true });
}

function loftRings(rings, uvFn = () => [0.5, 0.5], { caps = [true, true] } = {}) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, ...uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    if (!caps[e]) return;
    const c = new THREE.Vector3();
    rings[k].forEach((p) => c.add(p));
    c.divideScalar(rings[k].length);
    m.fan(ids[k], m.v(c, ...uvFn(c)), k !== 0);
  });
  return m.build();
}

const naca = (t) => {
  const c = clamp01(t);
  return 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
};

function mirrorZ(g) {
  const out = g.clone();
  out.scale(1, 1, -1);
  const idx = out.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  out.index.needsUpdate = true;
  out.computeVertexNormals();
  return out;
}

function clean(g) {
  const out = g.index ? g : mergeVertices(g);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => mergeVertices(mergeGeometries(list.map(clean)), 1e-5);
const setUV = (g, u, v) => {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
};

// ---------------------------------------------------------------------------
// ПРОФИЛЬНЫЕ ПОВЕРХНОСТИ (крыло, оперение, рули)

// stations: [{s, le, c, tc, cut}], xCut — задняя стенка (лонжерон) перед рулём
// map(s, x, h) → точка; uv(s, t, top) → [u, v]
function foilLoft(stations, { map, uv, xCut = null, N1 = 16, N2 = 5, caps = [true, true] }) {
  const m = new Mesher();
  const rings = [];
  for (const st of stations) {
    const { s, le, c, tc, cut } = st;
    let tcut = xCut !== null ? (le - xCut) / c : 0.75;
    if (!(tcut > 0.05 && tcut < 0.97)) tcut = 0.75;
    const hh = (t) => (t >= 0.999 ? 0 : Math.max(0.003, naca(t) * tc * c));
    const ts = [];
    for (let i = 0; i <= N1; i++) ts.push(tcut * (1 - Math.cos((Math.PI / 2) * (i / N1))));
    for (let i = 1; i <= N2; i++) ts.push(tcut + (1 - tcut) * (i / N2));
    const N = N1 + N2;
    const pt = (i, top) => {
      if (cut && i > N1) {
        const p = (i - N1) / N2;
        const h = (top ? 1 : -1) * hh(tcut) * (1 - p);
        return m.v(map(s, xCut, h), ...uv(s, Math.min(1, tcut + 0.004), top));
      }
      const t = ts[i];
      return m.v(map(s, le - t * c, (top ? 1 : -1) * hh(t)), ...uv(s, t, top));
    };
    const ring = [];
    for (let i = 0; i <= N; i++) ring.push(pt(i, true));
    for (let i = N; i >= 1; i--) ring.push(pt(i, false));
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    if (!caps[e]) return;
    const c = new THREE.Vector3();
    const P = m.pos;
    rings[k].forEach((i) => c.add(V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
    c.divideScalar(rings[k].length);
    const st = stations[k];
    m.fan(rings[k], m.v(c, ...uv(st.s, 0.3, true)), e === 1);
  });
  return m.build();
}

// Рулевая поверхность за осью шарнира xh: закруглённый носок + задняя часть профиля
function ctrlLoft(stations, { map, uv, xh, M = 6 }) {
  const m = new Mesher();
  const rings = [];
  for (const st of stations) {
    const { s, le, c, tc } = st;
    const th = (le - xh) / c;
    const hh = (t) => (t >= 0.999 ? 0 : Math.max(0.003, naca(t) * tc * c));
    const H = hh(th);
    const ring = [];
    ring.push(m.v(map(s, xh + 0.02, 0), ...uv(s, th, true)));
    ring.push(m.v(map(s, xh + 0.013, 0.72 * H), ...uv(s, th, true)));
    for (let j = 0; j <= M; j++) {
      const t = th + ((1 - th) * j) / M;
      ring.push(m.v(map(s, le - t * c, hh(t)), ...uv(s, t, true)));
    }
    for (let j = M; j >= 0; j--) {
      const t = th + ((1 - th) * j) / M;
      ring.push(m.v(map(s, le - t * c, -hh(t)), ...uv(s, t, false)));
    }
    ring.push(m.v(map(s, xh + 0.013, -0.72 * H), ...uv(s, th, false)));
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    const c = new THREE.Vector3();
    const P = m.pos;
    rings[k].forEach((i) => c.add(V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
    c.divideScalar(rings[k].length);
    m.fan(rings[k], m.v(c, ...uv(stations[k].s, 0.9, true)), e === 1);
  });
  return m.build();
}

// ---------------------------------------------------------------------------
// ЛОДКА: сечение — V-днище до скулы, почти вертикальный борт, скруглённый верх

const QB = 0.3, QS = 0.45;
function hullSec(x) {
  let W;
  if (x > 5.0) {
    const s = clamp01((x - 5) / (XH1 - 5));
    W = 1.55 * Math.sqrt(Math.max(0, 1 - s ** 2.2));
  } else if (x < -1.5) {
    const s = clamp01((-1.5 - x) / (-1.5 - XH0));
    W = 1.55 - 1.25 * s ** 1.5;
  } else W = 1.55;
  W *= Math.sqrt(clamp01((x - XH0) / 0.45)) * 0.88 + 0.12;
  W = Math.max(W, 0.035);
  let yk, dr = 0.3;
  if (x > 4.5) {
    const s = clamp01((x - 4.5) / (XH1 - 4.5));
    yk = 1.25 * s ** 2.2;
    dr = 0.3 + 0.55 * s ** 1.5;
  } else if (x >= -0.5) yk = 0;
  else if (x > -0.54) yk = lerp(0, 0.16, (-0.5 - x) / 0.04);
  else if (x >= -5.2) yk = 0.16 + 0.46 * ((-0.54 - x) / 4.66);
  else if (x > -5.24) yk = lerp(0.62, 0.82, (-5.2 - x) / 0.04);
  else {
    const s = clamp01((-5.24 - x) / (-5.24 - XH0));
    yk = 0.82 + 1.18 * s ** 1.25;
    dr = 0.3 + 0.15 * s;
  }
  let yt;
  if (x > 7.4) {
    const s = (x - 7.4) / (XH1 - 7.4);
    yt = 2.45 - 0.85 * s * s;
  } else if (x > 5.6) yt = lerp(2.55, 2.45, (x - 5.6) / 1.8);
  else if (x > 3.4) yt = lerp(3.0, 2.55, smooth((x - 3.4) / 2.2));
  else if (x > -3.5) yt = 3.0;
  else yt = 3.0 - 0.35 * ((-3.5 - x) / (-3.5 - XH0));
  const ych = yk + dr * W;
  const R = 0.45 * W;
  const ys = Math.min(yt - 0.02, Math.max(ych + 0.03, yt - R));
  return { x, W, yk, ych, ys, yt };
}
// Точка сечения правого борта: q 0 — киль, QB — скула, QS — верх борта, 1 — середина палубы. → [y, z]
function secPt(c, q) {
  if (q <= QB) {
    const t = q / QB;
    return [c.yk + (c.ych - c.yk) * t ** 1.25, c.W * t];
  }
  if (q <= QS) {
    const t = (q - QB) / (QS - QB);
    return [c.ych + (c.ys - c.ych) * t, c.W * (1 - 0.04 * Math.sqrt(t))];
  }
  const th = ((q - QS) / (1 - QS)) * (Math.PI / 2);
  const e = 2 / 2.6;
  return [c.ys + (c.yt - c.ys) * Math.sin(th) ** e, 0.96 * c.W * Math.cos(th) ** e];
}
function arcTable(c, n = 240) {
  const q = [0], arc = [0], pts = [secPt(c, 0)];
  for (let i = 1; i <= n; i++) {
    const qq = i / n;
    const p = secPt(c, qq);
    const pr = pts[i - 1];
    q.push(qq);
    pts.push(p);
    arc.push(arc[i - 1] + Math.hypot(p[0] - pr[0], p[1] - pr[1]));
  }
  return { q, arc, pts };
}
const arcAtQ = (T, qq) => {
  const f = qq * (T.q.length - 1);
  const i = Math.min(T.q.length - 2, Math.floor(f));
  return lerp(T.arc[i], T.arc[i + 1], f - i);
};
const HULL_STATIONS = (() => {
  const xs = [];
  for (let x = XH0; x < XH1 - 0.001; x += 0.12) xs.push(x);
  xs.push(XH1, -0.5, -0.54, -5.2, -5.24, XH1 - 0.03, XH1 - 0.08, XH0 + 0.04);
  return [...new Set(xs.map((v) => +v.toFixed(4)))].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.015 || [-0.5, -0.54, -5.2, -5.24].includes(x));
})();
const GIRTH = Math.max(...HULL_STATIONS.map((x) => arcTable(hullSec(x)).arc.at(-1))) * 1.01;
const HU = (x) => 0.005 + (0.99 * (x - (XH0 - 0.05))) / (XH1 - XH0 + 0.1);
const HV = (arc) => 0.505 + (0.49 * arc) / GIRTH;
// полуширина лодки на высоте y в сечении x (по борту и скруглению верха)
function hullZ(x, y) {
  const c = hullSec(x);
  if (y <= c.ych) return c.W;
  if (y >= c.yt) return 0;
  const T = arcTable(c, 160);
  for (let i = Math.round(QB * 160); i < T.pts.length - 1; i++) {
    const [y0, z0] = T.pts[i], [y1, z1] = T.pts[i + 1];
    if ((y - y0) * (y - y1) <= 0 && y1 !== y0) return lerp(z0, z1, (y - y0) / (y1 - y0));
  }
  return 0;
}
// высота поверхности лодки над точкой (x, z)
function hullY(x, z) {
  const c = hullSec(x);
  const T = arcTable(c, 160);
  for (let i = T.pts.length - 1; i > 0; i--) {
    const [y0, z0] = T.pts[i], [y1, z1] = T.pts[i - 1];
    if ((z - z0) * (z - z1) <= 0 && z1 !== z0) return lerp(y0, y1, (z - z0) / (z1 - z0));
  }
  return c.ys;
}

function buildHull() {
  const m = new Mesher();
  const qs = [];
  for (let i = 0; i <= 6; i++) qs.push((QB * i) / 6);
  for (let i = 1; i <= 3; i++) qs.push(QB + ((QS - QB) * i) / 3);
  for (let i = 1; i <= 11; i++) qs.push(QS + ((1 - QS) * i) / 11);
  const rings = [];
  for (const x of HULL_STATIONS) {
    const c = hullSec(x);
    const T = arcTable(c);
    const ring = [];
    const pts = qs.map((q) => {
      const [y, z] = secPt(c, q);
      return { y, z, v: HV(arcAtQ(T, q)) };
    });
    pts.forEach((p) => ring.push(m.v(V3(x, p.y, p.z), HU(x), p.v)));
    for (let i = pts.length - 2; i >= 1; i--) ring.push(m.v(V3(x, pts[i].y, -pts[i].z), HU(x), pts[i].v));
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    const x = HULL_STATIONS[k];
    const c = hullSec(x);
    const ci = m.v(V3(x, (c.yk + c.yt) / 2, 0), HU(x), HV(GIRTH * 0.3));
    m.fan(rings[k], ci, e === 1);
  });
  return m.build();
}

// Поплавок на конце крыла (локальная ось X вдоль поплавка, низ y = 0)
const FL = { half: 1.45 };
function floatSec(xl) {
  let W = 0.34;
  if (xl > 0.3) W = 0.34 * Math.sqrt(Math.max(0, 1 - ((xl - 0.3) / 1.15) ** 2.5));
  else if (xl < -0.2) W = 0.34 * (1 - 0.88 * ((-0.2 - xl) / 1.25) ** 1.6);
  W = Math.max(W, 0.02);
  let yk;
  if (xl > 0.5) yk = 0.3 * ((xl - 0.5) / 0.95) ** 2;
  else if (xl >= -0.1) yk = 0;
  else if (xl > -0.13) yk = lerp(0, 0.06, (-0.1 - xl) / 0.03);
  else yk = 0.06 + 0.3 * ((-0.13 - xl) / 1.32) ** 1.2;
  let yt = 0.62;
  if (xl > 0.6) yt = 0.62 - 0.2 * ((xl - 0.6) / 0.85) ** 2;
  else if (xl < -0.3) yt = 0.62 - 0.14 * ((-0.3 - xl) / 1.15);
  const ych = yk + 0.35 * W;
  const ys = Math.min(yt - 0.01, Math.max(ych + 0.02, yt - 0.5 * W));
  return { W, yk, ych, ys, yt };
}
const FLOAT_ST = (() => {
  const xs = [];
  for (let i = 0; i <= 36; i++) xs.push(-FL.half + (2 * FL.half * i) / 36);
  xs.push(-0.1, -0.13);
  return [...new Set(xs.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
})();
const FGIRTH = Math.max(...FLOAT_ST.map((x) => arcTable(floatSec(x)).arc.at(-1))) * 1.01;
const FU = (xl) => 0.755 + (0.24 * (xl + FL.half)) / (2 * FL.half);
const FV = (arc) => 0.005 + (0.115 * arc) / FGIRTH;
function buildFloatBody() {
  const m = new Mesher();
  const qs = [];
  for (let i = 0; i <= 4; i++) qs.push((QB * i) / 4);
  for (let i = 1; i <= 2; i++) qs.push(QB + ((QS - QB) * i) / 2);
  for (let i = 1; i <= 7; i++) qs.push(QS + ((1 - QS) * i) / 7);
  const rings = [];
  for (const x of FLOAT_ST) {
    const c = floatSec(x);
    const T = arcTable(c);
    const pts = qs.map((q) => {
      const [y, z] = secPt(c, q);
      return { y, z, v: FV(arcAtQ(T, q)) };
    });
    const ring = pts.map((p) => m.v(V3(x, p.y, p.z), FU(x), p.v));
    for (let i = pts.length - 2; i >= 1; i--) ring.push(m.v(V3(x, pts[i].y, -pts[i].z), FU(x), pts[i].v));
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    const x = FLOAT_ST[k];
    const c = floatSec(x);
    m.fan(rings[k], m.v(V3(x, (c.yk + c.yt) / 2, 0), FU(x), FV(FGIRTH * 0.3)), e === 1);
  });
  return m.build();
}

// ---------------------------------------------------------------------------
// КРЫЛО

const WING = { half: 15.85, cs: 6.5, zt: 15.25, te: -2.8, xh: -2.05, ail0: 9.45, ail1: 15.15 };
function wingSt(a) {
  a = Math.abs(a);
  let c = a <= WING.cs ? 4.45 : lerp(4.45, 2.5, (Math.min(a, WING.zt) - WING.cs) / (WING.zt - WING.cs));
  if (a > WING.zt) {
    const s = clamp01((a - WING.zt) / (WING.half - WING.zt));
    c *= 0.45 + 0.55 * Math.sqrt(Math.max(0, 1 - s * s));
  }
  const tc = a <= WING.cs ? 0.18 : lerp(0.18, 0.1, (a - WING.cs) / (WING.half - WING.cs));
  return { le: WING.te + c, c, tc };
}
const wingHalf = (x, z) => {
  const w = wingSt(z);
  return naca((w.le - x) / w.c) * w.tc * w.c;
};
const wingLowerY = (x, z) => WY - wingHalf(x, z);
const wingUpperY = (x, z) => WY + wingHalf(x, z);
const WU = (a) => 0.005 + (0.99 * Math.abs(a)) / 15.9;
const WV = (t, top) => 0.275 + 0.22 * (top ? 0.5 + 0.5 * t : 0.5 - 0.5 * t);
const wingUV = (s, t, top) => [WU(s), WV(t, top)];
const wingMap = (s, x, h) => V3(x, WY + h, s);

function buildWing() {
  const A = [0, 0.6, 1.2, 1.8, 2.4, 2.9, 3.3, 3.75, 4.2, 4.6, 5.1, 5.7, 6.2, 6.5, 7.2, 7.9, 8.6, 9.0];
  const half = A.map((a) => ({ a, cut: false }));
  half.push({ a: WING.ail0, cut: false }, { a: WING.ail0, cut: true });
  [10.1, 10.8, 11.5, 12.2, 12.8, 13.4, 14.0, 14.6].forEach((a) => half.push({ a, cut: true }));
  half.push({ a: WING.ail1, cut: true }, { a: WING.ail1, cut: false });
  [15.4, 15.6, 15.75, WING.half].forEach((a) => half.push({ a, cut: false }));
  const list = [...half.slice(1).reverse().map((h) => ({ ...h, a: -h.a })), ...half];
  // порядок: от левой законцовки (−Z) к правой; у дублей станций порядок cut меняется зеркально
  const st = list.map(({ a, cut }) => ({ s: a, cut, ...wingSt(a) }));
  return foilLoft(st, { map: wingMap, uv: wingUV, xCut: WING.xh + 0.045, N1: 18, N2: 5 });
}
function buildAileron() {
  const st = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = lerp(WING.ail0 + 0.02, WING.ail1 - 0.02, i / n);
    st.push({ s: a, ...wingSt(a) });
  }
  return ctrlLoft(st, { map: wingMap, uv: wingUV, xh: WING.xh });
}

// ---------------------------------------------------------------------------
// ОПЕРЕНИЕ

const TAIL = { y: 3.75, half: 3.85, te: -8.65, xh: -8.0, tc: 0.12 };
function tailSt(a) {
  a = Math.abs(a);
  let le = -6.45 - 0.35 * (Math.min(a, 3.45) / 3.45);
  if (a > 3.45) le -= 0.75 * (1 - Math.sqrt(Math.max(0, 1 - ((a - 3.45) / 0.4) ** 2)));
  return { le, c: le - TAIL.te, tc: TAIL.tc };
}
const TPU = (a) => 0.255 + (0.24 * Math.abs(a)) / 3.9;
const TPV = (t, top) => 0.005 + 0.24 * (top ? 0.5 + 0.5 * t : 0.5 - 0.5 * t);
const tailUV = (s, t, top) => [TPU(s), TPV(t, top)];
const tailMap = (s, x, h) => V3(x, TAIL.y + h, s);
function buildStabilizer() {
  const A = [0, 0.3, 0.7, 1.2, 1.7, 2.2, 2.7, 3.1, 3.45, 3.62, 3.75, 3.82, TAIL.half];
  const list = [...A.slice(1).reverse().map((a) => -a), ...A];
  const st = list.map((a) => ({ s: a, cut: true, ...tailSt(a) }));
  return foilLoft(st, { map: tailMap, uv: tailUV, xCut: TAIL.xh + 0.045, N1: 12, N2: 4 });
}
function buildElevator() {
  const st = [];
  for (let i = 0; i <= 8; i++) {
    const a = lerp(0.24, 3.72, i / 8);
    st.push({ s: a, ...tailSt(a) });
  }
  return ctrlLoft(st, { map: tailMap, uv: tailUV, xh: TAIL.xh, M: 5 });
}

const FIN = { y0: 2.45, top: 5.95, xh: -8.72, tc: 0.13 };
function finSt(y) {
  let le = y <= 2.7 ? lerp(-5.6, -6.2, (y - 2.45) / 0.25) : lerp(-6.2, -7.75, (Math.min(y, 5.5) - 2.7) / 2.8);
  if (y > 5.5) le -= 0.45 * ((y - 5.5) / 0.45) ** 2;
  let te = -9.85;
  if (y > 5.4) te += 0.5 * ((y - 5.4) / 0.55) ** 2;
  return { le, c: le - te, tc: FIN.tc };
}
const FNU = (x) => 0.005 + (0.24 * (x + 9.95)) / 4.5;
const FNV = (y) => 0.005 + (0.24 * (y - 2.2)) / 4.0;
const finMap = (s, x, h) => V3(x, s, h);
// у киля UV — боковая проекция: нужна точка, поэтому uv считается после построения
function finUVfix(g) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, clamp01(FNU(p.getX(i))), clamp01(FNV(p.getY(i))));
  return g;
}
function buildFin() {
  const Y = [FIN.y0, 2.7, 3.0, 3.35, 3.7, 4.05, 4.4, 4.75, 5.1, 5.4, 5.6, 5.75, 5.86, FIN.top];
  const st = Y.map((y) => ({ s: y, cut: true, ...finSt(y) }));
  return finUVfix(foilLoft(st, { map: finMap, uv: () => [0, 0], xCut: FIN.xh + 0.045, N1: 14, N2: 4, caps: [false, true] }));
}
function buildRudder() {
  const st = [];
  const Y = [2.74, 3.1, 3.5, 3.9, 4.3, 4.7, 5.1, 5.4, 5.6, 5.75, 5.85, 5.92];
  Y.forEach((y) => st.push({ s: y, ...finSt(y) }));
  return finUVfix(ctrlLoft(st, { map: finMap, uv: () => [0, 0], xh: FIN.xh, M: 6 }));
}

// ---------------------------------------------------------------------------
// ПИЛОН, ГОНДОЛЫ, ОСТЕКЛЕНИЕ

const PYU = (x) => 0.755 + (0.24 * (x + 3.5)) / 5.7;
const PYV = (y) => 0.13 + (0.115 * (y - 2.8)) / 1.9;
function buildPylon() {
  const levels = [2.85, 3.1, 3.4, 3.7, 4.0, 4.2, 4.5];
  const n = 14;
  const rings = levels.map((y, li) => {
    const h = (y - 2.85) / (4.5 - 2.85);
    const xf = lerp(2.1, 1.38, h), xb = lerp(-3.4, -1.72, h), w = lerp(0.48, 0.32, h);
    const ts = [];
    for (let i = 0; i <= n; i++) ts.push(1 - Math.cos((Math.PI / 2) * (i / n)));
    const ring = [];
    const P = (t, sd) => {
      const x = xf - t * (xf - xb);
      const z = sd * Math.max(0.004, w * (naca(t) / 0.5)) * (t >= 0.999 ? 0 : 1);
      const yy = li === levels.length - 1 ? wingLowerY(x, z) + 0.05 : y;
      return V3(x, yy, z);
    };
    for (let i = 0; i <= n; i++) ring.push(P(ts[i], 1));
    for (let i = n - 1; i >= 1; i--) ring.push(P(ts[i], -1));
    return ring;
  });
  return loftRings(rings, (p) => [PYU(p.x), PYV(p.y)], { caps: [false, false] });
}

// Гондола двигателя: кольца-эллипсы вдоль X, спереди капот с губой
const NU = (x) => 0.505 + (0.24 * (3.35 - x)) / 5.9;
const NV = (th) => 0.005 + (0.24 * th) / (Math.PI * 2);
function nacRing(x, zc) {
  if (x >= 1.6) {
    const r = tab([[3.3, 0.71], [3.0, 0.735], [2.4, 0.738], [1.6, 0.715]], x);
    return { a: r, top: PROP.y + r, bot: PROP.y - r };
  }
  const a = tab([[1.6, 0.715], [0.6, 0.64], [-0.4, 0.52], [-1.3, 0.34], [-2.0, 0.16], [-2.3, 0.07]], x);
  const top = tab([[1.6, PROP.y + 0.715], [0.5, 5.22], [-0.5, 5.13], [-1.4, 4.98], [-2.0, 4.85], [-2.3, 4.78]], x);
  let bot;
  if (x > 0.4) bot = lerp(PROP.y - 0.715, 3.98, (1.6 - x) / 1.2);
  else if (x > -0.5) bot = lerp(3.98, wingLowerY(x, zc) + 0.05, (0.4 - x) / 0.9);
  else bot = Math.min(wingUpperY(x, zc), top - 0.05) - Math.min(0.06, 0.3 * (top - wingUpperY(x, zc)) + 0.05);
  return { a, top, bot };
}
function buildNacelle(zc) {
  const m = new Mesher();
  const seg = 28;
  const lip = [[3.19, 0.52], [3.3, 0.6], [3.29, 0.67]];
  const XS = [3.2, 3.0, 2.7, 2.4, 2.0, 1.6, 1.2, 0.8, 0.4, 0.0, -0.4, -0.8, -1.2, -1.6, -1.9, -2.15, -2.3];
  const rings = [];
  const add = (x, a, top, bot) => {
    const yc = (top + bot) / 2, b = (top - bot) / 2;
    const ids = [];
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      ids.push(m.v(V3(x, yc - b * Math.cos(th), zc + a * Math.sin(th)), NU(x), NV(th)));
    }
    rings.push(ids);
  };
  lip.forEach(([x, r]) => add(x, r, PROP.y + r, PROP.y - r));
  XS.forEach((x) => {
    const r = nacRing(x, zc);
    add(x, r.a, r.top, r.bot);
  });
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
  const last = rings.at(-1);
  const r = nacRing(-2.3, zc);
  m.fan(last.slice(0, seg), m.v(V3(-2.36, (r.top + r.bot) / 2, zc), NU(-2.3), NV(Math.PI)), true);
  return m.build({ orient: false, flip: true });
}

// Двигатель R-1830: передний картер и головки цилиндров (видны в кольце капота)
function buildEngineFace(zc) {
  const parts = [latheX([[0.54, 3.08], [0.5, 3.17], [0.36, 3.22], [0.2, 3.27], [0.12, 3.36], [0, 3.38]], 24).translate(0, PROP.y, zc)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const r0 = 0.24, r1 = 0.47;
    parts.push(rod([3.22, PROP.y + r0 * Math.cos(a), zc + r0 * Math.sin(a)], [3.22, PROP.y + r1 * Math.cos(a), zc + r1 * Math.sin(a)], 0.07, 8));
  }
  // выхлопной патрубок под гондолой
  parts.push(rod([2.2, PROP.y - 0.62, zc + 0.35], [1.3, PROP.y - 0.55, zc + 0.42], 0.06, 8));
  return merge(parts);
}

// Лопасть: радиальная ось +Y, ось вращения X
function bladeGeometry({ r0, r1, chord0, chord1, pitch, tc = 0.1, n = 9 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = lerp(chord0, chord1, Math.sin(Math.PI * Math.min(1, s * 1.1) * 0.5)) * (k === n ? 0.5 : k === n - 1 ? 0.85 : 1);
    const beta = Math.atan(pitch / (2 * Math.PI * r));
    const d = V3(Math.sin(beta), 0, Math.cos(beta));
    const nn = V3(Math.cos(beta), 0, -Math.sin(beta));
    const ring = [];
    const M = 7;
    const pts = [];
    for (let j = 0; j <= M; j++) pts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const add = (t, sign) => {
      const c = (0.35 - t) * ch;
      const h = sign * Math.max(0.004, naca(t) * tc * ch * (1 - 0.55 * s));
      const p = d.clone().multiplyScalar(c).addScaledVector(nn, h);
      ring.push(V3(p.x, r, p.z));
    };
    for (const t of pts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(pts[j], -1);
    rings.push(ring);
  }
  return loftRings(rings, (p) => [0.25, clamp01(p.y / r1)]);
}

// Фонарь кабины: оболочка над палубой, края уходят под обшивку
function buildCanopy() {
  const m = new Mesher();
  const K = 18;
  const XS = [];
  for (let i = 0; i <= 16; i++) XS.push(lerp(6.15, 3.1, i / 16));
  const wb = 0.95;
  const rings = XS.map((x, i) => {
    const yb = hullY(x, wb) - 0.05;
    const yr = Math.max(yb, tab([[6.15, yb], [5.25, 3.3], [3.75, 3.32], [3.1, hullY(3.1, 0) - 0.04]], x));
    const ids = [];
    for (let k = 0; k <= K; k++) {
      const f = (k / K) * Math.PI;
      const cf = Math.cos(f), sf = Math.sin(f);
      const e = 2 / 3;
      const z = -wb * Math.sign(cf) * Math.abs(cf) ** e;
      const y = yb + (yr - yb) * Math.abs(sf) ** e;
      ids.push(m.v(V3(x, y, z), 0.5 * (i / 16), 0.875 * (k / K)));
    }
    return ids;
  });
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
  return m.build({ orient: false });
}

// Блистер стрелка: полуэллипсоид на борту
function buildBlister() {
  const cx = -4.55, cy = 2.12, rx = 0.8, ry = 0.62;
  let z0 = Infinity;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) z0 = Math.min(z0, hullZ(cx + (rx * i) / 4, cy + (ry * j) / 4));
  z0 -= 0.04;
  const rz = hullZ(cx, cy) + 0.42 - z0;
  const m = new Mesher();
  const NA = 8, NB = 28;
  const rings = [];
  for (let i = 0; i < NA; i++) {
    const a = (i / NA) * (Math.PI / 2);
    const ids = [];
    for (let j = 0; j <= NB; j++) {
      const b = (j / NB) * Math.PI * 2;
      ids.push(m.v(V3(cx + rx * Math.cos(a) * Math.cos(b), cy + ry * Math.cos(a) * Math.sin(b), z0 + rz * Math.sin(a)), 0.25 * (j / NB), 0.25 * (i / NA)));
    }
    rings.push(ids);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
  const apex = m.v(V3(cx, cy, z0 + rz), 0.125, 0.25);
  const lastR = rings.at(-1);
  for (let j = 0; j < NB; j++) m.tri(lastR[j], lastR[j + 1], apex);
  // ориентация: наружу (+Z)
  const g = m.build({ orient: false });
  const n = g.attributes.normal;
  let sum = 0;
  for (let i = 0; i < n.count; i++) sum += n.getZ(i);
  return sum < 0 ? m.build({ orient: false, flip: true }) : g;
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const COL = {
  white: [226, 229, 226],
  edsg: [66, 74, 82],
  dsg: [72, 82, 70],
  red: [148, 38, 40],
  blue: [36, 46, 96],
  yellow: [222, 182, 46],
  rWhite: [236, 236, 230],
  glass: [34, 48, 58],
  rope: [120, 104, 78],
};
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// Пятнистый камуфляж верха по координатам в плане
function camo(x, z) {
  const n = Math.sin(0.42 * x + 0.9 * Math.sin(0.23 * z + 0.4)) + Math.sin(0.31 * z + 0.8 * Math.sin(0.37 * x + 1.1) + 0.7) + 0.45 * Math.sin(0.9 * x - 0.6 * z + 2.0);
  return n > 0.1 ? COL.dsg : COL.edsg;
}
// Кокарды: d — расстояние до центра / радиус
function roundelC1(d) {
  if (d > 1) return null;
  if (d > 0.889) return COL.yellow;
  if (d > 0.444) return COL.blue;
  if (d > 0.333) return COL.rWhite;
  return COL.red;
}
function roundelB(d) {
  if (d > 1) return null;
  return d > 0.4 ? COL.blue : COL.red;
}
const groove = (d, w, pw) => clamp01((w - Math.abs(d)) / pw + 0.5);
const nearest = (v, step, off = 0) => Math.abs(((v - off) / step - Math.round((v - off) / step)) * step);

function paintAtlas() {
  const S = ATLAS;
  const col = makeCanvas(S, S);
  const C = col.getContext('2d');
  const img = C.createImageData(S, S);
  const D = img.data;
  const Hm = new Float32Array(S * S).fill(0.5);
  for (let i = 0; i < S * S; i++) {
    D[i * 4] = COL.white[0];
    D[i * 4 + 1] = COL.white[1];
    D[i * 4 + 2] = COL.white[2];
    D[i * 4 + 3] = 255;
  }
  const put = (px, py, c, h = 0.5) => {
    const o = py * S + px;
    D[o * 4] = c[0];
    D[o * 4 + 1] = c[1];
    D[o * 4 + 2] = c[2];
    Hm[o] = h;
  };
  const rowOf = (v) => Math.round((1 - v) * S - 0.5);
  const colOf = (u) => Math.round(u * S - 0.5);
  // проход по прямоугольнику атласа: fn(u, v, px, py)
  const region = (u0, u1, v0, v1, fn) => {
    for (let py = Math.max(0, rowOf(v1)); py <= Math.min(S - 1, rowOf(v0)); py++) {
      const v = 1 - (py + 0.5) / S;
      for (let px = Math.max(0, colOf(u0)); px <= Math.min(S - 1, colOf(u1)); px++) fn((px + 0.5) / S, v, px, py);
    }
  };
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grime = new Float32Array(64 * 64).map(() => rnd());
  const noise = (u, v) => {
    const x = u * 63, y = v * 63;
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const g = (a, b) => grime[Math.min(63, b) * 64 + Math.min(63, a)];
    return lerp(lerp(g(i, j), g(i + 1, j), fx), lerp(g(i, j + 1), g(i + 1, j + 1), fx), fy);
  };
  const finish = (c, u, v) => {
    const k = 0.94 + 0.08 * noise(u * 3 % 1, v * 3 % 1);
    return [c[0] * k, c[1] * k, c[2] * k];
  };

  // ---- ЛОДКА
  {
    const pwX = (XH1 - XH0 + 0.1) / (0.99 * S), pwA = GIRTH / (0.49 * S);
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;
      const x = XH0 - 0.05 + ((u - 0.005) / 0.99) * (XH1 - XH0 + 0.1);
      const c = hullSec(Math.min(XH1, Math.max(XH0, x)));
      const T = arcTable(c, 300);
      const total = T.arc.at(-1);
      let k = 0;
      for (let py = rowOf(0.505); py >= rowOf(0.995); py--) {
        const v = 1 - (py + 0.5) / S;
        const arc = ((v - 0.505) / 0.49) * GIRTH;
        if (arc > total + 0.05) continue;
        while (k < T.arc.length - 2 && T.arc[k + 1] < arc) k++;
        const f = clamp01((arc - T.arc[k]) / (T.arc[k + 1] - T.arc[k] || 1));
        const q = lerp(T.q[k], T.q[k + 1], f);
        const y = lerp(T.pts[k][0], T.pts[k + 1][0], f);
        const z = lerp(T.pts[k][1], T.pts[k + 1][1], f);
        let colr = COL.white;
        if (q > QS + 0.3 * (1 - QS) && (x < 8.95 || y > 1.92 + 0.6 * (x - 8.95) * 0)) colr = camo(x, z);
        // грязь у ватерлинии и днища
        if (y < 1.15) colr = mix(colr, [170, 178, 168], 0.18 * smooth((1.15 - y) / 0.6) + 0.06 * noise(u, v));
        let h = 0.5;
        // шпангоуты и стрингеры
        const fr = groove(nearest(x, 0.52, 0.1), 0.006, pwX);
        const sg = groove(nearest(arc, 0.62), 0.005, pwA) * 0.7;
        const ln = Math.max(fr, sg);
        h -= 0.3 * ln;
        if (fr > 0.2 && nearest(arc, 0.055) < pwA * 0.9) h += 0.2;
        colr = mix(colr, [60, 64, 66], 0.06 * ln);
        // скула (гладкая)
        // кокарда C1 на борту
        if (q > QB && q < QS + 0.2 * (1 - QS)) {
          const r = roundelC1(Math.hypot(x + 2.45, y - 1.82) / 0.62);
          if (r) colr = r;
        }
        // окно бомбардира на носу
        if (x > 9.3 && y > 1.42 && y < 1.8 && z < 0.4 && q < 0.85) {
          colr = Math.abs(z - 0.0) < 0.025 || Math.abs(y - 1.62) < 0.02 ? COL.edsg : COL.glass;
          h = 0.45;
        }
        // люк швартовки перед турелью
        if (x > 8.95 && x < 9.22 && q > 0.8 && z < 0.3) {
          const e = Math.min(Math.abs(x - 8.95), Math.abs(x - 9.22), Math.abs(z - 0.3));
          if (e < 0.012) h = 0.2;
        }
        // туннельный люк в днище кормы
        if (q < QB && x > -7.0 && x < -6.15 && z < 0.4) {
          const e = Math.min(Math.abs(x + 7.0), Math.abs(x + 6.15), Math.abs(z - 0.4));
          if (e < 0.012) {
            h = 0.15;
            colr = mix(colr, [50, 50, 50], 0.5);
          }
        }
        // окна: штурман (за кабиной), бортмеханик-радист
        [[2.6, 2.55, 0.32, 0.22], [1.9, 2.55, 0.32, 0.22]].forEach(([wx, wy, ww, wh]) => {
          if (Math.abs(x - wx) < ww / 2 && Math.abs(y - wy) < wh / 2 && q > QB && q < QS + 0.3) {
            colr = COL.glass;
            h = 0.42;
          }
        });
        // входной люк и ступень: тёмная линия редана
        if (Math.abs(x + 0.52) < 0.03 && q < QB) colr = mix(colr, [40, 40, 40], 0.5);
        put(px, py, finish(colr, u, v), h);
      }
    }
  }

  // ---- КРЫЛО
  {
    const pwZ = 15.9 / (0.99 * S);
    region(0.0, 1.0, 0.27, 0.497, (u, v, px, py) => {
      const a = clamp01((u - 0.005) / 0.99) * 15.9;
      const s = clamp01((v - 0.275) / 0.22);
      const top = s >= 0.5;
      const t = top ? (s - 0.5) * 2 : (0.5 - s) * 2;
      const w = wingSt(Math.min(a, WING.half));
      const x = w.le - t * w.c;
      const pwT = (w.c * 2) / (0.22 * S);
      let colr = top ? camo(x, a) : COL.white;
      let h = 0.5;
      if (top) {
        const r = roundelB(Math.hypot(a - 10.6, x - (wingSt(10.6).le - 0.42 * wingSt(10.6).c)) / 1.18);
        if (r) colr = r;
      }
      // нервюры (полотняная обшивка за задним лонжероном), лонжероны, шарнир элерона
      const rib = t > 0.62 ? groove(nearest(a, 0.42, 0.1), 0.01, pwZ) * 0.6 : groove(nearest(a, 1.05, 0.3), 0.006, pwZ);
      const spar = Math.max(groove((t - 0.12) * w.c, 0.006, pwT), groove((t - 0.62) * w.c, 0.006, pwT));
      const panel = t < 0.62 ? groove(nearest(t * w.c, 0.55), 0.005, pwT) * 0.6 : 0;
      const ln = Math.max(rib, spar, panel);
      h -= 0.3 * ln;
      colr = mix(colr, [55, 58, 60], 0.14 * ln);
      // стык центроплана, обрез законцовки
      if (Math.abs(a - WING.cs) < 0.012) h = 0.2;
      put(px, py, finish(colr, u, v), h);
    });
  }

  // ---- КИЛЬ И РУЛЬ НАПРАВЛЕНИЯ (боковая проекция)
  region(0.0, 0.25, 0.0, 0.25, (u, v, px, py) => {
    const x = -9.95 + ((u - 0.005) / 0.24) * 4.5;
    const y = 2.2 + ((v - 0.005) / 0.24) * 4.0;
    const pw = 4.5 / (0.24 * S);
    let colr = COL.white;
    let h = 0.5;
    // флэш RAF: красный спереди
    if (y > 3.95 && y < 4.95 && x < -7.62 && x > -8.52) colr = x > -8.03 ? COL.red : x > -8.11 ? COL.rWhite : COL.blue;
    // нервюры руля и шарнир
    if (x < FIN.xh) {
      const ln = groove(nearest(y, 0.32, 0.05), 0.008, pw);
      h -= 0.25 * ln;
      colr = mix(colr, [60, 62, 64], 0.12 * ln);
    } else {
      const ln = Math.max(groove(nearest(y, 0.6, 0.2), 0.005, pw), groove(nearest(x, 0.7, 0.2), 0.005, pw));
      h -= 0.3 * ln;
    }
    put(px, py, finish(colr, u, v), h);
  });

  // ---- СТАБИЛИЗАТОР И РУЛИ ВЫСОТЫ
  region(0.25, 0.5, 0.0, 0.25, (u, v, px, py) => {
    const a = clamp01((u - 0.255) / 0.24) * 3.9;
    const s = clamp01((v - 0.005) / 0.24);
    const top = s >= 0.5;
    const t = top ? (s - 0.5) * 2 : (0.5 - s) * 2;
    const w = tailSt(Math.min(a, TAIL.half));
    const x = w.le - t * w.c;
    let colr = top ? camo(x, a + 4) : COL.white;
    const ln = x < TAIL.xh ? groove(nearest(a, 0.3, 0.05), 0.008, 3.9 / (0.24 * S)) : groove(nearest(a, 0.8), 0.004, 3.9 / (0.24 * S));
    put(px, py, finish(mix(colr, [60, 62, 64], 0.12 * ln), u, v), 0.5 - 0.28 * ln);
  });

  // ---- ГОНДОЛЫ
  region(0.5, 0.75, 0.0, 0.25, (u, v, px, py) => {
    const x = 3.35 - ((u - 0.505) / 0.24) * 5.9;
    const th = clamp01((v - 0.005) / 0.24) * Math.PI * 2;
    const up = -Math.cos(th);
    let colr = up > 0.35 ? camo(x, 3.75 + 0.7 * Math.sin(th)) : COL.white;
    let h = 0.5;
    // капот: передняя губа темнее, юбка створок
    if (x > 3.18) colr = mix(colr, [90, 94, 96], 0.3);
    const ln = Math.max(groove(x - 2.45, 0.008, 5.9 / (0.24 * S)), groove(x - 1.75, 0.006, 5.9 / (0.24 * S)), groove(nearest(th, Math.PI / 4, Math.PI / 8) * 0.7, 0.006, 4.4 / (0.24 * S)) * (x > 1.75 ? 1 : 0));
    h -= 0.35 * ln;
    colr = mix(colr, [50, 52, 54], 0.2 * ln);
    // копоть выхлопа по бокам гондолы
    const side = Math.abs(Math.sin(th));
    if (x < 2.2 && x > -0.5 && side > 0.55 && up < 0.2) colr = mix(colr, [62, 58, 54], 0.45 * smooth((x + 0.5) / 2.0) * smooth((side - 0.55) / 0.3) * (0.7 + 0.3 * noise(u, v)));
    put(px, py, finish(colr, u, v), h);
  });

  // ---- ПОПЛАВКИ
  region(0.75, 1.0, 0.0, 0.125, (u, v, px, py) => {
    const xl = -FL.half + ((u - 0.755) / 0.24) * 2 * FL.half;
    const arc = ((v - 0.005) / 0.115) * FGIRTH;
    const pw = (2 * FL.half) / (0.24 * S);
    let colr = COL.white;
    const ln = Math.max(groove(nearest(xl, 0.45), 0.006, pw), groove(nearest(arc, 0.3), 0.006, FGIRTH / (0.115 * S)));
    if (arc < 0.38) colr = mix(colr, [175, 182, 172], 0.25);
    put(px, py, finish(mix(colr, [60, 62, 64], 0.15 * ln), u, v), 0.5 - 0.3 * ln);
  });

  // ---- ПИЛОН (боковая проекция)
  region(0.75, 1.0, 0.125, 0.25, (u, v, px, py) => {
    const x = -3.5 + ((u - 0.755) / 0.24) * 5.7;
    const y = 2.8 + ((v - 0.13) / 0.115) * 1.9;
    let colr = COL.white;
    let h = 0.5;
    const pw = 5.7 / (0.24 * S);
    const ln = Math.max(groove(nearest(x, 0.5), 0.006, pw), groove(y - 3.65, 0.006, pw));
    h -= 0.3 * ln;
    // окна бортмеханика в пилоне
    if (y > 3.3 && y < 3.58 && ((x > 0.25 && x < 0.62) || (x > -0.25 && x < 0.12))) {
      colr = COL.glass;
      h = 0.42;
    }
    put(px, py, finish(mix(colr, [60, 62, 64], 0.15 * ln), u, v), h);
  });

  // ---- МЕЛОЧИ: стойки (белые), трос, буй (полосы)
  region(0.0, 1.0, 0.25, 0.27, (u, v, px, py) => {
    let colr = COL.white;
    if (u > 0.3 && u < 0.5) colr = COL.rope;
    if (u >= 0.5) {
      const b = (u - 0.5) / 0.5;
      colr = b < 0.4 || b > 0.62 ? [196, 64, 40] : COL.rWhite;
    }
    put(px, py, colr, 0.5);
  });

  C.putImageData(img, 0, 0);

  // карта нормалей из высот
  const nrm = makeCanvas(S, S);
  const N = nrm.getContext('2d');
  const out = N.createImageData(S, S);
  const k = 2.6;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const at = (xx, yy) => Hm[Math.min(S - 1, Math.max(0, yy)) * S + Math.min(S - 1, Math.max(0, xx))];
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      out.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      out.data[o + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
      out.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      out.data[o + 3] = 255;
    }
  }
  N.putImageData(out, 0, 0);

  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.anisotropy = 8;
  map.name = 'Airframe_Atlas_Color';
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = 'Airframe_Atlas_Normal';
  return { map, normalMap };
}

// Остекление: сетка переплётов 8×8
function paintGlass() {
  const S = 512;
  const c = makeCanvas(S, S);
  const C = c.getContext('2d');
  const g = C.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#2a3a46');
  g.addColorStop(0.5, '#1c2831');
  g.addColorStop(1, '#2e404c');
  C.fillStyle = g;
  C.fillRect(0, 0, S, S);
  C.fillStyle = '#434c54';
  for (let i = 0; i <= 8; i++) {
    const p = (i * S) / 8;
    C.fillRect(p - 4, 0, 8, S);
    C.fillRect(0, p - 4, S, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = 'image/jpeg';
  t.name = 'Glazing_Frames';
  return t;
}
// Винт: чёрные лопасти с жёлтыми концами, ступица — металл
function paintProp() {
  const S = 256;
  const c = makeCanvas(S, S);
  const C = c.getContext('2d');
  C.fillStyle = '#16171a';
  C.fillRect(0, 0, S / 2, S);
  C.fillStyle = '#d8b030';
  C.fillRect(0, 0, S / 2, S * 0.075);
  C.fillStyle = '#5a5f63';
  C.fillRect(S / 2, 0, S / 2, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = 'image/jpeg';
  t.name = 'Propeller_Paint_Color';
  return t;
}

// ---------------------------------------------------------------------------

export function createCatalina() {
  const root = new THREE.Group();
  root.name = 'Flying_Boat_Catalina';
  const { map, normalMap } = paintAtlas();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    paint: std('Airframe_Paint', 0xffffff, 0.62, 0.12, { map, normalMap }),
    glass: std('Glazing_Tinted', 0xffffff, 0.08, 0.2, { map: paintGlass() }),
    prop: std('Propeller_Paint', 0xffffff, 0.45, 0.35, { map: paintProp() }),
    metal: std('Metal_Dark', 0x2e3134, 0.55, 0.6),
  };
  const group = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const mesh = (geo, mat, name, parent) => {
    const mm = new THREE.Mesh(geo, mat);
    mm.name = name;
    geo.name = name;
    parent.add(mm);
    return mm;
  };
  const local = (g, o) => g.translate(-o[0], -o[1], -o[2]);

  // ======================= ПЛАНЕР
  const air = group('Airframe', root);
  mesh(buildHull(), M.paint, 'Hull', air);
  mesh(buildPylon(), M.paint, 'Wing_Pylon', air);
  mesh(buildWing(), M.paint, 'Wing', air);
  mesh(merge([buildFin(), buildStabilizer()]), M.paint, 'Tail_Fixed', air);
  mesh(buildNacelle(-PROP.z), M.paint, 'Nacelle_L', air);
  mesh(buildNacelle(PROP.z), M.paint, 'Nacelle_R', air);

  // подкосы крыла: по два основных и по стойке-распорке с каждой стороны
  {
    const parts = [];
    [1, -1].forEach((sd) => {
      const zw = 5.9;
      const F0 = [0.95, 2.35, sd * (hullZ(0.95, 2.35) - 0.1)], F1 = [0.65, wingLowerY(0.65, zw) + 0.06, sd * zw];
      const R0 = [-1.15, 2.35, sd * (hullZ(-1.15, 2.35) - 0.1)], R1 = [-1.45, wingLowerY(-1.45, zw) + 0.06, sd * zw];
      parts.push(strut(F0, F1, 0.2, 0.075), strut(R0, R1, 0.2, 0.075));
      [F0, R0].forEach((P0, i) => {
        const P1 = i === 0 ? F1 : R1;
        const mid = P0.map((v, j) => lerp(v, P1[j], 0.55));
        const top = [mid[0], wingLowerY(mid[0], mid[2]) + 0.05, mid[2]];
        parts.push(strut(mid, top, 0.13, 0.05));
      });
    });
    mesh(merge(parts), M.paint, 'Wing_Struts', air);
  }

  // остекление: фонарь кабины, носовая турель, блистеры
  {
    const turret = lathe([[0.56, 1.6], [0.585, 2.2], [0.56, 2.52], [0.45, 2.77], [0.25, 2.92], [0, 2.97]], 24, { uvScale: [1, 0.375] }).translate(8.4, 0, 0);
    const bl = buildBlister();
    mesh(merge([buildCanopy(), turret, bl, mirrorZ(bl)]), M.glass, 'Glazing', air);
  }

  // двигатели (передний картер и цилиндры), пулемёт, кнехт, антенны РЛС ASV, провода
  {
    const parts = [buildEngineFace(PROP.z), buildEngineFace(-PROP.z)];
    parts.push(rod([8.75, 2.52, 0], [9.78, 2.5, 0], 0.022, 8)); // носовой пулемёт
    parts.push(lathe([[0.05, 1.72], [0.045, 1.98], [0.075, 2.0], [0.075, 2.05], [0, 2.07]], 12).translate(9.28, 0, 0)); // кнехт
    // «Stickleback» — мачты ASV на гребне кормы
    [-3.85, -4.45, -5.05, -5.65].forEach((x) => {
      const yb = hullY(x, 0) - 0.06;
      parts.push(rod([x, yb, 0], [x, yb + 0.62, 0], 0.022, 6), rod([x, yb + 0.55, -0.36], [x, yb + 0.55, 0.36], 0.012, 6));
    });
    // яги-антенны наведения под консолями
    [1, -1].forEach((sd) => {
      const z = sd * 10.8;
      const y0 = wingLowerY(0.2, z) + 0.03;
      parts.push(rod([0.2, y0, z], [1.45, y0 - 0.32, z], 0.018, 6));
      [0.75, 1.05, 1.35].forEach((x) => {
        const y = y0 - 0.32 * ((x - 0.2) / 1.25);
        parts.push(rod([x, y, z - 0.27], [x, y, z + 0.27], 0.009, 5));
      });
    });
    // антенные провода от киля к задней кромке крыла
    [1, -1].forEach((sd) => parts.push(rod([-8.3, 5.72, 0], [-2.72, WY, sd * 4.3], 0.007, 5)));
    mesh(merge(parts.map((g) => setUV(g, 0.5, 0.5))), M.metal, 'Fittings_Metal', air);
  }

  // ======================= РУЛИ (группы с началом на оси шарнира, поворот 0)
  const ctl = group('Control_Surfaces', root);
  {
    const ail = buildAileron();
    const hR = [WING.xh, WY, 0];
    const gR = group('Aileron_R', ctl, ...hR);
    mesh(local(ail.clone(), hR), M.paint, 'Aileron_R_Surface', gR);
    const gL = group('Aileron_L', ctl, ...hR);
    mesh(local(mirrorZ(ail), hR), M.paint, 'Aileron_L_Surface', gL);
    const el = buildElevator();
    const hE = [TAIL.xh, TAIL.y, 0];
    const eR = group('Elevator_R', ctl, ...hE);
    mesh(local(el.clone(), hE), M.paint, 'Elevator_R_Surface', eR);
    const eL = group('Elevator_L', ctl, ...hE);
    mesh(local(mirrorZ(el), hE), M.paint, 'Elevator_L_Surface', eL);
    const hRud = [FIN.xh, 0, 0];
    const rud = group('Rudder', ctl, ...hRud);
    mesh(local(buildRudder(), hRud), M.paint, 'Rudder_Surface', rud);
  }

  // ======================= ПОПЛАВКИ (ось уборки вдоль X на нижней поверхности крыла)
  const flG = group('Floats', root);
  const FLZ = 12.8, FLX = -0.95;
  {
    const hy = wingLowerY(FLX, FLZ);
    const xc = -1.05, yb = 0.95;
    const body = buildFloatBody().translate(xc, yb, FLZ);
    const ft = yb + floatSec(0).yt;
    const parts = [body];
    const top = (x) => [x, wingLowerY(x, FLZ) + 0.06, FLZ];
    const fy = (xl) => yb + floatSec(xl).yt - 0.04;
    parts.push(strut([-0.35, fy(0.7), FLZ], top(-0.62), 0.24, 0.07));
    parts.push(strut([-1.75, fy(-0.7), FLZ], top(-1.28), 0.24, 0.07));
    const yTie = 2.55;
    const xa = lerp(-0.35, -0.62, (yTie - fy(0.7)) / (top(-0.62)[1] - fy(0.7)));
    const xb = lerp(-1.75, -1.28, (yTie - fy(-0.7)) / (top(-1.28)[1] - fy(-0.7)));
    parts.push(strut([xa - 0.02, yTie, FLZ], [xb + 0.02, yTie, FLZ], 0.08, 0.05));
    void ft;
    const fR = merge(parts);
    const hR = [FLX, hy, FLZ];
    const gR = group('Float_R', flG, ...hR);
    mesh(local(fR.clone(), hR), M.paint, 'Float_R_Body', gR);
    const hL = [FLX, hy, -FLZ];
    const gL = group('Float_L', flG, ...hL);
    mesh(local(mirrorZ(fR), hL), M.paint, 'Float_L_Body', gL);
  }

  // ======================= ВИНТЫ Hamilton Standard, Ø 3.68 м (ось вала X)
  const prG = group('Propellers', root);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.17, r1: PROP.r, chord0: 0.2, chord1: 0.27, pitch: 3.4, tc: 0.1 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX(Math.PI / 3 + (i * 2 * Math.PI) / 3));
    const hub = setUV(latheX([[0.2, -0.24], [0.215, -0.06], [0.2, 0.1], [0.14, 0.24], [0.06, 0.32], [0, 0.34]], 18, { bottom: true }), 0.75, 0.5);
    const pg = merge([...bl, hub]);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Propeller_R' : 'Propeller_L', prG, PROP.x, PROP.y, sd * PROP.z);
      mesh(pg.clone(), M.prop, `${g.name}_Blades`, g);
      props[sd > 0 ? 'R' : 'L'] = g;
    });
  }

  // ======================= ШВАРТОВКА: конец от носового кнехта к бую (можно скрыть в полёте)
  {
    const moor = group('Mooring_Gear', root);
    const A = V3(9.28, 2.0, 0), B = V3(11.35, 1.22, 0);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(A.clone().lerp(B, t).add(V3(0, -0.28 * Math.sin(Math.PI * t), 0)));
    }
    const line = tube(pts, 0.016, 6, [0.4, 0.26]);
    const prof = [[0, 0.62], [0.18, 0.66], [0.29, 0.78], [0.33, 0.95], [0.29, 1.1], [0.16, 1.2], [0.06, 1.22], [0.06, 1.3], [0, 1.31]];
    const buoy = lathe(prof, 20, { uvFixed: null });
    const p = buoy.attributes.position, uv = buoy.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + 0.49 * clamp01((p.getY(i) - 0.62) / 0.69), 0.26);
    buoy.translate(11.35, 0, 0);
    mesh(merge([line, buoy]), M.paint, 'Mooring_Line_Buoy', moor);
  }

  // Анимация: оба винта вращаются в одну сторону (по часовой, если смотреть сзади), 1 оборот за 0.5 с
  {
    const T = 0.5;
    const n = 8;
    const times = [];
    const vals = [];
    const q = new THREE.Quaternion();
    const ax = V3(1, 0, 0);
    for (let i = 0; i <= n; i++) {
      times.push((T * i) / n);
      q.setFromAxisAngle(ax, (2 * Math.PI * i) / n);
      vals.push(q.x, q.y, q.z, q.w);
    }
    root.animations = [
      new THREE.AnimationClip('Propellers_Spin', T, [
        new THREE.QuaternionKeyframeTrack('Propeller_R.quaternion', times, vals),
        new THREE.QuaternionKeyframeTrack('Propeller_L.quaternion', times, vals.slice()),
      ]),
    ];
  }

  const find = (n) => root.getObjectByName(n);
  root.userData.update = (t = 0) => {
    props.R.rotation.x = 4 * Math.PI * t;
    props.L.rotation.x = 4 * Math.PI * t;
  };
  // тестовая поза для проверки осей подвижных частей
  root.userData.pose = (k = 0) => {
    find('Aileron_R').rotation.z = 0.4 * k;
    find('Aileron_L').rotation.z = -0.4 * k;
    find('Elevator_R').rotation.z = 0.4 * k;
    find('Elevator_L').rotation.z = 0.4 * k;
    find('Rudder').rotation.y = 0.45 * k;
    find('Float_R').rotation.x = -(Math.PI / 2) * k;
    find('Float_L').rotation.x = (Math.PI / 2) * k;
  };
  return root;
}
