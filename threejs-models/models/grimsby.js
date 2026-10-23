import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Шлюп Королевского флота типа «Гримсби» (Grimsby, Leith, Lowestoft, Wellington, Aberdeen, Fleetwood…),
// обобщённый, состояние около 1939 г., без бортового номера.
// Масштаб 1:1 в метрах. Ось Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния — y = 2.75 (осадка).
// Длина 81 м, ширина 10.9 м. Длинный полубак до кормового среза за трубой, ют ниже на одну палубу.
// Вооружение: два одиночных 4,7-дюймовых орудия со щитами (A — на баке, Y — на юте), 3-дюймовое зенитное
// орудие на площадке в корме полубака. Мостик с закрытой рулевой рубкой и открытым компасным мостиком,
// одна наклонная труба, фок- и грот-мачты, шлюпки на шлюпбалках, тральные порталы и бомбосбрасыватели в корме.
// Подвижные части — отдельные группы с нулевым поворотом в покое и началом на оси движения.

const WL = 2.75;
const ATLAS = 2048;
const HL = {
  XS: -40.3, // корма (кромка юта)
  XE: 40.4, // форштевень на уровне палубы бака
  B: 5.45, // полуширина
  XF0: 4.0, // начало носового заострения
  XA0: -14.0, // начало кормового заострения
  XBRK: -11.5, // срез полубака
  NL: 16, // точек на скуле (киль → полная ширина)
  NU: 7, // борт до уровня юта
  NF: 7, // борт полубака
  ND: 14, // сегментов палубы поперёк
  N: 160, // шпангоутов
};
const QL = 0.6;
const QF = 0.35; // доля параметра на борт полубака

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Палуба юта и палуба бака (седловатость)
export const yMain = (x) => 5.3 + 0.3 * smooth((HL.XBRK - x) / (HL.XBRK - HL.XS));
export const yFc = (x) => 7.75 + 1.35 * clamp01((x - 2) / (HL.XE - 2)) ** 2;

function sec(xn) {
  const B = HL.B;
  let W = B, Wd = B, yk = 0, yb = 2.1, nb = 3.4, rake = 0, s = 0;
  if (xn > HL.XF0) {
    s = clamp01((xn - HL.XF0) / (HL.XE - HL.XF0));
    W = B * Math.max(0, 1 - s ** 1.9) ** 0.72;
    Wd = B * Math.max(0, 1 - s ** 2.4) ** 0.55;
    yk = 3.0 * clamp01((s - 0.58) / 0.42) ** 2;
    yb = 2.1 + 2.2 * s ** 1.3;
    nb = 3.4 - 1.6 * s;
    rake = -0.42 * s * s;
  } else if (xn < HL.XA0) {
    s = clamp01((HL.XA0 - xn) / (HL.XA0 - HL.XS));
    W = B * Math.max(0, 1 - s ** 2.6) ** 0.5;
    Wd = B * Math.max(0, 1 - s ** 3.0) ** 0.45;
    yk = 3.3 * s ** 1.25;
    yb = 2.1 + 1.4 * s * s;
    nb = 3.4 - 0.7 * s;
    rake = 0.65 * s ** 3;
  }
  W = Math.max(W, 0.04);
  Wd = Math.max(Wd, 0.04);
  const fore = xn >= HL.XBRK - 1e-9;
  const yM = yMain(xn), yF = yFc(xn);
  yb = Math.min(yb, yM - 0.6);
  return { xn, s, W, Wd, yk, yb, nb, rake, yM, yF, yR: xn > HL.XBRK ? yF : yM, fore };
}
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
const camber = (W, z) => 0.14 * Math.min(1, W / HL.B) * (1 - Math.min(1, (z / W) ** 2));
// Полуширина палубы и высота палубы над точкой (x, z)
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
const UX0 = -41, UX1 = 41.2;
const U = (x) => 0.005 + (0.99 * (x - UX0)) / (UX1 - UX0);
const xOfU = (u) => UX0 + ((u - 0.005) / 0.99) * (UX1 - UX0);
const V_SIDE = (arc) => 0.505 + (0.49 * arc) / GIRTH;
const ZD = 5.6;
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

const DENS = 26;
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

