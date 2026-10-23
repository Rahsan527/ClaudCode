import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Шлюп Королевского флота типа «Шорхэм» (Shoreham, Fowey, Bideford, Rochester, Falmouth, Milford, Weston,
// Dundee; 1930–1932), обобщённый облик ~1939 г., без бортового номера. Масштаб 1:1, метры.
// Оси: Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния — y = WL (осадка ~2,6 м).
// Длина 85,3 м, ширина 10,7 м. Полубак до миделя, два одиночных 4-дюймовых орудия со щитами (на баке
// и на кормовой платформе), мостик, одна наклонная труба, фок- и грот-мачты, шлюпки на шлюпбалках,
// бомбосбрасыватели и бомбомёты, тральная лебёдка и шлюпбалки трала в корме, прожектор, якоря в клюзах,
// два винта и один руль.
// Подвижные части — отдельные Group с нулевым поворотом в покое, начало — на оси движения.
// Материалы: атлас окраски (корпус, палубы, надстройки, труба: цвет JPEG + нормали PNG) и семь цветом.

export const WL = 2.6; // ватерлиния над килем
const XS = -42.15; // корма (номинальное сечение на уровне палубы)
const XF = 42.75; // форштевень на уровне палубы полубака
const XB = -2.0; // срез полубака
const BEAM = 5.35; // полуширина
const MID_A = -13.5;
const MID_F = 9.0;
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
  return 5.3 + 0.42 * smooth((MID_A - 4 - x) / (MID_A - 4 - XS)) ** 1.2 + 0.35 * smooth((x - MID_F) / (XF - MID_F));
}
export function fcDeckY(x) {
  return 7.7 + 1.0 * Math.max(0, (x - XB) / (XF - XB)) ** 2.3;
}
const yTopV = (x) => fcDeckY(x); // «виртуальный» верх борта: борт везде растёт до этой высоты

function sec(xn) {
  let W = BEAM, wd = BEAM, yk = 0, yw = 3.3, nb = 3.6, rake = 0, s = 0, flare = 1.6;
  if (xn > MID_F) {
    s = clamp01((xn - MID_F) / (XF - MID_F));
    W = BEAM * Math.max(0, 1 - s ** 2.1) ** 0.8;
    wd = BEAM * Math.max(0, 1 - s ** 2.7) ** 0.62;
    yk = 3.4 * s ** 4.2;
    yw = 3.3 + 1.5 * s * s;
    nb = 3.6 - 1.9 * s;
    rake = -0.5 * s * s;
    flare = 1.6 + 0.6 * s;
  } else if (xn < MID_A) {
    s = clamp01((MID_A - xn) / (MID_A - XS));
    W = BEAM * Math.max(0, 1 - s ** 2.4) ** 0.62;
    wd = BEAM * Math.max(0, 1 - s ** 3.4) ** 0.45;
    yk = 2.45 * s ** 2.4;
    yw = 3.3 + 0.8 * s * s;
    nb = 3.6 - 1.2 * s;
    rake = 0.5 * s * s;
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
      // растяжение только поперёк изгиба — упрощённо по всей окружности
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
function prism(poly, th) {
  const m = new Mesher();
  const pts = poly.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
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
function house(poly, y0, h, { band = 0, roof = true, u0 = 0.004, yBot = null } = {}) {
  const m = new Mesher();
  const n = poly.length;
  const yb = yBot ?? y0;
  let per = 0;
  const B = [], T = [];
  for (let i = 0; i <= n; i++) {
    const p = poly[i % n];
    if (i > 0) per += Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]);
    const u = u0 + per * KU_WALL;
    B.push(m.v(V3(p[0], yb, p[1]), u, V_WALL(band, yb - y0)));
    T.push(m.v(V3(p[0], y0 + h, p[1]), u, V_WALL(band, h)));
  }
  m.strip(B, T);
  if (roof) {
    const pts = poly.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const R = poly.map(([x, z]) => m.v(V3(x, y0 + h, z), U(x), V_DECK(z)));
    tris.forEach(([a, b, c]) => m.tri(R[a], R[b], R[c]));
  }
  const g = m.build({ orient: false });
  const cx = poly.reduce((s, p) => s + p[0], 0) / n, cz = poly.reduce((s, p) => s + p[1], 0) / n;
  return { g: orientOut(g, V3(cx, y0 + h * 0.5, cz)), per };
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
  const GREY = '#7d848a';

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
    C.fillStyle = '#4b2b25'; // необрастающая краска
    C.fillRect(i, yTopPx, 1, hullBot - yTopPx);
    const b0 = py(V_SIDE(f(WL + 0.32)));
    C.fillStyle = '#1e2022'; // ватерлинейная полоса
    C.fillRect(i, b0, 1, yTopPx - b0);
  }
  // пятна, потёки
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * S, y = rnd() * hullBot;
    const r = 6 + rnd() * 30;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.014)' : 'rgba(0,0,0,0.02)';
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
  for (let x = 4; x < 33; x += 1.55) {
    if (Math.abs(x - 16) < 0.8) continue;
    hullMark(x, mainDeckY(x) + 1.25, 0.34, 0.34, '#15181a', 'rgb(50,50,50)', ['rgba(170,175,178,0.9)', 2], 0.5);
  }
  for (let x = -33; x < -15; x += 1.6) hullMark(x, mainDeckY(x) - 1.0, 0.34, 0.34, '#15181a', 'rgb(50,50,50)', ['rgba(170,175,178,0.9)', 2], 0.5);
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
  [[-4, 3.25], [-6.5, 3.2], [1.0, 3.2]].forEach(([x, y]) => hullMark(x, y, 0.35, 0.25, '#202224', 'rgb(60,60,60)', null, 0.5));
  // клюзы: тёмная окантовка
  hullMark(HAWSE.x, HAWSE.y, 0.75, 0.75, '#2a2d30', 'rgb(110,110,110)', null, 0.5);

  // ---- ПАЛУБЫ (v 0.25…0.5)
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = '#5f6468';
  C.fillRect(0, d0, S, d1 - d0);
  for (let i = 0; i < 900; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)';
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
  C.fillStyle = '#80878d';
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
      C.fillStyle = '#6f767b';
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
  C.fillStyle = '#7f868c';
  C.fillRect(f0, py(0.25), f1 - f0, S - py(0.25));
  // сажа к верху
  {
    const g = C.createLinearGradient(0, py(V_FUN(FUN.h - 0.9)), 0, py(V_FUN(FUN.h - 3.0)));
    g.addColorStop(0, 'rgba(30,30,30,0.35)');
    g.addColorStop(1, 'rgba(30,30,30,0)');
    C.fillStyle = g;
    C.fillRect(f0, py(V_FUN(FUN.h - 0.9)), f1 - f0, py(V_FUN(FUN.h - 3.0)) - py(V_FUN(FUN.h - 0.9)));
  }
  C.fillStyle = '#16181a'; // чёрный колпак
  C.fillRect(f0, py(0.25), f1 - f0, py(V_FUN(FUN.h - 0.9)) - py(0.25));
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
const HAWSE = { x: 38.3, y: 7.75 };

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

