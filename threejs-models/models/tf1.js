import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Торпедолов (Torpedofangboot) TF 1 Кригсмарине — тип «A III» постройки 1941 г. (Deutsche Werft, Гамбург).
// Источник размерений: длина 62,0 м, ширина 6,66 м, осадка 2,18–2,40 м, 381–489 т, два ТЗА Шихау 6000 л. с.,
// два винта, 23,5 уз, две 20-мм зенитки, стеллажи на 14 торпед на палубе. Проект — развитие миноносцев A III 1916 г.
// Детальная компоновка в источниках не найдена: полубак с мостиком, одна труба, длинная низкая палуба с
// торпедными стеллажами, поворотный кран и наклонный слип в корме — правдоподобная реконструкция.
// Масштаб 1:1 в метрах. Ось Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния — y = 2.3 (осадка).
// Подвижные части — отдельные группы с нулевым поворотом в покое и началом на оси движения.

const WL = 2.3;
const ATLAS = 2048;
const HL = {
  XS: -30.85, // транец (кромка палубы)
  XE: 31.15, // форштевень на уровне палубы бака
  B: 3.33, // полуширина
  XF0: 3.0, // начало носового заострения
  XA0: -9.0, // начало кормового сужения
  XBRK: 14.0, // срез полубака
  NL: 14, // точек на скуле (киль → полная ширина)
  NU: 6, // борт до главной палубы
  NF: 6, // борт полубака
  ND: 12, // сегментов палубы поперёк
  N: 150, // шпангоутов
};
const QL = 0.6;
const QF = 0.35;

// Главная палуба и палуба бака (седловатость)
export const yMain = (x) => 3.95 + 0.22 * smooth((HL.XBRK - x) / (HL.XBRK - HL.XS));
export const yFc = (x) => 5.85 + 0.85 * clamp01((x - HL.XBRK) / (HL.XE - HL.XBRK)) ** 1.6;

function sec(xn) {
  const B = HL.B;
  let W = B, Wd = B, yk = 0, yb = 1.15, nb = 2.7, rake = 0, s = 0;
  if (xn > HL.XF0) {
    s = clamp01((xn - HL.XF0) / (HL.XE - HL.XF0));
    W = B * Math.max(0, 1 - s ** 1.8) ** 0.7;
    Wd = B * Math.max(0, 1 - s ** 2.3) ** 0.55;
    yk = 2.5 * clamp01((s - 0.62) / 0.38) ** 2;
    yb = 1.15 + 2.6 * s ** 1.3;
    nb = 2.7 - 1.0 * s;
    rake = -0.1 * s * s;
  } else if (xn < HL.XA0) {
    s = clamp01((HL.XA0 - xn) / (HL.XA0 - HL.XS));
    W = B * (1 - 0.42 * s ** 2.2);
    Wd = B * (1 - 0.27 * s ** 2.4);
    yk = 2.05 * s ** 1.7;
    yb = 1.15 + 1.55 * s * s;
    nb = 2.7 - 0.5 * s;
    rake = 0.3 * s ** 3;
  }
  W = Math.max(W, 0.04);
  Wd = Math.max(Wd, 0.04);
  const fore = xn >= HL.XBRK - 1e-9;
  const yM = yMain(xn), yF = yFc(xn);
  yb = Math.min(yb, yM - 0.6);
  return { xn, s, W, Wd, yk, yb, nb, rake, yM, yF, yR: xn > HL.XBRK ? yF : yM, fore };
}
const camber = (W, z) => 0.1 * Math.min(1, W / HL.B) * (1 - Math.min(1, (z / W) ** 2));
export function deckHalf(x) {
  const c = sec(x);
  return zUp(c, x >= HL.XBRK ? c.yF : c.yM);
}
export function deckTop(x, z = 0) {
  const c = sec(x);
  const top = x >= HL.XBRK ? c.yF : c.yM;
  const W = zUp(c, top);
  return top + camber(W, Math.min(Math.abs(z), W));
}
// Высота днища в точке (x, |z|) — по шпангоуту без учёта наклона (для подводных выступов)
function hullY(x, z) {
  const c = sec(x);
  const az = Math.abs(z);
  if (az >= c.W) return c.yb;
  let lo = 0, hi = QL;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sideYZ(c, m)[1] < az) lo = m;
    else hi = m;
  }
  return sideYZ(c, (lo + hi) / 2)[0];
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

const zUp = (c, y) => c.W + (c.Wd - c.W) * clamp01((y - c.yb) / (c.yF - c.yb)) ** 1.3;
// Точка борта (z ≥ 0) по параметру q: 0 — киль, QL — скула, 1 — уровень юта, 1 + QF — палуба бака
function sideYZ(c, q) {
  if (q <= QL) {
    const th = -Math.PI / 2 + (q / QL) * (Math.PI / 2);
    const e = 2 / c.nb;
    return [c.yb - (c.yb - c.yk) * Math.abs(Math.sin(th)) ** e, c.W * Math.abs(Math.cos(th)) ** e];
  }
  if (q <= 1) {
    const y = lerp(c.yb, c.yM, (q - QL) / (1 - QL));
    return [y, zUp(c, y)];
  }
  const y = lerp(c.yM, c.yF, (q - 1) / QF);
  return [y, zUp(c, y)];
}
const xAt = (c, y) => c.xn + c.rake * (c.yR - y);
const sideP = (c, q) => {
  const [y, z] = sideYZ(c, q);
  return V3(xAt(c, y), y, z);
};
const qTop = (c) => (c.fore ? 1 + QF : 1);
function arcTo(c, q) {
  const n = Math.max(2, Math.ceil(q * 100));
  let a = 0;
  let prev = sideP(c, 0);
  for (let i = 1; i <= n; i++) {
    const p = sideP(c, (q * i) / n);
    a += p.distanceTo(prev);
    prev = p;
  }
  return a;
}
const stationXs = (() => {
  const xs = [];
  for (let i = 0; i <= HL.N; i++) {
    const t = i / HL.N;
    const u = 0.5 * t + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    xs.push(HL.XS + (HL.XE - HL.XS) * u);
  }
  // точный шпангоут на срезе полубака
  let k = 0;
  xs.forEach((x, i) => {
    if (Math.abs(x - HL.XBRK) < Math.abs(xs[k] - HL.XBRK)) k = i;
  });
  xs[k] = HL.XBRK;
  return xs;
})();
const GIRTH = Math.max(...stationXs.map((x) => arcTo(sec(x), 1 + QF))) * 1.01;

// UV атласа: борт v 0.505…0.995, палубы 0.255…0.495, надстройки 0.005…0.245
const UX0 = -31.6, UX1 = 31.8;
const U = (x) => 0.005 + (0.99 * (x - UX0)) / (UX1 - UX0);
const xOfU = (u) => UX0 + ((u - 0.005) / 0.99) * (UX1 - UX0);
const V_SIDE = (arc) => 0.505 + (0.49 * arc) / GIRTH;
const ZD = 3.45;
const V_DECK = (z) => 0.255 + (0.24 * (z + ZD)) / (2 * ZD);

