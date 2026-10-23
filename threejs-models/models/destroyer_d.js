import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Эсминец Королевского флота типа D (1932: Daring, Decoy, Defender, Delight, Diamond, Diana, Duchess, Dainty,
// лидер Duncan), обобщённый облик ~1939 г., без бортового номера. Масштаб 1:1, метры.
// Оси: Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния — y = WL (осадка 3,8 м).
// Длина 100,3 м, ширина 10,1 м. Полубак до мостика; четыре одиночных 4,7-дюймовых орудия Mk IX со щитами
// (A, B — в нос, X, Y — в корму), два четырёхтрубных 21-дюймовых торпедных аппарата в средней части,
// две трубы (носовая толще), мостик с директором, треногая фок-мачта, короткая грот-мачта, прожекторная
// площадка, 3-дюймовое зенитное орудие между трубами, счетверённые 0,5-дюймовые пулемёты на крыльях мостика,
// бомбосбрасыватели и бомбомёты в корме, шлюпки на шлюпбалках, якоря, два винта и один руль.
// Подвижные части — отдельные Group с нулевым поворотом в покое, начало — на оси движения.
// Материалы: атлас окраски (корпус, палубы, надстройки, трубы: цвет JPEG + нормали PNG) и семь цветом.

export const WL = 3.8; // ватерлиния над килем
const XS = -49.6; // корма (номинальное сечение на уровне палубы)
const XF = 50.35; // форштевень на уровне палубы полубака
const XB = 16.0; // срез полубака
const BEAM = 5.05; // полуширина
const MID_A = -14.0;
const MID_F = 8.0;
const ATLAS = 2048;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА

export function mainDeckY(x) {
  return 6.05 + 0.35 * smooth((MID_A - 4 - x) / (MID_A - 4 - XS)) ** 1.2 + 0.3 * smooth((x - MID_F) / (XF - MID_F));
}
export function fcDeckY(x) {
  return 8.55 + 1.3 * Math.max(0, (x - XB) / (XF - XB)) ** 2.0;
}
const yTopV = (x) => fcDeckY(x); // «виртуальный» верх борта

function sec(xn) {
  let W = BEAM, wd = BEAM, yk = 0, yw = 3.5, nb = 2.7, rake = 0, s = 0, flare = 1.6;
  if (xn > MID_F) {
    s = clamp01((xn - MID_F) / (XF - MID_F));
    W = BEAM * Math.max(0, 1 - s ** 1.75) ** 0.95;
    wd = BEAM * Math.max(0, 1 - s ** 2.1) ** 0.68;
    yk = 3.7 * s ** 3.4;
    yw = 3.5 + 1.7 * s * s;
    nb = 2.7 - 0.9 * s;
    rake = -0.85 * s ** 1.6;
    flare = 1.6 + 0.9 * s;
  } else if (xn < MID_A) {
    s = clamp01((MID_A - xn) / (MID_A - XS));
    W = BEAM * Math.max(0, 1 - s ** 4.5) ** 0.45;
    wd = BEAM * Math.max(0, 1 - s ** 6.5) ** 0.36;
    yk = 3.5 * s ** 0.85;
    yw = 3.5 + 0.95 * s * s;
    nb = 2.7 - 0.6 * s;
    rake = 0.55 * s ** 2;
  }
  W = Math.max(W, 0.05);
  wd = Math.max(wd, 0.05);
  const yd = mainDeckY(xn);
  const yf = xn >= XB - 1e-6 ? fcDeckY(xn) : null;
  const yt = yTopV(xn);
  const yref = yf ?? yd;
  return { xn, s, W, wd, yk, yw, nb, rake, flare, yd, yf, yt, yref };
}

const QL = 0.6;
// Точка обвода правого борта по параметру q: 0 — киль, QL — наибольшая ширина, 1 — верх «виртуального» борта
function sideYZ(c, q) {
  if (q <= QL) {
    const th = -Math.PI / 2 + (q / QL) * (Math.PI / 2);
    const e = 2 / c.nb;
    return [c.yw - (c.yw - c.yk) * Math.abs(Math.sin(th)) ** e, c.W * Math.abs(Math.cos(th)) ** e];
  }
  const t = (q - QL) / (1 - QL);
  return [c.yw + (c.yt - c.yw) * t, c.W + (c.wd - c.W) * t ** c.flare];
}
const qOfY = (c, y) => {
  if (y >= c.yw) return QL + ((1 - QL) * (y - c.yw)) / (c.yt - c.yw);
  let lo = 0, hi = QL;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sideYZ(c, m)[0] < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};
const xAt = (c, y) => c.xn + c.rake * (c.yref - y);
function sideP(c, q) {
  const [y, z] = sideYZ(c, q);
  return V3(xAt(c, y), y, z);
}
function arcTo(c, q) {
  const n = Math.max(2, Math.ceil(q * 160));
  let a = 0;
  let prev = sideYZ(c, 0);
  for (let i = 1; i <= n; i++) {
    const p = sideYZ(c, (q * i) / n);
    a += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return a;
}
export const edgeZ = (x, y) => {
  const c = sec(x);
  return sideYZ(c, qOfY(c, y))[1];
};
// высота днища под точкой (x, |z|) (для винтов и валов); null — за пределами корпуса
function bottomY(x, z) {
  const c = sec(x);
  const az = Math.abs(z);
  if (az >= c.W) return null;
  let lo = 0, hi = QL;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sideYZ(c, m)[1] < az) lo = m;
    else hi = m;
  }
  return sideYZ(c, (lo + hi) / 2)[0];
}
const CAMBER = 0.12;
export function deckY(x, z = 0) {
  const c = sec(x);
  const y0 = x >= XB ? c.yf : c.yd;
  const w = sideYZ(c, qOfY(c, y0))[1];
  return y0 + CAMBER * Math.max(0, 1 - (z / w) ** 2);
}

const stationXs = (() => {
  const xs = [];
  const N = 170;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 0.45 * t + 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    xs.push(XS + (XF - XS) * u);
  }
  let k = 0;
  while (xs[k + 1] < XB) k++;
  if (XB - xs[k] < 0.15) xs.splice(k, 1);
  else if (xs[k + 1] - XB < 0.15) xs.splice(k + 1, 1);
  xs.push(XB);
  xs.sort((a, b) => a - b);
  return xs;
})();
const GIRTH = Math.max(...stationXs.map((x) => arcTo(sec(x), 1))) * 1.01;

// UV атласа: борт v 0.505…0.995, палубы 0.255…0.495, стены надстроек 0.005…0.245 (u 0…0.745), трубы (u 0.755…0.995)
const UX0 = XS - 0.6, UX1 = XF + 0.3;
const U = (x) => 0.005 + (0.99 * (x - UX0)) / (UX1 - UX0);
const xOfU = (u) => UX0 + ((u - 0.005) / 0.99) * (UX1 - UX0);
const V_SIDE = (arc) => 0.505 + (0.49 * arc) / GIRTH;
const ZD = 5.6;
const V_DECK = (z) => 0.255 + (0.24 * (z + ZD)) / (2 * ZD);
const WALL_H = 3.2;
const V_WALL = (band, h) => (band === 0 ? 0.006 : 0.127) + (0.115 * clamp01(h / WALL_H));
const KU_WALL = 0.735 / 48; // u на метр периметра
const FUN = { u0: 0.757, u1: 0.993, h: 8.0 };
const V_FUN = (h) => 0.006 + 0.236 * clamp01(h / FUN.h);

export function sideAt(x, y) {
  const f = (xn) => xAt(sec(xn), y);
  let lo = XS, hi = XF;
  if (x < f(lo) || x > f(hi)) return null;
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < x) lo = m;
    else hi = m;
  }
  const c = sec((lo + hi) / 2);
  if (y < c.yk) return null;
  const q = qOfY(c, y);
  const p0 = sideP(c, q);
  const pq = sideP(c, Math.min(1, q + 0.004)).sub(sideP(c, Math.max(0, q - 0.004)));
  const px = sideP(sec(c.xn + 0.02), q).sub(p0);
  const n = new THREE.Vector3().crossVectors(px, pq).normalize();
  if (n.z < 0) n.negate();
  return { z: p0.z, n, c, q };
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
  build({ orient = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const P = this.pos;
    const keep = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < this.idx.length; i += 3) {
      const [i0, i1, i2] = [this.idx[i], this.idx[i + 1], this.idx[i + 2]];
      a.fromArray(P, i0 * 3);
      b.fromArray(P, i1 * 3);
      c.fromArray(P, i2 * 3);
      if (b.sub(a).cross(c.sub(a)).length() > 1e-7) keep.push(i0, i1, i2);
    }
    if (orient && signedVolume(P, keep) < 0) {
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

// Тело вращения вокруг Y по профилю [[r, y], ...] снизу вверх; r = 0 — полюс; верх с r > 0 — плоская крышка;
// низ с r > 0 открыт (деталь стоит на поверхности), если не задан bottom: true
function lathe(profile, seg = 16, { bottom = false, top = true } = {}) {
  const m = new Mesher();
  const n = profile.length;
  const rings = [];
  for (let k = 0; k < n; k++) {
    const [r, y] = profile[k];
    const v = k / (n - 1);
    if (r === 0) {
      rings.push(m.v(V3(0, y, 0), 0.5, v));
      continue;
    }
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), j / seg, v));
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
    const c = m.v(V3(0, y, 0), 0.5, 0.5);
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ids.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)));
    }
    for (let j = 0; j < seg; j++) {
      if (up) m.tri(c, ids[(j + 1) % seg], ids[j]);
      else m.tri(c, ids[j], ids[(j + 1) % seg]);
    }
  };
  if (top) capAt(n - 1, true);
  if (bottom) capAt(0, false);
  return m.build({ orient: false });
}
const latheX = (profile, seg, opt) => lathe(profile, seg, { bottom: true, ...opt }).rotateZ(-Math.PI / 2);
const latheZ = (profile, seg, opt) => lathe(profile, seg, { bottom: true, ...opt }).rotateX(Math.PI / 2);

