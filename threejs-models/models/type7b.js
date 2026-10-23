import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom } from './utils.js';

// Подводная лодка Кригсмарине типа VIIB (1938–1940), обобщённая, без бортового номера и эмблем.
// Масштаб 1:1, метры. Y вверх, нос +X, правый борт +Z. В генераторе y = 0 — ватерлиния
// в надводном положении, киль на y = −4.74 (осадка); сборка ставит киль на Y = 0.
// Корпус — один замкнутый лофт по шпангоутам: сечение задаётся полушириной W(x, y) на высоте y
// (объединение прочного корпуса, киля, булей и надстройки), ряды вершин идут по горизонталям,
// поэтому ватерлиния — точный ряд вершин, а покраска (светло-серый верх, тёмный низ),
// шпигаты и швы обшивки рисуются в атласе по координатам (x, y).
// Подвижные части — отдельные группы с нулевым поворотом, начало на оси движения.

const X0 = -32.8; // корма (срез с выходом кормового ТА)
const X1 = 33.1; // форштевень на уровне палубы
const LEN = X1 - X0;
const KEEL = -4.74;

// ---------------------------------------------------------------------------
// Монотонная кубическая интерполяция (PCHIP) по таблице — без выбросов

function pchip(xs, ys) {
  const n = xs.length;
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
const table = (rows) => pchip(rows.map((r) => r[0]), rows.map((r) => r[1]));
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = THREE.MathUtils.lerp;
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// ---------------------------------------------------------------------------
// ОБВОДЫ

// Линия киля (нижняя кромка): у форштевня поднимается по наклонному форштевню, в корме — скег
const yKeel = table([
  [X0, -0.62], [-31.8, -0.95], [-30.8, -2.0], [-29.9, -2.95], [-28.5, -3.15], [-26, -3.4], [-24, -3.8], [-21, -4.3],
  [-18, -4.62], [-14, KEEL], [14, KEEL], [17, -4.72], [21, -4.52], [24, -4.05], [26, -3.45], [28, -2.6], [30, -1.5],
  [31.3, -0.5], [32.3, 0.6], [X1, 1.6],
]);
// Палуба (верх надстройки): седловатость к носу
const yDeck = table([
  [X0, 0.88], [-31.5, 0.92], [-29.5, 0.98], [-26, 1.08], [-21, 1.17], [-14, 1.25], [-6, 1.3], [6, 1.3], [12, 1.35],
  [16, 1.45], [20, 1.62], [24, 1.88], [27, 2.12], [29.5, 2.32], [31.5, 2.48], [X1, 2.6],
]);
// Полуширина палубы
const deckHalf = table([
  [X0, 0.4], [-32.2, 0.88], [-31.3, 1.2], [-30, 1.32], [-28, 1.38], [-24, 1.4], [-18, 1.48], [-12, 1.55], [-4, 1.6],
  [6, 1.58], [12, 1.48], [16, 1.36], [20, 1.18], [24, 0.94], [27, 0.7], [29.5, 0.45], [31.5, 0.25], [X1, 0.05],
]);
// Нижняя кромка борта надстройки (ниже — уже корпус или були)
const casBot = table([
  [X0, -0.5], [-27, -0.55], [-20, -0.45], [-14, -0.5], [12, -0.5], [18, -0.1], [24, 0.5], [28, 1.2], [X1, 1.8],
]);
// Основной корпус (прочный корпус в средней части, лёгкий — в оконечностях): низ, верх, полуширина
const bodyBot = table([
  [X0, -0.5], [-31.8, -0.75], [-30.8, -1.05], [-29.9, -1.35], [-28.5, -1.85], [-26, -2.7], [-24, -3.45], [-21, -4.1],
  [-18, -4.38], [-14, -4.44], [14, -4.44], [17, -4.4], [21, -4.27], [24, -4.0], [26, -3.43], [28, -2.58], [30, -1.48],
  [31.3, -0.48], [32.3, 0.62], [X1, 1.63],
]);
const bodyTop = table([
  [X0, 0.7], [-29, 0.65], [-26, 0.55], [-21, 0.4], [-16, 0.28], [-12, 0.26], [12, 0.26], [16, 0.35], [20, 0.75],
  [24, 1.35], [27, 1.85], [30, 2.25], [X1, 2.6],
]);
const bodyA = table([
  [X0, 0.3], [-31.5, 0.34], [-30, 0.4], [-28.5, 0.48], [-27, 0.66], [-25, 1.0], [-22, 1.5], [-18, 2.02], [-14, 2.32],
  [-10, 2.35], [10, 2.35], [14, 2.3], [18, 2.0], [21, 1.6], [24, 1.12], [26, 0.82], [28, 0.55], [30, 0.32],
  [31.5, 0.19], [X1, 0.04],
]);
const bodyN = table([[X0, 2.6], [-24, 2.3], [-16, 2.0], [16, 2.0], [24, 2.2], [X1, 2.2]]);
// показатель нижней половины сечения: в носу — острее (V-образный подводный форштевень)
const bodyNL = table([[X0, 2.4], [-24, 2.2], [-16, 2.0], [16, 2.0], [22, 1.8], [26, 1.45], [X1, 1.3]]);
// Полуширина киля / скега (минимальная ширина сечения)
const keelHalf = table([
  [X0, 0.12], [-30, 0.14], [-24, 0.16], [-18, 0.2], [18, 0.2], [22, 0.14], [25, 0.07], [27.5, 0.035], [X1, 0.03],
]);
// Седловидные цистерны (у VIIB — увеличенные): эллипс со смещённым центром
const TANK = { zc: 1.72, h: 1.38, yc: -1.3, v: 2.0, x0: -19.5, x1: -10, x2: 8, x3: 17.5 };
const tankF = (x) => smooth((x - TANK.x0) / (TANK.x1 - TANK.x0)) * (1 - smooth((x - TANK.x2) / (TANK.x3 - TANK.x2)));

function section(x) {
  const s = {
    keel: yKeel(x), deck: yDeck(x), dh: deckHalf(x), cb: casBot(x), bb: bodyBot(x), bt: bodyTop(x), a: bodyA(x),
    n: bodyN(x), nl: bodyNL(x), kh: keelHalf(x), f: tankF(x),
  };
  s.edge = halfWidth(s, s.deck); // фактическая полуширина по кромке палубы
  return s;
}

// Полуширина корпуса на высоте y
function halfWidth(s, y) {
  const bc = (s.bb + s.bt) / 2, hb = (s.bt - s.bb) / 2;
  const t = Math.abs((y - bc) / hb);
  const n = y < bc ? s.nl : s.n;
  let w = t < 1 ? s.a * (1 - t ** n) ** (1 / n) : 0;
  // надстройка: внизу плавно сходит на нет (скос), с корпусом — мягкое объединение
  const fade = smooth((y - (s.cb - 0.45)) / 0.45);
  if (fade > 0) {
    const c = (s.dh + 0.04 * (s.deck - y)) * fade;
    const k = 0.22;
    w = (w + c + Math.sqrt((w - c) ** 2 + k * k * fade)) / 2;
  }
  // були: выдвигаются из корпуса по длине (сдвиг, а не масштаб — плавные оконечности)
  if (s.f > 0) {
    const tt = (y - TANK.yc) / TANK.v;
    if (Math.abs(tt) < 1) w = Math.max(w, TANK.zc + TANK.h * Math.sqrt(1 - tt * tt) - (1 - s.f) * 1.25);
  }
  return Math.max(w, s.kh);
}
export const hullHalfWidth = (x, y) => halfWidth(section(x), y);

// Погибь палубы
const camber = (s, z) => 0.06 * Math.min(1, s.edge / 1.2) * (1 - Math.min(1, (z / s.edge) ** 2));
export const deckY = (x, z = 0) => {
  const s = section(x);
  return s.deck + camber(s, Math.min(Math.abs(z), s.edge));
};

// Ряды вершин по высоте: KB рядов от киля до ватерлинии, KA — от ватерлинии до палубы
const KB = 26;
const KA = 16;
const NR = KB + KA;
const DK = 6; // точек палубы на полуширину
function rowLevels(s) {
  let wl = Math.max(0, s.keel + 0.5);
  wl = Math.min(wl, s.deck - 0.25);
  return { wl, y: (k) => (k <= KB ? lerp(s.keel, wl, k / KB) : lerp(wl, s.deck, (k - KB) / KA)) };
}
// Атлас: корпус занимает v ∈ [HV0, HV1], ряд k — горизонталь атласа
const HV0 = 0.51, HV1 = 0.995;
const rowV = (k) => HV0 + ((HV1 - HV0) * k) / NR;
const hullU = (x) => (x - X0) / LEN;
// Координата v атласа для точки борта (x, y)
function hullV(x, y) {
  const s = section(x);
  const r = rowLevels(s);
  const k = y <= r.wl ? (KB * (y - s.keel)) / (r.wl - s.keel) : KB + (KA * (y - r.wl)) / (s.deck - r.wl);
  return rowV(Math.min(NR, Math.max(0, k)));
}
const WL_V = rowV(KB);

function hullStations() {
  const xs = [];
  let x = X0;
  while (x < X1 - 0.1) {
    xs.push(x);
    const ax = Math.abs(x);
    x += ax > 27 ? 0.18 : ax > 22 ? 0.3 : ax > 16 ? 0.38 : 0.55;
  }
  xs.push(X1);
  return xs;
}

// ---------------------------------------------------------------------------
// ГЕОМЕТРИЧЕСКИЕ ПОМОЩНИКИ

class Mesher {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }
  v(x, y, z, u = 0, w = 0) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }
  P(i) {
    return new THREE.Vector3(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]);
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  // треугольник, развёрнутый так, чтобы нормаль смотрела по dir
  triDir(a, b, c, dir) {
    const A = this.P(a), B = this.P(b), C = this.P(c);
    const n = B.sub(A).cross(C.sub(A));
    if (n.dot(dir) < 0) this.tri(a, c, b);
    else this.tri(a, b, c);
  }
  quadDir(a, b, c, d, dir) {
    this.triDir(a, b, c, dir);
    this.triDir(a, c, d, dir);
  }
  // полоса между двумя рядами (A — нижний/задний, B — следующий)
  strip(A, B) {
    for (let j = 0; j < A.length - 1; j++) this.quad(A[j], A[j + 1], B[j + 1], B[j]);
  }
  build(name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.name = name;
    return g;
  }
}

