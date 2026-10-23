import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Германская океанская подводная лодка типа IXB (Kriegsmarine), обобщённая: без номера и эмблем.
// Масштаб 1:1 в метрах. Ось Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния — y = 4.7 (осадка).
// Длина 76.5 м, ширина 6.76 м (бульбы цистерн), прочный корпус 4.4 м, высота ~9.6 м.
// Наружный корпус — лофт по шпангоутам: суперэллипс снизу (цистерны-«сёдла»), завал бортов к широкой
// плоской палубе с деревянным настилом. Рубка — лофт горизонтальных сечений, мостик с козырьком.
// Подвижные части — отдельные группы с нулевым поворотом в покое и началом на оси движения.
// Материалы: один атлас (корпус + палуба + рубка: цвет JPEG и нормали PNG) и пять материалов цветом.

const XA = -38.25; // корма (кромка рулей)
const XB = 38.25; // нос (сетерез)
const WL = 4.7; // ватерлиния над килем
const ATLAS = 2048;

// Наружный корпус
const H = {
  xEnd: -37.75, // кормовой срез палубы
  xa0: -15.5, // начало кормового заострения
  xb0: 20.5, // начало носового заострения
  xStem: 37.45, // форштевень на уровне палубы
  W: 3.38, // полуширина по цистернам
  wd: 2.05, // полуширина палубы
  yw: 3.45, // высота наибольшей ширины
  yd: 6.2, // палуба на миделе
  NL: 18, // точек на нижней дуге (киль → наибольшая ширина)
  NU: 10, // точек на завале борта (→ кромка палубы)
  ND: 12, // сегментов палубы поперёк
  N: 170, // шпангоутов
};
const QL = 0.62; // доля параметра на нижней дуге

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Сечение по номинальной абсциссе xn
function sec(xn) {
  let W = H.W, wd = H.wd, yk = 0, yw = H.yw, yd = H.yd, nb = 2.5, rake = 0, s = 0;
  if (xn > H.xb0) {
    s = clamp01((xn - H.xb0) / (H.xStem - H.xb0));
    W = H.W * Math.max(0, 1 - s ** 1.8) ** 0.8;
    wd = H.wd * Math.max(0, 1 - s ** 1.6) ** 0.85;
    yk = 2.7 * s ** 2.4;
    yw = H.yw + 1.5 * s * s;
    yd = H.yd + 0.85 * s ** 1.7;
    nb = 2.5 - 1.0 * s;
    rake = -0.72 * s * s; // нижние точки уходят в корму — наклонный форштевень
  } else if (xn < H.xa0) {
    s = clamp01((H.xa0 - xn) / (H.xa0 - H.xEnd));
    W = H.W * Math.max(0, 1 - s ** 1.25) ** 1.25;
    wd = H.wd * Math.max(0, 1 - s ** 2.0) ** 0.75;
    yk = 1.75 * s ** 1.6;
    yw = H.yw - 0.35 * s;
    yd = H.yd - 0.3 * s * s;
    nb = 2.5 - 0.8 * s;
    rake = 0.55 * s * s; // нижние точки уходят в нос — подрез кормы над винтами
  }
  W = Math.max(W, 0.06);
  wd = Math.min(Math.max(wd, 0.05), W * 0.92);
  return { xn, s, W, wd, yk, yw, yd, nb, rake };
}

// Точка борта (правый борт, z ≥ 0) по параметру q: 0 — киль, QL — наибольшая ширина, 1 — кромка палубы
function sideYZ(c, q) {
  if (q <= QL) {
    const th = -Math.PI / 2 + (q / QL) * (Math.PI / 2);
    const e = 2 / c.nb;
    return [c.yw - (c.yw - c.yk) * Math.abs(Math.sin(th)) ** e, c.W * Math.abs(Math.cos(th)) ** e];
  }
  const t = (q - QL) / (1 - QL);
  return [c.yw + (c.yd - c.yw) * t, c.wd + (c.W - c.wd) * (1 - t ** 1.8)];
}
const xAt = (c, y) => c.xn + c.rake * (c.yd - y);
function sideP(c, q) {
  const [y, z] = sideYZ(c, q);
  return new THREE.Vector3(xAt(c, y), y, z);
}
function arcTo(c, q) {
  const n = Math.max(2, Math.ceil(q * 120));
  let a = 0;
  let prev = sideP(c, 0);
  for (let i = 1; i <= n; i++) {
    const p = sideP(c, (q * i) / n);
    a += p.distanceTo(prev);
    prev = p;
  }
  return a;
}
const deckCamber = (c, z) => 0.05 * Math.min(1, c.wd) * (1 - (z / c.wd) ** 2);
// Палуба над точкой (x, z) — на палубе наклон шпангоутов почти не сдвигает x
export function deckY(x, z = 0) {
  const c = sec(x);
  return c.yd + deckCamber(c, Math.min(Math.abs(z), c.wd));
}

const stationXs = (() => {
  const xs = [];
  for (let i = 0; i <= H.N; i++) {
    const t = i / H.N;
    const u = 0.45 * t + 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    xs.push(H.xEnd + (H.xStem - H.xEnd) * u);
  }
  return xs;
})();
const GIRTH = Math.max(...stationXs.map((x) => arcTo(sec(x), 1))) * 1.01;

// UV атласа: корпус v 0.505…0.995, палуба 0.255…0.495, рубка 0.005…0.245
const U = (x) => 0.005 + (0.99 * (x - XA)) / (XB - XA);
const xOfU = (u) => XA + ((u - 0.005) / 0.99) * (XB - XA);
const V_SIDE = (arc) => 0.505 + (0.49 * arc) / GIRTH;
const ZD = 2.3;
const V_DECK = (z) => 0.255 + (0.24 * (z + ZD)) / (2 * ZD);
const TW = { y0: 5.95, yF: 7.85, yTop: 8.96, xw: -0.4, M: 72 };
const V_TOWER = (y) => 0.005 + (0.2 * (y - TW.y0)) / (TW.yTop - TW.y0);
const V_INNER = (y) => 0.215 + (0.028 * (y - TW.yF)) / (TW.yTop - TW.yF);

