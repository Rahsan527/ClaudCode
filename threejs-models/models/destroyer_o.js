import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Эсминец Королевского флота типа O (Onslow, Offa, Onslaught, Opportune, Oribi, Obedient, Obdurate, Orwell;
// 1941–1942), обобщённый облик ~1942 г. с 4,7-дюймовыми орудиями, без бортового номера. Масштаб 1:1, метры.
// Оси: Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния — y = WL (осадка ~3,8 м).
// Длина ~105 м, ширина 10,7 м. Военный «упрощённый» проект: длинный полубак до кормы от трубы, одна широкая
// труба, четыре одиночных 4,7-дюймовых орудия QF Mk IX в щитах (A, B — в нос, X, Y — в корму), один
// четырёхтрубный 21-дюймовый торпедный аппарат, счетверённый 2-фунтовый «пом-пом» на площадке в корме,
// закрытый мостик с КДП и РЛС типа 285, решётчатая фок-мачта с РЛС типа 291, фонарь РЛС типа 271,
// 20-мм «эрликоны» на крыльях мостика, бомбосбрасыватели и бомбомёты, плоты Карлея, шлюпки, якоря,
// два винта и один руль.
// Подвижные части — отдельные Group с нулевым поворотом в покое, начало — на оси движения.

export const WL = 3.8; // ватерлиния над килем
const XS = -52.2; // корма (номинальное сечение на уровне палубы)
const XF = 52.3; // форштевень на уровне палубы полубака
const XB = -5.0; // срез полубака
const BEAM = 5.35; // полуширина
const MID_A = -16.0;
const MID_F = 6.0;
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
  return 6.6 + 0.3 * smooth((-20 - x) / (-20 - XS));
}
export function fcDeckY(x) {
  return 8.95 + 1.45 * Math.max(0, (x - XB) / (XF - XB)) ** 2.2;
}
const yTopV = (x) => fcDeckY(x); // «виртуальный» верх борта: борт везде растёт до этой высоты

function sec(xn) {
  let W = BEAM, wd = BEAM, yk = 0, yw = 4.3, nb = 3.0, rake = 0, s = 0, flare = 1.6;
  if (xn > MID_F) {
    s = clamp01((xn - MID_F) / (XF - MID_F));
    W = BEAM * Math.max(0, 1 - s ** 1.7) ** 0.95;
    wd = BEAM * Math.max(0, 1 - s ** 2.0) ** 0.7;
    yk = 3.4 * clamp01((s - 0.55) / 0.45) ** 2;
    yw = 4.3 + 1.1 * s * s;
    nb = 3.0 - 1.3 * s;
    rake = -0.5 * s ** 1.6;
    flare = 1.6 + 0.6 * s;
  } else if (xn < MID_A) {
    s = clamp01((MID_A - xn) / (MID_A - XS));
    W = BEAM * Math.max(0, 1 - s ** 3.2) ** 0.5;
    wd = BEAM * Math.max(0, 1 - s ** 5) ** 0.5;
    yk = 3.4 * smooth(s / 0.82);
    yw = Math.max(4.3 + 0.6 * s * s, yk + 0.6);
    nb = 3.0 + 0.8 * s;
    rake = 0.35 * s * s;
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
// длина обвода от киля до q
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
const CAMBER = 0.12;
export function deckY(x, z = 0) {
  const c = sec(x);
  const y0 = x >= XB ? c.yf : c.yd;
  const w = sideYZ(c, qOfY(c, y0))[1];
  return y0 + CAMBER * Math.max(0, 1 - (z / w) ** 2);
}

const stationXs = (() => {
  const xs = [];
  const N = 150;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 0.4 * t + 0.6 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    xs.push(XS + (XF - XS) * u);
  }
  let k = 0;
  while (xs[k + 1] < XB) k++;
  // точное сечение среза полубака, соседние раздвинуть
  if (XB - xs[k] < 0.15) xs.splice(k, 1);
  else if (xs[k + 1] - XB < 0.15) xs.splice(k + 1, 1);
  xs.push(XB);
  xs.sort((a, b) => a - b);
  return xs;
})();
const GIRTH = Math.max(...stationXs.map((x) => arcTo(sec(x), 1))) * 1.01;

// UV атласа: борт v 0.505…0.995, палубы 0.255…0.495, стены надстроек 0.005…0.245 (u 0…0.745), труба (u 0.755…0.995)
const UX0 = XS - 0.6, UX1 = XF + 0.3;
const U = (x) => 0.005 + (0.99 * (x - UX0)) / (UX1 - UX0);
const xOfU = (u) => UX0 + ((u - 0.005) / 0.99) * (UX1 - UX0);
const V_SIDE = (arc) => 0.505 + (0.49 * arc) / GIRTH;
const ZD = 5.7;
const V_DECK = (z) => 0.255 + (0.24 * (z + ZD)) / (2 * ZD);
const WALL_H = 3.2;
const V_WALL = (band, h) => (band === 0 ? 0.006 : 0.127) + (0.115 * clamp01(h / WALL_H));
const KU_WALL = 0.735 / 48; // u на метр периметра
const FUN = { u0: 0.757, u1: 0.993, h: 6.6 };
const V_FUN = (h) => 0.006 + 0.236 * clamp01(h / FUN.h);

// Точка борта на высоте y в абсциссе x (с учётом наклона форштевня/кормы)
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
  const GREY = '#6c757b';

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
    C.fillStyle = '#3d2622'; // необрастающая краска
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
  for (let x = 4; x < 40; x += 2.1) {
    if (Math.abs(x - 22) < 1.0) continue;
    hullMark(x, fcDeckY(x) - 1.2, 0.32, 0.32, '#15181a', 'rgb(50,50,50)', ['rgba(170,175,178,0.9)', 2], 0.5);
  }
  for (let x = -47; x < -26; x += 2.2) hullMark(x, mainDeckY(x) - 1.0, 0.32, 0.32, '#15181a', 'rgb(50,50,50)', ['rgba(170,175,178,0.9)', 2], 0.5);
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
  [[-4, 4.3], [-8.5, 4.25], [2.0, 4.3], [-12, 4.25]].forEach(([x, y]) => hullMark(x, y, 0.35, 0.25, '#202224', 'rgb(60,60,60)', null, 0.5));
  // клюзы: тёмная окантовка
  hullMark(HAWSE.x, HAWSE.y, 0.75, 0.75, '#2a2d30', 'rgb(110,110,110)', null, 0.5);

  // ---- ПАЛУБЫ (v 0.25…0.5)
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = '#5f6468';
  C.fillRect(0, d0, S, d1 - d0);
  for (let i = 0; i < 900; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.02)';
    C.beginPath();
    C.ellipse(rnd() * S, d0 + rnd() * (d1 - d0), 6 + rnd() * 28, 4 + rnd() * 14, 0, 0, Math.PI * 2);
    C.fill();
  }
  for (let z = -ZD + 0.35; z < ZD; z += 1.5) {
    const y = py(V_DECK(z));
    line(C, 0, y, S, y, 1.5, 'rgba(25,28,30,0.35)');
    line(Hc, 0, y, S, y, 2, 'rgb(96,96,96)');
  }
  for (let x = XS; x < XF; x += 3.0) {
    const X = px(U(x));
    line(C, X, d0, X, d1, 1.5, 'rgba(25,28,30,0.3)');
    line(Hc, X, d0, X, d1, 2, 'rgb(98,98,98)');
  }
  // протёртые дорожки по палубе
  C.fillStyle = 'rgba(150,150,140,0.06)';
  C.fillRect(0, py(V_DECK(2.0)), S, py(V_DECK(-2.0)) - py(V_DECK(2.0)));

  // ---- СТЕНЫ НАДСТРОЕК (v 0…0.25, u 0…0.745): полоса 0 — иллюминаторы, полоса 1 — окна рубки
  const w0 = 0, w1 = px(0.75);
  const bandY = (band, h) => py(V_WALL(band, h));
  C.fillStyle = '#737a80';
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
  C.fillStyle = '#72797f';
  C.fillRect(f0, py(0.25), f1 - f0, S - py(0.25));
  // сажа к верху
  {
    const g = C.createLinearGradient(0, py(V_FUN(FUN.h - 0.9)), 0, py(V_FUN(FUN.h - 3.0)));
    g.addColorStop(0, 'rgba(30,30,30,0.35)');
    g.addColorStop(1, 'rgba(30,30,30,0)');
    C.fillStyle = g;
    C.fillRect(f0, py(V_FUN(FUN.h - 0.9)), f1 - f0, py(V_FUN(FUN.h - 3.0)) - py(V_FUN(FUN.h - 0.9)));
  }
  C.fillStyle = '#2a2e31'; // тёмная кромка и внутренняя стенка
  C.fillRect(f0, py(0.25), f1 - f0, py(V_FUN(FUN.h - 0.32)) - py(0.25));
  [1.4, 3.0, 4.6].forEach((h) => {
    line(C, f0, py(V_FUN(h)), f1, py(V_FUN(h)), 2, 'rgba(20,24,26,0.25)');
    line(Hc, f0, py(V_FUN(h)), f1, py(V_FUN(h)), 3, 'rgb(150,150,150)');
  });
  // рёбра-«пояса» у колпака
  line(Hc, f0, py(V_FUN(FUN.h - 0.9)), f1, py(V_FUN(FUN.h - 0.9)), 4, 'rgb(170,170,170)');

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
const HAWSE = { x: 46.6, y: 9.0 };

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
  const ids = outline.map((p) => bm.v(V3(XB, p.y, p.z), 0.004 + (p.z + zMax) * KU_WALL, V_WALL(0, p.y - y0 + 0.55)));
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