export function createGrimsby() {
  const ship = new THREE.Group();
  ship.name = 'Sloop_Grimsby_Class';
  const pack = makePacker();
  const houses = []; // записи для раскраски стенок
  const SL = {
    roof: pack(5, 3),
    black: pack(1.2, 1.2),
  };
  const roofUV = (x, z) => [lerp(SL.roof.u0, SL.roof.u1, clamp01((x + 41) / 82)), lerp(SL.roof.v0, SL.roof.v1, clamp01((z + 6) / 12))];
  const blackUV = () => [(SL.black.u0 + SL.black.u1) / 2, (SL.black.v0 + SL.black.v1) / 2];
  const deckUV = (x, z) => [U(x), V_DECK(z)];

  // Надстройка: стенки по контуру outline (CCW или CW) от y0 до y1, крыша — слот крыш
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
    // прямоугольник со скруглёнными передними (rf) и задними (ra) углами, CCW в (x, z)
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

  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    atlas: std('Ship_Paint_Atlas', 0xffffff, 0.72, 0.12),
    grey: std('Paint_Grey', 0x6f777d, 0.62, 0.2),
    dark: std('Steel_Dark', 0x2c2f32, 0.6, 0.45),
    anti: std('Antifouling_Red', 0x5a2b24, 0.75, 0.1),
    bronze: std('Propeller_Bronze', 0xa47a45, 0.35, 0.9),
    wire: std('Rigging_Wire', 0x26282a, 0.55, 0.5),
    canvas: std('Canvas_Covers', 0x6f705f, 0.9, 0.0),
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

  // Подводные выступы: брусковый киль-дейдвуд, валы, кронштейны, скуловые кили
  const PROP = { x: -33.0, y: 1.15, z: 2.05, r: 0.95 };
  const RUD = { x: -36.85, y0: 0.5, y1: 2.72 };
  {
    const parts = [];
    // дейдвуд
    // контур: низ вперёд-назад, затем верх назад-вперёд
    const bottom = [[-12, 0.18], [-14, 0.0], [-30.5, 0.0], [-34.5, 0.25], [-36.05, 0.45], [-36.05, keelY(-36.05) + 0.35]];
    const upper = [];
    for (let x = -35.5; x <= -12.5; x += 1.0) upper.push([x, keelY(x) + 0.2]);
    parts.push(prism([...bottom, ...upper], 0.26));
    [1, -1].forEach((sd) => {
      const z = sd * PROP.z;
      parts.push(latheX([[0.12, -32.2], [0.12, -23.0]], 10, { top: false, bottom: false }).translate(0, PROP.y, z)); // вал
      // кронштейн (А-образный): ступица и две стойки к корпусу
      parts.push(latheX([[0.0, -32.45], [0.2, -32.3], [0.22, -31.6], [0.13, -31.3]], 12, { top: false }).translate(0, PROP.y, z));
      const xb = -31.9;
      const r1 = sideAt(xb, keelY(xb) + 0.25);
      const zin = r1 ? Math.min(r1.z, 1.2) : 0.8;
      parts.push(rod([xb, PROP.y, z], [xb + 0.2, keelY(xb) + 0.6, sd * Math.max(0.2, zin - 0.3)], 0.07, 8, 'none'));
      {
        const yh = keelY(xb) + 0.35;
        const rh = sideAt(xb + 0.3, yh);
        const zh = rh ? rh.z - 0.08 : PROP.z;
        parts.push(rod([xb, PROP.y, z], [xb + 0.3, yh, sd * Math.max(zh, PROP.z + 0.25)], 0.07, 8, 'none'));
      }
      // скуловой киль: пластина вдоль скулы
      const rings = [];
      for (let x = -15; x <= 13; x += 2) {
        const c = sec(x);
        const q = QL * 0.55;
        const p = sideP(c, q);
        const pq = sideP(c, q + 0.01).sub(sideP(c, q - 0.01)).normalize();
        const n = V3(0, -pq.z, pq.y).normalize(); // нормаль в плоскости шпангоута
        if (n.z < 0) n.negate();
        const tt = Math.min(1, (x + 15) / 4, (13 - x) / 4);
        const w = 0.42 * Math.max(0.15, tt);
        const t = V3(0, pq.y, pq.z).multiplyScalar(0.025);
        const a = p.clone().addScaledVector(n, -0.04), b = p.clone().addScaledVector(n, w);
        rings.push([a.clone().add(t), b.clone().add(t), b.clone().sub(t), a.clone().sub(t)].map((v) => V3(v.x, v.y, sd * v.z)));
      }
      parts.push(loftRings(rings));
    });
    mesh(merge(parts), M.anti, 'Hull_Appendages', hullG);
  }

  // ======================= НАДСТРОЙКИ
  const supG = group('Superstructure', ship);
  const BR = { x0: 8.9, x1: 16.6, hw: 3.0, y1: 10.35, wh0: 10.2, wh1: 15.7, whw: 2.45, y2: 12.5, plat: 12.62 };
  const CAS = { x0: -6.8, x1: 5.0, hw: 2.4, y1: 10.05 };
  const AH = { x0: -18.0, x1: -12.9, hw: 2.2, y1: 7.65 };
  const FUN = { x: -0.6, rx: 1.75, rz: 1.12, rake: 0.13, top: 16.1 };
  {
    const parts = [];
    // нижний ярус мостика
    {
      const out = rrect(BR.x0, BR.x1, BR.hw, 1.5, 0.3);
      const y0 = deckTop(BR.x0, BR.hw) - 0.06;
      parts.push(house('Bridge_Lower', out, y0, BR.y1, { doors: [[BR.x0, 1.4], [BR.x0, -1.4], [12.0, BR.hw], [12.0, -BR.hw]], scuttles: { y: 9.25, filter: (n) => Math.abs(n[1]) > 0.7 || n[0] > 0.6, step: 1.6 } }));
    }
    // рулевая рубка: полукруглый фасад, окна
    {
      const pts = [];
      const xf = BR.wh1 - BR.whw * 0.75;
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 12;
        pts.push([xf + BR.whw * 0.75 * Math.cos(a), BR.whw * Math.sin(a)]);
      }
      pts.push([BR.wh0, BR.whw], [BR.wh0, -BR.whw]);
      parts.push(house('Wheelhouse', pts, BR.y1 - 0.05, BR.y2 + 0.05, { roof: false, windows: { y0: 11.35, y1: 12.15, step: 0.95, w: 0.7, filter: (n) => n[0] > 0.2 || Math.abs(n[1]) > 0.9 }, doors: [[BR.wh0, 0.9]] }));
    }
    // палуба компасного мостика с крыльями (настил сверху)
    {
      const out = [[BR.x0 - 0.2, -4.35], [16.1, -4.35], [16.5, -3.9], [16.9, -2.0], [17.0, 0], [16.9, 2.0], [16.5, 3.9], [16.1, 4.35], [BR.x0 - 0.2, 4.35]];
      const sl = pack(perimeter(out), 0.15);
      houses.push({ name: 'Platform', outline: out, P: perimeter(out), y0: BR.y2, y1: BR.plat, slot: sl, plain: true });
      parts.push(extrudeY(out, BR.y2, BR.plat, {
        uvSide: (per, y) => [lerp(sl.u0, sl.u1, per / perimeter(out)), lerp(sl.v0, sl.v1, (y - BR.y2) / (BR.plat - BR.y2))],
        uvTop: deckUV,
        uvBottom: roofUV,
      }));
      // фальшборт мостика (открыт в корму)
      const path = [[BR.x0 + 0.6, 4.33], ...out.slice(1, -1).reverse(), [BR.x0 + 0.6, -4.33]];
      const wall = wallPoly(path, 0.07);
      const P = perimeter(wall);
      const slb = pack(P, 1.15);
      houses.push({ name: 'Bridge_Bulwark', outline: wall, P, y0: BR.plat - 0.02, y1: BR.plat + 1.12, slot: slb, plain: true });
      parts.push(extrudeY(wall, BR.plat - 0.02, BR.plat + 1.12, {
        uvSide: (per, y) => [lerp(slb.u0, slb.u1, per / P), lerp(slb.v0, slb.v1, (y - BR.plat + 0.02) / 1.14)],
        uvTop: roofUV,
      }));
      // будка дальномера на мостике
      parts.push(house('Director_Hut', rrect(9.3, 11.1, 0.9, 0.4, 0.2), BR.plat - 0.02, BR.plat + 1.4, {}));
    }
    // кожух трубы и рубка на шкафуте
    {
      const out = rrect(CAS.x0, CAS.x1, CAS.hw, 0.6, 0.6);
      parts.push(house('Casing', out, deckTop(CAS.x0, CAS.hw) - 0.06, CAS.y1, { doors: [[CAS.x1, 0], [-2.5, CAS.hw], [-2.5, -CAS.hw], [CAS.x0, 1.2]], scuttles: { y: 9.0, filter: (n) => Math.abs(n[1]) > 0.7, step: 2.2 } }));
    }
    // кормовая рубка на юте
    {
      const out = rrect(AH.x0, AH.x1, AH.hw, 0.4, 0.4);
      parts.push(house('After_House', out, deckTop(AH.x0, AH.hw) - 0.06, AH.y1, { doors: [[AH.x1, 0.8], [AH.x0, -0.8]], scuttles: { y: 6.85, filter: (n) => Math.abs(n[1]) > 0.7, step: 1.5 } }));
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
    const rows = [y0, 11.5, 13.5, 15.0, 15.6, FUN.top].map((y) => ring(y, 1, outer));
    for (let k = 0; k < rows.length - 1; k++) m.strip(rows[k], rows[k + 1]);
    const lip = ring(FUN.top, 0.93, blackUV);
    const rimTop = ring(FUN.top, 1, blackUV);
    m.strip(rimTop, lip);
    const inner = ring(FUN.top - 0.6, 0.93, blackUV);
    m.strip(lip, inner);
    // дно-«нутро»
    const yb = FUN.top - 0.6;
    const ci = m.v(V3(FUN.x - FUN.rake * (yb - y0), yb, 0), ...blackUV());
    for (let j = 0; j < NS; j++) m.tri(ci, inner[j], inner[j + 1]);
    const g = m.build({ orient: false });
    // ориентация: внешняя стенка наружу
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

  // ======================= МАЧТЫ И ТАКЕЛАЖ
  const FM = { x: 8.3, top: 27.5 };
  const MM = { x: -15.6, top: 19.0 };
  {
    const parts = [];
    const fy0 = deckTop(FM.x) - 0.05;
    parts.push(lathe([[0.24, fy0], [0.21, 18.5], [0.15, 22.6], [0.1, 22.8], [0.09, FM.top - 0.2], [0.06, FM.top], [0, FM.top + 0.05]], 12, { top: false }));
    // марс (воронье гнездо)
    parts.push(lathe([[0.55, 18.0], [0.62, 18.15], [0.62, 19.05], [0.58, 19.1]], 16, { top: false, bottom: true }).translate(FM.x + 0, 0, 0));
    // реи
    parts.push(rod([FM.x, 20.8, -3.6], [FM.x, 20.8, 3.6], 0.07, 8));
    parts.push(rod([FM.x, 24.8, -1.8], [FM.x, 24.8, 1.8], 0.05, 6));
    // топ-огонь
    parts.push(lathe([[0.1, FM.top + 0.02], [0.1, FM.top + 0.25], [0, FM.top + 0.3]], 8, { top: false }));
    // фок-мачта сдвигается по x
    parts.forEach((g, i) => {
      if (i !== 2 && i !== 3) g.translate(i === 1 ? 0 : FM.x, 0, 0);
      else g.translate(0, 0, 0);
    });
    // грот-мачта на кормовой рубке
    const mm = [];
    mm.push(lathe([[0.17, AH.y1 - 0.05], [0.14, 15.0], [0.08, MM.top], [0, MM.top + 0.05]], 10, { top: false }).translate(MM.x, 0, 0));
    mm.push(rod([MM.x, 14.6, -2.2], [MM.x, 14.6, 2.2], 0.05, 6));
    // гик-стрела для тральных буёв
    mm.push(rod([MM.x - 0.3, 8.6, 0], [MM.x - 7.5, 10.3, 0], 0.08, 8));
    mm.push(lathe([[0.26, AH.y1 - 0.05], [0.26, AH.y1 + 0.35], [0, AH.y1 + 0.36]], 12, { top: false }).translate(MM.x, 0, 0));
    // площадка прожектора за трубой
    mesh(merge([...parts, ...mm]), M.grey, 'Masts', supG);
    // штаги, ванты, антенны
    const w = [];
    const fd = (x, z) => [x, deckTop(x, z) + 0.05, z];
    [1, -1].forEach((sd) => {
      w.push(rod([FM.x, 19.0, 0.3 * sd], fd(6.2, sd * (deckHalf(6.2) - 0.25)), 0.022, 5, 'none'));
      w.push(rod([FM.x, 19.0, 0.3 * sd], fd(4.4, sd * (deckHalf(4.4) - 0.25)), 0.022, 5, 'none'));
      w.push(rod([MM.x, 14.2, 0.2 * sd], fd(-17.6, sd * (deckHalf(-17.6) - 0.25)), 0.02, 5, 'none'));
      // антенны между мачтами
      w.push(rod([FM.x, 24.7, sd * 1.7], [MM.x, 14.5, sd * 2.1], 0.014, 4, 'none'));
    });
    w.push(rod([FM.x + 0.1, 22.4, 0], [39.2, deckTop(39.2) + 0.9, 0], 0.022, 5, 'none')); // штаг
    w.push(rod([FM.x - 0.1, 26.4, 0], [MM.x + 0.1, MM.top - 0.3, 0], 0.018, 5, 'none')); // триатик-штаг
    w.push(rod([MM.x - 0.08, 18.2, 0], [-39.6, deckTop(-39.6) + 0.95, 0], 0.018, 5, 'none')); // ахтерштаг
    mesh(merge(w), M.wire, 'Rigging', supG);
  }

  // ======================= ПАЛУБНОЕ ОБОРУДОВАНИЕ
  const deckG = group('Deck_Equipment', ship);
  const GF = { x: 24.2 }, GA = { x: -22.6 }, GAA = { x: -8.9 };
  GF.y = deckTop(GF.x) + 0.55;
  GA.y = deckTop(GA.x) + 0.55;
  GAA.y = deckTop(GAA.x) + 0.62 + 0.75;
  const SLT = { x: -5.6, y: CAS.y1 + 1.35 };
  {
    const parts = [];
    const dk = (g, x, z = 0, dy = 0) => g.translate(x, deckTop(x, z) + dy, z);
    // волнолом на баке
    {
      const path = [[27.0, -3.35], [28.8, -0.9], [29.1, 0], [28.8, 0.9], [27.0, 3.35]];
      const y0 = deckTop(27.0, 3.3) - 0.05;
      parts.push(extrudeY(wallPoly(path, 0.06), y0, deckTop(29, 0) + 0.75));
      // подкосы
      [-2.2, -1.1, 1.1, 2.2].forEach((z) => {
        const xw = lerp(27.0, 28.8, 1 - (Math.abs(z) - 0.9) / 2.45) - 0.1;
        parts.push(rod([xw, deckTop(xw, z) + 0.6, z], [xw - 0.6, deckTop(xw - 0.6, z) - 0.02, z], 0.035, 5, 'a'));
      });
    }
    // шпиль и якорные клюзы
    parts.push(dk(lathe([[0.42, -0.05], [0.42, 0.12], [0.3, 0.16], [0.26, 0.5], [0.34, 0.58], [0.3, 0.66], [0, 0.7]], 20), 34.3));
    [1, -1].forEach((sd) => {
      const x = 36.3, z = sd * (deckHalf(36.3) - 0.75);
      parts.push(dk(lathe([[0.38, -0.05], [0.38, 0.1], [0.28, 0.14], [0, 0.15]], 16), x, z));
      // палубный клюз цепного ящика
      parts.push(dk(lathe([[0.26, -0.05], [0.26, 0.18], [0.2, 0.2], [0, 0.21]], 12), 33.0, sd * 0.85));
    });
    // кнехты
    const bollard = () => {
      const p = () => lathe([[0.13, -0.05], [0.12, 0.34], [0.17, 0.38], [0.17, 0.42], [0, 0.43]], 12);
      return merge([p().translate(0.28, 0, 0), p().translate(-0.28, 0, 0), box(0.84, 0.1, 0.32, 0, 0.0, 0, { noBottom: true })]);
    };
    [[32.0, 0.62], [18.5, 0.72], [-2.0, 0.84], [-14.5, 0.78], [-31.0, 0.7], [-36.5, 0.5]].forEach(([x, k]) => {
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
      const t = 0.035;
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
      // кромка раструба
      const rim = O[O.length - 1], rin = I[0];
      for (let j = 0; j < NS; j++) {
        m.triN(rim[j], rin[j], rin[j + 1], V3(1, 0, 0));
        m.triN(rim[j], rin[j + 1], rim[j + 1], V3(1, 0, 0));
      }
      // дно раструба и задний купол
      const bottomI = I[I.length - 1];
      const cI = m.v(V3(outer[2][0], h, 0), 0.5, 0.5);
      for (let j = 0; j < NS; j++) m.triN(cI, bottomI[j], bottomI[j + 1], V3(1, 0, 0));
      const cB = m.v(V3(-0.38 * r, h, 0), 0.5, 0.5);
      for (let j = 0; j < NS; j++) m.triN(cB, O[0][j], O[0][j + 1], V3(-1, 0, 0));
      const stem = lathe([[r * 0.5, -0.05], [r * 0.5, h - 0.2 * r]], 12, { top: false });
      return merge([m.build({ orient: false }), stem]);
    };
    [[6.5, 2.0, 1.4, 0.45], [6.5, -2.0, 1.4, 0.45], [-10.3, 2.9, 1.1, 0.38], [-10.3, -2.9, 1.1, 0.38], [-19.5, 1.5, 1.0, 0.35], [-19.5, -1.5, 1.0, 0.35]].forEach(([x, z, h, r]) => {
      const g = cowl(h, r);
      if (x < 0) g.rotateY(Math.PI);
      parts.push(dk(g, x, z));
    });
    // грибовидные вентиляторы
    [[20.5, 1.6], [20.5, -1.6], [30.5, 0], [-27.0, 0], [-34.0, 0]].forEach(([x, z]) => {
      parts.push(dk(lathe([[0.16, -0.05], [0.16, 0.55], [0.38, 0.6], [0.38, 0.7], [0.2, 0.78], [0, 0.8]], 14), x, z));
    });
    // люки (комингсы)
    [[21.2, 0, 1.6, 1.4], [-29.5, 0, 1.4, 1.2], [3.0, 3.6, 0.9, 0.9], [3.0, -3.6, 0.9, 0.9]].forEach(([x, z, a, b]) => {
      const y0 = Math.min(deckTop(x - a / 2, Math.abs(z) + b / 2), deckTop(x + a / 2, Math.abs(z) + b / 2)) - 0.05;
      const g = extrudeY(rrect(x - a / 2, x + a / 2, b / 2, 0.12, 0.12, 2).map(([px, pz]) => [px, pz + z]), y0, deckTop(x, z) + 0.42);
      parts.push(g);
    });
    // кранцы первых выстрелов у орудий
    [[GF.x - 2.6, 2.4], [GF.x - 2.6, -2.4], [GA.x + 2.6, 2.6], [GA.x + 2.6, -2.6], [GAA.x - 1.5, 3.4], [GAA.x - 1.5, -3.4]].forEach(([x, z]) => {
      parts.push(box(1.1, 0.75, 0.6, x, deckTop(x, z) + 0.32, z, { noBottom: true }));
    });
    // площадка 3-дюймового орудия (банкет) с колонной
    parts.push(lathe([[1.75, deckTop(GAA.x, 1.75) - 0.06], [1.75, GAA.y - 0.75]], 28, { top: true }).translate(GAA.x, 0, 0));
    // тумбы 4,7-дюймовых орудий
    const ped = (x) => lathe([[0.95, deckTop(x, 0.95) - 0.06], [0.95, deckTop(x) + 0.12], [0.8, deckTop(x) + 0.18], [0.7, deckTop(x) + 0.55]], 26, { top: false }).translate(x, 0, 0);
    parts.push(ped(GF.x), ped(GA.x));
    parts.push(lathe([[0.34, GAA.y - 0.78], [0.3, GAA.y - 0.2], [0.42, GAA.y - 0.08], [0.42, GAA.y]], 18, { top: false }).translate(GAA.x, 0, 0));
    // тумба прожектора за трубой
    parts.push(lathe([[0.42, CAS.y1 - 0.05], [0.3, SLT.y - 0.35], [1.05, SLT.y - 0.12], [1.05, SLT.y - 0.02], [0.25, SLT.y - 0.02], [0.25, SLT.y]], 22, { top: false }).translate(SLT.x, 0, 0));
    // трапы со среза полубака на ют
    [1, -1].forEach((sd) => {
      const z = sd * 3.1;
      const xa = HL.XBRK - 2.2, ya = deckTop(xa, z), xb = HL.XBRK - 0.05, yb = deckTop(HL.XBRK + 0.2, z);
      [-0.35, 0.35].forEach((dz) => {
        parts.push(rod([xa, ya - 0.03, z + dz], [xb, yb - 0.02, z + dz], 0.04, 6, 'none'));
        parts.push(rod([xa, ya + 0.95, z + dz], [xb, yb + 0.95, z + dz], 0.025, 6, 'both'));
        parts.push(rod([xa, ya, z + dz], [xa, ya + 0.95, z + dz], 0.025, 6, 'b'));
      });
      for (let i = 1; i < 9; i++) {
        const t = i / 9;
        parts.push(box(0.18, 0.04, 0.66, lerp(xa, xb, t), lerp(ya, yb, t), z));
      }
    });
    // трапы на мостик
    [1, -1].forEach((sd) => {
      const z = sd * 1.9;
      const xa = BR.x0 - 1.9, ya = deckTop(xa, z), xb = BR.x0 - 0.15, yb = BR.y1;
      [-0.3, 0.3].forEach((dz) => parts.push(rod([xa, ya - 0.03, z + dz], [xb, yb, z + dz], 0.035, 6, 'none')));
      for (let i = 1; i < 7; i++) parts.push(box(0.16, 0.04, 0.56, lerp(xa, xb, i / 7), lerp(ya, yb, i / 7), z));
    });
    // прожекторы и сигнальные фонари на мостике, нактоуз, визиры
    parts.push(lathe([[0.18, BR.plat - 0.02], [0.13, BR.plat + 0.9], [0.22, BR.plat + 1.0], [0.18, BR.plat + 1.2], [0, BR.plat + 1.25]], 14).translate(15.3, 0, 0));
    [1, -1].forEach((sd) => {
      parts.push(lathe([[0.22, BR.plat - 0.02], [0.2, BR.plat + 1.25], [0, BR.plat + 1.3]], 12).translate(15.2, 0, sd * 3.6)); // пелорусы
      parts.push(box(0.35, 0.3, 0.22, 13.0, BR.plat + 1.1, sd * 4.42)); // отличительные огни
    });
    // дальномер на будке
    parts.push(lathe([[0.32, BR.plat + 1.38], [0.32, BR.plat + 1.6], [0, BR.plat + 1.62]], 14).translate(10.2, 0, 0));
    parts.push(latheX([[0.12, -1.3], [0.12, 1.3]], 10, { top: true, bottom: true }).rotateY(Math.PI / 2).translate(10.2, BR.plat + 1.78, 0));
    parts.push(box(0.5, 0.3, 0.5, 10.2, BR.plat + 1.75, 0));
    // подпорки крыльев мостика
    [1, -1].forEach((sd) => {
      [9.4, 15.2].forEach((x) => parts.push(rod([x, BR.y2 - 0.02, sd * 4.0], [x, BR.y1 - 1.3, sd * (BR.hw - 0.02)], 0.06, 6, 'none')));
    });
    // сирена и паровая труба у дымовой трубы
    parts.push(rod([FUN.x + 1.85, CAS.y1 - 0.05, 0.4], [FUN.x + 1.85 - FUN.rake * 5.3, FUN.top - 0.4, 0.4], 0.08, 8, 'b'));
    parts.push(rod([FUN.x - 1.85, CAS.y1 - 0.05, 0], [FUN.x - 1.85 - FUN.rake * 5.6, FUN.top + 0.1, 0], 0.11, 8, 'b'));
    mesh(merge(parts), M.grey, 'Deck_Fittings', deckG);

    // якоря, якорные цепи, барабаны лебёдки (тёмная сталь)
    const dark = [];
    [1, -1].forEach((sd) => {
      // цепь от клюза к шпилю
      const a = [36.3, 0, sd * (deckHalf(36.3) - 0.75)], b = [34.3, 0, sd * 0.32];
      const n = 10;
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.1) / n, t1 = (i + 0.9) / n;
        const x0 = lerp(a[0], b[0], t0), z0 = lerp(a[2], b[2], t0), x1 = lerp(a[0], b[0], t1), z1 = lerp(a[2], b[2], t1);
        const y0 = deckTop(x0, z0) + 0.06, y1 = deckTop(x1, z1) + 0.06;
        dark.push(new THREE.TorusGeometry(0.11, 0.035, 5, 10).scale(1.6, 1, 1).rotateX(i % 2 ? Math.PI / 2 : 0).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2 + (i % 2 ? 0.0 : 0.04), (z0 + z1) / 2));
      }
      // якорь Холла в клюзе на борту
      const y = yFc(36.6) - 1.2;
      const r = sideAt(36.6, y);
      const shank = box(0.16, 1.1, 0.16, 0, 0.05, 0);
      const crown = box(0.85, 0.22, 0.2, 0, -0.55, 0);
      const fl1 = prism([[-0.42, -0.62], [-0.3, -0.62], [-0.18, -0.1], [-0.3, -0.05]], 0.14);
      const fl2 = prism([[0.42, -0.62], [0.3, -0.62], [0.18, -0.1], [0.3, -0.05]], 0.14);
      const anc = merge([shank, crown, fl1, fl2]);
      const n2 = r.n.clone();
      anc.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n2));
      anc.translate(36.6 + 0.05, y, r.z + 0.06);
      dark.push(sd > 0 ? anc : mirrorZ(anc));
    });
    // тральная лебёдка
    {
      const x = -26.0;
      dark.push(latheX([[0.42, -0.6], [0.42, -0.5], [0.3, -0.48], [0.3, 0.48], [0.42, 0.5], [0.42, 0.6]], 18, { top: true, bottom: true }).rotateY(Math.PI / 2).translate(x, deckTop(x) + 0.65, 0));
      dark.push(box(1.6, 0.5, 1.8, x - 0.9, deckTop(x) + 0.22, 0, { noBottom: true }));
    }
    // рельсы бомбосбрасывателей (через транец)
    [1, -1].forEach((sd) => {
      const z = sd * 1.25;
      const xa = -33.0, xb = -40.25;
      const ya = deckTop(xa, z), yb = deckTop(-39.2, z);
      [-0.32, 0.32].forEach((dz) => {
        dark.push(rod([xa, ya + 0.0, z + dz], [xb, yb + 0.02, z + dz], 0.045, 6, 'both'));
        dark.push(rod([xa, ya + 0.62, z + dz], [xb, yb + 0.64, z + dz], 0.035, 6, 'both'));
        for (let x = xa; x > xb + 0.2; x -= 1.5) dark.push(rod([x, deckTop(x, z) - 0.03, z + dz], [x, deckTop(x, z) + 0.64, z + dz], 0.03, 5, 'b'));
      });
    });
    mesh(merge(dark), M.dark, 'Deck_Gear_Dark', deckG);

    // глубинные бомбы на рельсах и у бомбомётов
    const dc = [];
    const charge = () => latheX([[0.27, -0.33], [0.29, -0.3], [0.29, 0.3], [0.27, 0.33]], 14, { top: true, bottom: true });
    [1, -1].forEach((sd) => {
      for (let i = 0; i < 6; i++) {
        const x = -34.0 - i * 0.72;
        if (x < -39.0) break;
        dc.push(charge().rotateY(Math.PI / 2).rotateZ(0).translate(x, deckTop(x, 1.25) + 0.36, sd * 1.25));
      }
      // бомбомёт Торникрофта у борта
      const x = -24.6, z = sd * (deckHalf(-24.6) - 1.0);
      dc.push(lathe([[0.3, deckTop(x, z) - 0.05], [0.3, deckTop(x, z) + 0.25], [0, deckTop(x, z) + 0.27]], 14).translate(x, 0, z));
      dc.push(rod([x, deckTop(x, z) + 0.2, z], [x, deckTop(x, z) + 1.1, z + sd * 0.45], 0.16, 12, 'b'));
      dc.push(charge().rotateY(Math.PI / 2).translate(x + 1.1, deckTop(x + 1.1, z) + 0.31, z - sd * 0.1));
      dc.push(charge().rotateY(Math.PI / 2).translate(x - 1.1, deckTop(x - 1.1, z) + 0.31, z - sd * 0.1));
    });
    mesh(merge(dc), M.grey, 'Depth_Charges', deckG);

    // тральные порталы, буи-«Оропеза», кранцы-отводители (параваны)
    const ms = [];
    [1, -1].forEach((sd) => {
      const xg = -37.6;
      const zo = sd * (deckHalf(xg) - 0.25);
      const zi = sd * 1.9;
      const y0o = deckTop(xg, zo), y0i = deckTop(xg, zi);
      const H = 3.4;
      ms.push(rod([xg, y0i - 0.04, zi], [xg, y0i + H, zi], 0.11, 10, 'b'));
      ms.push(rod([xg, y0o - 0.04, zo], [xg, y0i + H, zo], 0.11, 10, 'b'));
      ms.push(rod([xg, y0i + H, zi - sd * 0.11], [xg, y0i + H, zo + sd * 0.55], 0.12, 10, 'both'));
      ms.push(rod([xg, y0i + 1.4, zi], [xg, y0i + H - 0.2, zo], 0.06, 8, 'none'));
      ms.push(lathe([[0.16, -0.25], [0.16, 0.0], [0.08, 0.05], [0, 0.06]], 10, { top: false, bottom: true }).translate(xg, y0i + H - 0.13, zo + sd * 0.45));
      // буй «Оропеза»: торпедообразный поплавок на ложементах
      const xb = -29.6, zb = sd * (deckHalf(-29.6) - 1.15);
      const yb = deckTop(xb, zb) + 0.62;
      ms.push(latheX([[0, -1.9], [0.2, -1.75], [0.36, -1.3], [0.4, -0.6], [0.4, 0.8], [0.32, 1.35], [0.16, 1.7], [0, 1.82]], 14).translate(xb, yb, zb));
      ms.push(prism([[-0.05, -0.05], [0.65, 0.35], [0.65, 0.42], [-0.05, 0.12]], 0.04).rotateY(Math.PI).translate(xb - 1.6, yb + 0.25, zb));
      [-0.8, 0.8].forEach((dx) => ms.push(box(0.2, 0.28, 0.85, xb + dx, deckTop(xb + dx, zb) + 0.12, zb, { noBottom: true })));
      // параван (кайт-отводитель) у портала
      const xk = -35.2, zk = sd * (deckHalf(-35.2) - 1.0);
      const yk = deckTop(xk, zk);
      ms.push(box(1.2, 0.08, 0.9, xk, yk + 0.55, zk));
      ms.push(box(1.2, 0.08, 0.9, xk, yk + 0.95, zk));
      ms.push(box(0.08, 0.5, 0.9, xk - 0.56, yk + 0.75, zk));
      ms.push(box(0.08, 0.5, 0.9, xk + 0.56, yk + 0.75, zk));
      [-0.4, 0.4].forEach((dx) => ms.push(box(0.14, 0.52, 0.14, xk + dx, yk + 0.24, zk, { noBottom: true })));
    });
    mesh(merge(ms), M.grey, 'Minesweeping_Gear', deckG);

    // леерное ограждение
    const rl = [];
    const railRun = (pts) => {
      let acc = 99;
      const top = (p) => [p[0], p[1] + 1.0, p[2]];
      const mid = (p) => [p[0], p[1] + 0.52, p[2]];
      pts.forEach((p, i) => {
        if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
        if (acc > 1.9 || i === pts.length - 1 || i === 0) {
          acc = 0;
          rl.push(rod([p[0], p[1] - 0.04, p[2]], top(p), 0.028, 5, 'b'));
        }
        if (i > 0) {
          rl.push(rod(top(pts[i - 1]), top(p), 0.022, 5, 'none'));
          rl.push(rod(mid(pts[i - 1]), mid(p), 0.018, 5, 'none'));
        }
      });
    };
    const edge = (x, sd, inset = 0.14) => {
      const z = sd * (deckHalf(x) - inset);
      return [x, deckTop(x, z), z];
    };
    [1, -1].forEach((sd) => {
      // бак: от среза до форштевня, кроме района шлюпок
      const fc = [];
      for (let x = HL.XBRK + 0.15; x < 39.4; x += 0.9) if (x < -9.0 || x > 4.6) fc.push(edge(x, sd));
      const runA = fc.filter((p) => p[0] < -9), runB = fc.filter((p) => p[0] > 4.6);
      // нос: сводим к диаметральной плоскости
      runB.push([39.7, deckTop(39.7), 0]);
      railRun(runA);
      railRun(sd > 0 ? runB : runB);
      // ют: от среза до кормы
      const qd = [];
      for (let x = HL.XBRK - 0.2; x > -39.0; x -= 0.9) qd.push(edge(x, sd));
      railRun(qd.filter((p) => Math.abs(p[2]) > 2.0));
      // поперечный леер у среза полубака
      const cr = [];
      for (let z = deckHalf(HL.XBRK + 0.15) - 0.14; z > 3.75; z -= 0.6) cr.push([HL.XBRK + 0.15, deckTop(HL.XBRK + 0.15, z), sd * z]);
      railRun(cr);
      const cr2 = [];
      for (let z = 2.45; z >= 0; z -= 0.6) cr2.push([HL.XBRK + 0.15, deckTop(HL.XBRK + 0.15, z), sd * z]);
      cr2.push([HL.XBRK + 0.15, deckTop(HL.XBRK + 0.15, 0), 0]);
      railRun(cr2);
    });
    // леер вокруг площадки прожектора и банкета
    const ringRail = (cx, cy, r, n) => {
      const p = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        p.push([cx + r * Math.cos(a), cy, r * Math.sin(a)]);
      }
      railRun(p);
    };
    ringRail(SLT.x, SLT.y - 0.02, 0.98, 12);
    ringRail(GAA.x, GAA.y - 0.75, 1.68, 18);
    mesh(merge(rl), M.grey, 'Guard_Rails', deckG);
  }

  // ======================= ШЛЮПКИ НА ШЛЮПБАЛКАХ
  const boatG = group('Boats', ship);
  {
    const hulls = [], covers = [], davits = [];
    // Шлюпка-вельбот (двусторонняя): корпус — открытая скорлупа, тент — свод над ней; оба сходятся
    // по планширю, вместе — замкнутое тело без внутренних граней
    const boatPart = (L, Bm, D, cover) => {
      const m = new Mesher();
      const N = 16, M2 = 10;
      const rows = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = (t - 0.5) * L;
        const sn = Math.sin(Math.PI * t);
        const w = (Bm / 2) * Math.max(0.015, sn ** 0.55);
        const d = D * (0.55 + 0.45 * sn ** 0.5);
        const sheer = 0.3 * (2 * t - 1) ** 2;
        const ids = [];
        for (let j = 0; j <= M2; j++) {
          const a = (j / M2) * Math.PI;
          const y = cover ? sheer + 0.32 * Math.sin(a) * sn ** 0.7 : sheer - d * Math.sin(a) ** 1.3;
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
      const L = 8.2, Bm = 1.95, D = 0.85;
      const bx = -1.2, bz = sd * 4.25, by = deckTop(bx, 4.25) + 2.35;
      hulls.push(boatPart(L, Bm, D, false).translate(bx, by, bz));
      covers.push(boatPart(L, Bm, D, true).translate(bx, by, bz));
      // шлюпбалки (изогнутые): стойка от палубы, вынос над шлюпкой
      [bx + 3.3, bx - 3.3].forEach((x) => {
        const zb = sd * (deckHalf(x) - 0.35);
        const yb = deckTop(x, Math.abs(zb));
        const pts = [V3(x, yb - 0.05, zb), V3(x, yb + 2.4, zb), V3(x, yb + 3.4, zb - sd * 0.1), V3(x, yb + 3.65, bz - sd * 0.0)];
        const curve = new THREE.CatmullRomCurve3(pts);
        davits.push(new THREE.TubeGeometry(curve, 14, 0.09, 8, false));
        davits.push(lathe([[0.09, 0], [0.12, 0.05], [0, 0.07]], 8, { top: false }).translate(x, yb + 3.65 + 0.01, bz));
        // тали
        davits.push(rod([x, yb + 3.6, bz], [x, by + 0.12, bz], 0.02, 4, 'none'));
        davits.push(box(0.2, 0.3, 0.12, x, by + 0.4, bz));
      });
      // боканцы-ложементы на палубе под шлюпкой и подбортные стойки
      [bx + 2.0, bx - 2.0].forEach((x) => {
        davits.push(rod([x, by - 0.6, bz - sd * 0.85], [x, by - 0.6, bz + sd * 0.85], 0.05, 6));
      });
    });
    mesh(merge(hulls), M.grey, 'Boat_Hulls', boatG);
    mesh(merge(covers), M.canvas, 'Boat_Covers', boatG);
    mesh(merge(davits), M.grey, 'Boat_Davits', boatG);
  }

  // ======================= ВООРУЖЕНИЕ
  const armsG = group('Armament', ship);
  // 4,7-дюймовое орудие Mk IX на тумбовой установке со щитом; локальный ствол — вдоль +X
  const gun47 = () => {
    const p = [];
    const ty = 1.05;
    p.push(lathe([[0.78, -0.05], [0.78, 0.1], [0.66, 0.16], [0, 0.17]], 24, { top: true }));
    [1, -1].forEach((sd) => {
      p.push(prism([[-0.75, 0.12], [0.7, 0.12], [0.45, ty + 0.15], [-0.3, ty + 0.2], [-0.78, 0.7]], 0.08).translate(0, 0, sd * 0.36));
      p.push(box(0.35, 0.06, 0.3, -0.75, 0.62, sd * 0.68)); // сиденья наводчиков
      p.push(rod([-0.45, 0.3, sd * 0.4], [-0.7, 0.6, sd * 0.68], 0.03, 6));
      p.push(rod([-0.15, ty - 0.1, sd * 0.4], [-0.15, ty - 0.1, sd * 0.6], 0.025, 6));
      p.push(new THREE.TorusGeometry(0.17, 0.022, 6, 14).translate(-0.15, ty - 0.1, sd * 0.6));
    });
    p.push(rod([0, ty, -0.42], [0, ty, 0.42], 0.08, 12));
    p.push(box(1.9, 0.4, 0.46, 0.25, ty, 0)); // люлька
    p.push(rod([-0.55, ty + 0.3, 0], [1.35, ty + 0.3, 0], 0.1, 12)); // накатник
    p.push(latheX([[0.19, -1.0], [0.19, -0.5], [0.165, -0.4], [0.15, 0.6], [0.11, 4.6], [0.125, 4.65], [0.125, 4.85], [0.07, 4.85], [0.07, 4.6], [0, 4.6]], 18, { top: false, bottom: true }).translate(0, ty, 0));
    p.push(box(0.42, 0.42, 0.42, -1.2, ty, 0)); // затвор
    p.push(box(0.12, 0.3, 0.06, -1.2, ty + 0.3, -0.22));
    p.push(rod([0.35, ty + 0.14, 0.42], [-0.35, ty + 0.14, 0.42], 0.045, 8));
    // щит: П-образная стенка, скошенные передние углы, крыша над передней частью
    const sp = (f) => [[-0.8, -1.05], [f - 0.42, -1.05], [f - 0.05, -0.68], [f, 0], [f - 0.05, 0.68], [f - 0.42, 1.05], [-0.8, 1.05]];
    p.push(loftPoly([{ poly: wallPoly(sp(1.2), 0.045), y: 0.4 }, { poly: wallPoly(sp(1.2), 0.045), y: 1.55 }, { poly: wallPoly(sp(0.92), 0.045), y: 2.15 }]));
    const roof = sp(0.93).map(([x, z]) => [Math.max(x, -0.15), z * 0.985]).filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
    p.push(extrudeY(roof, 2.07, 2.11, { uvBottom: () => [0.5, 0.5] }));
    // прицельные окна в щите — тёмные не нужны, щит одного материала; козырёк над амбразурой
    p.push(box(0.3, 0.05, 0.5, 1.22, ty + 0.36, 0));
    return merge(p);
  };
  {
    const g = group('Gun_Fore', armsG, GF.x, GF.y, 0);
    mesh(gun47(), M.grey, 'Gun_Fore_Mount', g);
    const g2 = group('Gun_Aft', armsG, GA.x, GA.y, 0);
    mesh(gun47().rotateY(Math.PI), M.grey, 'Gun_Aft_Mount', g2);
  }
  // 3-дюймовое 20-cwt зенитное орудие: ствол с возвышением, без щита
  {
    const g = group('Gun_AA', armsG, GAA.x, GAA.y, 0);
    const p = [];
    const ty = 0.62;
    p.push(lathe([[0.5, -0.05], [0.5, 0.08], [0.4, 0.12], [0, 0.13]], 20));
    [1, -1].forEach((sd) => {
      p.push(prism([[-0.4, 0.1], [0.4, 0.1], [0.2, ty + 0.12], [-0.2, ty + 0.12]], 0.06).translate(0, 0, sd * 0.24));
      p.push(box(0.3, 0.05, 0.28, -0.55, 0.55, sd * 0.6));
      p.push(rod([-0.2, 0.3, sd * 0.27], [-0.5, 0.52, sd * 0.6], 0.03, 6));
      p.push(new THREE.TorusGeometry(0.13, 0.02, 6, 12).translate(-0.1, ty - 0.15, sd * 0.4));
    });
    p.push(rod([0, ty, -0.3], [0, ty, 0.3], 0.07, 10));
    const el = new THREE.Group();
    void el;
    const barrel = merge([
      box(1.3, 0.3, 0.32, 0.15, 0, 0),
      rod([-0.5, 0.22, 0], [0.9, 0.22, 0], 0.07, 10),
      latheX([[0.13, -0.85], [0.13, -0.4], [0.1, 0.2], [0.075, 3.3], [0.09, 3.33], [0.09, 3.45], [0.05, 3.45], [0.05, 3.3], [0, 3.3]], 16, { top: false, bottom: true }),
      box(0.3, 0.3, 0.3, -0.9, 0, 0),
    ]);
    barrel.rotateZ(THREE.MathUtils.degToRad(25)).translate(0, ty, 0);
    p.push(barrel);
    mesh(merge(p), M.grey, 'Gun_AA_Mount', g);
  }

  // ======================= ПРОЖЕКТОР (поворот вокруг вертикали)
  {
    const g = group('Searchlight', ship, SLT.x, SLT.y, 0);
    const p = [];
    p.push(lathe([[0.3, -0.04], [0.3, 0.1], [0.2, 0.16], [0, 0.17]], 16));
    [1, -1].forEach((sd) => p.push(box(0.08, 0.75, 0.1, 0, 0.5, sd * 0.47)));
    p.push(latheX([[0.4, -0.45], [0.44, -0.35], [0.44, 0.3], [0.48, 0.34], [0.48, 0.42], [0.36, 0.42], [0.36, 0.36], [0, 0.36]], 20, { top: false, bottom: false }).translate(0, 0.78, 0));
    p.push(latheX([[0, -0.6], [0.3, -0.52], [0.4, -0.45]], 20, { top: false }).translate(0, 0.78, 0));
    p.push(rod([0, 0.78, -0.46], [0, 0.78, 0.46], 0.05, 8));
    p.push(lathe([[0.08, 1.2], [0.08, 1.35], [0, 1.37]], 8, { top: false }));
    mesh(merge(p), M.grey, 'Searchlight_Lamp', g);
  }

  // ======================= ДВИЖИТЕЛИ И РУЛЬ
  const propG = group('Propulsion', ship);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.2, r1: PROP.r, chord0: 0.45, chord1: 0.7, pitch: 2.1, skew: 0.12, tc: 0.12 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = latheX([[0.0, 0.42], [0.18, 0.3], [0.22, 0.05], [0.22, -0.25], [0.16, -0.38], [0.12, -0.42]], 16, { top: false });
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
    const f = foil({ root: [0.38, -1.3], tip: [0.3, -1.15], span: 2 * half, tc: 0.15, y0: -half, nSpan: 3 });
    const stock = rod([0, half - 0.05, 0], [0, keelY(RUD.x) + 0.45 - yc, 0], 0.09, 10, 'a');
    mesh(merge([f, stock]), M.anti, 'Rudder_Blade', g);
  }

  // Анимация: винты вращаются навстречу друг другу, 1 оборот за 1 с (24 кадра), 9 ключей, петля замкнута
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

  // ======================= АТЛАС (после геометрии — слоты уже розданы)
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
    find('Gun_Fore').rotation.y = k * 0.8;
    find('Gun_Aft').rotation.y = -k * 0.9;
    find('Gun_AA').rotation.y = k * 1.4;
    find('Searchlight').rotation.y = k * 1.2;
  };
  ship.userData.waterline = WL;
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
  const GREY = '#6c747a';

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
      C.fillStyle = '#5a2b24';
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
  for (let x = 30.5; x > HL.XBRK + 0.8; x -= 2.7) {
    if (x > 21 && x < 23.5) continue;
    scut(x, yFc(x) - 1.05);
  }
  for (let x = -6.5; x < 17; x += 3.4) scut(x, yMain(x) - 0.9);
  for (let x = HL.XBRK - 1.8; x > -31; x -= 3.1) scut(x, yMain(x) - 1.0);
  // клюзы
  [36.6].forEach((x) => {
    const y = yFc(x) - 0.42;
    hullShape(x, y, 0.75, 0.6, '#16181a', 'rgb(40,40,40)', 0.5, ['rgba(40,44,46,0.9)', 4]);
    streak(x, y - 0.35, 2.2, 0.35);
  });
  // шпигаты и потёки
  for (let x = -38; x < 36; x += 1.3 + rnd() * 1.2) {
    const top = x >= HL.XBRK ? yFc(x) : yMain(x);
    if (rnd() < 0.5) streak(x, top - 0.12, 0.6 + rnd() * 1.8, 0.1 + rnd() * 0.1);
  }
  // марки углубления на форштевне и корме
  [[38.0, 1], [-37.6, 1]].forEach(([x]) => {
    for (let y = 1.0; y < 4.6; y += 0.6) hullShape(x, y, 0.32, 0.12, '#e8e8e2', 'rgb(140,140,140)', 0.1);
  });

  // ---- ПАЛУБЫ (v 0.25…0.5 → py 1024…1536)
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = '#5e5b54';
  C.fillRect(0, d0, S, d1 - d0);
  const plank = 0.16;
  for (let z = -ZD; z < ZD; z += plank) {
    const ya = py(V_DECK(z + plank)), yb = py(V_DECK(z));
    let x = UX0 - rnd() * 5;
    while (x < UX1) {
      const len = 4 + rnd() * 3.5;
      const t = 98 + Math.round(rnd() * 20);
      C.fillStyle = `rgb(${t + 4},${t},${t - 10})`;
      C.fillRect(px(U(x)), ya, px(U(x + len)) - px(U(x)), yb - ya);
      line(C, px(U(x)), ya, px(U(x)), yb, 1.5, 'rgba(30,28,24,0.6)');
      line(Hc, px(U(x)), ya, px(U(x)), yb, 1.5, 'rgb(96,96,96)');
      x += len;
    }
    line(C, 0, yb, S, yb, 1.5, 'rgba(28,26,22,0.7)');
    line(Hc, 0, yb, S, yb, 1.5, 'rgb(88,88,88)');
  }
  for (let i = 0; i < 600; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,250,240,0.04)' : 'rgba(0,0,0,0.05)';
    C.fillRect(rnd() * S, d0 + rnd() * (d1 - d0), 20 + rnd() * 80, 3 + rnd() * 6);
  }
  // ватервейс (стальная окраска у бортов)
  for (let i = 0; i < S; i++) {
    const x = xOfU((i + 0.5) / S);
    if (x < HL.XS - 0.2 || x > HL.XE + 0.2) continue;
    const W = deckHalf(Math.min(HL.XE, Math.max(HL.XS, x)));
    C.fillStyle = '#585d61';
    const yA = py(V_DECK(W)), yB = py(V_DECK(W - 0.3));
    C.fillRect(i, Math.min(yA, yB) - 2, 1, Math.abs(yB - yA) + 2);
    const yC = py(V_DECK(-W + 0.3)), yD = py(V_DECK(-W));
    C.fillRect(i, Math.min(yC, yD), 1, Math.abs(yD - yC) + 2);
  }
  // стальная полоса по линии среза полубака
  C.fillStyle = '#585d61';
  C.fillRect(px(U(HL.XBRK - 0.1)), d0, px(U(HL.XBRK + 0.25)) - px(U(HL.XBRK - 0.1)), d1 - d0);

  // ---- НАДСТРОЙКИ (v 0…0.25)
  const t0 = py(0.25);
  C.fillStyle = '#737b81';
  C.fillRect(0, t0, S, S - t0);
  // слот крыш: стальная палуба цвета корпуса с линолеумом
  const fillSlot = (sl, color) => {
    C.fillStyle = color;
    C.fillRect(sl.px - 2, sl.py - 2, sl.pw + 4, sl.ph + 4);
  };
  fillSlot(SL.roof, '#6a6f72');
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
      C.fillStyle = '#737b81';
      C.fillRect(sl.px, sl.py, sl.pw, sl.ph);
      const g = C.createLinearGradient(0, Y(h.y1), 0, Y(h.y1 - 1.6));
      g.addColorStop(0, 'rgba(30,30,30,0.9)');
      g.addColorStop(0.18, 'rgba(30,30,30,0.6)');
      g.addColorStop(1, 'rgba(30,30,30,0)');
      C.fillStyle = g;
      C.fillRect(sl.px, Y(h.y1), sl.pw, Y(h.y1 - 1.6) - Y(h.y1));
      [11.6, 13.6, 15.1].forEach((y) => {
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
    rect(C, sl.px - 2, sl.py - 2, sl.pw + 4, sl.ph + 4, '#737b81');
    [-1.4, 1.4].forEach((z) => {
      const x0 = X(z - 0.4), x1 = X(z + 0.4);
      rect(C, x0 - 2, Y(y0 + 2.0) - 2, x1 - x0 + 4, Y(y0 + 0.15) - Y(y0 + 2.0) + 4, '#4c5357');
      rect(C, x0, Y(y0 + 2.0), x1 - x0, Y(y0 + 0.15) - Y(y0 + 2.0), '#646c71');
      Hc.strokeStyle = 'rgb(160,160,160)';
      Hc.lineWidth = 3;
      Hc.strokeRect(x0, Y(y0 + 2.0), x1 - x0, Y(y0 + 0.15) - Y(y0 + 2.0));
    });
    [-4.2, -3.0, 3.0, 4.2].forEach((z) => {
      const cx = X(z), cy = Y(y0 + 1.6);
      C.fillStyle = '#1a2026';
      C.beginPath();
      C.arc(cx, cy, 0.18 * DENS, 0, Math.PI * 2);
      C.fill();
    });
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
