import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// Советская средняя подводная лодка типа «С» («Средняя»), IX-бис серия (1936–1948), обобщённый облик
// военного времени, без бортового номера. Только внешний вид, масштаб 1:1, метры.
// Оси: Y вверх, нос — +X, правый борт — +Z. Киль на y = 0, ватерлиния в надводном положении — y = 4.0
// (осадка ~4 м). Корпус полуторакорпусный: прочный корпус с наружными булями цистерн и узкой надстройкой
// с деревянным настилом. Рубка с ходовым мостиком, кормовая площадка с 45-мм 21-К, перед рубкой — 100-мм Б-24ПЛ.
// Подвижные части — отдельные Group с нулевым поворотом в покое, начало — на оси движения.

const LOA = 77.75;
const X_BOW = LOA / 2; // форштевень (верх носа)
const X_TAIL = -36.4; // торец кормы (кормовые ТА)
const X_RUD_TE = -LOA / 2; // задняя кромка руля
const WL = 4.0; // ватерлиния
const DECK = 6.0; // палуба надстройки на миделе

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = THREE.MathUtils.lerp;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА (сечения по шпангоутам)

function keelY(x) {
  if (x > 30) return 6.25 * ((x - 30) / (X_BOW - 30)) ** 2.2; // скруглённый наклонный форштевень
  if (x < -23) return 2.05 * ((-23 - x) / (-23 - X_TAIL)) ** 1.5; // подрез кормы
  return 0;
}
function deckY(x) {
  let y = DECK;
  if (x > 24) y += 0.65 * ((x - 24) / (X_BOW - 24)) ** 2; // седловатость к носу
  if (x < -24) y -= 0.6 * ((-24 - x) / (-24 - X_TAIL)) ** 1.4;
  return y;
}
function maxHalfBeam(x) {
  if (x > 4) {
    const u = clamp01((x - 4) / (X_BOW - 4));
    return Math.max(0.05, 3.2 * Math.max(0, 1 - u ** 1.9) ** 0.75);
  }
  if (x < -6) {
    const u = clamp01((-6 - x) / (-6 - X_TAIL));
    return 0.62 + 2.58 * Math.max(0, 1 - u ** 1.8) ** 0.9;
  }
  return 3.2;
}
const deckHalf = (x) => Math.min(1.3, 0.82 * maxHalfBeam(x));

const NB = 20; // точек от киля до наибольшей ширины
const NU = 12; // от наибольшей ширины до верха булей
// Полусечение правого борта от киля до ДП палубы: [{z, y, g}], g — длина обвода от киля
function profile(x) {
  const yk = keelY(x);
  const yd = deckY(x);
  const W = maxHalfBeam(x);
  const Wd = deckHalf(x);
  const h = yd - yk;
  const ycw = yk + 0.48 * h;
  const yt = yd - 0.55 * Math.min(1, h / 6);
  const ub = x > 4 ? clamp01((x - 4) / (X_BOW - 4)) : x < -6 ? clamp01((-6 - x) / (-6 - X_TAIL)) : 0;
  const nB = x > 4 ? lerp(2.4, 1.35, ub) : lerp(2.4, 1.6, ub);
  const pU = 2.2;
  const pts = [{ z: 0, y: yk }];
  for (let i = 1; i <= NB; i++) {
    const t = (Math.PI / 2) * (i / NB);
    pts.push({ z: W * Math.sin(t) ** (2 / nB), y: ycw - (ycw - yk) * Math.cos(t) ** (2 / nB) });
  }
  for (let i = 1; i <= NU; i++) {
    const t = (Math.PI / 2) * (i / NU);
    pts.push({ z: Wd + (W - Wd) * Math.cos(t) ** (2 / pU), y: ycw + (yt - ycw) * Math.sin(t) ** (2 / pU) });
  }
  const deckEdge = pts.length;
  pts.push({ z: Wd, y: yd });
  pts.push({ z: (Wd * 2) / 3, y: yd }, { z: Wd / 3, y: yd }, { z: 0, y: yd });
  let g = 0;
  pts[0].g = 0;
  for (let i = 1; i < pts.length; i++) {
    g += Math.hypot(pts[i].z - pts[i - 1].z, pts[i].y - pts[i - 1].y);
    pts[i].g = g;
  }
  return { pts, G: g, deckEdge, yk, yd, yt, W, Wd };
}
// Полуширина корпуса на высоте y (по борту, ниже палубы)
export function hullZ(x, y) {
  const { pts } = profile(x);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y >= y) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = b.y > a.y ? (y - a.y) / (b.y - a.y) : 0;
      return lerp(a.z, b.z, clamp01(t));
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// АТЛАС (2048×2048): v 0…0.49 — обшивка корпуса (u — длина, v — обвод от киля),
// v 0.505…0.735 — рубка (u — обвод от носка, v — высота), v 0.76…1 — заплатки:
// u 0…0.25 — серый, 0.25…0.5 — тёмный, 0.5…1 — двухцветная (v = высота над килем: выше ВЛ серый, ниже тёмный)
const UV_HULL = { u0: 0.005, u1: 0.995, v0: 0.005, v1: 0.485 };
const UV_TOWER = { v0: 0.505, v1: 0.735, y0: 5.6, y1: 9.25 };
const uvPlain = (p) => [0.02 + 0.21 * clamp01((p.x + 40) / 80), 0.78 + 0.2 * clamp01((p.y + p.z * 0.5 + 3) / 16)];
const TWO = { u0: 0.52, u1: 0.98, v0: 0.765, v1: 0.99, ymax: 12 };
const uvTwo = (p) => [TWO.u0 + (TWO.u1 - TWO.u0) * clamp01((p.x + 40 + 0.5 * p.z) / 82), TWO.v0 + (TWO.v1 - TWO.v0) * clamp01(p.y / TWO.ymax)];

// ---------------------------------------------------------------------------
// ГЕОМЕТРИЧЕСКИЕ ПОМОЩНИКИ