// Фальшборт бака: от x0 вдоль кромки палубы полубака вокруг форштевня
function buildBulwark(x0, h) {
  const xs = stationXs.filter((x) => x >= x0);
  const path = xs.map((x) => [x, sideYZ(sec(x), qOfY(sec(x), fcDeckY(x)))[1]]);
  const back = [...path].reverse().map(([x, z]) => [x, -z]);
  const loop = [...path, ...back];
  // контур открытый: правый борт → форштевень → левый борт; положительное смещение — внутрь
  const yAt = (p) => fcDeckY(p[0]);
  const yIn = (p) => {
    const w = Math.abs(p[1]);
    const zi = Math.max(0, w - 0.07);
    return fcDeckY(p[0]) + CAMBER * (1 - (zi / Math.max(w, 1e-3)) ** 2) - 0.01;
  };
  return sweepPath(
    loop,
    [
      [0, yAt],
      [-0.04, (p) => yAt(p) + h],
      [0.07, (p) => yAt(p) + h],
      [0.07, yIn],
    ],
    (per, pr, k, p) => [U(p.x), k <= 1 ? V_SIDE(GIRTH * 0.985 - (k === 0 ? 0.6 : 0)) : V_DECK(Math.max(-ZD, Math.min(ZD, p.z)))],
    { closed: false, caps: true },
  );
}

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Дополнительные помощники

