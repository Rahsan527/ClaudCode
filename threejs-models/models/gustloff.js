import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Круизный лайнер «Вильгельм Густлофф» (Wilhelm Gustloff, 1937), организация «Сила через радость» (KdF),
// мирная окраска 1938–1939 гг. Масштаб 1:1, метры. Оси: Y вверх, нос +X, правый борт +Z.
// Киль на y = 0, ватерлиния — y = WL (осадка 6,5 м). Длина 208,5 м, ширина 23,6 м.
// Однокласcный лайнер: длинная низкая надстройка уступами, закрытая прогулочная палуба с большими окнами
// заподлицо с бортом, шлюпочная палуба с 22 шлюпками на гравитационных шлюпбалках, солнечная палуба,
// мостик с крыльями впереди трубы, одна широкая овальная труба, две мачты с грузовыми стрелами,
// трюмные люки в носу и в корме, крейсерская корма, два четырёхлопастных винта, один руль.
// Окна, иллюминаторы, леера, название — в текстурах (атлас борта, плиточные текстуры стен, палубы, лееров).
// Подвижные части — отдельные Group с нулевым поворотом в покое, начало — на оси движения.

export const WL = 6.5; // ватерлиния над килем
const XS = -104.25; // корма (кромка палубы)
const XF = 104.25; // форштевень (кромка палубы)
const BEAM = 11.8; // полуширина
const MID_A = -38;
const MID_F = 22;
const Y_SPLIT = 6.0; // граница необрастающей краски (атлас борта — выше)
const Y_TOP = 18.7; // верх атласа борта

// Надстройка: ярусы
const T1 = { x0: -64, x1: 52, top: 17.8 }; // закрытая прогулочная палуба, заподлицо с бортом
const T2 = { x0: -58, x1: 46, hw: 9.0, top: 20.6, rA: 2.0, rF: 4.5 }; // крыша — шлюпочная палуба
const T3 = { x0: -44, x1: 39, hw: 6.0, top: 23.4, rA: 1.5, rF: 3.0 }; // крыша — солнечная палуба
const T4 = { x0: 30, x1: 38.5, hw: 5.6, top: 26.2, rA: 0.8, rF: 2.5 }; // ходовая рубка
const FUN = { x: -6, a: 7.0, b: 4.2, h: 12.5, rake: Math.tan((5 * Math.PI) / 180), cap: 1.5 };

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА

export function deckY(x) {
  return 15.0 + 3.3 * smooth((x - 35) / (XF - 35)) ** 1.6 + 1.1 * smooth((-60 - x) / (-60 - XS)) ** 1.4;
}

function sec(xn) {
  let W = BEAM, wd = BEAM, yk = 0, yw = 5.5, nb = 6, rake = 0, s = 0, flare = 1;
  if (xn > MID_F) {
    s = clamp01((xn - MID_F) / (XF - MID_F));
    W = BEAM * Math.max(0, 1 - s ** 1.7) ** 0.85;
    wd = BEAM * Math.max(0, 1 - s ** 2.2) ** 0.6;
    yk = 5.0 * s ** 5;
    yw = 5.5 + 4.0 * s * s;
    nb = 6 - 4.0 * s;
    rake = -0.5 * s ** 2;
    flare = 1 + 0.8 * s;
  } else if (xn < MID_A) {
    s = clamp01((MID_A - xn) / (MID_A - XS));
    W = BEAM * Math.max(0, 1 - s ** 1.25) ** 1.05;
    // план кормы: эллиптическое скругление (крейсерская корма)
    const d = xn - XS;
    const LE = 9.0, WE = 8.6;
    wd = d < LE ? WE * Math.sqrt(Math.max(0, 1 - (1 - d / LE) ** 2)) : lerp(WE, BEAM, smooth((d - LE) / (MID_A - XS - LE)) ** 0.8);
    yk = 5.0 * s ** 1.6;
    yw = 5.5 + 0.8 * s;
    nb = 6 - 3.0 * s;
    rake = 0.45 * s ** 2.5;
    flare = 1 - 0.75 * smooth((s - 0.15) / 0.6);
  }
  if (s >= 1) {
    W = 0;
    wd = 0;
  }
  const yd = deckY(xn);
  return { xn, s, W, wd, yk, yw, nb, rake, flare, yd };
}

const QL = 0.6;
function sideYZ(c, q) {
  if (q <= QL) {
    const th = -Math.PI / 2 + (q / QL) * (Math.PI / 2);
    const e = 2 / c.nb;
    return [c.yw - (c.yw - c.yk) * Math.abs(Math.sin(th)) ** e, c.W * Math.abs(Math.cos(th)) ** e];
  }
  const t = (q - QL) / (1 - QL);
  return [c.yw + (c.yd - c.yw) * t, c.W + (c.wd - c.W) * t ** c.flare];
}
const qOfY = (c, y) => {
  if (y >= c.yw) return QL + ((1 - QL) * (y - c.yw)) / (c.yd - c.yw);
  let lo = 0, hi = QL;
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (sideYZ(c, m)[0] < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};
const xAt = (c, y) => c.xn + c.rake * (c.yd - y);
function sideP(c, q) {
  const [y, z] = sideYZ(c, q);
  return V3(xAt(c, y), y, z);
}
export const edgeZ = (x) => sec(x).wd; // полуширина по кромке палубы
// высота днища в точке (x, z) (по номинальной абсциссе)
function hullYAtZ(x, z) {
  const c = sec(x);
  let lo = 0, hi = 1;
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (sideYZ(c, m)[1] < z) lo = m;
    else hi = m;
  }
  return sideYZ(c, (lo + hi) / 2)[0];
}
const hullZAtY = (x, y) => {
  const c = sec(x);
  return sideYZ(c, qOfY(c, y))[1];
};
// номинальная абсцисса шпангоута, проходящего через фактическую точку (x, y)
function xnFor(x, y) {
  const f = (xn) => xAt(sec(xn), y);
  let lo = XS, hi = XF;
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < x) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
// фактическая полуширина корпуса в точке (x, y); 0 — ниже киля
function zAtXY(x, y) {
  const c = sec(xnFor(x, y));
  if (y < c.yk) return 0;
  return sideYZ(c, qOfY(c, Math.min(y, c.yd)))[1];
}
// высота обшивки над точкой (x, z)
function yAtXZ(x, z) {
  let lo = 0, hi = deckY(x);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (zAtXY(x, m) < z) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
const keelYAt = (x) => yAtXZ(x, 0.02);

// Точка борта на высоте y в абсциссе x (с учётом наклона штевней) и нормаль
function sideAt(x, y) {
  const f = (xn) => xAt(sec(xn), y);
  let lo = XS, hi = XF;
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < x) lo = m;
    else hi = m;
  }
  const c = sec((lo + hi) / 2);
  const q = qOfY(c, y);
  const p0 = sideP(c, q);
  const pq = sideP(c, Math.min(1, q + 0.004)).sub(sideP(c, Math.max(0, q - 0.004)));
  const px = sideP(sec(c.xn + 0.02), q).sub(p0);
  const n = new THREE.Vector3().crossVectors(px, pq).normalize();
  if (n.z < 0) n.negate();
  return { z: p0.z, n };
}

// Шпангоуты: сгущение к оконечностям + обязательные сечения (границы надстройки и полос атласа)
const STRIPS = [XS, T1.x0, -6, T1.x1, XF];
const stationXs = (() => {
  let xs = [];
  const N = 190;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 0.45 * t + 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    xs.push(XS + (XF - XS) * u);
  }
  const forced = [T1.x0, -6, T1.x1];
  xs = xs.filter((x) => forced.every((f) => Math.abs(x - f) > 0.35));
  xs.push(...forced);
  xs.sort((a, b) => a - b);
  return xs;
})();

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
      if (b.sub(a).cross(c.sub(a)).length() > 1e-6) keep.push(i0, i1, i2);
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