// Стержень между двумя точками; caps: 'both' | 'top' (низ в поверхности) | 'none'
function rod(a, b, r, seg = 6, caps = 'both') {
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  let g;
  if (caps === 'both') g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  else g = lathe([[r, -len / 2], [r, len / 2]], seg, { top: caps === 'top' });
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
const box = (sx, sy, sz, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
// Ящик без дна (стоит на палубе): нижняя грань не нужна
function boxOpen(sx, sy, sz, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const idx = Array.from(g.index.array);
  const ny = g.groups[3];
  idx.splice(ny.start, ny.count);
  g.setIndex(idx);
  g.clearGroups();
  return g.translate(x, y, z);
}

// Трубка вдоль ломаной с крышками на концах (без внутренних торцов на стыках)
function tubePath(points, r, seg = 6, { capStart = true, capEnd = true } = {}) {
  const P = points.map((p) => (p.isVector3 ? p : V3(...p)));
  const m = new Mesher();
  const n = P.length;
  const T = P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    return b.clone().sub(a).normalize();
  });
  let nrm = new THREE.Vector3(0, 1, 0);
  if (Math.abs(T[0].dot(nrm)) > 0.9) nrm = V3(1, 0, 0);
  nrm = nrm.sub(T[0].clone().multiplyScalar(nrm.dot(T[0]))).normalize();
  const rings = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      len += P[i].distanceTo(P[i - 1]);
      nrm = nrm.sub(T[i].clone().multiplyScalar(nrm.dot(T[i]))).normalize();
    }
    // масштаб на стыке, чтобы сечение не сужалось
    let k = 1;
    if (i > 0 && i < n - 1) {
      const d0 = P[i].clone().sub(P[i - 1]).normalize(), d1 = P[i + 1].clone().sub(P[i]).normalize();
      k = 1 / Math.max(0.6, Math.cos(d0.angleTo(d1) / 2));
    }
    const bin = new THREE.Vector3().crossVectors(T[i], nrm);
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const off = nrm.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(bin, Math.sin(a) * r);
      ring.push(m.v(P[i].clone().addScaledVector(off, i > 0 && i < n - 1 ? Math.min(k, 1.25) : 1), j / seg, clamp01(len / 50)));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) m.strip(rings[i], rings[i + 1]);
  const cap = (i, end) => {
    const c = m.v(P[i], 0.5, 0.5);
    for (let j = 0; j < seg; j++) {
      if (end) m.tri(c, rings[i][j], rings[i][j + 1]);
      else m.tri(c, rings[i][j + 1], rings[i][j]);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(n - 1, true);
  const g = m.build({ orient: false });
  // ориентация: боковая грань наружу
  const pos = g.attributes.position, idx = g.index.array;
  const a = new THREE.Vector3().fromBufferAttribute(pos, idx[0]);
  const b = new THREE.Vector3().fromBufferAttribute(pos, idx[1]);
  const c = new THREE.Vector3().fromBufferAttribute(pos, idx[2]);
  const fn = b.clone().sub(a).cross(c.clone().sub(a));
  const cen = a.clone().add(b).add(c).divideScalar(3);
  const out = cen.clone().sub(P[0]);
  out.sub(T[0].clone().multiplyScalar(out.dot(T[0])));
  if (fn.dot(out) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.computeVertexNormals();
  }
  return g;
}

// Призма: многоугольник в плоскости XY, толщина по Z (центр z = 0)
function prism(poly, th, { skip = null } = {}) {
  const m = new Mesher();
  let pts = poly.map(([x, y], i) => Object.assign(new THREE.Vector2(x, y), { src: i }));
  if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  pts.forEach((p) => {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  });
  const uv = (p) => [(p.x - x0) / (x1 - x0 || 1), (p.y - y0) / (y1 - y0 || 1)];
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const front = pts.map((p) => m.v(V3(p.x, p.y, th / 2), ...uv(p)));
  const back = pts.map((p) => m.v(V3(p.x, p.y, -th / 2), ...uv(p)));
  tris.forEach(([a, b, c]) => {
    m.tri(front[a], front[b], front[c]);
    m.tri(back[a], back[c], back[b]);
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (skip && skip(pts[i].src, pts[j].src)) continue;
    const a = m.v(V3(pts[i].x, pts[i].y, th / 2), i / n, 0);
    const b = m.v(V3(pts[j].x, pts[j].y, th / 2), (i + 1) / n, 0);
    const c = m.v(V3(pts[j].x, pts[j].y, -th / 2), (i + 1) / n, 1);
    const d = m.v(V3(pts[i].x, pts[i].y, -th / 2), i / n, 1);
    m.quad(a, d, c, b);
  }
  return m.build();
}

// Лофт замкнутых колец с крышками
function loftRings(rings, uvFn = () => [0.5, 0.5], { caps = true } = {}) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, ...uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
  if (caps)
    [0, rings.length - 1].forEach((k) => {
      const c = new THREE.Vector3();
      rings[k].forEach((p) => c.add(p));
      c.divideScalar(rings[k].length);
      const ci = m.v(c, ...uvFn(c));
      const r = ids[k];
      for (let j = 0; j < r.length; j++) {
        if (k === 0) m.tri(ci, r[j], r[(j + 1) % r.length]);
        else m.tri(ci, r[(j + 1) % r.length], r[j]);
      }
    });
  return m.build();
}

const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);

// Лопасть винта: радиальная ось +Y, ось вращения X
function bladeGeometry({ r0, r1, chord0, chord1, pitch, skew = 0, tc = 0.1, n = 7 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = lerp(chord0, chord1, Math.sin(s * Math.PI * 0.85)) * (k === n ? 0.45 : 1);
    const beta = Math.atan(pitch / (2 * Math.PI * r));
    const d = V3(Math.sin(beta), 0, Math.cos(beta));
    const nn = V3(Math.cos(beta), 0, -Math.sin(beta));
    const ring = [];
    const M = 8;
    const pts = [];
    for (let j = 0; j <= M; j++) pts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const off = skew * s * s;
    const add = (t, sign) => {
      const c = (0.5 - t) * ch + off;
      const h = sign * Math.max(0.006, naca(t) * tc * ch * (1 - 0.6 * s));
      const p = d.clone().multiplyScalar(c).addScaledVector(nn, h);
      const ang = p.z / r;
      ring.push(V3(p.x, r * Math.cos(ang), r * Math.sin(ang)));
    };
    for (const t of pts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(pts[j], -1);
    rings.push(ring);
  }
  return loftRings(rings, (p) => [0.5 + 0.4 * Math.tanh(p.x), clamp01(p.y / r1)]);
}

// Перо: размах по +Y от y0, хорда по X (передняя кромка +X), толщина по Z
function foil({ root, tip, span, tc = 0.12, y0 = 0, nSpan = 4, nCh = 10 }) {
  const rings = [];
  for (let k = 0; k <= nSpan; k++) {
    const s = k / nSpan;
    const y = y0 + span * s;
    const le = lerp(root[0], tip[0], s), te = lerp(root[1], tip[1], s);
    const ch = le - te;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= nCh; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nCh));
    for (const t of ts) ring.push(V3(le - t * ch, y, Math.max(0.008, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(V3(le - ts[j] * ch, y, -Math.max(0.008, naca(ts[j]) * tc * ch)));
    rings.push(ring);
  }
  return loftRings(rings, (p) => [clamp01((p.x - root[1]) / (root[0] - root[1] + 1e-6)), clamp01((p.y - y0) / span)]);
}

function mirrorZ(g) {
  const out = g.clone();
  out.scale(1, 1, -1);
  const idx = out.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  out.index.needsUpdate = true;
  out.computeVertexNormals();
  return out;
}

// Протяжка профиля [[смещение наружу, y], ...] вдоль контура [[x, z], ...] (замкнутого или открытого)
function sweepPath(loop, profile, uvFn, { closed = true, caps = false } = {}) {
  const m = new Mesher();
  const n = loop.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = loop[i], [x1, z1] = loop[(i + 1) % n];
    area += x0 * z1 - x1 * z0;
  }
  const sgn = area > 0 ? 1 : -1;
  const per = [0];
  const cnt = closed ? n : n - 1;
  for (let i = 1; i <= cnt; i++) {
    const [x0, z0] = loop[i - 1], [x1, z1] = loop[i % n];
    per.push(per[i - 1] + Math.hypot(x1 - x0, z1 - z0));
  }
  const normals = loop.map((p, i) => {
    const a = closed || i > 0 ? loop[(i - 1 + n) % n] : null;
    const b = closed || i < n - 1 ? loop[(i + 1) % n] : null;
    const e1 = a ? [p[0] - a[0], p[1] - a[1]] : [b[0] - p[0], b[1] - p[1]];
    const e2 = b ? [b[0] - p[0], b[1] - p[1]] : e1;
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    const l1 = Math.hypot(...n1), l2 = Math.hypot(...n2);
    const nx = n1[0] / l1 + n2[0] / l2, nz = n1[1] / l1 + n2[1] / l2;
    const l = Math.hypot(nx, nz);
    const cosh = (nx / l) * (n1[0] / l1) + (nz / l) * (n1[1] / l1);
    const k = (-sgn / Math.max(0.4, cosh)) / l;
    return [nx * k, nz * k];
  });
  const rowsAll = [];
  for (let k = 0; k < profile.length; k++) {
    const pr = profile[k];
    const ids = [];
    for (let i = 0; i <= cnt; i++) {
      const j = i % n;
      const yb = typeof pr[1] === 'function' ? pr[1](loop[j]) : pr[1];
      const p = V3(loop[j][0] + normals[j][0] * pr[0], yb, loop[j][1] + normals[j][1] * pr[0]);
      ids.push(m.v(p, ...uvFn(per[i], pr, k, p)));
    }
    rowsAll.push(ids);
  }
  for (let k = 0; k < profile.length - 1; k++) m.strip(rowsAll[k], rowsAll[k + 1]);
  if (caps && !closed) {
    // торцы: профиль считается замкнутым многоугольником
    [0, cnt].forEach((i) => {
      const ring = rowsAll.map((r) => r[i]);
      const pts = ring.map((id) => V3().fromArray(m.pos, id * 3));
      const c = pts.reduce((s, p) => s.add(p), V3(0, 0, 0)).divideScalar(pts.length);
      const ci = m.v(c, m.uv[ring[0] * 2], m.uv[ring[0] * 2 + 1]);
      for (let j = 0; j < ring.length; j++) {
        if (i === 0) m.tri(ci, ring[(j + 1) % ring.length], ring[j]);
        else m.tri(ci, ring[j], ring[(j + 1) % ring.length]);
      }
    });
  }
  return m.build({ orient: false });
}

// Ориентировать грани наружу относительно центра (для выпуклых-ish тел)
function orientOut(g, center) {
  const pos = g.attributes.position, idx = g.index.array;
  let s = 0;
  const a = V3(), b = V3(), c = V3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]);
    b.fromBufferAttribute(pos, idx[i + 1]);
    c.fromBufferAttribute(pos, idx[i + 2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const m = a.clone().add(b).add(c).divideScalar(3).sub(center);
    s += Math.sign(n.dot(m));
  }
  if (s < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.computeVertexNormals();
  }
  return g;
}

function clean(g) {
  let out = g.index ? g : mergeVertices(g);
  if (!out.attributes.uv) {
    const n = out.attributes.position.count;
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2).fill(0.5), 2));
  }
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  out.clearGroups();
  // UV строго 0…1
  const uv = out.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, clamp01(uv.getX(i)), clamp01(uv.getY(i)));
  return out;
}
const merge = (list) => mergeVertices(mergeGeometries(list.map(clean)), 1e-5);

// Скруглённый прямоугольник в плане (против часовой при взгляде сверху: x вперёд, z вправо)
function roundRect(x0, x1, z0, z1, r, seg = 3) {
  const pts = [];
  const corners = [
    [x1 - r, z1 - r, 0],
    [x0 + r, z1 - r, Math.PI / 2],
    [x0 + r, z0 + r, Math.PI],
    [x1 - r, z0 + r, (3 * Math.PI) / 2],
  ];
  corners.forEach(([cx, cz, a0]) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  });
  return pts;
}