// Замкнутое тело: обход граней наружу по знаку объёма
function fixVol(g) {
  const idx = g.index.array;
  if (signedVolume(g.attributes.position.array, idx) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

// Стенка с толщиной вдоль открытой ломаной в плане [[x, z], ...] от y0 до y1 (замкнутое тело)
function wallPath(path, y0, y1, th, uvFn = () => [0.5, 0.5], lean = 0) {
  const g = sweepPath(path, [[0, y0], [lean, y1], [lean + th, y1], [th, y0], [0, y0]], (per, pr, k, p) => uvFn(per, pr, k, p), {
    closed: false,
    caps: true,
  });
  return fixVol(g);
}

// Плита по многоугольнику в плане (x, z) толщиной th, верх на y
function slab(poly, y, th, uvFn = (x, z) => [U(x), V_DECK(z)]) {
  const m = new Mesher();
  const v2 = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const pts = THREE.ShapeUtils.isClockWise(v2) ? [...poly].reverse() : poly;
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
  const T = pts.map(([x, z]) => m.v(V3(x, y, z), ...uvFn(x, z)));
  const B = pts.map(([x, z]) => m.v(V3(x, y - th, z), ...uvFn(x, z)));
  tris.forEach(([a, b, c]) => {
    m.tri(T[a], T[b], T[c]);
    m.tri(B[a], B[c], B[b]);
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    m.quad(B[i], B[j], T[j], T[i]);
  }
  return fixVol(m.build({ orient: false }));
}

// UV тела вращения в полосу стен атласа (u — по окружности, v — по высоте)
function wallUV(g, band, r, yShift = 0) {
  const uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const f = uv.getX(i);
    uv.setXY(i, 0.62 + f * 2 * Math.PI * r * KU_WALL * 0.9, V_WALL(band, pos.getY(i) + yShift));
  }
  return g;
}

// Многоугольник-окружность в плане
const circle = (cx, cz, r, n = 16) => {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return p;
};

// ---------------------------------------------------------------------------

export function createDestroyerO() {
  const ship = new THREE.Group();
  ship.name = 'Destroyer_O_Class';
  const { map, normalMap } = paintAtlas();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    paint: std('Hull_Paint_Atlas', 0xffffff, 0.7, 0.12, { map, normalMap }),
    grey: std('Steel_Grey', 0x7d868d, 0.62, 0.25),
    dark: std('Steel_Dark', 0x2c3033, 0.6, 0.35),
    bottom: std('Antifouling_Dark', 0x3d2622, 0.75, 0.1),
    bronze: std('Propeller_Bronze', 0xa07a45, 0.32, 0.9),
    wire: std('Rigging_Wire', 0x26282a, 0.55, 0.6),
    canvas: std('Canvas_Cover', 0x7c7868, 0.9, 0.0),
    boat: std('Boat_Paint', 0x858d92, 0.55, 0.05),
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
  const fcY = (x, z = 0) => deckY(x, z);
  const deckEdge = (x) => edgeZ(x, x >= XB ? fcDeckY(x) : mainDeckY(x));

  // ---- ключевые размеры
  const GA = { x: 34.0 }; // орудие A на баке
  const SH = { x0: 12.2, x1: 27.3, hw: 3.0 }; // надстройка под орудием B и мостиком
  const ySh = fcY(SH.x1) + 2.2; // крыша надстройки (палуба орудия B)
  const GB = { x: 25.0 };
  const WH = { x0: 13.4, x1: 20.6, hw: 2.8 }; // рулевая рубка
  const yPlat = ySh + 2.35; // палуба компасного мостика
  const L271 = { x: 10.9, y: yPlat + 0.75 }; // фонарь РЛС 271
  const FMAST = { x: 7.9 };
  const FUNNEL = { x: 0.6, a: 2.8, b: 1.6, rake: Math.tan((5 * Math.PI) / 180) };
  const yFun0 = fcY(FUNNEL.x) + 0.9;
  const TT = { x: -11.2 };
  const yTT = mainDeckY(TT.x) + CAMBER + 0.45;
  const PP = { x: -19.6, r: 2.5 };
  const yPP = mainDeckY(PP.x) + CAMBER + 2.6;
  const XH = { x0: -33.2, x1: -25.6, hw: 2.55 };
  const yXH = mainDeckY(XH.x0) + CAMBER + 2.25;
  const GX = { x: -29.6 };
  const GY = { x: -39.6 };
  const MMAST = { x: -24.2 };
  const PROP = { x: -40.8, y: 1.5, z: 2.55, r: 1.35 };
  const RUD = { x: -46.35, y0: 1.15, y1: 3.45 };
  const BOAT = { x: -0.6, L: 7.6, B: 2.05, D: 0.85, z: 4.55 };
  BOAT.y = fcY(BOAT.x) + 2.05;

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  const { hull, bulkhead } = buildHull();
  mesh(merge([hull, bulkhead, buildBulwark(46.5, 0.6)]), M.paint, 'Hull_Shell', hullG);

  // Подводные выступы: валы, кронштейны, мортиры, скуловые кили, дейдвуд
  {
    const parts = [];
    [1, -1].forEach((sd) => {
      const z = sd * PROP.z;
      parts.push(rod([-17.5, 0.75, sd * 1.75], [PROP.x + 0.3, PROP.y, z], 0.15, 10));
      parts.push(rod([-17.0, 0.73, sd * 1.73], [-24.5, 1.0, sd * 1.99], 0.3, 10));
      const xb = PROP.x + 1.3;
      parts.push(latheX([[0.0, -0.4], [0.24, -0.28], [0.24, 0.3], [0.0, 0.45]], 12).translate(xb, PROP.y, z));
      const leg = (zz, yy) => {
        const g = prism([[-0.35, 0], [0.35, 0], [0.22, 1], [-0.22, 1]], 0.08);
        const a = V3(xb, PROP.y, z), b = V3(xb, yy, zz);
        const d = b.clone().sub(a);
        g.scale(1, d.length(), 1);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
        g.translate(a.x, a.y, a.z);
        return g;
      };
      parts.push(leg(sd * 3.3, 3.9));
      parts.push(leg(sd * 0.9, 3.75));
      // скуловой киль
      const bk = [];
      for (let i = 0; i <= 18; i++) {
        const x = lerp(-18, 14, i / 18);
        const c = sec(x);
        const q = QL * 0.62;
        const p = sideP(c, q);
        const pq = sideP(c, q + 0.01).sub(sideP(c, q - 0.01)).normalize();
        const out = V3(0, -pq.z, pq.y).multiplyScalar(-1);
        if (out.z < 0) out.negate();
        const taper = Math.sin((Math.PI * i) / 18) ** 0.4;
        const ring = [
          p.clone().addScaledVector(pq, 0.12).addScaledVector(out, -0.06),
          p.clone().addScaledVector(out, 0.45 * taper + 0.02),
          p.clone().addScaledVector(pq, -0.12).addScaledVector(out, -0.06),
        ];
        bk.push(ring.map((v) => V3(v.x, v.y, sd * v.z)));
      }
      parts.push(loftRings(bk, () => [0.5, 0.5]));
    });
    // дейдвуд (скег) от миделя до руля
    {
      const lo = [], hi = [];
      for (let i = 0; i <= 14; i++) {
        const x = lerp(-15, -44.2, i / 14);
        const yk = sec(x).yk;
        const yb = Math.min(yk - 0.02, 0.02 + 1.5 * ((i / 14) ** 2.5));
        lo.push([x, yb]);
        hi.push([x, Math.max(yk + 0.45, yb + 0.5)]);
      }
      parts.push(prism([...lo, ...hi.reverse()], 0.32));
    }
    mesh(merge(parts), M.bottom, 'Hull_Appendages', hullG);
  }

  // ======================= НАДСТРОЙКИ (атлас)
  const supG = group('Superstructure', ship);
  const funnelRing = (y, sc) => {
    const NS = 40;
    const pts = [];
    const cx = FUNNEL.x - (y - yFun0) * FUNNEL.rake;
    for (let j = 0; j <= NS; j++) {
      const a = (j / NS) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const ex = 2 / 3.2;
      pts.push(V3(cx + sc * FUNNEL.a * Math.sign(c) * Math.abs(c) ** ex, y, sc * FUNNEL.b * Math.sign(s) * Math.abs(s) ** ex));
    }
    return pts;
  };
  let u0 = 0.004;
  const houseParts = (list) => (poly, y0, h, opt = {}) => {
    const yb = opt.onDeck ? Math.min(...poly.map(([x, z]) => deckY(x, z))) - 0.03 : y0;
    const r = house(poly, y0, h, { ...opt, u0, yBot: opt.yBot ?? Math.min(yb, y0) });
    u0 = 0.004 + ((u0 - 0.004 + r.per * KU_WALL) % 0.6);
    list.push(r.g);
  };
  // --- мостик и надстройка орудия B
  {
    const parts = [];
    const add = houseParts(parts);
    const whPoly = roundRect(WH.x0, WH.x1, -WH.hw, WH.hw, 0.5);
    // надстройка: нос заострён (скошенные углы)
    const shPoly = [
      [SH.x1, -1.2], [SH.x1, 1.2], [SH.x1 - 1.6, SH.hw], [SH.x0 + 0.5, SH.hw], [SH.x0, SH.hw - 0.5],
      [SH.x0, -SH.hw + 0.5], [SH.x0 + 0.5, -SH.hw], [SH.x1 - 1.6, -SH.hw],
    ];
    add(shPoly, ySh - 2.2, 2.2, { band: 0, onDeck: true, holes: [whPoly] });
    // рулевая рубка (верх закрыт площадкой)
    add(whPoly, ySh, yPlat - 0.18 - ySh, { band: 1, roof: false });
    // площадка компасного мостика с крыльями
    const plat = [
      [21.6, -1.6], [21.6, 1.6], [20.6, 3.1], [20.2, 4.75], [17.4, 4.75], [16.6, 3.2], [12.0, 3.2], [11.7, 2.8],
      [11.7, -2.8], [12.0, -3.2], [16.6, -3.2], [17.4, -4.75], [20.2, -4.75], [20.6, -3.1],
    ];
    add(plat, yPlat - 0.18, 0.18, { band: 0, yBot: yPlat - 0.18 });
    {
      const mm = new Mesher();
      const ccw = (q) => (THREE.ShapeUtils.isClockWise(q.map(([x, z]) => new THREE.Vector2(x, z))) ? [...q].reverse() : q);
      const outer = ccw(plat), hole = [...ccw(whPoly)].reverse();
      const tr = THREE.ShapeUtils.triangulateShape(outer.map(([x, z]) => new THREE.Vector2(x, z)), [hole.map(([x, z]) => new THREE.Vector2(x, z))]);
      const R = [...outer, ...hole].map(([x, z]) => mm.v(V3(x, yPlat - 0.18, z), U(x), V_DECK(z)));
      tr.forEach(([a, b, c]) => mm.tri(R[a], R[c], R[b]));
      parts.push(orientOut(mm.build({ orient: false }), V3(16, yPlat, 0)));
    }
    // ограждение (ветроотбойник) мостика — замкнутый контур с толщиной
    {
      const bl = plat.map(([x, z]) => [x - 0.03 * Math.sign(x - 16), z * 0.992]);
      parts.push(
        sweepPath(bl, [[0, yPlat - 0.01], [-0.03, yPlat + 1.2], [0.07, yPlat + 1.2], [0.07, yPlat - 0.01]], (per, pr) => [
          FUN.u0 + ((per * KU_WALL) % (FUN.u1 - FUN.u0)),
          V_FUN(0.15 + Math.max(0, pr[1] - yPlat)),
        ]),
      );
    }
    // башенка КДП (директор) на мостике
    add(roundRect(13.8, 15.8, -1.0, 1.0, 0.25), yPlat + 0.9, 1.45, { band: 1 });
    parts.push(lathe([[0.75, yPlat - 0.05], [0.7, yPlat + 0.9], [0, yPlat + 0.905]], 18).translate(14.8, 0, 0));
    // штурманская рубка в корме мостика
    add(roundRect(11.95, 13.4, -1.6, 1.6, 0.2), yPlat, 1.2, { band: 1 });
    // башня фонаря РЛС 271
    add(roundRect(9.8, 11.9, -1.05, 1.05, 0.3), ySh, L271.y - ySh, { band: 0 });
    mesh(merge(parts), M.paint, 'Bridge_Structure', supG);
  }
  // --- труба, кожух, надстройка торпедного аппарата и «пом-пома», кормовая рубка
  {
    const parts = [];
    const add = houseParts(parts);
    add(roundRect(-3.2, 4.6, -2.1, 2.1, 0.6), fcY(FUNNEL.x), 0.9, {
      band: 0,
      onDeck: true,
      holes: [funnelRing(yFun0, 1).slice(0, -1).map((p) => [p.x, p.z])],
    });
    // труба
    {
      const fm = new Mesher();
      const NS = 40;
      const yTop = yFun0 + FUN.h;
      const levels = [
        [yFun0, 1, 0],
        [yFun0 + 2, 1, 2],
        [yFun0 + 4, 1, 4],
        [yTop - 0.9, 1, FUN.h - 0.9],
        [yTop, 1.0, FUN.h],
        [yTop + 0.02, 0.94, FUN.h],
        [yTop - 1.1, 0.94, FUN.h - 0.3],
      ];
      const ids = levels.map(([y, sc, h]) => funnelRing(y, sc).map((p, j) => fm.v(p, FUN.u0 + (FUN.u1 - FUN.u0) * (j / NS), V_FUN(h))));
      for (let k = 0; k < ids.length - 1; k++) fm.strip(ids[k], ids[k + 1]);
      const ci = fm.v(funnelRing(yTop - 1.1, 0)[0], FUN.u0 + 0.1, V_FUN(FUN.h - 0.2));
      const lastR = ids[ids.length - 1];
      for (let j = 0; j < NS; j++) fm.tri(ci, lastR[j + 1], lastR[j]);
      parts.push(orientOut(fm.build({ orient: false }), V3(FUNNEL.x - 2 * FUNNEL.rake, yFun0 + 2, 0)));
    }
    // башня «пом-пома»: восьмигранная надстройка и площадка
    add(roundRect(PP.x - 1.9, PP.x + 1.9, -1.9, 1.9, 0.9), mainDeckY(PP.x) + CAMBER, yPP - mainDeckY(PP.x) - CAMBER - 0.15, { band: 0, onDeck: true, roof: false });
    const ppPlat = circle(PP.x, 0, PP.r, 16);
    parts.push(slab(ppPlat, yPP, 0.15));
    {
      const bl = circle(PP.x, 0, PP.r - 0.04, 24);
      parts.push(
        sweepPath(bl, [[0, yPP - 0.01], [0, yPP + 1.05], [0.07, yPP + 1.05], [0.07, yPP - 0.01]], (per, pr) => [
          FUN.u0 + (FUN.u1 - FUN.u0) * Math.min(1, per / (2 * Math.PI * (PP.r - 0.04) * 0.995)),
          V_FUN(0.15 + Math.max(0, pr[1] - yPP)),
        ]),
      );
    }
    // кормовая рубка под орудием X
    add(roundRect(XH.x0, XH.x1, -XH.hw, XH.hw, 0.6), mainDeckY(XH.x0) + CAMBER, 2.25, { band: 0, onDeck: true });
    // световой люк машинного отделения
    add(roundRect(-8.6, -6.0, -0.9, 0.9, 0.15), mainDeckY(-7) + CAMBER, 0.55, { band: 0, onDeck: true });
    // кожух вентиляции у среза полубака
    add(roundRect(-4.6, -3.4, -1.5, 1.5, 0.2), fcY(-4), 0.75, { band: 0, onDeck: true });
    mesh(merge(parts), M.paint, 'Superstructure_Main', supG);
  }

  // ======================= ПАЛУБНОЕ ОБОРУДОВАНИЕ (сталь)
  const deckG = group('Deck_Equipment', ship);
  const yA = deckY(GA.x) + 0.45;
  const yB = ySh + 0.4;
  const yX = yXH + 0.4;
  const yY = deckY(GY.x) + 0.45;
  {
    const parts = [];
    const atDeck = (g, x, z = 0, dy = 0) => g.translate(x, deckY(x, z) + dy, z);
    const pedestal = (h) => lathe([[0.8, -0.08], [0.8, 0.08], [0.6, 0.16], [0.55, h - 0.1], [0.68, h - 0.05], [0.68, h], [0, h + 0.005]], 24);
    parts.push(atDeck(pedestal(0.45), GA.x));
    parts.push(pedestal(0.4).translate(GB.x, ySh, 0));
    parts.push(pedestal(0.4).translate(GX.x, yXH, 0));
    parts.push(atDeck(pedestal(0.45), GY.x));
    // тумба торпедного аппарата
    parts.push(atDeck(lathe([[1.1, -0.08], [1.1, 0.1], [0.85, 0.18], [0.8, 0.42], [0.95, 0.45], [0, 0.455]], 24), TT.x));
    // волнолом перед орудием A
    {
      const xw = 39.6;
      const pathW = [[xw - 2.6, 3.4], [xw - 1.0, 1.6], [xw, 0], [xw - 1.0, -1.6], [xw - 2.6, -3.4]];
      const g = sweepPath(pathW, [[0, (p) => deckY(p[0], p[1]) - 0.06], [0, (p) => deckY(p[0], p[1]) + 0.9], [0.06, (p) => deckY(p[0], p[1]) + 0.9], [0.06, (p) => deckY(p[0], p[1]) - 0.06], [0, (p) => deckY(p[0], p[1]) - 0.06]], () => [0.5, 0.5], { closed: false, caps: true });
      parts.push(fixVol(g));
      [[xw - 1.8, 2.5], [xw - 0.6, 0.8], [xw - 0.6, -0.8], [xw - 1.8, -2.5]].forEach(([x, z]) =>
        parts.push(rod([x - 0.5, deckY(x - 0.5, z) - 0.03, z * 0.85], [x - 0.04, deckY(x, z) + 0.7, z], 0.04, 6, 'top')),
      );
    }
    // шпиль, кнехты, клюзы
    parts.push(atDeck(lathe([[0.45, -0.08], [0.45, 0.1], [0.32, 0.15], [0.28, 0.45], [0.36, 0.5], [0.32, 0.58], [0, 0.62]], 20), 43.6));
    const bollard = () => {
      const p = () => lathe([[0.13, -0.08], [0.12, 0.34], [0.17, 0.38], [0.17, 0.42], [0, 0.44]], 12);
      return merge([p().translate(0.3, 0, 0), p().translate(-0.3, 0, 0), box(0.9, 0.12, 0.34, 0, -0.02, 0)]);
    };
    [[41.0, 0.7], [30.0, 0.8], [8.5, 0.86], [-8.0, 0.85], [-36.0, 0.8], [-47.0, 0.62]].forEach(([x, k]) => {
      [1, -1].forEach((sd) => parts.push(atDeck(bollard(), x, sd * deckEdge(x) * k)));
    });
    [1, -1].forEach((sd) => {
      parts.push(atDeck(lathe([[0.32, -0.08], [0.3, 0.18], [0.22, 0.22], [0.22, 0.16], [0, 0.15]], 16), 45.9, sd * 1.1));
      parts.push(atDeck(box(0.9, 0.3, 0.32, 0, 0.1, 0), 44.9, sd * 0.75));
      const r = sideAt(HAWSE.x, HAWSE.y);
      const n = r.n.clone();
      n.z *= sd;
      const ring = new THREE.TorusGeometry(0.36, 0.07, 6, 16);
      ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n));
      ring.translate(HAWSE.x, HAWSE.y, sd * (r.z + 0.02));
      parts.push(ring);
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
      [6.0, 1.7, 1.5, 0.3, 0],
      [6.0, -1.7, 1.5, 0.3, 0],
      [-2.6, 2.7, 1.3, 0.26, Math.PI],
      [-2.6, -2.7, 1.3, 0.26, Math.PI],
      [-15.0, 1.6, 1.1, 0.22, 0],
      [-15.0, -1.6, 1.1, 0.22, 0],
      [-34.2, 1.4, 1.0, 0.2, 0],
      [-34.2, -1.4, 1.0, 0.2, 0],
    ].forEach(([x, z, h, r, yaw]) => parts.push(atDeck(cowl(h, r, yaw), x, z)));
    // кормовые бомбосбрасыватели (рельсы)
    const DC = { x0: -45.6, x1: -51.5 };
    [1, -1].forEach((sd) => {
      const z = sd * 1.7;
      [-0.32, 0.32].forEach((dz) => {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const x = lerp(DC.x0, DC.x1, i / 6);
          pts.push(V3(x, deckY(x, z + dz) + 0.62 - 0.14 * (i / 6), z + dz));
        }
        parts.push(tubePath(pts, 0.045, 6));
        [0, 0.5, 1].forEach((t) => {
          const x = lerp(DC.x0, DC.x1, t);
          parts.push(rod([x, deckY(x, z + dz) - 0.05, z + dz], [x, deckY(x, z + dz) + 0.6 - 0.14 * t, z + dz], 0.04, 6, 'top'));
        });
      });
    });
    // бомбомёты Торникрофта (по два на борт) и стеллажи
    [-42.0, -37.0].forEach((x) =>
      [1, -1].forEach((sd) => {
        const z = sd * (deckEdge(x) - 1.0);
        const base = lathe([[0.34, -0.08], [0.32, 0.3], [0, 0.32]], 14);
        const barrel = rod([0, 0.25, 0], [0, 1.2, sd * 0.45], 0.18, 12);
        const cup = lathe([[0.27, 0], [0.27, 0.12], [0, 0.13]], 12, { bottom: true });
        cup.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(0, 0.95, sd * 0.45).normalize()));
        cup.translate(0, 1.2, sd * 0.45);
        parts.push(atDeck(merge([base, barrel, cup]), x, z));
        parts.push(atDeck(box(1.6, 0.06, 0.7, 0, 0.32, 0), x + 1.6, z));
        [-0.55, 0.55].forEach((dx) => parts.push(atDeck(rod([0, -0.05, 0], [0, 0.32, 0], 0.04, 6, 'top'), x + 1.6 + dx, z)));
      }),
    );
    // трапы со среза полубака
    [1, -1].forEach((sd) => {
      const z = sd * 3.6;
      const top = V3(XB - 0.05, fcDeckY(XB) + 0.08, z), bot = V3(XB - 2.2, mainDeckY(XB - 2.2) + 0.1, z);
      [-0.32, 0.32].forEach((dz) => parts.push(rod([top.x, top.y, z + dz], [bot.x, bot.y, z + dz], 0.04, 6)));
      for (let i = 1; i < 8; i++) {
        const p = top.clone().lerp(bot, i / 8);
        parts.push(box(0.18, 0.04, 0.64, p.x, p.y, z));
      }
    });
    // трапы на крышу надстройки B и кормовой рубки
    const ladder = (x0, y0, x1, y1, z) => {
      [-0.28, 0.28].forEach((dz) => parts.push(rod([x0, y0, z + dz], [x1, y1, z + dz], 0.035, 6)));
      for (let i = 1; i < 7; i++) {
        const t = i / 7;
        parts.push(box(0.16, 0.04, 0.56, lerp(x0, x1, t), lerp(y0, y1, t), z));
      }
    };
    [1, -1].forEach((sd) => {
      ladder(SH.x0 - 1.8, fcY(SH.x0 - 1.8) + 0.05, SH.x0 + 0.05, ySh + 0.05, sd * 2.3);
      ladder(XH.x1 + 1.8, mainDeckY(XH.x1 + 1.8) + CAMBER + 0.05, XH.x1 - 0.05, yXH + 0.05, sd * 1.6);
    });
    // леерные стойки и леера
    const rail = (ptsXZ, yFn, spacing = 1.8) => {
      const top1 = [], top2 = [];
      let acc = spacing;
      ptsXZ.forEach(([x, z], i) => {
        const y = yFn(x, z);
        top1.push(V3(x, y + 1.0, z));
        top2.push(V3(x, y + 0.55, z));
        if (i > 0) acc += Math.hypot(x - ptsXZ[i - 1][0], z - ptsXZ[i - 1][1]);
        if (acc >= spacing || i === ptsXZ.length - 1) {
          acc = 0;
          parts.push(rod([x, y - 0.04, z], [x, y + 1.0, z], 0.025, 5, 'top'));
        }
      });
      parts.push(tubePath(top1, 0.022, 5));
      parts.push(tubePath(top2, 0.018, 5));
    };
    const inset = 0.12;
    [1, -1].forEach((sd) => {
      const pts = [];
      for (let x = XB + 0.15; x <= 44.5; x += 0.75) pts.push([x, sd * (edgeZ(x, fcDeckY(x)) - inset)]);
      rail(pts, (x, z) => deckY(x, z));
    });
    {
      const pts = [];
      for (let z = -edgeZ(XB, fcDeckY(XB)) + inset; z <= edgeZ(XB, fcDeckY(XB)) - inset + 1e-6; z += 0.5) pts.push([XB + 0.12, z]);
      const keep = pts.filter(([, z]) => Math.abs(Math.abs(z) - 3.6) > 0.5);
      const segs = [[], [], []];
      keep.forEach(([x, z]) => segs[z < -3.6 ? 0 : z > 3.6 ? 2 : 1].push([x, z]));
      segs.forEach((s) => s.length > 1 && rail(s, (x, z) => deckY(x, z), 1.2));
    }
    {
      const pts = [];
      for (let x = XB - 0.15; x >= XS + 2.5; x -= 0.75) pts.push([x, edgeZ(x, mainDeckY(x)) - inset]);
      const xc = XS + 2.5;
      const zc = pts[pts.length - 1][1];
      for (let i = 1; i < 18; i++) {
        const a = (i / 18) * Math.PI;
        const x = xc - 2.3 * Math.sin(a);
        const z = zc * Math.cos(a);
        const lim = edgeZ(x, mainDeckY(x)) - inset;
        pts.push([x, Math.sign(z) * Math.min(Math.abs(z), lim)]);
      }
      const back = [];
      for (let x = XS + 2.5; x <= XB - 0.15 + 1e-6; x += 0.75) back.push([x, -(edgeZ(x, mainDeckY(x)) - inset)]);
      rail([...pts, ...back], (x, z) => deckY(x, z));
    }
    // поручни на крышах надстроек
    {
      const poly = roundRect(XH.x0 + 0.1, XH.x1 - 0.1, -XH.hw + 0.1, XH.hw - 0.1, 0.5, 4);
      rail([...poly, poly[0]], () => yXH, 1.5);
      const sh = [[SH.x1 - 0.1, -1.15], [SH.x1 - 0.1, 1.15], [SH.x1 - 1.65, SH.hw - 0.1], [WH.x1 + 0.3, SH.hw - 0.1]];
      rail(sh, () => ySh, 1.4);
      rail(sh.map(([x, z]) => [x, -z]), () => ySh, 1.4);
    }
    // шлюпбалки
    [1, -1].forEach((sd) => {
      [BOAT.x - 2.9, BOAT.x + 2.9].forEach((x) => {
        const ze = deckEdge(x) - 0.3;
        const y0 = deckY(x, ze) - 0.08;
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          if (t < 0.45) pts.push(V3(x, y0 + 3.3 * (t / 0.45) * 0.78, sd * ze));
          else {
            const ang = (((t - 0.45) / 0.55) * Math.PI) / 2;
            pts.push(V3(x, y0 + 2.57 + 0.8 * Math.sin(ang), sd * (ze - 0.85 * (1 - Math.cos(ang)) + 0.4 * Math.sin(ang))));
          }
        }
        parts.push(tubePath(pts, 0.085, 8));
        const tip = pts[pts.length - 1];
        parts.push(rod([tip.x, tip.y - 0.05, tip.z], [tip.x, BOAT.y + BOAT.D * 0.5, tip.z], 0.03, 5));
      });
    });
    // кранцы-ящики, кранцевые ящики боезапаса у орудий
    [[31.5, 2.6], [31.5, -2.6], [-36.6, 2.6], [-36.6, -2.6], [-14.2, 3.0], [-14.2, -3.0]].forEach(([x, z]) => parts.push(atDeck(box(1.1, 0.75, 0.6, 0, 0.32, 0), x, z)));
    // штурвальная тумба, нактоуз, визиры на мостике
    parts.push(lathe([[0.2, -0.05], [0.14, 0.95], [0.22, 1.05], [0, 1.25]], 14).translate(18.6, yPlat, 0));
    [1, -1].forEach((sd) => parts.push(lathe([[0.12, -0.05], [0.08, 1.05], [0.16, 1.1], [0, 1.3]], 10).translate(19.6, yPlat, sd * 2.0)));
    // ходовые огни
    [1, -1].forEach((sd) => parts.push(box(0.4, 0.45, 0.25, 18.6, yPlat + 0.75, sd * 4.82)));
    // флагштоки
    parts.push(lathe([[0.05, fcDeckY(51.5) - 0.05], [0.03, fcDeckY(51.5) + 3.2], [0.05, fcDeckY(51.5) + 3.25], [0, fcDeckY(51.5) + 3.3]], 8).translate(51.5, 0, 0));
    parts.push(lathe([[0.06, mainDeckY(-51.4) - 0.05], [0.035, mainDeckY(-51.4) + 4.2], [0.06, mainDeckY(-51.4) + 4.25], [0, mainDeckY(-51.4) + 4.3]], 8).translate(-51.4, 0, 0));
    // РЛС 285 на КДП: две группы по три «рыбьи кости» (яги)
    {
      const yD = yPlat + 0.9 + 1.45;
      [1, -1].forEach((sd) => {
        parts.push(rod([14.0, yD - 0.05, sd * 0.75], [14.0, yD + 0.55, sd * 0.75], 0.035, 6, 'top'));
        [-0.3, 0, 0.3].forEach((dy, i) => {
          const y = yD + 0.3 + dy * 0.9;
          const z = sd * (0.45 + 0.3 * i);
          parts.push(rod([13.6, y, z], [15.7, y, z], 0.025, 5));
          for (let k = 0; k < 5; k++) parts.push(rod([13.8 + k * 0.45, y - 0.22, z], [13.8 + k * 0.45, y + 0.22, z], 0.012, 4));
        });
      });
      // дальномер-визир КДП
      parts.push(latheZ([[0.12, -1.25], [0.12, 1.25]], 10).translate(15.3, yD + 0.25, 0));
      [-1.25, 1.25].forEach((z) => parts.push(latheZ([[0.17, -0.12], [0.17, 0.12]], 10).translate(15.3, yD + 0.25, z)));
    }
    // прожектор на площадке «пом-пома» (сзади)
    parts.push(lathe([[0.32, -0.05], [0.22, 0.25], [0.18, 0.55], [0.26, 0.6], [0, 0.62]], 14).translate(PP.x - 1.6, yPP, 0));
    parts.push(latheX([[0.0, -0.45], [0.2, -0.42], [0.36, -0.3], [0.36, 0.35], [0.4, 0.38], [0.4, 0.44], [0.33, 0.44], [0.33, 0.4], [0, 0.4]], 18).rotateY(Math.PI).translate(PP.x - 1.6, yPP + 1.0, 0));
    mesh(merge(parts), M.grey, 'Deck_Fittings', deckG);

    // Тёмная сталь: якоря, цепи, глубинные бомбы, «эрликоны», сирена
    const dk = [];
    [1, -1].forEach((sd) => {
      const r = sideAt(HAWSE.x - 0.1, HAWSE.y - 0.8);
      const shank = box(0.17, 1.3, 0.15, 0, 0.2, 0);
      const crown = box(0.34, 0.26, 0.32, 0, -0.48, 0);
      const fl = (sx) => prism([[0, 0], [0.45, 0.1], [0.55, 0.58], [0.32, 0.37], [0, 0.23]].map(([a, b]) => [sx * a, b - 0.58]), 0.19);
      const anc = merge([shank, crown, fl(1), fl(-1)]);
      anc.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), r.n.clone()));
      anc.translate(HAWSE.x - 0.1, HAWSE.y - 1.0, r.z + 0.1);
      dk.push(sd > 0 ? anc : mirrorZ(anc));
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = lerp(43.6, 45.9, t);
        const z = lerp(sd * 0.3, sd * 1.1, t);
        pts.push(V3(x, deckY(x, z) + 0.06, z));
      }
      dk.push(tubePath(pts, 0.06, 6));
    });
    const dcharge = () => latheZ([[0.24, -0.33], [0.26, -0.3], [0.26, 0.3], [0.24, 0.33]], 14);
    [1, -1].forEach((sd) => {
      for (let i = 0; i < 6; i++) {
        const t = (i + 0.4) / 6.5;
        const x = lerp(-45.6, -51.5, t);
        const z = sd * 1.7;
        dk.push(dcharge().translate(x, deckY(x, z) + 0.62 - 0.14 * t + 0.27, z));
      }
      [-42.0, -37.0].forEach((xt) => [0, 1].forEach((j) => dk.push(dcharge().translate(xt + 1.25 + j * 0.7, deckY(xt + 1.6, 0) + 0.62, sd * (deckEdge(xt) - 1.0)))));
    });
    // 20-мм «эрликоны» на крыльях мостика: тумба, ствол, щиток
    const oerlikon = (sd) => {
      const p = [];
      p.push(lathe([[0.22, -0.05], [0.12, 0.2], [0.09, 0.95], [0, 0.96]], 10));
      p.push(box(0.3, 0.32, 0.26, 0.05, 1.05, 0));
      p.push(latheX([[0.06, -0.4], [0.06, 0.2], [0.035, 0.25], [0.035, 1.45], [0.05, 1.5], [0, 1.55]], 8).rotateZ(0.35).translate(0.1, 1.1, 0));
      p.push(lathe([[0.17, -0.18], [0.17, 0.18], [0, 0.185]], 10).translate(0.0, 1.32, 0.0));
      const shield = prism([[-0.55, 0], [0.55, 0], [0.5, 0.7], [-0.5, 0.7]], 0.025);
      shield.rotateY(Math.PI / 2);
      shield.translate(0.45, 0.65, 0);
      p.push(shield);
      [1, -1].forEach((s) => p.push(box(0.05, 0.25, 0.05, -0.3, 1.0, s * 0.3)));
      const g = merge(p);
      g.translate(19.2, yPlat, sd * 4.15);
      return g;
    };
    dk.push(oerlikon(1), oerlikon(-1));
    // сирена на трубе
    dk.push(lathe([[0.1, 0], [0.1, 0.3], [0.18, 0.4], [0, 0.45]], 8).translate(FUNNEL.x + FUNNEL.a - 0.5 - 4.8 * FUNNEL.rake, yFun0 + 4.8, 0.6));
    mesh(merge(dk), M.dark, 'Deck_Fittings_Dark', deckG);

    // ======================= ШЛЮПКИ И ПЛОТЫ
    const boatParts = (L, B, D) => {
      const hm = new Mesher(), cm = new Mesher();
      const N = 16, MH = 10, MC = 8;
      const H = [], Cv = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = (t - 0.5) * L;
        const w = (B / 2) * Math.max(0.02, Math.sin(Math.PI * t) ** 0.5);
        const d = D * (0.7 + 0.3 * Math.sin(Math.PI * t));
        const gw = 0.1 * (2 * Math.abs(t - 0.5)) ** 2;
        const hc = 0.42 * Math.sin(Math.PI * t) ** 0.6;
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
      const [hg, cg] = sd > 0 ? boatParts(BOAT.L, BOAT.B, BOAT.D) : boatParts(BOAT.L + 0.6, BOAT.B - 0.2, BOAT.D - 0.05);
      mesh(hg.translate(BOAT.x, BOAT.y, sd * BOAT.z), M.boat, `Boat_Hull_${tag}`, boatsG);
      mesh(cg.translate(BOAT.x, BOAT.y, sd * BOAT.z), M.canvas, `Boat_Cover_${tag}`, boatsG);
    });
    {
      const rafts = [];
      const raft = (rx = 1.05, ry = 0.5) => {
        const curve = new THREE.EllipseCurve(0, 0, rx, ry, 0, Math.PI * 2);
        const pts = curve.getPoints(20).slice(0, -1).map((p) => V3(p.x, p.y, 0));
        const r = 0.15;
        const rings = [];
        for (let j = 0; j < 8; j++) rings.push((j / 8) * Math.PI * 2);
        const m = new Mesher();
        const ids = pts.map((p, i) => {
          const q = pts[(i + 1) % pts.length], o = pts[(i - 1 + pts.length) % pts.length];
          const t = q.clone().sub(o).normalize();
          const nIn = V3(-t.y, t.x, 0);
          return rings.map((a) => m.v(p.clone().addScaledVector(nIn, -Math.cos(a) * r).add(V3(0, 0, Math.sin(a) * r)), i / pts.length, a / 6.3));
        });
        for (let i = 0; i < ids.length; i++) m.strip(ids[i], ids[(i + 1) % ids.length], true);
        return fixVol(m.build({ orient: false }));
      };
      const yX0 = mainDeckY(XH.x0) + CAMBER;
      [1, -1].forEach((sd) => {
        [-31.6, -28.6].forEach((x) => rafts.push(raft().translate(x, yX0 + 1.1, sd * (XH.hw + 0.16))));
        [14.6, 17.6].forEach((x) => rafts.push(raft().translate(x, ySh - 1.05, sd * (SH.hw + 0.16))));
        rafts.push(raft(0.9, 0.45).translate(PP.x, mainDeckY(PP.x) + 1.3, sd * 2.07));
      });
      mesh(merge(rafts), M.boat, 'Carley_Floats', boatsG);
    }
  }

  // ======================= МАЧТЫ И ТАКЕЛАЖ
  const mastG = group('Masts', ship);
  {
    const parts = [];
    const yF0 = fcY(FMAST.x) - 0.05;
    const yLat = 21.0; // верх решётчатой части
    const leg = (sx, sz) => [V3(FMAST.x + sx * 1.15, yF0, sz * 1.15), V3(FMAST.x + sx * 0.32, yLat, sz * 0.32)];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const L = corners.map(([sx, sz]) => leg(sx, sz));
    L.forEach(([a, b]) => parts.push(rod(a.toArray(), b.toArray(), 0.075, 6)));
    const at = (k, t) => L[k][0].clone().lerp(L[k][1], t);
    const lv = [0, 0.18, 0.38, 0.6, 0.82, 1.0];
    for (let i = 0; i < lv.length; i++) {
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        if (i > 0) parts.push(rod(at(k, lv[i]).toArray(), at(k2, lv[i]).toArray(), 0.04, 5));
        if (i < lv.length - 1) {
          parts.push(rod(at(k, lv[i]).toArray(), at(k2, lv[i + 1]).toArray(), 0.03, 4));
          parts.push(rod(at(k2, lv[i]).toArray(), at(k, lv[i + 1]).toArray(), 0.03, 4));
        }
      }
    }
    // площадка на решётке и стеньга
    parts.push(lathe([[0.0, yLat - 0.12], [1.0, yLat - 0.12], [1.0, yLat], [0, yLat + 0.005]], 16).translate(FMAST.x, 0, 0));
    parts.push(lathe([[0.16, yLat - 0.02], [0.13, 25.5], [0.08, 27.6], [0.05, 28.2], [0, 28.25]], 10).translate(FMAST.x, 0, 0));
    parts.push(latheZ([[0.07, -3.0], [0.09, 0], [0.07, 3.0]], 8).translate(FMAST.x, 23.0, 0));
    // РЛС 291: крестовина диполей на топе
    {
      const y = 26.4;
      parts.push(lathe([[0.18, -0.15], [0.18, 0.15], [0, 0.16]], 10).translate(FMAST.x, y, 0));
      [[1, 0], [0, 1]].forEach(([dx, dz]) => {
        parts.push(rod([FMAST.x - 1.4 * dx, y, -1.4 * dz], [FMAST.x + 1.4 * dx, y, 1.4 * dz], 0.04, 5));
        [-1.2, -0.6, 0.6, 1.2].forEach((t) => parts.push(rod([FMAST.x + t * dx, y - 0.35, t * dz], [FMAST.x + t * dx, y + 0.35, t * dz], 0.018, 4)));
      });
    }
    // кормовая мачта-стойка (антенны)
    const yM0 = mainDeckY(MMAST.x) + CAMBER - 0.05;
    parts.push(lathe([[0.17, yM0], [0.15, 13.0], [0.09, 16.5], [0.05, 17.0], [0, 17.02]], 10).translate(MMAST.x, 0, 0));
    parts.push(latheZ([[0.05, -1.8], [0.07, 0], [0.05, 1.8]], 8).translate(MMAST.x, 15.0, 0));
    mesh(merge(parts), M.grey, 'Mast_Lattice', mastG);

    const w = [];
    const r = 0.018;
    const ms = (x, z) => [x, mainDeckY(x) + 0.05 + CAMBER * 0.2, z];
    w.push(rod([FMAST.x, 24.5, 0], [MMAST.x, 16.2, 0], r, 4));
    [1, -1].forEach((sd) => {
      w.push(rod([FMAST.x, 23.0, sd * 2.8], [MMAST.x, 15.0, sd * 1.6], 0.012, 4));
      w.push(rod([MMAST.x, 13.5, sd * 0.12], ms(MMAST.x - 3.0, sd * (deckEdge(MMAST.x - 3.0) - 0.2)), r, 4));
      w.push(rod([FMAST.x, 23.0, sd * 0.1], [FMAST.x - 1.3, yLat - 0.1, sd * 0.9], r, 4));
    });
    w.push(rod([MMAST.x, 14.5, 0], ms(-44.0, 0), r, 4));
    w.push(rod([lerp(FMAST.x, MMAST.x, 0.4), lerp(23.0, 15.0, 0.4), 1.3], [-3.0, fcY(-3) + 0.75, 1.2], 0.012, 3));
    mesh(merge(w), M.wire, 'Rigging', mastG);
  }

  // ======================= ВООРУЖЕНИЕ
  const armsG = group('Armament', ship);
  // 4,7-дюймовое орудие QF Mk IX на установке CP XVIII со щитом (начало — центр погона)
  const buildGun = () => {
    const p = [];
    const ty = 1.0;
    p.push(lathe([[0.72, 0], [0.72, 0.08], [0.62, 0.12], [0, 0.13]], 24));
    [1, -1].forEach((sd) => {
      p.push(prism([[-0.6, 0.1], [0.6, 0.1], [0.38, ty + 0.2], [-0.12, ty + 0.22], [-0.5, ty]], 0.08).translate(0, 0, sd * 0.33));
      p.push(new THREE.TorusGeometry(0.18, 0.025, 6, 14).translate(-0.2, ty - 0.2, sd * 0.52));
      p.push(rod([-0.2, ty - 0.2, sd * 0.37], [-0.2, ty - 0.2, sd * 0.52], 0.025, 6));
      p.push(box(0.34, 0.06, 0.3, -0.8, 0.6, sd * 0.7));
      p.push(rod([-0.45, 0.15, sd * 0.35], [-0.8, 0.57, sd * 0.7], 0.03, 6));
    });
    p.push(rod([0, ty, -0.37], [0, ty, 0.37], 0.09, 12));
    const barrel = [];
    barrel.push(box(2.1, 0.4, 0.46, 0.3, 0, 0));
    barrel.push(rod([-0.8, 0.3, 0], [1.4, 0.3, 0], 0.1, 12));
    barrel.push(latheX([[0.18, -1.2], [0.18, -0.75], [0.14, -0.62], [0.13, 0.7], [0.1, 3.8], [0.085, 5.15], [0.1, 5.2], [0.1, 5.3], [0.055, 5.3], [0.055, 5.1], [0, 5.1]], 18));
    barrel.push(box(0.46, 0.42, 0.42, -1.35, 0, 0));
    barrel.push(box(0.1, 0.26, 0.05, -1.35, 0.3, -0.24));
    barrel.push(rod([0.4, 0.22, -0.42], [-0.45, 0.22, -0.42], 0.05, 8));
    barrel.push(box(0.15, 0.22, 0.09, -0.65, 0.22, -0.42));
    const bg = merge(barrel);
    bg.rotateZ((3 * Math.PI) / 180);
    bg.translate(0, ty, 0);
    p.push(bg);
    // щит: передний лист со скосами, боковины, крыша (открыт сзади)
    {
      const y0 = 0.22, y1 = 2.0, th = 0.035, ln = 0.3;
      const path = [[-1.15, 1.35], [0.45, 1.35], [1.05, 0.75], [1.15, 0], [1.05, -0.75], [0.45, -1.35], [-1.15, -1.35]];
      p.push(wallPath(path, y0, y1, th, undefined, ln));
      const roof = [[-1.15, 1.07], [0.33, 1.07], [0.77, 0.63], [0.86, 0], [0.77, -0.63], [0.33, -1.07], [-1.15, -1.07]];
      p.push(slab(roof, y1 - 0.025, 0.05, () => [0.5, 0.5]));
    }
    return merge(p);
  };
  const gunGeo = buildGun();
  const gunAft = gunGeo.clone().rotateY(Math.PI);
  [
    ['Gun_A', GA.x, yA, gunGeo],
    ['Gun_B', GB.x, yB, gunGeo],
    ['Gun_X', GX.x, yX, gunAft],
    ['Gun_Y', GY.x, yY, gunAft],
  ].forEach(([n, x, y, g]) => {
    const gg = group(n, armsG, x, y, 0);
    mesh(g.clone(), M.grey, `${n}_Mount`, gg);
  });

  // Четырёхтрубный 21-дюймовый торпедный аппарат (начало — ось вращения на тумбе)
  {
    const tg = group('Torpedo_Tubes', armsG, TT.x, yTT, 0);
    const p = [];
    p.push(lathe([[1.2, 0], [1.2, 0.1], [1.05, 0.15], [0, 0.16]], 24));
    p.push(box(3.6, 0.35, 2.7, 0.2, 0.32, 0));
    [-1.02, -0.34, 0.34, 1.02].forEach((z) => {
      p.push(latheX([[0.0, -3.55], [0.3, -3.55], [0.36, -3.45], [0.36, -3.0], [0.31, -2.9], [0.31, 3.5], [0.35, 3.55], [0.35, 3.75], [0, 3.75]], 16).translate(0.3, 0.85, z));
    });
    // хомуты-бандажи
    [-1.6, 1.0, 2.6].forEach((x) => p.push(box(0.16, 0.75, 2.85, x, 0.85, 0)));
    // пост наводчика сзади
    p.push(box(0.8, 1.0, 0.9, -3.6, 1.0, 1.55));
    p.push(prism([[-0.5, 0], [0.5, 0], [0.45, 0.7], [-0.45, 0.7]], 0.04).rotateY(Math.PI / 2).translate(-3.15, 1.5, 1.55));
    p.push(box(0.5, 0.5, 1.4, -3.3, 0.55, 1.0));
    mesh(merge(p), M.grey, 'Torpedo_Tubes_Mount', tg);
  }

  // Счетверённый 2-фунтовый автомат «пом-пом» Mk VII (начало — центр погона на площадке)
  {
    const pg = group('Pom_Pom', armsG, PP.x, yPP, 0);
    const p = [];
    p.push(lathe([[1.0, 0], [1.0, 0.1], [0.85, 0.15], [0, 0.16]], 20));
    p.push(box(1.4, 0.75, 1.3, -0.1, 0.5, 0));
    [1, -1].forEach((sd) => p.push(prism([[-0.5, 0.15], [0.5, 0.15], [0.35, 1.55], [-0.3, 1.5]], 0.1).translate(0, 0, sd * 0.68)));
    const cr = [];
    cr.push(box(1.3, 0.75, 1.1, 0.0, 0, 0));
    [-0.21, 0.21].forEach((dy) =>
      [-0.22, 0.22].forEach((z) => {
        cr.push(latheX([[0.09, 0.4], [0.09, 1.3], [0.05, 1.35], [0.045, 2.3], [0.07, 2.35], [0.08, 2.6], [0, 2.6]], 10).translate(0, dy, z));
      }),
    );
    cr.push(box(0.6, 0.35, 1.0, -0.2, 0.55, 0)); // приёмники лент
    const cg = merge(cr);
    cg.rotateZ((8 * Math.PI) / 180);
    cg.translate(0.1, 1.2, 0);
    p.push(cg);
    // щит
    {
      const path = [[-0.2, 1.25], [0.75, 1.25], [1.1, 0.6], [1.1, -0.6], [0.75, -1.25], [-0.2, -1.25]];
      p.push(wallPath(path, 0.25, 1.35, 0.03));
    }
    // сиденья наводчиков
    [1, -1].forEach((sd) => p.push(box(0.35, 0.06, 0.3, -0.7, 0.7, sd * 1.0), rod([-0.4, 0.15, sd * 0.75], [-0.7, 0.67, sd * 1.0], 0.03, 6)));
    mesh(merge(p), M.grey, 'Pom_Pom_Mount', pg);
  }

  // ======================= РЛС 271 (фонарь, вращается вокруг вертикали)
  const sensG = group('Sensors', ship);
  {
    const rg = group('Radar_271', sensG, L271.x, L271.y, 0);
    const g = lathe([[1.0, 0], [1.0, 0.18], [0.92, 0.22], [0.92, 1.55], [1.02, 1.6], [1.0, 1.7], [0.45, 2.0], [0.12, 2.1], [0, 2.12]], 24, { bottom: false });
    wallUV(g, 1, 0.92, 0.65);
    mesh(g, M.paint, 'Radar_271_Lantern', rg);
  }

  // ======================= ВИНТЫ И РУЛЬ
  const propG = group('Propulsion', ship);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.3, r1: PROP.r, chord0: 0.6, chord1: 1.05, pitch: 4.2, skew: 0.12, tc: 0.12 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = latheX([[0.0, 0.45], [0.24, 0.34], [0.3, 0.06], [0.3, -0.3], [0.22, -0.42], [0.0, -0.85]], 16);
    const propR = merge([...bl, hub]);
    const propL = mirrorZ(propR);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Propeller_R' : 'Propeller_L', propG, PROP.x, PROP.y, sd * PROP.z);
      mesh(sd > 0 ? propR : propL, M.bronze, `${g.name}_Blades`, g);
      props[sd > 0 ? 'R' : 'L'] = g;
    });
    const rg = group('Rudder', propG, RUD.x, RUD.y0, 0);
    const h = RUD.y1 - RUD.y0;
    const f = foil({ root: [0.55, -1.75], tip: [0.45, -1.5], span: h, tc: 0.15, y0: 0, nSpan: 3 });
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
    find('Gun_B').rotation.y = -k * 0.6;
    find('Gun_X').rotation.y = k * 0.7;
    find('Gun_Y').rotation.y = -k * 0.9;
    find('Torpedo_Tubes').rotation.y = k * 1.3;
    find('Pom_Pom').rotation.y = k * 1.0;
    find('Radar_271').rotation.y = k * 1.2;
  };
  ship.userData.waterline = WL;
  return ship;
}