// Стержень между двумя точками; caps: 'both' | 'top' (низ в поверхности) | 'none'
function rod(a, b, r, seg = 6, caps = 'both', r2 = null) {
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  let g;
  if (caps === 'both') g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg, 1, false);
  else g = lathe([[r, -len / 2], [r2 ?? r, len / 2]], seg, { top: caps === 'top' });
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
const box = (sx, sy, sz, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
// Ящик без выбранных граней: skip — строка из 'px','nx','py','ny','pz','nz'
function boxSkip(sx, sy, sz, x, y, z, skip = 'ny') {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const idx = [];
  const src = g.index.array;
  g.groups.forEach((gr, i) => {
    if (skip.includes(order[i])) return;
    for (let k = gr.start; k < gr.start + gr.count; k++) idx.push(src[k]);
  });
  g.setIndex(idx);
  g.clearGroups();
  return g.translate(x, y, z);
}

// Трубка вдоль ломаной с крышками на концах
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
  for (let i = 0; i < n; i++) {
    if (i > 0) nrm = nrm.sub(T[i].clone().multiplyScalar(nrm.dot(T[i]))).normalize();
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
      ring.push(m.v(P[i].clone().addScaledVector(off, Math.min(k, 1.25)), j / seg, i / Math.max(1, n - 1)));
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
  let pts = poly.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const front = pts.map((p) => m.v(V3(p.x, p.y, th / 2)));
  const back = pts.map((p) => m.v(V3(p.x, p.y, -th / 2)));
  tris.forEach(([a, b, c]) => {
    m.tri(front[a], front[b], front[c]);
    m.tri(back[a], back[c], back[b]);
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = m.v(V3(pts[i].x, pts[i].y, th / 2));
    const b = m.v(V3(pts[j].x, pts[j].y, th / 2));
    const c = m.v(V3(pts[j].x, pts[j].y, -th / 2));
    const d = m.v(V3(pts[i].x, pts[i].y, -th / 2));
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
      const h = sign * Math.max(0.01, naca(t) * tc * ch * (1 - 0.6 * s));
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
    for (const t of ts) ring.push(V3(le - t * ch, y, Math.max(0.01, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(V3(le - ts[j] * ch, y, -Math.max(0.01, naca(ts[j]) * tc * ch)));
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
  const uv = out.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, clamp01(uv.getX(i)), clamp01(uv.getY(i)));
  return out;
}
const merge = (list) => mergeVertices(mergeGeometries(list.map(clean)), 1e-5);

// Скруглённый прямоугольник в плане с разными радиусами кормовых (rA) и носовых (rF) углов
function roundRect2(x0, x1, hw, rA, rF, seg = 5) {
  const pts = [];
  const corners = [
    [x1 - rF, hw - rF, 0, rF],
    [x0 + rA, hw - rA, Math.PI / 2, rA],
    [x0 + rA, -hw + rA, Math.PI, rA],
    [x1 - rF, -hw + rF, (3 * Math.PI) / 2, rF],
  ];
  corners.forEach(([cx, cz, a0, r]) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  });
  return pts;
}
const v2 = (q) => q.map(([x, z]) => new THREE.Vector2(x, z));
const ccw = (q) => (THREE.ShapeUtils.isClockWise(v2(q)) ? [...q].reverse() : q);

// ---------------------------------------------------------------------------
// UV-РАЗМЕТКА

// Атлас борта: 8 полос по 256 px (0–3 — правый борт, 4–7 — левый), каждая — свой участок длины
const STRIP_V = (j, y) => (j + 0.012 + 0.976 * clamp01((y - Y_SPLIT) / (Y_TOP - Y_SPLIT))) / 8;
const STRIP_U = (k, x) => 0.003 + (0.994 * (x - STRIPS[k])) / (STRIPS[k + 1] - STRIPS[k]);
// Палуба (дерево, плитка 8×8 м)
const DECK_LEN = XF - XS + 1;
const DECK_REP = [DECK_LEN / 8, 24 / 8];
const UD = (x) => clamp01((x - XS + 0.5) / DECK_LEN);
const VD = (z) => clamp01((z + 12) / 24);
// Стены надстроек (плитка 16 м по длине, 4 полосы по высоте яруса 2,8 м)
const WALL_TILE = 16;
const WALL_REP = 24; // u 0…1 = 384 м периметра
const WALL_H = 2.8;
const UW = (per) => clamp01(per / (WALL_TILE * WALL_REP));
const VW = (band, h) => band / 4 + 0.004 + 0.242 * clamp01(h / WALL_H);
// Леера (плитка 2 м)
const RAIL_TILE = 2;
const RAIL_REP = 160;
const RAIL_H = 1.05;

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function heightToNormal(hgt, W, H, k = 2.0 / 255, wrapX = false) {
  const hd = hgt.getContext('2d').getImageData(0, 0, W, H).data;
  const nrm = makeCanvas(W, H);
  const N = nrm.getContext('2d');
  const img = N.createImageData(W, H);
  const at = (xx, yy) => {
    if (wrapX) xx = (xx + W) % W;
    else xx = Math.min(W - 1, Math.max(0, xx));
    return hd[(Math.min(H - 1, Math.max(0, yy)) * W + xx) * 4];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      img.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  N.putImageData(img, 0, 0);
  return nrm;
}
function texPair(col, nrm, name, rep = null) {
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.name = `${name}_Color`;
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.name = `${name}_Normal`;
  for (const t of [map, normalMap]) {
    t.anisotropy = 8;
    if (rep) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(...rep);
    }
  }
  return { map, normalMap };
}
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}
const line = (ctx, x0, y0, x1, y1, w, style) => {
  ctx.strokeStyle = style;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

// Атлас борта (выше границы необрастающей краски)
function paintHullAtlas() {
  const S = 2048;
  const col = makeCanvas(S, S), hgt = makeCanvas(S, S);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  const rnd = rng(1234567);
  Hc.fillStyle = 'rgb(128,128,128)';
  Hc.fillRect(0, 0, S, S);
  const WHITE = '#e9e8e0';
  for (let j = 0; j < 8; j++) {
    const k = j % 4;
    const port = j >= 4;
    const X = (x) => STRIP_U(k, x) * S;
    const Y = (y) => (1 - STRIP_V(j, y)) * S;
    const y0 = (1 - (j + 1) / 8) * S, y1 = (1 - j / 8) * S;
    const pxmX = (0.994 * S) / (STRIPS[k + 1] - STRIPS[k]);
    const pxmY = (0.976 * S) / 8 / (Y_TOP - Y_SPLIT);
    C.save();
    C.beginPath();
    C.rect(0, y0, S, y1 - y0);
    C.clip();
    Hc.save();
    Hc.beginPath();
    Hc.rect(0, y0, S, y1 - y0);
    Hc.clip();
    C.fillStyle = WHITE;
    C.fillRect(0, y0, S, y1 - y0);
    // пятна и потёки
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S, y = y0 + rnd() * (y1 - y0);
      C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(90,90,80,0.035)';
      C.beginPath();
      C.ellipse(x, y, 8 + rnd() * 40, 3 + rnd() * 10, 0, 0, Math.PI * 2);
      C.fill();
    }
    // ватерлинейная полоса (зелёная) и красная подводная часть ниже
    C.fillStyle = '#7a2a22';
    C.fillRect(0, Y(Y_SPLIT + 0.05), S, y1 - Y(Y_SPLIT + 0.05));
    C.fillStyle = '#2d4a35';
    C.fillRect(0, Y(7.05), S, Y(Y_SPLIT + 0.05) - Y(7.05));
    // швы обшивки
    for (const yy of [8.2, 10.4, 12.3, 14.3, 16.4]) {
      line(C, 0, Y(yy), S, Y(yy), 1, 'rgba(60,60,55,0.12)');
      line(Hc, 0, Y(yy), S, Y(yy), 2, 'rgb(108,108,108)');
    }
    for (let x = STRIPS[k] + 2 + rnd() * 3; x < STRIPS[k + 1]; x += 7.5 + rnd() * 1.5) {
      line(C, X(x), Y(Y_TOP), X(x), Y(7.05), 1, 'rgba(60,60,55,0.08)');
      line(Hc, X(x), Y(Y_TOP), X(x), Y(7.05), 2, 'rgb(112,112,112)');
    }
    // потёки ржавчины под шпигатами
    for (let x = STRIPS[k] + 1; x < STRIPS[k + 1]; x += 9 + rnd() * 6) {
      const yt = Math.min(deckY(x), T1.top) - 0.3;
      const g = C.createLinearGradient(0, Y(yt), 0, Y(yt - 2.5));
      g.addColorStop(0, 'rgba(120,85,55,0.25)');
      g.addColorStop(1, 'rgba(120,85,55,0)');
      C.fillStyle = g;
      C.fillRect(X(x) - 1.5, Y(yt), 3, Y(yt - 2.5) - Y(yt));
    }
    // иллюминаторы: пары, ряды по высоте; не в зоне названия и клюзов
    const noPort = (x, y) =>
      (x > 74 && x < 98 && y > 14.8) || (x > -100 && x < -84 && y > 12.8) || (x > 90 && y > 12.5 && y < 15.5);
    const rows = [9.5, 11.4, 13.3, 15.5, 16.9];
    for (const yr of rows) {
      for (let x = STRIPS[k] + 0.8; x < STRIPS[k + 1] - 0.4; x += 2.5) {
        for (const dx of [0, 0.9]) {
          const xx = x + dx;
          const c = sec(Math.min(XF, Math.max(XS, xx)));
          if (yr + 0.6 > c.yd || c.s > 0.94 || noPort(xx, yr)) continue;
          if (xx < -94) continue;
          const rx = 0.2 * pxmX, ry = 0.2 * pxmY;
          C.fillStyle = '#1a2024';
          C.beginPath();
          C.ellipse(X(xx), Y(yr), rx, ry, 0, 0, Math.PI * 2);
          C.fill();
          C.strokeStyle = 'rgba(150,150,140,0.9)';
          C.lineWidth = 1.5;
          C.stroke();
          Hc.fillStyle = 'rgb(70,70,70)';
          Hc.beginPath();
          Hc.ellipse(X(xx), Y(yr), rx * 1.25, ry * 1.25, 0, 0, Math.PI * 2);
          Hc.fill();
        }
      }
    }
    // клюзы (обрамление под якорями)
    if (k === 3) {
      const xh = 95.0, yh = 14.6;
      C.fillStyle = '#3a3c3c';
      C.beginPath();
      C.ellipse(X(xh), Y(yh), 0.75 * pxmX, 0.75 * pxmY, 0, 0, Math.PI * 2);
      C.fill();
      Hc.fillStyle = 'rgb(60,60,60)';
      Hc.beginPath();
      Hc.ellipse(X(xh), Y(yh), 0.8 * pxmX, 0.8 * pxmY, 0, 0, Math.PI * 2);
      Hc.fill();
      // потёк от клюза
      const g = C.createLinearGradient(0, Y(yh), 0, Y(yh - 5));
      g.addColorStop(0, 'rgba(110,80,55,0.35)');
      g.addColorStop(1, 'rgba(110,80,55,0)');
      C.fillStyle = g;
      C.fillRect(X(xh) - 0.25 * pxmX, Y(yh), 0.5 * pxmX, Y(yh - 5) - Y(yh));
    }
    // название: на левом борту текст рисуется зеркально, чтобы на зеркальной стороне читаться верно
    const text = (str, xc, yc, hM, spacing = 0.12) => {
      for (const ctx of [C, Hc]) {
        ctx.save();
        ctx.translate(X(xc), Y(yc));
        ctx.scale(((port ? -1 : 1) * pxmX) / pxmY, 1);
        const fpx = hM * pxmY;
        ctx.font = `bold ${fpx}px "DejaVu Sans", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * fpx}px`;
        ctx.fillStyle = ctx === C ? '#1b1d1e' : 'rgb(150,150,150)';
        ctx.fillText(str, 0, 0);
        ctx.restore();
      }
    };
    if (k === 3) text('WILHELM GUSTLOFF', 86, 16.15, 1.35);
    if (k === 0) {
      text('WILHELM GUSTLOFF', -92.5, 14.45, 0.75, 0.08);
      text('HAMBURG', -92.5, 13.35, 0.65, 0.12);
    }
    // марки углубления у штевней
    const marks = k === 3 ? [100.2] : k === 0 ? [-101] : [];
    for (const xm of marks) {
      for (let y = 3; y <= 9; y++) {
        if (y < 7) continue;
        text(String(y), xm, y + 0.0, 0.35, 0);
      }
    }
    C.restore();
    Hc.restore();
  }
  const nrm = heightToNormal(hgt, S, S, 2.0 / 255);
  return texPair(col, nrm, 'Hull_Atlas');
}

// Стены надстроек: плитка 16 м × 4 полосы (2,8 м)
function paintWalls() {
  const W = 2048, H = 1024;
  const col = makeCanvas(W, H), hgt = makeCanvas(W, H);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  const rnd = rng(42424);
  C.fillStyle = '#ecebe3';
  C.fillRect(0, 0, W, H);
  Hc.fillStyle = 'rgb(128,128,128)';
  Hc.fillRect(0, 0, W, H);
  const pm = W / WALL_TILE; // px на метр по длине
  const X = (m) => m * pm;
  const Y = (band, h) => (1 - VW(band, h)) * H;
  for (let i = 0; i < 300; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(80,80,70,0.03)';
    C.beginPath();
    C.ellipse(rnd() * W, rnd() * H, 10 + rnd() * 40, 4 + rnd() * 12, 0, 0, Math.PI * 2);
    C.fill();
  }
  const glass = (x0, x1, b, h0, h1, mull = 0) => {
    const xa = X(x0), xb = X(x1), ya = Y(b, h1), yb = Y(b, h0);
    const g = C.createLinearGradient(0, ya, 0, yb);
    g.addColorStop(0, '#2c3e4a');
    g.addColorStop(0.45, '#4f6878');
    g.addColorStop(0.5, '#25333c');
    g.addColorStop(1, '#1b252c');
    C.fillStyle = g;
    C.fillRect(xa, ya, xb - xa, yb - ya);
    C.strokeStyle = '#f4f3ee';
    C.lineWidth = 4;
    C.strokeRect(xa, ya, xb - xa, yb - ya);
    for (let i = 1; i <= mull; i++) {
      const xm = lerp(xa, xb, i / (mull + 1));
      line(C, xm, ya, xm, yb, 3, '#f0efe9');
      line(Hc, xm, ya, xm, yb, 3, 'rgb(140,140,140)');
    }
    Hc.fillStyle = 'rgb(80,80,80)';
    Hc.fillRect(xa, ya, xb - xa, yb - ya);
    Hc.strokeStyle = 'rgb(165,165,165)';
    Hc.lineWidth = 4;
    Hc.strokeRect(xa, ya, xb - xa, yb - ya);
  };
  const door = (x0, b) => {
    const xa = X(x0), xb = X(x0 + 0.85), ya = Y(b, 2.0), yb = Y(b, 0.05);
    C.fillStyle = '#d9d8cf';
    C.fillRect(xa, ya, xb - xa, yb - ya);
    C.strokeStyle = 'rgba(60,60,55,0.7)';
    C.lineWidth = 2;
    C.strokeRect(xa, ya, xb - xa, yb - ya);
    C.fillStyle = '#2b3a44';
    C.fillRect(lerp(xa, xb, 0.25), Y(b, 1.85), (xb - xa) * 0.5, Y(b, 1.35) - Y(b, 1.85));
    Hc.strokeStyle = 'rgb(175,175,175)';
    Hc.lineWidth = 3;
    Hc.strokeRect(xa, ya, xb - xa, yb - ya);
  };
  for (let b = 0; b < 4; b++) {
    // нижний потёк и шов
    const g = C.createLinearGradient(0, Y(b, 0), 0, Y(b, 0.5));
    g.addColorStop(0, 'rgba(90,80,65,0.3)');
    g.addColorStop(1, 'rgba(90,80,65,0)');
    C.fillStyle = g;
    C.fillRect(0, Y(b, 0.5), W, Y(b, 0) - Y(b, 0.5));
    line(C, 0, Y(b, 2.62), W, Y(b, 2.62), 2, 'rgba(70,70,60,0.2)');
    line(Hc, 0, Y(b, 2.62), W, Y(b, 2.62), 3, 'rgb(150,150,150)');
  }
  // полоса 0 — закрытая прогулочная палуба: большие окна 1,7 × 1,45 м
  for (let i = 0; i < 8; i++) glass(i * 2 + 0.15, i * 2 + 1.85, 0, 0.95, 2.4, 1);
  // полоса 1 — салоны: окна 1,1 × 1,15 м, дверь каждые 16 м
  for (let i = 0; i < 8; i++) {
    if (i === 4) {
      door(i * 2 + 0.6, 1);
      continue;
    }
    glass(i * 2 + 0.45, i * 2 + 1.55, 1, 1.05, 2.2, 0);
  }
  // полоса 2 — ходовая рубка: сплошной ряд окон
  for (let i = 0; i < 16; i++) glass(i + 0.08, i + 0.92, 2, 1.25, 2.35, 0);
  // полоса 3 — рубки солнечной палубы: окна 0,9 × 0,9 и двери
  for (let i = 0; i < 6; i++) {
    const x = (i * 16) / 6;
    if (i === 2) door(x + 0.9, 3);
    else glass(x + 0.85, x + 1.75, 3, 1.15, 2.05, 0);
  }
  const nrm = heightToNormal(hgt, W, H, 2.0 / 255, true);
  return texPair(col, nrm, 'Superstructure_Walls', [WALL_REP, 1]);
}

// Деревянный настил: плитка 8 × 8 м, доски вдоль корпуса
function paintDeck() {
  const S = 1024;
  const col = makeCanvas(S, S), hgt = makeCanvas(S, S);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  const rnd = rng(777);
  Hc.fillStyle = 'rgb(128,128,128)';
  Hc.fillRect(0, 0, S, S);
  const pm = S / 8;
  const pw = 0.16 * pm;
  const n = Math.round(S / pw);
  const pwx = S / n;
  for (let i = 0; i < n; i++) {
    const y = i * pwx;
    let x = -rnd() * 6 * pm;
    while (x < S) {
      const L = (5.5 + rnd() * 1.5) * pm;
      const t = rnd();
      const r = Math.round(176 + 24 * t), g = Math.round(146 + 20 * t), b = Math.round(104 + 16 * t);
      C.fillStyle = `rgb(${r},${g},${b})`;
      C.fillRect(Math.max(0, x), y, L, pwx);
      // повтор по краю для бесшовности
      if (x < 0) {
        C.fillRect(S + x, y, -x, pwx);
      }
      for (let k = 0; k < 6; k++) {
        C.fillStyle = `rgba(${rnd() < 0.5 ? '255,240,210' : '90,70,40'},0.06)`;
        C.fillRect(Math.max(0, x) + rnd() * L, y + rnd() * pwx, 20 + rnd() * 60, 1.5);
      }
      x += L;
      if (x < S) {
        line(C, x, y, x, y + pwx, 1.5, 'rgba(50,38,22,0.6)');
        line(Hc, x, y, x, y + pwx, 2, 'rgb(105,105,105)');
      }
    }
    line(C, 0, y, S, y, 1.6, 'rgba(40,30,18,0.75)');
    line(Hc, 0, y, S, y, 2, 'rgb(90,90,90)');
  }
  const nrm = heightToNormal(hgt, S, S, 1.6 / 255, true);
  return texPair(col, nrm, 'Deck_Planks', DECK_REP);
}

// Леера: стойка, поручень и три прутка, остальное прозрачно (alpha MASK)
function paintRailing() {
  const W = 256, H = 128;
  const c = makeCanvas(W, H);
  const C = c.getContext('2d');
  C.clearRect(0, 0, W, H);
  const pm = W / RAIL_TILE;
  const py = (h) => (1 - h / RAIL_H) * H;
  C.fillStyle = '#f2f1ea';
  C.fillRect(0, py(RAIL_H), W, py(RAIL_H - 0.07) - py(RAIL_H)); // поручень
  for (const h of [0.72, 0.42, 0.14]) C.fillRect(0, py(h + 0.025), W, py(h - 0.025) - py(h + 0.025));
  C.fillRect(W / 2 - 0.03 * pm, 0, 0.06 * pm, H); // стойка
  C.fillRect(0, 0, 0.015 * pm, H);
  C.fillRect(W - 0.015 * pm, 0, 0.015 * pm, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = 'image/png';
  t.name = 'Railing_Color';
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(RAIL_REP, 1);
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// КОРПУС

const NB = 16; // рядов днища (киль → граница краски)
const NT = 12; // рядов надводного борта
const ND = 12; // поперёк палубы

function hullRows(c) {
  const qS = qOfY(c, Y_SPLIT);
  const bot = [], top = [];
  for (let i = 0; i <= NB; i++) bot.push((qS * i) / NB);
  for (let i = 0; i <= NT; i++) top.push(qOfY(c, lerp(Y_SPLIT, c.yd, i / NT)));
  return { bot, top };
}
const deckRowZ = (c) => Array.from({ length: ND + 1 }, (_, j) => c.wd * (1 - (2 * j) / ND));

function buildHull() {
  // надводный борт: по полосам атласа
  const top = new Mesher();
  for (let k = 0; k < 4; k++) {
    const xs = stationXs.filter((x) => x >= STRIPS[k] - 1e-6 && x <= STRIPS[k + 1] + 1e-6);
    let prev = null;
    for (const xn of xs) {
      const c = sec(xn);
      const { top: qs } = hullRows(c);
      const S = [], P = [];
      for (const q of qs) {
        const p = sideP(c, q);
        S.push(top.v(p, STRIP_U(k, xn), STRIP_V(k, p.y)));
        P.push(top.v(V3(p.x, p.y, -p.z), STRIP_U(k, xn), STRIP_V(k + 4, p.y)));
      }
      if (prev) {
        top.strip(prev.S, S);
        top.strip(P, prev.P);
      }
      prev = { S, P };
    }
  }
  // днище
  const bot = new Mesher();
  {
    let prev = null;
    for (const xn of stationXs) {
      const c = sec(xn);
      const { bot: qs } = hullRows(c);
      const S = [], P = [];
      qs.forEach((q, i) => {
        const p = sideP(c, q);
        S.push(bot.v(p, UD(xn), 0.5 + (0.5 * i) / NB));
        P.push(bot.v(V3(p.x, p.y, -p.z), UD(xn), 0.5 - (0.5 * i) / NB));
      });
      if (prev) {
        bot.strip(prev.S, S);
        bot.strip(P, prev.P);
      }
      prev = { S, P };
    }
  }
  // открытые палубы: бак и ют (под надстройкой палубы нет — её закрывают стены и крыша яруса 1)
  const deck = new Mesher();
  const deckPart = (xs) => {
    let prev = null;
    for (const xn of xs) {
      const c = sec(xn);
      const D = deckRowZ(c).map((z) => deck.v(V3(xn, c.yd, z), UD(xn), VD(z)));
      if (prev) deck.strip(prev, D);
      prev = D;
    }
  };
  deckPart(stationXs.filter((x) => x <= T1.x0 + 1e-6));
  deckPart(stationXs.filter((x) => x >= T1.x1 - 1e-6));
  return { top: top.build({ orient: false }), bot: bot.build({ orient: false }), deck: deck.build({ orient: false }) };
}

// Стены по замкнутому контуру точек {x, z, yb} до высоты yTop; UV — полоса band плиточной текстуры стен
function walls(loop, yTop, band) {
  const m = new Mesher();
  let per = 0;
  const B = [], T = [];
  const n = loop.length;
  for (let i = 0; i <= n; i++) {
    const p = loop[i % n];
    if (i > 0) per += Math.hypot(p.x - loop[i - 1].x, p.z - loop[i - 1].z);
    const u = UW(per);
    B.push(m.v(V3(p.x, p.yb, p.z), u, VW(band, p.yb - (yTop - WALL_H))));
    T.push(m.v(V3(p.x, yTop, p.z), u, VW(band, WALL_H)));
  }
  m.strip(B, T);
  const g = m.build({ orient: false });
  // наружу: площадь контура > 0 в (x, z) даёт нужный обход — проверяем по сумме
  const pos = g.attributes.position, idx = g.index.array;
  const cx = loop.reduce((s, p) => s + p.x, 0) / n, cz = loop.reduce((s, p) => s + p.z, 0) / n;
  let s = 0;
  const a = V3(), b = V3(), c = V3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]);
    b.fromBufferAttribute(pos, idx[i + 1]);
    c.fromBufferAttribute(pos, idx[i + 2]);
    const nn = b.clone().sub(a).cross(c.clone().sub(a));
    const mid = a.clone().add(b).add(c).divideScalar(3);
    s += Math.sign(nn.x * (mid.x - cx) + nn.z * (mid.z - cz));
  }
  if (s < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.computeVertexNormals();
  }
  return g;
}
// Плоская крыша с отверстиями (нормаль вверх или вниз)
function roof(outer, holes, y, { up = true, uv = (x, z) => [UD(x), VD(z)] } = {}) {
  const r = new Mesher();
  const o = ccw(outer);
  const hl = holes.map((q) => [...ccw(q)].reverse());
  const tris = THREE.ShapeUtils.triangulateShape(v2(o), hl.map(v2));
  const all = [...o, ...hl.flat()];
  const R = all.map(([x, z]) => r.v(V3(x, y, z), ...uv(x, z)));
  tris.forEach(([a, b, c]) => {
    const [ax, az] = all[a], [bx, bz] = all[b], [cx, cz] = all[c];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny > 0 === up) r.tri(R[a], R[b], R[c]);
    else r.tri(R[a], R[c], R[b]);
  });
  return r.build({ orient: false });
}

// Контур трубы на высоте y (наклон назад), масштаб sc
function funnelRing(y, sc, NS = 40) {
  const pts = [];
  const y0 = T3.top;
  const cx = FUN.x - (y - y0) * FUN.rake;
  for (let j = 0; j < NS; j++) {
    const a = (j / NS) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const ex = 2 / 3.0;
    const taper = 1 - 0.04 * ((y - y0) / FUN.h);
    pts.push(V3(cx + sc * taper * FUN.a * Math.sign(c) * Math.abs(c) ** ex * (c > 0 ? 0.94 : 1), y, sc * taper * FUN.b * Math.sign(s) * Math.abs(s) ** ex));
  }
  return pts;
}

// ---------------------------------------------------------------------------

export function createGustloff() {
  const ship = new THREE.Group();
  ship.name = 'Liner_Wilhelm_Gustloff';
  const hullTex = paintHullAtlas();
  const wallTex = paintWalls();
  const deckTex = paintDeck();
  const railTex = paintRailing();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    hull: std('Hull_Paint_Atlas', 0xffffff, 0.6, 0.1, hullTex),
    bottom: std('Antifouling_Red', 0x7a2a22, 0.75, 0.05),
    walls: std('Superstructure_Walls', 0xffffff, 0.55, 0.05, wallTex),
    deck: std('Deck_Wood', 0xffffff, 0.8, 0.0, deckTex),
    white: std('Steel_White', 0xe6e5dd, 0.55, 0.1),
    buff: std('Funnel_Buff', 0xd8b25a, 0.55, 0.1),
    dark: std('Steel_Dark', 0x262829, 0.6, 0.35),
    bronze: std('Propeller_Bronze', 0xa8804a, 0.32, 0.9),
    rail: std('Railing_White', 0xffffff, 0.5, 0.1, { map: railTex, alphaTest: 0.5, side: THREE.DoubleSide }),
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
  const stats = { warn: [] };

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  const H = buildHull();
  mesh(merge([H.top]), M.hull, 'Hull_Topsides', hullG);
  mesh(merge([H.bot]), M.bottom, 'Hull_Bottom', hullG);
  mesh(merge([H.deck]), M.deck, 'Main_Deck', hullG);

  // Винты, валы, кронштейны, скуловые кили, руль
  const PROP = { x: -88, y: 3.3, z: 5.6, r: 2.3 };
  const RUD = { x: -94.0, y0: 1.3 };
  {
    // контроль зазоров винта (в статистику)
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const y = PROP.y + (PROP.r + 0.15) * Math.cos(ang), z = PROP.z + (PROP.r + 0.15) * Math.sin(ang);
      for (const dx of [-0.6, 0, 0.6]) {
        if (Math.abs(z) < zAtXY(PROP.x + dx, y)) stats.warn.push(`prop clash a=${a} dx=${dx}`);
      }
    }
    const parts = [];
    [1, -1].forEach((sd) => {
      const z = sd * PROP.z;
      // выход вала из корпуса: где обвод на высоте вала уже уже, чем z
      let xe = PROP.x;
      while (xe < 0 && zAtXY(xe, PROP.y) < PROP.z - 0.05) xe += 0.25;
      const xIn = xe + 2.0;
      parts.push(rod([xIn, PROP.y, z], [PROP.x + 0.35, PROP.y, z], 0.32, 12, 'both'));
      // мортира — обтекатель вала у корпуса
      parts.push(latheX([[0, -3.5], [0.55, -2.6], [0.75, 0], [0.75, 2.0]], 14, { bottom: false, top: false }).translate(xe - 1.0, PROP.y, z));
      // кронштейн (A-образный) у винта
      const xb = PROP.x + 2.0;
      parts.push(latheX([[0.0, -0.75], [0.45, -0.5], [0.48, 0.5], [0.0, 0.9]], 14).translate(xb, PROP.y, z));
      const leg = (to) => {
        const a = V3(xb, PROP.y, z), b = to;
        const d = b.clone().sub(a);
        const g = prism([[-0.55, 0], [0.55, 0], [0.4, 1], [-0.4, 1]], 0.16);
        g.scale(1, d.length(), 1);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
        g.translate(a.x, a.y, a.z);
        return g;
      };
      parts.push(leg(V3(xb, yAtXZ(xb, PROP.z) + 0.4, z)));
      const yIn = PROP.y - 0.3;
      parts.push(leg(V3(xb, yIn, sd * Math.max(0.2, zAtXY(xb, Math.max(yIn, keelYAt(xb) + 0.05)) - 0.3))));
      // скуловой киль
      const bk = [];
      for (let i = 0; i <= 24; i++) {
        const x = lerp(-34, 18, i / 24);
        const c = sec(x);
        const q = QL * 0.55;
        const p = sideP(c, q);
        const pq = sideP(c, q + 0.01).sub(sideP(c, q - 0.01)).normalize();
        const out = V3(0, -pq.z, pq.y).multiplyScalar(-1);
        if (out.z < 0) out.negate();
        const taper = Math.sin((Math.PI * i) / 24) ** 0.4;
        const ring = [
          p.clone().addScaledVector(pq, 0.25).addScaledVector(out, -0.08),
          p.clone().addScaledVector(out, 0.75 * taper + 0.03),
          p.clone().addScaledVector(pq, -0.25).addScaledVector(out, -0.08),
        ];
        bk.push(ring.map((v) => V3(v.x, v.y, sd * v.z)));
      }
      parts.push(loftRings(bk));
    });
    // скег перед рулём
    {
      const lo = [], hi = [];
      for (let i = 0; i <= 10; i++) {
        const x = lerp(-74, RUD.x + 1.4, i / 10);
        const yk = keelYAt(x);
        lo.push([x, Math.min(yk - 0.05, lerp(keelYAt(-74) - 0.05, 3.0, i / 10))]);
        hi.push([x, yk + 0.5]);
      }
      parts.push(prism([...lo, ...hi.reverse()], 0.5).translate(0, 0, 0));
    }
    mesh(merge(parts), M.bottom, 'Hull_Appendages', hullG);
  }

  // ======================= НАДСТРОЙКА
  const supG = group('Superstructure', ship);
  const T2poly = roundRect2(T2.x0, T2.x1, T2.hw, T2.rA, T2.rF);
  const T3poly = roundRect2(T3.x0, T3.x1, T3.hw, T3.rA, T3.rF);
  const T4poly = roundRect2(T4.x0, T4.x1, T4.hw, T4.rA, T4.rF);
  const funBase = funnelRing(T3.top, 1).map((p) => [p.x, p.z]);
  const flat = (poly, y) => poly.map(([x, z]) => ({ x, z, yb: y }));
  {
    const W = [], D = [], R = [];
    // ярус 1: стены продолжают борт; низ — кромка палубы корпуса
    const xs = stationXs.filter((x) => x >= T1.x0 - 1e-6 && x <= T1.x1 + 1e-6);
    const loop = [];
    xs.forEach((x) => loop.push({ x, z: sec(x).wd, yb: deckY(x) })); // правый борт, в нос
    deckRowZ(sec(T1.x1)).slice(1).forEach((z) => loop.push({ x: T1.x1, z, yb: deckY(T1.x1) })); // носовая стенка
    [...xs].reverse().slice(1).forEach((x) => loop.push({ x, z: -sec(x).wd, yb: deckY(x) })); // левый борт, в корму
    deckRowZ(sec(T1.x0)).reverse().slice(1, -1).forEach((z) => loop.push({ x: T1.x0, z, yb: deckY(T1.x0) })); // кормовая стенка
    W.push(walls(loop, T1.top, 0));
    D.push(roof(loop.map((p) => [p.x, p.z]), [T2poly], T1.top));
    // ярус 2 (салоны), ярус 3 (рубки солнечной палубы), ходовая рубка
    W.push(walls(flat(T2poly, T1.top), T2.top, 1));
    D.push(roof(T2poly, [T3poly], T2.top));
    W.push(walls(flat(T3poly, T2.top), T3.top, 3));
    D.push(roof(T3poly, [T4poly, funBase], T3.top));
    W.push(walls(flat(T4poly, T3.top), T4.top, 2));
    R.push(roof(T4poly, [], T4.top));
    // крылья мостика (плиты без внутреннего торца)
    const WING = { x0: 33.0, x1: 36.0, z0: T3.hw, z1: 11.3, t: 0.3 };
    [1, -1].forEach((sd) => {
      const w = WING.z1 - WING.z0;
      R.push(boxSkip(WING.x1 - WING.x0, WING.t, w, (WING.x0 + WING.x1) / 2, T3.top - WING.t / 2, sd * (WING.z0 + w / 2), sd > 0 ? 'nz' : 'pz'));
      // ветроотбойник на крыле
      R.push(boxSkip(0.08, 1.1, w, WING.x1 - 0.04, T3.top + 0.55, sd * (WING.z0 + w / 2), 'ny'));
    });
    mesh(merge(W), M.walls, 'Superstructure_Walls', supG);
    mesh(merge(D), M.deck, 'Superstructure_Decks', supG);
    mesh(merge(R), M.white, 'Bridge_Roof_Wings', supG);
  }

  // ======================= ТРУБА
  const funG = group('Funnel', ship);
  {
    const fm = new Mesher(), cm = new Mesher();
    const NS = 40;
    const yTop = T3.top + FUN.h;
    const yCap = yTop - FUN.cap;
    const ringIds = (m, y, sc, v) => {
      const r = funnelRing(y, sc, NS);
      const ids = r.map((p, j) => m.v(p, j / NS, v));
      ids.push(m.v(r[0], 1, v));
      return ids;
    };
    const lv = [T3.top, T3.top + 3, T3.top + 6, yCap];
    const ids = lv.map((y, i) => ringIds(fm, y, 1, i / 3));
    for (let k = 0; k < ids.length - 1; k++) fm.strip(ids[k], ids[k + 1]);
    const fg = orientOut(fm.build({ orient: false }), V3(FUN.x - 3 * FUN.rake, T3.top + 3, 0));
    mesh(merge([fg]), M.buff, 'Funnel_Casing', funG);
    // чёрный колпак: наружная стенка, кромка, внутренняя стенка, дно
    const cl = [
      [yCap, 1],
      [yTop, 1],
      [yTop, 0.94],
      [yTop - 1.4, 0.94],
    ];
    const cids = cl.map(([y, sc], i) => ringIds(cm, y, sc, i / 3));
    for (let k = 0; k < cids.length - 1; k++) cm.strip(cids[k], cids[k + 1]);
    const cIn = funnelRing(yTop - 1.4, 0, NS)[0];
    const ci = cm.v(cIn, 0.5, 0.5);
    const last = cids[cids.length - 1];
    const cg0 = cm.build({ orient: false });
    // ориентация по наружной стенке
    orientOut(cg0, V3(FUN.x - (yCap - T3.top) * FUN.rake, yCap + 0.5, 0));
    // дно отдельно: смотрит вверх
    const bm = new Mesher();
    const ring = funnelRing(yTop - 1.4, 0.94, NS);
    const bi = ring.map((p) => bm.v(p));
    const bc = bm.v(cIn);
    for (let j = 0; j < NS; j++) {
      const a = ring[j], b = ring[(j + 1) % NS];
      const ny = (b.z - a.z) * (cIn.x - a.x) - (b.x - a.x) * (cIn.z - a.z);
      if (ny > 0) bm.tri(bi[j], bi[(j + 1) % NS], bc);
      else bm.tri(bi[j], bc, bi[(j + 1) % NS]);
    }
    void ci;
    void last;
    // паровые свистки и выхлопные трубы над колпаком
    const extras = [];
    [-1.2, 1.2].forEach((dz) => extras.push(lathe([[0.32, yTop - 1.5], [0.32, yTop + 1.1], [0.38, yTop + 1.15], [0.38, yTop + 1.3], [0, yTop + 1.31]], 12).translate(FUN.x - FUN.h * FUN.rake - 1.2, 0, dz)));
    mesh(merge([cg0, bm.build({ orient: false }), ...extras]), M.dark, 'Funnel_Cap', funG);
  }

  // ======================= ПАЛУБНОЕ ОБОРУДОВАНИЕ
  const eqG = group('Deck_Equipment', ship);
  const HATCHES = [
    { x: 84, lx: 6, lz: 6 },
    { x: 60, lx: 8, lz: 8 },
    { x: -84, lx: 7, lz: 7 },
  ];
  const FM = { x: 70, top: 44 };
  const MM = { x: -73, top: 41 };
  {
    const white = [], dark = [], buff = [];
    // трюмные люки: комингсы (белые) и брезентовые крышки (тёмные)
    HATCHES.forEach((h) => {
      const yt = deckY(h.x + h.lx / 2) + 1.1;
      const x0 = h.x - h.lx / 2, x1 = h.x + h.lx / 2;
      const loop = [];
      const n = 8;
      for (let i = 0; i <= n; i++) loop.push({ x: lerp(x0, x1, i / n), z: h.lz / 2 });
      for (let i = 1; i <= n; i++) loop.push({ x: x1, z: lerp(h.lz / 2, -h.lz / 2, i / n) });
      for (let i = 1; i <= n; i++) loop.push({ x: lerp(x1, x0, i / n), z: -h.lz / 2 });
      for (let i = 1; i < n; i++) loop.push({ x: x0, z: lerp(-h.lz / 2, h.lz / 2, i / n) });
      loop.forEach((p) => (p.yb = deckY(p.x) - 0.05));
      const wg = walls(loop, yt, 0);
      // UV комингса не нужны (материал цветом)
      white.push(wg);
      const lm = new Mesher();
      const NX = 8, NZ = 8;
      const g = [];
      for (let i = 0; i <= NX; i++) {
        const row = [];
        for (let k = 0; k <= NZ; k++) {
          const x = lerp(x0, x1, i / NX), z = lerp(h.lz / 2, -h.lz / 2, k / NZ);
          const dome = 0.18 * Math.sin((Math.PI * k) / NZ) ** 0.8;
          row.push(lm.v(V3(x, yt + dome, z), i / NX, k / NZ));
        }
        g.push(row);
      }
      for (let i = 0; i < NX; i++) lm.strip(g[i], g[i + 1]);
      dark.push(orientOut(lm.build({ orient: false }), V3(h.x, yt - 2, 0)));
      // торцы брезента: серп между верхом комингса (yt) и выпуклой крышкой — без них сквозная щель
      [x0, x1].forEach((xe) => {
        const em = new Mesher();
        const top = [], bot = [];
        for (let k = 0; k <= NZ; k++) {
          const z = lerp(h.lz / 2, -h.lz / 2, k / NZ);
          const dome = 0.18 * Math.sin((Math.PI * k) / NZ) ** 0.8;
          top.push(em.v(V3(xe, yt + dome, z), k / NZ, 1));
          bot.push(em.v(V3(xe, yt, z), k / NZ, 0));
        }
        em.strip(bot, top);
        dark.push(orientOut(em.build({ orient: false }), V3(h.x, yt - 2, 0)));
      });
    });
    // грузовые лебёдки у мачт
    const winch = (x, z, yaw = 0) => {
      const y = deckY(x);
      const g = merge([
        boxSkip(1.6, 0.9, 1.2, 0, 0.45, 0, 'ny'),
        latheX([[0.42, -0.65], [0.42, 0.65]], 14).rotateY(Math.PI / 2).translate(0.2, 1.15, 0),
        boxSkip(0.9, 0.7, 0.9, -1.2, 0.35, 0, 'ny'),
      ]);
      g.rotateY(yaw);
      return g.translate(x, y - 0.03, z);
    };
    [
      [FM.x + 3.2, 1.4],
      [FM.x + 3.2, -1.4],
      [FM.x - 3.2, 1.4],
      [FM.x - 3.2, -1.4],
      [MM.x - 3.2, 1.4],
      [MM.x - 3.2, -1.4],
    ].forEach(([x, z]) => dark.push(winch(x, z, Math.PI / 2)));
    // брашпиль и шпили на баке
    [1, -1].forEach((sd) => {
      dark.push(lathe([[0.75, -0.08], [0.75, 0.15], [0.55, 0.25], [0.5, 0.75], [0.62, 0.82], [0.55, 0.95], [0, 1.0]], 18).translate(96.5, deckY(96.5), sd * 1.6));
      // якорные цепи от брашпиля к палубному клюзу
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const x = lerp(96.5, 99.2, t), z = sd * lerp(1.6, 2.2, t);
        pts.push(V3(x, deckY(x) + 0.05, z));
      }
      dark.push(tubePath(pts, 0.11, 6));
      dark.push(lathe([[0.45, -0.1], [0.42, 0.2], [0.3, 0.25], [0, 0.24]], 14).translate(99.4, deckY(99.4), sd * 2.25));
      // шпиль на юте
      dark.push(lathe([[0.55, -0.08], [0.55, 0.12], [0.4, 0.2], [0.36, 0.7], [0.46, 0.76], [0, 0.82]], 16).translate(-95, deckY(-95), sd * 2.6));
    });
    // якоря Холла в клюзах
    [1, -1].forEach((sd) => {
      const yh = 14.6;
      const xh = xAt(sec(95.0), yh - 0.9); // клюз нарисован в атласе по номинальной абсциссе 95
      const r = sideAt(xh, yh - 0.9);
      const shank = box(0.35, 2.4, 0.3, 0, 0.3, 0);
      const crown = box(0.7, 0.5, 0.6, 0, -0.9, 0);
      const fl = (sx) => prism([[0.05, 0.03], [0.85, 0.2], [1.05, 1.1], [0.6, 0.7], [0.05, 0.43]].map(([a, b]) => [sx * a, b - 1.1]), 0.35);
      const anc = merge([shank, crown, fl(1), fl(-1)]);
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), r.n);
      anc.applyQuaternion(q);
      anc.translate(xh, yh - 1.0, r.z + 0.22);
      dark.push(sd > 0 ? anc : mirrorZ(anc));
    });
    // кнехты по бортам бака и юта
    const bollard = () => {
      const p = () => lathe([[0.22, -0.08], [0.2, 0.55], [0.28, 0.6], [0.28, 0.66], [0, 0.68]], 12);
      return merge([p().translate(0.45, 0, 0), p().translate(-0.45, 0, 0), boxSkip(1.35, 0.18, 0.55, 0, 0.05, 0, 'ny')]);
    };
    [90, 78, 56, -68, -80, -92].forEach((x) => {
      [1, -1].forEach((sd) => {
        const z = sd * (sec(x).wd - 1.0);
        dark.push(bollard().translate(x, deckY(x), z));
      });
    });
    // раструбы вентиляторов
    const cowl = (h, r, yaw) => {
      const stem = lathe([[r, -0.15], [r, h + 0.03]], 12, { top: false }); // заходит в колено: без шва
      const bend = [];
      for (let i = 0; i <= 5; i++) {
        const a = (i / 5) * (Math.PI / 2);
        bend.push(V3(r * 1.2 * (1 - Math.cos(a)), h + r * 1.2 * Math.sin(a), 0));
      }
      const mouth = tubePath(bend, r, 12, { capStart: false, capEnd: true }); // донце в горле: сквозь раструб не видно насквозь
      const bell = latheX([[r * 1.0, 0], [r * 1.5, 0.3], [r * 1.3, 0.3], [r * 0.95, 0.05], [r * 0.95, -0.02]], 12, { bottom: false, top: false }).translate(r * 1.2, h + r * 1.2, 0);
      const g = merge([stem, mouth, bell]);
      g.rotateY(yaw);
      return g;
    };
    [
      [54.5, 4.5, deckY(54.5), 2.2, 0.5, 0],
      [54.5, -4.5, deckY(54.5), 2.2, 0.5, 0],
      [-66.5, 5.5, deckY(-66.5), 2.0, 0.45, Math.PI],
      [-66.5, -5.5, deckY(-66.5), 2.0, 0.45, Math.PI],
      [-17, 3.6, T3.top, 2.4, 0.55, Math.PI],
      [-17, -3.6, T3.top, 2.4, 0.55, Math.PI],
      [5, 4.4, T3.top, 2.2, 0.5, 0],
      [5, -4.4, T3.top, 2.2, 0.5, 0],
      [-30, 3.8, T3.top, 1.8, 0.45, Math.PI / 2],
      [-30, -3.8, T3.top, 1.8, 0.45, -Math.PI / 2],
    ].forEach(([x, z, y, h, r, yaw]) => buff.push(cowl(h, r, yaw).translate(x, y, z)));
    // грибовидные вентиляторы на солнечной палубе
    for (const x of [-40, -36, 20, 24]) {
      [1, -1].forEach((sd) => white.push(lathe([[0.3, -0.05], [0.3, 0.9], [0.65, 1.0], [0.6, 1.2], [0, 1.25]], 12).translate(x, T3.top, sd * 3.5)));
    }
    // световые люки на крыше яруса 3
    white.push(boxSkip(6, 0.9, 3.2, -26, T3.top + 0.45, 0, 'ny'));
    white.push(boxSkip(5, 0.9, 3.2, 14, T3.top + 0.45, 0, 'ny'));
    // флагштоки: гюйсшток и кормовой
    white.push(lathe([[0.1, deckY(102.5) - 0.05], [0.06, deckY(102.5) + 5.5], [0.1, deckY(102.5) + 5.6], [0, deckY(102.5) + 5.7]], 8).translate(102.5, 0, 0));
    white.push(lathe([[0.12, deckY(-102.5) - 0.05], [0.07, deckY(-102.5) + 7], [0.12, deckY(-102.5) + 7.1], [0, deckY(-102.5) + 7.2]], 8).translate(-102.5, 0, 0));
    // нактоуз, прожекторы и ходовые огни на крыше рубки
    white.push(lathe([[0.3, -0.05], [0.25, 1.0], [0.38, 1.1], [0, 1.4]], 12).translate(35.5, T4.top, 0));
    [1, -1].forEach((sd) => {
      white.push(boxSkip(0.6, 0.8, 0.35, 34.2, T3.top + 0.4, sd * 10.8, 'ny'));
      white.push(lathe([[0.25, -0.05], [0.18, 0.5], [0, 0.55]], 10).translate(36.5, T4.top, sd * 4.5));
      white.push(latheX([[0.0, -0.4], [0.35, -0.3], [0.38, 0.3], [0.0, 0.32]], 12).translate(36.5, T4.top + 0.95, sd * 4.5));
    });
    // сигнальная мачта на ходовой рубке
    buff.push(lathe([[0.2, T4.top - 0.05], [0.12, T4.top + 9], [0, T4.top + 9.05]], 10).translate(33.0, 0, 0));
    buff.push(rod([33.0, T4.top + 6.5, -2.4], [33.0, T4.top + 6.5, 2.4], 0.07, 6));
    mesh(merge(white), M.white, 'Deck_Fittings_White', eqG);
    mesh(merge(dark), M.dark, 'Deck_Fittings_Dark', eqG);
    mesh(merge(buff), M.buff, 'Ventilators', eqG);
  }

  // ======================= ШЛЮПКИ И ШЛЮПБАЛКИ
  const boatG = group('Lifeboats', ship);
  const BOAT = { L: 7.6, B: 2.6, D: 1.05, z: 10.3, y: 21.85, n: 11, x0: -51, dx: 8.0 };
  {
    const boatGeo = () => {
      const m = new Mesher();
      const N = 18, MH = 12, MC = 8;
      const Hh = [], Cv = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = (t - 0.5) * BOAT.L;
        const w = (BOAT.B / 2) * Math.max(0, Math.sin(Math.PI * t) ** 0.45);
        const d = BOAT.D * (0.75 + 0.25 * Math.sin(Math.PI * t));
        const gw = 0.15 * (2 * Math.abs(t - 0.5)) ** 2;
        const hc = 0.38 * Math.sin(Math.PI * t) ** 0.6;
        const hr = [], cr = [];
        for (let j = 0; j <= MH; j++) {
          const a = (j / MH) * Math.PI;
          hr.push(m.v(V3(x, gw - d * Math.sin(a) ** 0.6, w * Math.cos(a)), t, j / MH));
        }
        for (let j = 0; j <= MC; j++) {
          const a = (j / MC) * Math.PI;
          cr.push(m.v(V3(x, gw + hc * Math.sin(a), w * Math.cos(a)), t, j / MC));
        }
        Hh.push(hr);
        Cv.push(cr);
      }
      for (let i = 0; i < N; i++) {
        m.strip(Hh[i], Hh[i + 1]);
        m.strip(Cv[i + 1], Cv[i]);
      }
      return m.build({ orient: true });
    };
    const one = boatGeo();
    [1, -1].forEach((sd) => {
      const tag = sd > 0 ? 'R' : 'L';
      const boats = [], davits = [];
      for (let i = 0; i < BOAT.n; i++) {
        const x = BOAT.x0 + i * BOAT.dx;
        boats.push(one.clone().translate(x, BOAT.y + BOAT.D, sd * BOAT.z));
        [x - 2.7, x + 2.7].forEach((xd) => {
          // гравитационная шлюпбалка: наклонная станина + рычаг
          const zb = T2.hw - 0.45;
          davits.push(boxSkip(0.35, 1.5, 0.35, xd, T2.top + 0.75, sd * zb, 'ny'));
          const pts = [V3(xd, T2.top + 1.4, sd * zb), V3(xd, T2.top + 3.0, sd * (zb + 0.2)), V3(xd, T2.top + 3.6, sd * (zb + 0.9)), V3(xd, T2.top + 3.45, sd * (BOAT.z - 0.05))];
          davits.push(tubePath(pts, 0.14, 8));
          // тали: от ноки рычага к шлюпке
          davits.push(rod([xd, T2.top + 3.35, sd * (BOAT.z - 0.05)], [xd, BOAT.y + BOAT.D + 0.2, sd * (BOAT.z - 0.05)], 0.035, 4, 'none'));
        });
      }
      mesh(merge(boats), M.white, `Lifeboats_${tag}`, boatG);
      mesh(merge(davits), M.white, `Davits_${tag}`, boatG);
    });
  }

  // ======================= МАЧТЫ И ТАКЕЛАЖ
  const mastG = group('Masts', ship);
  {
    const p = [];
    const yF0 = deckY(FM.x) - 0.05;
    const yM0 = deckY(MM.x) - 0.05;
    p.push(lathe([[0.5, yF0], [0.45, 28], [0.3, 36], [0.16, FM.top - 0.1], [0.1, FM.top], [0, FM.top + 0.02]], 14).translate(FM.x, 0, 0));
    p.push(lathe([[0.48, yM0], [0.42, 26], [0.28, 34], [0.15, MM.top - 0.1], [0.1, MM.top], [0, MM.top + 0.02]], 14).translate(MM.x, 0, 0));
    // марс (воронье гнездо) на фок-мачте
    p.push(lathe([[0.45, 29.4], [0.95, 29.5], [1.0, 29.65], [1.0, 30.8], [0.92, 30.8], [0.92, 29.8], [0.42, 29.8]], 18, { top: false }).translate(FM.x, 0, 0));
    // реи
    p.push(rod([FM.x, 36.5, -4.5], [FM.x, 36.5, 4.5], 0.12, 8));
    p.push(rod([MM.x, 34.5, -3.8], [MM.x, 34.5, 3.8], 0.11, 8));
    // столы грузовых стрел (кольца-опоры у мачт)
    p.push(lathe([[0.5, deckY(FM.x) + 2.6], [1.3, deckY(FM.x) + 2.75], [1.3, deckY(FM.x) + 3.0], [0.45, deckY(FM.x) + 3.1]], 16, { top: false }).translate(FM.x, 0, 0));
    p.push(lathe([[0.48, deckY(MM.x) + 2.6], [1.25, deckY(MM.x) + 2.75], [1.25, deckY(MM.x) + 3.0], [0.43, deckY(MM.x) + 3.1]], 16, { top: false }).translate(MM.x, 0, 0));
    mesh(merge(p), M.buff, 'Mast_Spars', mastG);

    const w = [];
    const r = 0.035;
    const dk = (x, z) => [x, deckY(x) + 0.03, z];
    // штаги и ванты
    w.push(rod([FM.x, 40, 0], dk(102.6, 0), r, 4));
    w.push(rod([MM.x, 38, 0], dk(-100.5, 0), r, 4));
    w.push(rod([FM.x, FM.top - 1.2, 0], [MM.x, MM.top - 1.2, 0], r, 4)); // триатик-штаг
    [1, -1].forEach((sd) => {
      [-1.5, -3.5].forEach((dx) => {
        w.push(rod([FM.x, 34, sd * 0.25], dk(FM.x + dx, sd * (sec(FM.x + dx).wd - 0.3)), r, 4));
        w.push(rod([MM.x, 32, sd * 0.25], dk(MM.x + dx, sd * (sec(MM.x + dx).wd - 0.3)), r, 4));
      });
      // антенны между мачтами
      w.push(rod([FM.x, 36.5, sd * 4.3], [MM.x, 34.5, sd * 3.6], 0.02, 3));
    });
    // топенанты грузовых стрел (от мачты к ноку стрелы)
    w.push(rod([FM.x + 0.3, 33, 0], [FM.x + 0.7 + 11.2, deckY(FM.x) + 3 + 8.6, 0], r, 4));
    w.push(rod([FM.x - 0.3, 33, 0], [FM.x - 0.7 - 9.2, deckY(FM.x) + 3 + 8.1, 0], r, 4));
    w.push(rod([MM.x - 0.3, 31, 0], [MM.x - 0.7 - 9.2, deckY(MM.x) + 3 + 7.6, 0], r, 4));
    mesh(merge(w), M.dark, 'Rigging', mastG);
  }

  // ======================= ГРУЗОВЫЕ СТРЕЛЫ (подвижные: поворот вокруг вертикали через пятку)
  const derG = group('Derricks', ship);
  {
    const derrick = (name, hx, hy, dx, dy) => {
      const g = group(name, derG, hx, hy, 0);
      const len = Math.hypot(dx, dy);
      const geo = merge([
        latheX([[0.0, -0.25], [0.22, -0.2], [0.28, len * 0.45], [0.16, len - 0.15], [0.0, len]], 10),
        latheX([[0.3, -0.2], [0.3, 0.25]], 10, { bottom: true }),
      ]);
      geo.rotateZ(Math.atan2(dy, Math.abs(dx)));
      if (dx < 0) geo.rotateY(Math.PI);
      mesh(geo, M.buff, `${name}_Boom`, g);
      return g;
    };
    derrick('Derrick_Fore_1', FM.x + 0.7, deckY(FM.x) + 3.0, 11.2, 8.6);
    derrick('Derrick_Fore_2', FM.x - 0.7, deckY(FM.x) + 3.0, -9.2, 8.1);
    derrick('Derrick_Aft_1', MM.x - 0.7, deckY(MM.x) + 3.0, -9.2, 7.6);
  }

  // ======================= ЛЕЕРА (плиточная текстура с альфа-маской)
  {
    const strips = [];
    const run = (pts, closed = false) => {
      const m = new Mesher();
      const P = closed ? [...pts, pts[0]] : pts;
      let per = 0;
      const B = [], T = [];
      P.forEach((p, i) => {
        if (i > 0) per += Math.hypot(p[0] - P[i - 1][0], p[2] - P[i - 1][2]);
        const u = clamp01(per / (RAIL_TILE * RAIL_REP));
        B.push(m.v(V3(p[0], p[1], p[2]), u, 0.0));
        T.push(m.v(V3(p[0], p[1] + RAIL_H, p[2]), u, 1.0));
      });
      m.strip(B, T);
      strips.push(m.build({ orient: false }));
    };
    const inset = 0.12;
    // бак: правый борт → форштевень → левый борт
    {
      const xs = stationXs.filter((x) => x >= T1.x1 + 0.5 && x < XF - 1.2);
      const pts = [];
      xs.forEach((x) => pts.push([x, deckY(x), Math.max(0.05, sec(x).wd - inset)]));
      const back = [...xs].reverse().map((x) => [x, deckY(x), -Math.max(0.05, sec(x).wd - inset)]);
      run([...pts, ...back]);
    }
    // ют: от надстройки вдоль борта вокруг кормы
    {
      const xs = stationXs.filter((x) => x <= T1.x0 - 0.5 && x > XS + 1.2);
      const pts = [...xs].reverse().map((x) => [x, deckY(x), Math.max(0.05, sec(x).wd - inset)]);
      const back = xs.map((x) => [x, deckY(x), -Math.max(0.05, sec(x).wd - inset)]);
      run([...pts, ...back]);
    }
    // кромка крыши яруса 1 (прогулочная галерея) — по бортам и торцам
    {
      const xs = stationXs.filter((x) => x >= T1.x0 && x <= T1.x1);
      const sideS = xs.map((x) => [x, T1.top, sec(x).wd - inset]);
      const front = [[T1.x1 - inset, T1.top, sec(T1.x1).wd - inset], [T1.x1 - inset, T1.top, -(sec(T1.x1).wd - inset)]];
      const sideP_ = [...xs].reverse().map((x) => [x, T1.top, -(sec(x).wd - inset)]);
      const aft = [[T1.x0 + inset, T1.top, -(sec(T1.x0).wd - inset)], [T1.x0 + inset, T1.top, sec(T1.x0).wd - inset]];
      sideS[0][0] += inset;
      sideS[sideS.length - 1][0] -= inset;
      sideP_[0][0] -= inset;
      sideP_[sideP_.length - 1][0] += inset;
      run([...sideS, ...front, ...sideP_, ...aft], true);
    }
    // кромки шлюпочной и солнечной палуб, крыша ходовой рубки, крылья мостика
    const insetPoly = (poly, d) => {
      const c = poly.reduce((s, [x, z]) => [s[0] + x, s[1] + z], [0, 0]).map((v) => v / poly.length);
      return poly.map(([x, z]) => {
        const n = poly.length;
        void n;
        return [x, z, c];
      });
    };
    void insetPoly;
    const shrink = (x0, x1, hw, rA, rF, d) => roundRect2(x0 + d, x1 - d, hw - d, Math.max(0.2, rA - d), Math.max(0.2, rF - d));
    run(shrink(T2.x0, T2.x1, T2.hw, T2.rA, T2.rF, inset).map(([x, z]) => [x, T2.top, z]), true);
    run(shrink(T3.x0, T3.x1, T3.hw, T3.rA, T3.rF, inset).filter(([x]) => true).map(([x, z]) => [x, T3.top, z]), true);
    run(shrink(T4.x0, T4.x1, T4.hw, T4.rA, T4.rF, inset).map(([x, z]) => [x, T4.top, z]), true);
    [1, -1].forEach((sd) => {
      run([
        [33.0 + inset, T3.top, sd * (T3.hw + 0.05)],
        [33.0 + inset, T3.top, sd * (11.3 - inset)],
        [36.0 - 0.1, T3.top, sd * (11.3 - inset)],
      ]);
    });
    mesh(merge(strips), M.rail, 'Railings', ship);
  }

  // ======================= ВИНТЫ И РУЛЬ
  const propG = group('Propulsion', ship);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.5, r1: PROP.r, chord0: 0.9, chord1: 1.45, pitch: 3.6, skew: 0.25, tc: 0.12 });
    const bl = [0, 1, 2, 3].map((i) => blade.clone().rotateX((i * Math.PI) / 2));
    const hub = latheX([[0.0, 0.75], [0.4, 0.55], [0.5, 0.1], [0.5, -0.45], [0.38, -0.6], [0.0, -1.25]], 16);
    const propR = merge([...bl, hub]);
    const propL = mirrorZ(propR);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Propeller_R' : 'Propeller_L', propG, PROP.x, PROP.y, sd * PROP.z);
      mesh(sd > 0 ? propR : propL, M.bronze, `${g.name}_Blades`, g);
      props[sd > 0 ? 'R' : 'L'] = g;
    });
    // руль: полубалансирный, баллер по Y
    const rg = group('Rudder', propG, RUD.x, RUD.y0, 0);
    const yIn = Math.max(keelYAt(RUD.x - 3.0), keelYAt(RUD.x + 1.0)) - RUD.y0 + 0.5;
    const f = foil({ root: [1.0, -3.0], tip: [0.9, -2.7], span: yIn, tc: 0.16, y0: 0, nSpan: 4 });
    mesh(merge([f]), M.bottom, 'Rudder_Blade', rg);
  }

  // Анимация: винты вращаются навстречу (правый — по часовой с кормы), 2 об/с — клип 0,5 с, 9 ключей
  {
    const T = 0.5;
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
    props.R.rotation.x = 4 * Math.PI * t;
    props.L.rotation.x = -4 * Math.PI * t;
  };
  ship.userData.pose = (k = 0) => {
    find('Rudder').rotation.y = k * 0.6;
    find('Derrick_Fore_1').rotation.y = k * 0.7;
    find('Derrick_Fore_2').rotation.y = -k * 0.6;
    find('Derrick_Aft_1').rotation.y = k * 0.8;
  };
  ship.userData.waterline = WL;
  ship.userData.stats = stats;
  return ship;
}