function signedVolume(g) {
  const p = g.attributes.position.array, idx = g.index.array;
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return vol / 6;
}

// Привести к общему виду для склейки: индексы, только position/normal/uv
function prep(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) g = mergeVertices(g, 1e-5);
  g.clearGroups();
  return g;
}
// Склейка + UV в 0…1 (для материалов без текстуры: проекция по габариту)
function mergePlain(name, list) {
  const g = mergeGeometries(list.map(prep), false);
  g.computeBoundingBox();
  const b = g.boundingBox;
  const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 1e-6);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) - b.min.x + (p.getZ(i) - b.min.z) * 0.37) / (size * 1.37), (p.getY(i) - b.min.y) / size);
  }
  g.name = name;
  return g;
}
function flipWinding(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.index.needsUpdate = true;
  return g;
}
// Зеркало по Z, запечённое в сетку (с разворотом обхода)
function mirrorZ(g) {
  const m = g.clone();
  m.scale(1, 1, -1);
  flipWinding(m);
  m.computeVertexNormals();
  return m;
}

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cylY = (r0, r1, h, seg, x = 0, y = 0, z = 0, open = false) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(x, y + h / 2, z);
// Цилиндр вдоль X от xa до xb
const cylX = (r0, r1, xa, xb, seg, y = 0, z = 0, open = false) =>
  new THREE.CylinderGeometry(r1, r0, Math.abs(xb - xa), seg, 1, open).rotateZ(-Math.PI / 2).translate((xa + xb) / 2, y, z);
// Цилиндр между двумя точками
function rod(a, b, r, seg = 6, open = false) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, open);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}
// Труба по сглаженной ломаной (поручни, ограждения винтов)
function tube(points, r, seg = 6, tubular = 24, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular, r, seg, closed);
}
// Тело вращения вокруг X по профилю [[x, r], ...] (концы с r = 0 — острые)
function latheX(profile, seg = 16) {
  if (profile[0][0] > profile[profile.length - 1][0]) profile = [...profile].reverse();
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0), x));
  return new THREE.LatheGeometry(pts, seg).rotateZ(-Math.PI / 2).rotateX(Math.PI / 2);
}
function latheY(profile, seg = 16) {
  return new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0), y)), seg);
}

// Профиль NACA 00xx (полутолщина при хорде 1, толщине 1)
const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);

// Перо руля / горизонтального руля: хорда по X (передняя кромка le > задней te), размах по +Y от y0 до y1,
// толщина по Z. Закрытое тело с торцами.
function foil({ le, te, y0, y1, tc = 0.13, leTip = le, teTip = te, nS = 4, nC = 10 }) {
  const m = new Mesher();
  const rings = [];
  const ts = [];
  for (let j = 0; j <= nC; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nC));
  for (let k = 0; k <= nS; k++) {
    const s = k / nS;
    const y = lerp(y0, y1, s);
    const L = lerp(le, leTip, s), T = lerp(te, teTip, s);
    const ch = L - T;
    const ring = [];
    for (let j = 0; j <= nC; j++) ring.push(m.v(L - ts[j] * ch, y, Math.max(0.004, naca(ts[j]) * tc * ch)));
    for (let j = nC - 1; j >= 1; j--) ring.push(m.v(L - ts[j] * ch, y, -Math.max(0.004, naca(ts[j]) * tc * ch)));
    rings.push(ring);
  }
  for (let k = 0; k < nS; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let j = 0; j < A.length; j++) {
      const q = (j + 1) % A.length;
      m.quad(A[j], B[j], B[q], A[q]);
    }
  }
  // торцы
  for (const [ring, dir] of [[rings[0], new THREE.Vector3(0, -1, 0)], [rings[nS], new THREE.Vector3(0, 1, 0)]]) {
    const n = ring.length;
    for (let j = 1; j < n / 2; j++) {
      const a = ring[j], b = ring[j + 1], c = ring[n - j - 1], d = ring[n - j];
      if (j + 1 === n - j - 1) m.triDir(a, b, d, dir);
      else m.quadDir(a, b, c, d, dir);
    }
    m.triDir(ring[0], ring[1], ring[n - 1], dir);
  }
  const g = m.build('foil');
  if (signedVolume(g) < 0) flipWinding(g);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ (рисуются на холсте при создании модели)

const ATLAS = 2048;
const COL = { upper: '#8d959a', lower: '#3c4145', hole: '#121416', seam: 'rgba(40,46,50,0.30)' };

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
// Пиксель атласа по UV
const PX = (u) => u * ATLAS;
const PY = (v) => (1 - v) * ATLAS;

// Прорезь/отверстие на борту: прямоугольник со скруглением в координатах (x, y) корпуса
function hullSlot(ctxs, x, y, a, b, n = 4) {
  const pts = [];
  for (let j = 0; j < 20; j++) {
    const f = (j / 20) * Math.PI * 2;
    const xx = x + a * spow(Math.cos(f), 2 / n);
    const yy = y + b * spow(Math.sin(f), 2 / n);
    pts.push([PX(hullU(xx)), PY(hullV(xx, yy))]);
  }
  for (const [ctx, style] of ctxs) {
    ctx.fillStyle = style;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
  }
}

