import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Эскортный авианосец ВМС США типа «Касабланка» (CVE, 1943–44), обобщённый облик (Casablanca, Gambier Bay и др.),
// без бортового номера и без самолётов (самолёты — отдельные модели).
// Масштаб 1:1 в метрах. Ось Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния y = 6.3 (осадка).
// Длина 156 м, ширина по ватерлинии 19.9 м, полётная палуба 144 × 24.4 м, наибольшая ширина ≈ 33 м (спонсоны).
// Корпус торгового типа: бак и ют открыты, над ними — полётная палуба на стойках; между ними — закрытый ангар
// с проёмами в бортах. Небольшой остров на правом борту с мачтой и РЛС SK, два самолётоподъёмника в ДП,
// катапульта H-II на баке слева, аэрофинишёры и барьеры. По две дымовые трубы на каждом борту в корме
// (под краем полётной палубы). Одно 127-мм орудие 5"/38 на юте, 8 спаренных 40-мм «Бофорсов» в спонсонах,
// 20-мм «Эрликоны» на галереях. Две линии вала (паровые машины Скиннера «Унафлоу»), один руль.
// Окраска — камуфляж Measure 14: борта и надстройки Ocean Gray 5-O, палубы Deck Blue 20-B, подводная часть тёмная.

const XS = -76.6; // корма (срез подзора)
const XB = 79.6; // форштевень на уровне фальшборта
const B2 = 9.93; // полуширина корпуса
const RB = 1.8; // радиус скулы
const BUL = 1.0; // высота фальшборта
export const WL = 6.3; // ватерлиния над килем
const ATLAS = 2048;
const FD = 17.6; // верх полётной палубы
const FT = 0.35; // толщина полётной палубы
const FX0 = -72.5, FX1 = 71.5, FHW = 12.2; // полётная палуба
const HG = { x0: -56.0, x1: 46.0, hw: 9.6 }; // ангар (стены от главной палубы до полётной)
const FLOOR = 10.6; // палуба ангара
const ELEV = [
  { name: 'Elevator_Fore', x: 37.5, lx: 12.0, hz: 5.2 },
  { name: 'Elevator_Aft', x: -48.0, lx: 11.0, hz: 5.2 },
];
const EGAP = 0.08; // зазор вокруг платформы подъёмника
const EPLATE = 0.4; // толщина платформы

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА

// Главная палуба (бак, ангар, ют): седловатость к носу и немного к корме
export const deckY = (x) => FLOOR + 1.5 * Math.max(0, (x - 40) / 39) ** 2 + 0.35 * Math.max(0, (-x - 50) / 26) ** 2;
function xStem(y) {
  if (y <= 3) return 72 + Math.sqrt(Math.max(0, 9 - (3 - y) ** 2));
  return 75 + 0.36 * (y - 3);
}
function xSternEnd(y) {
  if (y <= 4.2) return -67.5;
  if (y <= 7.5) return -67.5 - 7.9 * Math.sqrt(Math.max(0, 1 - ((7.5 - y) / 3.3) ** 2));
  return -75.4 - 1.2 * Math.min(1, (y - 7.5) / 3.5);
}
function fullness(x, y) {
  const xf0 = lerp(28, 46, smooth(y / 10));
  const xa0 = lerp(-20, -50, smooth((y - 4) / 5));
  if (x > xf0) {
    const s = clamp01((x - xf0) / (xStem(y) - xf0));
    const p = 1.6 + 0.12 * Math.min(y, 11);
    const e = lerp(0.95, 0.72, smooth(y / 12));
    return Math.max(0, 1 - s ** p) ** e;
  }
  if (x < xa0) {
    const s = clamp01((xa0 - x) / (xa0 - xSternEnd(y)));
    const k = smooth((y - 4.0) / 4.2);
    const p = lerp(1.2 + 0.2 * Math.min(y, 5), 3.2, k);
    const e = lerp(1.0, 0.5, k);
    return Math.max(0, 1 - s ** p) ** e;
  }
  return 1;
}
export const sideZ = (x, y) => B2 * fullness(x, y);
const X = (t, y) => xSternEnd(y) + t * (xStem(y) - xSternEnd(y));
function sideNormal(x, y) {
  const h = 0.02;
  const dzdx = (sideZ(x + h, y) - sideZ(x - h, y)) / (2 * h);
  const dzdy = (sideZ(x, y + h) - sideZ(x, y - h)) / (2 * h);
  return new THREE.Vector3(-dzdx, -dzdy, 1).normalize();
}

// UV атласа окраски: борт и стены ангара v 0.505…0.995 (по высоте 0…YMAX), главная палуба 0.255…0.495,
// надстройки 0.005…0.245
const YMAX = 17.4;
const U = (x) => 0.005 + (0.99 * (x - XS)) / (XB - XS);
const V_SIDE = (y) => 0.505 + 0.49 * clamp01(y / YMAX);
const ZD = 10.2;
const V_DECK = (z) => 0.255 + (0.24 * (z + ZD)) / (2 * ZD);
const PERMAX = 104;
const UP = (per) => 0.005 + (0.99 * per) / PERMAX;
const BAND_ACC = [0.005, 0.105]; // стены с иллюминаторами и дверями, 0…3 м
const BAND_BRG = [0.115, 0.215]; // стены ходового мостика с окнами, 0…3 м
const V_BAND = (band, h) => band[0] + (band[1] - band[0]) * clamp01(h / 3);
const V_PLAIN = 0.228; // гладкая окраска Ocean Gray
const V_BLACK = 0.242; // чёрная полоса (верх труб)
const V_FOUL = V_SIDE(1.0); // подводная окраска
// UV текстуры полётной палубы
const FU = (x) => 0.002 + (0.996 * (x - FX0)) / (FX1 - FX0);
const FV = (z) => 0.004 + (0.992 * (z + FHW)) / (2 * FHW);

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

// Тело вращения вокруг Y по профилю [[r, y], ...] снизу вверх. r = 0 на конце — полюс.
// Крышки: top/bottom (по умолчанию верх закрыт, низ открыт — деталь стоит на поверхности).
function lathe(profile, seg = 20, { bottom = false, top = true, uv = null } = {}) {
  const m = new Mesher();
  const n = profile.length;
  const rings = [];
  const uvf = uv || ((j, k) => [j / seg, k / (n - 1)]);
  for (let k = 0; k < n; k++) {
    const [r, y] = profile[k];
    if (r === 0) {
      rings.push(m.v(new THREE.Vector3(0, y, 0), ...uvf(0, k)));
      continue;
    }
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a)), ...uvf(j, k)));
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
    const c = m.v(new THREE.Vector3(0, y, 0), ...uvf(0, k));
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ids.push(m.v(new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a)), ...uvf(j, k)));
    }
    for (let j = 0; j < seg; j++) {
      if (up) m.tri(c, ids[(j + 1) % seg], ids[j]);
      else m.tri(c, ids[j], ids[(j + 1) % seg]);
    }
  };
  if (top) capAt(n - 1, true);
  if (bottom) capAt(0, false);
  return m.build();
}
const latheX = (profile, seg, opt = { bottom: true }) => lathe(profile, seg, opt).rotateZ(-Math.PI / 2);