class Mesher {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }
  v(p, uv = [0, 0]) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(uv[0], uv[1]);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  strip(A, B, closed = true) {
    const n = A.length;
    for (let j = 0; j < (closed ? n : n - 1); j++) {
      const k = (j + 1) % n;
      this.quad(A[j], B[j], B[k], A[k]);
    }
  }
  // Крышка в начале развёртки (перед первым кольцом) и в конце (после последнего)
  capStart(ring, pts, uvFn) {
    const c = centroid(pts);
    const ci = this.v(c, uvFn(c));
    for (let j = 0; j < ring.length; j++) this.tri(ci, ring[j], ring[(j + 1) % ring.length]);
  }
  capEnd(ring, pts, uvFn) {
    const c = centroid(pts);
    const ci = this.v(c, uvFn(c));
    for (let j = 0; j < ring.length; j++) this.tri(ring[j], ci, ring[(j + 1) % ring.length]);
  }
  build({ orient = true, uv = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (orient && signedVolume(this.pos, this.idx) < 0) {
      for (let i = 0; i < this.idx.length; i += 3) [this.idx[i + 1], this.idx[i + 2]] = [this.idx[i + 2], this.idx[i + 1]];
    }
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
function centroid(pts) {
  const c = new THREE.Vector3();
  pts.forEach((p) => c.add(p));
  return c.divideScalar(pts.length);
}
function signedVolume(pos, idx) {
  let cx = 0, cy = 0, cz = 0;
  const n = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
  cx /= n; cy /= n; cz /= n;
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

// Лофт колец (массив массивов Vector3), крышки по желанию
function loft(rings, { uvFn = uvPlain, capStart = true, capEnd = true, uv = true } = {}) {
  const m = new Mesher();
  const ids = rings.map((r) => r.map((p) => m.v(p, uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1]);
  if (capStart) m.capStart(ids[0], rings[0], uvFn);
  if (capEnd) m.capEnd(ids[ids.length - 1], rings[rings.length - 1], uvFn);
  return m.build({ uv });
}
// Тело вращения вокруг оси X по профилю [[x, r], …]
function revolveX(profile, segs = 16, opts = {}) {
  const rings = profile.map(([x, r]) => {
    const ring = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      ring.push(V(x, r * Math.sin(a), r * Math.cos(a)));
    }
    return ring;
  });
  return loft(rings, opts);
}
// Тело вращения вокруг вертикали по профилю [[y, r], …] с центром (cx, cz)
function revolveY(profile, segs = 16, cx = 0, cz = 0, opts = {}) {
  const rings = profile.map(([y, r]) => {
    const ring = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      ring.push(V(cx + r * Math.cos(a), y, cz + r * Math.sin(a)));
    }
    return ring;
  });
  return loft(rings, opts);
}
// Стержень (цилиндр) между двумя точками
function rod(a, b, r, segs = 6, { caps = false } = {}) {
  const d = b.clone().sub(a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, segs, 1, !caps);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
// Труба по гладкой кривой через точки
function tube(points, r, tubular = 40, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular, r, radial, false);
}
// Призма: многоугольник [[a, b], …] в плоскости, выдавленный вдоль оси axis от w0 до w1.
// axis 'z': точка (a, b, w); 'y': точка (a, w, b). caps: какие крышки делать
function prism(poly, w0, w1, axis = 'z', { bottom = true, top = true, uvFn = uvPlain, uv = true } = {}) {
  const P = (a, b, w) => (axis === 'z' ? V(a, b, w) : V(a, w, b));
  const m = new Mesher();
  const n = poly.length;
  // стенки — отдельные вершины на каждую грань (острые рёбра)
  for (let i = 0; i < n; i++) {
    const [a0, b0] = poly[i];
    const [a1, b1] = poly[(i + 1) % n];
    const p = [P(a0, b0, w0), P(a1, b1, w0), P(a1, b1, w1), P(a0, b0, w1)];
    const ids = p.map((q) => m.v(q, uvFn(q)));
    m.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  const contour = poly.map(([a, b]) => new THREE.Vector2(a, b));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const ccw = !THREE.ShapeUtils.isClockWise(contour);
  const cap = (w, flip) => {
    const ids = poly.map(([a, b]) => {
      const q = P(a, b, w);
      return m.v(q, uvFn(q));
    });
    for (const [a, b, c] of tris) (flip ? m.tri(ids[a], ids[c], ids[b]) : m.tri(ids[a], ids[b], ids[c]));
  };
  // ориентация стенок задаётся обходом; крышки согласуем с ней
  const sideOut = ccw === (axis === 'z'); // для 'y' ось (a, b) = (x, z) даёт обратную ориентацию
  if (top) cap(w1, !sideOut);
  if (bottom) cap(w0, sideOut);
  return m.build({ orient: true, uv });
}
// Скруглённый прямоугольник (для крышек люков)
function roundRect(cx, cz, lx, lz, r, seg = 4) {
  const pts = [];
  const corners = [[lx / 2 - r, lz / 2 - r, 0], [-lx / 2 + r, lz / 2 - r, 1], [-lx / 2 + r, -lz / 2 + r, 2], [lx / 2 - r, -lz / 2 + r, 3]];
  for (const [x, z, q] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = (q + i / seg) * (Math.PI / 2);
      pts.push([cx + x + r * Math.cos(a), cz + z + r * Math.sin(a)]);
    }
  }
  return pts;
}

// Профиль NACA 00xx
const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
// Перо руля: размах по +Y от 0 до span, передняя кромка +X, толщина по Z. root/tip — [LE, TE] по X
function foil({ root, tip, span, tc = 0.12, nSpan = 4, nCh = 10 }) {
  const rings = [];
  for (let k = 0; k <= nSpan; k++) {
    const s = k / nSpan;
    const y = span * s;
    const le = lerp(root[0], tip[0], s);
    const te = lerp(root[1], tip[1], s);
    const ch = le - te;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= nCh; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nCh));
    for (const t of ts) ring.push(V(le - t * ch, y, Math.max(0.006, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(V(le - ts[j] * ch, y, -Math.max(0.006, naca(ts[j]) * tc * ch)));
    rings.push(ring);
  }
  return loft(rings, { uv: false });
}
// Лопасть гребного винта: радиальная ось +Y, ось вращения X; pitch < 0 — левый шаг
function blade({ r0, r1, chord, pitch, tc = 0.09, n = 8, M = 9 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = chord(s);
    const beta = Math.atan(pitch / (2 * Math.PI * r));
    const d = V(Math.sin(beta), 0, Math.cos(beta));
    const nn = V(Math.cos(beta), 0, -Math.sin(beta));
    const ring = [];
    const ts = [];
    for (let j = 0; j <= M; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const skew = 0.12 * s * s;
    const add = (t, sign) => {
      const c = (0.5 - t) * ch - skew;
      const h = sign * Math.max(0.004, naca(t) * tc * ch * (1 - 0.6 * s));
      const p = d.clone().multiplyScalar(c).addScaledVector(nn, h);
      const ang = p.z / r;
      ring.push(V(p.x, r * Math.cos(ang), r * Math.sin(ang)));
    };
    for (const t of ts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(ts[j], -1);
    rings.push(ring);
  }
  return loft(rings, { uv: false });
}

// Подготовка к склейке: только position/normal(/uv), без групп, без индексов
function prep(g, keepUV) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) {
    if (k === 'position' || k === 'normal' || (keepUV && k === 'uv')) continue;
    out.deleteAttribute(k);
  }
  if (keepUV && !out.attributes.uv) throw new Error('нет UV');
  out.clearGroups();
  return out;
}
// Склейка + острые рёбра 30° + индексы (сварка совпадающих вершин)
function merged(list, { uv = false, crease = 30 } = {}) {
  const g = mergeGeometries(list.map((x) => prep(x, uv)));
  const c = toCreasedNormals(g, THREE.MathUtils.degToRad(crease));
  return mergeVertices(c, 1e-5);
}
// UV по функции от мировой точки (для мелких деталей на атласе)
function setUV(g, fn) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    q.fromBufferAttribute(p, i);
    const [u, v] = fn(q);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ: цвет (JPEG) и нормали (PNG), рисуются попиксельно

const hash = (a, b) => {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
const GREY = [116, 122, 127];
const DARK = [40, 42, 45];
const WOOD = [88, 80, 68];

function buildAtlas(towerInfo) {
  const S = 2048;
  const col = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S); // высота рельефа, м
  const scale = new Float32Array(S * 2); // размер пикселя по u и v в метрах, по строкам
  const put = (i, j, c, h = 0) => {
    const o = (j * S + i) * 4;
    col[o] = c[0];
    col[o + 1] = c[1];
    col[o + 2] = c[2];
    col[o + 3] = 255;
    hgt[j * S + i] = h;
  };
  const vOfRow = (j) => 1 - (j + 0.5) / S;
  const uOfCol = (i) => (i + 0.5) / S;
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const bead = (d, w, h) => h * Math.exp(-((d / w) ** 2)); // сварной шов

  // --- корпус
  const span = X_BOW - X_TAIL;
  const duHull = span / ((UV_HULL.u1 - UV_HULL.u0) * S);
  for (let i = 0; i < S; i++) {
    const x = X_TAIL + clamp01((uOfCol(i) - UV_HULL.u0) / (UV_HULL.u1 - UV_HULL.u0)) * span;
    const pr = profile(x);
    const { pts, G, deckEdge } = pr;
    const gDeck = pts[deckEdge].g;
    const gTop = pts[deckEdge - 1].g; // верх булей (начало вертикальной стенки надстройки)
    let seg = 1;
    for (let j = 0; j < S; j++) {
      const v = vOfRow(j);
      if (v > 0.495) continue;
      const g = clamp01((v - UV_HULL.v0) / (UV_HULL.v1 - UV_HULL.v0)) * G;
      seg = 1;
      while (seg < pts.length - 1 && pts[seg].g < g) seg++;
      const a = pts[seg - 1];
      const b = pts[seg];
      const t = b.g > a.g ? clamp01((g - a.g) / (b.g - a.g)) : 0;
      const y = lerp(a.y, b.y, t);
      const z = lerp(a.z, b.z, t);
      const dv = G / ((UV_HULL.v1 - UV_HULL.v0) * S);
      scale[j * 2] = duHull;
      scale[j * 2 + 1] = dv;
      let c;
      let h = 0;
      if (g > gDeck + 0.005) {
        // деревянный настил: доски вдоль корпуса 0.16 м
        const k = Math.floor(z / 0.16);
        const f = z / 0.16 - k;
        const butt = Math.floor((x + k * 1.9) / 4.6);
        const tone = 0.82 + 0.3 * hash(k, butt) + 0.12 * (noise(x * 0.8, z * 6) - 0.5);
        c = shade(WOOD, tone);
        const bf = (x + k * 1.9) / 4.6 - butt;
        if (f < 0.07 || bf < 0.004) {
          c = shade(WOOD, 0.45);
          h = -0.003;
        }
        if (g > G - 0.01) c = shade(WOOD, 0.8);
      } else {
        const below = y < WL;
        c = below ? DARK.slice() : GREY.slice();
        // пятна и подтёки
        const n = noise(x * 0.35, y * 1.2) * 0.6 + noise(x * 2.1, y * 6) * 0.4;
        const streak = noise(x * 3.0, 0.5) * noise(x * 7.1, y * 0.3);
        c = shade(c, 0.93 + 0.12 * n - (below ? 0 : 0.18 * streak * clamp01((y - WL) / 2)));
        // пояса обшивки по обводу и стыки листов
        const gs = g / 1.35;
        const strake = Math.floor(gs);
        const ds = Math.min(gs - strake, 1 - (gs - strake)) * 1.35;
        const bx = (x + (strake % 2) * 1.8) / 3.6;
        const db = Math.min(bx - Math.floor(bx), 1 - (bx - Math.floor(bx))) * 3.6;
        if (g < gTop) {
          h += bead(ds, 0.008, 0.0025) + bead(db, 0.02, 0.002);
          if (ds < 0.006 || db < 0.012) c = shade(c, 0.88);
          // заклёпки вдоль стыков по обводу (ряды по обе стороны стыка)
          if (Math.abs(db - 0.05) < 0.02) {
            const r = (g / 0.09) - Math.floor(g / 0.09);
            if (Math.abs(r - 0.5) < 0.2) h += 0.003;
          }
        }
        // шпигаты (прорези) в стенке надстройки
        if (g >= gTop && g <= gDeck && x > -25 && x < 27.5 && !(x > -7.2 && x < 5.4)) {
          const yc = (pts[deckEdge - 1].y + pts[deckEdge].y) / 2;
          const per = 0.55;
          const xl = ((x + 100) % per) - per / 2;
          const ry = (y - yc) / 0.1;
          const rx = Math.max(0, Math.abs(xl) - 0.09) / 0.1;
          if (rx * rx + ry * ry < 1) {
            c = [14, 15, 16];
            h = -0.04;
          } else if (rx * rx + ry * ry < 1.6) c = shade(c, 0.7);
        }
        // клюзы якорей
        const da = Math.hypot((x - 33.3) / 0.55, (y - 5.05) / 0.62);
        if (da < 1) {
          c = shade(c, 0.35 + 0.3 * da);
          h -= 0.02 * (1 - da);
        }
        // крышки носовых торпедных аппаратов (4: по 2 на борт)
        for (const [tx, ty] of [[35.75, 2.0], [35.35, 3.25]]) {
          const d = Math.hypot((x - tx) / 0.46, (y - ty) / 0.4);
          if (Math.abs(d - 1) < 0.06) {
            c = shade(c, 0.6);
            h -= 0.004;
          }
        }
        // кингстоны цистерн главного балласта — прорези у днища
        if (y > 0.35 && y < 0.85 && x > -20 && x < 24) {
          const per = 1.2;
          const xl = ((x + 100) % per) - per / 2;
          if (Math.abs(xl) < 0.35 && Math.abs(y - 0.6) < 0.08) {
            c = [12, 12, 13];
            h = -0.03;
          }
        }
      }
      put(i, j, c, h);
    }
  }

  // --- рубка: u — доля обвода от носка (оба борта одинаково), v — высота
  const { halfLow, halfHigh, yStep } = towerInfo;
  for (let j = 0; j < S; j++) {
    const v = vOfRow(j);
    if (v < 0.497 || v > 0.745) continue;
    const y = UV_TOWER.y0 + clamp01((v - UV_TOWER.v0) / (UV_TOWER.v1 - UV_TOWER.v0)) * (UV_TOWER.y1 - UV_TOWER.y0);
    const half = y < yStep ? halfLow : halfHigh;
    scale[j * 2] = half / ((UV_HULL.u1 - UV_HULL.u0) * S);
    scale[j * 2 + 1] = (UV_TOWER.y1 - UV_TOWER.y0) / ((UV_TOWER.v1 - UV_TOWER.v0) * S);
    for (let i = 0; i < S; i++) {
      const s = clamp01((uOfCol(i) - UV_HULL.u0) / (UV_HULL.u1 - UV_HULL.u0)) * half; // м от носка
      let c = shade(GREY, 0.95 + 0.1 * noise(s * 1.5, y * 3) - 0.12 * noise(s * 6, 0.3) * noise(s * 13, y * 0.4));
      let h = 0;
      // листы: вертикальные стыки через 1.6 м, горизонтальные на 6.9 и 8.3 м
      const sx = s / 1.6;
      const ds = Math.min(sx - Math.floor(sx), 1 - (sx - Math.floor(sx))) * 1.6;
      const dy = Math.min(Math.abs(y - 6.9), Math.abs(y - 8.3));
      h += bead(ds, 0.006, 0.0025) + bead(dy, 0.006, 0.0025);
      if (ds < 0.005 || dy < 0.005) c = shade(c, 0.86);
      // заклёпки вдоль стыков
      const rivet = (along, across) => {
        const r = along / 0.075 - Math.floor(along / 0.075) - 0.5;
        const q = Math.hypot(r * 0.075, across);
        return q < 0.011 ? 0.003 * (1 - (q / 0.011) ** 2) : 0;
      };
      h += rivet(y, ds - 0.035) + rivet(s, dy - 0.035);
      // шпигаты у основания рубки
      if (y > 6.05 && y < 6.45) {
        const xl = ((s + 100) % 0.5) - 0.25;
        if (Math.abs(xl) < 0.08 && s > 0.6) {
          c = [16, 17, 18];
          h = -0.04;
        }
      }
      // световые иллюминаторы ограждения мостика
      for (const sp of [1.9, 3.1]) {
        const d = Math.hypot(s - sp, y - 8.65);
        if (d < 0.1) {
          c = d < 0.075 ? [22, 30, 36] : shade(GREY, 0.7);
          h = d < 0.075 ? -0.01 : 0.004;
        }
      }
      // кромка верха мостика
      if (y > 9.1) c = shade(c, 0.9);
      put(i, j, c, h);
    }
  }

  // --- заплатки
  for (let j = 0; j < S; j++) {
    const v = vOfRow(j);
    if (v < 0.75) continue;
    scale[j * 2] = 0.02;
    scale[j * 2 + 1] = 0.02;
    for (let i = 0; i < S; i++) {
      const u = uOfCol(i);
      let c;
      if (u < 0.25) c = shade(GREY, 0.96 + 0.08 * noise(i * 0.05, j * 0.05));
      else if (u < 0.5) c = shade(DARK, 0.95 + 0.1 * noise(i * 0.05, j * 0.05));
      else {
        const y = clamp01((v - TWO.v0) / (TWO.v1 - TWO.v0)) * TWO.ymax;
        c = shade(y < WL ? DARK : GREY, 0.95 + 0.08 * noise(i * 0.04, j * 0.04));
      }
      put(i, j, c, 0);
    }
  }

  // --- нормали из высот (OpenGL: +Y — вверх по картинке)
  const nrm = new Uint8ClampedArray(S * S * 4);
  for (let j = 0; j < S; j++) {
    const du = scale[j * 2] || 0.02;
    const dv = scale[j * 2 + 1] || 0.02;
    for (let i = 0; i < S; i++) {
      const hl = hgt[j * S + Math.max(0, i - 1)];
      const hr = hgt[j * S + Math.min(S - 1, i + 1)];
      const hu = hgt[Math.max(0, j - 1) * S + i];
      const hd = hgt[Math.min(S - 1, j + 1) * S + i];
      let nx = -Math.max(-1.2, Math.min(1.2, (hr - hl) / (2 * du)));
      let ny = -Math.max(-1.2, Math.min(1.2, (hu - hd) / (2 * dv)));
      const l = Math.hypot(nx, ny, 1);
      const o = (j * S + i) * 4;
      nrm[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
      nrm[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      nrm[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      nrm[o + 3] = 255;
    }
  }
  const toTex = (data, srgb, mime) => {
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    canvas.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0);
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.userData.mimeType = mime;
    return t;
  };
  const map = toTex(col, true, 'image/jpeg');
  map.name = 'Hull_Atlas_Color';
  const normalMap = toTex(nrm, false, 'image/png');
  normalMap.name = 'Hull_Atlas_Normal';
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// РУБКА: горизонтальные сечения в плане

// Полуширина плана: носок — эллипс, корма — суперэллипс
function planHalf(x, P) {
  const { xf, xa, hw, rf, ra } = P;
  if (x > xf - rf) return hw * Math.sqrt(Math.max(0, 1 - ((x - (xf - rf)) / rf) ** 2));
  if (x < xa + ra) return hw * Math.max(0, 1 - (((xa + ra) - x) / ra) ** 2.4) ** (1 / 2.4);
  return hw;
}
const TOWER_M = 30; // точек на борт
function planRing(P, y) {
  const xs = [];
  for (let k = 0; k <= TOWER_M; k++) xs.push(P.xa + (P.xf - P.xa) * (0.5 + 0.5 * Math.cos((Math.PI * k) / TOWER_M)));
  const ring = [V(xs[0], y, 0)];
  for (let k = 1; k < TOWER_M; k++) ring.push(V(xs[k], y, planHalf(xs[k], P)));
  ring.push(V(xs[TOWER_M], y, 0));
  for (let k = TOWER_M - 1; k >= 1; k--) ring.push(V(xs[k], y, -planHalf(xs[k], P)));
  return ring;
}
// u по обводу: доля длины от носка (одинаково на обоих бортах)
function ringArcU(ring) {
  const half = TOWER_M;
  const s = [0];
  for (let k = 1; k <= half; k++) s.push(s[k - 1] + ring[k].distanceTo(ring[k - 1]));
  const L = s[half];
  const u = new Array(ring.length);
  for (let k = 0; k <= half; k++) u[k] = s[k] / L;
  for (let k = half + 1; k < ring.length; k++) u[k] = u[2 * half - k];
  return { u, L };
}

const PLAN_LOW = { xf: 4.95, xa: -6.85, hw: 1.13, rf: 1.7, ra: 2.2 };
const PLAN_HIGH = { xf: 4.8, xa: -2.55, hw: 1.05, rf: 1.6, ra: 1.3 };
const Y_PLATFORM = 7.6;
const Y_BRIDGE = 8.1;
const Y_LIP = 9.18;

function buildTower() {
  const pl = (o) => ({ ...PLAN_LOW, ...o });
  const ph = (o) => ({ ...PLAN_HIGH, ...o });
  const low = [
    planRing(pl({}), 5.65),
    planRing(pl({}), 6.0),
    planRing(pl({ xf: 4.9, xa: -6.8, hw: 1.11 }), 6.8),
    planRing(pl({ xf: 4.85, xa: -6.75, hw: 1.09 }), Y_PLATFORM),
  ];
  const high = [
    planRing(ph({}), Y_PLATFORM),
    planRing(ph({ xf: 4.6, xa: -2.5, hw: 1.04 }), 8.4),
    planRing(ph({ xf: 4.42, xa: -2.45, hw: 1.05 }), 9.05),
    planRing(ph({ xf: 4.4, xa: -2.43, hw: 1.08 }), Y_LIP),
  ];
  const inner = [
    planRing(ph({ xf: 4.33, xa: -2.37, hw: 1.02, rf: 1.53, ra: 1.24 }), Y_LIP),
    planRing(ph({ xf: 4.3, xa: -2.35, hw: 1.0, rf: 1.5, ra: 1.22 }), Y_BRIDGE),
  ];
  const m = new Mesher();
  const towerUV = (ring) => {
    const { u } = ringArcU(ring);
    return ring.map((p, k) => [UV_HULL.u0 + (UV_HULL.u1 - UV_HULL.u0) * u[k], UV_TOWER.v0 + (UV_TOWER.v1 - UV_TOWER.v0) * clamp01((p.y - UV_TOWER.y0) / (UV_TOWER.y1 - UV_TOWER.y0))]);
  };
  const addRing = (ring, uvs) => ring.map((p, k) => m.v(p, uvs ? uvs[k] : uvPlain(p)));
  const stripAll = (rings, tex) => {
    const ids = rings.map((r) => addRing(r, tex ? towerUV(r) : null));
    for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1]);
  };
  stripAll(low, true);
  stripAll([low[3], high[0]], false); // кормовая площадка и уступ
  stripAll(high, true);
  stripAll([high[3], inner[0], inner[1]], false); // кромка и внутренняя стенка мостика
  const floor = addRing(inner[1], null);
  m.capEnd(floor, inner[1], uvPlain);
  const geo = m.build();
  const halfLow = ringArcU(low[2]).L;
  const halfHigh = ringArcU(high[1]).L;
  return { geo, halfLow, halfHigh, yStep: Y_PLATFORM };
}

// ---------------------------------------------------------------------------

export function createS9bis() {
  const sub = new THREE.Group();
  sub.name = 'Submarine_S_IXbis';

  const tower = buildTower();
  const { map, normalMap } = buildAtlas(tower);

  const std = (name, color, roughness, metalness, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const M = {
    hull: std('Hull_Paint', 0xffffff, 0.72, 0.1, { map, normalMap }),
    grey: std('Steel_Grey', 0x767a7f, 0.62, 0.25),
    dark: std('Steel_Dark', 0x2c2f33, 0.55, 0.45),
    bronze: std('Propeller_Bronze', 0x9a7444, 0.35, 0.9),
  };

  const group = (name, parent = sub, p = V(0, 0, 0)) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.copy(p);
    parent.add(g);
    return g;
  };
  const mesh = (geo, mat, name, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    geo.name = name;
    parent.add(m);
    return m;
  };
  // Подвижная часть: группа на оси, геометрия строится в мировых координатах и сдвигается в локальные
  const movable = (name, parent, pivot, geo, mat) => {
    const g = group(name, parent, pivot);
    geo.translate(-pivot.x, -pivot.y, -pivot.z);
    mesh(geo, mat, `${name}_Mesh`, g);
    return g;
  };

  // =========================================================================
  // КОРПУС: лофт по шпангоутам
  const hullParts = [];
  {
    const N = 240;
    const xs = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const u = 0.4 * t + 0.6 * (0.5 - 0.5 * Math.cos(Math.PI * t)); // гуще к оконечностям
      xs.push(X_TAIL + (X_BOW - X_TAIL) * u);
    }
    const m = new Mesher();
    const span = X_BOW - X_TAIL;
    const ringsIds = [];
    const ringsPts = [];
    for (const x of xs) {
      const { pts, G } = profile(x);
      const u = UV_HULL.u0 + ((UV_HULL.u1 - UV_HULL.u0) * (x - X_TAIL)) / span;
      const ring = [];
      const uvs = [];
      // киль → правый борт → ДП палубы → левый борт
      for (let k = 0; k < pts.length; k++) {
        ring.push(V(x, pts[k].y, pts[k].z));
        uvs.push([u, UV_HULL.v0 + ((UV_HULL.v1 - UV_HULL.v0) * pts[k].g) / G]);
      }
      for (let k = pts.length - 2; k >= 1; k--) {
        ring.push(V(x, pts[k].y, -pts[k].z));
        uvs.push([u, UV_HULL.v0 + ((UV_HULL.v1 - UV_HULL.v0) * pts[k].g) / G]);
      }
      ringsIds.push(ring.map((p, k) => m.v(p, uvs[k])));
      ringsPts.push(ring);
    }
    for (let k = 0; k < ringsIds.length - 1; k++) m.strip(ringsIds[k], ringsIds[k + 1]);
    // торцы: корма — тёмная заплатка, нос — двухцветная
    const tail = ringsPts[0].map((p) => m.v(p, [0.3, 0.8]));
    m.capStart(tail, ringsPts[0], () => [0.3, 0.8]);
    const bow = ringsPts[ringsPts.length - 1].map((p) => m.v(p, uvTwo(p)));
    m.capEnd(bow, ringsPts[ringsPts.length - 1], uvTwo);
    hullParts.push(m.build());
  }
  // Сетепрорезатель на форштевне (зубчатый нож)
  {
    const stemX = (y) => 30 + (X_BOW - 30) * (y / 6.25) ** (1 / 2.2);
    const inner = [];
    const outer = [];
    const y0 = 0.9, y1 = 5.9;
    const n = 26;
    for (let k = 0; k <= n; k++) {
      const y = lerp(y0, y1, k / n);
      inner.push([stemX(y) - 0.18, y]);
      const tooth = k % 2 === 0 ? 0.16 : 0.36;
      const fade = Math.min(1, k / 2, (n - k) / 2);
      outer.push([Math.min(X_BOW - 0.02, stemX(y) + tooth * fade + 0.02), y + (k % 2 ? 0.06 : 0)]);
    }
    const poly = [...inner, ...outer.reverse()];
    hullParts.push(prism(poly, -0.035, 0.035, 'z', { uvFn: uvTwo }));
  }
  // Горизонтальный киль-брус у кормы (опора руля снизу не нужна — руль подвесной)
  const hullGeo = merged(hullParts, { uv: true, crease: 35 });

  const hullGroup = group('Hull');
  mesh(hullGeo, M.hull, 'Hull_Body', hullGroup);

  // =========================================================================
  // РУБКА + тумба перископов
  {
    const parts = [tower.geo];
    const P = { xf: -0.45, xa: -2.15, hw: 0.32, rf: 0.45, ra: 0.6 };
    const rings = [];
    const ys = [Y_BRIDGE - 0.02, 9.0, 9.8, 10.3];
    ys.forEach((y, i) => {
      const s = 1 - 0.18 * (i / (ys.length - 1));
      const ring = [];
      const M2 = 10;
      const xs = [];
      for (let k = 0; k <= M2; k++) xs.push(P.xa + (P.xf - P.xa) * (0.5 + 0.5 * Math.cos((Math.PI * k) / M2)));
      ring.push(V(xs[0], y, 0));
      for (let k = 1; k < M2; k++) ring.push(V(xs[k], y, s * planHalf(xs[k], P)));
      ring.push(V(xs[M2], y, 0));
      for (let k = M2 - 1; k >= 1; k--) ring.push(V(xs[k], y, -s * planHalf(xs[k], P)));
      rings.push(ring);
    });
    parts.push(loft(rings, { capStart: false, capEnd: true }));
    mesh(merged(parts, { uv: true }), M.hull, 'Conning_Tower', hullGroup);
  }

  // =========================================================================
  // ПАЛУБНОЕ ОБОРУДОВАНИЕ (серая сталь)
  const PED100 = V(9.0, DECK + 0.55, 0);
  const PED45 = V(-4.7, Y_PLATFORM + 0.45, 0);
  {
    const parts = [];
    // тумба 100-мм орудия
    parts.push(revolveY([[DECK - 0.03, 0.52], [DECK + 0.06, 0.52], [DECK + 0.08, 0.4], [DECK + 0.4, 0.36], [PED100.y + 0.02, 0.36]], 24, PED100.x, 0, { capStart: false, capEnd: false }));
    // тумба 45-мм
    parts.push(revolveY([[Y_PLATFORM - 0.03, 0.3], [Y_PLATFORM + 0.05, 0.3], [Y_PLATFORM + 0.07, 0.17], [PED45.y + 0.02, 0.17]], 16, PED45.x, 0, { capStart: false, capEnd: false }));
    // люки: торпедопогрузочные и входные
    for (const [x, lx, lz] of [[22.5, 1.7, 0.75], [-21.5, 1.7, 0.75]]) {
      parts.push(prism(roundRect(x, 0, lx, lz, 0.18), deckY(x) - 0.03, deckY(x) + 0.13, 'y', { bottom: false }));
    }
    for (const x of [15.2, -12.5, -27.0]) {
      parts.push(revolveY([[deckY(x) - 0.03, 0.42], [deckY(x) + 0.12, 0.42], [deckY(x) + 0.14, 0.38], [deckY(x) + 0.17, 0.3]], 20, x, 0, { capStart: false }));
    }
    // рубочный люк на мостике
    parts.push(revolveY([[Y_BRIDGE - 0.02, 0.36], [Y_BRIDGE + 0.12, 0.36], [Y_BRIDGE + 0.15, 0.3]], 20, 1.6, 0, { capStart: false }));
    // кнехты (парные тумбы)
    for (const x of [31.5, 18.5, -16.0, -29.5]) {
      for (const z of [-0.85, 0.85]) {
        for (const dx of [-0.2, 0.2]) {
          const y = deckY(x + dx);
          parts.push(revolveY([[y - 0.03, 0.1], [y + 0.26, 0.1], [y + 0.28, 0.13], [y + 0.32, 0.13]], 10, x + dx, z, { capStart: false }));
        }
      }
    }
    // шпиль у носа
    {
      const x = 35.2, y = deckY(x);
      parts.push(revolveY([[y - 0.03, 0.26], [y + 0.08, 0.26], [y + 0.1, 0.18], [y + 0.3, 0.16], [y + 0.36, 0.2], [y + 0.4, 0.2]], 16, x, 0, { capStart: false }));
    }
    mesh(merged(parts), M.grey, 'Deck_Fittings', hullGroup);
  }

  // =========================================================================
  // ТЁМНАЯ СТАЛЬ: валы, кронштейны, ограждения винтов, леера, антенны, якоря, кормовые ТА
  const PROP_X = -32.6, PROP_Y = 1.9, PROP_Z = 1.75, PROP_R = 0.78;
  {
    const parts = [];
    for (const s of [-1, 1]) {
      const z = s * PROP_Z;
      // дейдвуд и вал
      parts.push(revolveX([[-26.3, 0.24], [-27.4, 0.2], [-28.6, 0.13], [-28.8, 0.1]], 14, { capStart: false }).translate(0, PROP_Y, z));
      parts.push(revolveX([[-28.7, 0.085], [PROP_X + 0.2, 0.085]], 12, { capStart: false, capEnd: false }).translate(0, PROP_Y, z));
      // кронштейн гребного вала
      const sx = -31.6;
      const sleeve = revolveX([[sx + 0.3, 0.12], [sx - 0.3, 0.12]], 12).translate(0, PROP_Y, z);
      parts.push(sleeve);
      for (const [ty, tz] of [[1.05, 0.25], [2.85, 0.85]]) {
        const a = V(sx, PROP_Y, z);
        const b = V(sx, ty, s * tz);
        const d = b.clone().sub(a);
        const len = d.length();
        const g = new THREE.BoxGeometry(0.42, len, 0.06);
        g.translate(0, len / 2, 0);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
        g.translate(a.x, a.y, a.z);
        parts.push(g);
      }
      // ограждение винта
      const path = [
        V(-28.6, 1.5, s * 1.05), V(-30.0, 1.5, s * 2.3), V(-31.5, 1.5, s * 2.85), V(-32.6, 1.5, s * 2.97),
        V(-33.5, 1.6, s * 2.7), V(-34.0, 1.8, s * 1.7), V(-34.05, 2.05, s * 0.5),
      ];
      parts.push(tube(path, 0.065, 48, 8));
      // крышки кормовых ТА на торце кормы
      parts.push(revolveX([[X_TAIL + 0.04, 0.27], [X_TAIL - 0.06, 0.27], [X_TAIL - 0.08, 0.24]], 18, { capStart: false }).translate(0, 3.35, s * 0.3));
      // якоря в клюзах
      {
        const ax = 33.3, ay = 5.05;
        const zs = hullZ(ax, ay);
        const poly = [[-0.06, 0.42], [0.06, 0.42], [0.06, -0.18], [0.3, -0.27], [0.22, -0.42], [0, -0.33], [-0.22, -0.42], [-0.3, -0.27], [-0.06, -0.18]].map(([a, b]) => [ax + a, ay + b]);
        parts.push(prism(poly, s > 0 ? zs - 0.1 : -zs - 0.06, s > 0 ? zs + 0.06 : -zs + 0.1, 'z', { [s > 0 ? 'bottom' : 'top']: false, uv: false }));
      }
    }
    // Антенны: нос → передняя стойка мостика, радиомачта → корма; стойки на палубе
    const bowPost = [V(37.6, deckY(37.6) - 0.03, 0), V(37.6, deckY(37.6) + 0.7, 0)];
    const fwdMast = [V(4.15, Y_BRIDGE - 0.02, 0), V(4.15, 9.95, 0)];
    const aftMast = [V(-2.25, Y_BRIDGE - 0.02, 0), V(-2.25, 10.95, 0)];
    const sternPost = [V(-33.6, deckY(-33.6) - 0.03, 0), V(-33.6, deckY(-33.6) + 1.1, 0)];
    for (const [a, b, r] of [[...bowPost, 0.045], [...fwdMast, 0.05], [...aftMast, 0.055], [...sternPost, 0.045]]) parts.push(rod(a, b, r, 8, { caps: false }), revolveY([[b.y, r], [b.y + 0.04, r * 0.6]], 8, b.x, b.z, { capStart: false }));
    parts.push(rod(V(37.6, deckY(37.6) + 0.66, 0), V(4.15, 9.9, 0), 0.012, 5));
    parts.push(rod(V(-2.25, 10.9, 0), V(-33.6, deckY(-33.6) + 1.06, 0), 0.012, 5));
    // промежуточные стойки антенны на палубе
    const wireY = (x, a, b) => lerp(a.y, b.y, (x - a.x) / (b.x - a.x));
    for (const [x, a, b] of [[24.5, V(37.6, deckY(37.6) + 0.66, 0), V(4.15, 9.9, 0)], [-20.5, V(-2.25, 10.9, 0), V(-33.6, deckY(-33.6) + 1.06, 0)]]) {
      const top = wireY(x, a, b);
      parts.push(rod(V(x, deckY(x) - 0.03, 0), V(x, top + 0.04, 0), 0.04, 8), revolveY([[top + 0.04, 0.04], [top + 0.08, 0.025]], 8, x, 0, { capStart: false }));
    }
    // леерное ограждение кормовой площадки
    {
      const P = PLAN_LOW;
      const pathAt = (y, inset) => {
        const pts = [];
        const xs = [-1.0, -2.2, -3.4, -4.6, -5.6, -6.3];
        for (const x of xs) pts.push(V(x, y, planHalf(x, { ...P, xf: 4.85, xa: -6.75, hw: 1.09 }) - inset));
        pts.push(V(-6.75 + inset, y, 0));
        for (const x of xs.slice().reverse()) pts.push(V(x, y, -(planHalf(x, { ...P, xf: 4.85, xa: -6.75, hw: 1.09 }) - inset)));
        return pts;
      };
      parts.push(tube(pathAt(Y_PLATFORM + 0.9, 0.09), 0.024, 64, 6));
      parts.push(tube(pathAt(Y_PLATFORM + 0.48, 0.09), 0.018, 64, 6));
      const posts = pathAt(Y_PLATFORM, 0.09).filter((p) => p.x < -2.0);
      for (const p of posts) parts.push(rod(V(p.x, Y_PLATFORM - 0.02, p.z), V(p.x, Y_PLATFORM + 0.92, p.z), 0.022, 6));
    }
    mesh(merged(parts), M.dark, 'Rigging_Dark', hullGroup);
  }

  // =========================================================================
  // ДВИЖИТЕЛИ: два трёхлопастных винта встречного вращения
  const propulsion = group('Propulsion');
  const propGeo = (hand) => {
    const parts = [];
    const bl = blade({ r0: 0.15, r1: PROP_R, chord: (s) => 0.34 + 0.22 * Math.sin(Math.PI * Math.min(1, s * 0.85)) - 0.18 * s ** 3, pitch: hand * 1.35, tc: 0.1 });
    for (let b = 0; b < 3; b++) parts.push(bl.clone().rotateX((b / 3) * Math.PI * 2));
    parts.push(revolveX([[0.2, 0.08], [0.17, 0.17], [-0.15, 0.19], [-0.3, 0.13], [-0.4, 0.05]], 18));
    return merged(parts);
  };
  const propL = movable('Propeller_L', propulsion, V(PROP_X, PROP_Y, -PROP_Z), propGeo(-1).translate(PROP_X, PROP_Y, -PROP_Z), M.bronze);
  const propR = movable('Propeller_R', propulsion, V(PROP_X, PROP_Y, PROP_Z), propGeo(1).translate(PROP_X, PROP_Y, PROP_Z), M.bronze);

  // =========================================================================
  // РУЛИ: вертикальный руль (подвесной, балансирный), носовые (заваливающиеся) и кормовые горизонтальные
  const controls = group('Control_Surfaces');
  {
    const stock = V(-37.3, 3.0, 0);
    const g = foil({ root: [-36.8, X_RUD_TE], tip: [-36.75, -38.6], span: 3.8, tc: 0.13, nSpan: 5 }).translate(0, 1.2, 0);
    setUV(g, uvTwo);
    movable('Rudder', controls, stock, merged([g], { uv: true }), M.hull);
  }
  const plane = (name, side, hingeX, y, root, tip, span, tc) => {
    const z0 = hullZ(hingeX, y) - 0.03;
    const g = foil({ root, tip, span, tc, nSpan: 4 });
    g.rotateX(side * Math.PI / 2); // размах +Y → ±Z
    g.translate(0, y, side * z0);
    setUV(g, uvTwo);
    return movable(name, controls, V(hingeX, y, side * z0), merged([g], { uv: true }), M.hull);
  };
  plane('Bow_Plane_L', -1, 31.15, 5.0, [31.6, 30.4], [31.45, 30.6], 1.65, 0.12);
  plane('Bow_Plane_R', 1, 31.15, 5.0, [31.6, 30.4], [31.45, 30.6], 1.65, 0.12);
  plane('Stern_Plane_L', -1, -35.0, 2.3, [-34.5, -35.9], [-34.7, -35.8], 1.75, 0.12);
  plane('Stern_Plane_R', 1, -35.0, 2.3, [-34.5, -35.9], [-34.7, -35.8], 1.75, 0.12);

  // =========================================================================
  // АРТИЛЛЕРИЯ (поворотные части; качающиеся части не выделены — угол возвышения 0)
  const arms = group('Armament');
  {
    // 100-мм Б-24ПЛ: начало — центр тумбы (ось наводки по горизонту), ствол вперёд
    const p = [];
    p.push(revolveY([[0, 0.5], [0.1, 0.5], [0.12, 0.44]], 28));
    const cheek = [[-0.6, 0.08], [0.62, 0.08], [0.4, 0.86], [-0.3, 0.86]];
    p.push(prism(cheek, 0.2, 0.28, 'z', { uv: false }), prism(cheek, -0.28, -0.2, 'z', { uv: false }));
    p.push(rod(V(0, 0.68, -0.34), V(0, 0.68, 0.34), 0.07, 12, { caps: true }));
    p.push(revolveX([[-0.75, 0.17], [0.9, 0.17], [0.95, 0.14]], 18, { uv: false }).translate(0, 0.68, 0));
    p.push(revolveX([[0.5, 0.105], [1.3, 0.095], [4.1, 0.07], [4.12, 0.082], [4.25, 0.082], [4.25, 0.05], [3.9, 0.05]], 18, { uv: false }).translate(0, 0.68, 0));
    for (const z of [-0.09, 0.09]) p.push(revolveX([[-0.6, 0.06], [0.85, 0.06]], 10, { uv: false }).translate(0, 0.9, z));
    p.push(new THREE.BoxGeometry(0.42, 0.36, 0.34).translate(-0.95, 0.68, 0));
    // маховики наводки и прицел
    for (const z of [-0.33, 0.33]) p.push(rod(V(-0.15, 0.42, z), V(-0.15, 0.42, z * 1.25), 0.14, 14, { caps: true }));
    p.push(new THREE.BoxGeometry(0.34, 0.12, 0.09).translate(0.05, 1.0, -0.36), new THREE.BoxGeometry(0.06, 0.16, 0.06).translate(0.05, 0.88, -0.32));
    // сиденья наводчиков
    for (const z of [-0.6, 0.6]) {
      p.push(new THREE.BoxGeometry(0.24, 0.05, 0.22).translate(-0.45, 0.5, z));
      p.push(new THREE.BoxGeometry(0.06, 0.06, Math.abs(z) - 0.28).translate(-0.45, 0.45, z / 2 + Math.sign(z) * 0.14));
    }
    const g = merged(p.map((x) => { x.deleteAttribute('uv'); return x; }));
    const grp = group('Deck_Gun_100mm', arms, PED100);
    mesh(g, M.grey, 'Deck_Gun_100mm_Mount', grp);
  }
  {
    // 45-мм 21-К на кормовой площадке рубки, ствол на корму
    const p = [];
    p.push(revolveY([[0, 0.24], [0.06, 0.24], [0.08, 0.2]], 18));
    const cheek = [[-0.3, 0.05], [0.3, 0.05], [0.2, 0.46], [-0.16, 0.46]];
    p.push(prism(cheek, 0.1, 0.15, 'z', { uv: false }), prism(cheek, -0.15, -0.1, 'z', { uv: false }));
    p.push(rod(V(0, 0.36, -0.18), V(0, 0.36, 0.18), 0.04, 10, { caps: true }));
    p.push(revolveX([[-0.45, 0.085], [0.4, 0.085]], 14, { uv: false }).translate(0, 0.36, 0));
    p.push(revolveX([[0.3, 0.05], [1.9, 0.036], [1.92, 0.044], [2.0, 0.044], [2.0, 0.024], [1.85, 0.024]], 14, { uv: false }).translate(0, 0.36, 0));
    p.push(new THREE.BoxGeometry(0.24, 0.2, 0.18).translate(-0.55, 0.36, 0));
    p.push(new THREE.BoxGeometry(0.3, 0.05, 0.05).translate(-0.35, 0.36, 0.22), new THREE.BoxGeometry(0.3, 0.05, 0.05).translate(-0.35, 0.36, -0.22));
    p.push(new THREE.BoxGeometry(0.16, 0.08, 0.05).translate(0.0, 0.56, -0.16));
    const g = merged(p.map((x) => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; }));
    g.rotateY(Math.PI);
    const grp = group('Gun_45mm', arms, PED45);
    mesh(g, M.grey, 'Gun_45mm_Mount', grp);
  }

  // =========================================================================
  // ПЕРИСКОПЫ (выдвигаются по Y; начало — у выхода из тумбы)
  const masts = group('Periscopes');
  const scope = (name, x, prof, head) => {
    const base = V(x, 10.3, 0);
    const parts = [revolveY(prof, 14, x, 0, { uv: false }).translate(0, base.y, 0)];
    parts.push(head.translate(x, base.y, 0));
    const g = merged(parts.map((q) => { if (q.attributes.uv) q.deleteAttribute('uv'); return q; }));
    return movable(name, masts, base, g, M.dark);
  };
  scope('Periscope_1', -0.85, [[-2.0, 0.1], [0.9, 0.1], [0.98, 0.075], [1.35, 0.06], [1.55, 0.05]],
    new THREE.BoxGeometry(0.1, 0.12, 0.09).translate(0.05, 1.5, 0));
  scope('Periscope_2', -1.65, [[-2.0, 0.11], [0.62, 0.11], [0.68, 0.095], [0.98, 0.095]],
    new THREE.BoxGeometry(0.2, 0.2, 0.16).translate(0.04, 1.06, 0));

  // =========================================================================
  // АНИМАЦИЯ: винты встречного вращения, 8 ключей на оборот, замкнуто
  const period = 1.0;
  const steps = 8;
  const q = new THREE.Quaternion();
  const ax = V(1, 0, 0);
  const track = (obj, dir) => {
    const times = [];
    const values = [];
    for (let k = 0; k <= steps; k++) {
      times.push((k / steps) * period);
      q.setFromAxisAngle(ax, (dir * 2 * Math.PI * k) / steps);
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${obj.name}.quaternion`, times, values);
  };
  sub.animations = [new THREE.AnimationClip('Propellers_Spin', period, [track(propR, -1), track(propL, 1)])];

  // Управление для предпросмотра (не в userData — не уходит в glb)
  Object.defineProperty(sub, 'preview', {
    enumerable: false,
    value: {
      spin(t) {
        propR.rotation.x = (-2 * Math.PI * t) / period;
        propL.rotation.x = (2 * Math.PI * t) / period;
      },
      pose(a) {
        const get = (n) => sub.getObjectByName(n);
        get('Rudder').rotation.y = 0.5 * a;
        get('Bow_Plane_L').rotation.x = -1.4 * a;
        get('Bow_Plane_R').rotation.x = 1.4 * a;
        get('Stern_Plane_L').rotation.z = 0.35 * a;
        get('Stern_Plane_R').rotation.z = 0.35 * a;
        get('Deck_Gun_100mm').rotation.y = 0.8 * a;
        get('Gun_45mm').rotation.y = -0.9 * a;
        get('Periscope_1').position.y = 10.3 + 1.6 * a;
        get('Periscope_2').position.y = 10.3 + 1.2 * a;
      },
    },
  });
  return sub;
}