function paintAtlas(rnd) {
  const col = makeCanvas(ATLAS, ATLAS);
  const hgt = makeCanvas(ATLAS, ATLAS); // карта высот -> нормали
  const c = col.getContext('2d');
  const h = hgt.getContext('2d');
  c.fillStyle = COL.upper;
  c.fillRect(0, 0, ATLAS, ATLAS);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, ATLAS, ATLAS);

  // --- корпус: v ∈ [HV0, HV1]
  const yWL = PY(WL_V);
  c.fillStyle = COL.lower;
  c.fillRect(0, yWL, ATLAS, PY(HV0) - yWL + 12);
  // лёгкая неоднородность краски: мягкие пятна
  for (let i = 0; i < 700; i++) {
    const x = rnd() * ATLAS, y = rnd() * PY(HV0);
    const r = 6 + rnd() * 30;
    c.fillStyle = y < yWL ? `rgba(${rnd() < 0.5 ? '200,205,208' : '40,44,48'},${0.02 + rnd() * 0.025})` : `rgba(${rnd() < 0.5 ? '90,98,102' : '20,22,24'},${0.03 + rnd() * 0.04})`;
    c.beginPath();
    c.ellipse(x, y, r * 2.5, r * 0.6, 0, 0, Math.PI * 2);
    c.fill();
  }
  // потёки ниже шпигатов и тёмная полоса у ватерлинии (налёт)
  const grime = c.createLinearGradient(0, yWL - 26, 0, yWL);
  grime.addColorStop(0, 'rgba(60,62,58,0)');
  grime.addColorStop(1, 'rgba(60,62,58,0.35)');
  c.fillStyle = grime;
  c.fillRect(0, yWL - 26, ATLAS, 26);
  // швы обшивки: поперечные стыки листов и продольные пояса
  c.strokeStyle = COL.seam;
  h.strokeStyle = '#6a6a6a';
  c.lineWidth = 1.2;
  h.lineWidth = 2;
  for (let x = X0 + 1.4; x < X1; x += 2.6) {
    for (const ctx of [c, h]) {
      ctx.beginPath();
      ctx.moveTo(PX(hullU(x)), PY(HV1));
      ctx.lineTo(PX(hullU(x)), PY(HV0));
      ctx.stroke();
    }
  }
  for (const k of [5, 10, 15, 20, 24, 30, 35, 39]) {
    for (const ctx of [c, h]) {
      ctx.beginPath();
      ctx.moveTo(0, PY(rowV(k)));
      ctx.lineTo(ATLAS, PY(rowV(k)));
      ctx.stroke();
    }
  }
  // Шпигаты (отверстия для заполнения надстройки) — верхний ряд вдоль всей надстройки
  const holes = [[c, COL.hole], [h, '#202020']];
  for (let x = -29.6; x < 29.5; x += 0.62) {
    if (x > -5.6 && x < 5.2) continue; // у рубки — свои
    const y = deckY(x) - 0.28;
    hullSlot(holes, x, y, 0.2, 0.065);
  }
  // у рубки — длинные прорези
  for (let x = -5.2; x < 5.0; x += 0.75) hullSlot(holes, x, deckY(x) - 0.3, 0.28, 0.07);
  // нижний ряд крупных отверстий в оконечностях (вне булей)
  for (const [x0, x1] of [[-28.5, -16.5], [15.5, 27.5]]) {
    for (let x = x0; x < x1; x += 0.95) {
      const y = Math.max(casBot(x) + 0.28, deckY(x) - 0.85);
      hullSlot(holes, x, y, 0.28, 0.11);
    }
  }
  // Шпигаты булей: вертикальные прорези у нижней кромки цистерн (ниже ватерлинии)
  for (let x = -12.6; x < 11.8; x += 0.55) {
    const f = tankF(x);
    if (f < 0.95) continue;
    hullSlot([[c, '#0e0f10'], [h, '#202020']], x, -2.95, 0.07, 0.24);
  }
  // Крышки носовых ТА — кольцевой шов
  for (const [x, y] of TT_BOW) {
    hullSlot([[c, '#1a1c1e'], [h, '#404040']], x, y, 0.5, 0.42, 2);
  }
  // носовой клюз (у обоих бортов одинаково — зеркальная развёртка)
  hullSlot([[c, '#2a2e31'], [h, '#505050']], ANCHOR.x, ANCHOR.y + 0.15, 0.42, 0.5, 2.4);

  // --- рубка: v ∈ [TV0, TV1], u — обход контура от кормы по правому борту
  const ty0 = PY(TV1), ty1 = PY(TV0);
  c.fillStyle = COL.upper;
  c.fillRect(0, ty0 - 8, ATLAS, ty1 - ty0 + 16);
  for (let i = 0; i < 300; i++) {
    c.fillStyle = `rgba(${rnd() < 0.5 ? '130,138,142' : '20,22,24'},${0.04 + rnd() * 0.05})`;
    c.beginPath();
    c.ellipse(rnd() * ATLAS, ty0 + rnd() * (ty1 - ty0), 10 + rnd() * 50, 4 + rnd() * 10, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = COL.seam;
  for (const y of [1.55, 2.3, 3.0, 3.6]) {
    for (const ctx of [c, h]) {
      ctx.beginPath();
      ctx.moveTo(0, PY(towerV(y)));
      ctx.lineTo(ATLAS, PY(towerV(y)));
      ctx.stroke();
    }
  }
  for (let u = 0.04; u < 1; u += 0.083) {
    for (const ctx of [c, h]) {
      ctx.beginPath();
      ctx.moveTo(PX(u), PY(towerV(1.0)));
      ctx.lineTo(PX(u), PY(towerV(4.2)));
      ctx.stroke();
    }
  }
  // шпигаты в основании ограждения рубки (по бортам, без носовой и кормовой оконечности)
  for (const [u0, u1] of [[0.1, 0.4], [0.6, 0.9]]) {
    for (let u = u0; u < u1; u += 0.016) {
      for (const [ctx, st] of holes) {
        ctx.fillStyle = st;
        ctx.fillRect(PX(u) - 7, PY(towerV(1.42)) - 4, 14, 9);
      }
    }
  }
  // --- однотонные заплатки: светлая (пол мостика, внутренние стенки)
  c.fillStyle = '#878e93';
  c.fillRect(PX(0), PY(0.25), PX(0.25), PY(0) - PY(0.25));

  // Нормали из карты высот (OpenGL: зелёный — вверх по v)
  const src = h.getImageData(0, 0, ATLAS, ATLAS).data;
  const nrm = makeCanvas(ATLAS, ATLAS);
  const nctx = nrm.getContext('2d');
  const out = nctx.createImageData(ATLAS, ATLAS);
  const H = (x, y) => src[4 * (Math.min(ATLAS - 1, Math.max(0, y)) * ATLAS + Math.min(ATLAS - 1, Math.max(0, x)))] / 255;
  const k = 2.2;
  for (let y = 0; y < ATLAS; y++) {
    for (let x = 0; x < ATLAS; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y - 1) - H(x, y + 1)) * k; // вверх по v = вверх по холсту
      const l = Math.hypot(dx, dy, 1);
      const i = 4 * (y * ATLAS + x);
      out.data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  nctx.putImageData(out, 0, 0);
  return { col, nrm };
}

// Деревянный настил: доски вдоль корпуса. Развёртка на всю палубу без повтора: texture.repeat
// при сборке в Blender экспортируется как обязательное (extensionsRequired) KHR_texture_transform.
function paintPlanks(rnd) {
  const W = 2048, Hh = 512;
  const cv = makeCanvas(W, Hh);
  const c = cv.getContext('2d');
  c.fillStyle = '#6b6862';
  c.fillRect(0, 0, W, Hh);
  const planks = 26; // поперёк палубы 3.6 м (≈ 0.14 м)
  const ph = Hh / planks;
  for (let p = 0; p < planks; p++) {
    let x = -rnd() * 180;
    while (x < W) {
      const len = 110 + rnd() * 90; // 3.5…6.4 м
      const g = 92 + rnd() * 26;
      c.fillStyle = `rgb(${g + 6},${g + 3},${g - 4})`;
      c.fillRect(x, p * ph, len, ph);
      // волокна
      for (let i = 0; i < 10; i++) {
        c.fillStyle = `rgba(${rnd() < 0.5 ? '60,55,48' : '170,165,150'},${0.06 + rnd() * 0.08})`;
        c.fillRect(x, p * ph + rnd() * ph, len, 0.6 + rnd() * 1.2);
      }
      c.fillStyle = 'rgba(28,26,22,0.85)'; // торцевой стык
      c.fillRect(x, p * ph, 2, ph);
      x += len;
    }
    c.fillStyle = 'rgba(30,28,24,0.9)'; // паз между досками
    c.fillRect(0, p * ph, W, 1.6);
  }
  return cv;
}

// ---------------------------------------------------------------------------
// РАЗМЕЩЕНИЕ ДЕТАЛЕЙ

const TW = { x0: 0.6, floor: 3.3, top: 4.45, base: 0.95, bridgeAft: -2.55 };
const TV0 = 0.27, TV1 = 0.49;
const towerV = (y) => TV0 + ((TV1 - TV0) * (y - TW.base)) / (TW.top - TW.base);
const TT_BOW = [[29.55, -0.55], [28.75, -1.6]]; // крышки носовых ТА (x, y), по две на борт
const ANCHOR = { x: 29.3, y: 0.85 };
const GUN = { x: 10.6 };
const SHAFT = { y: -2.68, z: 1.12, xProp: -28.55, xIn: -22.6, r: 0.11 };
const PROP_R = 0.8;
const STERN_PLANE = { x: -29.5, y: SHAFT.y };
const RUDDER = { x: -30.85 };
const BOW_PLANE = { x: 26.4, y: -2.45 };

// ---------------------------------------------------------------------------

export function createType7B() {
  const rnd = createRandom(7);
  const atlas = paintAtlas(rnd);
  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.userData.mimeType = srgb ? 'image/jpeg' : 'image/png';
    return t;
  };
  const planks = tex(paintPlanks(rnd), true);

  const M = {
    paint: new THREE.MeshStandardMaterial({ name: 'Hull_Paint', map: tex(atlas.col, true), normalMap: tex(atlas.nrm, false), roughness: 0.62, metalness: 0.15 }),
    wood: new THREE.MeshStandardMaterial({ name: 'Wood_Deck', map: planks, roughness: 0.85, metalness: 0 }),
    light: new THREE.MeshStandardMaterial({ name: 'Steel_Light', color: 0x8d959a, roughness: 0.6, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ name: 'Steel_Dark', color: 0x3c4145, roughness: 0.65, metalness: 0.2 }),
    bronze: new THREE.MeshStandardMaterial({ name: 'Bronze_Propeller', color: 0xa8824c, roughness: 0.35, metalness: 0.9 }),
    gun: new THREE.MeshStandardMaterial({ name: 'Gunmetal', color: 0x34383c, roughness: 0.45, metalness: 0.6 }),
  };

  const root = new THREE.Group();
  root.name = 'Uboat_Type_VIIB';
  const group = (name, parent = root, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const mesh = (geo, mat, name, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    parent.add(m);
    return m;
  };
  const movable = {};

  // =========================================================================
  // КОРПУС
  const hullG = group('Hull');
  {
    const m = new Mesher();
    const paintIdx = [];
    const st = hullStations().map((x) => {
      const s = section(x);
      const r = rowLevels(s);
      const u = hullU(x);
      const S = [], P = [];
      const K = m.v(x, s.keel, 0, u, HV0);
      for (let k = 0; k <= NR; k++) {
        const y = r.y(k);
        const w = halfWidth(s, y);
        S.push(m.v(x, y, w, u, rowV(k)));
        P.push(m.v(x, y, -w, u, rowV(k)));
      }
      const DS = [], DP = [];
      for (let j = 0; j <= DK; j++) {
        const z = s.edge * (1 - j / DK);
        const y = s.deck + camber(s, z);
        DS.push(m.v(x, y, z, u, 0.5 + z / 3.6));
        DP.push(j === DK ? DS[DK] : m.v(x, y, -z, u, 0.5 - z / 3.6));
      }
      return { x, s, r, K, S, P, DS, DP };
    });
    // Борт и днище: кольцо киль → правый борт → (палуба) → левый борт → киль
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i], b = st[i + 1];
      const ringA = [a.K, ...a.S], ringB = [b.K, ...b.S];
      const portA = [...a.P].reverse().concat([a.K]), portB = [...b.P].reverse().concat([b.K]);
      for (const [A, B] of [[ringA, ringB], [portA, portB]]) {
        for (let j = 0; j < A.length - 1; j++) paintIdx.push(A[j], B[j], B[j + 1], A[j], B[j + 1], A[j + 1]);
      }
    }
    m.idx = paintIdx;
    // Срезы оконечностей (свои вершины, острая кромка): лесенка по рядам
    const capAt = (st0, dir) => {
      const u = hullU(st0.x);
      const vtx = (id, v) => m.v(m.pos[3 * id], m.pos[3 * id + 1], m.pos[3 * id + 2], u, v);
      const S = st0.S.map((id, k) => vtx(id, rowV(k)));
      const P = st0.P.map((id, k) => vtx(id, rowV(k)));
      for (let k = 0; k < NR; k++) m.quadDir(S[k], S[k + 1], P[k + 1], P[k], dir);
      const DS = st0.DS.map((id) => vtx(id, rowV(NR)));
      const DP = st0.DP.map((id) => vtx(id, rowV(NR)));
      for (let j = 0; j < DK; j++) {
        if (j === DK - 1) m.triDir(DS[j], DS[j + 1], DP[j], dir);
        else m.quadDir(DS[j], DS[j + 1], DP[j + 1], DP[j], dir);
      }
    };
    capAt(st[0], new THREE.Vector3(-1, 0, 0));
    capAt(st[st.length - 1], new THREE.Vector3(1, 0, 0));
    const paintCount = m.idx.length;
    // Палуба (дерево)
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i], b = st[i + 1];
      const A = [...a.DS, ...a.DP.slice(0, DK).reverse()];
      const B = [...b.DS, ...b.DP.slice(0, DK).reverse()];
      for (let j = 0; j < A.length - 1; j++) m.idx.push(A[j], B[j], B[j + 1], A[j], B[j + 1], A[j + 1]);
    }
    const g = m.build('Hull_Outer');
    // обход: кольцо идёт от киля вверх по правому борту, станции — к носу => нормаль наружу.
    // Проверка по знаку объёма (весь корпус замкнут вместе с палубой)
    if (signedVolume(g) < 0) {
      flipWinding(g);
      g.computeVertexNormals();
    }
    g.addGroup(0, paintCount, 0);
    g.addGroup(paintCount, m.idx.length - paintCount, 1);
    mesh(g, [M.paint, M.wood], 'Hull_Outer', hullG);
  }

  // Носовые крышки ТА: выпуклые накладки по обводу с юбкой внутрь корпуса
  const hullPatch = (dark, x, y, a, b, off, side) => {
    const m = new Mesher();
    const seg = 18, rings = 3;
    const pt = (r, f, o) => {
      const xx = x + a * r * Math.cos(f), yy = y + b * r * Math.sin(f);
      return [xx, yy, side * (hullHalfWidth(xx, yy) + o)];
    };
    const c = m.v(...pt(0, 0, off));
    const R = [];
    for (let k = 1; k <= rings; k++) {
      const ring = [];
      for (let j = 0; j < seg; j++) ring.push(m.v(...pt(k / rings, (j / seg) * Math.PI * 2, off * (1 - 0.25 * (k / rings) ** 2))));
      R.push(ring);
    }
    const skirt = [];
    for (let j = 0; j < seg; j++) skirt.push(m.v(...pt(1, (j / seg) * Math.PI * 2, -0.04)));
    const out = new THREE.Vector3(0, 0, side);
    for (let j = 0; j < seg; j++) m.triDir(c, R[0][j], R[0][(j + 1) % seg], out);
    for (let k = 0; k < rings - 1; k++)
      for (let j = 0; j < seg; j++) m.quadDir(R[k][j], R[k + 1][j], R[k + 1][(j + 1) % seg], R[k][(j + 1) % seg], out);
    for (let j = 0; j < seg; j++) {
      const f = ((j + 0.5) / seg) * Math.PI * 2;
      const rad = new THREE.Vector3(Math.cos(f) / a, Math.sin(f) / b, 0).normalize();
      m.quadDir(R[rings - 1][j], skirt[j], skirt[(j + 1) % seg], R[rings - 1][(j + 1) % seg], rad);
    }
    dark.push(m.build('patch'));
  };

  const darkParts = []; // Steel_Dark: крышки ТА, валы, кронштейны, ограждения винтов, стабилизаторы, якорь
  const lightParts = []; // Steel_Light: палубное оборудование
  for (const side of [1, -1]) for (const [x, y] of TT_BOW) hullPatch(darkParts, x, y, 0.42, 0.35, 0.035, side);

  // Кормовой ТА: дульный срез между рулями, выше ватерлинии
  {
    const yT = 0.12;
    darkParts.push(latheX([[X0 + 0.25, 0.25], [X0 - 0.06, 0.25], [X0 - 0.12, 0.29], [X0 - 0.16, 0.29], [X0 - 0.16, 0.0]], 20).translate(0, yT, 0));
  }

  // Валы, кронштейны, ограждения винтов, неподвижные стабилизаторы кормовых рулей
  for (const side of [1, -1]) {
    const z = side * SHAFT.z;
    darkParts.push(cylX(SHAFT.r, SHAFT.r, SHAFT.xIn, SHAFT.xProp + 0.2, 10, SHAFT.y, z));
    // кронштейн вала (А-образный, две стойки)
    const xb = SHAFT.xProp + 0.75;
    for (const [dy, dz] of [[1, -0.35], [0.2, -1]]) {
      const tip = [xb, SHAFT.y + dy * 1.1, side * (SHAFT.z + dz * 0.95)];
      const hz = hullHalfWidth(xb, tip[1]);
      darkParts.push(rod([xb, SHAFT.y, z], [xb, tip[1], side * Math.min(Math.abs(tip[2]), hz - 0.06)], 0.05, 6));
    }
    darkParts.push(latheX([[xb + 0.25, 0.0], [xb + 0.18, 0.13], [xb - 0.18, 0.13], [xb - 0.25, 0.0]], 10).translate(0, SHAFT.y, z));
    // ограждение винта: труба от корпуса вокруг диска винта к концу стабилизатора
    const xg = SHAFT.xProp + 2.4;
    const yg = SHAFT.y - 0.05;
    const zg0 = hullHalfWidth(xg, yg) - 0.08;
    darkParts.push(tube([[xg, yg, side * zg0], [xg - 0.9, yg, side * 1.75], [SHAFT.xProp, yg, side * 2.12], [STERN_PLANE.x + 0.35, yg, side * 2.32]], 0.06, 6, 20));
    // неподвижная часть горизонтального руля
    const stab = foil({ le: STERN_PLANE.x + 0.42, te: STERN_PLANE.x + 0.06, y0: 0.05, y1: 2.4, tc: 0.22, nS: 3, nC: 8 }).rotateX(side > 0 ? Math.PI / 2 : -Math.PI / 2).translate(0, STERN_PLANE.y, 0);
    darkParts.push(stab);
  }

  // Якорь в носовом клюзе правого борта (повёрнут по обводу)
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.06, 0.55);
    sh.lineTo(0.06, 0.55);
    sh.lineTo(0.06, -0.25);
    sh.lineTo(0.38, -0.12);
    sh.lineTo(0.3, -0.42);
    sh.lineTo(0, -0.5);
    sh.lineTo(-0.3, -0.42);
    sh.lineTo(-0.38, -0.12);
    sh.lineTo(-0.06, -0.25);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.09, bevelEnabled: false });
    const x = ANCHOR.x, y = ANCHOR.y;
    const w = hullHalfWidth(x, y);
    const slope = (hullHalfWidth(x + 0.1, y) - hullHalfWidth(x - 0.1, y)) / 0.2;
    g.rotateY(-Math.atan(slope));
    g.translate(x, y, w - 0.035);
    darkParts.push(g);
  }

  // Палубное оборудование (Steel_Light)
  {
    // Сетепрорезатель на форштевне: зубчатый нож, на него же крепится леер (антенна) к рубке
    const sh = new THREE.Shape();
    const xa = 30.2, xb = X1 - 0.05;
    const tip = [33.72, 3.32];
    sh.moveTo(xa, deckY(xa) - 0.12);
    sh.lineTo(xb, deckY(xb) - 0.16);
    sh.lineTo(tip[0], tip[1]);
    const teeth = 7;
    const back = [xa + 0.2, deckY(xa) + 0.25];
    for (let i = 1; i <= teeth; i++) {
      const t = i / teeth;
      const bow = 0.06 * Math.sin(Math.PI * t); // слегка вогнутая кромка: корни зубьев не на одной прямой
      const px = lerp(tip[0], back[0], t) - bow * 0.3, py = lerp(tip[1], back[1], t) - bow;
      const tp = lerp(tip[0], back[0], t - 0.5 / teeth), tq = lerp(tip[1], back[1], t - 0.5 / teeth);
      sh.lineTo(tp - 0.14, tq + 0.12);
      sh.lineTo(px, py);
    }
    lightParts.push(new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false }).translate(0, 0, -0.035));
    NET_CUTTER_TOP.set(tip[0] - 0.05, tip[1] - 0.04, 0);
  }
  // Кормовая стойка леера
  {
    const xs = -31.0, y0 = deckY(xs) - 0.05;
    lightParts.push(cylY(0.06, 0.035, 1.55, 8, xs, y0, 0));
    STERN_POST_TOP.set(xs, y0 + 1.5, 0);
  }
  // Шпили (носовой и кормовой)
  for (const x of [27.6, -28.2]) {
    lightParts.push(latheY([[-0.08, 0.26], [0.05, 0.26], [0.1, 0.17], [0.24, 0.15], [0.3, 0.2], [0.34, 0.2], [0.36, 0.0]], 18).translate(x, deckY(x), 0));
  }
  // Кнехты (парные тумбы) у кромки палубы
  for (const x of [23.0, 13.5, -11.5, -21.5]) {
    for (const side of [1, -1]) {
      const z = side * (deckHalf(x) - 0.28);
      for (const dx of [-0.22, 0.22]) {
        const y = deckY(x + dx, z) - 0.05;
        lightParts.push(latheY([[0, 0.085], [0.27, 0.085], [0.3, 0.11], [0.34, 0.11], [0.35, 0]], 10).translate(x + dx, y, z));
      }
      lightParts.push(box(0.7, 0.08, 0.26, x, deckY(x, z) - 0.01, z));
    }
  }
  // Люки: носовой торпедопогрузочный, камбузный, кормовой торпедопогрузочный
  for (const [x, r, l] of [[16.4, 0.42, 1.25], [-8.6, 0.33, 0.66], [-15.2, 0.42, 1.25]]) {
    const y = deckY(x) - 0.04;
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, l / 2, r, 0, Math.PI * 2);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 20 });
    g.rotateX(-Math.PI / 2).translate(x, y, 0);
    lightParts.push(g);
    lightParts.push(box(0.12, 0.1, r * 1.4, x - l / 2 - 0.02, y + 0.1, 0)); // петля
  }

  // =========================================================================
  // РУБКА (ограждение рубки, мостик, «зимний сад» с 20-мм автоматом)
  const towerG = group('Conning_Tower');
  const towerPlan = {
    xf: table([[TW.base, 4.9], [1.3, 4.1], [1.7, 3.55], [2.2, 3.3], [3.3, 3.12], [TW.top, 2.95]]),
    xa: table([[TW.base, -7.4], [1.3, -6.6], [1.8, -6.0], [2.4, -5.6], [3.3, -5.35], [TW.top, -5.35]]),
    w: table([[TW.base, 1.4], [1.3, 1.3], [1.8, 1.25], [3.3, 1.22], [TW.top, 1.12]]),
  };
  const TM = 64;
  const towerPt = (y, t, clampAft = false) => {
    const th = 2 * Math.PI * t;
    const cth = -Math.cos(th), s = Math.sin(th);
    const n = cth > 0 ? 1.75 : 2.7;
    let x = (cth > 0 ? towerPlan.xf(y) : -towerPlan.xa(y)) * spow(cth, 2 / n);
    const z = towerPlan.w(y) * spow(s, 2 / n);
    if (clampAft) x = Math.max(x, TW.bridgeAft);
    return [TW.x0 + x, y, z];
  };
  {
    const m = new Mesher();
    const levels = [TW.base, 1.1, 1.3, 1.55, 1.8, 2.2, 2.7, TW.floor];
    const ring = (y, clamp, vFn) => {
      const r = [];
      for (let j = 0; j <= TM; j++) r.push(m.v(...towerPt(y, j / TM, clamp), j / TM, vFn(y)));
      return r;
    };
    const rings = levels.map((y) => ring(y, false, towerV));
    for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
    // Пол мостика / зимнего сада: веер от центра
    const flat = [0.12, 0.12];
    const fl = [];
    for (let j = 0; j < TM; j++) fl.push(m.v(...towerPt(TW.floor, j / TM), ...flat));
    const c = m.v(TW.x0 - 1.2, TW.floor, 0, ...flat);
    const up = new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < TM; j++) m.triDir(c, fl[j], fl[(j + 1) % TM], up);
    // Ограждение мостика: стенка с толщиной, сзади — поперечная переборка у зимнего сада
    const cl = [TW.floor, 3.9, TW.top];
    const outer = cl.map((y) => ring(y, true, towerV));
    for (let k = 0; k < outer.length - 1; k++) m.strip(outer[k], outer[k + 1]);
    // внутренний контур: смещение внутрь по нормали контура в плане
    const inset = (y, d) => {
      const pts = [];
      for (let j = 0; j <= TM; j++) pts.push(towerPt(y, j / TM, true));
      return pts.map((p, j) => {
        const a = pts[(j - 1 + TM) % TM], b = pts[(j + 1) % TM];
        const tx = b[0] - a[0], tz = b[2] - a[2];
        const l = Math.hypot(tx, tz) || 1;
        // контур: корма → правый борт (+Z) → нос; нормаль наружу = (−tz, tx)
        return [p[0] + (tz / l) * d, y, p[2] - (tx / l) * d];
      });
    };
    const innerTop = inset(TW.top, 0.07).map((p) => m.v(...p, ...flat));
    const innerBot = inset(TW.floor, 0.07).map((p) => m.v(...p, ...flat));
    const outerTop = [];
    for (let j = 0; j <= TM; j++) outerTop.push(m.v(...towerPt(TW.top, j / TM, true), ...flat));
    // верхняя кромка
    for (let j = 0; j < TM; j++) m.quadDir(outerTop[j], outerTop[j + 1], innerTop[j + 1], innerTop[j], up);
    // внутренняя стенка (нормаль внутрь мостика)
    for (let j = 0; j < TM; j++) {
      const p = m.P(innerBot[j]);
      const q = m.P(innerBot[j + 1]);
      const mid = p.add(q).multiplyScalar(0.5);
      const toC = new THREE.Vector3(TW.x0 + 0.3 - mid.x, 0, -mid.z);
      m.quadDir(innerBot[j], innerBot[j + 1], innerTop[j + 1], innerTop[j], toC);
    }
    const g = m.build('Conning_Tower_Body');
    mesh(g, M.paint, 'Conning_Tower_Body', towerG);
  }
  const towerLight = [];
  const towerDark = [];
  {
    // Отбойник (козырёк) по верху ограждения спереди
    const m = new Mesher();
    const ids = [];
    const j0 = Math.round(TM * 0.25), j1 = Math.round(TM * 0.75);
    for (let j = j0; j <= j1; j++) {
      const p = towerPt(TW.top, j / TM);
      const a = towerPt(TW.top, (j - 1) / TM), b = towerPt(TW.top, (j + 1) / TM);
      const tx = b[0] - a[0], tz = b[2] - a[2];
      const l = Math.hypot(tx, tz);
      const nx = -tz / l, nz = tx / l;
      const o = 0.2;
      ids.push([
        m.v(p[0] - nx * 0.02, TW.top - 0.12, p[2] - nz * 0.02),
        m.v(p[0] + nx * o, TW.top - 0.02, p[2] + nz * o),
        m.v(p[0] + nx * o, TW.top + 0.02, p[2] + nz * o),
        m.v(p[0] - nx * 0.02, TW.top - 0.06, p[2] - nz * 0.02),
      ]);
    }
    for (let j = 0; j < ids.length - 1; j++) {
      for (let k = 0; k < 4; k++) m.quad(ids[j][k], ids[j + 1][k], ids[j + 1][(k + 1) % 4], ids[j][(k + 1) % 4]);
    }
    const e0 = ids[0], e1 = ids[ids.length - 1];
    m.quad(e0[3], e0[2], e0[1], e0[0]);
    m.quad(e1[0], e1[1], e1[2], e1[3]);
    const g = m.build('deflector');
    if (signedVolume(g) < 0) flipWinding(g);
    towerLight.push(g);
  }
  // Тумба перископов (обтекатель) — лофт сечений
  const PERI = { xc: TW.x0 - 1.0, top: 4.85, sky: TW.x0 - 0.73, att: TW.x0 - 1.27 };
  {
    const m = new Mesher();
    const lv = [TW.floor - 0.02, 3.8, 4.4, PERI.top];
    const plan = (y) => {
      const h = (y - TW.floor) / (PERI.top - TW.floor);
      return { f: lerp(0.75, 0.48, h), a: lerp(-0.8, -0.52, h), w: lerp(0.42, 0.3, h), xs: lerp(0.1, 0, h) };
    };
    const N = 24;
    const rings = lv.map((y) => {
      const p = plan(y);
      const r = [];
      for (let j = 0; j < N; j++) {
        const th = (j / N) * Math.PI * 2;
        const c = -Math.cos(th), s = Math.sin(th);
        r.push(m.v(PERI.xc + p.xs + (c > 0 ? p.f : -p.a) * spow(c, 1 / 1.6 * 2 / 2), y, p.w * spow(s, 0.9)));
      }
      return r;
    });
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], B = rings[k + 1];
      for (let j = 0; j < N; j++) m.quad(A[j], A[(j + 1) % N], B[(j + 1) % N], B[j]);
    }
    const top = rings[rings.length - 1];
    const c = m.v(PERI.xc, PERI.top, 0);
    for (let j = 0; j < N; j++) m.triDir(c, top[j], top[(j + 1) % N], new THREE.Vector3(0, 1, 0));
    const g = m.build('standard');
    if (signedVolume(g) < 0) flipWinding(g);
    towerLight.push(g);
  }
  // Пелорус/UZO на носу мостика, рамочная антенна пеленгатора, рубочный люк
  towerLight.push(cylY(0.09, 0.07, 0.95, 10, TW.x0 + 2.45, TW.floor, 0));
  towerLight.push(box(0.22, 0.16, 0.42, TW.x0 + 2.45, TW.floor + 1.02, 0));
  towerLight.push(cylY(0.04, 0.03, 1.15, 6, TW.x0 + 0.2, TW.floor, -0.8));
  towerLight.push(new THREE.TorusGeometry(0.22, 0.025, 6, 20).translate(TW.x0 + 0.2, TW.floor + 1.38, -0.8));
  towerLight.push(cylY(0.36, 0.34, 0.1, 20, TW.x0 + 0.55, TW.floor - 0.03, 0));
  // Ограждение зимнего сада: стойки и два поручня
  {
    const pts = [];
    const n = 28;
    for (let j = 0; j <= n; j++) {
      const t = 0.5 + (j / n - 0.5) * 2 * 0.5; // от левого борта через корму к правому
      const tt = (j / n) * 0.5 - 0.25 + 1; // 0.75..1.25 -> обход кормы
      const p = towerPt(TW.floor, tt % 1);
      if (p[0] > TW.x0 + TW.bridgeAft + 0.02) continue;
      void t;
      pts.push(p);
    }
    // точки по контуру, смещённые внутрь
    const rail = pts.map((p) => {
      const dx = p[0] - (TW.x0 - 3.3), dz = p[2];
      const l = Math.hypot(dx, dz) || 1;
      return [p[0] - (dx / l) * 0.07, p[1], p[2] - (dz / l) * 0.07];
    });
    for (const h of [0.55, 1.05]) towerLight.push(tube(rail.map((p) => [p[0], p[1] + h, p[2]]), h > 1 ? 0.028 : 0.02, 6, 40));
    for (let j = 0; j < rail.length; j += 3) towerLight.push(rod(rail[j], [rail[j][0], rail[j][1] + 1.08, rail[j][2]], 0.022, 6, true));
    WG_AFT_TOP.set(rail[Math.floor(rail.length / 2)][0], TW.floor + 1.05, 0);
  }
  mesh(mergePlain('Tower_Fittings', towerLight), M.light, 'Tower_Fittings', towerG);

  // Перископы (выдвижные): начало — у основания трубы, внутри тумбы
  const periscope = (name, x, r, headR, headLen, top) => {
    const base = TW.floor + 0.1;
    const g = group(name, towerG, x, base, 0);
    const parts = [cylY(r, r, top - headLen - base, 12, 0, 0, 0)];
    parts.push(cylY(r, headR, 0.06, 12, 0, top - headLen - base, 0));
    parts.push(cylY(headR, headR, headLen - 0.06, 12, 0, top - headLen - base + 0.06, 0));
    if (headR > 0.08) parts.push(box(0.05, 0.08, 0.1, headR, top - base - 0.12, 0)); // окно головки
    mesh(mergePlain(`${name}_Tube`, parts), M.gun, `${name}_Tube`, g);
    movable[name] = g;
  };
  periscope('Periscope_Sky', PERI.sky, 0.1, 0.12, 0.22, PERI.top + 0.27);
  periscope('Periscope_Attack', PERI.att, 0.085, 0.04, 0.32, PERI.top + 0.33);

  // 20-мм автомат на зимнем саду: тумба неподвижна, автомат поворачивается
  {
    const fx = TW.x0 - 4.35, fy = TW.floor;
    const ped = mergePlain('Flak_Mount', [cylY(0.2, 0.2, 0.06, 14, fx, fy - 0.02, 0), cylY(0.08, 0.07, 0.62, 10, fx, fy, 0)]);
    mesh(ped, M.gun, 'Flak_Mount', towerG);
    const pivotY = fy + 0.62;
    const g = group('Flak_20mm', towerG, fx, pivotY, 0);
    const p = [];
    p.push(cylY(0.09, 0.09, 0.08, 12, 0, 0, 0)); // поворотная опора
    p.push(box(0.16, 0.26, 0.2, 0, 0.2, 0)); // вилка
    p.push(box(0.6, 0.14, 0.12, -0.05, 0.35, 0)); // ствольная коробка
    p.push(cylX(0.022, 0.018, -0.3, -1.42, 8, 0.36, 0)); // ствол (в покое — назад, вдоль -X)
    p.push(cylX(0.035, 0.035, -1.42, -1.56, 8, 0.36, 0)); // пламегаситель
    p.push(cylX(0.034, 0.034, -0.3, -0.75, 8, 0.36, 0)); // кожух
    p.push(box(0.18, 0.2, 0.05, -0.02, 0.52, 0.0)); // магазин
    p.push(box(0.04, 0.55, 0.85, -0.38, 0.32, 0)); // щит
    p.push(box(0.04, 0.12, 0.34, 0.32, 0.36, 0.2)); // плечевые упоры
    p.push(box(0.04, 0.12, 0.34, 0.32, 0.36, -0.2));
    p.push(box(0.05, 0.1, 0.1, -0.15, 0.46, 0.0));
    mesh(mergePlain('Flak_20mm_Gun', p), M.gun, 'Flak_20mm_Gun', g);
    movable.Flak_20mm = g;
  }

  // =========================================================================
  // 88-мм ОРУДИЕ на палубе перед рубкой
  const armG = group('Armament');
  {
    const yd = deckY(GUN.x) - 0.06;
    const ph = 0.9;
    mesh(mergePlain('Deck_Gun_Mount', [latheY([[0, 0.48], [0.08, 0.48], [0.14, 0.36], [ph - 0.06, 0.3], [ph, 0.33], [ph + 0.0001, 0]], 20).translate(GUN.x, yd, 0)]), M.light, 'Deck_Gun_Mount', armG);
    const g = group('Deck_Gun', armG, GUN.x, yd + ph, 0);
    const p = [];
    p.push(cylY(0.34, 0.34, 0.1, 20, 0, 0, 0)); // погон
    p.push(box(0.75, 0.55, 0.06, 0.02, 0.37, 0.24)); // станины
    p.push(box(0.75, 0.55, 0.06, 0.02, 0.37, -0.24));
    p.push(box(0.6, 0.08, 0.5, 0.02, 0.12, 0));
    const ya = 0.62; // ось ствола
    p.push(box(1.7, 0.27, 0.27, 0.05, ya, 0)); // люлька с противооткатными
    p.push(cylX(0.075, 0.075, -0.6, 1.05, 12, ya + 0.21, 0)); // накатник
    p.push(cylX(0.1, 0.085, 0.9, 1.5, 14, ya, 0)); // казённая часть ствола
    p.push(cylX(0.085, 0.062, 1.5, 4.0, 14, ya, 0)); // ствол
    p.push(cylX(0.075, 0.075, 3.9, 4.05, 14, ya, 0)); // дульное утолщение
    p.push(box(0.5, 0.32, 0.32, -0.95, ya, 0)); // затвор
    p.push(box(0.3, 0.18, 0.08, 0.2, ya + 0.05, 0.36)); // прицелы
    p.push(box(0.3, 0.18, 0.08, 0.2, ya + 0.05, -0.36));
    p.push(new THREE.TorusGeometry(0.13, 0.02, 6, 16).translate(-0.1, ya - 0.12, 0.42)); // маховики
    p.push(new THREE.TorusGeometry(0.13, 0.02, 6, 16).translate(-0.1, ya - 0.12, -0.42));
    p.push(box(0.04, 0.3, 0.3, -0.25, ya - 0.05, 0.6)); // плечевые упоры наводчиков
    p.push(box(0.04, 0.3, 0.3, -0.25, ya - 0.05, -0.6));
    p.push(box(0.36, 0.05, 0.05, -0.1, ya - 0.05, 0.47));
    p.push(box(0.36, 0.05, 0.05, -0.1, ya - 0.05, -0.47));
    mesh(mergePlain('Deck_Gun_Body', p), M.light, 'Deck_Gun_Body', g);
    movable.Deck_Gun = g;
  }

  // Леер (антенна-леер) от сетепрорезателя к рубке и от зимнего сада к корме
  {
    const front = new THREE.Vector3(TW.x0 + 3.0, TW.top + 0.0, 0);
    const parts = [rod(NET_CUTTER_TOP.toArray(), front.toArray(), 0.018, 6), rod(WG_AFT_TOP.toArray(), STERN_POST_TOP.toArray(), 0.018, 6)];
    // изоляторы
    for (const [a, b, t] of [[NET_CUTTER_TOP, front, 0.12], [NET_CUTTER_TOP, front, 0.88], [WG_AFT_TOP, STERN_POST_TOP, 0.1], [WG_AFT_TOP, STERN_POST_TOP, 0.9]]) {
      const p = a.clone().lerp(b, t);
      const d = b.clone().sub(a).normalize();
      parts.push(rod(p.clone().addScaledVector(d, -0.12).toArray(), p.clone().addScaledVector(d, 0.12).toArray(), 0.045, 8));
    }
    mesh(mergePlain('Jumping_Wire', parts), M.gun, 'Jumping_Wire', hullG);
  }
  mesh(mergePlain('Deck_Fittings', lightParts), M.light, 'Deck_Fittings', hullG);
  mesh(mergePlain('Hull_Fittings', darkParts), M.dark, 'Hull_Fittings', hullG);

  // =========================================================================
  // ДВИЖИТЕЛИ: два трёхлопастных винта, противоположного вращения
  const propG = group('Propulsion');
  const bladeGeo = () => {
    const m = new Mesher();
    const nR = 7, nC = 10;
    const rings = [];
    for (let k = 0; k <= nR; k++) {
      const s = k / nR;
      const r = lerp(0.12, PROP_R, s);
      const ch = 0.62 * Math.sqrt(Math.max(0.02, 1 - (s * 0.98) ** 2)) * (0.72 + 0.5 * s) * (s > 0.97 ? 0.5 : 1);
      const skew = 0.12 * s * s;
      const beta = Math.atan(1.25 / (2 * Math.PI * r)); // угол шага к плоскости диска
      const ring = [];
      const pts = [];
      for (let j = 0; j <= nC; j++) pts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nC));
      const add = (t, sg) => {
        const c = (0.5 - t) * ch + skew;
        const th = sg * Math.max(0.006, naca(t) * 0.1 * ch * (1 - 0.6 * s));
        // хорда в плоскости (Z — окружное направление, X — ось): наклон на угол шага
        const zc = c * Math.cos(beta) - th * Math.sin(beta);
        const xc = c * Math.sin(beta) + th * Math.cos(beta);
        const ang = zc / r;
        ring.push(m.v(xc, r * Math.cos(ang), r * Math.sin(ang)));
      };
      for (const t of pts) add(t, 1);
      for (let j = nC - 1; j >= 1; j--) add(pts[j], -1);
      rings.push(ring);
    }
    for (let k = 0; k < nR; k++) {
      const A = rings[k], B = rings[k + 1];
      for (let j = 0; j < A.length; j++) m.quad(A[j], B[j], B[(j + 1) % A.length], A[(j + 1) % A.length]);
    }
    for (const [ring, out] of [[rings[0], -1], [rings[nR], 1]]) {
      const n = ring.length;
      const c = new THREE.Vector3();
      ring.forEach((id) => c.add(m.P(id)));
      c.divideScalar(n);
      const ci = m.v(c.x, c.y, c.z);
      const dir = c.clone().setX(0).normalize().multiplyScalar(out);
      for (let j = 0; j < n; j++) m.triDir(ci, ring[j], ring[(j + 1) % n], dir);
    }
    const g = m.build('blade');
    if (signedVolume(g) < 0) flipWinding(g);
    g.computeVertexNormals();
    return g;
  };
  const blade = bladeGeo();
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'Propeller_L' : 'Propeller_R';
    const g = group(name, propG, SHAFT.xProp, SHAFT.y, side * SHAFT.z);
    const parts = [];
    for (let b = 0; b < 3; b++) {
      let bg = blade.clone().rotateX((b * 2 * Math.PI) / 3);
      if (side < 0) bg = mirrorZ(bg); // левый винт — зеркальный (левого вращения)
      parts.push(bg);
    }
    parts.push(latheX([[0.26, 0.0], [0.24, 0.12], [0.16, 0.18], [-0.16, 0.17], [-0.3, 0.12], [-0.42, 0.04], [-0.44, 0.0]], 16));
    mesh(mergePlain(`${name}_Blades`, parts), M.bronze, `${name}_Blades`, g);
    movable[name] = g;
  }

  // =========================================================================
  // РУЛИ: два вертикальных руля за винтами, кормовые и носовые горизонтальные рули
  const ctlG = group('Control_Surfaces');
  for (const side of [-1, 1]) {
    const sfx = side < 0 ? 'L' : 'R';
    // Вертикальный руль: ось баллера — вертикаль через (RUDDER.x, ·, z)
    {
      const z = side * SHAFT.z;
      const yTop = -1.55;
      const g = group(`Rudder_${sfx}`, ctlG, RUDDER.x, yTop, z);
      const blade = foil({ le: 0.26, te: -0.7, y0: -1.8, y1: 0, leTip: 0.22, teTip: -0.64, tc: 0.14, nS: 4, nC: 10 });
      const stockTop = casBot(RUDDER.x) + 0.25 - yTop;
      const stock = cylY(0.055, 0.055, stockTop + 0.05, 8, 0, -0.05, 0);
      mesh(mergePlain(`Rudder_${sfx}_Blade`, [blade, stock]), M.dark, `Rudder_${sfx}_Blade`, g);
      movable[`Rudder_${sfx}`] = g;
    }
    // Кормовой горизонтальный руль: ось — поперечная (Z) на STERN_PLANE.x
    {
      const g = group(`Stern_Plane_${sfx}`, ctlG, STERN_PLANE.x, STERN_PLANE.y, 0);
      const f = foil({ le: 0.03, te: -0.95, y0: 0.08, y1: 2.42, teTip: -0.82, tc: 0.12, nS: 3, nC: 10 }).rotateX(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      mesh(mergePlain(`Stern_Plane_${sfx}_Blade`, [f]), M.dark, `Stern_Plane_${sfx}_Blade`, g);
      movable[`Stern_Plane_${sfx}`] = g;
    }
    // Носовой горизонтальный руль: ось — поперечная (Z) через BOW_PLANE
    {
      const root = hullHalfWidth(BOW_PLANE.x, BOW_PLANE.y) - 0.12;
      const g = group(`Bow_Plane_${sfx}`, ctlG, BOW_PLANE.x, BOW_PLANE.y, 0);
      const f = foil({ le: 0.42, te: -0.72, y0: root, y1: root + 1.45, leTip: 0.3, teTip: -0.62, tc: 0.13, nS: 3, nC: 10 }).rotateX(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const hub = cylX(0.1, 0.1, -0.12, 0.12, 10).rotateY(Math.PI / 2).translate(0, 0, side * (root + 0.05));
      mesh(mergePlain(`Bow_Plane_${sfx}_Blade`, [f, hub]), M.dark, `Bow_Plane_${sfx}_Blade`, g);
      movable[`Bow_Plane_${sfx}`] = g;
    }
  }

  // =========================================================================
  // АНИМАЦИЯ: винты, противоположное вращение, 9 ключей на оборот, замкнуто
  {
    const T = 1.0, keys = 8;
    const times = [];
    const vals = { L: [], R: [] };
    const axis = new THREE.Vector3(1, 0, 0);
    const q = new THREE.Quaternion();
    for (let i = 0; i <= keys; i++) {
      times.push((T * i) / keys);
      const a = (2 * Math.PI * i) / keys;
      q.setFromAxisAngle(axis, a);
      vals.R.push(q.x, q.y, q.z, q.w);
      q.setFromAxisAngle(axis, -a);
      vals.L.push(q.x, q.y, q.z, q.w);
    }
    root.animations = [
      new THREE.AnimationClip('Propellers_Spin', T, [
        new THREE.QuaternionKeyframeTrack('Propeller_L.quaternion', times, vals.L),
        new THREE.QuaternionKeyframeTrack('Propeller_R.quaternion', times, vals.R),
      ]),
    ];
  }

  // Для превью: t — время анимации винтов, h — пробное отклонение подвижных частей (проверка осей)
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(root.animations[0]).play();
  root.userData.update = (t = 0, h = 0) => {
    mixer.setTime(t);
    const d = THREE.MathUtils.degToRad;
    movable.Rudder_L.rotation.y = d(30) * h;
    movable.Rudder_R.rotation.y = d(30) * h;
    movable.Stern_Plane_L.rotation.z = d(25) * h;
    movable.Stern_Plane_R.rotation.z = d(25) * h;
    movable.Bow_Plane_L.rotation.z = -d(25) * h;
    movable.Bow_Plane_R.rotation.z = -d(25) * h;
    movable.Deck_Gun.rotation.y = d(60) * h;
    movable.Flak_20mm.rotation.y = d(90) * h;
    movable.Periscope_Sky.position.y = TW.floor + 0.1 + 1.6 * h;
    movable.Periscope_Attack.position.y = TW.floor + 0.1 + 1.2 * h;
  };
  root.userData.update(0, 0);
  root.userData.info = { waterlineAboveKeel: -KEEL };
  return root;
}

// Точки крепления леера (заполняются при построении)
const NET_CUTTER_TOP = new THREE.Vector3();
const STERN_POST_TOP = new THREE.Vector3();
const WG_AFT_TOP = new THREE.Vector3();