export function createShoreham() {
  const ship = new THREE.Group();
  ship.name = 'Sloop_Shoreham_Class';
  const { map, normalMap } = paintAtlas();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    paint: std('Hull_Paint_Atlas', 0xffffff, 0.7, 0.12, { map, normalMap }),
    grey: std('Steel_Grey', 0x7a8187, 0.62, 0.25),
    dark: std('Steel_Dark', 0x2f3336, 0.6, 0.35),
    bottom: std('Antifouling_Red', 0x4b2b25, 0.75, 0.1),
    bronze: std('Propeller_Bronze', 0xa07a45, 0.32, 0.9),
    wire: std('Rigging_Wire', 0x26282a, 0.55, 0.6),
    canvas: std('Canvas_Cover', 0xb9b49e, 0.9, 0.0),
    boat: std('Boat_Paint', 0x9aa1a6, 0.55, 0.05),
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

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  const { hull, bulkhead } = buildHull();
  mesh(merge([hull, bulkhead, buildBulwark(33.0, 1.05)]), M.paint, 'Hull_Shell', hullG);

  // Подводные выступы: валы, кронштейны, мортиры, скуловые кили, брусковый киль (необрастающая краска)
  const PROP = { x: -35.5, y: 0.92, z: 2.5, r: 0.85 };
  const RUD = { x: -40.0, y0: 0.45, y1: 2.05 };
  {
    const parts = [];
    [1, -1].forEach((sd) => {
      const z = sd * PROP.z;
      // вал (от выхода из корпуса до ступицы) и мортира-обтекатель
      parts.push(rod([-23.5, PROP.y + 0.5, sd * 2.15], [PROP.x + 0.28, PROP.y, z], 0.12, 10));
      parts.push(rod([-23.0, PROP.y + 0.52, sd * 2.12], [-28.5, PROP.y + 0.34, sd * 2.29], 0.24, 10));
      // двуногий кронштейн у винта
      const xb = PROP.x + 0.95;
      const ru = sideAt(xb, 2.3);
      const zu = ru ? ru.z - 0.05 : 1.5;
      parts.push(latheX([[0.0, -0.32], [0.2, -0.22], [0.2, 0.25], [0.0, 0.38]], 12).translate(xb, PROP.y, z));
      const leg = (zz, yy) => {
        const g = prism([[-0.3, 0], [0.3, 0], [0.18, 1], [-0.18, 1]], 0.07);
        const a = V3(xb, PROP.y, z), b = V3(xb, yy, zz);
        const d = b.clone().sub(a);
        g.scale(1, d.length(), 1);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
        g.translate(a.x, a.y, a.z);
        return g;
      };
      void zu;
      parts.push(leg(sd * 2.2, 2.15));
      parts.push(leg(sd * 0.6, 1.5));
      // скуловой киль: клин от борта, основание внутри корпуса
      const bk = [];
      for (let i = 0; i <= 18; i++) {
        const x = lerp(-16, 12, i / 18);
        const c = sec(x);
        const q = QL * 0.62;
        const p = sideP(c, q);
        const pq = sideP(c, q + 0.01).sub(sideP(c, q - 0.01)).normalize();
        const out = V3(0, -pq.z, pq.y).multiplyScalar(-1);
        if (out.z < 0) out.negate();
        const taper = Math.sin((Math.PI * i) / 18) ** 0.4;
        const ring = [
          p.clone().addScaledVector(pq, 0.12).addScaledVector(out, -0.06),
          p.clone().addScaledVector(out, 0.42 * taper + 0.02),
          p.clone().addScaledVector(pq, -0.12).addScaledVector(out, -0.06),
        ];
        bk.push(ring.map((v) => V3(v.x, v.y, sd * v.z)));
      }
      parts.push(loftRings(bk, () => [0.5, 0.5]));
    });
    // дейдвуд (кормовой киль) перед рулём: низ чуть ниже обвода, верх внутри корпуса
    {
      const lo = [], hi = [];
      for (let i = 0; i <= 10; i++) {
        const x = lerp(-21, -38.4, i / 10);
        const yk = sec(x).yk;
        lo.push([x, yk - 0.32 * (i / 10) ** 1.5 - 0.02]);
        hi.push([x, yk + 0.5]);
      }
      parts.push(prism([...lo, ...hi.reverse()], 0.26));
    }
    mesh(merge(parts), M.bottom, 'Hull_Appendages', hullG);
  }

  // ======================= НАДСТРОЙКИ (атлас)
  const supG = group('Superstructure', ship);
  const BR = { x0: 11.6, x1: 18.6, hw: 3.3, h1: 2.4, wx0: 12.9, wx1: 17.6, whw: 2.5, h2: 2.3 };
  const yBr = fcY(15) - 0.0; // основание мостика
  const yPlat = yBr + BR.h1 + BR.h2; // палуба ходового мостика
  const FUNNEL = { x: 3.2, a: 1.55, b: 1.05, rake: Math.tan((9 * Math.PI) / 180) };
  const yFun0 = fcY(3) + 0.9 - 0.03;
  const SL = { x: 12.85, y: yPlat + 0.62 }; // прожектор на кормовой части ходового мостика
  {
    const parts = [];
    let u0 = 0.004;
    const addHouse = (poly, y0, h, opt = {}) => {
      const yb = opt.onDeck ? Math.min(...poly.map(([x, z]) => deckY(x, z))) - 0.03 : y0;
      const r = house(poly, y0, h, { ...opt, u0, yBot: opt.yBot ?? Math.min(yb, y0) });
      u0 = 0.004 + ((u0 - 0.004 + r.per * KU_WALL) % 0.6);
      parts.push(r.g);
    };
    // мостик: нижний ярус (на полубаке), рулевая рубка, площадка с фальшбортом
    addHouse(roundRect(BR.x0, BR.x1, -BR.hw, BR.hw, 0.6), yBr, BR.h1, { band: 0, onDeck: true });
    addHouse(roundRect(BR.wx0, BR.wx1, -BR.whw, BR.whw, 0.5), yBr + BR.h1, BR.h2 - 0.18, { band: 1, roof: false });
    // площадка: плита с крыльями
    const plat = roundRect(12.2, 18.5, -4.1, 4.1, 0.9, 4);
    addHouse(plat, yPlat - 0.18, 0.18, { band: 0, yBot: yPlat - 0.18 });
    // низ плиты
    {
      const mm = new Mesher();
      const pts = plat.map(([x, z]) => new THREE.Vector2(x, z));
      const tr = THREE.ShapeUtils.triangulateShape(pts, []);
      const R = plat.map(([x, z]) => mm.v(V3(x, yPlat - 0.18, z), U(x), V_DECK(z)));
      tr.forEach(([a, b, c]) => mm.tri(R[a], R[c], R[b]));
      parts.push(orientOut(mm.build({ orient: false }), V3(15, yPlat, 0)));
    }
    // фальшборт ходового мостика (с толщиной)
    const bl = roundRect(12.25, 18.45, -4.05, 4.05, 0.85, 4);
    parts.push(
      sweepPath(bl, [[0, yPlat - 0.01], [-0.03, yPlat + 1.1], [0.06, yPlat + 1.1], [0.06, yPlat - 0.01]], (per, pr) => [
        0.004 + per * KU_WALL,
        V_WALL(0, pr[1] - yPlat),
      ]),
    );
    // штурманская рубка / ветроотбойник на мостике (передняя часть)
    addHouse(roundRect(16.2, 17.6, -1.4, 1.4, 0.3), yPlat, 1.5, { band: 1 });
    // кожух машинного отделения и световой люк на главной палубе
    addHouse(roundRect(-13.5, -2.6, -1.9, 1.9, 0.4), mainDeckY(-8) + 0.12, 1.25, { band: 0, onDeck: true });
    addHouse(roundRect(-9.5, -6.0, -1.1, 1.1, 0.15), mainDeckY(-8) + 1.37, 0.5, { band: 0 });
    // кормовая рубка под платформой орудия
    addHouse(roundRect(-26.5, -18.0, -2.3, 2.3, 0.6), mainDeckY(-22) + 0.12, 2.1, { band: 0, onDeck: true });
    // рубка у трубы (вентиляционная шахта / котельный кожух)
    addHouse(roundRect(-0.6, 7.2, -1.9, 1.9, 0.5), fcY(3), 0.9, { band: 0, onDeck: true });

    // труба: наклонные кольца-овалы; кромка, внутренняя стенка, тёмное дно
    {
      const fm = new Mesher();
      const NS = 40;
      const ring = (y, sc) => {
        const pts = [];
        const cx = FUNNEL.x - (y - yFun0) * FUNNEL.rake;
        for (let j = 0; j <= NS; j++) {
          const a = (j / NS) * Math.PI * 2;
          const c = Math.cos(a), s = Math.sin(a);
          const ex = 2 / 2.6;
          pts.push(V3(cx + sc * FUNNEL.a * Math.sign(c) * Math.abs(c) ** ex * (c > 0 ? 0.92 : 1), y, sc * FUNNEL.b * Math.sign(s) * Math.abs(s) ** ex));
        }
        return pts;
      };
      const yTop = yFun0 + FUN.h;
      const levels = [
        [yFun0, 1, FUN.h * 0],
        [yFun0 + 2, 1, 2],
        [yFun0 + 4, 1, 4],
        [yTop - 0.9, 1, FUN.h - 0.9],
        [yTop, 1, FUN.h],
        [yTop + 0.02, 0.93, FUN.h],
        [yTop - 1.2, 0.93, FUN.h - 0.3],
      ];
      const ids = levels.map(([y, sc, h]) => ring(y, sc).map((p, j) => fm.v(p, FUN.u0 + (FUN.u1 - FUN.u0) * (j / NS), V_FUN(h))));
      for (let k = 0; k < ids.length - 1; k++) fm.strip(ids[k], ids[k + 1]);
      const cIn = ring(yTop - 1.2, 0)[0];
      const ci = fm.v(cIn, FUN.u0 + 0.1, V_FUN(FUN.h - 0.2));
      const lastR = ids[ids.length - 1];
      for (let j = 0; j < NS; j++) fm.tri(ci, lastR[j + 1], lastR[j]);
      const fg = fm.build({ orient: false });
      // ориентация по внешней стенке: нормаль первого треугольника наружу
      orientOut(fg, V3(FUNNEL.x - 2 * FUNNEL.rake, yFun0 + 2, 0));
      parts.push(fg);
    }
    mesh(merge(parts), M.paint, 'Superstructure_Main', supG);
  }

  // ======================= ПАЛУБНОЕ ОБОРУДОВАНИЕ (сталь)
  const deckG = group('Deck_Equipment', ship);
  const GF = { x: 26.6, h: 0.7 }; // носовое орудие
  const GA = { x: -22.3 }; // кормовое (на рубке)
  const yGA = mainDeckY(-22) + 0.12 + 2.1; // крыша кормовой рубки
  {
    const parts = [];
    const atDeck = (g, x, z = 0, dy = 0) => g.translate(x, deckY(x, z) + dy, z);
    // тумба носового орудия
    parts.push(atDeck(lathe([[0.75, -0.08], [0.75, 0.08], [0.55, 0.16], [0.5, GF.h - 0.1], [0.62, GF.h - 0.05], [0.62, GF.h], [0, GF.h + 0.005]], 24), GF.x));
    // тумба кормового орудия на крыше рубки
    parts.push(lathe([[0.6, -0.05], [0.6, 0.06], [0.45, 0.12], [0.42, 0.5], [0.55, 0.55], [0.55, 0.6], [0, 0.605]], 22).translate(GA.x, yGA, 0));
    // шпиль и кнехты, якорные цепи, клюзы на палубе
    parts.push(atDeck(lathe([[0.42, -0.08], [0.42, 0.1], [0.3, 0.15], [0.26, 0.45], [0.34, 0.5], [0.3, 0.58], [0, 0.62]], 20), 35.4));
    const bollard = () => {
      const p = () => lathe([[0.13, -0.08], [0.12, 0.34], [0.17, 0.38], [0.17, 0.42], [0, 0.44]], 12);
      return merge([p().translate(0.3, 0, 0), p().translate(-0.3, 0, 0), box(0.9, 0.12, 0.34, 0, -0.02, 0)]);
    };
    [
      [31.5, 0.62, 1],
      [21.5, 0.8, 1],
      [-6.0, 0.82, 0],
      [-30.5, 0.75, 0],
      [-37.8, 0.7, 0],
    ].forEach(([x, k]) => {
      [1, -1].forEach((sd) => {
        const yy = x >= XB ? fcDeckY(x) : mainDeckY(x);
        const z = sd * edgeZ(x, yy) * k;
        parts.push(atDeck(bollard(), x, z));
      });
    });
    // клюзовые трубы на палубе (палубные клюзы) и стопоры
    [1, -1].forEach((sd) => {
      const x = 37.6;
      const z = sd * 1.25;
      parts.push(atDeck(lathe([[0.32, -0.08], [0.3, 0.18], [0.22, 0.22], [0.22, 0.16], [0, 0.15]], 16), x, z));
      parts.push(atDeck(box(0.9, 0.3, 0.32, 0, 0.1, 0), 36.6, sd * 0.85));
      // ограждения клюзов на борту: кольца-окантовки
      const r = sideAt(HAWSE.x, HAWSE.y);
      const n = r.n.clone();
      n.z *= sd;
      const ring = new THREE.TorusGeometry(0.34, 0.07, 6, 16);
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
      const bell = latheX([[r * 1.0, 0], [r * 1.45, 0.22], [r * 1.25, 0.22], [r * 0.95, 0.05]], 12, { bottom: false, top: false }).translate(
        r * 1.2,
        h + r * 1.2,
        0,
      );
      const g = merge([stem, mouth, bell]);
      g.rotateY(yaw);
      return g;
    };
    [
      [8.2, 1.6, 1.6, 0.26, 0],
      [8.2, -1.6, 1.6, 0.26, 0],
      [-1.2, 2.5, 1.3, 0.22, Math.PI],
      [-1.2, -2.5, 1.3, 0.22, Math.PI],
      [-15.2, 1.3, 1.1, 0.2, 0],
      [-15.2, -1.3, 1.1, 0.2, 0],
      [9.5, 2.6, 1.0, 0.18, -Math.PI / 2],
      [9.5, -2.6, 1.0, 0.18, Math.PI / 2],
    ].forEach(([x, z, h, r, yaw]) => parts.push(atDeck(cowl(h, r, yaw), x, z)));
    // кормовые бомбосбрасыватели (рельсы глубинных бомб) — наклонные стеллажи у среза кормы
    const DC = { x0: -36.5, x1: -41.4 };
    [1, -1].forEach((sd) => {
      const z = sd * 1.35;
      [-0.32, 0.32].forEach((dz) => {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const x = lerp(DC.x0, DC.x1, i / 6);
          pts.push(V3(x, deckY(x, z + dz) + 0.62 - 0.12 * (i / 6), z + dz));
        }
        parts.push(tubePath(pts, 0.04, 6));
        [0, 0.5, 1].forEach((t) => {
          const x = lerp(DC.x0, DC.x1, t);
          parts.push(rod([x, deckY(x, z + dz) - 0.05, z + dz], [x, deckY(x, z + dz) + 0.6 - 0.12 * t, z + dz], 0.04, 6, 'top'));
        });
      });
    });
    // бомбомёты (по бортам) и тральная лебёдка
    [1, -1].forEach((sd) => {
      const x = -31.8;
      const z = sd * (edgeZ(x, mainDeckY(x)) - 1.0);
      const base = lathe([[0.32, -0.08], [0.3, 0.3], [0, 0.32]], 14);
      const barrel = rod([0, 0.25, 0], [0, 1.2, sd * 0.45], 0.17, 12);
      const cup = lathe([[0.26, 0], [0.26, 0.12], [0, 0.13]], 12, { bottom: true }).translate(0, 0, 0);
      cup.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(0, 0.95, sd * 0.45).normalize()));
      cup.translate(0, 1.2, sd * 0.45);
      parts.push(atDeck(merge([base, barrel, cup]), x, z));
      // стеллажи бомб у бомбомёта
      parts.push(atDeck(box(1.6, 0.06, 0.7, 0, 0.32, 0), x + 1.6, z));
      [-0.55, 0.55].forEach((dx) => parts.push(atDeck(rod([0, -0.05, 0], [0, 0.32, 0], 0.04, 6, 'top'), x + 1.6 + dx, z)));
    });
    // тральная лебёдка: барабан на станине
    {
      const x = -28.6;
      const y = mainDeckY(x) + CAMBER;
      [1, -1].forEach((sd) => parts.push(prism([[-0.55, -0.05], [0.55, -0.05], [0.4, 1.05], [-0.4, 1.05]], 0.12).translate(x, y, sd * 0.85)));
      parts.push(latheZ([[0.35, -0.79], [0.55, -0.79], [0.55, -0.7], [0.4, -0.68], [0.4, 0.68], [0.55, 0.7], [0.55, 0.79], [0.35, 0.79]], 18).translate(x, y + 0.75, 0));
      parts.push(box(1.0, 0.7, 0.8, x + 1.05, y + 0.3, 0)); // двигатель лебёдки
    }
    // шлюпбалки трала (П-образные кормовые стрелы) на раковинах
    [1, -1].forEach((sd) => {
      const x = -38.8;
      const ze = edgeZ(x, mainDeckY(x)) - 0.25;
      const y0 = deckY(x, ze) - 0.08;
      const pts = [V3(x, y0, sd * ze), V3(x, y0 + 2.7, sd * ze), V3(x - 0.5, y0 + 3.4, sd * (ze + 0.5)), V3(x - 0.9, y0 + 3.1, sd * (ze + 0.9))];
      parts.push(tubePath(pts, 0.1, 8));
      parts.push(rod([x + 1.2, deckY(x + 1.2, ze - 0.4) - 0.05, sd * (ze - 0.4)], [x, y0 + 2.5, sd * ze], 0.06, 6));
      // блок на ноке
      parts.push(new THREE.TorusGeometry(0.16, 0.05, 6, 12).translate(x - 0.95, y0 + 2.85, sd * (ze + 0.95)));
      // тралящие щиты-«отводители» (Oropesa) на палубе у кормовой рубки
      const float = latheX([[0, -1.1], [0.18, -0.85], [0.26, -0.3], [0.26, 0.5], [0.15, 0.95], [0, 1.1]], 12);
      parts.push(float.translate(-33.8, mainDeckY(-33.8) + 0.42, sd * 2.6));
      [-0.6, 0.6].forEach((dx) => parts.push(box(0.12, 0.3, 0.5, -33.8 + dx, mainDeckY(-33.8) + 0.12, sd * 2.6)));
      // отводитель (кайт) — рама у стрелы
      parts.push(box(0.9, 0.6, 0.08, -37.3, mainDeckY(-37.3) + 0.5, sd * (edgeZ(-37.3, mainDeckY(-37.3)) - 0.45)));
    });
    // трапы со среза полубака на главную палубу
    [1, -1].forEach((sd) => {
      const z = sd * 3.4;
      const top = V3(XB - 0.05, fcDeckY(XB) + 0.08, z), bot = V3(XB - 2.0, mainDeckY(XB - 2.0) + 0.1, z);
      [-0.32, 0.32].forEach((dz) => parts.push(rod([top.x, top.y, z + dz], [bot.x, bot.y, z + dz], 0.04, 6)));
      for (let i = 1; i < 8; i++) {
        const t = i / 8;
        const p = top.clone().lerp(bot, t);
        parts.push(box(0.18, 0.04, 0.64, p.x, p.y, z));
      }
    });
    // леерные стойки и леера (палуба полубака от среза до фальшборта, главная палуба вокруг кормы)
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
    // полубак: от среза до фальшборта
    [1, -1].forEach((sd) => {
      const pts = [];
      for (let x = XB + 0.15; x <= 33.0; x += 0.75) pts.push([x, sd * (edgeZ(x, fcDeckY(x)) - inset)]);
      rail(pts, (x, z) => deckY(x, z));
    });
    // поперёк среза полубака (между трапами)
    {
      const pts = [];
      for (let z = -edgeZ(XB, fcDeckY(XB)) + inset; z <= edgeZ(XB, fcDeckY(XB)) - inset + 1e-6; z += 0.5) pts.push([XB + 0.12, z]);
      const keep = pts.filter(([, z]) => Math.abs(Math.abs(z) - 3.4) > 0.5);
      // три отрезка: левый край — левый трап, между трапами, правый трап — край
      const segs = [[], [], []];
      keep.forEach(([x, z]) => segs[z < -3.4 ? 0 : z > 3.4 ? 2 : 1].push([x, z]));
      segs.forEach((s) => s.length > 1 && rail(s, (x, z) => deckY(x, z), 1.2));
    }
    // главная палуба: от среза полубака вдоль борта вокруг кормы
    {
      const pts = [];
      for (let x = XB - 0.15; x >= XS + 2.5; x -= 0.75) pts.push([x, edgeZ(x, mainDeckY(x)) - inset]);
      // скругление кормы по полуокружности
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
    // поручни площадки кормового орудия
    {
      const pts = [];
      const poly = roundRect(-26.4, -18.1, -2.2, 2.2, 0.55, 4);
      poly.forEach((p) => pts.push(p));
      pts.push(poly[0]);
      rail(pts, () => yGA, 1.5);
    }
    // шлюпбалки (по две на борт)
    const BOAT = { x: -8.3, L: 7.4, B: 1.95, D: 0.85, z: 4.25 };
    BOAT.y = mainDeckY(BOAT.x) + 2.15;
    [1, -1].forEach((sd) => {
      [BOAT.x - 2.9, BOAT.x + 2.9].forEach((x) => {
        const ze = edgeZ(x, mainDeckY(x)) - 0.25;
        const y0 = deckY(x, ze) - 0.08;
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          const a = (t * Math.PI) / 2;
          if (t < 0.45) pts.push(V3(x, y0 + 3.4 * (t / 0.45) * 0.78, sd * ze));
          else {
            const tt = (t - 0.45) / 0.55;
            const ang = (tt * Math.PI) / 2;
            pts.push(V3(x, y0 + 2.65 + 0.8 * Math.sin(ang), sd * (ze - 0.85 * (1 - Math.cos(ang)) + 0.0)));
          }
          void a;
        }
        parts.push(tubePath(pts, 0.085, 8));
        // блок и тали
        const tip = pts[pts.length - 1];
        parts.push(rod([tip.x, tip.y - 0.05, tip.z], [tip.x, BOAT.y + BOAT.D * 0.5, tip.z], 0.03, 5));
      });
    });
    // кнехт-стопоры, кранцы, ящики
    [
      [-16.8, 3.3],
      [-16.8, -3.3],
      [-28.6, 3.4],
    ].forEach(([x, z]) => parts.push(atDeck(box(1.1, 0.7, 0.6, 0, 0.3, 0), x, z)));
    // пост наблюдения, нактоуз и дальномер на мостике
    parts.push(lathe([[0.2, -0.05], [0.14, 0.95], [0.22, 1.05], [0, 1.25]], 14).translate(15.4, yPlat, 0));
    parts.push(lathe([[0.18, -0.05], [0.15, 0.85], [0.2, 0.9], [0, 0.95]], 12).translate(14.2, yPlat, 0));
    parts.push(latheZ([[0.11, -1.1], [0.11, 1.1]], 10).translate(14.2, yPlat + 1.08, 0));
    [-1.1, 1.1].forEach((z) => parts.push(latheZ([[0.16, -0.12], [0.16, 0.12]], 10).translate(14.2, yPlat + 1.08, z)));
    // ходовые огни на крыльях мостика
    [1, -1].forEach((sd) => parts.push(box(0.4, 0.45, 0.25, 16.8, yPlat + 0.7, sd * 4.18)));
    // тумба прожектора
    parts.push(lathe([[0.32, -0.05], [0.22, 0.25], [0.18, 0.55], [0.26, 0.6], [0, 0.62]], 14).translate(SL.x, SL.y - 0.62, 0));
    // площадка-кольцо на трубе (свисток)
    parts.push(rod([FUNNEL.x - 5 * FUNNEL.rake + 1.4, yFun0 + 5, 0], [FUNNEL.x - 5.6 * FUNNEL.rake + 1.4, yFun0 + 5.6, 0], 0.07, 8));
    // паропровод сирены по передней кромке трубы
    parts.push(
      tubePath(
        [V3(FUNNEL.x + FUNNEL.a * 0.92 + 0.05, yFun0 + 0.2, 0.35), V3(FUNNEL.x + FUNNEL.a * 0.92 + 0.05 - 6.4 * FUNNEL.rake, yFun0 + 6.6, 0.35), V3(FUNNEL.x + FUNNEL.a * 0.92 - 6.6 * FUNNEL.rake, yFun0 + 7.1, 0.35)],
        0.06,
        6,
      ),
    );
    mesh(merge(parts), M.grey, 'Deck_Fittings', deckG);

    // Тёмная сталь: якоря, цепи, глубинные бомбы, колпак сирены
    const dk = [];
    [1, -1].forEach((sd) => {
      // якорь Холла в клюзе
      const r = sideAt(HAWSE.x - 0.1, HAWSE.y - 0.75);
      const shank = box(0.16, 1.2, 0.14, 0, 0.2, 0);
      const crown = box(0.32, 0.25, 0.3, 0, -0.45, 0);
      const fl = (sx) => prism([[0, 0], [0.42, 0.1], [0.52, 0.55], [0.3, 0.35], [0, 0.22]].map(([a, b]) => [sx * a, b - 0.55]), 0.18);
      const anc = merge([shank, crown, fl(1), fl(-1)]);
      const n = r.n.clone();
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n);
      anc.applyQuaternion(q);
      anc.translate(HAWSE.x - 0.1, HAWSE.y - 0.95, r.z + 0.1);
      dk.push(sd > 0 ? anc : mirrorZ(anc));
      // цепь от шпиля к палубному клюзу (звенья — плоские кольца, упрощённо — цилиндр)
      const pts = [];
      const z0 = sd * 0.3, z1 = sd * 1.25;
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = lerp(35.4, 37.6, t);
        const z = lerp(z0, z1, t);
        pts.push(V3(x, deckY(x, z) + 0.06, z));
      }
      dk.push(tubePath(pts, 0.06, 6));
    });
    // глубинные бомбы на рельсах
    [1, -1].forEach((sd) => {
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.4) / 5.5;
        const x = lerp(-36.5, -41.4, t);
        const z = sd * 1.35;
        dk.push(latheZ([[0.24, -0.33], [0.26, -0.3], [0.26, 0.3], [0.24, 0.33]], 14).translate(x, deckY(x, z) + 0.62 - 0.12 * t + 0.27, z));
      }
      // бомбы у бомбомётов
      [0, 1].forEach((j) => dk.push(latheZ([[0.24, -0.33], [0.26, -0.3], [0.26, 0.3], [0.24, 0.33]], 14).translate(-31.8 + 1.25 + j * 0.7, mainDeckY(-31) + 0.62, sd * (edgeZ(-31.8, mainDeckY(-31.8)) - 1.0))));
    });
    mesh(merge(dk), M.dark, 'Deck_Fittings_Dark', deckG);

    // ======================= ШЛЮПКИ (корпус + брезент)
    // корпус шлюпки (открыт сверху) и брезентовый чехол над планширем — общая кромка, без внутренних граней
    const boatParts = () => {
      const hm = new Mesher(), cm = new Mesher();
      const N = 16, MH = 10, MC = 8;
      const H = [], Cv = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = (t - 0.5) * BOAT.L;
        const w = (BOAT.B / 2) * Math.max(0.02, Math.sin(Math.PI * t) ** 0.5);
        const d = BOAT.D * (0.7 + 0.3 * Math.sin(Math.PI * t));
        const gw = 0.1 * (2 * Math.abs(t - 0.5)) ** 2; // седловатость планширя
        const hc = 0.3 * Math.sin(Math.PI * t) ** 0.7;
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
      mesh(hg.translate(BOAT.x, BOAT.y, sd * BOAT.z), M.boat, `Boat_Hull_${tag}`, boatsG);
      mesh(cg.translate(BOAT.x, BOAT.y, sd * BOAT.z), M.canvas, `Boat_Cover_${tag}`, boatsG);
    });
  }

  // ======================= МАЧТЫ И ТАКЕЛАЖ
  const mastG = group('Masts', ship);
  const FM = { x: 10.6, top: 26.2 };
  const MM = { x: -15.6, top: 21.5 };
  {
    const parts = [];
    const yF0 = fcY(FM.x) - 0.05;
    const yM0 = mainDeckY(MM.x) + CAMBER - 0.05;
    parts.push(lathe([[0.24, yF0], [0.22, 17.0], [0.17, 21.5], [0.1, FM.top - 0.1], [0.06, FM.top], [0, FM.top + 0.02]], 12).translate(FM.x, 0, 0));
    parts.push(lathe([[0.22, yM0], [0.2, 14.5], [0.13, 18.5], [0.08, MM.top - 0.1], [0.05, MM.top], [0, MM.top + 0.02]], 12).translate(MM.x, 0, 0));
    // марсовая площадка (воронье гнездо) на фок-мачте
    parts.push(lathe([[0.2, 16.9], [0.62, 17.0], [0.68, 17.15], [0.68, 18.1], [0.62, 18.1], [0.62, 17.25], [0.2, 17.25]], 18, { top: false }).translate(FM.x, 0, 0));
    // реи
    parts.push(latheZ([[0.07, -3.2], [0.09, 0], [0.07, 3.2]], 8).translate(FM.x, 19.5, 0));
    parts.push(latheZ([[0.06, -2.4], [0.08, 0], [0.06, 2.4]], 8).translate(MM.x, 17.3, 0));
    // гафель на грот-мачте
    parts.push(rod([MM.x, 15.0, 0], [MM.x - 3.0, 16.4, 0], 0.06, 8));
    // салинги (распорки антенн) на топах
    parts.push(latheZ([[0.05, -1.4], [0.05, 1.4]], 6).translate(FM.x, 24.5, 0));
    parts.push(latheZ([[0.05, -1.2], [0.05, 1.2]], 6).translate(MM.x, 20.5, 0));
    mesh(merge(parts), M.grey, 'Mast_Spars', mastG);

    const w = [];
    const r = 0.018;
    const fs = (x, z) => [x, fcY(x, z) + 0.05, z];
    const ms = (x, z) => [x, mainDeckY(x) + 0.05 + CAMBER * 0.2, z];
    // штаги и ванты
    w.push(rod([FM.x, 21.0, 0], fs(40.6, 0), r, 4));
    [1, -1].forEach((sd) => {
      w.push(rod([FM.x, 20.0, sd * 0.15], fs(FM.x - 2.4, sd * (edgeZ(FM.x - 2.4, fcDeckY(FM.x - 2.4)) - 0.2)), r, 4));
      w.push(rod([FM.x, 20.0, sd * 0.15], fs(FM.x - 4.4, sd * (edgeZ(FM.x - 4.4, fcDeckY(FM.x - 4.4)) - 0.2)), r, 4));
      w.push(rod([MM.x, 16.0, sd * 0.15], ms(MM.x - 2.2, sd * (edgeZ(MM.x - 2.2, mainDeckY(MM.x - 2.2)) - 0.2)), r, 4));
      w.push(rod([MM.x, 16.0, sd * 0.15], ms(MM.x - 4.4, sd * (edgeZ(MM.x - 4.4, mainDeckY(MM.x - 4.4)) - 0.2)), r, 4));
      // антенны между салингами
      w.push(rod([FM.x, 24.5, sd * 1.35], [MM.x, 20.5, sd * 1.15], 0.012, 4));
      // фалы реев
      w.push(rod([FM.x, 19.5, sd * 3.1], [FM.x, 23.0, sd * 0.05], 0.01, 3));
    });
    w.push(rod([FM.x, 23.5, 0], [MM.x, 19.8, 0], r, 4)); // триатик-штаг
    w.push(rod([MM.x, 18.2, 0], ms(-35.5, 0), r, 4)); // ахтерштаг
    // вводы антенн к рубке
    w.push(rod([lerp(FM.x, MM.x, 0.35), lerp(24.5, 20.5, 0.35), 1.3], [0, fcY(0) + 0.95, 1.55], 0.012, 3));
    mesh(merge(w), M.wire, 'Rigging', mastG);
  }

  // ======================= ВООРУЖЕНИЕ
  const armsG = group('Armament', ship);
  const buildGun = () => {
    const p = [];
    const ty = 0.95; // ось цапф над тумбой
    p.push(lathe([[0.62, 0], [0.62, 0.08], [0.55, 0.12], [0, 0.13]], 24));
    // станок: щёки
    [1, -1].forEach((sd) => {
      p.push(prism([[-0.5, 0.1], [0.5, 0.1], [0.32, ty + 0.18], [-0.12, ty + 0.2], [-0.42, ty]], 0.07).translate(0, 0, sd * 0.3));
      p.push(new THREE.TorusGeometry(0.17, 0.025, 6, 14).translate(-0.15, ty - 0.2, sd * 0.48)); // маховики наводки
      p.push(rod([-0.15, ty - 0.2, sd * 0.34], [-0.15, ty - 0.2, sd * 0.48], 0.025, 6));
      p.push(box(0.32, 0.06, 0.28, -0.7, 0.55, sd * 0.62)); // сиденья наводчиков
      p.push(rod([-0.4, 0.15, sd * 0.32], [-0.7, 0.52, sd * 0.62], 0.03, 6));
    });
    p.push(rod([0, ty, -0.34], [0, ty, 0.34], 0.08, 12));
    // люлька, накатник, ствол (небольшое возвышение запечено)
    const barrel = [];
    barrel.push(box(1.9, 0.36, 0.42, 0.3, 0, 0));
    barrel.push(rod([-0.7, 0.27, 0], [1.25, 0.27, 0], 0.09, 12));
    barrel.push(latheX([[0.16, -1.05], [0.16, -0.65], [0.13, -0.55], [0.12, 0.6], [0.09, 3.3], [0.075, 4.45], [0.09, 4.5], [0.09, 4.6], [0.05, 4.6], [0.05, 4.4], [0, 4.4]], 18));
    barrel.push(box(0.42, 0.38, 0.38, -1.2, 0, 0)); // затвор
    barrel.push(box(0.1, 0.24, 0.05, -1.2, 0.27, -0.22));
    barrel.push(rod([0.35, 0.2, -0.38], [-0.4, 0.2, -0.38], 0.045, 8)); // прицел
    barrel.push(box(0.14, 0.2, 0.08, -0.6, 0.2, -0.38));
    const bg = merge(barrel);
    bg.rotateZ((4 * Math.PI) / 180);
    bg.translate(0, ty, 0);
    p.push(bg);
    // щит: изогнутый лист с толщиной, скос сверху, боковые щёки
    {
      const sh = new Mesher();
      const R = 1.55;
      const cxs = -0.75; // центр кривизны (позади)
      const yb = 0.25, yt = 2.0;
      const NA = 14;
      const a0 = -0.95, a1 = 0.95;
      const rowsO = [], rowsI = [];
      for (const [y, kk] of [
        [yb, 0],
        [yt - 0.35, 1],
        [yt, 2],
      ]) {
        const ro = [], ri = [];
        for (let i = 0; i <= NA; i++) {
          const a = a0 + ((a1 - a0) * i) / NA;
          const rr = R - (kk === 2 ? 0.35 : 0);
          const yy = y;
          ro.push(sh.v(V3(cxs + (rr + 0.015) * Math.cos(a), yy, (rr + 0.015) * Math.sin(a)), i / NA, kk / 2));
          ri.push(sh.v(V3(cxs + (rr - 0.015) * Math.cos(a), yy, (rr - 0.015) * Math.sin(a)), i / NA, kk / 2));
        }
        rowsO.push(ro);
        rowsI.push(ri);
      }
      for (let k = 0; k < 2; k++) {
        sh.strip(rowsO[k], rowsO[k + 1]);
        sh.strip(rowsI[k + 1], rowsI[k]);
      }
      sh.strip(rowsI[0], rowsO[0]);
      sh.strip(rowsO[2], rowsI[2]);
      [0, NA].forEach((e) => {
        for (let k = 0; k < 2; k++) {
          if (e === 0) sh.quad(rowsI[k][e], rowsI[k + 1][e], rowsO[k + 1][e], rowsO[k][e]);
          else sh.quad(rowsO[k][e], rowsO[k + 1][e], rowsI[k + 1][e], rowsI[k][e]);
        }
      });
      p.push(orientOut(sh.build({ orient: false }), V3(cxs + R, 1.0, 0)));
    }
    return merge(p);
  };
  const gunGeo = buildGun();
  const yGF = deckY(GF.x) + GF.h;
  const gF = group('Gun_Fore', armsG, GF.x, yGF, 0);
  mesh(gunGeo.clone(), M.grey, 'Gun_Fore_Mount', gF);
  const gA = group('Gun_Aft', armsG, GA.x, yGA + 0.605, 0);
  const gAGeo = gunGeo.clone();
  gAGeo.rotateY(Math.PI); // ствол в корму, поворот запечён в сетку
  mesh(gAGeo, M.grey, 'Gun_Aft_Mount', gA);

  // ======================= ПРОЖЕКТОР (поворот вокруг вертикали)
  const slG = group('Searchlight', armsG, SL.x, SL.y, 0);
  {
    const p = [];
    p.push(lathe([[0.28, 0], [0.28, 0.06], [0, 0.07]], 14));
    [1, -1].forEach((sd) => p.push(box(0.06, 0.6, 0.12, 0, 0.35, sd * 0.42)));
    p.push(latheX([[0.0, -0.45], [0.2, -0.42], [0.36, -0.3], [0.36, 0.35], [0.4, 0.38], [0.4, 0.44], [0.33, 0.44], [0.33, 0.4], [0, 0.4]], 18).translate(0, 0.62, 0));
    p.push(lathe([[0.08, 0], [0.08, 0.1], [0.12, 0.1], [0, 0.16]], 8).translate(-0.1, 0.98, 0));
    mesh(merge(p), M.grey, 'Searchlight_Lamp', slG);
  }

  // ======================= ВИНТЫ И РУЛЬ
  const propG = group('Propulsion', ship);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.2, r1: PROP.r, chord0: 0.42, chord1: 0.72, pitch: 2.0, skew: 0.1, tc: 0.12 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = latheX([[0.0, 0.32], [0.17, 0.24], [0.21, 0.05], [0.21, -0.22], [0.16, -0.3], [0.0, -0.62]], 16);
    const propR = merge([...bl, hub]);
    const propL = mirrorZ(propR);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Propeller_R' : 'Propeller_L', propG, PROP.x, PROP.y, sd * PROP.z);
      mesh(sd > 0 ? propR : propL, M.bronze, `${g.name}_Blades`, g);
      props[sd > 0 ? 'R' : 'L'] = g;
    });
    // руль: балансирный, баллер по Y
    const rg = group('Rudder', propG, RUD.x, RUD.y0, 0);
    const h = RUD.y1 - RUD.y0;
    const f = foil({ root: [0.55, -1.45], tip: [0.45, -1.35], span: h, tc: 0.15, y0: 0, nSpan: 3 });
    const stock = lathe([[0.09, h - 0.05], [0.09, h + 0.85], [0, h + 0.86]], 10);
    mesh(merge([f, stock]), M.bottom, 'Rudder_Blade', rg);
  }

  // Анимация: винты вращаются навстречу друг другу (правый — по часовой, если смотреть с кормы), 1 об/с, 9 ключей
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
    find('Gun_Fore').rotation.y = k * 0.8;
    find('Gun_Aft').rotation.y = -k * 0.9;
    find('Searchlight').rotation.y = k * 1.2;
  };
  ship.userData.waterline = WL;
  return ship;
}