// Рубка-надстройка: стенки по контуру от y0 до y0 + h, UV стен в полосе band атласа, крыша (по желанию) — UV палубы
function house(poly, y0, h, { band = 0, roof = true, u0 = 0.004, yBot = null, holes = [] } = {}) {
  const v2 = (q) => q.map(([x, z]) => new THREE.Vector2(x, z));
  const ccw = (q) => (THREE.ShapeUtils.isClockWise(v2(q)) ? [...q].reverse() : q);
  const outer = ccw(poly);
  const n = outer.length;
  const yb = yBot ?? y0;
  // стены: обход контура против часовой (вид сверху в осях x, z) -> strip(низ, верх) смотрит наружу при
  // площади > 0 (см. sweepPath); проверяем по первому треугольнику
  const w = new Mesher();
  let per = 0;
  const B = [], T = [];
  for (let i = 0; i <= n; i++) {
    const p = outer[i % n];
    if (i > 0) per += Math.hypot(p[0] - outer[i - 1][0], p[1] - outer[i - 1][1]);
    const u = u0 + per * KU_WALL;
    B.push(w.v(V3(p[0], yb, p[1]), u, V_WALL(band, yb - y0)));
    T.push(w.v(V3(p[0], y0 + h, p[1]), u, V_WALL(band, h)));
  }
  w.strip(B, T);
  const wg = w.build({ orient: false });
  {
    const idx = wg.index.array, pos = wg.attributes.position;
    const a = V3().fromBufferAttribute(pos, idx[0]), b = V3().fromBufferAttribute(pos, idx[1]), c = V3().fromBufferAttribute(pos, idx[2]);
    const nrm = b.clone().sub(a).cross(c.clone().sub(a));
    const cx = outer.reduce((s, p) => s + p[0], 0) / n, cz = outer.reduce((s, p) => s + p[1], 0) / n;
    const mid = a.clone().add(b).add(c).divideScalar(3);
    if (nrm.x * (mid.x - cx) + nrm.z * (mid.z - cz) < 0) {
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      wg.computeVertexNormals();
    }
  }
  const out = [wg];
  if (roof) {
    const r = new Mesher();
    const hl = holes.map((q) => [...ccw(q)].reverse());
    const tris = THREE.ShapeUtils.triangulateShape(v2(outer), hl.map(v2));
    const all = [...outer, ...hl.flat()];
    const R = all.map(([x, z]) => r.v(V3(x, y0 + h, z), U(x), V_DECK(z)));
    tris.forEach(([a, b, c]) => {
      // нормаль вверх: (b - a) × (c - a) по y > 0
      const [ax, az] = all[a], [bx, bz] = all[b], [cx, cz] = all[c];
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (ny > 0) r.tri(R[a], R[b], R[c]);
      else r.tri(R[a], R[c], R[b]);
    });
    out.push(r.build({ orient: false }));
  }
  return { g: merge(out), per };
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Профиль сечения: функция «высота → длина обвода»
function arcAtYFn(c) {
  const N = 220;
  const ys = [], as = [];
  let a = 0;
  let prev = sideYZ(c, 0);
  ys.push(prev[0]);
  as.push(0);
  for (let i = 1; i <= N; i++) {
    const p = sideYZ(c, i / N);
    a += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    ys.push(p[0]);
    as.push(a);
  }
  return (y) => {
    if (y <= ys[0]) return 0;
    for (let i = 1; i <= N; i++) if (ys[i] >= y) return lerp(as[i - 1], as[i], (y - ys[i - 1]) / (ys[i] - ys[i - 1] || 1));
    return as[N];
  };
}


// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function paintAtlas() {
  const S = ATLAS;
  const col = makeCanvas(S, S), hgt = makeCanvas(S, S);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  let seed = 7654321;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const px = (u) => u * S;
  const py = (v) => (1 - v) * S;
  Hc.fillStyle = 'rgb(128,128,128)';
  Hc.fillRect(0, 0, S, S);
  const line = (ctx, x0, y0, x1, y1, w, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const GREY = '#6c7479'; // Home Fleet, средне-серый 507B

  // ---- БОРТ (v 0.5…1)
  const hullBot = py(0.5);
  C.fillStyle = GREY;
  C.fillRect(0, 0, S, hullBot);
  const arcFns = [];
  for (let i = 0; i < S; i++) {
    const xn = Math.min(XF, Math.max(XS, xOfU((i + 0.5) / S)));
    const c = sec(xn);
    const f = arcAtYFn(c);
    arcFns.push(f);
    const yTopPx = py(V_SIDE(f(WL - 0.08)));
    C.fillStyle = '#3a2624'; // тёмная необрастающая краска
    C.fillRect(i, yTopPx, 1, hullBot - yTopPx);
    const b0 = py(V_SIDE(f(WL + 0.32)));
    C.fillStyle = '#1e2022'; // ватерлинейная полоса
    C.fillRect(i, b0, 1, yTopPx - b0);
  }
  // пятна, потёки
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * S, y = rnd() * hullBot;
    const r = 6 + rnd() * 30;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.007)' : 'rgba(0,0,0,0.012)';
    C.beginPath();
    C.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2);
    C.fill();
  }
  // швы обшивки: продольные (по обводу) и стыки листов
  for (let a = 0.9; a < GIRTH; a += 1.15) {
    const y = py(V_SIDE(a));
    line(C, 0, y, S, y, 1.5, 'rgba(20,24,26,0.16)');
    line(Hc, 0, y, S, y, 2, 'rgb(100,100,100)');
  }
  for (let x = XS + 1.5; x < XF; x += 4.2 + rnd() * 1.2) {
    const X = px(U(x));
    line(C, X, 0, X, hullBot, 1.5, 'rgba(20,24,26,0.14)');
    line(Hc, X, 0, X, hullBot, 2, 'rgb(102,102,102)');
  }
  // элемент на борту в метрах: центр (x, y), размеры (dx, dy)
  const sx = (0.99 * S) / (UX1 - UX0);
  const sy = (0.49 * S) / GIRTH;
  const hullMark = (x, y, dx, dy, fill, hFill, stroke = null, rr = 0.5) => {
    const i = Math.round(px(U(x)));
    if (i < 0 || i >= S) return;
    const f = arcFns[i];
    const X = px(U(x)), Y = py(V_SIDE(f(y)));
    const w = dx * sx, h = dy * sy;
    const draw = (ctx, fs, st) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X - w / 2, Y - h / 2, w, h, Math.min(w, h) * rr);
      else ctx.rect(X - w / 2, Y - h / 2, w, h);
      if (fs) {
        ctx.fillStyle = fs;
        ctx.fill();
      }
      if (st) {
        ctx.strokeStyle = st[0];
        ctx.lineWidth = st[1];
        ctx.stroke();
      }
    };
    draw(C, fill, stroke);
    draw(Hc, hFill, stroke ? ['rgb(160,160,160)', stroke[1]] : null);
  };
  // иллюминаторы: в полубаке и в корме
  for (let x = 17.5; x < 43; x += 1.5) {
    if (Math.abs(x - 30) < 0.7) continue;
    hullMark(x, mainDeckY(x) + 1.3, 0.34, 0.34, '#15181a', 'rgb(50,50,50)', ['rgba(170,175,178,0.9)', 2], 0.5);
  }
  for (let x = -46; x < -27; x += 1.6) hullMark(x, mainDeckY(x) - 1.0, 0.34, 0.34, '#15181a', 'rgb(50,50,50)', ['rgba(170,175,178,0.9)', 2], 0.5);
  // шпигаты у кромки палубы
  for (let x = XS + 3; x < XF - 4; x += 3.1) {
    const y = (x >= XB ? fcDeckY(x) : mainDeckY(x)) - 0.12;
    hullMark(x, y, 0.28, 0.1, '#202426', 'rgb(70,70,70)', null, 0.3);
    if (rnd() < 0.35) {
      const i = Math.round(px(U(x)));
      const Y = py(V_SIDE(arcFns[i](y)));
      const g = C.createLinearGradient(0, Y, 0, Y + 60);
      g.addColorStop(0, 'rgba(80,60,45,0.22)');
      g.addColorStop(1, 'rgba(80,60,45,0)');
      C.fillStyle = g;
      C.fillRect(px(U(x)) - 2, Y, 4, 60);
    }
  }
  // забортные отверстия (охлаждение) над ватерлинией
  [[-4, 4.35], [-6.5, 4.3], [6.0, 4.3], [9.0, 4.35]].forEach(([x, y]) => hullMark(x, y, 0.35, 0.25, '#202224', 'rgb(60,60,60)', null, 0.5));
  // клюзы: тёмная окантовка
  hullMark(HAWSE.x, HAWSE.y, 0.75, 0.75, '#2a2d30', 'rgb(110,110,110)', null, 0.5);

  // ---- ПАЛУБЫ (v 0.25…0.5)
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = '#4b4744'; // корабельный линолеум (кортицен)
  C.fillRect(0, d0, S, d1 - d0);
  for (let i = 0; i < 900; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.02)';
    C.beginPath();
    C.ellipse(rnd() * S, d0 + rnd() * (d1 - d0), 6 + rnd() * 28, 4 + rnd() * 14, 0, 0, Math.PI * 2);
    C.fill();
  }
  for (let z = -ZD + 0.35; z < ZD; z += 1.5) {
    const y = py(V_DECK(z));
    line(C, 0, y, S, y, 1.2, 'rgba(25,28,30,0.18)');
    line(Hc, 0, y, S, y, 2, 'rgb(96,96,96)');
  }
  for (let x = XS; x < XF; x += 1.83) {
    const X = px(U(x));
    line(C, X, d0, X, d1, 1.5, 'rgba(140,125,95,0.16)'); // латунные планки линолеума
    line(Hc, X, d0, X, d1, 2, 'rgb(98,98,98)');
  }
  // протёртые дорожки по палубе
  C.fillStyle = 'rgba(150,150,140,0.06)';
  C.fillRect(0, py(V_DECK(2.0)), S, py(V_DECK(-2.0)) - py(V_DECK(2.0)));

  // ---- СТЕНЫ НАДСТРОЕК (v 0…0.25, u 0…0.745): полоса 0 — иллюминаторы, полоса 1 — окна рубки
  const w0 = 0, w1 = px(0.75);
  const bandY = (band, h) => py(V_WALL(band, h));
  C.fillStyle = '#717980';
  C.fillRect(w0, py(0.25), w1, S - py(0.25));
  for (let i = 0; i < 400; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.016)' : 'rgba(0,0,0,0.02)';
    C.beginPath();
    C.ellipse(rnd() * w1, py(0.25) + rnd() * (S - py(0.25)), 8 + rnd() * 26, 5 + rnd() * 16, 0, 0, Math.PI * 2);
    C.fill();
  }
  const mpx = KU_WALL * S; // пикселей на метр по u
  const mpy = (0.115 * S) / WALL_H;
  [0, 1].forEach((band) => {
    // горизонтальные швы и потёки у основания
    [0.9, 2.1].forEach((h) => {
      line(C, w0, bandY(band, h), w1, bandY(band, h), 1.5, 'rgba(20,24,26,0.18)');
      line(Hc, w0, bandY(band, h), w1, bandY(band, h), 2, 'rgb(100,100,100)');
    });
    const g = C.createLinearGradient(0, bandY(band, 0), 0, bandY(band, 0.5));
    g.addColorStop(0, 'rgba(50,44,36,0.35)');
    g.addColorStop(1, 'rgba(50,44,36,0)');
    C.fillStyle = g;
    C.fillRect(w0, bandY(band, 0.5), w1, bandY(band, 0) - bandY(band, 0.5));
    for (let m = 1.0; m < 48; m += 1.8) {
      const X = px(0.004 + m * KU_WALL);
      line(C, X, bandY(band, 0), X, bandY(band, WALL_H), 1.2, 'rgba(20,24,26,0.12)');
      line(Hc, X, bandY(band, 0), X, bandY(band, WALL_H), 2, 'rgb(104,104,104)');
    }
  });
  // полоса 0: иллюминаторы на высоте 1.55 м и двери
  for (let m = 0.7; m < 48; m += 1.45) {
    const X = px(0.004 + m * KU_WALL), Y = bandY(0, 1.6);
    if (Math.round(m / 1.45) % 7 === 3) {
      // дверь
      C.fillStyle = '#656c71';
      C.fillRect(X - 0.35 * mpx, bandY(0, 1.85), 0.7 * mpx, 1.65 * mpy);
      C.strokeStyle = 'rgba(25,28,30,0.7)';
      C.lineWidth = 2;
      C.strokeRect(X - 0.35 * mpx, bandY(0, 1.85), 0.7 * mpx, 1.65 * mpy);
      Hc.strokeStyle = 'rgb(170,170,170)';
      Hc.lineWidth = 3;
      Hc.strokeRect(X - 0.35 * mpx, bandY(0, 1.85), 0.7 * mpx, 1.65 * mpy);
      C.fillStyle = '#2a2d30';
      C.fillRect(X + 0.2 * mpx, bandY(0, 1.0), 4, 4);
      continue;
    }
    C.fillStyle = '#121416';
    C.beginPath();
    C.ellipse(X, Y, 0.17 * mpx, 0.17 * mpy, 0, 0, Math.PI * 2);
    C.fill();
    C.strokeStyle = 'rgba(175,178,180,0.9)';
    C.lineWidth = 2;
    C.stroke();
    Hc.fillStyle = 'rgb(60,60,60)';
    Hc.beginPath();
    Hc.ellipse(X, Y, 0.2 * mpx, 0.2 * mpy, 0, 0, Math.PI * 2);
    Hc.fill();
  }
  // полоса 1: прямоугольные окна рубки
  for (let m = 0.45; m < 48; m += 0.95) {
    const X = px(0.004 + m * KU_WALL);
    C.fillStyle = '#1a2328';
    C.fillRect(X - 0.32 * mpx, bandY(1, 2.0), 0.64 * mpx, 0.75 * mpy);
    C.fillStyle = 'rgba(150,175,190,0.25)';
    C.fillRect(X - 0.32 * mpx, bandY(1, 2.0), 0.64 * mpx, 0.2 * mpy);
    C.strokeStyle = 'rgba(190,195,198,0.9)';
    C.lineWidth = 2;
    C.strokeRect(X - 0.32 * mpx, bandY(1, 2.0), 0.64 * mpx, 0.75 * mpy);
    Hc.fillStyle = 'rgb(70,70,70)';
    Hc.fillRect(X - 0.32 * mpx, bandY(1, 2.0), 0.64 * mpx, 0.75 * mpy);
  }

  // ---- ТРУБА (u 0.755…0.995)
  const f0 = px(FUN.u0 - 0.002), f1 = px(FUN.u1 + 0.002);
  C.fillStyle = '#70787e';
  C.fillRect(f0, py(0.25), f1 - f0, S - py(0.25));
  // сажа к верху
  {
    const g = C.createLinearGradient(0, py(V_FUN(FUN.h - 0.6)), 0, py(V_FUN(FUN.h - 3.0)));
    g.addColorStop(0, 'rgba(30,30,30,0.35)');
    g.addColorStop(1, 'rgba(30,30,30,0)');
    C.fillStyle = g;
    C.fillRect(f0, py(V_FUN(FUN.h - 0.6)), f1 - f0, py(V_FUN(FUN.h - 3.0)) - py(V_FUN(FUN.h - 0.6)));
  }
  C.fillStyle = '#16181a'; // чёрный колпак
  C.fillRect(f0, py(0.25), f1 - f0, py(V_FUN(FUN.h - 0.6)) - py(0.25));
  [2.0, 4.0, 6.0].forEach((h) => {
    line(C, f0, py(V_FUN(h)), f1, py(V_FUN(h)), 2, 'rgba(20,24,26,0.25)');
    line(Hc, f0, py(V_FUN(h)), f1, py(V_FUN(h)), 3, 'rgb(150,150,150)');
  });
  // рёбра-«пояса» у колпака
  line(Hc, f0, py(V_FUN(FUN.h - 0.6)), f1, py(V_FUN(FUN.h - 0.6)), 4, 'rgb(170,170,170)');

  // карта нормалей из высот
  const hd = Hc.getImageData(0, 0, S, S).data;
  const nrm = makeCanvas(S, S);
  const N = nrm.getContext('2d');
  const img = N.createImageData(S, S);
  const k = 2.0 / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const at = (xx, yy) => hd[(Math.min(S - 1, Math.max(0, yy)) * S + Math.min(S - 1, Math.max(0, xx))) * 4];
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      img.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  N.putImageData(img, 0, 0);

  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.anisotropy = 8;
  map.name = 'Paint_Atlas_Color';
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = 'Paint_Atlas_Normal';
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// КОРПУС