function qForY(c, y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (sideYZ(c, m)[0] < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
// Точка борта на высоте y в абсциссе x: z, UV и нормаль (правый борт). null — там корпуса нет
export function sideAt(x, y) {
  const f = (xn) => {
    const c = sec(xn);
    return xAt(c, Math.min(c.yd, Math.max(c.yk, y)));
  };
  if (x < f(H.xEnd) || x > f(H.xStem)) return null;
  let lo = H.xEnd, hi = H.xStem;
  for (let i = 0; i < 44; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < x) lo = m;
    else hi = m;
  }
  const c = sec((lo + hi) / 2);
  if (y < c.yk - 1e-3 || y > c.yd + 1e-3) return null;
  const q = qForY(c, y);
  const [, z] = sideYZ(c, q);
  const arc = arcTo(c, q);
  const h = 0.02;
  const p0 = sideP(c, q);
  const pq = sideP(c, Math.min(1, q + 0.004)).sub(sideP(c, Math.max(0, q - 0.004)));
  const cx = sec(c.xn + h);
  const px = sideP(cx, q).sub(p0);
  const n = new THREE.Vector3().crossVectors(px, pq).normalize();
  if (n.z < 0) n.negate();
  return { z, u: U(x), v: V_SIDE(arc), n, q, c };
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
    // убрать вырожденные треугольники
    const P = this.pos;
    const keep = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < this.idx.length; i += 3) {
      const [i0, i1, i2] = [this.idx[i], this.idx[i + 1], this.idx[i + 2]];
      a.fromArray(P, i0 * 3);
      b.fromArray(P, i1 * 3);
      c.fromArray(P, i2 * 3);
      if (b.sub(a).cross(c.sub(a)).length() > 1e-8) keep.push(i0, i1, i2);
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

// Тело вращения вокруг Y по профилю [[r, y], ...] снизу вверх. r = 0 на конце — полюс (веер),
// r > 0 на верхнем конце — плоская крышка; низ с r > 0 остаётся открытым (деталь стоит на поверхности),
// если не задан bottom: true
function lathe(profile, seg = 20, { bottom = false } = {}) {
  const m = new Mesher();
  const n = profile.length;
  const rings = [];
  for (let k = 0; k < n; k++) {
    const [r, y] = profile[k];
    const v = k / (n - 1);
    if (r === 0) {
      rings.push(m.v(new THREE.Vector3(0, y, 0), 0.5, v));
      continue;
    }
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a)), j / seg, v));
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
    const c = m.v(new THREE.Vector3(0, y, 0), 0.5, 0.5);
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ids.push(m.v(new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a)), 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)));
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
// То же, ось вращения +X (профиль [[r, x], ...])
const latheX = (profile, seg, opt) => lathe(profile, seg, opt).rotateZ(-Math.PI / 2);

// Стержень между двумя точками
function rod(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
const box = (sx, sy, sz, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);

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
  const front = pts.map((p) => m.v(new THREE.Vector3(p.x, p.y, th / 2), ...uv(p)));
  const back = pts.map((p) => m.v(new THREE.Vector3(p.x, p.y, -th / 2), ...uv(p)));
  tris.forEach(([a, b, c]) => {
    m.tri(front[a], front[b], front[c]);
    m.tri(back[a], back[c], back[b]);
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = m.v(new THREE.Vector3(pts[i].x, pts[i].y, th / 2), i / n, 0);
    const b = m.v(new THREE.Vector3(pts[j].x, pts[j].y, th / 2), (i + 1) / n, 0);
    const c = m.v(new THREE.Vector3(pts[j].x, pts[j].y, -th / 2), (i + 1) / n, 1);
    const d = m.v(new THREE.Vector3(pts[i].x, pts[i].y, -th / 2), i / n, 1);
    m.quad(a, d, c, b);
  }
  return m.build();
}

// Лофт замкнутых колец с крышками
function loftRings(rings, uvFn = () => [0.5, 0.5]) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, ...uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
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

// Толщина профиля NACA 00xx
const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);