function qForY(c, y) {
  let lo = 0, hi = qTop(c);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sideYZ(c, m)[0] < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
// Точка борта на высоте y у абсциссы x: z, UV и нормаль (правый борт)
export function sideAt(x, y) {
  const f = (xn) => {
    const c = sec(xn);
    return xAt(c, Math.min(c.fore ? c.yF : c.yM, Math.max(c.yk, y)));
  };
  if (x < f(HL.XS) || x > f(HL.XE)) return null;
  let lo = HL.XS, hi = HL.XE;
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < x) lo = m;
    else hi = m;
  }
  const c = sec((lo + hi) / 2);
  const top = c.fore ? c.yF : c.yM;
  if (y < c.yk - 1e-3 || y > top + 1e-3) return null;
  const q = qForY(c, y);
  const [, z] = sideYZ(c, q);
  const p0 = sideP(c, q);
  const pq = sideP(c, Math.min(qTop(c), q + 0.004)).sub(sideP(c, Math.max(0, q - 0.004)));
  const px = sideP(sec(c.xn + 0.02), q).sub(p0);
  const n = new THREE.Vector3().crossVectors(px, pq).normalize();
  if (n.z < 0) n.negate();
  return { z, u: U(x), v: V_SIDE(arcTo(c, q)), n, q, c };
}
// Высота днища по диаметральной плоскости у абсциссы x
function keelY(x) {
  let lo = HL.XS, hi = HL.XE;
  const f = (xn) => {
    const c = sec(xn);
    return xAt(c, c.yk);
  };
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < x) lo = m;
    else hi = m;
  }
  return sec((lo + hi) / 2).yk;
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
  P(i) {
    return V3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  // треугольник с нормалью в сторону want
  triN(a, b, c, want) {
    const pa = this.P(a);
    const n = this.P(b).sub(pa).cross(this.P(c).sub(pa));
    if (n.dot(want) < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
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
  orientNow() {
    if (signedVolume(this.pos, this.idx) < 0) {
      for (let i = 0; i < this.idx.length; i += 3) [this.idx[i + 1], this.idx[i + 2]] = [this.idx[i + 2], this.idx[i + 1]];
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
      if (b.sub(a).cross(c.sub(a)).length() > 2e-7) keep.push(i0, i1, i2);
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

// Тело вращения вокруг Y по профилю [[r, y], ...] снизу вверх; r = 0 на конце — полюс
function lathe(profile, seg = 20, { top = true, bottom = false } = {}) {
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
  // обход выше получается внутрь — разворачиваем (нормали наружу)
  for (let i = 0; i < m.idx.length; i += 3) [m.idx[i + 1], m.idx[i + 2]] = [m.idx[i + 2], m.idx[i + 1]];
  return m.build({ orient: false });
}
// То же, ось вращения +X (профиль [[r, x], ...])
const latheX = (profile, seg, opt) => lathe(profile, seg, opt).rotateZ(-Math.PI / 2);

// Стержень между двумя точками (caps: 'both' | 'a' | 'b' | 'none')
function rod(a, b, r, seg = 8, caps = 'both') {
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  const prof = [];
  prof.push([r, 0], [r, len]);
  const g = lathe(prof, seg, { top: caps === 'both' || caps === 'b', bottom: caps === 'both' || caps === 'a' });
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}
// Ящик; noBottom — без нижней грани (стоит на поверхности)
function box(sx, sy, sz, x = 0, y = 0, z = 0, { noBottom = false } = {}) {
  const m = new Mesher();
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    [V3(1, 0, 0), [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [V3(-1, 0, 0), [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [V3(0, 1, 0), [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [V3(0, -1, 0), [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [V3(0, 0, 1), [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [V3(0, 0, -1), [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  faces.forEach(([n, q]) => {
    if (noBottom && n.y < 0) return;
    const ids = q.map((p, i) => m.v(V3(p[0] + x, p[1] + y, p[2] + z), i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0));
    m.triN(ids[0], ids[1], ids[2], n);
    m.triN(ids[0], ids[2], ids[3], n);
  });
  return m.build({ orient: false });
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
    m.triN(front[a], front[b], front[c], V3(0, 0, 1));
    m.triN(back[a], back[b], back[c], V3(0, 0, -1));
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = m.v(V3(pts[i].x, pts[i].y, th / 2), i / n, 0);
    const b = m.v(V3(pts[j].x, pts[j].y, th / 2), (i + 1) / n, 0);
    const c = m.v(V3(pts[j].x, pts[j].y, -th / 2), (i + 1) / n, 1);
    const d = m.v(V3(pts[i].x, pts[i].y, -th / 2), i / n, 1);
    const out = V3(pts[j].y - pts[i].y, -(pts[j].x - pts[i].x), 0); // CCW: наружу справа от ребра
    m.triN(a, d, c, out);
    m.triN(a, c, b, out);
  }
  return m.build({ orient: false });
}

const polyArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
};
const perimeter = (poly, closed = true) => {
  let p = 0;
  for (let i = 0; i < poly.length - (closed ? 0 : 1); i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
};

// Выдавливание по Y многоугольника [[x, z], ...] (с отверстиями) от y0 до y1.
// uvSide(per, y) — UV стенок по периметру, uvTop/uvBottom(x, z) — UV крышек; null — крышки нет
function extrudeY(poly, y0, y1, { holes = [], uvSide = () => [0.5, 0.5], uvTop = () => [0.5, 0.5], uvBottom = null, top = true } = {}) {
  const m = new Mesher();
  const walls = (loop, isHole) => {
    const a = polyArea(loop);
    const sgn = (a > 0 ? 1 : -1) * (isHole ? -1 : 1);
    let per = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-6) continue;
      const out = V3(sgn * (q[1] - p[1]), 0, -sgn * (q[0] - p[0]));
      const A = m.v(V3(p[0], y0, p[1]), ...uvSide(per, y0));
      const Bv = m.v(V3(q[0], y0, q[1]), ...uvSide(per + len, y0));
      const C = m.v(V3(q[0], y1, q[1]), ...uvSide(per + len, y1));
      const D = m.v(V3(p[0], y1, p[1]), ...uvSide(per, y1));
      m.triN(A, Bv, C, out);
      m.triN(A, C, D, out);
      per += len;
    }
  };
  walls(poly, false);
  holes.forEach((h) => walls(h, true));
  const caps = (y, uvf, up) => {
    const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
    const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [...contour, ...hs.flat()];
    const ids = all.map((p) => m.v(V3(p.x, y, p.y), ...uvf(p.x, p.y)));
    tris.forEach(([a, b, c]) => m.triN(ids[a], ids[b], ids[c], V3(0, up ? 1 : -1, 0)));
  };
  if (top && uvTop) caps(y1, uvTop, true);
  if (uvBottom) caps(y0, uvBottom, false);
  return m.build({ orient: false });
}
// Ломаная [[x, z], ...] со смещённой внутрь копией — тонкая стенка толщиной th (многоугольник)
function offsetPath(path, d) {
  const n = path.length;
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    let k = 1;
    if (i > 0 && i < n - 1) {
      const t1 = [p[0] - a[0], p[1] - a[1]], t2 = [b[0] - p[0], b[1] - p[1]];
      const l1 = Math.hypot(...t1), l2 = Math.hypot(...t2);
      const c = (t1[0] * t2[0] + t1[1] * t2[1]) / (l1 * l2);
      k = 1 / Math.max(0.5, Math.sqrt((1 + c) / 2));
    }
    return [p[0] - tz * d * k, p[1] + tx * d * k];
  });
}
const wallPoly = (path, th) => [...path, ...offsetPath(path, th).reverse()];
// Лофт многоугольников [[x, z], ...] одинаковой длины по уровням [{ poly, y }], крышки снизу и сверху
function loftPoly(levels) {
  const m = new Mesher();
  const n = levels[0].poly.length;
  const sgn = polyArea(levels[0].poly) > 0 ? 1 : -1;
  const rows = levels.map(({ poly, y }) => poly.map(([x, z]) => m.v(V3(x, y, z), 0.5, 0.5)));
  for (let k = 0; k < levels.length - 1; k++) {
    const P0 = levels[k].poly;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const out = V3(sgn * (P0[j][1] - P0[i][1]), 0, -sgn * (P0[j][0] - P0[i][0]));
      const A = rows[k][i], B = rows[k][j], C = rows[k + 1][j], D = rows[k + 1][i];
      m.triN(A, B, C, out);
      m.triN(A, C, D, out);
    }
  }
  [0, levels.length - 1].forEach((k, e) => {
    const tris = THREE.ShapeUtils.triangulateShape(levels[k].poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const ids = levels[k].poly.map(([x, z]) => m.v(V3(x, levels[k].y, z), 0.5, 0.5));
    tris.forEach(([a, b, c]) => m.triN(ids[a], ids[b], ids[c], V3(0, e ? 1 : -1, 0)));
  });
  return m.build({ orient: false });
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
    for (const t of ts) ring.push(V3(le - t * ch, y, Math.max(0.006, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(V3(le - ts[j] * ch, y, -Math.max(0.006, naca(ts[j]) * tc * ch)));
    rings.push(ring);
  }
  return loftRings(rings, (p) => [clamp01((p.x - root[1]) / (root[0] - root[1] + 1e-6)), clamp01((p.y - y0) / span)]);
}
// Лопасть винта: радиальная ось +Y, ось вращения X
function bladeGeometry({ r0, r1, chord0, chord1, pitch, skew = 0, tc = 0.1, n = 7 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = lerp(chord0, chord1, s) * (k === n ? 0.55 : 1);
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

// ---------------------------------------------------------------------------
// АТЛАС: слоты надстроек в полосе v 0.005…0.245 (плотность ~26 px/м)

const DENS = 34;
function makePacker() {
  const S = ATLAS;
  let x = 6, y = Math.round((1 - 0.245) * S), rowH = 0;
  const yMax = Math.round((1 - 0.005) * S);
  return (wM, hM) => {
    const w = Math.ceil(wM * DENS) + 4, h = Math.ceil(hM * DENS) + 4;
    if (x + w > S - 6) {
      x = 6;
      y += rowH + 4;
      rowH = 0;
    }
    if (y + h > yMax) throw new Error('атлас: нет места для слота');
    const slot = { px: x + 2, py: y + 2, pw: w - 4, ph: h - 4 };
    x += w + 4;
    rowH = Math.max(rowH, h);
    slot.u0 = slot.px / S;
    slot.u1 = (slot.px + slot.pw) / S;
    slot.v1 = 1 - slot.py / S; // верх слота
    slot.v0 = 1 - (slot.py + slot.ph) / S;
    return slot;
  };
}


// ---------------------------------------------------------------------------

export function createTF1() {
  const ship = new THREE.Group();
  ship.name = 'Torpedo_Recovery_Vessel_TF1';
  const pack = makePacker();
  const houses = [];
  const SL = {
    roof: pack(5, 3),
    black: pack(1.2, 1.2),
    torp: pack(7.3, 0.4),
  };
  const roofUV = (x, z) => [lerp(SL.roof.u0, SL.roof.u1, clamp01((x + 31) / 62)), lerp(SL.roof.v0, SL.roof.v1, clamp01((z + 3.5) / 7))];
  const blackUV = () => [(SL.black.u0 + SL.black.u1) / 2, (SL.black.v0 + SL.black.v1) / 2];
  const deckUV = (x, z) => [U(x), V_DECK(z)];

  const house = (name, outline, y0, y1, opt = {}) => {
    const P = perimeter(outline);
    const slot = pack(P, y1 - y0);
    const rec = { name, outline, P, y0, y1, slot, ...opt };
    houses.push(rec);
    return extrudeY(outline, y0, y1, {
      uvSide: (per, y) => [lerp(slot.u0, slot.u1, per / P), lerp(slot.v0, slot.v1, (y - y0) / (y1 - y0))],
      uvTop: opt.roof === false ? null : opt.roofUV || roofUV,
      top: opt.roof !== false,
    });
  };
  const rrect = (x0, x1, hw, rf = 0, ra = 0, nArc = 5) => {
    const pts = [];
    const arc = (cx, cz, r, a0, a1) => {
      if (r <= 0) {
        pts.push([cx, cz]);
        return;
      }
      for (let i = 0; i <= nArc; i++) {
        const a = lerp(a0, a1, i / nArc);
        pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
      }
    };
    arc(x1 - rf, -hw + rf, rf, -Math.PI / 2, 0);
    arc(x1 - rf, hw - rf, rf, 0, Math.PI / 2);
    arc(x0 + ra, hw - ra, ra, Math.PI / 2, Math.PI);
    arc(x0 + ra, -hw + ra, ra, Math.PI, (3 * Math.PI) / 2);
    return pts;
  };
  const circle = (cx, cz, r, n) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    return pts;
  };

  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    atlas: std('Ship_Paint_Atlas', 0xffffff, 0.7, 0.15),
    grey: std('Paint_Grey', 0x91979a, 0.6, 0.2),
    dark: std('Steel_Dark', 0x2b2e31, 0.6, 0.45),
    anti: std('Antifouling_Dark', 0x3e2b27, 0.75, 0.1),
    bronze: std('Propeller_Bronze', 0xa47a45, 0.35, 0.9),
    wire: std('Rigging_Wire', 0x26282a, 0.55, 0.5),
    canvas: std('Canvas_Covers', 0x6c6d5e, 0.9, 0.0),
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
  const dk = (g, x, z = 0, dy = 0) => g.translate(x, deckTop(x, z) + dy, z);

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  const BH = { slot: pack(2 * HL.B, yFc(HL.XBRK) + 0.2 - yMain(HL.XBRK)) };
  {
    const m = new Mesher();
    const qs = [];
    for (let i = 0; i <= HL.NL; i++) qs.push((QL * i) / HL.NL);
    for (let j = 1; j <= HL.NU; j++) qs.push(QL + ((1 - QL) * j) / HL.NU);
    const qf = [];
    for (let j = 1; j <= HL.NF; j++) qf.push(1 + (QF * j) / HL.NF);
    const deckRow = (c, top) => {
      const W = zUp(c, top);
      const D = [];
      for (let j = 0; j <= HL.ND; j++) {
        const z = W * (1 - (2 * j) / HL.ND);
        const y = top + camber(W, z);
        const p = V3(xAt(c, y), y, z);
        D.push(m.v(p, U(p.x), V_DECK(z)));
      }
      return D;
    };
    const rings = [];
    for (const xn of stationXs) {
      const c = sec(xn);
      const S = [], Pt = [];
      const add = (q) => {
        const p = sideP(c, q);
        const uv = [U(p.x), V_SIDE(arcTo(c, q))];
        S.push(m.v(p, ...uv));
        Pt.push(m.v(V3(p.x, p.y, -p.z), ...uv));
      };
      qs.forEach(add);
      if (xn === HL.XBRK) {
        rings.push({ c, S: [...S], P: [...Pt], D: deckRow(c, c.yM), fore: false, brk: true });
        const nLow = S.length;
        qf.forEach(add);
        rings.push({ c, S, P: Pt, D: deckRow(c, c.yF), fore: true, brk: true, nLow });
      } else if (xn > HL.XBRK) {
        qf.forEach(add);
        rings.push({ c, S, P: Pt, D: deckRow(c, c.yF), fore: true });
      } else rings.push({ c, S, P: Pt, D: deckRow(c, c.yM), fore: false });
    }
    let brkA = null, brkB = null;
    for (let k = 0; k < rings.length - 1; k++) {
      const a = rings[k], b = rings[k + 1];
      if (a.brk && b.brk) {
        brkA = a;
        brkB = b;
        continue;
      }
      m.strip(a.S, b.S);
      m.strip(b.P, a.P);
      m.strip(a.D, b.D);
    }
    [0, rings.length - 1].forEach((k) => {
      const r = rings[k];
      const loop = [...r.S, ...r.D.slice(1, -1), ...[...r.P].reverse().slice(0, -1)];
      const c = new THREE.Vector3();
      loop.forEach((i) => c.add(m.P(i)));
      c.divideScalar(loop.length);
      const mid = r.S[Math.floor(r.S.length / 2)];
      const ci = m.v(c, m.uv[mid * 2], m.uv[mid * 2 + 1]);
      for (let j = 0; j < loop.length; j++) {
        if (k === 0) m.tri(ci, loop[j], loop[(j + 1) % loop.length]);
        else m.tri(ci, loop[(j + 1) % loop.length], loop[j]);
      }
    });
    m.orientNow();
    // переборка среза полубака (смотрит в корму)
    {
      const x = HL.XBRK;
      const pts = [];
      const S = brkB.S, Pp = brkB.P;
      for (let i = brkB.nLow - 1; i < S.length; i++) pts.push(m.P(S[i]));
      brkB.D.slice(1, -1).forEach((i) => pts.push(m.P(i)));
      for (let i = Pp.length - 1; i >= brkB.nLow - 1; i--) pts.push(m.P(Pp[i]));
      [...brkA.D].reverse().slice(1, -1).forEach((i) => pts.push(m.P(i)));
      const y0 = yMain(x), y1 = yFc(x) + 0.2;
      const sl = BH.slot;
      const ids = pts.map((p) => m.v(V3(x, p.y, p.z), lerp(sl.u0, sl.u1, (p.z + HL.B) / (2 * HL.B)), lerp(sl.v0, sl.v1, (p.y - y0) / (y1 - y0))));
      const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.z, p.y)), []);
      tris.forEach(([a, b, c]) => m.triN(ids[a], ids[b], ids[c], V3(-1, 0, 0)));
    }
    mesh(m.build({ orient: false }), M.atlas, 'Hull_Shell', hullG);
  }

  // Подводные выступы: валы, кронштейны, скуловые кили, кормовой скег
  const PROP = { x: -26.3, z: 1.45, r: 0.7 };
  PROP.y = Math.max(PROP.r + 0.08, Math.min(hullY(PROP.x + 0.3, PROP.z), hullY(PROP.x, PROP.z - PROP.r)) - PROP.r - 0.14);
  const RUD = { x: -29.0 };
  RUD.y1 = hullY(RUD.x, 0) + 0.02;
  RUD.y0 = 0.32;
  {
    const parts = [];
    [1, -1].forEach((sd) => {
      const z = sd * PROP.z;
      // вал: от выхода из корпуса до ступицы
      let xe = PROP.x + 2;
      while (xe < 0 && hullY(xe, PROP.z) > PROP.y - 0.05) xe += 0.25;
      parts.push(latheX([[0.1, PROP.x + 0.35], [0.1, xe + 0.5]], 10, { top: false, bottom: false }).translate(0, PROP.y, z));
      // выкружка вала у корпуса
      parts.push(latheX([[0.1, xe - 1.2], [0.22, xe + 0.2], [0.22, xe + 0.9]], 10, { top: false, bottom: false }).translate(0, PROP.y, z));
      // кронштейн (А-образный): ступица и две стойки к корпусу
      const xb = PROP.x + 0.75;
      parts.push(latheX([[0.0, xb - 0.32], [0.16, xb - 0.2], [0.17, xb + 0.3], [0.1, xb + 0.5]], 12, { top: false }).translate(0, PROP.y, z));
      parts.push(rod([xb, PROP.y, z], [xb, hullY(xb, 0.35) + 0.25, sd * 0.35], 0.06, 8, 'none'));
      const zo = PROP.z + 0.55;
      parts.push(rod([xb, PROP.y, z], [xb, hullY(xb, zo) + 0.25, sd * zo], 0.06, 8, 'none'));
      // скуловой киль
      const rings = [];
      for (let x = -10; x <= 6; x += 2) {
        const c = sec(x);
        const q = QL * 0.62;
        const p = sideP(c, q);
        const pq = sideP(c, q + 0.01).sub(sideP(c, q - 0.01)).normalize();
        const n = V3(0, -pq.z, pq.y).normalize();
        if (n.z < 0) n.negate();
        const tt = Math.min(1, (x + 10) / 4, (6 - x) / 4);
        const w = 0.3 * Math.max(0.15, tt);
        const t = V3(0, pq.y, pq.z).multiplyScalar(0.02);
        const a = p.clone().addScaledVector(n, -0.04), b = p.clone().addScaledVector(n, w);
        rings.push([a.clone().add(t), b.clone().add(t), b.clone().sub(t), a.clone().sub(t)].map((v) => V3(v.x, v.y, sd * v.z)));
      }
      parts.push(loftRings(rings));
    });
    // скег перед рулём
    {
      const pts = [];
      for (let x = -20; x >= -27.6; x -= 0.6) pts.push([x, hullY(x, 0) + 0.15]);
      const bottom = [[-27.6, Math.max(0.55, hullY(-27.6, 0) - 0.55)], [-24.5, hullY(-24.5, 0) - 0.2], [-20, hullY(-20, 0) - 0.02]];
      parts.push(prism([...bottom, ...pts.reverse()], 0.16));
    }
    mesh(merge(parts), M.anti, 'Hull_Appendages', hullG);
  }

  // ======================= НАДСТРОЙКИ
  const supG = group('Superstructure', ship);
  const BR = { x0: 15.0, x1: 19.0, hw: 1.85, y1: 8.25, px0: 14.7, plat: 8.37 };
  const CAS = { x0: -4.6, x1: 8.4, hw: 1.5, y1: 5.5 };
  const FUN = { x: 1.6, rx: 1.25, rz: 0.82, rake: 0.1, top: 10.7 };
  const MAST = { x: 15.35, top: 17.2 };
  {
    const parts = [];
    // мостик: рубка на баке
    {
      const out = rrect(BR.x0, BR.x1, BR.hw, 1.3, 0.2);
      const y0 = deckTop(BR.x0, BR.hw) - 0.06;
      parts.push(house('Bridge_House', out, y0, BR.y1 + 0.02, {
        roof: false,
        windows: { y0: 7.2, y1: 7.8, step: 0.72, w: 0.52, filter: (n) => n[0] > 0.25 || (Math.abs(n[1]) > 0.9) },
        doors: [[BR.x0, 0.9], [BR.x0, -0.9]],
      }));
    }
    // открытый мостик на крыше рубки, с крыльями и фальшбортом
    {
      const out = [[BR.px0, -2.55], [18.6, -2.55], [19.05, -2.1], [19.35, -1.0], [19.45, 0], [19.35, 1.0], [19.05, 2.1], [18.6, 2.55], [BR.px0, 2.55]];
      const sl = pack(perimeter(out), 0.15);
      houses.push({ name: 'Platform', outline: out, P: perimeter(out), y0: BR.y1, y1: BR.plat, slot: sl, plain: true });
      parts.push(extrudeY(out, BR.y1, BR.plat, {
        uvSide: (per, y) => [lerp(sl.u0, sl.u1, per / perimeter(out)), lerp(sl.v0, sl.v1, (y - BR.y1) / (BR.plat - BR.y1))],
        uvTop: deckUV,
        uvBottom: roofUV,
      }));
      const path = [[BR.px0 + 0.9, 2.53], ...out.slice(1, -1).reverse(), [BR.px0 + 0.9, -2.53]];
      const wall = wallPoly(path, 0.06);
      const P = perimeter(wall);
      const slb = pack(P, 1.1);
      houses.push({ name: 'Bridge_Bulwark', outline: wall, P, y0: BR.plat - 0.02, y1: BR.plat + 1.08, slot: slb, plain: true });
      parts.push(extrudeY(wall, BR.plat - 0.02, BR.plat + 1.08, {
        uvSide: (per, y) => [lerp(slb.u0, slb.u1, per / P), lerp(slb.v0, slb.v1, (y - BR.plat + 0.02) / 1.1)],
        uvTop: roofUV,
      }));
      // штурманская будка (ветрозащита) у переднего фальшборта
      parts.push(house('Chart_Hut', rrect(16.0, 17.3, 0.75, 0.3, 0.1), BR.plat - 0.02, BR.plat + 1.35, { doors: [[16.0, 0]] }));
    }
    // кожух машинно-котельного отделения
    {
      const out = rrect(CAS.x0, CAS.x1, CAS.hw, 0.7, 0.5);
      parts.push(house('Casing', out, deckTop(CAS.x0, CAS.hw) - 0.06, CAS.y1, {
        doors: [[CAS.x1, 0], [CAS.x0, 0.6], [-2.6, CAS.hw], [-2.6, -CAS.hw]],
        scuttles: { y: 4.95, filter: (n) => Math.abs(n[1]) > 0.7, step: 2.4 },
      }));
    }
    // площадка кормового автомата (банкет)
    {
      const out = circle(-6.65, 0, 1.25, 24);
      parts.push(house('Flak_Platform', out, deckTop(-6.65, 1.25) - 0.06, deckTop(-6.65) + 1.05, { plain: true }));
    }
    mesh(merge(parts), M.atlas, 'Superstructure_Houses', supG);
  }
  // Дымовая труба: овал с наклоном в корму, открытый верх с тёмным нутром
  {
    const m = new Mesher();
    const NS = 28;
    const y0 = CAS.y1 - 0.08;
    const P = 2 * Math.PI * Math.sqrt((FUN.rx ** 2 + FUN.rz ** 2) / 2);
    const slot = pack(P, FUN.top - y0);
    houses.push({ name: 'Funnel', funnel: true, P, y0, y1: FUN.top, slot });
    const ring = (y, k, uvf) => {
      const ids = [];
      const xc = FUN.x - FUN.rake * (y - y0);
      for (let j = 0; j <= NS; j++) {
        const a = (j / NS) * Math.PI * 2;
        ids.push(m.v(V3(xc + FUN.rx * k * Math.cos(a), y, -FUN.rz * k * Math.sin(a)), ...uvf(j / NS, y)));
      }
      return ids;
    };
    const outer = (t, y) => [lerp(slot.u0, slot.u1, t), lerp(slot.v0, slot.v1, (y - y0) / (FUN.top - y0))];
    const rows = [y0, 6.5, 8.0, 9.4, 10.0, FUN.top].map((y) => ring(y, 1, outer));
    for (let k = 0; k < rows.length - 1; k++) m.strip(rows[k], rows[k + 1]);
    const lip = ring(FUN.top, 0.93, blackUV);
    const rimTop = ring(FUN.top, 1, blackUV);
    m.strip(rimTop, lip);
    const inner = ring(FUN.top - 0.5, 0.93, blackUV);
    m.strip(lip, inner);
    const yb = FUN.top - 0.5;
    const ci = m.v(V3(FUN.x - FUN.rake * (yb - y0), yb, 0), ...blackUV());
    for (let j = 0; j < NS; j++) m.tri(ci, inner[j], inner[j + 1]);
    const g = m.build({ orient: false });
    {
      const n = g.attributes.normal;
      const p = g.attributes.position;
      const i = rows[2][0];
      if (n.getX(i) * (p.getX(i) - FUN.x) < 0) {
        const idx = g.index.array;
        for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
        g.computeVertexNormals();
      }
    }
    mesh(g, M.atlas, 'Funnel', supG);
  }

  // ======================= МАЧТА И ТАКЕЛАЖ
  {
    const parts = [];
    const y0 = BR.plat - 0.04;
    parts.push(lathe([[0.15, y0], [0.13, 12.6], [0.09, 15.0], [0.06, MAST.top], [0, MAST.top + 0.05]], 12, { top: false }).translate(MAST.x, 0, 0));
    // площадка прожектора на мачте
    parts.push(lathe([[0.65, 11.9], [0.65, 12.02], [0, 12.03]], 16, { top: false, bottom: true }).translate(MAST.x, 0, 0));
    // рея и топ-огонь
    parts.push(rod([MAST.x, 14.3, -2.0], [MAST.x, 14.3, 2.0], 0.05, 8));
    parts.push(lathe([[0.08, MAST.top + 0.02], [0.08, MAST.top + 0.22], [0, MAST.top + 0.27]], 8, { top: false }).translate(MAST.x, 0, 0));
    // гюйсшток и флагшток
    const xj = 30.55, xs = -30.35;
    parts.push(lathe([[0.05, deckTop(xj) - 0.05], [0.03, deckTop(xj) + 2.6], [0.06, deckTop(xj) + 2.64], [0, deckTop(xj) + 2.7]], 8, { top: false }).translate(xj, 0, 0));
    parts.push(lathe([[0.06, deckTop(xs) - 0.05], [0.035, deckTop(xs) + 3.6], [0.07, deckTop(xs) + 3.64], [0, deckTop(xs) + 3.72]], 8, { top: false }).translate(xs, 0, 0));
    mesh(merge(parts), M.grey, 'Mast', supG);
    // ванты, штаги, антенна
    const w = [];
    const fd = (x, z) => [x, deckTop(x, z) + 0.04, z];
    [1, -1].forEach((sd) => {
      w.push(rod([MAST.x, 13.8, 0.12 * sd], fd(14.25, sd * (deckHalf(14.25) - 0.2)), 0.018, 5, 'none'));
      w.push(rod([MAST.x - 0.05, 14.25, sd * 1.9], [-30.3, deckTop(-30.3) + 3.4, sd * 0.06], 0.012, 4, 'none'));
    });
    w.push(rod([MAST.x + 0.08, 15.5, 0], [30.8, deckTop(30.8) + 0.4, 0], 0.018, 5, 'none'));
    w.push(rod([MAST.x - 0.08, 15.6, 0], [FUN.x - 0.2, FUN.top - 0.3, 0], 0.016, 5, 'none'));
    mesh(merge(w), M.wire, 'Rigging', supG);
  }

  // ======================= ПАЛУБНОЕ ОБОРУДОВАНИЕ
  const deckG = group('Deck_Equipment', ship);
  const FF = { x: 23.4 }, FA = { x: -6.65 };
  FF.y = deckTop(FF.x) + 0.78;
  FA.y = deckTop(FA.x) + 1.05 + 0.78;
  const CR = { x: -19.7 };
  CR.y = deckTop(CR.x) + 1.35;
  const RAMP = { x0: -23.4, x1: -30.7, hw: 0.5 };
  const TORP = { x: -12.3, L: 7.16, r: 0.2665 };
  const rackX = [-9.1, -12.3, -15.5];
  {
    const parts = [];
    // шпиль, палубные клюзы, кнехты
    parts.push(dk(lathe([[0.36, -0.05], [0.36, 0.1], [0.26, 0.14], [0.22, 0.45], [0.3, 0.52], [0.26, 0.6], [0, 0.63]], 20), 27.0));
    [1, -1].forEach((sd) => {
      const x = 28.7, z = sd * (deckHalf(28.7) - 0.45);
      parts.push(dk(lathe([[0.3, -0.05], [0.3, 0.09], [0.22, 0.12], [0, 0.13]], 14), x, z));
      parts.push(dk(lathe([[0.2, -0.05], [0.2, 0.15], [0.15, 0.17], [0, 0.18]], 12), 26.0, sd * 0.65));
    });
    const bollard = () => {
      const p = () => lathe([[0.1, -0.05], [0.09, 0.28], [0.13, 0.31], [0.13, 0.35], [0, 0.36]], 12);
      return merge([p().translate(0.22, 0, 0), p().translate(-0.22, 0, 0), box(0.66, 0.08, 0.26, 0, 0.0, 0, { noBottom: true })]);
    };
    [[25.0, 0.7], [12.5, 0.8], [-3.5, 0.82], [-22.5, 0.8], [-28.9, 0.72]].forEach(([x, k]) => {
      [1, -1].forEach((sd) => parts.push(dk(bollard(), x, sd * deckHalf(x) * k)));
    });
    // вентиляторы-раструбы
    const cowl = (h, r) => {
      const m = new Mesher();
      const NS = 14;
      const ring = (x, R) => {
        const ids = [];
        for (let j = 0; j <= NS; j++) {
          const a = (j / NS) * Math.PI * 2;
          ids.push(m.v(V3(x, h + R * Math.cos(a), R * Math.sin(a)), j / NS, 0.5));
        }
        return ids;
      };
      const outer = [[-0.25 * r, 0.42 * r], [0, 0.58 * r], [0.35 * r, 0.68 * r], [0.62 * r, 0.86 * r], [0.8 * r, r]];
      const t = 0.03;
      const O = outer.map(([x, R]) => ring(x, R));
      const I = outer.slice(2).map(([x, R]) => ring(x, R - t)).reverse();
      const quadOut = (A, B, inward) => {
        for (let j = 0; j < NS; j++) {
          const c = m.P(A[j]);
          const want = V3(0, c.y - h, c.z).multiplyScalar(inward ? -1 : 1);
          m.triN(A[j], B[j], B[j + 1], want);
          m.triN(A[j], B[j + 1], A[j + 1], want);
        }
      };
      for (let k = 0; k < O.length - 1; k++) quadOut(O[k], O[k + 1], false);
      for (let k = 0; k < I.length - 1; k++) quadOut(I[k], I[k + 1], true);
      const rim = O[O.length - 1], rin = I[0];
      for (let j = 0; j < NS; j++) {
        m.triN(rim[j], rin[j], rin[j + 1], V3(1, 0, 0));
        m.triN(rim[j], rin[j + 1], rim[j + 1], V3(1, 0, 0));
      }
      const bottomI = I[I.length - 1];
      const cI = m.v(V3(outer[2][0], h, 0), 0.5, 0.5);
      for (let j = 0; j < NS; j++) m.triN(cI, bottomI[j], bottomI[j + 1], V3(1, 0, 0));
      const cB = m.v(V3(-0.38 * r, h, 0), 0.5, 0.5);
      for (let j = 0; j < NS; j++) m.triN(cB, O[0][j], O[0][j + 1], V3(-1, 0, 0));
      const stem = lathe([[r * 0.5, -0.05], [r * 0.5, h - 0.2 * r]], 12, { top: false });
      return merge([m.build({ orient: false }), stem]);
    };
    [[9.6, 1.1, 1.15, 0.38], [9.6, -1.1, 1.15, 0.38], [-5.0, 2.15, 0.9, 0.3], [-5.0, -2.15, 0.9, 0.3]].forEach(([x, z, h, r]) => {
      const g = cowl(h, r);
      if (x < 0) g.rotateY(Math.PI);
      parts.push(dk(g, x, z));
    });
    // грибовидные вентиляторы
    [[21.0, 1.2], [21.0, -1.2], [-17.3, 1.9], [-17.3, -1.9], [-26.0, 1.9], [-26.0, -1.9]].forEach(([x, z]) => {
      parts.push(dk(lathe([[0.12, -0.05], [0.12, 0.45], [0.3, 0.5], [0.3, 0.58], [0.15, 0.64], [0, 0.66]], 12), x, z));
    });
    // люки (комингсы)
    [[20.0, 0, 1.1, 1.0], [11.3, 0, 1.0, 0.9], [-22.0, 0, 0.9, 0.9], [-27.6, 1.7, 0.8, 0.8], [-27.6, -1.7, 0.8, 0.8]].forEach(([x, z, a, b]) => {
      const y0 = Math.min(deckTop(x - a / 2, Math.abs(z) + b / 2), deckTop(x + a / 2, Math.abs(z) + b / 2)) - 0.05;
      parts.push(extrudeY(rrect(x - a / 2, x + a / 2, b / 2, 0.1, 0.1, 2).map(([px, pz]) => [px, pz + z]), y0, deckTop(x, z) + 0.36));
    });
    // кранцы первых выстрелов у автоматов
    [[FF.x - 1.9, 1.5], [FF.x - 1.9, -1.5], [-4.9, 2.25], [-4.9, -2.25]].forEach(([x, z]) => {
      parts.push(box(0.8, 0.6, 0.5, x, deckTop(x, z) + 0.26, z, { noBottom: true }));
    });
    // тумбы автоматов
    const ped = (x, yb, yt) => lathe([[0.32, yb - 0.04], [0.32, yb + 0.06], [0.2, yb + 0.12], [0.15, yt - 0.12], [0.24, yt - 0.06], [0.24, yt]], 16, { top: false }).translate(x, 0, 0);
    parts.push(ped(FF.x, deckTop(FF.x, 0.32), FF.y));
    parts.push(ped(FA.x, deckTop(FA.x) + 1.05, FA.y));
    // фальшборт-«стакан» носового автомата
    {
      const path = [];
      for (let i = 0; i <= 14; i++) {
        const a = -Math.PI * 0.78 + (Math.PI * 1.56 * i) / 14;
        path.push([FF.x + 1.45 * Math.cos(a), 1.45 * Math.sin(a)]);
      }
      const y0 = deckTop(FF.x + 1.45, 1.45) - 0.05;
      parts.push(extrudeY(wallPoly(path, 0.05).reverse(), y0, deckTop(FF.x) + 0.95));
    }
    // тумба крана
    parts.push(lathe([[0.5, deckTop(CR.x, 0.5) - 0.05], [0.5, deckTop(CR.x) + 0.12], [0.36, deckTop(CR.x) + 0.2], [0.32, CR.y - 0.08], [0.42, CR.y - 0.02], [0.42, CR.y]], 18, { top: false }).translate(CR.x, 0, 0));
    // трапы со среза полубака
    [1, -1].forEach((sd) => {
      const z = sd * 2.25;
      const xa = HL.XBRK - 1.7, ya = deckTop(xa, z), xb = HL.XBRK - 0.04, yb = deckTop(HL.XBRK + 0.2, z);
      [-0.3, 0.3].forEach((dz) => {
        parts.push(rod([xa, ya - 0.03, z + dz], [xb, yb - 0.02, z + dz], 0.035, 6, 'none'));
        parts.push(rod([xa, ya + 0.9, z + dz], [xb, yb + 0.9, z + dz], 0.022, 6, 'both'));
        parts.push(rod([xa, ya, z + dz], [xa, ya + 0.9, z + dz], 0.022, 6, 'b'));
      });
      for (let i = 1; i < 8; i++) {
        const t = i / 8;
        parts.push(box(0.16, 0.035, 0.56, lerp(xa, xb, t), lerp(ya, yb, t), z));
      }
      // трап на открытый мостик
      const xc = 14.15, yc = deckTop(xc, 1.2), xd = BR.px0 - 0.02, yd = BR.plat;
      const zz = sd * 1.25;
      [-0.25, 0.25].forEach((dz) => parts.push(rod([xc, yc - 0.03, zz + dz], [xd, yd, zz + dz], 0.03, 6, 'none')));
      for (let i = 1; i < 7; i++) parts.push(box(0.12, 0.035, 0.46, lerp(xc, xd, i / 7), lerp(yc, yd, i / 7), zz));
    });
    // подпорки крыльев мостика
    [1, -1].forEach((sd) => {
      [15.4, 18.2].forEach((x) => parts.push(rod([x, BR.y1 - 0.02, sd * 2.4], [x, BR.y1 - 1.0, sd * (BR.hw - 0.02)], 0.05, 6, 'none')));
    });
    // оборудование мостика: нактоуз, пелорусы, отличительные огни
    parts.push(lathe([[0.15, BR.plat - 0.02], [0.11, BR.plat + 0.85], [0.19, BR.plat + 0.95], [0.15, BR.plat + 1.12], [0, BR.plat + 1.16]], 12).translate(18.25, 0, 0));
    [1, -1].forEach((sd) => {
      parts.push(lathe([[0.18, BR.plat - 0.02], [0.16, BR.plat + 1.15], [0, BR.plat + 1.2]], 10).translate(17.9, 0, sd * 2.05));
      parts.push(box(0.3, 0.26, 0.2, 16.0, BR.plat + 1.0, sd * 2.62));
    });
    // прожектор на площадке мачты
    parts.push(lathe([[0.15, 12.0], [0.12, 12.35], [0, 12.36]], 10).translate(MAST.x + 0.25, 0, 0));
    parts.push(latheX([[0.28, -0.3], [0.31, -0.22], [0.31, 0.22], [0.27, 0.27], [0, 0.27]], 16, { top: false, bottom: true }).translate(MAST.x + 0.3, 12.62, 0));
    // сирена и паропровод на трубе
    parts.push(rod([FUN.x + 1.28, CAS.y1 - 0.05, 0.3], [FUN.x + 1.28 - FUN.rake * 4.6, FUN.top - 0.35, 0.3], 0.07, 8, 'b'));
    parts.push(rod([FUN.x - 1.3, CAS.y1 - 0.05, 0], [FUN.x - 1.3 - FUN.rake * 5.3, FUN.top + 0.1, 0], 0.09, 8, 'b'));
    // стеллажи торпед: рамы с ложементами (два яруса, по 4 + 3 торпеды с борта)
    rackX.forEach((x) => {
      [1, -1].forEach((sd) => {
        const yd = deckTop(x, 1.6);
        [0.28, 2.75].forEach((zz) => parts.push(box(0.12, 1.42, 0.12, x, yd + 0.66, sd * zz, { noBottom: true })));
        parts.push(box(0.16, 0.1, 2.62, x, yd + 0.24, sd * 1.515));
        parts.push(box(0.16, 0.1, 2.62, x, yd + 0.82, sd * 1.515));
        parts.push(box(0.16, 0.08, 2.62, x, yd + 1.41, sd * 1.515));
      });
    });
    // слип для подъёма торпед в корме: наклонные направляющие на стойках
    {
      const yA = deckTop(RAMP.x0) + 0.95, yB = deckTop(RAMP.x1) + 0.16;
      const yAt = (x) => lerp(yA, yB, (RAMP.x0 - x) / (RAMP.x0 - RAMP.x1));
      [-1, 1].forEach((sd) => {
        const z = sd * RAMP.hw;
        parts.push(rod([RAMP.x0, yA, z], [RAMP.x1, yB, z], 0.07, 8, 'both'));
        parts.push(rod([RAMP.x0, yA + 0.32, sd * (RAMP.hw + 0.14)], [RAMP.x1 + 0.3, yAt(RAMP.x1 + 0.3) + 0.32, sd * (RAMP.hw + 0.14)], 0.04, 6, 'both'));
        for (let x = RAMP.x0; x > RAMP.x1 + 0.4; x -= 1.4) {
          parts.push(rod([x, deckTop(x, RAMP.hw) - 0.04, z], [x, yAt(x) - 0.03, z], 0.05, 6, 'none'));
          parts.push(rod([x, yAt(x) - 0.03, z], [x, yAt(x) + 0.32, sd * (RAMP.hw + 0.14)], 0.025, 5, 'none'));
        }
      });
    }
    mesh(merge(parts), M.grey, 'Deck_Fittings', deckG);

    // якоря, цепи, ролики слипа (тёмная сталь)
    const dark = [];
    [1, -1].forEach((sd) => {
      const a = [28.7, 0, sd * (deckHalf(28.7) - 0.45)], b = [27.0, 0, sd * 0.28];
      const n = 8;
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.1) / n, t1 = (i + 0.9) / n;
        const x0 = lerp(a[0], b[0], t0), z0 = lerp(a[2], b[2], t0), x1 = lerp(a[0], b[0], t1), z1 = lerp(a[2], b[2], t1);
        const y0 = deckTop(x0, z0) + 0.05, y1 = deckTop(x1, z1) + 0.05;
        dark.push(new THREE.TorusGeometry(0.09, 0.028, 5, 10).scale(1.6, 1, 1).rotateX(i % 2 ? Math.PI / 2 : 0).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2 + (i % 2 ? 0.0 : 0.03), (z0 + z1) / 2));
      }
      // якорь Холла в клюзе на борту
      const y = yFc(29.0) - 1.0;
      const r = sideAt(29.0, y);
      const shank = box(0.13, 0.9, 0.13, 0, 0.05, 0);
      const crown = box(0.7, 0.18, 0.16, 0, -0.45, 0);
      const fl1 = prism([[-0.35, -0.5], [-0.25, -0.5], [-0.15, -0.08], [-0.25, -0.04]], 0.12);
      const fl2 = prism([[0.35, -0.5], [0.25, -0.5], [0.15, -0.08], [0.25, -0.04]], 0.12);
      const anc = merge([shank, crown, fl1, fl2]);
      anc.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), r.n.clone()));
      anc.translate(29.0 + 0.04, y, r.z + 0.05);
      dark.push(sd > 0 ? anc : mirrorZ(anc));
    });
    // ролики слипа и кормовой ролик
    {
      const yA = deckTop(RAMP.x0) + 0.95, yB = deckTop(RAMP.x1) + 0.16;
      for (let x = RAMP.x0 - 0.7; x > RAMP.x1; x -= 1.4) {
        const y = lerp(yA, yB, (RAMP.x0 - x) / (RAMP.x0 - RAMP.x1)) + 0.02;
        dark.push(latheX([[0.09, -RAMP.hw + 0.07], [0.09, RAMP.hw - 0.07]], 10, { top: true, bottom: true }).rotateY(Math.PI / 2).translate(x, y, 0));
      }
      const ys = deckTop(RAMP.x1 + 0.05) + 0.18;
      dark.push(latheX([[0.15, -RAMP.hw - 0.12], [0.15, RAMP.hw + 0.12]], 14, { top: true, bottom: true }).rotateY(Math.PI / 2).translate(RAMP.x1 + 0.02, ys, 0));
    }
    mesh(merge(dark), M.dark, 'Deck_Gear_Dark', deckG);

    // леерное ограждение
    const rl = [];
    const railRun = (pts) => {
      let acc = 99;
      const top = (p) => [p[0], p[1] + 0.95, p[2]];
      const mid = (p) => [p[0], p[1] + 0.5, p[2]];
      pts.forEach((p, i) => {
        if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
        if (acc > 1.8 || i === pts.length - 1 || i === 0) {
          acc = 0;
          rl.push(rod([p[0], p[1] - 0.04, p[2]], top(p), 0.025, 5, 'b'));
        }
        if (i > 0) {
          rl.push(rod(top(pts[i - 1]), top(p), 0.02, 5, 'none'));
          rl.push(rod(mid(pts[i - 1]), mid(p), 0.016, 5, 'none'));
        }
      });
    };
    const edge = (x, sd, inset = 0.12) => {
      const z = sd * (deckHalf(x) - inset);
      return [x, deckTop(x, z), z];
    };
    [1, -1].forEach((sd) => {
      const fc = [];
      for (let x = HL.XBRK + 0.15; x < 30.6; x += 0.85) fc.push(edge(x, sd));
      fc.push([30.85, deckTop(30.85), 0]);
      railRun(fc);
      const qd = [];
      for (let x = HL.XBRK - 0.2; x > -30.5; x -= 0.85) qd.push(edge(x, sd));
      railRun(qd);
      // поперечный леер у среза полубака
      const cr = [];
      for (let z = deckHalf(HL.XBRK + 0.15) - 0.12; z > 2.6; z -= 0.4) cr.push([HL.XBRK + 0.15, deckTop(HL.XBRK + 0.15, z), sd * z]);
      railRun(cr);
      const cr2 = [];
      for (let z = 1.9; z >= 0; z -= 0.6) cr2.push([HL.XBRK + 0.15, deckTop(HL.XBRK + 0.15, z), sd * z]);
      cr2.push([HL.XBRK + 0.15, deckTop(HL.XBRK + 0.15, 0), 0]);
      railRun(cr2);
    });
    // кольцевой леер банкета кормового автомата
    {
      const p = [];
      const yb = deckTop(FA.x) + 1.05;
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        p.push([FA.x + 1.15 * Math.cos(a), yb, 1.15 * Math.sin(a)]);
      }
      railRun(p);
    }
    mesh(merge(rl), M.grey, 'Guard_Rails', deckG);
  }

  // ======================= ПРАКТИЧЕСКИЕ ТОРПЕДЫ НА СТЕЛЛАЖАХ (неподвижный груз)
  {
    const one = () => {
      const L = TORP.L, r = TORP.r, h = L / 2;
      const prof = [[0, -h], [0.05, -h + 0.02], [0.08, -h + 0.25], [0.15, -h + 0.55], [0.23, -h + 0.95], [r, -h + 1.35], [r, h - 0.7], [0.25, h - 0.42], [0.2, h - 0.2], [0.11, h - 0.05], [0, h]];
      const parts = [latheX(prof, 16, { top: false })];
      // хвостовое оперение (крестообразное)
      [0, 1].forEach((k) => {
        const fin = box(0.42, 0.025, 0.72, -h + 0.42, 0, 0);
        if (k) fin.rotateX(Math.PI / 2);
        parts.push(fin);
      });
      // соосные винты
      [-h + 0.08, -h + 0.2].forEach((x) => parts.push(box(0.04, 0.48, 0.07, x, 0, 0), box(0.04, 0.07, 0.48, x, 0, 0)));
      const g = merge(parts);
      // UV по длине торпеды — полосы окраски в слоте атласа
      const pos = g.attributes.position, uv = g.attributes.uv;
      const vm = (SL.torp.v0 + SL.torp.v1) / 2;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, lerp(SL.torp.u0, SL.torp.u1, clamp01((pos.getX(i) + h) / L)), vm);
      return g;
    };
    const list = [];
    rackX.slice(0, 1);
    [1, -1].forEach((sd) => {
      const yd = deckTop(TORP.x, 1.6);
      [0.6, 1.2, 1.8, 2.4].forEach((z) => list.push(one().translate(TORP.x, yd + 0.29 + TORP.r, sd * z)));
      [0.9, 1.5, 2.1].forEach((z) => list.push(one().translate(TORP.x, yd + 0.87 + TORP.r, sd * z)));
    });
    const tg = group('Torpedo_Stowage', deckG);
    mesh(merge(list), M.atlas, 'Practice_Torpedoes', tg);
  }

  // ======================= ШЛЮПКИ НА ШЛЮПБАЛКАХ
  const boatG = group('Boats', ship);
  {
    const hulls = [], covers = [], davits = [];
    const boatPart = (L, Bm, D, cover) => {
      const m = new Mesher();
      const N = 14, M2 = 10;
      const rows = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = (t - 0.5) * L;
        const sn = Math.sin(Math.PI * t);
        const w = (Bm / 2) * Math.max(0.015, sn ** 0.55);
        const d = D * (0.55 + 0.45 * sn ** 0.5);
        const sheer = 0.22 * (2 * t - 1) ** 2;
        const ids = [];
        for (let j = 0; j <= M2; j++) {
          const a = (j / M2) * Math.PI;
          const y = cover ? sheer + 0.26 * Math.sin(a) * sn ** 0.7 : sheer - d * Math.sin(a) ** 1.3;
          ids.push(m.v(V3(x, y, w * Math.cos(a)), t, j / M2));
        }
        rows.push({ ids, x, sheer });
      }
      for (let i = 0; i < N; i++) {
        const A = rows[i].ids, B = rows[i + 1].ids;
        for (let j = 0; j < M2; j++) {
          const c = m.P(A[j]).add(m.P(B[j + 1])).multiplyScalar(0.5);
          const want = c.clone().sub(V3(c.x, (rows[i].sheer + rows[i + 1].sheer) / 2 + (cover ? -0.3 : 0.3), 0));
          m.triN(A[j], B[j], B[j + 1], want);
          m.triN(A[j], B[j + 1], A[j + 1], want);
        }
      }
      [0, N].forEach((i) => {
        const r = rows[i];
        const ci = m.v(V3(r.x, r.sheer, 0), 0.5, 0.5);
        for (let j = 0; j < M2; j++) m.triN(ci, r.ids[j], r.ids[j + 1], V3(i === 0 ? -1 : 1, 0, 0));
      });
      return m.build({ orient: false });
    };
    [1, -1].forEach((sd) => {
      const L = 5.6, Bm = 1.65, D = 0.7;
      const bx = 3.6, bz = sd * 2.5, by = deckTop(bx, 2.5) + 2.0;
      hulls.push(boatPart(L, Bm, D, false).translate(bx, by, bz));
      covers.push(boatPart(L, Bm, D, true).translate(bx, by, bz));
      [bx + 2.2, bx - 2.2].forEach((x) => {
        const zb = sd * (deckHalf(x) - 0.3);
        const yb = deckTop(x, Math.abs(zb));
        const pts = [V3(x, yb - 0.05, zb), V3(x, yb + 2.0, zb), V3(x, yb + 2.85, zb - sd * 0.12), V3(x, yb + 3.05, bz - sd * 0.15)];
        davits.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.075, 8, false));
        davits.push(lathe([[0.075, 0], [0.1, 0.04], [0, 0.06]], 8, { top: false }).translate(x, yb + 3.06, bz - sd * 0.15));
        davits.push(rod([x, yb + 3.0, bz - sd * 0.15], [x, by + 0.1, bz - sd * 0.15], 0.018, 4, 'none'));
        davits.push(box(0.16, 0.24, 0.1, x, by + 0.32, bz - sd * 0.15));
      });
      [bx + 1.5, bx - 1.5].forEach((x) => davits.push(rod([x, by - 0.5, bz - sd * 0.75], [x, by - 0.5, bz + sd * 0.75], 0.04, 6)));
    });
    mesh(merge(hulls), M.grey, 'Boat_Hulls', boatG);
    mesh(merge(covers), M.canvas, 'Boat_Covers', boatG);
    mesh(merge(davits), M.grey, 'Boat_Davits', boatG);
  }

  // ======================= ВООРУЖЕНИЕ: 2-см автоматы C/30 (поворот вокруг вертикали)
  const armsG = group('Armament', ship);
  const flak = () => {
    const p = [];
    const ty = 0.36;
    p.push(lathe([[0.26, -0.03], [0.26, 0.06], [0.18, 0.09], [0, 0.1]], 16));
    [1, -1].forEach((sd) => p.push(prism([[-0.2, 0.06], [0.22, 0.06], [0.1, ty + 0.06], [-0.12, ty + 0.06]], 0.04).translate(0, 0, sd * 0.13)));
    p.push(rod([0, ty, -0.17], [0, ty, 0.17], 0.04, 8));
    // качающаяся часть с возвышением 12°
    const el = merge([
      box(0.75, 0.16, 0.13, -0.05, 0, 0), // ствольная коробка
      latheX([[0.03, 0.3], [0.03, 1.35], [0.045, 1.37], [0.045, 1.53], [0, 1.53]], 8, { top: false, bottom: true }), // ствол с пламегасителем
      latheX([[0.05, 0.25], [0.05, 0.5], [0, 0.5]], 8, { top: false, bottom: true }),
      box(0.22, 0.26, 0.06, 0.05, 0.16, -0.1), // магазин
      box(0.06, 0.1, 0.42, -0.5, -0.1, 0), // плечевые упоры
      new THREE.TorusGeometry(0.1, 0.012, 5, 12).rotateY(Math.PI / 2).translate(0.3, 0.17, 0.12), // прицел
    ]);
    el.rotateZ(THREE.MathUtils.degToRad(12)).translate(0, ty, 0);
    p.push(el);
    // щит
    const sh = prism([[-0.48, -0.38], [0.48, -0.38], [0.48, 0.22], [0.35, 0.36], [-0.35, 0.36], [-0.48, 0.22]], 0.03);
    sh.rotateY(Math.PI / 2).translate(0.32, ty + 0.15, 0);
    p.push(sh);
    [1, -1].forEach((sd) => p.push(prism([[0, -0.36], [0.3, -0.36], [0.3, 0.2], [0, 0.3]], 0.025).translate(0.0, ty + 0.15, 0).rotateY(0).translate(0.32 - 0.3, 0, sd * 0.47)));
    p.push(box(0.12, 0.06, 0.24, -0.5, ty - 0.3, 0.25)); // сиденье/упор наводчика
    p.push(rod([-0.1, 0.08, 0.1], [-0.48, ty - 0.33, 0.25], 0.02, 5));
    return merge(p);
  };
  {
    const g = group('Flak_Fore', armsG, FF.x, FF.y, 0);
    mesh(flak(), M.grey, 'Flak_Fore_Mount', g);
    const g2 = group('Flak_Aft', armsG, FA.x, FA.y, 0);
    mesh(flak().rotateY(Math.PI), M.grey, 'Flak_Aft_Mount', g2);
  }

  // ======================= КРАН ДЛЯ ПОДЪЁМА ТОРПЕД (поворот вокруг вертикали)
  {
    const g = group('Crane', ship, CR.x, CR.y, 0);
    const p = [];
    p.push(lathe([[0.45, 0], [0.45, 0.12], [0.3, 0.16], [0, 0.17]], 18, { top: false, bottom: true }));
    p.push(box(0.8, 1.0, 0.7, 0.05, 0.66, 0)); // колонна-корпус лебёдки
    p.push(latheX([[0.2, -0.42], [0.2, 0.42]], 12, { top: true, bottom: true }).rotateY(Math.PI / 2).translate(0.55, 0.45, 0)); // барабан
    p.push(box(0.5, 0.35, 0.3, 0.45, 0.3, 0.42)); // привод
    // стрела: две трубы, сходящиеся к ноку
    const root = [-0.25, 0.75], tip = [-5.4, 3.7];
    [1, -1].forEach((sd) => p.push(rod([root[0], root[1], sd * 0.28], [tip[0], tip[1], sd * 0.05], 0.08, 8, 'both')));
    for (let t = 0.2; t < 0.9; t += 0.2) {
      const x = lerp(root[0], tip[0], t), y = lerp(root[1], tip[1], t), z = lerp(0.28, 0.05, t);
      p.push(rod([x, y, -z], [x, y, z], 0.035, 6, 'none'));
    }
    p.push(lathe([[0.16, -0.12], [0.16, 0.12]], 12, { top: true, bottom: true }).rotateX(Math.PI / 2).translate(tip[0], tip[1], 0)); // блок
    p.push(rod([0.1, 1.15, 0], [tip[0] + 0.1, tip[1] + 0.12, 0], 0.025, 5, 'none')); // топенант
    p.push(rod([0.1, 1.08, 0], [0.1, 1.5, 0], 0.07, 8, 'b'));
    p.push(rod([tip[0], tip[1] - 0.12, 0], [tip[0], 1.3, 0], 0.018, 5, 'none')); // гордень
    p.push(box(0.2, 0.3, 0.14, tip[0], 1.18, 0)); // гак-блок
    p.push(new THREE.TorusGeometry(0.1, 0.025, 6, 12, Math.PI * 1.4).rotateZ(Math.PI * 0.8).translate(tip[0], 0.93, 0)); // гак
    mesh(merge(p), M.grey, 'Crane_Jib', g);
  }

  // ======================= ДВИЖИТЕЛИ И РУЛЬ
  const propG = group('Propulsion', ship);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.16, r1: PROP.r, chord0: 0.36, chord1: 0.5, pitch: 1.9, skew: 0.08, tc: 0.12 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = latheX([[0.0, 0.34], [0.14, 0.25], [0.17, 0.05], [0.17, -0.2], [0.12, -0.3], [0.1, -0.34]], 14, { top: false });
    const propR = merge([...bl, hub]);
    const propL = mirrorZ(propR);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Propeller_R' : 'Propeller_L', propG, PROP.x, PROP.y, sd * PROP.z);
      mesh(sd > 0 ? propR : propL, M.bronze, `${g.name}_Blades`, g);
      props[sd > 0 ? 'R' : 'L'] = g;
    });
  }
  {
    const yc = (RUD.y0 + RUD.y1) / 2, half = (RUD.y1 - RUD.y0) / 2;
    const g = group('Rudder', propG, RUD.x, yc, 0);
    const f = foil({ root: [0.3, -1.05], tip: [0.25, -0.9], span: 2 * half - 0.05, tc: 0.15, y0: -half, nSpan: 3 });
    const stock = rod([0, half - 0.1, 0], [0, half + 0.35, 0], 0.07, 10, 'a');
    mesh(merge([f, stock]), M.anti, 'Rudder_Blade', g);
  }

  // Анимация: винты вращаются навстречу друг другу, 1 оборот за 1 с, 9 ключей, петля замкнута
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
      q.setFromAxisAngle(ax, -a);
      vR.push(q.x, q.y, q.z, q.w);
      q.setFromAxisAngle(ax, a);
      vL.push(q.x, q.y, q.z, q.w);
    }
    ship.animations = [
      new THREE.AnimationClip('Propellers_Spin', T, [
        new THREE.QuaternionKeyframeTrack('Propeller_R.quaternion', times, vR),
        new THREE.QuaternionKeyframeTrack('Propeller_L.quaternion', times, vL),
      ]),
    ];
  }

  const { map, normalMap } = paintAtlas(houses, SL, BH);
  M.atlas.map = map;
  M.atlas.normalMap = normalMap;

  const find = (nm) => ship.getObjectByName(nm);
  ship.userData.update = (t = 0) => {
    props.R.rotation.x = -2 * Math.PI * t;
    props.L.rotation.x = 2 * Math.PI * t;
  };
  ship.userData.pose = (k = 0) => {
    find('Rudder').rotation.y = k * 0.5;
    find('Flak_Fore').rotation.y = k * 0.9;
    find('Flak_Aft').rotation.y = -k * 1.2;
    find('Crane').rotation.y = k * 1.3;
  };
  ship.userData.waterline = WL;
  ship.userData.dims = { PROP, RUD };
  return ship;
}
// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintAtlas(houses, SL, BH) {
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
  const GREY = '#9a9fa2';

  // ---- БОРТ (v 0.5…1 → py 0…1024)
  const hullBot = S / 2;
  C.fillStyle = GREY;
  C.fillRect(0, 0, S, hullBot);
  // подводная часть (необрастающая краска) и чёрная полоса по ватерлинии
  for (let i = 0; i < S; i++) {
    const x = xOfU((i + 0.5) / S);
    const r = sideAt(x, WL - 0.15);
    const r2 = sideAt(x, WL + 0.3);
    if (r2) {
      C.fillStyle = '#1d1f21';
      C.fillRect(i, py(r2.v), 1, hullBot - py(r2.v));
    } else {
      // корма над водой — граница по нижней точке
      const rk = sideAt(x, Math.max(WL + 0.3, keelY(x) + 0.01));
      if (rk && keelY(x) < WL + 0.3) {
        C.fillStyle = '#1d1f21';
        C.fillRect(i, py(rk.v), 1, hullBot - py(rk.v));
      }
    }
    if (r) {
      C.fillStyle = '#3e2b27';
      C.fillRect(i, py(r.v), 1, hullBot - py(r.v));
    }
  }
  // пятна и потёки краски
  for (let i = 0; i < 1100; i++) {
    const x = rnd() * S, y = rnd() * hullBot;
    const r = 8 + rnd() * 40;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.014)' : 'rgba(0,0,0,0.02)';
    C.beginPath();
    C.ellipse(x, y, r * 1.8, r, 0, 0, Math.PI * 2);
    C.fill();
  }
  // швы обшивки: пояса и стыки
  for (let a = 1.0; a < GIRTH; a += 1.15) {
    const y = py(V_SIDE(a));
    line(C, 0, y, S, y, 2, 'rgba(20,24,26,0.18)');
    line(Hc, 0, y, S, y, 2, 'rgb(100,100,100)');
  }
  for (let x = HL.XS + 2.0; x < HL.XE; x += 3.6 + rnd() * 1.4) {
    const X = px(U(x));
    line(C, X, 0, X, hullBot, 2, 'rgba(20,24,26,0.16)');
    line(Hc, X, 0, X, hullBot, 2, 'rgb(102,102,102)');
  }
  const hullShape = (x, y, dx, dy, fill, hFill, round = 0.5, stroke = null) => {
    const r = sideAt(x, y);
    if (!r) return null;
    const ra = sideAt(x + 0.05, y), rb = sideAt(x, y + 0.05);
    if (!ra || !rb) return null;
    const ex = [((ra.u - r.u) / 0.05) * S, (-(ra.v - r.v) / 0.05) * S];
    const ey = [((rb.u - r.u) / 0.05) * S, (-(rb.v - r.v) / 0.05) * S];
    const draw = (ctx, f, st) => {
      ctx.save();
      ctx.setTransform(ex[0], ex[1], ey[0], ey[1], px(r.u), py(r.v));
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-dx / 2, -dy / 2, dx, dy, Math.min(dx, dy) * round);
      else ctx.rect(-dx / 2, -dy / 2, dx, dy);
      ctx.restore();
      if (f) {
        ctx.fillStyle = f;
        ctx.fill();
      }
      if (st) {
        ctx.strokeStyle = st[0];
        ctx.lineWidth = st[1];
        ctx.stroke();
      }
    };
    draw(C, fill, stroke);
    draw(Hc, hFill, stroke ? ['rgb(80,80,80)', stroke[1] + 1] : null);
    return r;
  };
  const streak = (x, y, len, alpha) => {
    const r = sideAt(x, y), r2 = sideAt(x, y - len);
    if (!r || !r2) return;
    const g = C.createLinearGradient(0, py(r.v), 0, py(r2.v));
    g.addColorStop(0, `rgba(88,60,40,${alpha})`);
    g.addColorStop(1, 'rgba(88,60,40,0)');
    C.fillStyle = g;
    C.fillRect(px(r.u) - 2, py(r.v), 4 + rnd() * 3, py(r2.v) - py(r.v));
  };
  // иллюминаторы: борт полубака и юта
  const scut = (x, y) => {
    if (hullShape(x, y, 0.42, 0.42, '#c8cdd0', 'rgb(150,150,150)', 0.5)) {
      hullShape(x, y, 0.32, 0.32, '#1a2026', 'rgb(70,70,70)', 0.5);
      if (rnd() < 0.3) streak(x, y - 0.25, 0.8 + rnd(), 0.16);
    }
  };
  for (let x = 26.5; x > HL.XBRK + 0.8; x -= 2.3) scut(x, yFc(x) - 0.95);
  for (let x = 12.6; x > 8.5; x -= 2.0) scut(x, yMain(x) - 0.7);
  for (let x = -18.0; x > -28.5; x -= 2.1) scut(x, yMain(x) - 0.7);
  // клюзы
  [29.0].forEach((x) => {
    const y = yFc(x) - 0.4;
    hullShape(x, y, 0.6, 0.5, '#16181a', 'rgb(40,40,40)', 0.5, ['rgba(40,44,46,0.9)', 4]);
    streak(x, y - 0.35, 2.2, 0.35);
  });
  // шпигаты и потёки
  for (let x = -38; x < 36; x += 1.3 + rnd() * 1.2) {
    const top = x >= HL.XBRK ? yFc(x) : yMain(x);
    if (rnd() < 0.5) streak(x, top - 0.12, 0.6 + rnd() * 1.8, 0.1 + rnd() * 0.1);
  }
  // ---- ПАЛУБЫ (v 0.25…0.5 → py 1024…1536)
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = '#5d6265';
  C.fillRect(0, d0, S, d1 - d0);
  // стальной настил: поперечные стыки и продольные пазы листов, пятна
  for (let z = -ZD + 0.9; z < ZD; z += 1.5) {
    const y = py(V_DECK(z));
    line(C, 0, y, S, y, 2, 'rgba(25,28,30,0.35)');
    line(Hc, 0, y, S, y, 2, 'rgb(104,104,104)');
  }
  for (let x = UX0 + 1; x < UX1; x += 2.4 + rnd() * 0.8) {
    const X = px(U(x));
    line(C, X, d0, X, d1, 2, 'rgba(25,28,30,0.3)');
    line(Hc, X, d0, X, d1, 2, 'rgb(104,104,104)');
  }
  for (let i = 0; i < 900; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    const r = 6 + rnd() * 30;
    C.beginPath();
    C.ellipse(rnd() * S, d0 + rnd() * (d1 - d0), r * 1.6, r, 0, 0, Math.PI * 2);
    C.fill();
  }
  // ржавые потёки у кнехтов и стеллажей
  for (let i = 0; i < 60; i++) {
    C.fillStyle = 'rgba(90,60,40,0.06)';
    C.fillRect(rnd() * S, d0 + rnd() * (d1 - d0), 10 + rnd() * 30, 3 + rnd() * 5);
  }
  // ватервейс (стальная окраска у бортов)
  for (let i = 0; i < S; i++) {
    const x = xOfU((i + 0.5) / S);
    if (x < HL.XS - 0.2 || x > HL.XE + 0.2) continue;
    const W = deckHalf(Math.min(HL.XE, Math.max(HL.XS, x)));
    C.fillStyle = '#80868a';
    const yA = py(V_DECK(W)), yB = py(V_DECK(W - 0.3));
    C.fillRect(i, Math.min(yA, yB) - 2, 1, Math.abs(yB - yA) + 2);
    const yC = py(V_DECK(-W + 0.3)), yD = py(V_DECK(-W));
    C.fillRect(i, Math.min(yC, yD), 1, Math.abs(yD - yC) + 2);
  }
  // стальная полоса по линии среза полубака
  C.fillStyle = '#80868a';
  C.fillRect(px(U(HL.XBRK - 0.1)), d0, px(U(HL.XBRK + 0.25)) - px(U(HL.XBRK - 0.1)), d1 - d0);

  // ---- НАДСТРОЙКИ (v 0…0.25)
  const t0 = py(0.25);
  C.fillStyle = '#a1a6a8';
  C.fillRect(0, t0, S, S - t0);
  // слот крыш: стальная палуба цвета корпуса с линолеумом
  const fillSlot = (sl, color) => {
    C.fillStyle = color;
    C.fillRect(sl.px - 2, sl.py - 2, sl.pw + 4, sl.ph + 4);
  };
  fillSlot(SL.roof, '#5d6265');
  for (let i = 0; i < 40; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)';
    C.fillRect(SL.roof.px + rnd() * SL.roof.pw, SL.roof.py + rnd() * SL.roof.ph, 10, 6);
  }
  fillSlot(SL.black, '#141516');
  const wallFrame = (h) => {
    const sl = h.slot;
    const X = (per) => sl.px + (per / h.P) * sl.pw;
    const Y = (y) => sl.py + sl.ph * (1 - (y - h.y0) / (h.y1 - h.y0));
    return { X, Y, sl };
  };
  // нормаль сегмента контура на периметре per (наружу)
  const segAt = (h, per) => {
    const o = h.outline;
    const sgn = polyArea(o) > 0 ? 1 : -1;
    let acc = 0;
    for (let i = 0; i < o.length; i++) {
      const p = o[i], q = o[(i + 1) % o.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (acc + len >= per || i === o.length - 1) {
        const t = len ? (per - acc) / len : 0;
        return { n: [(sgn * (q[1] - p[1])) / (len || 1), (-sgn * (q[0] - p[0])) / (len || 1)], p: [lerp(p[0], q[0], t), lerp(p[1], q[1], t)] };
      }
      acc += len;
    }
    return null;
  };
  const perAt = (h, x, z) => {
    const o = h.outline;
    let best = 0, bd = Infinity, acc = 0;
    for (let i = 0; i < o.length; i++) {
      const p = o[i], q = o[(i + 1) % o.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const t = clamp01(((x - p[0]) * (q[0] - p[0]) + (z - p[1]) * (q[1] - p[1])) / (len * len || 1));
      const d = Math.hypot(lerp(p[0], q[0], t) - x, lerp(p[1], q[1], t) - z);
      if (d < bd) {
        bd = d;
        best = acc + t * len;
      }
      acc += len;
    }
    return best;
  };
  const rect = (ctx, x0, y0, w, h, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x0, y0, w, h);
  };
  houses.forEach((h) => {
    const { X, Y, sl } = wallFrame(h);
    if (h.funnel) {
      // труба: тёмный верхний пояс (копоть), обручи
      C.fillStyle = '#a1a6a8';
      C.fillRect(sl.px, sl.py, sl.pw, sl.ph);
      rect(C, sl.px, Y(h.y1), sl.pw, Y(h.y1 - 0.55) - Y(h.y1), '#1c1d1e');
      const g = C.createLinearGradient(0, Y(h.y1), 0, Y(h.y1 - 1.6));
      g.addColorStop(0, 'rgba(30,30,30,0.9)');
      g.addColorStop(0.18, 'rgba(30,30,30,0.6)');
      g.addColorStop(1, 'rgba(30,30,30,0)');
      C.fillStyle = g;
      C.fillRect(sl.px, Y(h.y1), sl.pw, Y(h.y1 - 1.6) - Y(h.y1));
      [6.6, 8.1, 9.5].forEach((y) => {
        rect(C, sl.px, Y(y) - 2, sl.pw, 4, 'rgba(60,64,66,0.6)');
        rect(Hc, sl.px, Y(y) - 2, sl.pw, 4, 'rgb(170,170,170)');
      });
      return;
    }
    // горизонтальные швы и стыки листов
    for (let p = 1.6; p < h.P; p += 1.8) {
      line(C, X(p), sl.py, X(p), sl.py + sl.ph, 1.5, 'rgba(20,24,26,0.16)');
      line(Hc, X(p), sl.py, X(p), sl.py + sl.ph, 1.5, 'rgb(104,104,104)');
    }
    if (h.plain) return;
    // потёки у основания
    const g = C.createLinearGradient(0, Y(h.y0 + 0.5), 0, Y(h.y0));
    g.addColorStop(0, 'rgba(40,36,30,0)');
    g.addColorStop(1, 'rgba(40,36,30,0.28)');
    C.fillStyle = g;
    C.fillRect(sl.px, Y(h.y0 + 0.5), sl.pw, Y(h.y0) - Y(h.y0 + 0.5));
    // окна
    if (h.windows) {
      const w = h.windows;
      for (let p = w.step / 2; p < h.P; p += w.step) {
        const s = segAt(h, p);
        if (!s || !w.filter(s.n)) continue;
        const x0 = X(p - w.w / 2), x1 = X(p + w.w / 2);
        rect(C, x0 - 2, Y(w.y1) - 2, x1 - x0 + 4, Y(w.y0) - Y(w.y1) + 4, '#5f666b');
        rect(C, x0, Y(w.y1), x1 - x0, Y(w.y0) - Y(w.y1), '#1b232a');
        rect(C, x0, Y(w.y1), x1 - x0, (Y(w.y0) - Y(w.y1)) * 0.35, 'rgba(120,140,155,0.35)');
        rect(Hc, x0, Y(w.y1), x1 - x0, Y(w.y0) - Y(w.y1), 'rgb(70,70,70)');
      }
    }
    // иллюминаторы
    if (h.scuttles) {
      const sc = h.scuttles;
      for (let p = sc.step / 2; p < h.P; p += sc.step) {
        const s = segAt(h, p);
        if (!s || !sc.filter(s.n)) continue;
        if ((h.doors || []).some(([dx, dz]) => Math.abs(perAt(h, dx, dz) - p) < 0.9)) continue;
        const cx = X(p), cy = Y(sc.y);
        const r = 0.2 * DENS;
        C.fillStyle = '#c3c8cb';
        C.beginPath();
        C.arc(cx, cy, r + 2, 0, Math.PI * 2);
        C.fill();
        C.fillStyle = '#1a2026';
        C.beginPath();
        C.arc(cx, cy, r, 0, Math.PI * 2);
        C.fill();
        Hc.fillStyle = 'rgb(80,80,80)';
        Hc.beginPath();
        Hc.arc(cx, cy, r, 0, Math.PI * 2);
        Hc.fill();
      }
    }
    // двери
    (h.doors || []).forEach(([dx, dz]) => {
      const p = perAt(h, dx, dz);
      const x0 = X(p - 0.38), x1 = X(p + 0.38);
      const yt = Y(h.y0 + 1.95), yb = Y(h.y0 + 0.2);
      if (yt < sl.py) return;
      rect(C, x0 - 2, yt - 2, x1 - x0 + 4, yb - yt + 4, '#4c5357');
      rect(C, x0, yt, x1 - x0, yb - yt, '#646c71');
      rect(C, x1 - 6, (yt + yb) / 2 - 2, 3, 5, '#2a2d30');
      Hc.strokeStyle = 'rgb(160,160,160)';
      Hc.lineWidth = 3;
      Hc.strokeRect(x0, yt, x1 - x0, yb - yt);
    });
  });
  // переборка среза полубака: двери
  {
    const sl = BH.slot;
    const y0 = yMain(HL.XBRK), y1 = yFc(HL.XBRK) + 0.2;
    const X = (z) => sl.px + ((z + HL.B) / (2 * HL.B)) * sl.pw;
    const Y = (y) => sl.py + sl.ph * (1 - (y - y0) / (y1 - y0));
    rect(C, sl.px - 2, sl.py - 2, sl.pw + 4, sl.ph + 4, '#a1a6a8');
    [-1.0, 1.0].forEach((z) => {
      const x0 = X(z - 0.4), x1 = X(z + 0.4);
      rect(C, x0 - 2, Y(y0 + 1.8) - 2, x1 - x0 + 4, Y(y0 + 0.15) - Y(y0 + 1.8) + 4, '#4c5357');
      rect(C, x0, Y(y0 + 1.8), x1 - x0, Y(y0 + 0.15) - Y(y0 + 1.8), '#646c71');
      Hc.strokeStyle = 'rgb(160,160,160)';
      Hc.lineWidth = 3;
      Hc.strokeRect(x0, Y(y0 + 1.8), x1 - x0, Y(y0 + 0.15) - Y(y0 + 1.8));
    });
    [-2.4, 2.4].forEach((z) => {
      const cx = X(z), cy = Y(y0 + 1.35);
      C.fillStyle = '#1a2026';
      C.beginPath();
      C.arc(cx, cy, 0.18 * DENS, 0, Math.PI * 2);
      C.fill();
    });
  }

  // слот практической торпеды: u — от хвоста (0) к головной части (1)
  {
    const sl = SL.torp;
    const X = (m) => sl.px + (m / 7.16) * sl.pw;
    const band = (m0, m1, color) => rect(C, X(m0), sl.py - 2, X(m1) - X(m0), sl.ph + 4, color);
    band(0, 7.16, '#8d9293');
    band(0, 1.05, '#5b4d35'); // хвост с рулями и винтами
    band(1.05, 1.12, '#3a3c3d');
    band(2.7, 2.75, '#4d5254');
    band(4.3, 4.35, '#4d5254');
    band(5.0, 7.16, '#b2312a'); // учебное зарядное отделение
    band(5.45, 5.75, '#e8c23a');
    band(6.5, 6.75, '#f0f0ea');
  }

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
  map.name = 'Ship_Atlas_Color';
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = 'Ship_Atlas_Normal';
  return { map, normalMap };
}