const NL = 16; // рядов от киля до наибольшей ширины
const NU = 6; // от наибольшей ширины до главной палубы
const NF = 4; // от главной палубы до полубака
const ND = 14; // поперёк палубы
const HAWSE = { x: 46.2, y: 8.6 };

function buildHull() {
  const m = new Mesher();
  const rings = [];
  for (const xn of stationXs) {
    const c = sec(xn);
    const qs = [];
    for (let i = 0; i <= NL; i++) qs.push((QL * i) / NL);
    for (let j = 1; j <= NU; j++) qs.push(qOfY(c, lerp(c.yw, c.yd, j / NU)));
    const nMain = qs.length;
    if (c.yf != null) for (let j = 1; j <= NF; j++) qs.push(qOfY(c, lerp(c.yd, c.yf, j / NF)));
    const Sx = [], Px = [];
    for (const q of qs) {
      const p = sideP(c, q);
      const uv = [U(xn), V_SIDE(arcTo(c, q))];
      Sx.push(m.v(p, ...uv));
      Px.push(m.v(V3(p.x, p.y, -p.z), ...uv));
    }
    const deckRow = (yTop) => {
      const w = sideYZ(c, qOfY(c, yTop))[1];
      const D = [];
      for (let j = 0; j <= ND; j++) {
        const z = w * (1 - (2 * j) / ND);
        const y = yTop + CAMBER * (1 - (z / w) ** 2);
        D.push(m.v(V3(xAt(c, y), y, z), U(xn), V_DECK(z)));
      }
      return D;
    };
    const Dm = xn <= XB + 1e-6 ? deckRow(c.yd) : null;
    const Df = c.yf != null ? deckRow(c.yf) : null;
    rings.push({ S: Sx, P: Px, Dm, Df, nMain, c });
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k], b = rings[k + 1];
    const nm = a.nMain;
    m.strip(a.S.slice(0, nm), b.S.slice(0, nm));
    m.strip(b.P.slice(0, nm), a.P.slice(0, nm));
    if (a.Df && b.Df) {
      m.strip(a.S.slice(nm - 1), b.S.slice(nm - 1));
      m.strip(b.P.slice(nm - 1), a.P.slice(nm - 1));
      m.strip(a.Df, b.Df);
    }
    if (a.Dm && b.Dm) m.strip(a.Dm, b.Dm);
  }
  // торцы: корма и форштевень — веер по контуру
  const capFan = (r, D, rev) => {
    const loop = [...r.S, ...D.slice(1, -1), ...[...r.P].reverse().slice(0, -1)];
    const c = V3();
    loop.forEach((i) => c.add(V3().fromArray(m.pos, i * 3)));
    c.divideScalar(loop.length);
    const mid = r.S[Math.floor(r.S.length / 2)];
    const ci = m.v(c, m.uv[mid * 2], m.uv[mid * 2 + 1]);
    for (let j = 0; j < loop.length; j++) {
      if (!rev) m.tri(ci, loop[j], loop[(j + 1) % loop.length]);
      else m.tri(ci, loop[(j + 1) % loop.length], loop[j]);
    }
  };
  capFan(rings[0], rings[0].Dm, false);
  const last = rings[rings.length - 1];
  capFan(last, last.Df, true);
  const hull = m.build();

  // переборка среза полубака (плоская, x = XB), смотрит в корму
  const rb = rings.find((r) => Math.abs(r.c.xn - XB) < 1e-6);
  const bm = new Mesher();
  const P = (id) => V3().fromArray(m.pos, id * 3);
  const nm = rb.nMain;
  const outline = [
    ...rb.Dm.map(P), // правый → левый по главной палубе
    ...rb.P.slice(nm, nm + NF).map(P), // вверх по левому борту
    ...[...rb.Df].reverse().slice(1, -1).map(P), // по палубе полубака слева направо... (без крайних)
    ...[...rb.S.slice(nm - 1, nm + NF)].reverse().slice(0, -1).map(P), // вниз по правому борту
  ];
  // точка Df[0] (правая кромка) = S[nm-1+NF], Df[ND] = P[nm-1+NF] — уже в контуре
  const zMax = Math.max(...outline.map((p) => Math.abs(p.z)));
  const y0 = Math.min(...outline.map((p) => p.y));
  const ids = outline.map((p) => bm.v(p, 0.004 + (p.z + zMax) * KU_WALL, V_WALL(0, p.y - y0 + 0.55)));
  const tris = THREE.ShapeUtils.triangulateShape(outline.map((p) => new THREE.Vector2(p.z, p.y)), []);
  tris.forEach(([a, b, c]) => {
    const A = outline[a], B = outline[b], Cc = outline[c];
    const n = B.clone().sub(A).cross(Cc.clone().sub(A));
    if (n.x < 0) bm.tri(ids[a], ids[b], ids[c]);
    else bm.tri(ids[a], ids[c], ids[b]);
  });
  const bulkhead = bm.build({ orient: false });
  return { hull, bulkhead };
}


// ---------------------------------------------------------------------------
// ВООРУЖЕНИЕ: 4,7-дюймовое орудие Mk IX на станке CP XIV со щитом. Начало — центр погона, ось поворота Y.
function buildGun47() {
  const p = [];
  const ty = 1.05; // ось цапф
  p.push(lathe([[1.0, 0], [1.0, 0.1], [0.9, 0.15], [0, 0.16]], 28)); // вращающийся погон
  p.push(lathe([[0.42, 0.14], [0.38, ty - 0.3], [0.28, ty - 0.2], [0, ty - 0.19]], 16)); // тумба
  [1, -1].forEach((sd) => {
    p.push(prism([[-0.55, 0.14], [0.45, 0.14], [0.3, ty + 0.16], [-0.2, ty + 0.2], [-0.5, ty - 0.1]], 0.08).translate(0, 0, sd * 0.33));
    p.push(new THREE.TorusGeometry(0.18, 0.025, 6, 14).translate(-0.25, ty - 0.25, sd * 0.52)); // маховики наводки
    p.push(rod([-0.25, ty - 0.25, sd * 0.37], [-0.25, ty - 0.25, sd * 0.52], 0.025, 6));
    p.push(box(0.3, 0.06, 0.26, -0.75, 0.62, sd * 0.68)); // сиденья наводчиков
    p.push(rod([-0.45, 0.16, sd * 0.34], [-0.75, 0.6, sd * 0.68], 0.03, 6));
  });
  p.push(rod([0, ty, -0.38], [0, ty, 0.38], 0.09, 12)); // цапфы
  p.push(box(1.7, 0.36, 0.46, 0.2, ty, 0)); // люлька
  p.push(rod([-0.75, ty + 0.3, 0], [1.05, ty + 0.3, 0], 0.1, 12)); // накатник
  p.push(
    latheX([[0.2, -1.15], [0.2, -0.75], [0.15, -0.65], [0.13, 0.9], [0.1, 3.4], [0.085, 4.25], [0.1, 4.3], [0.1, 4.4], [0.06, 4.4], [0.06, 4.2], [0, 4.2]], 18).translate(0, ty, 0),
  );
  p.push(box(0.44, 0.42, 0.42, -1.35, ty, 0)); // затвор
  p.push(box(0.8, 0.06, 0.36, -1.95, ty - 0.12, 0)); // лоток досылателя
  p.push(rod([0.35, ty + 0.22, -0.42], [-0.45, ty + 0.22, -0.42], 0.045, 8)); // прицел
  // щит: гнутый лист (лоб + крыша) и боковые листы, открыт сзади
  const outer = [[0.98, 0.18], [0.8, 1.98], [0.6, 2.18], [-1.45, 2.18]];
  const inner = [[-1.45, 2.12], [0.56, 2.12], [0.74, 1.94], [0.92, 0.18]];
  p.push(prism([...outer, ...inner], 2.42));
  [1, -1].forEach((sd) => p.push(prism([[-1.5, 0.18], [0.98, 0.18], [0.8, 1.98], [0.6, 2.18], [-1.5, 2.18]], 0.05).translate(0, 0, sd * 1.22)));
  // колпак прицела на крыше щита
  p.push(boxOpen(0.5, 0.22, 0.4, -0.1, 2.29, -0.6));
  return merge(p);
}