// Перо: размах по +Y от y0, хорда по X (передняя кромка +X), толщина по Z
function foil({ root, tip, span, tc = 0.12, y0 = 0, nSpan = 4, nCh = 12 }) {
  const rings = [];
  for (let k = 0; k <= nSpan; k++) {
    const s = k / nSpan;
    const y = y0 + span * s;
    const le = lerp(root[0], tip[0], s), te = lerp(root[1], tip[1], s);
    const ch = le - te;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= nCh; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nCh));
    for (const t of ts) ring.push(new THREE.Vector3(le - t * ch, y, Math.max(0.006, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(new THREE.Vector3(le - ts[j] * ch, y, -Math.max(0.006, naca(ts[j]) * tc * ch)));
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
    const d = new THREE.Vector3(Math.sin(beta), 0, Math.cos(beta));
    const nn = new THREE.Vector3(Math.cos(beta), 0, -Math.sin(beta));
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
      ring.push(new THREE.Vector3(p.x, r * Math.cos(ang), r * Math.sin(ang)));
    };
    for (const t of pts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(pts[j], -1);
    rings.push(ring);
  }
  return loftRings(rings, (p) => [0.5 + 0.4 * Math.tanh(p.x), clamp01(p.y / r1)]);
}

// Зеркало по Z с разворотом обхода
function mirrorZ(g) {
  const out = g.clone();
  out.scale(1, 1, -1);
  const idx = out.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  out.index.needsUpdate = true;
  out.computeVertexNormals();
  return out;
}

// Протяжка профиля [[смещение наружу, y], ...] вдоль замкнутого контура [[x, z], ...]
function sweepLoop(loop, profile, uvFn) {
  const m = new Mesher();
  const n = loop.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = loop[i], [x1, z1] = loop[(i + 1) % n];
    area += x0 * z1 - x1 * z0;
  }
  const sgn = area > 0 ? 1 : -1;
  const per = [0];
  for (let i = 1; i <= n; i++) {
    const [x0, z0] = loop[i - 1], [x1, z1] = loop[i % n];
    per.push(per[i - 1] + Math.hypot(x1 - x0, z1 - z0));
  }
  const normals = loop.map((p, i) => {
    const a = loop[(i - 1 + n) % n], b = loop[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    const l1 = Math.hypot(...n1), l2 = Math.hypot(...n2);
    const nx = n1[0] / l1 + n2[0] / l2, nz = n1[1] / l1 + n2[1] / l2;
    const l = Math.hypot(nx, nz);
    const cosh = (nx / l) * (n1[0] / l1) + (nz / l) * (n1[1] / l1);
    const k = (-sgn / Math.max(0.35, cosh)) / l;
    return [nx * k, nz * k];
  });
  for (let k = 0; k < profile.length - 1; k++) {
    const row = (pr) => {
      const ids = [];
      for (let i = 0; i <= n; i++) {
        const j = i % n;
        const p = new THREE.Vector3(loop[j][0] + normals[j][0] * pr[0], pr[1], loop[j][1] + normals[j][1] * pr[0]);
        ids.push(m.v(p, ...uvFn(per[i], pr, k)));
      }
      return ids;
    };
    m.strip(row(profile[k]), row(profile[k + 1]));
  }
  return m.build({ orient: false });
}

function clean(g) {
  const out = g.index ? g : mergeVertices(g);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => {
  const g = mergeGeometries(list.map(clean));
  return mergeVertices(g, 1e-5);
};

// ---------------------------------------------------------------------------
// РУБКА: контур горизонтального сечения

function towerOutline(y, M = TW.M) {
  const t = clamp01((y - TW.y0) / (TW.yF - TW.y0));
  const xc = 2.2;
  const af = lerp(5.9, 4.75, smooth(t * 1.25));
  const aa = lerp(5.0, 4.85, t);
  const b = lerp(1.72, 1.55, t);
  const pts = [];
  for (let j = 0; j < M; j++) {
    const ph = Math.PI + (2 * Math.PI * j) / M;
    const c = Math.cos(ph), s = Math.sin(ph);
    const front = c > 0;
    const nE = front ? 2.0 : 3.4;
    pts.push([xc + (front ? af : aa) * spow(c, 2 / nE), b * spow(s, 2 / nE)]);
  }
  return pts;
}
const loopPerimeter = (pts) => pts.reduce((a, p, i) => a + Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]), 0);
const TOWER_PER = loopPerimeter(towerOutline(TW.y0)) * 1.02;

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintAtlas() {
  const S = ATLAS;
  const col = makeCanvas(S, S), hgt = makeCanvas(S, S);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const px = (u) => u * S;
  const py = (v) => (1 - v) * S;
  Hc.fillStyle = 'rgb(128,128,128)';
  Hc.fillRect(0, 0, S, S);

  // ---- КОРПУС (v 0.5…1 → py 0…1024)
  const hullTop = 0, hullBot = S / 2;
  C.fillStyle = '#8f9599';
  C.fillRect(0, hullTop, S, hullBot);
  // подводная часть
  C.fillStyle = '#383c40';
  for (let i = 0; i < S; i++) {
    const r = sideAt(xOfU((i + 0.5) / S), WL);
    if (!r) continue;
    const y = py(r.v);
    C.fillRect(i, y, 1, hullBot - y);
  }
  // пятна и потёки краски
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S, y = rnd() * hullBot;
    const r = 8 + rnd() * 40;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
    C.beginPath();
    C.ellipse(x, y, r * 1.8, r, 0, 0, Math.PI * 2);
    C.fill();
  }
  // швы листов: продольные (по обводу) и поперечные
  const line = (ctx, x0, y0, x1, y1, w, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (let a = 1.2; a < GIRTH; a += 1.25) {
    const y = py(V_SIDE(a));
    line(C, 0, y, S, y, 2, 'rgba(20,24,26,0.22)');
    line(Hc, 0, y, S, y, 2, 'rgb(96,96,96)');
  }
  for (let x = XA + 2.5; x < XB; x += 3.2 + rnd() * 1.6) {
    const X = px(U(x));
    line(C, X, hullTop, X, hullBot, 2, 'rgba(20,24,26,0.2)');
    line(Hc, X, hullTop, X, hullBot, 2, 'rgb(96,96,96)');
  }
  // Отверстие/накладка в координатах корпуса: центр (x, y), размер (dx, dy) м
  const hullShape = (x, y, dx, dy, fill, hFill, round = 0.5, stroke = null) => {
    const r = sideAt(x, y);
    if (!r) return null;
    const ra = sideAt(x + 0.05, y), rb = sideAt(x, y + 0.05);
    if (!ra || !rb) return null;
    const ex = [(ra.u - r.u) / 0.05 * S, -(ra.v - r.v) / 0.05 * S];
    const ey = [(rb.u - r.u) / 0.05 * S, -(rb.v - r.v) / 0.05 * S];
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
    draw(Hc, hFill, stroke ? ['rgb(70,70,70)', stroke[1] + 1] : null);
    return r;
  };
  const streak = (x, y, len, alpha) => {
    const r = sideAt(x, y), r2 = sideAt(x, y - len);
    if (!r || !r2) return;
    const g = C.createLinearGradient(0, py(r.v), 0, py(r2.v));
    g.addColorStop(0, `rgba(92,62,40,${alpha})`);
    g.addColorStop(1, 'rgba(92,62,40,0)');
    C.fillStyle = g;
    C.fillRect(px(r.u) - 3, py(r.v), 6 + rnd() * 3, py(r2.v) - py(r.v));
  };
  // ряд шпигатов под кромкой палубы
  for (let x = -33.5; x < 33.5; x += 0.55) {
    if (Math.abs(x - 2) < 0.2) continue;
    const y = deckY(x, 0) - 0.32;
    if (hullShape(x, y, 0.3, 0.13, '#0d0f10', 'rgb(10,10,10)', 0.5) && rnd() < 0.18) streak(x, y - 0.08, 0.6 + rnd() * 1.2, 0.18);
  }
  // крупные шпигаты лёгкого корпуса
  for (let x = -27; x < 28; x += 1.35) {
    const y = deckY(x, 0) - 0.95;
    hullShape(x, y, 0.62, 0.24, '#101214', 'rgb(16,16,16)', 0.5);
  }
  // кингстоны цистерн у днища
  for (let x = -14; x < 19; x += 1.7) hullShape(x, 1.0, 0.55, 0.28, '#151719', 'rgb(20,20,20)', 0.4);
  // торпедные аппараты: крышки-волнорезы (4 носовых, 2 кормовых)
  [
    [34.25, 3.75],
    [33.2, 2.75],
    [-31.6, 3.15],
  ].forEach(([x, y]) => {
    hullShape(x, y, 1.05, 0.95, null, null, 0.45, ['rgba(12,14,15,0.95)', 3]);
    hullShape(x, y, 0.8, 0.7, null, null, 0.45, ['rgba(12,14,15,0.6)', 2]);
  });
  // клюз якоря
  hullShape(34.2, 5.55, 0.95, 0.85, 'rgba(25,28,30,0.55)', 'rgb(100,100,100)', 0.35);

  // ---- ПАЛУБА (v 0.25…0.5 → py 1024…1536)
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = '#6b665c';
  C.fillRect(0, d0, S, d1 - d0);
  const plank = 0.135;
  for (let z = -ZD; z < ZD; z += plank) {
    const ya = py(V_DECK(z + plank)), yb = py(V_DECK(z));
    let x = XA - rnd() * 5;
    while (x < XB) {
      const len = 3.5 + rnd() * 3.5;
      const t = 92 + Math.round(rnd() * 22);
      C.fillStyle = `rgb(${t + 6},${t + 2},${t - 8})`;
      C.fillRect(px(U(x)), ya, px(U(x + len)) - px(U(x)), yb - ya);
      line(C, px(U(x)), ya, px(U(x)), yb, 2, 'rgba(25,22,18,0.7)');
      line(Hc, px(U(x)), ya, px(U(x)), yb, 2, 'rgb(90,90,90)');
      x += len;
    }
    line(C, 0, yb, S, yb, 2, 'rgba(22,20,16,0.75)');
    line(Hc, 0, yb, S, yb, 2, 'rgb(80,80,80)');
  }
  for (let i = 0; i < 500; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,250,240,0.035)' : 'rgba(0,0,0,0.05)';
    C.fillRect(rnd() * S, d0 + rnd() * (d1 - d0), 20 + rnd() * 80, 3 + rnd() * 6);
  }

  // ---- РУБКА (v 0…0.25 → py 1536…2048)
  const t0 = py(0.25);
  C.fillStyle = '#9ca1a4';
  C.fillRect(0, t0, S, S - t0);
  C.fillStyle = '#8b9093';
  C.fillRect(0, py(0.246), S, py(0.212) - py(0.246));
  for (let i = 0; i < 300; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.035)';
    C.beginPath();
    C.ellipse(rnd() * S, py(0.205) + rnd() * (py(0.005) - py(0.205)), 10 + rnd() * 30, 6 + rnd() * 18, 0, 0, Math.PI * 2);
    C.fill();
  }
  [6.75, 7.85, 8.55].forEach((y) => {
    line(C, 0, py(V_TOWER(y)), S, py(V_TOWER(y)), 2, 'rgba(20,24,26,0.25)');
    line(Hc, 0, py(V_TOWER(y)), S, py(V_TOWER(y)), 2, 'rgb(96,96,96)');
  });
  for (let p = 1.0; p < TOWER_PER; p += 1.6) {
    const X = px(0.005 + (0.99 * p) / TOWER_PER);
    line(C, X, py(0.205), X, py(0.005), 2, 'rgba(20,24,26,0.18)');
    line(Hc, X, py(0.205), X, py(0.005), 2, 'rgb(100,100,100)');
  }
  // шпигаты в основании рубки и скобы-ступени
  for (let p = 0.6; p < TOWER_PER - 0.4; p += 0.42) {
    const X = px(0.005 + (0.99 * p) / TOWER_PER);
    const Y = py(V_TOWER(6.42));
    C.fillStyle = '#0d0f10';
    Hc.fillStyle = 'rgb(10,10,10)';
    const w = (0.26 / TOWER_PER) * 0.99 * S, h = (0.2 * 0.13 / (TW.yTop - TW.y0)) * S;
    C.fillRect(X - w / 2, Y - h / 2, w, h);
    Hc.fillRect(X - w / 2, Y - h / 2, w, h);
    if (rnd() < 0.25) {
      const g = C.createLinearGradient(0, Y, 0, Y + 40);
      g.addColorStop(0, 'rgba(92,62,40,0.2)');
      g.addColorStop(1, 'rgba(92,62,40,0)');
      C.fillStyle = g;
      C.fillRect(X - 3, Y, 6, 40);
    }
  }

  // карта нормалей из высот (соглашение glTF: +Y — вверх по картинке glTF, т.е. вниз по холсту до переворота)
  const hd = Hc.getImageData(0, 0, S, S).data;
  const nrm = makeCanvas(S, S);
  const N = nrm.getContext('2d');
  const img = N.createImageData(S, S);
  const k = 2.2 / 255;
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
  map.name = 'Hull_Atlas_Color';
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = 'Hull_Atlas_Normal';
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// КОРПУС