// Стержень между двумя точками
function rod(a, b, r, seg = 6, caps = true) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, !caps);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// Ящик с выбрасываемыми гранями: skip — список из '+x','-x','+y','-y','+z','-z'
function box(sx, sy, sz, x = 0, y = 0, z = 0, skip = ['-y'], uvRect = null) {
  const m = new Mesher();
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const P = (i, j, k) => new THREE.Vector3(x + i * hx, y + j * hy, z + k * hz);
  const faces = {
    '+x': [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)],
    '-x': [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
    '+y': [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)],
    '-y': [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
    '+z': [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
    '-z': [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
  };
  const [u0, v0, u1, v1] = uvRect || [0, 0, 1, 1];
  for (const [k, q] of Object.entries(faces)) {
    if (skip.includes(k)) continue;
    const ids = [m.v(q[0], u0, v0), m.v(q[1], u1, v0), m.v(q[2], u1, v1), m.v(q[3], u0, v1)];
    m.quad(...ids);
  }
  return m.build({ orient: false });
}

// Призма: многоугольник в плоскости XY, толщина по Z (центр z = 0)
function prism(poly, th, uvc = null) {
  const m = new Mesher();
  const pts = poly.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const uv = uvc || (() => [0.5, 0.5]);
  const front = pts.map((p) => m.v(new THREE.Vector3(p.x, p.y, th / 2), ...uv(p)));
  const back = pts.map((p) => m.v(new THREE.Vector3(p.x, p.y, -th / 2), ...uv(p)));
  tris.forEach(([a, b, c]) => {
    m.tri(front[a], front[b], front[c]);
    m.tri(back[a], back[c], back[b]);
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = m.v(new THREE.Vector3(pts[i].x, pts[i].y, th / 2), ...uv(pts[i]));
    const b = m.v(new THREE.Vector3(pts[j].x, pts[j].y, th / 2), ...uv(pts[j]));
    const c = m.v(new THREE.Vector3(pts[j].x, pts[j].y, -th / 2), ...uv(pts[j]));
    const d = m.v(new THREE.Vector3(pts[i].x, pts[i].y, -th / 2), ...uv(pts[i]));
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

const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);

// Перо: размах по +Y от y0, хорда по X (передняя кромка +X), толщина по Z
function foil({ root, tip, span, tc = 0.12, y0 = 0, nSpan = 4, nCh = 12, uvFn = null }) {
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
  return loftRings(rings, uvFn || ((p) => [clamp01((p.x - root[1]) / (root[0] - root[1] + 1e-6)), clamp01((p.y - y0) / span)]));
}

// Лопасть винта: радиальная ось +Y, ось вращения X
function bladeGeometry({ r0, r1, chord0, chord1, pitch, skew = 0, tc = 0.1, n = 7 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = lerp(chord0, chord1, Math.sin(Math.PI * Math.min(s, 0.75) / 1.5)) * (k === n ? 0.45 : 1);
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
      const h = sign * Math.max(0.008, naca(t) * tc * ch * (1 - 0.6 * s));
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

// Трубка по точкам (изогнутые шлюпбалки, поручни)
function tube(points, r, radial = 6, segs = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, segs, r, radial, false);
}

function clean(g) {
  const out = g.index ? g : mergeVertices(g);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => mergeVertices(mergeGeometries(list.map(clean)), 1e-5);
// UV всех вершин — в одну точку атласа (детали одноцветной окраски из атласа)
function uvAt(g, u, v) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}
// Надстройка: скруглённый прямоугольник в плане, стены от палубы (или от плоского основания) до крыши
function roundRect(x0, x1, hw, r, segs = 3) {
  const pts = [];
  const corners = [
    [x1 - r, hw - r, 0],
    [x0 + r, hw - r, Math.PI / 2],
    [x0 + r, -hw + r, Math.PI],
    [x1 - r, -hw + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((Math.PI / 2) * i) / segs;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  }
  return pts;
}
// Контур по корпусу: полуширина hwFn(x), скруглённые торцы (суперэллипс)
function fitOutline(x0, x1, hwFn, n = 28) {
  const pts = [];
  const xc = (x0 + x1) / 2, hx = (x1 - x0) / 2;
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(xc + hx * Math.cos((Math.PI * i) / n));
  xs.forEach((x) => pts.push([x, hwFn(x) * Math.max(0, 1 - Math.abs((x - xc) / hx) ** 10) ** 0.1]));
  for (let i = n - 1; i >= 1; i--) pts.push([xs[i], -pts[i][1]]);
  return pts;
}
// Убрать точки контура, лежащие на прямой между соседями (иначе вырожденные треугольники крыши)
function dropCollinear(pts, tol = 0.01) {
  let out = pts.slice();
  let changed = true;
  while (changed && out.length > 4) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const lx = c[0] - a[0], lz = c[1] - a[1];
      const d = Math.abs((b[0] - a[0]) * lz - (b[1] - a[1]) * lx) / (Math.hypot(lx, lz) || 1);
      if (d < tol) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function flipIf(g, bad) {
  if (!bad) return g;
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.computeVertexNormals();
  return g;
}
function deckhouse({ x0, x1, hw, r = 0.8, yTop, base, band = BAND_ACC, roof = true, outline = null }) {
  const m = new Mesher();
  const pts = outline ? outline.slice() : dropCollinear(roundRect(x0, x1, hw, r));
  pts.push(pts[0]);
  let per = 0;
  const bot = [], topR = [];
  pts.forEach(([x, z], i) => {
    if (i > 0) per += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    const yb = base(x) - 0.03;
    bot.push(m.v(new THREE.Vector3(x, yb, z), UP(per % PERMAX), V_BAND(band, 0)));
    topR.push(m.v(new THREE.Vector3(x, yTop, z), UP(per % PERMAX), V_BAND(band, yTop - yb)));
  });
  m.strip(bot, topR);
  const walls = m.build({ orient: false });
  // стены наружу: нормаль от центра
  const n = walls.attributes.normal, p = walls.attributes.position;
  const cx = (x0 + x1) / 2;
  let score = 0;
  for (let i = 0; i < n.count; i++) score += n.getX(i) * (p.getX(i) - cx) + n.getZ(i) * p.getZ(i);
  flipIf(walls, score < 0);
  if (!roof) return walls;
  const mr = new Mesher();
  const ring = pts.slice(0, -1);
  const ids = ring.map(([x, z]) => mr.v(new THREE.Vector3(x, yTop, z), U(x), V_DECK(z)));
  if (outline) {
    // контур fitOutline: правый борт 0…n, левый — в обратном порядке; крыша — полосой поперёк
    const nn = ring.length / 2;
    const Pi = (i) => (i === 0 ? 0 : i === nn ? nn : 2 * nn - i);
    for (let i = 0; i < nn; i++) mr.quad(ids[i], ids[i + 1], ids[Pi(i + 1)], ids[Pi(i)]);
  } else {
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    tris.forEach(([a, b, c]) => mr.tri(ids[a], ids[b], ids[c]));
  }
  const top = mr.build({ orient: false });
  flipIf(top, top.attributes.normal.getY(0) < 0);
  return merge([walls, top]);
}

// Леерное ограждение по ломаной [[x, z], ...] на высоте y (функция или число)
function railing(path, yb, { h = 1.0, step = 1.6, r = 0.03, closed = false } = {}) {
  const parts = [];
  const pts = closed ? [...path, path[0]] : path;
  const Y = typeof yb === 'function' ? yb : () => yb;
  let acc = step;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    if (i > 0) {
      const [xp, zp] = pts[i - 1];
      const d = Math.hypot(x - xp, z - zp);
      const n = Math.max(1, Math.round(d / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const sx = lerp(xp, x, t), sz = lerp(zp, z, t);
        if (k < n || !closed || i < pts.length - 1) parts.push(rod([sx, Y(sx) - 0.02, sz], [sx, Y(sx) + h, sz], r, 4, false));
      }
      [0.5, 1.0].forEach((f) => parts.push(rod([xp, Y(xp) + h * f, zp], [x, Y(x) + h * f, z], r * 0.8, 4, true)));
    } else parts.push(rod([x, Y(x) - 0.02, z], [x, Y(x) + h, z], r, 4, false));
    acc += 0;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function line(ctx, x0, y0, x1, y1, w, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
function ellipse(ctx, cx, cy, rx, ry, fill, stroke = null, lw = 2) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}
// Карта нормалей из карты высот (серый канал)
function heightToNormal(hgt, W, H, strength = 2.0) {
  const hd = hgt.getContext('2d').getImageData(0, 0, W, H).data;
  const nrm = makeCanvas(W, H);
  const N = nrm.getContext('2d');
  const img = N.createImageData(W, H);
  const k = strength / 255;
  const at = (xx, yy) => hd[(Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))) * 4];
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
function toTextures(col, nrm, name) {
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.anisotropy = 8;
  map.name = `${name}_Color`;
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = `${name}_Normal`;
  return { map, normalMap };
}

const OCEAN_GRAY = '#5a6772';
const DECK_BLUE = '#3a4552';

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
  const kU = (0.99 * S) / (XB - XS);
  const kV = (0.49 * S) / YMAX;
  const HX = (x) => px(U(x));
  const HY = (y) => py(V_SIDE(y));

  // ---- БОРТ И СТЕНЫ АНГАРА (v 0.5…1)
  const top = 0, bot = S / 2;
  C.fillStyle = OCEAN_GRAY;
  C.fillRect(0, top, S, bot);
  C.fillStyle = '#3a2420'; // подводная часть (тёмный необрастающий)
  C.fillRect(0, HY(5.95), S, bot - HY(5.95));
  C.fillStyle = '#1b1d1f'; // полоса ватерлинии
  C.fillRect(0, HY(6.75), S, HY(5.95) - HY(6.75));
  for (let i = 0; i < 1600; i++) {
    const x = rnd() * S, y = rnd() * bot;
    const r = 6 + rnd() * 30;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.022)';
    C.beginPath();
    C.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2);
    C.fill();
  }
  // пояса обшивки и стыки листов (сварной корпус)
  const strakes = [0, 1.8, 3.6, 5.4, 7.2, 9.0, 10.6, 12.4, 14.2, 16.0, YMAX];
  strakes.slice(1, -1).forEach((y) => {
    line(C, 0, HY(y), S, HY(y), 2, 'rgba(15,18,20,0.12)');
    line(Hc, 0, HY(y), S, HY(y), 3, 'rgb(146,146,146)');
  });
  for (let k = 0; k < strakes.length - 1; k++) {
    for (let x = XS + 1 + (k % 2) * 4; x < XB; x += 8) {
      line(C, HX(x), HY(strakes[k + 1]), HX(x), HY(strakes[k]), 1.5, 'rgba(15,18,20,0.08)');
      line(Hc, HX(x), HY(strakes[k + 1]), HX(x), HY(strakes[k]), 2, 'rgb(112,112,112)');
    }
  }
  const streak = (x, y, len, a) => {
    const g = C.createLinearGradient(0, HY(y), 0, HY(y - len));
    g.addColorStop(0, `rgba(90,58,40,${a})`);
    g.addColorStop(1, 'rgba(90,58,40,0)');
    C.fillStyle = g;
    C.fillRect(HX(x) - 2, HY(y), 3 + rnd() * 3, HY(y - len) - HY(y));
  };
  // проёмы ангара: тёмные отверстия с рамами и шторами
  for (let x = -50; x < 40; x += 9) {
    const x0 = x + 0.8, x1 = x + 7.6;
    const y0 = 11.4, y1 = 15.6;
    C.fillStyle = '#16191c';
    C.fillRect(HX(x0), HY(y1), HX(x1) - HX(x0), HY(y0) - HY(y1));
    // поднятая штора (верх проёма)
    C.fillStyle = '#4c565f';
    C.fillRect(HX(x0), HY(y1), HX(x1) - HX(x0), (HY(y0) - HY(y1)) * 0.18);
    for (let yy = y1 - 0.12; yy > y1 - 0.75; yy -= 0.14) line(C, HX(x0), HY(yy), HX(x1), HY(yy), 1, 'rgba(20,22,24,0.6)');
    // глубина: светлая полоса пола ангара
    C.fillStyle = 'rgba(70,82,96,0.55)';
    C.fillRect(HX(x0), HY(y0 + 0.45), HX(x1) - HX(x0), HY(y0) - HY(y0 + 0.45));
    C.strokeStyle = 'rgba(150,158,165,0.8)';
    C.lineWidth = 3;
    C.strokeRect(HX(x0), HY(y1), HX(x1) - HX(x0), HY(y0) - HY(y1));
    Hc.fillStyle = 'rgb(70,70,70)';
    Hc.fillRect(HX(x0), HY(y1), HX(x1) - HX(x0), HY(y0) - HY(y1));
    // стойка между проёмами
    line(Hc, HX(x + 0.4), HY(16.8), HX(x + 0.4), HY(10.8), 6, 'rgb(170,170,170)');
  }
  // иллюминаторы в баке и юте
  const port = (x, y) => {
    ellipse(C, HX(x), HY(y), 0.2 * kU + 1.5, 0.2 * kV + 2, '#2a2d30', 'rgba(150,155,158,0.9)', 3);
    ellipse(C, HX(x), HY(y), 0.14 * kU, 0.14 * kV, '#121619');
    ellipse(Hc, HX(x), HY(y), 0.21 * kU + 1.5, 0.21 * kV + 2, 'rgb(170,170,170)');
    ellipse(Hc, HX(x), HY(y), 0.14 * kU, 0.14 * kV, 'rgb(60,60,60)');
    if (rnd() < 0.3) streak(x + 0.05, y - 0.25, 0.8 + rnd() * 1.5, 0.2);
  };
  for (let x = 50; x < 70; x += 2.2) port(x, 9.2);
  for (let x = -72; x < -58; x += 2.2) port(x, 9.0);
  // клюзы
  ellipse(C, HX(73.5), HY(11.2), 0.55 * kU, 0.45 * kV, '#16181a', 'rgba(60,64,66,1)', 4);
  ellipse(Hc, HX(73.5), HY(11.2), 0.6 * kU, 0.5 * kV, 'rgb(50,50,50)');
  streak(73.4, 10.7, 3.5, 0.35);
  // шпигаты главной палубы
  for (let x = -70; x < 72; x += 4.6) {
    const y = deckY(x) + 0.12;
    C.fillStyle = '#1b1d1e';
    C.fillRect(HX(x) - 3, HY(y + 0.12), 6, HY(y) - HY(y + 0.12));
    if (rnd() < 0.5) streak(x, y - 0.05, 1 + rnd() * 2.5, 0.18);
  }
  // марки углубления
  [74.0, -66.8].forEach((x) => {
    for (let y = 1; y <= 7; y += 0.5) {
      C.fillStyle = 'rgba(225,225,220,0.85)';
      C.fillRect(HX(x) - 2, HY(y + 0.15), 5, HY(y) - HY(y + 0.15));
    }
  });

  // ---- ГЛАВНАЯ ПАЛУБА (v 0.255…0.495) — сталь, Deck Blue 20-B
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = DECK_BLUE;
  C.fillRect(0, d0, S, d1 - d0);
  for (let i = 0; i < 1800; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
    C.fillRect(rnd() * S, d0 + rnd() * (d1 - d0), 10 + rnd() * 60, 2 + rnd() * 6);
  }
  for (let x = XS + 2; x < XB; x += 6) {
    line(C, HX(x), d0, HX(x), d1, 1.5, 'rgba(10,14,18,0.25)');
    line(Hc, HX(x), d0, HX(x), d1, 2, 'rgb(110,110,110)');
  }
  for (let z = -ZD + 1.8; z < ZD; z += 1.8) {
    const y = py(V_DECK(z));
    line(C, 0, y, S, y, 1.5, 'rgba(10,14,18,0.25)');
    line(Hc, 0, y, S, y, 2, 'rgb(110,110,110)');
  }

  // ---- НАДСТРОЙКИ (v 0…0.25)
  const t0 = py(0.25);
  C.fillStyle = OCEAN_GRAY;
  C.fillRect(0, t0, S, S - t0);
  const BY = (band, h) => py(V_BAND(band, h));
  const kP = (0.99 * S) / PERMAX;
  [BAND_ACC, BAND_BRG].forEach((band) => {
    const g = C.createLinearGradient(0, BY(band, 0), 0, BY(band, 0.6));
    g.addColorStop(0, 'rgba(40,44,48,0.35)');
    g.addColorStop(1, 'rgba(40,44,48,0)');
    C.fillStyle = g;
    C.fillRect(0, BY(band, 0.6), S, BY(band, 0) - BY(band, 0.6));
    [0.9, 2.1].forEach((h) => {
      line(C, 0, BY(band, h), S, BY(band, h), 2, 'rgba(20,24,26,0.18)');
      line(Hc, 0, BY(band, h), S, BY(band, h), 2, 'rgb(150,150,150)');
    });
    for (let p = 1.2; p < PERMAX; p += 2.4) {
      line(C, px(UP(p)), BY(band, 3), px(UP(p)), BY(band, 0), 1.5, 'rgba(20,24,26,0.12)');
      line(Hc, px(UP(p)), BY(band, 3), px(UP(p)), BY(band, 0), 1.5, 'rgb(118,118,118)');
    }
  });
  const kB = ((BAND_ACC[1] - BAND_ACC[0]) * S) / 3;
  for (let p = 0.9; p < PERMAX; p += 2.3) {
    const cx = px(UP(p)), cy = BY(BAND_ACC, 1.7);
    if (Math.abs(((p + 6) % 11) - 5.5) < 1.2) continue;
    ellipse(C, cx, cy, 0.2 * kP + 1.5, 0.2 * kB + 1.5, '#2c3034', 'rgba(160,165,168,0.9)', 2);
    ellipse(C, cx, cy, 0.14 * kP, 0.14 * kB, '#111518');
    ellipse(Hc, cx, cy, 0.21 * kP + 1.5, 0.21 * kB + 1.5, 'rgb(170,170,170)');
    ellipse(Hc, cx, cy, 0.14 * kP, 0.14 * kB, 'rgb(60,60,60)');
  }
  for (let p = 5.5; p < PERMAX; p += 11) {
    const x0 = px(UP(p - 0.4)), x1 = px(UP(p + 0.4));
    C.fillStyle = '#626d76';
    C.fillRect(x0, BY(BAND_ACC, 1.95), x1 - x0, BY(BAND_ACC, 0.15) - BY(BAND_ACC, 1.95));
    C.strokeStyle = 'rgba(25,28,30,0.9)';
    C.lineWidth = 3;
    C.strokeRect(x0, BY(BAND_ACC, 1.95), x1 - x0, BY(BAND_ACC, 0.15) - BY(BAND_ACC, 1.95));
    Hc.strokeStyle = 'rgb(60,60,60)';
    Hc.lineWidth = 4;
    Hc.strokeRect(x0, BY(BAND_ACC, 1.95), x1 - x0, BY(BAND_ACC, 0.15) - BY(BAND_ACC, 1.95));
  }
  for (let p = 0.4; p < PERMAX; p += 1.15) {
    const x0 = px(UP(p)), x1 = px(UP(p + 0.85));
    const ya = BY(BAND_BRG, 2.2), yb = BY(BAND_BRG, 1.35);
    C.fillStyle = '#1a2328';
    C.fillRect(x0, ya, x1 - x0, yb - ya);
    C.fillStyle = 'rgba(160,185,195,0.22)';
    C.fillRect(x0 + 2, ya + 2, (x1 - x0) * 0.4, (yb - ya) * 0.35);
    C.strokeStyle = 'rgba(170,176,180,0.9)';
    C.lineWidth = 3;
    C.strokeRect(x0, ya, x1 - x0, yb - ya);
    Hc.fillStyle = 'rgb(70,70,70)';
    Hc.fillRect(x0, ya, x1 - x0, yb - ya);
  }
  // гладкая полоса и чёрная полоса
  C.fillStyle = '#58656f';
  C.fillRect(0, py(0.235), S, py(0.221) - py(0.235));
  C.fillStyle = '#17181a';
  C.fillRect(0, py(0.247), S, py(0.238) - py(0.247));

  return toTextures(col, heightToNormal(hgt, S, S), 'Paint_Atlas');
}

// Полётная палуба: деревянный настил, окрашенный Deck Blue, разметка 1944 г. (белые пунктиры), аэрофинишёры
const FDT_W = 2048, FDT_H = 512;
const WIRES = [-41, -37.5, -34, -30.5, -27, -23.5, -20, -16.5, -13];
const BARRIERS = [-5.5, -1.5];
const CAT_Z = -4.6, CAT_X0 = 47.0, CAT_X1 = 70.2;
function paintFlightDeck() {
  const W = FDT_W, H = FDT_H;
  const col = makeCanvas(W, H), hgt = makeCanvas(W, H);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  let seed = 424242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const PX = (x) => FU(x) * W;
  const PY = (z) => (1 - FV(z)) * H;
  Hc.fillStyle = 'rgb(128,128,128)';
  Hc.fillRect(0, 0, W, H);
  C.fillStyle = DECK_BLUE;
  C.fillRect(0, 0, W, H);
  // доски настила вдоль палубы, 15 см
  const plank = 0.155;
  for (let z = -FHW; z < FHW; z += plank) {
    const ya = PY(z + plank), yb = PY(z);
    let x = FX0 - rnd() * 6;
    while (x < FX1) {
      const len = 5 + rnd() * 5;
      const t = Math.round((rnd() - 0.5) * 14);
      C.fillStyle = `rgb(${58 + t},${69 + t},${82 + t})`;
      C.fillRect(PX(x), ya, PX(x + len) - PX(x), yb - ya);
      line(C, PX(x), ya, PX(x), yb, 1, 'rgba(15,20,26,0.6)');
      line(Hc, PX(x), ya, PX(x), yb, 1, 'rgb(105,105,105)');
      x += len;
    }
    line(C, 0, yb, W, yb, 1, 'rgba(18,24,30,0.7)');
    line(Hc, 0, yb, W, yb, 1, 'rgb(100,100,100)');
  }
  // поперечные стальные полосы крепления самолётов
  for (let x = FX0 + 3; x < FX1 - 1; x += 3.2) {
    line(C, PX(x), PY(FHW - 0.6), PX(x), PY(-FHW + 0.6), 1.5, 'rgba(110,118,124,0.35)');
    line(Hc, PX(x), PY(FHW - 0.6), PX(x), PY(-FHW + 0.6), 1.5, 'rgb(140,140,140)');
  }
  // потёртости и следы шин в зоне посадки
  for (let i = 0; i < 900; i++) {
    const x = FX0 + rnd() * (FX1 - FX0), z = (rnd() - 0.5) * 2 * FHW * 0.9;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)';
    C.fillRect(PX(x), PY(z), 6 + rnd() * 40, 1 + rnd() * 3);
  }
  for (let i = 0; i < 70; i++) {
    const z = (rnd() - 0.5) * 7;
    const x0 = -60 + rnd() * 30;
    C.fillStyle = 'rgba(15,15,16,0.10)';
    C.fillRect(PX(x0), PY(z) - 1, PX(x0 + 6 + rnd() * 25) - PX(x0), 2);
  }
  const WHITE = 'rgba(222,224,220,0.82)';
  const dash = (xa, za, xb, zb, w, on, off) => {
    const L = Math.hypot(xb - xa, zb - za);
    for (let s = 0; s < L; s += on + off) {
      const e = Math.min(L, s + on);
      const ax = lerp(xa, xb, s / L), az = lerp(za, zb, s / L);
      const bx = lerp(xa, xb, e / L), bz = lerp(za, zb, e / L);
      line(C, PX(ax), PY(az), PX(bx), PY(bz), w, WHITE);
    }
  };
  const mPx = W / (FX1 - FX0);
  // осевая линия — пунктир
  dash(FX0 + 2, 0, FX1 - 1.5, 0, 0.3 * mPx, 3.0, 3.0);
  // линии кромки палубы
  dash(FX0 + 1.5, FHW - 0.5, FX1 - 1.5, FHW - 0.5, 0.15 * mPx, 1.5, 1.5);
  dash(FX0 + 1.5, -FHW + 0.5, FX1 - 1.5, -FHW + 0.5, 0.15 * mPx, 1.5, 1.5);
  // поперечные линии на срезах палубы
  line(C, PX(FX0 + 1.0), PY(FHW - 1), PX(FX0 + 1.0), PY(-FHW + 1), 0.3 * mPx, WHITE);
  line(C, PX(FX1 - 1.0), PY(FHW - 1), PX(FX1 - 1.0), PY(-FHW + 1), 0.3 * mPx, WHITE);
  // обводка подъёмников (пунктир) и плиты подъёмников
  ELEV.forEach((e) => {
    const xa = e.x - e.lx / 2 - 0.35, xb = e.x + e.lx / 2 + 0.35, za = -e.hz - 0.35, zb = e.hz + 0.35;
    dash(xa, za, xb, za, 0.2 * mPx, 1, 0.8);
    dash(xb, za, xb, zb, 0.2 * mPx, 1, 0.8);
    dash(xb, zb, xa, zb, 0.2 * mPx, 1, 0.8);
    dash(xa, zb, xa, za, 0.2 * mPx, 1, 0.8);
    C.fillStyle = 'rgba(30,36,44,0.35)';
    C.fillRect(PX(e.x - e.lx / 2), PY(e.hz), PX(e.x + e.lx / 2) - PX(e.x - e.lx / 2), PY(-e.hz) - PY(e.hz));
    for (let x = e.x - e.lx / 2 + 1.5; x < e.x + e.lx / 2; x += 1.5) line(Hc, PX(x), PY(e.hz), PX(x), PY(-e.hz), 2, 'rgb(150,150,150)');
  });
  // тросы аэрофинишёров: тёмные полосы-канавки, белые метки у кромок
  WIRES.forEach((x) => {
    line(C, PX(x), PY(10.9), PX(x), PY(-10.9), 3, 'rgba(25,28,30,0.85)');
    line(Hc, PX(x), PY(10.9), PX(x), PY(-10.9), 3, 'rgb(80,80,80)');
    [1, -1].forEach((sd) => {
      C.fillStyle = WHITE;
      C.fillRect(PX(x - 0.4), PY(sd * 11.6), PX(x + 0.4) - PX(x - 0.4), Math.abs(PY(11.6) - PY(10.8)) * (sd > 0 ? 1 : -1));
    });
  });
  BARRIERS.forEach((x) => {
    line(C, PX(x), PY(10.9), PX(x), PY(-10.9), 0.25 * mPx, 'rgba(210,190,60,0.7)');
  });
  // катапульта H-II на баке слева: желоб и стрелка
  C.fillStyle = 'rgba(20,24,28,0.9)';
  C.fillRect(PX(CAT_X0), PY(CAT_Z + 0.3), PX(CAT_X1) - PX(CAT_X0), PY(CAT_Z - 0.3) - PY(CAT_Z + 0.3));
  Hc.fillStyle = 'rgb(60,60,60)';
  Hc.fillRect(PX(CAT_X0), PY(CAT_Z + 0.12), PX(CAT_X1) - PX(CAT_X0), PY(CAT_Z - 0.12) - PY(CAT_Z + 0.12));
  dash(CAT_X0, CAT_Z + 1.0, CAT_X1, CAT_Z + 1.0, 0.12 * mPx, 1, 1);
  dash(CAT_X0, CAT_Z - 1.0, CAT_X1, CAT_Z - 1.0, 0.12 * mPx, 1, 1);
  // смотровые люки и рымы
  for (let i = 0; i < 160; i++) {
    const x = FX0 + 2 + rnd() * (FX1 - FX0 - 4), z = (rnd() - 0.5) * 2 * (FHW - 1);
    ellipse(C, PX(x), PY(z), 2, 2, 'rgba(120,128,134,0.5)');
    ellipse(Hc, PX(x), PY(z), 2, 2, 'rgb(160,160,160)');
  }
  return toTextures(col, heightToNormal(hgt, W, H, 1.6), 'Flight_Deck');
}

// ---------------------------------------------------------------------------
// КОРПУС: замкнутая оболочка — днище, скула, борт, фальшборт, главная палуба.
// Под ангаром палубы нет: там на неё опираются стены ангара (нет скрытых граней).

function buildHull() {
  const m = new Mesher();
  const NST = 160;
  let ts = [];
  for (let i = 0; i <= NST; i++) {
    const u = i / NST;
    ts.push(0.3 * u + 0.7 * (0.5 - 0.5 * Math.cos(Math.PI * u)));
  }
  // шпангоуты точно на торцах ангара
  const tAt = (x) => {
    const y = deckY(x);
    return (x - xSternEnd(y)) / (xStem(y) - xSternEnd(y));
  };
  const tH0 = tAt(HG.x0), tH1 = tAt(HG.x1);
  ts = ts.filter((t) => Math.abs(t - tH0) > 0.002 && Math.abs(t - tH1) > 0.002);
  ts.push(tH0, tH1);
  ts.sort((a, b) => a - b);
  const sideYs = (yTop) => {
    const ys = [];
    const seg = (a, b, n) => {
      for (let i = 0; i < n; i++) ys.push(lerp(a, b, i / n));
    };
    seg(RB, 4.2, 3);
    seg(4.2, 5.95, 3);
    seg(5.95, 6.75, 2);
    seg(6.75, 8.5, 3);
    seg(8.5, yTop, 4);
    ys.push(yTop);
    return ys;
  };
  const NB = 5, NBL = 8;
  const solveY = (t, f) => {
    let y = 11;
    for (let i = 0; i < 8; i++) y = f(X(t, y));
    return y;
  };
  const regions = { bottom: [], side: [], cap: [], inner: [] };
  const decks = [];
  for (const t of ts) {
    const yTop = solveY(t, (x) => deckY(x) + BUL);
    const yDk = solveY(t, (x) => deckY(x));
    const bottom = [];
    for (let j = 0; j <= NB; j++) {
      const zb = ((B2 - RB) * j) / NB;
      const x = X(t, 0);
      bottom.push([new THREE.Vector3(x, 0, zb * fullness(x, 0)), U(x), lerp(0.506, V_SIDE(0.35), j / NB)]);
    }
    const side = [];
    for (let j = 0; j <= NBL; j++) {
      const a = ((Math.PI / 2) * j) / NBL;
      const y = RB - RB * Math.cos(a);
      const zb = B2 - RB + RB * Math.sin(a);
      const x = X(t, y);
      side.push([new THREE.Vector3(x, y, zb * fullness(x, y)), U(x), V_SIDE(y)]);
    }
    sideYs(yTop).slice(1).forEach((y) => {
      const x = X(t, y);
      side.push([new THREE.Vector3(x, y, B2 * fullness(x, y)), U(x), V_SIDE(y)]);
    });
    const outerTop = side[side.length - 1][0];
    const zIn = Math.max(0, outerTop.z - 0.2);
    const xTop = outerTop.x;
    const cap = [
      [outerTop.clone(), U(xTop), V_SIDE(yTop)],
      [new THREE.Vector3(xTop, yTop, zIn), U(xTop), V_SIDE(yTop - 0.05)],
    ];
    const inner = [];
    for (let j = 0; j <= 2; j++) {
      const y = lerp(yTop, yDk, j / 2);
      const x = X(t, y);
      inner.push([new THREE.Vector3(x, y, Math.max(0, Math.min(zIn, B2 * fullness(x, y) - 0.2))), U(x), V_SIDE(y)]);
    }
    const zEdge = inner[inner.length - 1][0].z;
    const xd = X(t, yDk);
    const zW = Math.min(HG.hw, zEdge * 0.985);
    const zs = [zEdge, zW, zW * 0.75, zW * 0.5, zW * 0.25, 0];
    const dS = zs.map((z) => m.v(new THREE.Vector3(xd, yDk, z), U(xd), V_DECK(z)));
    const dP = zs.map((z) => m.v(new THREE.Vector3(xd, yDk, -z), U(xd), V_DECK(-z)));
    decks.push({ x: xd, S: dS, P: dP });
    const add = (name, list) => {
      const S = list.map(([p, u, v]) => m.v(p, u, v));
      const P = list.map(([p, u, v]) => m.v(new THREE.Vector3(p.x, p.y, -p.z), u, v));
      regions[name].push({ S, P });
    };
    add('bottom', bottom);
    add('side', side);
    add('cap', cap);
    add('inner', inner);
  }
  for (const reg of Object.values(regions)) {
    for (let k = 0; k < reg.length - 1; k++) {
      m.strip(reg[k].S, reg[k + 1].S);
      m.strip(reg[k + 1].P, reg[k].P);
    }
  }
  for (let k = 0; k < decks.length - 1; k++) {
    const a = decks[k], b = decks[k + 1];
    const under = a.x >= HG.x0 - 0.01 && b.x <= HG.x1 + 0.01;
    const jMax = under ? 1 : a.S.length - 1;
    for (let j = 0; j < jMax; j++) {
      m.quad(a.S[j], b.S[j], b.S[j + 1], a.S[j + 1]);
      m.quad(b.P[j], a.P[j], a.P[j + 1], b.P[j + 1]);
    }
  }
  return m.build();
}

// Замкнутое тело: контур в плане [[x, z], ...], от y0 до y1, с полом и крышей
function slab(outline, y0, y1, uvWall, uvCap) {
  const m = new Mesher();
  const pts = outline.slice();
  pts.push(pts[0]);
  let per = 0;
  const b = [], t = [];
  pts.forEach(([x, z], i) => {
    if (i > 0) per += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    b.push(m.v(new THREE.Vector3(x, y0, z), ...uvWall(per, 0)));
    t.push(m.v(new THREE.Vector3(x, y1, z), ...uvWall(per, y1 - y0)));
  });
  m.strip(b, t);
  const ring = outline.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(ring, []);
  const top = outline.map(([x, z]) => m.v(new THREE.Vector3(x, y1, z), ...uvCap(x, z)));
  const bot = outline.map(([x, z]) => m.v(new THREE.Vector3(x, y0, z), ...uvCap(x, z)));
  // ориентация по знаку объёма всей оболочки (сборка — orient)
  tris.forEach(([p, q, r]) => {
    m.tri(top[p], top[q], top[r]);
    m.tri(bot[p], bot[r], bot[q]);
  });
  return m.build();
}

// Ориентация части: want(p) — желаемое направление нормали в точке p
function orientBy(g, want) {
  g.computeVertexNormals();
  const n = g.attributes.normal, p = g.attributes.position;
  const v = new THREE.Vector3();
  let sc = 0;
  for (let i = 0; i < n.count; i++) {
    const w = want(v.fromBufferAttribute(p, i));
    sc += n.getX(i) * w.x + n.getY(i) * w.y + n.getZ(i) * w.z;
  }
  return flipIf(g, sc < 0);
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Полётная палуба: верх (текстура палубы) и конструкция (кромка, низ, шахты подъёмников) — атлас
function buildFlightDeck() {
  const outline = dropCollinear(roundRect(FX0, FX1, FHW, 2.6, 4));
  const V2 = (a) => a.map(([x, z]) => new THREE.Vector2(x, z));
  const holes = ELEV.map((e) => {
    const xa = e.x - e.lx / 2 - EGAP, xb = e.x + e.lx / 2 + EGAP, h = e.hz + EGAP;
    return [[xa, -h], [xb, -h], [xb, h], [xa, h]];
  });
  const yB = FD - FT;
  // верх
  const mt = new Mesher();
  const ids = [...outline, ...holes.flat()].map(([x, z]) => mt.v(V3(x, FD, z), FU(x), FV(z)));
  THREE.ShapeUtils.triangulateShape(V2(outline), holes.map(V2)).forEach(([a, b, c]) => mt.tri(ids[a], ids[b], ids[c]));
  const top = orientBy(mt.build({ orient: false }), () => V3(0, 1, 0));
  const parts = [];
  // кромка
  {
    const m = new Mesher();
    const ring = [...outline, outline[0]];
    let per = 0;
    const a = [], b = [];
    ring.forEach(([x, z], i) => {
      if (i > 0) per += Math.hypot(x - ring[i - 1][0], z - ring[i - 1][1]);
      a.push(m.v(V3(x, yB, z), UP(per % PERMAX), V_PLAIN - 0.004));
      b.push(m.v(V3(x, FD, z), UP(per % PERMAX), V_PLAIN + 0.004));
    });
    for (let i = 0; i < a.length - 1; i++) m.quad(a[i], a[i + 1], b[i + 1], b[i]);
    parts.push(orientBy(m.build({ orient: false }), (p) => V3(Math.sign(p.x) * Math.max(0, Math.abs(p.x) - 60), 0, p.z)));
  }
  // низ палубы — с вырезом над ангаром
  {
    const m = new Mesher();
    const hole = [[HG.x0, -HG.hw], [HG.x1, -HG.hw], [HG.x1, HG.hw], [HG.x0, HG.hw]];
    const ii = [...outline, ...hole].map(([x, z]) => m.v(V3(x, yB, z), U(x), V_PLAIN + (0.004 * z) / FHW));
    THREE.ShapeUtils.triangulateShape(V2(outline), [V2(hole)]).forEach(([a, b, c]) => m.tri(ii[a], ii[b], ii[c]));
    parts.push(orientBy(m.build({ orient: false }), () => V3(0, -1, 0)));
  }
  // шахты подъёмников: стенки внутрь, пол — палуба ангара
  holes.forEach((h) => {
    const cx = (h[0][0] + h[1][0]) / 2;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const m = new Mesher();
      const [x0, z0] = h[i], [x1, z1] = h[j];
      const L = Math.hypot(x1 - x0, z1 - z0);
      const q = [m.v(V3(x0, FLOOR, z0), 0.3, V_PLAIN - 0.005), m.v(V3(x1, FLOOR, z1), 0.3 + L / 100, V_PLAIN - 0.005), m.v(V3(x1, FD, z1), 0.3 + L / 100, V_PLAIN + 0.005), m.v(V3(x0, FD, z0), 0.3, V_PLAIN + 0.005)];
      m.quad(...q);
      parts.push(orientBy(m.build({ orient: false }), (p) => V3(cx - p.x, 0, -p.z)));
    }
    const m = new Mesher();
    const F = h.map(([x, z]) => m.v(V3(x, FLOOR, z), U(x), V_DECK(z)));
    m.quad(F[0], F[1], F[2], F[3]);
    parts.push(orientBy(m.build({ orient: false }), () => V3(0, 1, 0)));
  });
  return { top, structure: merge(parts) };
}

// Стены ангара: замкнутый пояс от главной палубы до низа полётной палубы (торцы — свои UV)
function buildHangarWalls() {
  const yT = FD - FT;
  const parts = [];
  const wall = (pa, pb, n, uvx, out) => {
    const m = new Mesher();
    const b = [], t = [];
    for (let i = 0; i <= n; i++) {
      const x = lerp(pa[0], pb[0], i / n), z = lerp(pa[1], pb[1], i / n);
      const yb = deckY(x) - 0.03;
      b.push(m.v(V3(x, yb, z), U(uvx(x, z)), V_SIDE(yb)));
      t.push(m.v(V3(x, yT, z), U(uvx(x, z)), V_SIDE(yT)));
    }
    for (let i = 0; i < n; i++) m.quad(b[i], b[i + 1], t[i + 1], t[i]);
    parts.push(orientBy(m.build({ orient: false }), () => out));
  };
  wall([HG.x0, HG.hw], [HG.x1, HG.hw], 26, (x) => x, V3(0, 0, 1));
  wall([HG.x0, -HG.hw], [HG.x1, -HG.hw], 26, (x) => x, V3(0, 0, -1));
  wall([HG.x1, -HG.hw], [HG.x1, HG.hw], 6, (x, z) => HG.x1 + 0.28 * z, V3(1, 0, 0));
  wall([HG.x0, -HG.hw], [HG.x0, HG.hw], 6, (x, z) => HG.x0 + 0.28 * z, V3(-1, 0, 0));
  return merge(parts);
}

// Шлюпка (половина: верх — чехол, низ — корпус)
function boatHalf(bx, yg, zc, upper, L = 3.45) {
  const m = new Mesher();
  const rows = [];
  const J = 8;
  for (let k = 0; k <= 14; k++) {
    const sx = -1 + (2 * k) / 14;
    const w = Math.max(0.03, Math.sqrt(Math.max(0, 1 - Math.abs(sx) ** (sx > 0 ? 2.0 : 3.0)))) * 1.0;
    const dep = 0.9 * (1 - 0.25 * sx * sx);
    const sheer = 0.16 * sx * sx;
    const row = [];
    for (let j = 0; j <= J; j++) {
      const ang = upper ? Math.PI - (j / J) * Math.PI : Math.PI + (j / J) * Math.PI;
      const yy = upper ? Math.sin(ang) * 0.24 * (w + 0.1) : Math.sin(ang) * dep * Math.min(1, w / 0.6);
      row.push(m.v(new THREE.Vector3(bx + sx * L, yg + sheer + yy, zc + Math.cos(ang) * w), k / 14, j / J));
    }
    rows.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++) m.strip(rows[k], rows[k + 1]);
  const gg = m.build({ orient: false });
  const nA = gg.attributes.normal, pA = gg.attributes.position;
  let sc = 0;
  for (let i = 0; i < pA.count; i++) sc += nA.getY(i) * (pA.getY(i) - yg) + nA.getZ(i) * (pA.getZ(i) - zc);
  return flipIf(gg, sc < 0);
}

// Зеркальная копия по Z (с разворотом обхода)
function mirrorZ(g) {
  const c = g.clone();
  c.scale(1, 1, -1);
  const idx = c.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  c.computeVertexNormals();
  return c;
}

// ---------------------------------------------------------------------------
// РАСПОЛОЖЕНИЕ

const ISL = { x0: 21.5, x1: 33.0, zc: 13.95, hw: 1.5, y0: 14.6, y1: 19.4, y2: 21.8 };
const MAST = { x: 27.2, z: ISL.zc, top: 30.0 };
const STACKS = [-31.0, -37.5];
const STACK_Z = 13.1;
const SPONSON_Z = 13.95;
const BOFORS = [
  ['Bofors_1', 66.0, 1], ['Bofors_2', 66.0, -1],
  ['Bofors_3', 8.0, 1], ['Bofors_4', 28.0, -1],
  ['Bofors_5', -46.0, 1], ['Bofors_6', -20.0, -1],
  ['Bofors_7', -67.0, 1], ['Bofors_8', -67.0, -1],
];
const SPONSON_Y = 16.0;
const CATWALK_Y = 16.45;
const GUN5 = { x: -70.0, y: deckY(-70.0) + 1.0 };
const PROP = { x: -63.5, y: 2.4, z: 3.7, r: 1.85 };
const RUD = { x: -70.6, y0: 0.9, y1: 4.25 };
const BOATS = [[-10.0, 1], [-10.0, -1]];

// Отрезки галерей вдоль кромки (без спонсонов, острова и труб)
function catwalkSpans(sd) {
  const cuts = [];
  BOFORS.forEach(([, x, s]) => s === sd && cuts.push([x - 2.9, x + 2.9]));
  STACKS.forEach((x) => cuts.push([x - 1.15, x + 1.15]));
  if (sd > 0) cuts.push([ISL.x0 - 1.0, ISL.x1 + 1.0]);
  cuts.sort((a, b) => a[0] - b[0]);
  const spans = [];
  let x = FX0 + 4.5;
  cuts.forEach(([a, b]) => {
    if (a > x + 1.5) spans.push([x, a]);
    x = Math.max(x, b);
  });
  if (FX1 - 4.5 > x + 1.5) spans.push([x, FX1 - 4.5]);
  return spans;
}

// ---------------------------------------------------------------------------

export function createCasablanca() {
  const ship = new THREE.Group();
  ship.name = 'Escort_Carrier_Casablanca';
  const atlas = paintAtlas();
  const fdt = paintFlightDeck();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    paint: std('Hull_Paint_Atlas', 0xffffff, 0.8, 0.1, { map: atlas.map, normalMap: atlas.normalMap }),
    deck: std('Flight_Deck_Wood', 0xffffff, 0.86, 0.0, { map: fdt.map, normalMap: fdt.normalMap }),
    steel: std('Steel_Ocean_Gray', 0x5a6772, 0.66, 0.2),
    dark: std('Steel_Dark', 0x26292c, 0.6, 0.35),
    gun: std('Gun_Steel', 0x4f565c, 0.45, 0.55),
    bronze: std('Propeller_Bronze', 0x9b7745, 0.32, 0.9),
    wire: std('Rigging_Wire', 0x2a2b2c, 0.55, 0.5),
    canvas: std('Canvas_Covers', 0x8f8c78, 0.92, 0.0),
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
  const yB = FD - FT;

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  mesh(buildHull(), M.paint, 'Hull_Shell', hullG);
  mesh(buildHangarWalls(), M.paint, 'Hangar_Walls', hullG);
  {
    // подводные выступы: скуловые кили, мортиры валов, кронштейны, подпятник руля
    const parts = [];
    [1, -1].forEach((sd) => {
      const kz = B2 - RB + RB * Math.SQRT1_2;
      const ky = RB - RB * Math.SQRT1_2;
      const bk = box(40, 0.08, 0.6, 0, 0, 0, []).rotateX((sd * Math.PI) / 4);
      bk.translate(0, ky - 0.2, sd * (kz + 0.2));
      parts.push(bk);
      const z = sd * PROP.z;
      // мортира вала (выход из корпуса) и вал
      parts.push(latheX([[0, -53.0], [0.75, -53.4], [0.75, -55.0], [0.55, -57.0], [0.42, -58.0]], 14, { bottom: false, top: true }).translate(0, PROP.y, z));
      parts.push(latheX([[0.3, -61.9], [0.3, -57.9]], 10, { bottom: true, top: true }).translate(0, PROP.y, z));
      // кронштейн гребного вала (A-образный)
      parts.push(latheX([[0.42, -61.6], [0.42, -60.6]], 12, { bottom: true, top: true }).translate(0, PROP.y, z));
      const hz = sideZ(-61.1, 3.6);
      parts.push(rod([-61.1, PROP.y + 0.3, z], [-61.1, 3.6, sd * Math.max(0.2, hz - 0.15)], 0.13, 6));
      parts.push(rod([-61.1, PROP.y - 0.3, z - sd * 0.1], [-61.1, 1.0, sd * Math.max(0.15, sideZ(-61.1, 1.0) - 0.1)], 0.13, 6));
    });
    // подпятник руля у ахтерштевня
    parts.push(box(3.6, 0.35, 0.45, -69.0, 0.68, 0, []));
    const g = merge(parts);
    uvAt(g, U(-60), V_FOUL);
    mesh(g, M.paint, 'Hull_Appendages', hullG);
    // якоря
    const anc = [];
    [1, -1].forEach((sd) => {
      const x = 73.5, y = 10.9;
      const n = sideNormal(x, y);
      const a = merge([
        box(0.2, 1.3, 0.16, 0, 0.25, 0, []),
        prism([[-0.85, -0.35], [0.85, -0.35], [0.5, -0.85], [0, -0.5], [-0.5, -0.85]], 0.34),
        box(0.6, 0.22, 0.14, 0, 0.95, 0, []),
      ]);
      if (sd < 0) n.z = -n.z;
      a.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
      a.translate(x, y, sd * (sideZ(x, y) + 0.06));
      anc.push(a);
    });
    mesh(merge(anc), M.dark, 'Anchors', hullG);
    // оборудование главной палубы: брашпиль, кнехты, цепные трубы, киповые планки
    const f = [];
    {
      const x = 64.0, y = deckY(x);
      f.push(box(2.4, 0.9, 1.8, x, y + 0.45, 0, ['-y']));
      f.push(latheX([[0, -2.5], [0.48, -2.4], [0.48, -1.5], [0.52, -1.4], [0.52, 1.4], [0.48, 1.5], [0.48, 2.4], [0, 2.5]], 16, { top: false }).rotateY(Math.PI / 2).translate(x, y + 1.0, 0));
      [1, -1].forEach((sd) => {
        f.push(lathe([[0.6, 0.06], [0.45, 0.25], [0.45, 0.6], [0.65, 0.65], [0.65, 0.75], [0, 0.77]], 16).translate(x + 1.9, y, sd * 1.9));
        f.push(lathe([[0.45, -0.05], [0.45, 0.12], [0, 0.14]], 16).translate(70.5, deckY(70.5), sd * 2.1));
      });
    }
    const bollard = () => {
      const p = () => lathe([[0.2, -0.05], [0.18, 0.5], [0.24, 0.55], [0.24, 0.62], [0, 0.64]], 10);
      return merge([p().translate(0.5, 0, 0), p().translate(-0.5, 0, 0), box(1.45, 0.1, 0.55, 0, 0.0, 0)]);
    };
    [[72.0, 0.7], [56.0, 0.85], [-60.0, 0.85], [-72.0, 0.75]].forEach(([x, k]) => {
      [1, -1].forEach((sd) => f.push(bollard().translate(x, deckY(x), sd * sideZ(x, deckY(x)) * k)));
    });
    [[68, 1], [52, 1], [-64, 1]].forEach(([x]) => {
      [1, -1].forEach((sd) => f.push(box(1.0, 0.32, 0.34, x, deckY(x) + BUL + 0.16, sd * (sideZ(x, deckY(x) + BUL) - 0.1), ['-y'])));
    });
    mesh(merge(f), M.steel, 'Main_Deck_Fittings', hullG);
  }

  // ======================= ПОЛЁТНАЯ ПАЛУБА
  const fdG = group('Flight_Deck', ship);
  {
    const { top, structure } = buildFlightDeck();
    mesh(top, M.deck, 'Flight_Deck_Surface', fdG);
    mesh(structure, M.paint, 'Flight_Deck_Structure', fdG);
    // опоры: стойки и балки на баке и юте, кницы под свесом над галереями
    const s = [];
    const column = (x, z) => {
      const y0 = deckY(x) - 0.03;
      s.push(lathe([[0.32, y0], [0.32, y0 + 0.25], [0.22, y0 + 0.4], [0.22, yB + 0.03]], 10, { top: false }).translate(x, 0, z));
    };
    [52, 60, 68].forEach((x) => [5, -5].forEach((z) => column(x, z)));
    [-61, -66, -71].forEach((x) => [5.6, -5.6].forEach((z) => column(x, z)));
    // поперечные балки (открыты сверху, заходят в настил на 3 см)
    [52, 60, 68, 71].forEach((x) => s.push(box(0.45, 0.65, 2 * FHW - 1.2, x, yB - 0.65 / 2 + 0.03, 0, ['+y'])));
    [-61, -66, -71].forEach((x) => s.push(box(0.45, 0.65, 2 * FHW - 1.2, x, yB - 0.65 / 2 + 0.03, 0, ['+y'])));
    [5, -5].forEach((z) => s.push(box(FX1 - HG.x1 - 0.8, 0.5, 0.35, (FX1 + HG.x1) / 2 - 0.2, yB - 0.25 + 0.03, z, ['+y'])));
    [5.6, -5.6].forEach((z) => s.push(box(HG.x0 - FX0 - 1.0, 0.5, 0.35, (FX0 + HG.x0) / 2 + 0.3, yB - 0.25 + 0.03, z, ['+y'])));
    // раскосы между стойками
    [[52, 60], [60, 68]].forEach(([a, b]) => [5, -5].forEach((z) => s.push(rod([a, deckY(a) + 0.5, z], [b, yB - 0.4, z], 0.12, 6))));
    // кницы под свесом палубы вдоль ангара
    for (let x = HG.x0 + 2; x < HG.x1 - 1; x += 6) {
      [1, -1].forEach((sd) => {
        if (sd > 0 && x > ISL.x0 - 1.5 && x < ISL.x1 + 1.5) return;
        const k = prism([[0, 0.03], [FHW - HG.hw - 0.4, 0.03], [0, -2.2]], 0.14).rotateY(-Math.PI / 2 * sd).translate(x, yB, sd * HG.hw);
        // prism лежит в XY: после поворота ось X → ±Z
        s.push(k);
      });
    }
    mesh(merge(s), M.steel, 'Flight_Deck_Supports', fdG);

    // галереи вдоль кромки: настил, леера, кронштейны
    const cw = [];
    const rails = [];
    [1, -1].forEach((sd) => {
      catwalkSpans(sd).forEach(([a, b]) => {
        const zin = FHW + 0.04, zout = FHW + 1.25;
        cw.push(box(b - a, 0.12, zout - zin, (a + b) / 2, CATWALK_Y - 0.06, sd * (zin + zout) / 2, []));
        rails.push(...railing([[a, sd * (zout - 0.04)], [b, sd * (zout - 0.04)]], CATWALK_Y, { step: 1.9, r: 0.03, h: 1.0 }));
        for (let x = a + 0.5; x < b; x += 4.5) {
          cw.push(rod([x, CATWALK_Y - 0.1, sd * (zout - 0.1)], [x, 13.6, sd * (HG.hw + 0.03)], 0.07, 5));
        }
      });
    });
    mesh(merge([...cw, ...rails]), M.steel, 'Catwalks', fdG);

    // палубное оборудование: тросы аэрофинишёров, барьеры, катапульта H-II, мачты-антенны
    const d = [];
    WIRES.forEach((x) => {
      d.push(rod([x, FD + 0.06, -10.7], [x, FD + 0.06, 10.7], 0.025, 4));
      [1, -1].forEach((sd) => d.push(box(0.3, 0.2, 0.3, x, FD + 0.1 - 0.02, sd * 10.95, ['-y'])));
    });
    BARRIERS.forEach((x) => {
      [1, -1].forEach((sd) => d.push(rod([x, FD - 0.02, sd * 11.1], [x, FD + 1.3, sd * 11.1], 0.07, 6)));
      [0.45, 0.85, 1.2].forEach((h) => d.push(rod([x, FD + h, -11.1], [x, FD + h, 11.1], 0.02, 4)));
    });
    // челнок и направляющая катапульты
    d.push(box(CAT_X1 - CAT_X0, 0.05, 0.36, (CAT_X0 + CAT_X1) / 2, FD + 0.025 - 0.01, CAT_Z, ['-y']));
    d.push(box(1.2, 0.18, 0.5, CAT_X0 + 2.0, FD + 0.09 - 0.01, CAT_Z, ['-y']));
    mesh(merge(d), M.wire, 'Arresting_Gear', fdG);

    // откидные радиомачты на левом борту (в горизонтальном положении — вверх)
    const am = [];
    [-28, 10, 48].forEach((x) => {
      am.push(rod([x, CATWALK_Y + 0.1, -(FHW + 1.0)], [x, CATWALK_Y + 9.5, -(FHW + 1.5)], 0.08, 5));
      am.push(box(0.4, 0.4, 0.4, x, CATWALK_Y + 0.3, -(FHW + 1.0), ['-y']));
    });
    mesh(merge(am), M.wire, 'Radio_Masts', fdG);
  }

  // ======================= ДЫМОВЫЕ ТРУБЫ (по две на борт, в корме)
  const stG = group('Funnels', ship);
  {
    const body = [], caps = [];
    STACKS.forEach((x) => {
      [1, -1].forEach((sd) => {
        const z = sd * STACK_Z;
        // горизонтальный патрубок из стены ангара, колено R = 1.6 м, вертикальная труба
        const R = 1.6, y0 = 13.4, zk = STACK_Z - R;
        const pts = [V3(x, y0, sd * (HG.hw - 0.05)), V3(x, y0, sd * (zk - 0.6))];
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * (Math.PI / 2);
          pts.push(V3(x, y0 + R - R * Math.cos(a), sd * (zk + R * Math.sin(a))));
        }
        pts.push(V3(x, y0 + R + 1.2, z), V3(x, 18.0, z));
        body.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 24, 0.72, 12, false));
        caps.push(lathe([[0.77, 17.9], [0.77, 18.6], [0.6, 18.6], [0.6, 18.25], [0, 18.25]], 12, { top: false }).translate(x, 0, z));
      });
    });
    const b = merge(body);
    uvAt(b, 0.5, V_PLAIN);
    mesh(b, M.paint, 'Funnel_Uptakes', stG);
    mesh(merge(caps), M.dark, 'Funnel_Caps', stG);
  }

  // ======================= ОСТРОВ
  const islG = group('Island', ship);
  {
    const p = [];
    const wallUV = (band) => (per, h) => [UP(per % PERMAX), V_BAND(band, h)];
    const capUV = (x, z) => [U(x), V_DECK(z - ISL.zc)];
    p.push(slab(dropCollinear(roundRect(ISL.x0, ISL.x1, ISL.hw, 0.5, 3)).map(([x, z]) => [x, z + ISL.zc]), ISL.y0, ISL.y1, wallUV(BAND_ACC), capUV));
    p.push(deckhouse({ x0: 23.2, x1: 31.4, hw: 1.35, r: 0.5, yTop: ISL.y2, base: () => ISL.y1, band: BAND_BRG }).translate(0, 0, ISL.zc));
    // штурманская рубка на крыше мостика
    p.push(deckhouse({ x0: 28.4, x1: 30.4, hw: 0.9, r: 0.3, yTop: ISL.y2 + 1.6, base: () => ISL.y2, band: BAND_ACC }).translate(0, 0, ISL.zc));
    mesh(merge(p), M.paint, 'Island_Structure', islG);

    const f = [];
    // кронштейны под островом
    [22.5, 27.2, 32.0].forEach((x) => {
      f.push(rod([x, ISL.y0 + 0.05, ISL.zc + 1.2], [x, 12.6, HG.hw + 0.05], 0.12, 6));
      f.push(rod([x, ISL.y0 + 0.05, ISL.zc - 1.2], [x, 13.4, HG.hw + 0.05], 0.12, 6));
    });
    // открытые площадки: леера на крыше нижнего яруса и мостика
    f.push(...railing(roundRect(ISL.x0 + 0.12, ISL.x1 - 0.12, ISL.hw - 0.12, 0.4).map(([x, z]) => [x, z + ISL.zc]), ISL.y1, { step: 1.4, closed: true, h: 1.0 }));
    f.push(...railing(roundRect(23.3, 31.3, 1.25, 0.4).map(([x, z]) => [x, z + ISL.zc]), ISL.y2, { step: 1.2, closed: true, h: 1.0 }));
    // мачта: стойка и подкосы, реи, площадка РЛС
    f.push(lathe([[0.28, ISL.y2 - 0.03], [0.24, 26], [0.18, MAST.top]], 10, { top: false }).translate(MAST.x, 0, MAST.z));
    [[-2.6, 0.9], [-2.6, -0.9]].forEach(([dx, dz]) => f.push(rod([MAST.x + dx, ISL.y2, MAST.z + dz], [MAST.x, 26.5, MAST.z], 0.1, 6)));
    f.push(rod([MAST.x, 26.6, MAST.z - 2.6], [MAST.x, 26.6, MAST.z + 2.6], 0.08, 6));
    f.push(lathe([[0.15, MAST.top - 0.2], [1.25, MAST.top - 0.2], [1.25, MAST.top], [0, MAST.top]], 16, { bottom: true, top: false }).translate(MAST.x, 0, MAST.z));
    // РЛС SG на рее (обтекатель-«ведро»)
    f.push(lathe([[0.1, 0], [0.55, 0.05], [0.55, 0.9], [0.3, 1.1], [0, 1.15]], 12, { bottom: true }).translate(MAST.x + 0.4, 27.2, MAST.z));
    f.push(rod([MAST.x, 27.0, MAST.z], [MAST.x + 0.4, 27.2, MAST.z], 0.08, 5));
    // прожекторы и дальномеры на мостике, трап на остров
    [1, -1].forEach((sd) => f.push(lathe([[0.25, 0], [0.32, 0.25], [0.38, 0.5], [0.38, 0.9], [0, 0.95]], 12).translate(30.0, ISL.y1, ISL.zc + sd * 1.05)));
    f.push(lathe([[0.3, 0], [0.22, 0.8], [0.28, 0.9], [0, 1.1]], 10).translate(29.4, ISL.y2 + 1.6, ISL.zc));
    // трап от галереи на остров (с кормы)
    {
      const x0 = ISL.x0 - 0.1, y0 = CATWALK_Y, y1 = ISL.y1, z = ISL.zc + 0.6;
      const run = (y1 - y0) * 0.8;
      [z - 0.35, z + 0.35].forEach((zz) => f.push(rod([x0 - run, y0, zz], [x0, y1, zz], 0.04, 4)));
      for (let k = 1; k < 9; k++) f.push(box(0.2, 0.04, 0.62, x0 - run * (1 - k / 9), lerp(y0, y1, k / 9), z, []));
    }
    mesh(merge(f), M.steel, 'Island_Fittings', islG);
    // ванты мачты
    const w = [];
    [-1, 1].forEach((sd) => w.push(rod([MAST.x, MAST.top - 0.5, MAST.z], [MAST.x - 4.0, ISL.y2 + 0.05, MAST.z + sd * 1.0], 0.02, 4)));
    w.push(rod([MAST.x, 26.6, MAST.z - 2.5], [MAST.x - 30, FD + 0.6, -(FHW + 0.6)], 0.018, 4));
    w.push(rod([MAST.x, 26.6, MAST.z + 2.5], [MAST.x - 35, FD + 0.4, FHW + 1.2], 0.018, 4));
    mesh(merge(w), M.wire, 'Island_Rigging', islG);
  }

  // РЛС SK: вращение вокруг вертикальной оси на площадке мачты
  {
    const g = group('Radar_SK', islG, MAST.x, MAST.top, MAST.z);
    const p = [];
    p.push(lathe([[0.45, -0.02], [0.45, 0.3], [0.3, 0.45], [0.3, 1.0], [0, 1.05]], 12));
    // антенна-«матрац» 5.2 × 5.2 м, обращена вперёд (+X), вынесена на 0.6 м от оси
    const S = 2.6, yc = 3.6, xa = 0.6;
    p.push(rod([0, 0.9, 0], [xa, yc, 0], 0.12, 6));
    p.push(rod([0, 0.9, 0], [xa, yc - S + 0.2, 1.2], 0.08, 5));
    p.push(rod([0, 0.9, 0], [xa, yc - S + 0.2, -1.2], 0.08, 5));
    for (let i = 0; i <= 6; i++) {
      const t = -S + (2 * S * i) / 6;
      const r = i === 0 || i === 6 ? 0.07 : 0.035;
      p.push(rod([xa, yc - S, t], [xa, yc + S, t], r, 4));
      p.push(rod([xa + 0.02, yc + t, -S], [xa + 0.02, yc + t, S], r, 4));
    }
    // излучатели (диполи) перед решёткой
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        const zz = -S + 0.55 + (i * (2 * S - 1.1)) / 4, yy = yc - S + 0.8 + (j * (2 * S - 1.6)) / 3;
        p.push(box(0.5, 0.06, 0.6, xa + 0.3, yy, zz, []));
      }
    }
    mesh(merge(p), M.steel, 'Radar_SK_Antenna', g);
  }

  // ======================= ВООРУЖЕНИЕ
  const armsG = group('Armament', ship);
  {
    // спонсоны 40-мм: площадка, бруствер, подкосы
    const sp = [];
    BOFORS.forEach(([, x, sd]) => {
      const z = sd * SPONSON_Z;
      sp.push(lathe([[2.5, SPONSON_Y - 0.3], [2.5, SPONSON_Y + 1.0], [2.42, SPONSON_Y + 1.0], [2.42, SPONSON_Y], [0, SPONSON_Y]], 28, { top: false, bottom: true }).translate(x, 0, z));
      const hz = Math.max(3, sideZ(x, Math.min(deckY(x) + BUL, 12)));
      [-1.2, 1.2].forEach((dx) => sp.push(rod([x + dx, SPONSON_Y - 0.3, z + sd * 0.8], [x + dx * 0.5, Math.min(13.2, deckY(x) + 1.5), sd * Math.min(HG.hw, hz - 0.2)], 0.14, 6)));
    });
    // 20-мм на галереях — щитки, тумбы, стволы (неподвижные, одной сеткой)
    const oer = [];
    [1, -1].forEach((sd) => {
      catwalkSpans(sd).forEach(([a, b]) => {
        const n = Math.max(1, Math.floor((b - a) / 9));
        for (let k = 0; k < n; k++) {
          const x = a + ((k + 0.5) * (b - a)) / n;
          const z = sd * (FHW + 0.62);
          const og = [];
          og.push(lathe([[0.2, -0.02], [0.14, 0.1], [0.11, 1.05], [0, 1.08]], 8));
          og.push(box(0.05, 0.9, 1.0, 0.35, 1.25, 0, []));
          og.push(latheX([[0.07, -0.6], [0.07, 0.3], [0.04, 0.35], [0.03, 1.6], [0.045, 1.62], [0.045, 1.8], [0, 1.82]], 8).translate(0, 1.25, 0));
          og.push(lathe([[0.22, -0.08], [0.22, 0.08], [0, 0.1]], 10).translate(-0.1, 1.38, 0));
          og.push(box(0.3, 0.12, 0.5, -0.65, 1.1, 0, []));
          const gg = merge(og).rotateY(sd * 0.25).translate(x, CATWALK_Y, z);
          oer.push(gg);
        }
      });
    });
    // 20-мм на юте и баке (по краю главной палубы под свесом)
    [[-62, 1], [-62, -1], [56, 1], [56, -1]].forEach(([x, sd]) => {
      const z = sd * (sideZ(x, deckY(x)) - 1.2);
      const og = [];
      og.push(lathe([[0.2, -0.02], [0.14, 0.1], [0.11, 1.05], [0, 1.08]], 8));
      og.push(box(0.05, 0.9, 1.0, 0.35, 1.25, 0, []));
      og.push(latheX([[0.07, -0.6], [0.07, 0.3], [0.04, 0.35], [0.03, 1.6], [0.045, 1.62], [0.045, 1.8], [0, 1.82]], 8).translate(0, 1.25, 0));
      oer.push(merge(og).rotateY(x > 0 ? 0 : Math.PI).translate(x, deckY(x), z));
    });
    mesh(merge(sp), M.steel, 'Gun_Sponsons', armsG);
    mesh(merge(oer), M.gun, 'Oerlikons_20mm', armsG);

    // 40-мм спаренные «Бофорсы»: поворот вокруг вертикали, стволы вдоль +X
    const boforsGeo = () => {
      const p = [];
      p.push(lathe([[0.75, -0.02], [0.75, 0.15], [0.55, 0.25], [0.5, 0.55], [0, 0.6]], 16));
      [1, -1].forEach((sd) => {
        p.push(prism([[-0.75, 0.5], [0.55, 0.5], [0.35, 1.45], [-0.45, 1.45]], 0.08).translate(0, 0, sd * 0.62));
        p.push(box(0.4, 0.06, 0.35, -0.8, 0.95, sd * 0.95, []));
        p.push(rod([-0.4, 0.6, sd * 0.66], [-0.8, 0.92, sd * 0.95], 0.035, 5));
        p.push(latheX([[0.065, -0.7], [0.065, 0.1], [0.055, 0.2], [0.05, 2.9], [0.075, 2.95], [0.09, 3.3], [0.06, 3.32], [0, 3.32]], 10).translate(0, 1.3, sd * 0.24));
        p.push(box(0.5, 0.42, 0.22, -0.3, 1.65, sd * 0.24, []));
        p.push(lathe([[0.18, -0.05], [0.18, 0.05], [0, 0.06]], 12).rotateX(Math.PI / 2).translate(0.0, 1.1, sd * 0.72));
      });
      p.push(box(1.5, 0.45, 0.82, -0.2, 1.3, 0, []));
      p.push(rod([0, 1.25, -0.66], [0, 1.25, 0.66], 0.1, 10));
      return merge(p);
    };
    BOFORS.forEach(([name, x, sd]) => {
      const g = group(name, armsG, x, SPONSON_Y, sd * SPONSON_Z);
      mesh(boforsGeo(), M.gun, `${name}_Mount`, g);
    });

    // 127-мм 5"/38 на юте: фундамент (неподвижно) и щитовая установка
    {
      const base = [];
      base.push(lathe([[2.0, deckY(GUN5.x) - 0.03], [2.0, GUN5.y], [0, GUN5.y]], 28, { top: false }).translate(GUN5.x, 0, 0));
      base.push(...railing(roundRect(GUN5.x - 1.85, GUN5.x + 1.85, 1.85, 1.7, 4), GUN5.y, { step: 1.3, closed: true, h: 0.9, r: 0.025 }));
      mesh(merge(base), M.steel, 'Gun_5in_Foundation', armsG);
      const g = group('Gun_5in', armsG, GUN5.x, GUN5.y, 0);
      const p = [];
      p.push(lathe([[1.5, -0.02], [1.5, 0.25], [0, 0.27]], 24));
      // щит: скошенный спереди, открыт сзади не моделируем — замкнутая рубка
      p.push(prism([[-1.6, 0.25], [1.5, 0.25], [1.9, 1.0], [1.5, 2.45], [-0.9, 2.6], [-1.6, 2.45]], 2.8).translate(0, 0, 0));
      p.push(box(1.0, 0.5, 0.9, -0.7, 2.85, 0.6, ['-y']));
      p.push(latheX([[0.3, 1.4], [0.3, 2.2], [0.2, 2.4], [0.15, 6.6], [0.17, 6.65], [0.17, 6.75], [0, 6.75]], 14).translate(0, 1.35, 0));
      const geo = merge(p).rotateY(Math.PI); // ствол на корму
      mesh(geo, M.steel, 'Gun_5in_Mount', g);
    }
  }

  // ======================= ПОДЪЁМНИКИ: платформа заподлицо с палубой, ход вниз по Y
  const elevG = group('Elevators', ship);
  const elevs = ELEV.map((e) => {
    const g = group(e.name, elevG, e.x, FD, 0);
    const m = new Mesher();
    const xa = -e.lx / 2, xb = e.lx / 2, za = -e.hz, zb = e.hz;
    const c = [[xa, za], [xb, za], [xb, zb], [xa, zb]];
    const T = c.map(([x, z]) => m.v(new THREE.Vector3(x, 0, z), FU(x + e.x), FV(z)));
    const T2 = c.map(([x, z]) => m.v(new THREE.Vector3(x, 0, z), FU(e.x), FV(0)));
    const B = c.map(([x, z]) => m.v(new THREE.Vector3(x, -EPLATE, z), FU(e.x), FV(0)));
    m.quad(T[0], T[3], T[2], T[1]);
    m.quad(B[0], B[1], B[2], B[3]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      m.quad(B[j], B[i], T2[i], T2[j]);
    }
    const geo = m.build();
    mesh(geo, M.deck, `${e.name}_Platform`, g);
    return g;
  });

  // ======================= ДВИЖИТЕЛИ И РУЛЬ
  const propG = group('Propulsion', ship);
  const blade = bladeGeometry({ r0: 0.38, r1: PROP.r, chord0: 0.8, chord1: 1.3, pitch: 3.6, skew: 0.22, tc: 0.12 });
  const hub = latheX([[0.0, 0.55], [0.32, 0.5], [0.44, 0.3], [0.44, -0.4], [0.36, -0.6], [0.16, -0.95], [0, -1.05]], 16);
  const propR = merge([...[0, 1, 2, 3].map((i) => blade.clone().rotateX((i * Math.PI) / 2)), hub]);
  const propL = mirrorZ(propR);
  const pR = group('Propeller_R', propG, PROP.x, PROP.y, PROP.z);
  mesh(propR, M.bronze, 'Propeller_R_Blades', pR);
  const pL = group('Propeller_L', propG, PROP.x, PROP.y, -PROP.z);
  mesh(propL, M.bronze, 'Propeller_L_Blades', pL);
  {
    const g = group('Rudder', propG, RUD.x, (RUD.y0 + RUD.y1) / 2, 0);
    const half = (RUD.y1 - RUD.y0) / 2;
    const rings = [];
    for (let k = 0; k <= 8; k++) {
      const sy = k / 8;
      const y = -half + 2 * half * sy;
      const ch = 2.9 * (1 - 0.1 * smooth((0.15 - sy) / 0.15)) * (1 - 0.06 * smooth((sy - 0.8) / 0.2));
      const ring = [];
      const ts = [];
      for (let j = 0; j <= 10; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / 10));
      for (const t of ts) ring.push(new THREE.Vector3(0.45 - t * ch, y, Math.max(0.01, naca(t) * 0.14 * ch)));
      for (let j = 9; j >= 1; j--) ring.push(new THREE.Vector3(0.45 - ts[j] * ch, y, -Math.max(0.01, naca(ts[j]) * 0.14 * ch)));
      rings.push(ring);
    }
    const f = loftRings(rings);
    const stock = lathe([[0.2, -half - 0.05], [0.2, half + 1.6], [0, half + 1.65]], 10, { bottom: true });
    const geo = merge([f, stock]);
    uvAt(geo, U(-70), V_FOUL);
    mesh(geo, M.paint, 'Rudder_Blade', g);
  }

  // ======================= ШЛЮПКИ (под свесом палубы, на шлюпбалках)
  const boatG = group('Boats', ship);
  {
    const hulls = [], covers = [], dav = [];
    BOATS.forEach(([bx, sd]) => {
      const zc = sd * 11.2, yg = 13.1;
      hulls.push(boatHalf(bx, yg, zc, false));
      covers.push(boatHalf(bx, yg, zc, true));
      [-2.4, 2.4].forEach((dx) => {
        const x = bx + dx;
        dav.push(tube([[x, 11.4, sd * (HG.hw + 0.05)], [x, 14.4, sd * (HG.hw + 0.1)], [x, 15.4, sd * 10.4], [x, 15.5, sd * 11.0], [x, 15.2, sd * 11.2]], 0.08, 6, 10));
        dav.push(rod([x, 15.15, zc], [x, 13.7, zc], 0.02, 4));
      });
      // спасательные плоты на стене ангара
      [-22, 2, 20].forEach((x) => {
        if (sd > 0 && x > ISL.x0 - 2 && x < ISL.x1 + 2) return;
        dav.push(box(2.4, 1.0, 0.35, x, 12.3, sd * (HG.hw + 0.175), [sd > 0 ? '-z' : '+z']));
      });
    });
    mesh(merge(hulls), M.steel, 'Boat_Hulls', boatG);
    mesh(merge(covers), M.canvas, 'Boat_Covers', boatG);
    mesh(merge(dav), M.steel, 'Boat_Davits', boatG);
  }

  // Анимация: валы вращаются наружу (правый — по часовой с кормы), 1 оборот/с, 9 ключей, петля замкнута
  {
    const T = 1.0;
    const n = 8;
    const times = [];
    const vR = [], vL = [];
    const q = new THREE.Quaternion();
    const ax = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i <= n; i++) {
      times.push((T * i) / n);
      q.setFromAxisAngle(ax, -(2 * Math.PI * i) / n);
      vR.push(q.x, q.y, q.z, q.w);
      q.setFromAxisAngle(ax, (2 * Math.PI * i) / n);
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
    pR.rotation.x = -2 * Math.PI * t;
    pL.rotation.x = 2 * Math.PI * t;
  };
  ship.userData.pose = (k = 0) => {
    find('Rudder').rotation.y = 0.6 * k;
    find('Gun_5in').rotation.y = 0.8 * k;
    find('Radar_SK').rotation.y = 1.2 * k;
    BOFORS.forEach(([n], i) => (find(n).rotation.y = (i % 2 ? -1 : 1) * 0.9 * k));
    elevs[0].position.y = FD - (FD - FLOOR - EPLATE) * k;
    elevs[1].position.y = FD - (FD - FLOOR - EPLATE) * k * 0.5;
  };
  return ship;
}