// Четырёхтрубный 21-дюймовый торпедный аппарат. Начало — центр погона, трубы дульцами в +X.
function buildTubes() {
  const p = [];
  p.push(lathe([[1.45, 0], [1.45, 0.14], [1.3, 0.18], [0, 0.19]], 28));
  [-1.35, 1.9].forEach((x) => p.push(box(0.4, 0.55, 3.15, x, 0.45, 0))); // ложементы
  [-1.14, -0.38, 0.38, 1.14].forEach((z) => {
    p.push(
      latheX([[0.37, -3.3], [0.37, -3.1], [0.32, -3.05], [0.32, 3.65], [0.35, 3.7], [0.35, 3.85], [0.27, 3.85], [0.27, 3.6], [0, 3.6]], 16).translate(0, 0.86, z),
    );
    p.push(box(0.14, 0.14, 0.08, -3.4, 0.86, z)); // замок задней крышки
  });
  // бандажи по трубам
  [0.6, 2.8].forEach((x) => p.push(box(0.16, 0.12, 3.1, x, 1.24, 0)));
  // пост наводчика сзади: площадка, щиток, прицел
  p.push(box(0.9, 0.08, 1.6, -3.95, 0.3, 0));
  [-0.6, 0.6].forEach((z) => p.push(rod([-3.95, 0.14, z], [-3.95, 0.3, z], 0.05, 6)));
  p.push(box(0.06, 0.8, 1.2, -4.35, 0.74, 0));
  p.push(rod([-3.6, 1.55, -0.2], [-3.6, 1.55, 0.2], 0.06, 8));
  p.push(rod([-3.6, 1.3, 0], [-3.6, 1.55, 0], 0.04, 6));
  return merge(p);
}

// ---------------------------------------------------------------------------