function buildHull() {
  const m = new Mesher();
  const qs = [];
  for (let i = 0; i <= H.NL; i++) qs.push((QL * i) / H.NL);
  for (let j = 1; j <= H.NU; j++) qs.push(QL + ((1 - QL) * j) / H.NU);
  const rings = [];
  for (const xn of stationXs) {
    const c = sec(xn);
    const S = [], P = [], D = [];
    for (const q of qs) {
      const p = sideP(c, q);
      const uv = [U(p.x), V_SIDE(arcTo(c, q))];
      S.push(m.v(p, ...uv));
      P.push(m.v(new THREE.Vector3(p.x, p.y, -p.z), ...uv));
    }
    for (let j = 0; j <= H.ND; j++) {
      const z = c.wd * (1 - (2 * j) / H.ND);
      const y = c.yd + deckCamber(c, z);
      const p = new THREE.Vector3(xAt(c, y), y, z);
      D.push(m.v(p, U(p.x), V_DECK(z)));
    }
    rings.push({ S, P, D, c });
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k], b = rings[k + 1];
    m.strip(a.S, b.S);
    m.strip(b.P, a.P);
    m.strip(a.D, b.D);
  }
  // торцы: веер по контуру кольца
  [0, rings.length - 1].forEach((k) => {
    const r = rings[k];
    const loop = [...r.S, ...r.D.slice(1, -1), ...[...r.P].reverse().slice(0, -1)];
    const c = new THREE.Vector3();
    loop.forEach((i) => c.add(new THREE.Vector3().fromArray(m.pos, i * 3)));
    c.divideScalar(loop.length);
    const mid = r.S[Math.floor(r.S.length / 2)];
    const ci = m.v(c, m.uv[mid * 2], m.uv[mid * 2 + 1]);
    for (let j = 0; j < loop.length; j++) {
      if (k === 0) m.tri(ci, loop[j], loop[(j + 1) % loop.length]);
      else m.tri(ci, loop[(j + 1) % loop.length], loop[j]);
    }
  });
  return m.build();
}

// Рубка: тело до пола мостика (с полом-настилом), фальшборт мостика с козырьком
function buildTower() {
  const m = new Mesher();
  const ys = [TW.y0, 6.3, 6.75, 7.3, TW.yF];
  const rings = ys.map((y) => {
    const pts = towerOutline(y);
    pts.push(pts[0]);
    let per = 0;
    return pts.map(([x, z], j) => {
      if (j > 0) per += Math.hypot(x - pts[j - 1][0], z - pts[j - 1][1]);
      return m.v(new THREE.Vector3(x, y, z), 0.005 + (0.99 * per) / TOWER_PER, V_TOWER(y));
    });
  });
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
  // пол мостика и площадки (дерево), веер из центра
  const top = towerOutline(TW.yF);
  const cx = 2.2;
  const ci = m.v(new THREE.Vector3(cx, TW.yF, 0), U(cx), V_DECK(0));
  const ids = top.map(([x, z]) => m.v(new THREE.Vector3(x, TW.yF, z), U(x), V_DECK(z)));
  for (let j = 0; j < ids.length; j++) m.tri(ci, ids[(j + 1) % ids.length], ids[j]);
  const body = m.build({ orient: false });
  // проверка ориентации: боковые грани наружу
  if (signedVolume(m.pos, Array.from(body.index.array)) < 0) {
    const idx = body.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    body.computeVertexNormals();
  }

  // фальшборт мостика: часть контура с x ≥ xw, кормовая стенка по x = xw
  const ring = towerOutline(TW.yF, 96);
  const loop = [];
  const n = ring.length;
  for (let j = 0; j < n; j++) {
    const a = ring[j], b = ring[(j + 1) % n];
    if (a[0] >= TW.xw) loop.push(a);
    if ((a[0] - TW.xw) * (b[0] - TW.xw) < 0) {
      const t = (TW.xw - a[0]) / (b[0] - a[0]);
      loop.push([TW.xw, lerp(a[1], b[1], t)]);
    }
  }
  // закрыть кормовой стенкой: точки идут с левого борта через нос на правый — дополним прямой
  const first = loop[0], last = loop[loop.length - 1];
  const wall = [];
  for (let i = 1; i < 6; i++) wall.push([TW.xw, lerp(last[1], first[1], i / 6)]);
  const bl = [...loop, ...wall];
  const prof = [
    [0, TW.yF],
    [0.03, 8.55],
    [0.2, 8.9],
    [0.2, TW.yTop],
    [-0.07, TW.yTop],
    [-0.07, TW.yF],
  ];
  const BP = loopPerimeter(bl);
  const bulwark = sweepLoop(bl, prof, (per, pr, k) => {
    const u = 0.005 + (0.99 * per) / Math.max(TOWER_PER, BP * 1.02);
    if (k <= 2 && !(k === 2 && pr[0] < 0)) return [u, V_TOWER(pr[1])];
    return [u, V_INNER(pr[1])];
  });
  return { body, bulwark, platformLoop: ring.filter(([x]) => x < TW.xw - 0.05) };
}

// ---------------------------------------------------------------------------

export function createType9B() {
  const boat = new THREE.Group();
  boat.name = 'Uboat_Type_IXB';
  const { map, normalMap } = paintAtlas();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    hull: std('Hull_Painted_Steel', 0xffffff, 0.72, 0.15, { map, normalMap }),
    light: std('Steel_Light_Grey', 0x8d9396, 0.6, 0.35),
    dark: std('Steel_Dark_Grey', 0x3b3f43, 0.65, 0.3),
    gun: std('Gun_Steel', 0x7c8286, 0.45, 0.55),
    bronze: std('Propeller_Bronze', 0x9a7442, 0.35, 0.9),
    wire: std('Wire_Rope', 0x2a2b2c, 0.5, 0.6),
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

  // ======================= КОРПУС И РУБКА
  const hullG = group('Hull', boat);
  mesh(buildHull(), M.hull, 'Hull_Outer', hullG);
  const tower = buildTower();
  mesh(merge([tower.body, tower.bulwark]), M.hull, 'Conning_Tower', hullG);

  // Подводные выступы: валы, кронштейны, стабилизаторы, ограждения винтов (тёмная сталь)
  const PROP = { x: -34.4, y: 2.05, z: 1.62, r: 0.95 };
  const STERN = { hinge: -35.85, y: 2.05, z0: 1.98, z1: 3.3 };
  const RUD = { x: -37.4, y0: 0.95, y1: 3.15, z: PROP.z };
  {
    const parts = [];
    [1, -1].forEach((sd) => {
      const z = sd * PROP.z;
      parts.push(latheX([[0.11, -33.7], [0.11, -29.2], [0.0, -28.6]], 12).translate(0, PROP.y, z)); // вал
      parts.push(latheX([[0.0, -33.95], [0.2, -33.75], [0.22, -33.1], [0.15, -32.7], [0.11, -32.4]], 14).translate(0, PROP.y, z)); // мортира
      // кронштейн вала к корпусу
      const r = sideAt(-32.9, PROP.y + 0.6);
      const zin = r ? r.z - 0.1 : 0.3;
      parts.push(rod([-32.9, PROP.y, z], [-32.6, PROP.y + 0.6, sd * zin], 0.07, 8));
      parts.push(rod([-32.9, PROP.y, z], [-33.1, PROP.y - 0.55, sd * Math.max(0.15, zin - 0.25)], 0.07, 8));
      // горизонтальный стабилизатор: внутренняя часть несёт руль направления, внешняя — кормовой горизонтальный руль
      const stIn = foil({ root: [-35.05, RUD.x + 0.27], tip: [-35.15, RUD.x + 0.27], span: STERN.z0 - 0.02, tc: 0.14, y0: 0.0, nSpan: 2 });
      const stOut = foil({ root: [-35.15, STERN.hinge + 0.05], tip: [-35.3, STERN.hinge + 0.05], span: STERN.z1 + 0.05 - STERN.z0, tc: 0.12, y0: STERN.z0 - 0.04, nSpan: 2 });
      [stIn, stOut].forEach((st) => parts.push(st.rotateX(sd > 0 ? Math.PI / 2 : -Math.PI / 2).translate(0, STERN.y, 0)));
      // ограждение винта: труба от борта вокруг диска к концу стабилизатора
      const pts = [];
      const r0 = sideAt(-30.6, PROP.y);
      const ctrl = [
        [-30.6, (r0 ? r0.z : 1.6) - 0.08],
        [-31.8, 2.3],
        [-33.2, 2.72],
        [-34.4, 2.86],
        [-35.4, 2.92],
      ];
      const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, zz]) => new THREE.Vector3(x, PROP.y, sd * zz)));
      for (let i = 0; i <= 12; i++) pts.push(curve.getPoint(i / 12));
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.075, 8, false);
      parts.push(tube);
    });
    // кормовой киль-плавник между валами
    const skeg = prism([[-24, 0.3], [-31.5, 1.35], [-34.0, 1.9], [-33.8, 2.6], [-24, 1.4]], 0.18);
    parts.push(skeg);
    mesh(merge(parts), M.dark, 'Hull_Appendages', hullG);
  }

  // ======================= ПАЛУБА: кнехты, шпили, люки, сетерез, пеньки
  const deckG = group('Deck', boat);
  {
    const parts = [];
    const at = (g, x, z = 0, dy = 0) => g.translate(x, deckY(x, z) + dy, z);
    // сетерез на форштевне (зубья вверх-вперёд)
    {
      const ys = deckY(36.6);
      const poly = [[35.2, ys - 0.25], [37.55, deckY(37.4) - 0.2], [38.25, ys + 0.95]];
      const teeth = 5;
      for (let i = 1; i <= teeth; i++) {
        const t = i / (teeth + 1);
        const bx = lerp(38.25, 35.2, t), by = lerp(ys + 0.95, ys + 0.18, t);
        poly.push([bx + 0.12, by + 0.2]);
        poly.push([bx - 0.05, by - 0.02]);
      }
      poly.push([35.2, ys + 0.12]);
      parts.push(prism(poly, 0.07));
    }
    // шпили
    const capstan = () => lathe([[0.3, -0.05], [0.3, 0.06], [0.22, 0.1], [0.19, 0.3], [0.26, 0.36], [0.24, 0.42], [0, 0.44]], 20);
    parts.push(at(capstan(), 33.0));
    parts.push(at(capstan(), -30.0));
    // кнехты парные
    const bollard = () => {
      const p = () => lathe([[0.1, -0.05], [0.09, 0.28], [0.13, 0.31], [0.13, 0.35], [0, 0.36]], 12);
      return merge([p().translate(0.22, 0, 0), p().translate(-0.22, 0, 0), box(0.68, 0.1, 0.26, 0, 0.0, 0)]);
    };
    [[29.5, 0.55], [21.0, 0.75], [-20.0, 0.75], [-27.5, 0.6]].forEach(([x, k]) => {
      [1, -1].forEach((sd) => {
        const z = sd * sec(x).wd * k;
        parts.push(at(bollard(), x, z));
      });
    });
    // люки: торпедопогрузочные (наклонные), входные
    const hatch = (r, h) => lathe([[r + 0.08, -0.05], [r + 0.08, 0.06], [r, 0.08], [r * 0.85, h], [0, h + 0.03]], 24);
    [[27.0, 0.55, 0.16], [22.5, 0.42, 0.14], [-13.0, 0.42, 0.14], [-22.0, 0.55, 0.16]].forEach(([x, r, h]) => parts.push(at(hatch(r, h), x)));
    // кранцы первых выстрелов у пушки (крышки в палубе)
    [[11.2, 1.25], [11.2, -1.25], [16.4, 1.25], [16.4, -1.25], [-6.6, 1.2], [-6.6, -1.2]].forEach(([x, z]) => {
      parts.push(at(lathe([[0.3, -0.05], [0.3, 0.05], [0.26, 0.07], [0, 0.08]], 18), x, z));
    });
    // стойки леерного троса
    parts.push(at(lathe([[0.07, -0.05], [0.05, 0.7], [0.08, 0.74], [0, 0.78]], 10), -35.0));
    // якорь (правый борт, в клюзе)
    {
      const r = sideAt(34.2, 5.55);
      const shank = box(0.12, 0.75, 0.1, 0, 0.0, 0);
      const crown = box(0.55, 0.14, 0.12, 0, -0.38, 0);
      const fl1 = box(0.12, 0.35, 0.1, 0.24, -0.25, 0).rotateZ(0.0);
      const fl2 = box(0.12, 0.35, 0.1, -0.24, -0.25, 0);
      const ring = new THREE.TorusGeometry(0.08, 0.025, 6, 12).translate(0, 0.42, 0);
      const anc = merge([shank, crown, fl1, fl2, ring]);
      const n = r.n.clone();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      anc.applyQuaternion(q);
      anc.translate(34.2, 5.55, r.z + 0.02);
      parts.push(anc);
    }
    mesh(merge(parts), M.light, 'Deck_Fittings', deckG);

    // леерный трос (сетерез → рубка → корма)
    const wf = [38.12, deckY(36.6) + 0.9, 0];
    const wt = [6.95, TW.yTop - 0.02, 0];
    const wa = [-2.75, TW.yF + 1.0, 0];
    const ws = [-35.0, deckY(-35) + 0.74, 0];
    const wire = [rod(wf, wt, 0.016, 6), rod(wa, ws, 0.016, 6)];
    // изоляторы
    [[wf, wt, 0.12], [wf, wt, 0.6], [wa, ws, 0.12], [wa, ws, 0.75]].forEach(([a, b, t]) => {
      const p = a.map((v, i) => lerp(v, b[i], t));
      const p2 = a.map((v, i) => lerp(v, b[i], t + 0.012));
      wire.push(rod(p, p2, 0.045, 8));
    });
    mesh(merge(wire), M.wire, 'Jumping_Wire', deckG);
  }

  // ======================= МОСТИК: тумбы перископов, УЗО, рамка радиопеленгатора, леера площадки
  const bridgeG = group('Bridge', boat);
  const PER = { attack: [3.35, 0.0], sky: [1.55, 0.0], top: 9.38, base: TW.yF };
  {
    const parts = [];
    const standard = (rb, rt, rh) => lathe([[rb, PER.base - 0.02], [rb * 0.98, 8.6], [rt, PER.top], [rh, PER.top], [rh, PER.base + 0.4]], 22);
    parts.push(standard(0.27, 0.19, 0.1).translate(PER.attack[0], 0, PER.attack[1]));
    parts.push(standard(0.3, 0.22, 0.13).translate(PER.sky[0], 0, PER.sky[1]));
    // УЗО (прицельная колонка)
    parts.push(lathe([[0.12, TW.yF - 0.02], [0.08, 8.7], [0.12, 8.78], [0.12, 8.86], [0, 8.88]], 12).translate(6.05, 0, 0));
    parts.push(box(0.12, 0.12, 0.36, 6.05, 8.95, 0));
    // рубочный люк
    parts.push(lathe([[0.42, TW.yF - 0.02], [0.42, TW.yF + 0.1], [0.36, TW.yF + 0.13], [0, TW.yF + 0.2]], 20).translate(4.75, 0, 0.5));
    // компас / нактоуз
    parts.push(lathe([[0.16, TW.yF - 0.02], [0.12, 8.6], [0.18, 8.68], [0, 8.82]], 14).translate(5.35, 0, -0.75));
    // рамка радиопеленгатора на стойке (левый борт мостика)
    parts.push(rod([0.85, TW.yF - 0.02, -1.05], [0.85, 9.08, -1.05], 0.035, 8));
    parts.push(new THREE.TorusGeometry(0.27, 0.025, 6, 20).translate(0.85, 9.33, -1.05));
    // тумба 20-мм автомата
    parts.push(lathe([[0.2, TW.yF - 0.02], [0.16, 8.1], [0.12, 8.45], [0.15, 8.5], [0.15, 8.56], [0, 8.58]], 16).translate(-1.55, 0, 0));
    // леера площадки (Wintergarten)
    const ord = tower.platformLoop.map((p) => {
      const d = Math.hypot(p[0] - 2.2, p[1]) || 1;
      return [p[0] - ((p[0] - 2.2) / d) * 0.06, p[1] - (p[1] / d) * 0.06];
    });
    ord.sort((a, b) => b[1] - a[1]);
    const railPts = [[TW.xw - 0.05, ord[0][1]], ...ord, [TW.xw - 0.05, ord[ord.length - 1][1]]];
    let acc = 1;
    railPts.forEach((p, i) => {
      if (i > 0) acc += Math.hypot(p[0] - railPts[i - 1][0], p[1] - railPts[i - 1][1]);
      if (acc > 0.75 || i === railPts.length - 1) {
        acc = 0;
        parts.push(rod([p[0], TW.yF - 0.02, p[1]], [p[0], 8.9, p[1]], 0.025, 6));
      }
      if (i > 0) {
        const q = railPts[i - 1];
        [8.4, 8.9].forEach((y) => parts.push(rod([q[0], y, q[1]], [p[0], y, p[1]], 0.022, 6)));
      }
    });
    // ходовые огни на фальшборте
    [1, -1].forEach((sd) => {
      const ring = towerOutline(TW.yF);
      let best = ring[0];
      ring.forEach((p) => {
        if (Math.abs(p[0] - 4.6) < Math.abs(best[0] - 4.6) && Math.sign(p[1]) === sd) best = p;
      });
      parts.push(box(0.22, 0.2, 0.12, best[0], 8.45, best[1] + sd * 0.06));
    });
    mesh(merge(parts), M.light, 'Bridge_Fittings', bridgeG);
  }

  // ======================= ПЕРИСКОПЫ (выдвижные по Y, начало — у основания трубы)
  const periG = group('Periscopes', boat);
  {
    const base = 6.15;
    const att = group('Periscope_Attack', periG, PER.attack[0], base, PER.attack[1]);
    mesh(
      lathe([[0.085, 0], [0.085, 2.95], [0.065, 3.2], [0.045, 3.35], [0.035, 3.45], [0, 3.47]], 14),
      M.light,
      'Periscope_Attack_Tube',
      att,
    );
    const sky = group('Periscope_Sky', periG, PER.sky[0], base, PER.sky[1]);
    mesh(
      merge([
        lathe([[0.11, 0], [0.11, 3.05], [0.13, 3.15], [0.13, 3.38], [0.1, 3.43], [0, 3.45]], 16),
        box(0.12, 0.1, 0.06, 0.1, 3.27, 0),
      ]),
      M.light,
      'Periscope_Sky_Tube',
      sky,
    );
  }

  // ======================= ВООРУЖЕНИЕ
  const armsG = group('Armament', boat);
  // тумбы орудий (неподвижные)
  const GUN = { x: 13.9, h: 0.78 };
  const AA = { x: -9.2, h: 0.62 };
  {
    const ped = (r0, r1, h) => lathe([[r0, -0.05], [r0, 0.06], [r1, 0.12], [r1 * 0.9, h - 0.08], [r1 * 1.25, h - 0.04], [r1 * 1.25, h], [0, h + 0.01]], 22);
    mesh(merge([ped(0.62, 0.42, GUN.h).translate(GUN.x, deckY(GUN.x), 0), ped(0.4, 0.26, AA.h).translate(AA.x, deckY(AA.x), 0)]), M.gun, 'Gun_Pedestals', armsG);
  }
  // 10,5-см SK C/32: поворот вокруг вертикали по центру тумбы
  {
    const g = group('Deck_Gun', armsG, GUN.x, deckY(GUN.x) + GUN.h, 0);
    const p = [];
    const ty = 0.62; // ось цапф над тумбой
    p.push(lathe([[0.56, 0], [0.56, 0.07], [0.5, 0.1], [0, 0.11]], 24));
    // станок: две щеки
    [1, -1].forEach((sd) => {
      const cheek = prism([[-0.55, 0.08], [0.55, 0.08], [0.35, ty + 0.15], [-0.05, ty + 0.2], [-0.4, ty]], 0.06);
      p.push(cheek.translate(0, 0, sd * 0.3));
      p.push(new THREE.TorusGeometry(0.16, 0.022, 6, 16).translate(-0.05, ty - 0.12, sd * 0.47));
      p.push(rod([-0.05, ty - 0.12, sd * 0.33], [-0.05, ty - 0.12, sd * 0.47], 0.025, 6));
      p.push(box(0.3, 0.06, 0.25, -0.6, 0.45, sd * 0.55)); // сиденье наводчика
      p.push(rod([-0.4, 0.15, sd * 0.33], [-0.6, 0.42, sd * 0.55], 0.03, 6));
    });
    p.push(rod([0, ty, -0.33], [0, ty, 0.33], 0.07, 12)); // цапфы
    p.push(box(1.6, 0.34, 0.42, 0.25, ty, 0)); // люлька
    p.push(rod([-0.55, ty + 0.26, 0], [1.1, ty + 0.26, 0], 0.085, 12)); // противооткатное устройство
    p.push(rod([-0.4, ty - 0.22, 0], [0.95, ty - 0.22, 0], 0.07, 10));
    p.push(latheX([[0.15, -1.0], [0.15, -0.6], [0.135, -0.5], [0.12, 0.5], [0.1, 2.5], [0.09, 4.1], [0.105, 4.15], [0.105, 4.3], [0.06, 4.3], [0.06, 4.0], [0, 4.0]], 18).translate(0, ty, 0));
    p.push(box(0.36, 0.34, 0.34, -1.12, ty, 0)); // затвор
    p.push(box(0.1, 0.22, 0.05, -1.12, ty + 0.25, -0.2));
    p.push(rod([0.3, ty + 0.12, -0.36], [-0.3, ty + 0.12, -0.36], 0.04, 8)); // прицел
    p.push(rod([0.3, ty + 0.12, 0.36], [-0.3, ty + 0.12, 0.36], 0.04, 8));
    p.push(box(0.12, 0.2, 0.08, -0.7, ty + 0.12, 0.36));
    mesh(merge(p), M.gun, 'Deck_Gun_Mount', g);
  }
  // 3,7-см SK C/30 на кормовой палубе
  {
    const g = group('Flak_37mm', armsG, AA.x, deckY(AA.x) + AA.h, 0);
    const p = [];
    const ty = 0.42;
    p.push(lathe([[0.34, 0], [0.34, 0.05], [0.3, 0.07], [0, 0.08]], 20));
    [1, -1].forEach((sd) => {
      p.push(prism([[-0.3, 0.06], [0.3, 0.06], [0.15, ty + 0.1], [-0.12, ty + 0.1]], 0.04).translate(0, 0, sd * 0.17));
      p.push(box(0.08, 0.3, 0.32, -0.55, ty + 0.05, sd * 0.32)); // плечевые упоры
      p.push(rod([-0.15, ty, sd * 0.17], [-0.5, ty + 0.05, sd * 0.3], 0.02, 6));
    });
    p.push(rod([0, ty, -0.2], [0, ty, 0.2], 0.045, 10));
    p.push(box(1.0, 0.2, 0.24, 0.05, ty, 0)); // люлька
    p.push(rod([-0.2, ty - 0.13, 0], [0.9, ty - 0.13, 0], 0.04, 8));
    p.push(latheX([[0.075, -0.65], [0.075, -0.3], [0.06, 0.2], [0.045, 2.3], [0.06, 2.35], [0.06, 2.55], [0.035, 2.55], [0.035, 2.4], [0, 2.4]], 14).translate(0, ty + 0.03, 0));
    p.push(box(0.36, 0.18, 0.2, -0.6, ty + 0.03, 0)); // казённик
    p.push(box(0.3, 0.2, 0.08, -0.15, ty + 0.25, 0)); // обойма
    p.push(rod([0.25, ty + 0.18, -0.2], [-0.2, ty + 0.18, -0.2], 0.025, 6));
    mesh(merge(p), M.gun, 'Flak_37mm_Mount', g);
  }
  // 2-см C/30 на площадке за мостиком
  {
    const g = group('Flak_20mm', armsG, -1.55, 8.58, 0);
    const p = [];
    const ty = 0.25;
    p.push(lathe([[0.17, 0], [0.17, 0.05], [0, 0.06]], 16));
    p.push(prism([[-0.15, 0.04], [0.15, 0.04], [0.06, ty], [-0.06, ty]], 0.18));
    p.push(rod([0, ty, -0.12], [0, ty, 0.12], 0.035, 8));
    p.push(box(0.6, 0.12, 0.12, 0.0, ty, 0));
    p.push(latheX([[0.05, -0.45], [0.05, -0.1], [0.028, 0.0], [0.024, 1.15], [0.035, 1.2], [0.035, 1.38], [0.02, 1.38], [0.02, 1.3], [0, 1.3]], 12).translate(0, ty + 0.02, 0));
    p.push(box(0.16, 0.26, 0.05, -0.05, ty + 0.05, -0.1)); // магазин
    [1, -1].forEach((sd) => {
      p.push(box(0.06, 0.16, 0.2, -0.55, ty - 0.02, sd * 0.2));
      p.push(rod([-0.2, ty, sd * 0.06], [-0.52, ty - 0.02, sd * 0.2], 0.016, 6));
    });
    // щит: изогнутый лист с толщиной
    {
      const sh = new Mesher();
      const rows = [];
      const R = 0.9;
      for (const y of [-0.25, 0.5]) {
        const row = [];
        for (let i = 0; i <= 10; i++) {
          const a = -0.55 + (1.1 * i) / 10;
          for (const dr of [0, 0.012]) row.push([a, dr]);
        }
        rows.push(row.map(([a, dr]) => sh.v(new THREE.Vector3(-0.55 + (R + dr) * Math.cos(a), ty + y, (R + dr) * Math.sin(a)), (a + 0.55) / 1.1, y > 0 ? 1 : 0)));
      }
      const [b0, t0] = rows;
      const outerB = b0.filter((_, i) => i % 2 === 1), innerB = b0.filter((_, i) => i % 2 === 0);
      const outerT = t0.filter((_, i) => i % 2 === 1), innerT = t0.filter((_, i) => i % 2 === 0);
      sh.strip(outerB, outerT);
      sh.strip(innerT, innerB);
      sh.strip(innerB, outerB);
      sh.strip(outerT, innerT);
      sh.quad(innerB[0], innerT[0], outerT[0], outerB[0]);
      const L = innerB.length - 1;
      sh.quad(outerB[L], outerT[L], innerT[L], innerB[L]);
      p.push(sh.build());
    }
    mesh(merge(p), M.gun, 'Flak_20mm_Mount', g);
  }

  // ======================= РУЛИ
  const ctrlG = group('Control_Surfaces', boat);
  // носовые горизонтальные рули: ось шарнира — вдоль Z
  {
    const xh = 30.6, yh = 4.25;
    const r = sideAt(xh, yh);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Bow_Plane_R' : 'Bow_Plane_L', ctrlG, xh, yh, sd * (r.z - 0.04));
      const f = foil({ root: [0.42, -0.85], tip: [0.32, -0.6], span: 1.75, tc: 0.13, y0: 0, nSpan: 3 });
      f.rotateX(sd > 0 ? Math.PI / 2 : -Math.PI / 2);
      const hub = rod([0, 0, -sd * 0.12], [0, 0, sd * 0.08], 0.09, 12);
      mesh(merge([f, hub]), M.dark, `${g.name}_Blade`, g);
    });
  }
  // кормовые горизонтальные рули за стабилизаторами
  [1, -1].forEach((sd) => {
    const g = group(sd > 0 ? 'Stern_Plane_R' : 'Stern_Plane_L', ctrlG, STERN.hinge, STERN.y, sd * STERN.z0);
    const f = foil({ root: [0.02, -1.1], tip: [0.02, -0.9], span: STERN.z1 - STERN.z0, tc: 0.12, y0: 0, nSpan: 2 });
    f.rotateX(sd > 0 ? Math.PI / 2 : -Math.PI / 2);
    mesh(f, M.dark, `${g.name}_Blade`, g);
  });
  // вертикальные рули за винтами, ось баллера — Y
  [1, -1].forEach((sd) => {
    const g = group(sd > 0 ? 'Rudder_R' : 'Rudder_L', ctrlG, RUD.x, (RUD.y0 + RUD.y1) / 2, sd * RUD.z);
    const half = (RUD.y1 - RUD.y0) / 2;
    const f = foil({ root: [0.3, -0.82], tip: [0.3, -0.82], span: 2 * half, tc: 0.14, y0: -half, nSpan: 2 });
    const stock = rod([0, -half - 0.02, 0], [0, half + 0.02, 0], 0.06, 10);
    mesh(merge([f, stock]), M.dark, `${g.name}_Blade`, g);
  });

  // ======================= ВИНТЫ (вращение вокруг оси вала X)
  const propG = group('Propulsion', boat);
  const props = {};
  {
    const blade = bladeGeometry({ r0: 0.17, r1: PROP.r, chord0: 0.42, chord1: 0.62, pitch: 1.9, skew: 0.12, tc: 0.12 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = latheX([[0.0, 0.3], [0.16, 0.22], [0.2, 0.05], [0.2, -0.22], [0.15, -0.3], [0.0, -0.62]], 16);
    const propR = merge([...bl, hub]);
    const propL = mirrorZ(propR);
    [1, -1].forEach((sd) => {
      const g = group(sd > 0 ? 'Propeller_R' : 'Propeller_L', propG, PROP.x, PROP.y, sd * PROP.z);
      mesh(sd > 0 ? propR : propL, M.bronze, `${g.name}_Blades`, g);
      props[sd > 0 ? 'R' : 'L'] = g;
    });
  }

  // Анимация: винты вращаются навстречу друг другу, 1 оборот за 1 с, 9 ключей, петля замкнута
  {
    const T = 1.0;
    const n = 8;
    const times = [];
    const vR = [], vL = [];
    const q = new THREE.Quaternion();
    const ax = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i <= n; i++) {
      times.push((T * i) / n);
      const a = (2 * Math.PI * i) / n;
      q.setFromAxisAngle(ax, -a);
      vR.push(q.x, q.y, q.z, q.w);
      q.setFromAxisAngle(ax, a);
      vL.push(q.x, q.y, q.z, q.w);
    }
    boat.animations = [
      new THREE.AnimationClip('Propellers_Spin', T, [
        new THREE.QuaternionKeyframeTrack('Propeller_R.quaternion', times, vR),
        new THREE.QuaternionKeyframeTrack('Propeller_L.quaternion', times, vL),
      ]),
    ];
  }

  const find = (n) => boat.getObjectByName(n);
  boat.userData.update = (t = 0) => {
    props.R.rotation.x = -2 * Math.PI * t;
    props.L.rotation.x = 2 * Math.PI * t;
  };
  // тестовая поза для проверки осей подвижных частей
  boat.userData.pose = (k = 0) => {
    const r = k * 0.5;
    find('Rudder_L').rotation.y = r;
    find('Rudder_R').rotation.y = r;
    find('Bow_Plane_L').rotation.z = r;
    find('Bow_Plane_R').rotation.z = r;
    find('Stern_Plane_L').rotation.z = -r;
    find('Stern_Plane_R').rotation.z = -r;
    find('Deck_Gun').rotation.y = k * 0.9;
    find('Flak_37mm').rotation.y = -k * 1.2;
    find('Flak_20mm').rotation.y = k * 1.4;
    find('Periscope_Attack').position.y = 6.15 + k * 2.5;
    find('Periscope_Sky').position.y = 6.15 + k * 2.0;
  };
  return boat;
}