export function createDestroyerD() {
  const ship = new THREE.Group();
  ship.name = 'Destroyer_D_Class';
  const { map, normalMap } = paintAtlas();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    paint: std('Hull_Paint_Atlas', 0xffffff, 0.7, 0.12, { map, normalMap }),
    grey: std('Steel_Grey', 0x737b80, 0.62, 0.25),
    dark: std('Steel_Dark', 0x2f3336, 0.6, 0.35),
    bottom: std('Antifouling_Dark', 0x3a2624, 0.75, 0.1),
    bronze: std('Propeller_Bronze', 0xa07a45, 0.32, 0.9),
    wire: std('Rigging_Wire', 0x26282a, 0.55, 0.6),
    canvas: std('Canvas_Cover', 0x7d7a6c, 0.9, 0.0),
    boat: std('Boat_Paint', 0x7f878c, 0.55, 0.05),
  };
  const group = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const mesh = (geo, mat, name, parent, x = 0, y = 0, z = 0) => {
    const mm = new THREE.Mesh(geo, mat);
    mm.name = name;
    geo.name = name;
    mm.position.set(x, y, z);
    parent.add(mm);
    return mm;
  };
  const dY = (x, z = 0) => deckY(x, z);
  const atDeck = (g, x, z = 0, dy = 0) => g.translate(x, deckY(x, z) + dy, z);

  // Расположение (x)
  const GA = { x: 37.0 }, GB = { x: 29.6 }, GX = { x: -29.0 }, GY = { x: -39.6 };
  const TT1 = { x: -6.6 }, TT2 = { x: -18.4 };
  const PED = 0.3; // высота неподвижной тумбы орудия
  const BH = { x0: 26.9, x1: 32.1, hw: 2.35, h: 1.35 }; // надстройка орудия B
  const BR = { x0: 19.6, x1: 25.8, hw: 2.7, h1: 2.3, wx0: 21.2, wx1: 25.3, whw: 2.1, h2: 2.0 };
  const yBr = dY(22.5);
  const yPlat = yBr + BR.h1 + BR.h2; // палуба открытого мостика
  const F1 = { x: 10.6, a: 1.8, b: 1.32, cas: [8.0, 13.4, 2.1] };
  const F2 = { x: 0.4, a: 1.4, b: 1.05, cas: [-1.9, 2.7, 1.7] };
  const RAKE = Math.tan((5 * Math.PI) / 180);
  const CAS_H = 1.0;
  [F1, F2].forEach((F) => (F.y0 = dY(F.x) + CAS_H));
  const funnelRing = (F, y, sc) => {
    const NS = 40;
    const pts = [];
    const cx = F.x - (y - F.y0) * RAKE;
    for (let j = 0; j <= NS; j++) {
      const a = (j / NS) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const ex = 2 / 2.6;
      pts.push(V3(cx + sc * F.a * Math.sign(c) * Math.abs(c) ** ex * (c > 0 ? 0.92 : 1), y, sc * F.b * Math.sign(s) * Math.abs(s) ** ex));
    }
    return pts;
  };
  const SLT = { x0: -13.4, x1: -11.4, hw: 1.0, h: 3.4 }; // прожекторная башенка
  const ySL = dY(-12.4) + SLT.h;
  const AH = { x0: -32.2, x1: -23.8, hw: 2.5, h: 2.2 }; // кормовая рубка
  const yAH = dY(-28) + AH.h;
  const yGB = dY(GB.x) + BH.h;

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  const { hull, bulkhead } = buildHull();
  mesh(merge([hull, bulkhead]), M.paint, 'Hull_Shell', hullG);

  // Подводные выступы: брусковый киль-скег, валы, кронштейны, скуловые кили
  const PROP = { x: -39.6, z: 2.5, r: 1.25 };
  {
    let yb = Infinity;
    for (let dx = -0.6; dx <= 0.6; dx += 0.2)
      for (let dz = -PROP.r; dz <= PROP.r + 1e-6; dz += 0.05) {
        const b = bottomY(PROP.x + dx, PROP.z + dz);
        if (b != null) yb = Math.min(yb, b - Math.sqrt(Math.max(0, PROP.r ** 2 - dz * dz)));
      }
    PROP.y = yb - 0.15;
  }
  const RUD = { x: -45.6, y0: 1.45, y1: 2.82 };
  {
    const parts = [];
    [1, -1].forEach((sd) => {
      const z = sd * PROP.z;
      const xe = -23.0;
      const ye = bottomY(xe, PROP.z) + 0.35;
      parts.push(rod([xe, ye, z], [PROP.x + 0.3, PROP.y, z], 0.13, 10)); // гребной вал
      parts.push(rod([xe + 0.4, ye + 0.03, z], [xe - 3.8, lerp(ye, PROP.y, 3.8 / (xe - PROP.x)), z], 0.24, 10)); // выкружка
      // кронштейн у винта: ступица и две стойки к днищу
      const xb = PROP.x + 1.05;
      parts.push(latheX([[0.0, -0.34], [0.2, -0.24], [0.2, 0.26], [0.0, 0.4]], 12).translate(xb, PROP.y, z));
      const leg = (zz) => {
        const yy = bottomY(xb, zz) + 0.25;
        const g = prism([[-0.3, 0], [0.3, 0], [0.18, 1], [-0.18, 1]], 0.07);
        const a = V3(xb, PROP.y, z), b = V3(xb, yy, zz);
        const d = b.clone().sub(a);
        g.scale(1, d.length(), 1);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
        g.translate(a.x, a.y, a.z);
        return g;
      };
      parts.push(leg(sd * (PROP.z + 0.9)));
      parts.push(leg(sd * (PROP.z - 1.0)));
      // скуловой киль
      const bk = [];
      for (let i = 0; i <= 18; i++) {
        const x = lerp(-20, 14, i / 18);
        const c = sec(x);
        const q = QL * 0.62;
        const p0 = sideP(c, q);
        const pq = sideP(c, q + 0.01).sub(sideP(c, q - 0.01)).normalize();
        const out = V3(0, -pq.z, pq.y).multiplyScalar(-1);
        if (out.z < 0) out.negate();
        const taper = Math.sin((Math.PI * i) / 18) ** 0.4;
        const ring = [
          p0.clone().addScaledVector(pq, 0.12).addScaledVector(out, -0.06),
          p0.clone().addScaledVector(out, 0.45 * taper + 0.02),
          p0.clone().addScaledVector(pq, -0.12).addScaledVector(out, -0.06),
        ];
        bk.push(ring.map((v) => V3(v.x, v.y, sd * v.z)));
      }
      parts.push(loftRings(bk, () => [0.5, 0.5]));
    });
    // скег (дейдвуд) перед рулём: низ на линии киля, верх внутри корпуса
    {
      const lo = [], hi = [];
      for (let i = 0; i <= 14; i++) {
        const x = lerp(-15, -44.6, i / 14);
        const yk = sec(x).yk;
        const t = clamp01((-21 - x) / 23.6);
        lo.push([x, lerp(0, 1.75, t ** 1.4)]);
        hi.push([x, yk + 0.55]);
      }
      parts.push(prism([...lo, ...hi.reverse()], 0.34));
    }
    mesh(merge(parts), M.bottom, 'Hull_Appendages', hullG);
  }

  // ======================= НАДСТРОЙКИ (атлас)
  const supG = group('Superstructure', ship);
  {
    const parts = [];
    let u0 = 0.004;
    const addHouse = (poly, y0, h, opt = {}) => {
      const yb = opt.onDeck ? Math.min(...poly.map(([x, z]) => deckY(x, z))) - 0.03 : y0;
      const r = house(poly, y0, h, { ...opt, u0, yBot: opt.yBot ?? Math.min(yb, y0) });
      u0 = 0.004 + ((u0 - 0.004 + r.per * KU_WALL) % 0.6);
      parts.push(r.g);
    };
    const plate = (poly, y, th, holes = []) => {
      addHouse(poly, y - th, th, { band: 0, yBot: y - th, holes });
      const mm = new Mesher();
      const ccw = (q) => (THREE.ShapeUtils.isClockWise(q.map(([x, z]) => new THREE.Vector2(x, z))) ? [...q].reverse() : q);
      const o = ccw(poly), hl = holes.map((h) => [...ccw(h)].reverse());
      const tr = THREE.ShapeUtils.triangulateShape(o.map(([x, z]) => new THREE.Vector2(x, z)), hl.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))));
      const R = [...o, ...hl.flat()].map(([x, z]) => mm.v(V3(x, y - th, z), U(x), V_DECK(z)));
      tr.forEach(([a, b, c]) => mm.tri(R[a], R[c], R[b]));
      const cx = o.reduce((s, q) => s + q[0], 0) / o.length;
      parts.push(orientOut(mm.build({ orient: false }), V3(cx, y + 5, 0)));
    };
    const bulwark = (poly, y, h, uBase = FUN.u0) =>
      parts.push(
        sweepPath(poly, [[0, y - 0.01], [-0.03, y + h], [0.06, y + h], [0.06, y - 0.01]], (per, pr) => [
          uBase + ((per * KU_WALL) % (FUN.u1 - FUN.u0)),
          V_FUN(0.6 + Math.max(0, pr[1] - y)),
        ]),
      );
    // надстройка орудия B
    addHouse(roundRect(BH.x0, BH.x1, -BH.hw, BH.hw, 0.9), dY(GB.x), BH.h, { band: 0, onDeck: true });
    // мостик: нижний ярус, рулевая рубка, открытый мостик с крыльями и фальшбортом
    const whPoly = roundRect(BR.wx0, BR.wx1, -BR.whw, BR.whw, 0.7);
    addHouse(roundRect(BR.x0, BR.x1, -BR.hw, BR.hw, 0.9), yBr, BR.h1, { band: 0, onDeck: true });
    addHouse(whPoly, yBr + BR.h1, BR.h2 - 0.18, { band: 1, roof: false });
    const platPoly = roundRect(19.3, 26.1, -4.3, 4.3, 1.0, 4);
    plate(platPoly, yPlat, 0.18);
    bulwark(roundRect(19.35, 26.05, -4.25, 4.25, 0.95, 4), yPlat, 1.1);
    // пост управления огнём (директор) на кормовой части мостика
    addHouse(roundRect(19.7, 21.3, -0.85, 0.85, 0.25), yPlat, 1.35, { band: 1 });
    // кожухи дымоходов и трубы
    [F1, F2].forEach((F) => {
      const [c0, c1, hw] = F.cas;
      addHouse(roundRect(c0, c1, -hw, hw, 0.5), dY(F.x), CAS_H, {
        band: 0,
        onDeck: true,
        holes: [funnelRing(F, F.y0, 1).slice(0, -1).map((q) => [q.x, q.z])],
      });
      const fm = new Mesher();
      const NS = 40;
      const yTop = F.y0 + FUN.h;
      const levels = [
        [F.y0, 1, 0],
        [F.y0 + 2.5, 1, 2.5],
        [F.y0 + 5, 1, 5],
        [yTop - 0.6, 1, FUN.h - 0.6],
        [yTop, 1, FUN.h],
        [yTop + 0.02, 0.92, FUN.h],
        [yTop - 1.2, 0.92, FUN.h - 0.3],
      ];
      const ids = levels.map(([y, sc, h]) => funnelRing(F, y, sc).map((q, j) => fm.v(q, FUN.u0 + (FUN.u1 - FUN.u0) * (j / NS), V_FUN(h))));
      for (let k = 0; k < ids.length - 1; k++) fm.strip(ids[k], ids[k + 1]);
      const ci = fm.v(funnelRing(F, yTop - 1.2, 0)[0], FUN.u0 + 0.1, V_FUN(FUN.h - 0.2));
      const lastR = ids[ids.length - 1];
      for (let j = 0; j < NS; j++) fm.tri(ci, lastR[j + 1], lastR[j]);
      parts.push(orientOut(fm.build({ orient: false }), V3(F.x - 2 * RAKE, F.y0 + 2, 0)));
    });
    // барбет 3-дюймового зенитного орудия между трубами
    addHouse(roundRect(4.0, 6.6, -1.3, 1.3, 1.1, 4), dY(5.3), 1.5, { band: 0, onDeck: true });
    // прожекторная башенка с площадкой
    addHouse(roundRect(SLT.x0, SLT.x1, -SLT.hw, SLT.hw, 0.3), dY(-12.4), SLT.h - 0.15, { band: 0, onDeck: true, roof: false });
    plate(roundRect(-13.9, -10.9, -1.7, 1.7, 0.6, 3), ySL, 0.15);
    // кормовая рубка (под орудием X)
    addHouse(roundRect(AH.x0, AH.x1, -AH.hw, AH.hw, 0.7), dY(-28), AH.h, { band: 0, onDeck: true });
    // световой люк машинного отделения
    addHouse(roundRect(-11.0, -9.4, -0.9, 0.9, 0.15), dY(-10.2), 0.55, { band: 0, onDeck: true });
    mesh(merge(parts), M.paint, 'Superstructure_Main', supG);
  }

  // ======================= ПАЛУБНОЕ ОБОРУДОВАНИЕ (сталь)
  const deckG = group('Deck_Equipment', ship);
  const BOAT = { x: 5.0, L: 7.6, B: 1.9, D: 0.8, z: 4.15 };
  BOAT.y = mainDeckY(BOAT.x) + 2.2;
  {
    const parts = [];
    const pedestal = (r) => lathe([[r, -0.1], [r, PED - 0.08], [r - 0.1, PED], [0, PED]], 28);
    // неподвижные тумбы орудий и торпедных аппаратов
    parts.push(atDeck(pedestal(1.15), GA.x));
    parts.push(pedestal(1.15).translate(GB.x, yGB, 0));
    parts.push(pedestal(1.15).translate(GX.x, yAH, 0));
    parts.push(atDeck(pedestal(1.15), GY.x));
    [TT1, TT2].forEach((T) => parts.push(atDeck(lathe([[1.6, -0.1], [1.6, 0.17], [1.5, 0.25], [0, 0.25]], 28), T.x)));
    // волнолом перед орудием A
    [1, -1].forEach((sd) => {
      const a = V3(41.4, 0, 0), b = V3(39.3, 0, sd * 2.5);
      const d = b.clone().sub(a);
      const g = box(d.length() + 0.1, 0.75, 0.07);
      g.rotateY(-Math.atan2(d.z, d.x));
      const m = a.clone().add(b).multiplyScalar(0.5);
      parts.push(g.translate(m.x, dY(m.x, m.z) + 0.3, m.z));
    });
    // шпиль, кнехты, палубные клюзы, стопоры
    parts.push(atDeck(lathe([[0.42, -0.08], [0.42, 0.1], [0.3, 0.15], [0.26, 0.45], [0.34, 0.5], [0.3, 0.58], [0, 0.62]], 20), 43.6));
    const bollard = () => {
      const p = () => lathe([[0.12, -0.08], [0.11, 0.32], [0.16, 0.36], [0.16, 0.4], [0, 0.42]], 12);
      return merge([p().translate(0.28, 0, 0), p().translate(-0.28, 0, 0), box(0.85, 0.12, 0.32, 0, -0.02, 0)]);
    };
    [
      [40.0, 0.7],
      [33.5, 0.82],
      [13.0, 0.82],
      [-3.0, 0.82],
      [-34.0, 0.78],
      [-45.5, 0.6],
    ].forEach(([x, k]) => {
      [1, -1].forEach((sd) => {
        const yy = x >= XB ? fcDeckY(x) : mainDeckY(x);
        parts.push(atDeck(bollard(), x, sd * edgeZ(x, yy) * k));
      });
    });
    [1, -1].forEach((sd) => {
      parts.push(atDeck(lathe([[0.32, -0.08], [0.3, 0.18], [0.22, 0.22], [0.22, 0.16], [0, 0.15]], 16), 45.6, sd * 1.05));
      parts.push(atDeck(box(0.9, 0.3, 0.3, 0, 0.1, 0), 44.7, sd * 0.75));
      const r = sideAt(HAWSE.x, HAWSE.y);
      const n = r.n.clone();
      const ring = new THREE.TorusGeometry(0.34, 0.07, 6, 16);
      ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n));
      ring.translate(HAWSE.x, HAWSE.y, r.z + 0.02);
      parts.push(sd > 0 ? ring : mirrorZ(ring));
    });
    // вентиляторы-раструбы
    const cowl = (h, r, yaw) => {
      const stem = lathe([[r, -0.15], [r, h]], 12, { top: false });
      const bend = [];
      for (let i = 0; i <= 5; i++) {
        const a = (i / 5) * (Math.PI / 2);
        bend.push(V3(r * 1.2 * (1 - Math.cos(a)), h + r * 1.2 * Math.sin(a), 0));
      }
      const mouth = tubePath(bend, r, 12, { capStart: false, capEnd: false });
      const bell = latheX([[r * 1.0, 0], [r * 1.45, 0.22], [r * 1.25, 0.22], [r * 0.95, 0.05]], 12, { bottom: false, top: false }).translate(r * 1.2, h + r * 1.2, 0);
      const g = merge([stem, mouth, bell]);
      g.rotateY(yaw);
      return g;
    };
    [
      [14.2, 1.7, 1.5, 0.26, 0],
      [14.2, -1.7, 1.5, 0.26, 0],
      [7.2, 1.6, 1.3, 0.24, Math.PI],
      [7.2, -1.6, 1.3, 0.24, Math.PI],
      [-3.0, 2.2, 1.2, 0.22, 0],
      [-3.0, -2.2, 1.2, 0.22, 0],
      [-22.2, 1.9, 1.1, 0.2, Math.PI],
      [-22.2, -1.9, 1.1, 0.2, Math.PI],
      [17.2, 3.0, 1.0, 0.18, -Math.PI / 2],
      [17.2, -3.0, 1.0, 0.18, Math.PI / 2],
    ].forEach(([x, z, h, r, yaw]) => parts.push(atDeck(cowl(h, r, yaw), x, z)));
    // кормовые бомбосбрасыватели — рельсы через срез кормы
    const DC = { x0: -44.6, x1: -50.0 };
    [1, -1].forEach((sd) => {
      const z = sd * 1.3;
      [-0.3, 0.3].forEach((dz) => {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const x = lerp(DC.x0, DC.x1, i / 6);
          pts.push(V3(x, deckY(Math.max(x, XS + 0.4), z + dz) + 0.6 - 0.14 * (i / 6), z + dz));
        }
        parts.push(tubePath(pts, 0.04, 6));
        [0, 0.45, 0.8].forEach((t) => {
          const x = lerp(DC.x0, DC.x1, t);
          parts.push(rod([x, deckY(x, z + dz) - 0.05, z + dz], [x, deckY(x, z + dz) + 0.6 - 0.14 * t, z + dz], 0.04, 6, 'top'));
        });
      });
    });
    // бомбомёты по бортам
    [1, -1].forEach((sd) => {
      const x = -35.6;
      const z = sd * (edgeZ(x, mainDeckY(x)) - 1.0);
      const base = lathe([[0.3, -0.08], [0.28, 0.3], [0, 0.32]], 14);
      const barrel = rod([0, 0.25, 0], [0, 1.15, sd * 0.42], 0.16, 12);
      const cup = lathe([[0.25, 0], [0.25, 0.12], [0, 0.13]], 12, { bottom: true });
      cup.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(0, 0.95, sd * 0.42).normalize()));
      cup.translate(0, 1.15, sd * 0.42);
      parts.push(atDeck(merge([base, barrel, cup]), x, z));
      parts.push(atDeck(box(1.5, 0.06, 0.66, 0, 0.32, 0), x + 1.55, z));
      [-0.55, 0.55].forEach((dx) => parts.push(atDeck(rod([0, -0.05, 0], [0, 0.32, 0], 0.04, 6, 'top'), x + 1.55 + dx, z)));
    });
    // трапы со среза полубака
    [1, -1].forEach((sd) => {
      const z = sd * 3.3;
      const top = V3(XB - 0.05, fcDeckY(XB) + 0.08, z), bot = V3(XB - 2.4, mainDeckY(XB - 2.4) + 0.1, z);
      [-0.32, 0.32].forEach((dz) => parts.push(rod([top.x, top.y, z + dz], [bot.x, bot.y, z + dz], 0.04, 6)));
      for (let i = 1; i < 9; i++) {
        const p = top.clone().lerp(bot, i / 9);
        parts.push(box(0.18, 0.04, 0.64, p.x, p.y, z));
      }
    });
    // трап на кормовую рубку
    {
      const top = V3(AH.x1 + 0.05, yAH + 0.05, 1.2), bot = V3(AH.x1 + 1.9, dY(AH.x1 + 1.9, 1.2) + 0.05, 1.2);
      [-0.3, 0.3].forEach((dz) => parts.push(rod([top.x, top.y, 1.2 + dz], [bot.x, bot.y, 1.2 + dz], 0.035, 6)));
      for (let i = 1; i < 6; i++) {
        const p = top.clone().lerp(bot, i / 6);
        parts.push(box(0.16, 0.04, 0.6, p.x, p.y, 1.2));
      }
    }
    // леерные стойки и леера
    const rail = (ptsXZ, yFn, spacing = 1.8, h = 1.0) => {
      const top1 = [], top2 = [];
      let acc = spacing;
      ptsXZ.forEach(([x, z], i) => {
        const y = yFn(x, z);
        top1.push(V3(x, y + h, z));
        top2.push(V3(x, y + h * 0.55, z));
        if (i > 0) acc += Math.hypot(x - ptsXZ[i - 1][0], z - ptsXZ[i - 1][1]);
        if (acc >= spacing || i === ptsXZ.length - 1) {
          acc = 0;
          parts.push(rod([x, y - 0.04, z], [x, y + h, z], 0.025, 5, 'top'));
        }
      });
      parts.push(tubePath(top1, 0.022, 5));
      parts.push(tubePath(top2, 0.018, 5));
    };
    const inset = 0.12;
    // полубак: от среза вокруг форштевня
    {
      const pts = [];
      for (let x = XB + 0.15; x <= 48.6; x += 0.75) pts.push([x, edgeZ(x, fcDeckY(x)) - inset]);
      const xe = 48.6, ze = pts[pts.length - 1][1];
      for (let i = 1; i < 10; i++) {
        const a = (i / 10) * Math.PI;
        const x = xe + 1.2 * Math.sin(a);
        const z = ze * Math.cos(a);
        const lim = edgeZ(x, fcDeckY(x)) - inset;
        pts.push([x, Math.sign(z) * Math.min(Math.abs(z), lim)]);
      }
      for (let x = 48.6; x >= XB + 0.15 - 1e-6; x -= 0.75) pts.push([x, -(edgeZ(x, fcDeckY(x)) - inset)]);
      rail(pts, (x, z) => deckY(x, z));
    }
    // поперёк среза полубака (с проходами у трапов)
    {
      const w = edgeZ(XB, fcDeckY(XB)) - inset;
      const segs = [[], [], []];
      for (let z = -w; z <= w + 1e-6; z += 0.5) {
        if (Math.abs(Math.abs(z) - 3.3) < 0.5) continue;
        segs[z < -3.3 ? 0 : z > 3.3 ? 2 : 1].push([XB + 0.12, z]);
      }
      segs.forEach((s) => s.length > 1 && rail(s, (x, z) => deckY(x, z), 1.2));
    }
    // главная палуба: от среза полубака вдоль борта вокруг кормы
    {
      const pts = [];
      for (let x = XB - 0.15; x >= XS + 2.2; x -= 0.75) pts.push([x, edgeZ(x, mainDeckY(x)) - inset]);
      const xc = XS + 2.2;
      const zc = pts[pts.length - 1][1];
      for (let i = 1; i < 16; i++) {
        const a = (i / 16) * Math.PI;
        const x = xc - 1.9 * Math.sin(a);
        const z = zc * Math.cos(a);
        const lim = edgeZ(x, mainDeckY(x)) - inset;
        // разрыв под рельсами бомбосбрасывателей
        if (Math.abs(z) < 1.9 && Math.abs(z) > 0.6) continue;
        pts.push([x, Math.sign(z) * Math.min(Math.abs(z), lim)]);
      }
      const back = [];
      for (let x = XS + 2.2; x <= XB - 0.15 + 1e-6; x += 0.75) back.push([x, -(edgeZ(x, mainDeckY(x)) - inset)]);
      const all = [...pts, ...back];
      // делим по разрывам у рельсов
      const runs = [[]];
      all.forEach((p, i) => {
        if (i > 0 && Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1.2) runs.push([]);
        runs[runs.length - 1].push(p);
      });
      runs.forEach((r) => r.length > 1 && rail(r, (x, z) => deckY(x, z)));
    }
    // поручни на кормовой рубке, надстройке B, прожекторной площадке
    {
      const ring = (poly) => [...poly, poly[0]];
      rail(ring(roundRect(AH.x0 + 0.1, AH.x1 - 0.1, -AH.hw + 0.1, AH.hw - 0.1, 0.6, 3)), () => yAH, 1.5, 0.9);
      rail(ring(roundRect(BH.x0 + 0.1, BH.x1 - 0.1, -BH.hw + 0.1, BH.hw - 0.1, 0.8, 3)), () => yGB, 1.5, 0.9);
      rail(ring(roundRect(-13.8, -11.0, -1.6, 1.6, 0.5, 3)), () => ySL, 1.2, 0.9);
      rail(ring(roundRect(4.1, 6.5, -1.2, 1.2, 1.0, 4)), () => dY(5.3) + 1.5, 1.2, 0.9);
    }
    // шлюпбалки (по две на борт)
    [1, -1].forEach((sd) => {
      [BOAT.x - 2.9, BOAT.x + 2.9].forEach((x) => {
        const ze = edgeZ(x, mainDeckY(x)) - 0.25;
        const y0 = deckY(x, ze) - 0.08;
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          if (t < 0.45) pts.push(V3(x, y0 + 2.6 * (t / 0.45), sd * ze));
          else {
            const ang = (((t - 0.45) / 0.55) * Math.PI) / 2;
            pts.push(V3(x, y0 + 2.6 + 0.8 * Math.sin(ang), sd * (ze - 0.85 * (1 - Math.cos(ang)))));
          }
        }
        parts.push(tubePath(pts, 0.085, 8));
        const tip = pts[pts.length - 1];
        parts.push(rod([tip.x, tip.y - 0.05, tip.z], [tip.x, BOAT.y + 0.1, tip.z], 0.03, 5));
      });
    });
    // ящики, кранцевые корзины
    [
      [-21.0, 3.3],
      [-21.0, -3.3],
      [12.0, 3.4],
    ].forEach(([x, z]) => parts.push(atDeck(boxOpen(1.1, 0.7, 0.6, 0, 0.3, 0), x, z)));
    // на мостике: дальномер директора, нактоуз, визиры
    {
      const yD = yPlat + 1.35;
      parts.push(lathe([[0.3, -0.02], [0.25, 0.3], [0, 0.31]], 14).translate(20.5, yD, 0));
      parts.push(latheZ([[0.14, -1.25], [0.14, 1.25]], 12).translate(20.5, yD + 0.45, 0));
      [-1.25, 1.25].forEach((z) => parts.push(latheZ([[0.2, -0.12], [0.2, 0.12]], 12).translate(20.5, yD + 0.45, z)));
      parts.push(lathe([[0.2, -0.05], [0.15, 0.95], [0.24, 1.05], [0, 1.22]], 14).translate(24.6, yPlat, 0));
      [1, -1].forEach((sd) => parts.push(lathe([[0.12, -0.05], [0.1, 1.0], [0.16, 1.05], [0, 1.1]], 10).translate(23.6, yPlat, sd * 2.6)));
      [1, -1].forEach((sd) => parts.push(box(0.4, 0.45, 0.25, 24.2, yPlat + 0.75, sd * 4.32))); // отличительные огни
      // стойки под крыльями мостика
      [1, -1].forEach((sd) => [20.2, 25.0].forEach((x) => parts.push(rod([x, dY(x, sd * 3.9) - 0.05, sd * 3.9], [x, yPlat - 0.17, sd * 3.9], 0.07, 8, 'none'))));
    }
    // 3-дюймовое зенитное орудие (неподвижное в модели)
    {
      const y = dY(5.3) + 1.5;
      parts.push(lathe([[0.55, -0.02], [0.4, 0.4], [0.3, 0.75], [0, 0.76]], 16).translate(5.3, y, 0));
      const g = [];
      [1, -1].forEach((sd) => g.push(prism([[-0.4, 0], [0.4, 0], [0.15, 0.6], [-0.15, 0.6]], 0.06).translate(0, 0, sd * 0.24)));
      g.push(rod([0, 0.5, -0.3], [0, 0.5, 0.3], 0.07, 10));
      const bar = latheX([[0.15, -0.9], [0.15, -0.5], [0.09, -0.4], [0.07, 2.6], [0.085, 2.65], [0, 2.66]], 14);
      bar.rotateZ(0.5);
      g.push(bar.translate(0, 0.5, 0));
      g.push(box(0.3, 0.06, 0.3, -0.6, 0.15, 0.5));
      parts.push(merge(g).translate(5.3, y + 0.7, 0));
    }
    // счетверённые 0,5-дюймовые пулемёты на крыльях мостика
    [1, -1].forEach((sd) => {
      const x = 21.6, z = sd * 3.5, y = yPlat;
      parts.push(lathe([[0.28, -0.02], [0.2, 0.55], [0.28, 0.6], [0.28, 0.66], [0, 0.67]], 14).translate(x, y, z));
      parts.push(box(0.45, 0.42, 0.62, x, y + 0.88, z));
      [-0.21, -0.07, 0.07, 0.21].forEach((dz) => parts.push(rod([x + 0.2, y + 0.95, z + dz], [x + 1.35, y + 1.02, z + dz], 0.025, 6)));
      parts.push(box(0.1, 0.32, 0.85, x - 0.3, y + 0.88, z));
    });
    // прожектор на площадке
    {
      const y = ySL;
      parts.push(lathe([[0.32, -0.02], [0.22, 0.25], [0.18, 0.5], [0.3, 0.55], [0, 0.57]], 14).translate(-12.4, y, 0));
      [1, -1].forEach((sd) => parts.push(box(0.06, 0.6, 0.12, -12.4, y + 0.85, sd * 0.45)));
      parts.push(latheX([[0.0, -0.45], [0.2, -0.42], [0.38, -0.3], [0.38, 0.35], [0.42, 0.38], [0.42, 0.44], [0.35, 0.44], [0.35, 0.4], [0, 0.4]], 18).translate(-12.4, y + 1.1, 0));
    }
    // флагштоки: гюйсшток и кормовой флагшток
    parts.push(lathe([[0.05, fcDeckY(49.6) - 0.05], [0.03, fcDeckY(49.6) + 3.0], [0.05, fcDeckY(49.6) + 3.05], [0, fcDeckY(49.6) + 3.1]], 8).translate(49.6, 0, 0));
    parts.push(lathe([[0.06, mainDeckY(-48.4) - 0.05], [0.035, mainDeckY(-48.4) + 4.0], [0.06, mainDeckY(-48.4) + 4.05], [0, mainDeckY(-48.4) + 4.1]], 8).translate(-48.4, 0, 0));
    // паровые трубы и свистки у передней кромки труб
    [F1, F2].forEach((F) => {
      const x0 = F.x - F.a - 0.05, z = 0.5;
      parts.push(tubePath([V3(x0, F.y0 - 0.05, z), V3(x0 - 7.0 * RAKE, F.y0 + 7.0, z), V3(x0 - 7.4 * RAKE + 0.2, F.y0 + 7.4, z)], 0.06, 6));
    });
    mesh(merge(parts), M.grey, 'Deck_Fittings', deckG);

    // Тёмная сталь: якоря, цепи, глубинные бомбы
    const dk = [];
    [1, -1].forEach((sd) => {
      const r = sideAt(HAWSE.x - 0.1, HAWSE.y - 0.75);
      const shank = box(0.16, 1.2, 0.14, 0, 0.2, 0);
      const crown = box(0.32, 0.25, 0.3, 0, -0.45, 0);
      const fl = (sx) => prism([[0, 0], [0.42, 0.1], [0.52, 0.55], [0.3, 0.35], [0, 0.22]].map(([a, b]) => [sx * a, b - 0.55]), 0.18);
      const anc = merge([shank, crown, fl(1), fl(-1)]);
      anc.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), r.n.clone()));
      anc.translate(HAWSE.x - 0.1, HAWSE.y - 0.95, r.z + 0.1);
      dk.push(sd > 0 ? anc : mirrorZ(anc));
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = lerp(43.6, 45.6, t);
        const z = lerp(sd * 0.3, sd * 1.05, t);
        pts.push(V3(x, deckY(x, z) + 0.06, z));
      }
      dk.push(tubePath(pts, 0.06, 6));
    });
    const charge = () => latheZ([[0.24, -0.33], [0.26, -0.3], [0.26, 0.3], [0.24, 0.33]], 14);
    [1, -1].forEach((sd) => {
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.4) / 6;
        const x = lerp(-44.6, -50.0, t);
        const z = sd * 1.3;
        dk.push(charge().translate(x, deckY(Math.max(x, XS + 0.4), z) + 0.6 - 0.14 * t + 0.27, z));
      }
      [0, 1].forEach((j) => dk.push(charge().translate(-35.6 + 1.2 + j * 0.7, mainDeckY(-35) + 0.62, sd * (edgeZ(-35.6, mainDeckY(-35.6)) - 1.0))));
    });
    mesh(merge(dk), M.dark, 'Deck_Fittings_Dark', deckG);
  }

  // ======================= ШЛЮПКИ
  {
    const boatParts = () => {
      const hm = new Mesher(), cm = new Mesher();
      const N = 16, MH = 10, MC = 8;
      const H = [], Cv = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = (t - 0.5) * BOAT.L;
        const w = (BOAT.B / 2) * Math.max(0.02, Math.sin(Math.PI * t) ** 0.5);
        const d = BOAT.D * (0.7 + 0.3 * Math.sin(Math.PI * t));
        const gw = 0.1 * (2 * Math.abs(t - 0.5)) ** 2;
        const hc = 0.4 * Math.sin(Math.PI * t) ** 0.6;
        const hr = [], cr = [];
        for (let j = 0; j <= MH; j++) {
          const a = (j / MH) * Math.PI;
          hr.push(hm.v(V3(x, gw - d * Math.sin(a) ** 0.55 * (i === 0 || i === N ? 0.0 : 1), w * Math.cos(a)), t, j / MH));
        }
        for (let j = 0; j <= MC; j++) {
          const a = (j / MC) * Math.PI;
          cr.push(cm.v(V3(x, gw + hc * Math.sin(a), w * Math.cos(a)), t, j / MC));
        }
        H.push(hr);
        Cv.push(cr);
      }
      for (let i = 0; i < N; i++) {
        hm.strip(H[i], H[i + 1]);
        cm.strip(Cv[i + 1], Cv[i]);
      }
      const hg = hm.build({ orient: false }), cg = cm.build({ orient: false });
      orientOut(hg, V3(0, 0.3, 0));
      orientOut(cg, V3(0, -0.5, 0));
      return [hg, cg];
    };
    const boatsG = group('Boats', ship);
    [1, -1].forEach((sd) => {
      const tag = sd > 0 ? 'R' : 'L';
      const [hg, cg] = boatParts();
      const z = sd * (edgeZ(BOAT.x, mainDeckY(BOAT.x)) - 1.12);
      mesh(hg.translate(BOAT.x, BOAT.y, z), M.boat, `Boat_Hull_${tag}`, boatsG);
      mesh(cg.translate(BOAT.x, BOAT.y, z), M.canvas, `Boat_Cover_${tag}`, boatsG);
    });
    // спасательные плоты Карлея на стенках рубок
    const rafts = [];
    const raft = () => {
      const curve = new THREE.EllipseCurve(0, 0, 1.1, 0.5, 0, Math.PI * 2);
      const pts = curve.getPoints(20).slice(0, -1).map((p) => V3(p.x, p.y, 0));
      const r = 0.15;
      const m = new Mesher();
      const ids = pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length], o = pts[(i - 1 + pts.length) % pts.length];
        const t = q.clone().sub(o).normalize();
        const nIn = V3(-t.y, t.x, 0);
        const ring = [];
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * Math.PI * 2;
          ring.push(m.v(p.clone().addScaledVector(nIn, -Math.cos(a) * r).add(V3(0, 0, Math.sin(a) * r)), i / pts.length, a / 6.3));
        }
        return ring;
      });
      for (let i = 0; i < ids.length; i++) m.strip(ids[i], ids[(i + 1) % ids.length], true);
      const g = m.build({ orient: false });
      const idx = g.index.array, pos = g.attributes.position;
      const a = V3().fromBufferAttribute(pos, idx[0]), b = V3().fromBufferAttribute(pos, idx[1]), c = V3().fromBufferAttribute(pos, idx[2]);
      const nn = b.clone().sub(a).cross(c.clone().sub(a));
      const mid = a.clone().add(b).add(c).divideScalar(3);
      if (nn.dot(mid.clone().sub(pts[0])) < 0) {
        for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
        g.computeVertexNormals();
      }
      return g;
    };
    [1, -1].forEach((sd) => {
      [-30.3, -26.0].forEach((x) => rafts.push(raft().translate(x, dY(-28) + 1.1, sd * (AH.hw + 0.17))));
      rafts.push(raft().translate(23.4, yBr + 1.15, sd * (BR.hw + 0.17)));
    });
    mesh(merge(rafts), M.boat, 'Carley_Floats', boatsG);
  }

  // ======================= МАЧТЫ И ТАКЕЛАЖ
  const mastG = group('Masts', ship);
  const FM = { x: 18.6, top: 26.0, joint: 18.0 };
  const MM = { x: -23.0, top: 18.5 };
  {
    const parts = [];
    const yF0 = dY(FM.x) - 0.05;
    const yM0 = dY(MM.x) - 0.05;
    // треногая фок-мачта: передняя нога и два подкоса в корму
    parts.push(lathe([[0.26, yF0], [0.24, FM.joint], [0.16, 22.0], [0.1, FM.top - 0.1], [0.06, FM.top], [0, FM.top + 0.02]], 12).translate(FM.x, 0, 0));
    [1, -1].forEach((sd) => {
      const xb = XB + 0.5, zb = sd * 1.9;
      parts.push(rod([xb, dY(xb, zb) - 0.05, zb], [FM.x - 0.05, FM.joint, sd * 0.05], 0.17, 10));
    });
    // площадка на соединении ног
    parts.push(lathe([[0.25, FM.joint - 0.12], [0.85, FM.joint - 0.05], [0.85, FM.joint + 0.05], [0, FM.joint + 0.06]], 18).translate(FM.x - 0.15, 0, 0));
    // рей и салинг
    parts.push(latheZ([[0.07, -3.0], [0.09, 0], [0.07, 3.0]], 8).translate(FM.x, 21.0, 0));
    parts.push(latheZ([[0.05, -1.3], [0.05, 1.3]], 6).translate(FM.x, 24.6, 0));
    // грот-мачта (короткая) с гафелем
    parts.push(lathe([[0.2, yM0], [0.18, 13.0], [0.12, 16.5], [0.07, MM.top - 0.1], [0.05, MM.top], [0, MM.top + 0.02]], 12).translate(MM.x, 0, 0));
    parts.push(rod([MM.x, 13.6, 0], [MM.x - 2.6, 14.8, 0], 0.06, 8));
    parts.push(latheZ([[0.05, -1.1], [0.05, 1.1]], 6).translate(MM.x, 17.4, 0));
    mesh(merge(parts), M.grey, 'Mast_Spars', mastG);

    const w = [];
    const r = 0.018;
    const at = (x, z) => [x, dY(x, z) + 0.05, z];
    w.push(rod([FM.x, 22.5, 0], at(49.4, 0), r, 4)); // штаг к форштевню
    [1, -1].forEach((sd) => {
      w.push(rod([MM.x, 14.5, sd * 0.12], at(MM.x - 2.4, sd * (edgeZ(MM.x - 2.4, mainDeckY(MM.x - 2.4)) - 0.25)), r, 4));
      w.push(rod([FM.x, 24.6, sd * 1.25], [MM.x, 17.4, sd * 1.05], 0.012, 4)); // антенны
      w.push(rod([FM.x, 21.0, sd * 2.9], [FM.x, 23.5, sd * 0.05], 0.01, 3)); // фалы
    });
    w.push(rod([FM.x, 23.8, 0], [MM.x, 17.9, 0], r, 4)); // триатик-штаг
    [1, -1].forEach((sd) => w.push(rod([MM.x, 16.5, sd * 0.1], at(-34.5, sd * (edgeZ(-34.5, mainDeckY(-34.5)) - 0.3)), r, 4))); // ахтерштаги
    w.push(rod([lerp(FM.x, MM.x, 0.18), lerp(24.6, 17.4, 0.18), 1.2], [BR.x0 - 0.2, yPlat + 1.0, 1.2], 0.012, 3)); // ввод антенны
    mesh(merge(w), M.wire, 'Rigging', mastG);
  }

  // ======================= ВООРУЖЕНИЕ: подвижные установки
  const armsG = group('Armament', ship);
  const gunGeo = buildGun47();
  const guns = [
    ['Gun_A', GA.x, dY(GA.x) + PED, false],
    ['Gun_B', GB.x, yGB + PED, false],
    ['Gun_X', GX.x, yAH + PED, true],
    ['Gun_Y', GY.x, dY(GY.x) + PED, true],
  ];
  guns.forEach(([name, x, y, aft]) => {
    const g = group(name, armsG, x, y, 0);
    const geo = gunGeo.clone();
    if (aft) geo.rotateY(Math.PI); // ствол в корму — поворот запечён в сетку
    mesh(geo, M.grey, `${name}_Mount`, g);
  });
  const ttGeo = buildTubes();
  [
    ['Torpedo_Tubes_1', TT1.x],
    ['Torpedo_Tubes_2', TT2.x],
  ].forEach(([name, x]) => {
    const g = group(name, armsG, x, dY(x) + 0.25, 0);
    mesh(ttGeo.clone(), M.grey, `${name}_Mount`, g);
  });

  // ======================= ВИНТЫ И РУЛЬ
  const propG = group('Propulsion', ship);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.22, r1: PROP.r, chord0: 0.5, chord1: 0.85, pitch: 3.2, skew: 0.12, tc: 0.12 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = latheX([[0.0, 0.34], [0.19, 0.26], [0.23, 0.05], [0.23, -0.24], [0.17, -0.32], [0.0, -0.66]], 16);
    const propR = merge([...bl, hub]);
    const propL = mirrorZ(propR);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Propeller_R' : 'Propeller_L', propG, PROP.x, PROP.y, sd * PROP.z);
      mesh(sd > 0 ? propR : propL, M.bronze, `${g.name}_Blades`, g);
      props[sd > 0 ? 'R' : 'L'] = g;
    });
    const rg = group('Rudder', propG, RUD.x, RUD.y0, 0);
    const h = RUD.y1 - RUD.y0;
    const f = foil({ root: [0.5, -1.45], tip: [0.42, -1.25], span: h, tc: 0.15, y0: 0, nSpan: 3 });
    const stock = lathe([[0.1, h - 0.05], [0.1, h + 0.9], [0, h + 0.91]], 10);
    mesh(merge([f, stock]), M.bottom, 'Rudder_Blade', rg);
  }

  // Анимация: винты вращаются навстречу друг другу, 1 об/с, 9 ключей
  {
    const T = 1.0;
    const n = 8;
    const times = [];
    const vR = [], vL = [];
    const q = new THREE.Quaternion();
    const ax = V3(1, 0, 0);
    for (let i = 0; i <= n; i++) {
      times.push((T * i) / n);
      const a = (2 * Math.PI * i) / n;
      q.setFromAxisAngle(ax, a);
      vR.push(q.x, q.y, q.z, q.w);
      q.setFromAxisAngle(ax, -a);
      vL.push(q.x, q.y, q.z, q.w);
    }
    ship.animations = [
      new THREE.AnimationClip('Propellers_Spin', T, [
        new THREE.QuaternionKeyframeTrack('Propeller_R.quaternion', times, vR),
        new THREE.QuaternionKeyframeTrack('Propeller_L.quaternion', times, vL),
      ]),
    ];
  }

  const find = (n) => ship.getObjectByName(n);
  ship.userData.update = (t = 0) => {
    props.R.rotation.x = 2 * Math.PI * t;
    props.L.rotation.x = -2 * Math.PI * t;
  };
  ship.userData.pose = (k = 0) => {
    find('Rudder').rotation.y = k * 0.5;
    find('Gun_A').rotation.y = k * 0.8;
    find('Gun_B').rotation.y = -k * 0.7;
    find('Gun_X').rotation.y = k * 0.9;
    find('Gun_Y').rotation.y = -k * 0.8;
    find('Torpedo_Tubes_1').rotation.y = k * 1.4;
    find('Torpedo_Tubes_2').rotation.y = -k * 1.4;
  };
  ship.userData.waterline = WL;
  ship.userData.info = { propY: PROP.y, propLow: PROP.y - PROP.r };
  return ship;
}
