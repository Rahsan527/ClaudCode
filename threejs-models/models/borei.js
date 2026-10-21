import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Атомный подводный ракетный крейсер стратегического назначения проекта 955 «Борей» —
// «Александр Невский». Только внешний вид, масштаб 1:1 в метрах.
// Ось Y вверх, нос в +X, начало координат — мидель на диаметральной плоскости,
// y = 0 — ватерлиния в надводном положении (осадка 10.5 м, киль на y ≈ −10.5).
// Правый борт — +Z, левый — −Z.
// Корпус — лофт по шпангоутам (суперэллипс), «горб» ракетной палубы — отдельный лофт
// с плоской крышей и 16 вырезами под шахты, рубка — лофт по горизонтальным сечениям,
// рули и стабилизаторы — профили NACA 00xx.

// Основные размеры прочного/лёгкого корпуса
const HULL = {
  R: 6.75, // радиус (ширина 13.5 м)
  yc: -3.75, // ось корпуса: киль −10.5, верх +3.0
  xBow: 84.5, // носовая точка
  xBow0: 56, // начало носового закругления
  xTail0: -40, // начало кормового конуса
  xTail: -79.5, // срез корпуса у ступицы движителя
  rTail: 1.95,
  nUp: 2.4, // показатель суперэллипса: верх чуть полнее круга
  nLow: 2.1,
  ring: 96, // точек по окружности
};

// Надстройка ракетных шахт («горб») за рубкой
const HUMP = {
  xF: 17, // плоская крыша: от xA до xF
  xA: -19,
  xFe: 31, // передний скат уходит в рубку
  xFw: 25, // к этому сечению ширина сводится к ширине рубки
  xAe: -38, // кормовой скат
  top: 6.0, // отметка крыши
  endTop: 1.2,
  a: 5.5, // полуширина
  aEnd: 4.2,
  rc: 1.7, // скругление борт–крыша (по горизонтали / вертикали)
  rv: 1.3,
  yb: -0.8, // низ бортов (утоплен в корпус)
};

// Ограждение выдвижных устройств (рубка)
const SAIL = {
  xA: 16.2, // кормовая кромка
  xfTop: 36.5, // передняя кромка на крыше
  rake: 0.45, // наклон передней кромки (м по X на 1 м высоты)
  top: 10.8,
  yBase: 2.0, // низ лофта утоплен в корпус
  w: 2.85, // полуширина внизу
  wTop: 2.5, // полуширина у крыши
  Lf: 5.0, // длина носового и кормового скругления в плане
  La: 3.4,
  filletY: 5.8, // высота начала «наплыва» передней кромки
  filletL: 9.0,
  filletW: 0.9,
};

// Шахты «Булавы»: 2 ряда по 8
const SILO = { rows: 8, x0: 13.0, pitch: 3.7, z: 2.25, hole: 1.25, lid: 1.42, openAngle: THREE.MathUtils.degToRad(105) };

const TILE = 4.8; // период текстуры резиновых плиток (8 × 8 плиток по 0.6 м)

const smooth = (t) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;

// ---------------------------------------------------------------------------
// Обводы корпуса

export function hullRadius(x) {
  if (x > HULL.xBow0) {
    const u = Math.min(1, (x - HULL.xBow0) / (HULL.xBow - HULL.xBow0));
    return HULL.R * Math.max(0, 1 - u ** 2.2) ** (1 / 2.2);
  }
  if (x < HULL.xTail0) {
    const s = Math.min(1, (HULL.xTail0 - x) / (HULL.xTail0 - HULL.xTail));
    return HULL.R - (HULL.R - HULL.rTail) * s ** 1.6;
  }
  return HULL.R;
}
// Ось сечения: в носу киль поднимается сильнее, чем палуба опускается
export function hullAxisY(x) {
  if (x > HULL.xBow0) return HULL.yc + 0.9 * Math.min(1, (x - HULL.xBow0) / (HULL.xBow - HULL.xBow0)) ** 2;
  return HULL.yc;
}
// Точка шпангоута: phi = 0 — киль, π/2 — правый борт, π — верх
function hullSection(x, phi) {
  const R = hullRadius(x);
  const c = hullAxisY(x);
  const s = Math.sin(phi);
  const co = Math.cos(phi);
  const n = co > 0 ? HULL.nLow : HULL.nUp;
  return { y: c - R * spow(co, 2 / n), z: R * spow(s, 2 / n) };
}
// Полуширина корпуса на высоте y
export function hullHalfWidth(x, y) {
  const R = hullRadius(x);
  const c = hullAxisY(x);
  const d = Math.abs(y - c) / R;
  if (d >= 1) return 0;
  const n = y < c ? HULL.nLow : HULL.nUp;
  return R * (1 - d ** n) ** (1 / n);
}
// Точка и внешняя нормаль на борту side (+1 правый, −1 левый)
function hullSurface(x, y, side) {
  const e = 0.05;
  const P = (xx, yy) => new THREE.Vector3(xx, yy, side * hullHalfWidth(xx, yy));
  const p = P(x, y);
  const tx = P(x + e, y).sub(p);
  const ty = P(x, y + e).sub(p);
  const n = new THREE.Vector3().crossVectors(tx, ty).multiplyScalar(side).normalize();
  return { point: p, normal: n };
}

function humpTop(x) {
  // спереди «горб» сужается и плавно уходит в рубку
  if (x > HUMP.xF) return HUMP.top - (HUMP.top - 3.0) * smooth((x - HUMP.xF) / (HUMP.xFe - HUMP.xF)) ** 1.5;
  if (x < HUMP.xA) return HUMP.top - (HUMP.top - HUMP.endTop) * smooth((HUMP.xA - x) / (HUMP.xA - HUMP.xAe));
  return HUMP.top;
}
function humpHalfWidth(x) {
  if (x > HUMP.xF) return HUMP.a - (HUMP.a - 2.3) * smooth((x - HUMP.xF) / (HUMP.xFw - HUMP.xF));
  if (x < HUMP.xA) return HUMP.a - (HUMP.a - HUMP.aEnd) * smooth((HUMP.xA - x) / (HUMP.xA - HUMP.xAe));
  return HUMP.a;
}

// План рубки на высоте y: передняя/кормовая кромки, полуширина, длины скруглений
function sailPlan(y, inset = 0) {
  const S = SAIL;
  const f = y < S.filletY ? ((S.filletY - y) / (S.filletY - S.yBase)) ** 2 : 0;
  const k = Math.min(1, Math.max(0, (S.top - y) / (S.top - S.filletY)));
  return {
    xf: S.xfTop + S.rake * (S.top - y) + S.filletL * f - inset,
    xa: S.xA + inset,
    w: S.wTop + (S.w - S.wTop) * k + S.filletW * f - inset,
    Lf: S.Lf + S.filletL * f,
    La: S.La,
  };
}
function sailHalfWidth(x, p) {
  let h = p.w;
  if (x > p.xf - p.Lf) h *= Math.sqrt(Math.max(0, 1 - ((x - (p.xf - p.Lf)) / p.Lf) ** 2));
  if (x < p.xa + p.La) h *= Math.max(0, 1 - ((p.xa + p.La - x) / p.La) ** 2.2) ** (1 / 2.2);
  return h;
}

// ---------------------------------------------------------------------------
// Геометрические помощники

// Индексированная сетка из рядов точек rows[m][p] (Vector3), m и p — по двум направлениям.
// Порядок (a, b, c), (a, c, d) даёт нормаль наружу, если p×m смотрит наружу.
function gridGeometry(rows, { closedP = false, skip = null, uv = null, flip = false } = {}) {
  const pos = [];
  const uvs = [];
  const idx = [];
  const cols = rows[0].length;
  rows.forEach((row, m) => row.forEach((v, p) => {
    pos.push(v.x, v.y, v.z);
    if (uv) uvs.push(...uv(m, p, v));
  }));
  const pc = closedP ? cols : cols - 1;
  for (let m = 0; m < rows.length - 1; m++) {
    for (let p = 0; p < pc; p++) {
      if (skip && skip(m, p)) continue;
      const p1 = (p + 1) % cols;
      const a = m * cols + p;
      const b = m * cols + p1;
      const c = (m + 1) * cols + p1;
      const d = (m + 1) * cols + p;
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Плоские грани с проверкой направления по подсказке hint (вектор «наружу»)
function flatFaces() {
  const pos = [];
  const tri = (a, b, c, hint) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    if (n.dot(hint) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  return {
    tri,
    quad: (a, b, c, d, hint) => { tri(a, b, c, hint); tri(a, c, d, hint); },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    },
  };
}

// Тело вращения вокруг оси X по профилю [[x, r], ...]; замкнутый профиль ориентируется сам
function revolveX(profile, segs = 48, closed = false) {
  let prof = profile;
  if (closed) {
    let area = 0;
    for (let i = 0; i < prof.length; i++) {
      const [x0, r0] = prof[i];
      const [x1, r1] = prof[(i + 1) % prof.length];
      area += x0 * r1 - x1 * r0;
    }
    if (area < 0) prof = [...prof].reverse();
    prof = [...prof, prof[0]];
  }
  const rows = [];
  for (let m = 0; m <= segs; m++) {
    const a = (m / segs) * Math.PI * 2;
    rows.push(prof.map(([x, r]) => new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a))));
  }
  // rows[m][p]: m — по углу, p — вдоль профиля (от носа к корме — нормали наружу)
  return gridGeometry(rows);
}

// Симметричный профиль NACA 00xx, лофт вдоль +Y (размах), хорда вдоль −X от передней кромки.
// c0..c1 — часть хорды (неподвижная часть руля и перо руля строятся отдельно).
function foilGeometry({ root, tip, span, thick = 0.12, sweep = 0, c0 = 0, c1 = 1, nc = 14, ns = 8 }) {
  const yt = (t) => 5 * thick * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
  const ts = [];
  for (let k = 0; k <= nc; k++) ts.push(c0 + (c1 - c0) * (1 - Math.cos((Math.PI * k) / nc)) / 2);
  const pt = (m, t, side) => {
    const s = (span * m) / ns;
    const c = root + ((tip - root) * s) / span;
    const xle = (sweep * s) / span;
    return new THREE.Vector3(xle - t * c, s, side * yt(t) * c);
  };
  const parts = [];
  const stations = [...Array(ns + 1).keys()];
  if (c0 === 0) {
    const rows = stations.map((m) => [
      ...ts.slice().reverse().map((t) => pt(m, t, 1)),
      ...ts.slice(1).map((t) => pt(m, t, -1)),
    ]);
    parts.push(gridGeometry(rows).toNonIndexed());
  } else {
    parts.push(gridGeometry(stations.map((m) => ts.slice().reverse().map((t) => pt(m, t, 1)))).toNonIndexed());
    parts.push(gridGeometry(stations.map((m) => ts.map((t) => pt(m, t, -1)))).toNonIndexed());
  }
  const f = flatFaces();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  for (let m = 0; m < ns; m++) {
    f.quad(pt(m, c1, 1), pt(m, c1, -1), pt(m + 1, c1, -1), pt(m + 1, c1, 1), X.clone().negate());
    if (c0 > 0) f.quad(pt(m, c0, 1), pt(m, c0, -1), pt(m + 1, c0, -1), pt(m + 1, c0, 1), X);
  }
  for (const [m, hint] of [[0, Y.clone().negate()], [ns, Y]]) {
    for (let k = 0; k < nc; k++) f.quad(pt(m, ts[k], 1), pt(m, ts[k + 1], 1), pt(m, ts[k + 1], -1), pt(m, ts[k], -1), hint);
  }
  parts.push(f.build());
  return mergeGeometries(parts);
}

// UV «коробочной» проекцией в метрах / TILE — одинаковый шаг плиток на любых деталях
function boxUV(g, scale = TILE) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ax >= ay && ax >= az) [u, v] = [p.getZ(i), p.getY(i)];
    else if (ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
    else [u, v] = [p.getX(i), p.getY(i)];
    uv[2 * i] = u / scale;
    uv[2 * i + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Для слияния в одну сетку: только position/normal/uv, без групп
function strip(g) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.normalizeNormals(); // после scale() нормали не единичные
  out.clearGroups();
  return out;
}
const merge = (list) => mergeGeometries(list.map(strip));
// Слияние с группами материалов: [[geometry, materialIndex], ...]
function mergeGroups(list) {
  const sorted = [...list].sort((a, b) => a[1] - b[1]);
  const g = mergeGeometries(sorted.map(([geo]) => strip(geo)));
  g.clearGroups();
  let start = 0;
  for (const [geo, mi] of sorted) {
    const cnt = (geo.index ? geo.index.count : geo.attributes.position.count);
    g.addGroup(start, cnt, mi);
    start += cnt;
  }
  return g;
}

// Плоская деталь (ось Z детали → normal) на поверхности в точке point
function placed(g, point, normal, offset = 0.02, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin));
  const m = new THREE.Matrix4().compose(point.clone().addScaledVector(normal, offset), q, new THREE.Vector3(1, 1, 1));
  return g.clone().applyMatrix4(m);
}

function roundedRect(w, h, r, seg = 4) {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.absarc(x0 + w - r, y0 + r, r, -Math.PI / 2, 0);
  s.lineTo(x0 + w, y0 + h - r);
  s.absarc(x0 + w - r, y0 + h - r, r, 0, Math.PI / 2);
  s.lineTo(x0 + r, y0 + h);
  s.absarc(x0 + r, y0 + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
  return new THREE.ShapeGeometry(s, seg);
}

// Текстура противогидролокационного покрытия: плитки 0.6 м с чуть разным тоном
function tileTexture() {
  const canvas = document.createElement('canvas');
  const N = 1024;
  canvas.width = N;
  canvas.height = N;
  const c = canvas.getContext('2d');
  let seed = 9551;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  c.fillStyle = '#101112';
  c.fillRect(0, 0, N, N);
  const n = 8;
  const s = N / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const l = 21 + Math.floor(rnd() * 5);
      c.fillStyle = `rgb(${l},${l},${l + 2})`;
      c.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      // мелкая неоднородность резины
      for (let k = 0; k < 40; k++) {
        const d = Math.floor(rnd() * 3) - 1;
        c.fillStyle = `rgba(${l + d},${l + d},${l + d + 2},0.6)`;
        c.fillRect(i * s + 3 + rnd() * (s - 12), j * s + 3 + rnd() * (s - 12), 2 + rnd() * 8, 2 + rnd() * 8);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.name = 'Anechoic_Tiles';
  return tex;
}

// ---------------------------------------------------------------------------

export function createBorei() {
  const sub = new THREE.Group();
  sub.name = 'Borei_AlexanderNevsky';

  const std = (name, color, roughness = 0.7, metalness = 0.1, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const tiles = tileTexture();
  const M = {
    hull: std('Hull_Anechoic_Black', 0xffffff, 0.82, 0.05, { map: tiles }),
    sonar: std('Sonar_Window', 0x1f2124, 0.62, 0.05),
    dark: std('Outline_Dark', 0x0b0c0d, 0.75, 0.1),
    hole: std('Flood_Opening_Black', 0x020202, 1.0, 0.0),
    silo: std('Silo_Interior', 0x101112, 0.85, 0.2),
    cap: std('Missile_Membrane', 0x6b7075, 0.6, 0.1),
    metal: std('Mast_Metal', 0x2c3034, 0.45, 0.6),
    head: std('Mast_Head_Grey', 0x4c5055, 0.5, 0.3),
    glass: std('Glass_Window', 0x1d2a35, 0.12, 0.7),
    bronze: std('Propulsor_Bronze', 0x7a6440, 0.35, 0.85),
  };

  const mesh = (g, mat, name, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const group = (name, parent = sub, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const named = (g, name) => {
    g.name = name;
    return g;
  };

  // =========================================================================
  // КОРПУС: лофт по шпангоутам, шов текстуры — по килю
  const hullGroup = group('Hull');
  {
    const xs = [];
    const push = (x) => { if (!xs.length || x - xs[xs.length - 1] > 1e-6) xs.push(x); };
    for (let i = 0; i <= 64; i++) push(HULL.xTail + ((HULL.xTail0 - HULL.xTail) * i) / 64);
    for (let i = 0; i <= 96; i++) push(HULL.xTail0 + ((HULL.xBow0 - HULL.xTail0) * i) / 96);
    for (let i = 0; i <= 56; i++) push(HULL.xBow0 + (HULL.xBow - HULL.xBow0) * Math.sin((Math.PI / 2) * (i / 56)));
    const K = HULL.ring;
    const pos = [];
    const uv = [];
    for (const x of xs) {
      let arc = 0;
      let prev = null;
      for (let k = 0; k <= K; k++) {
        const s = hullSection(x, (2 * Math.PI * k) / K);
        if (prev) arc += Math.hypot(s.y - prev.y, s.z - prev.z);
        prev = s;
        pos.push(x, s.y, s.z);
        uv.push(x / TILE, arc / TILE);
      }
    }
    const cols = K + 1;
    const hullIdx = [];
    const sonarIdx = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const sonar = xs[i] > 71;
      for (let k = 0; k < K; k++) {
        const a = i * cols + k;
        const b = a + cols;
        const c = b + 1;
        const d = a + 1;
        const lower = k < 0.32 * K || k >= 0.68 * K;
        (sonar && lower ? sonarIdx : hullIdx).push(a, b, c, a, c, d);
      }
    }
    // Торец у ступицы: веер к центру (закрыт ступицей движителя)
    const base = pos.length / 3;
    const xt = xs[0];
    pos.push(xt, hullAxisY(xt), 0);
    uv.push(0, 0);
    for (let k = 0; k <= K; k++) {
      const s = hullSection(xt, (2 * Math.PI * k) / K);
      pos.push(xt, s.y, s.z);
      uv.push(s.z / TILE, s.y / TILE);
    }
    for (let k = 0; k < K; k++) hullIdx.push(base, base + 1 + k, base + 2 + k);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([...hullIdx, ...sonarIdx]);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    // Шов по килю: усредняем нормали k = 0 и k = K; носовая точка смотрит в +X
    for (let i = 0; i < xs.length; i++) {
      const a = i * cols;
      const b = a + K;
      const v = new THREE.Vector3(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
      nrm.setXYZ(a, v.x, v.y, v.z);
      nrm.setXYZ(b, v.x, v.y, v.z);
    }
    const tip = (xs.length - 1) * cols;
    for (let k = 0; k <= K; k++) nrm.setXYZ(tip + k, 1, 0, 0);
    g.addGroup(0, hullIdx.length, 0);
    g.addGroup(hullIdx.length, sonarIdx.length, 1);
    g.name = 'Hull_Loft';
    mesh(g, [M.hull, M.sonar], 'Hull_Skin', hullGroup);
  }

  // Люки на надстройке корпуса (входной носовой, грузовой, кормовой)
  {
    const disc = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 28);
    const rect = new THREE.BoxGeometry(2.2, 0.05, 1.3);
    const parts = [];
    for (const [x, g] of [[52, disc], [47.5, rect], [-44, disc], [-48, disc]]) {
      parts.push(g.clone().translate(x, hullAxisY(x) + hullRadius(x) + 0.0, 0));
    }
    mesh(merge(parts), M.dark, 'Hull_DeckHatches', hullGroup);
  }

  // Шпигаты (лимберы) на верхней части корпуса: нос и корма за «горбом»
  const slot = roundedRect(0.75, 0.24, 0.1, 3);
  {
    for (const side of [1, -1]) {
      const parts = [];
      for (let x = 41; x <= 67; x += 1.25) {
        const { point, normal } = hullSurface(x, 0.9, side);
        parts.push(placed(slot, point, normal, 0.03));
      }
      for (let x = -56; x <= -40; x += 1.25) {
        const { point, normal } = hullSurface(x, 0.3, side);
        parts.push(placed(slot, point, normal, 0.03));
      }
      mesh(merge(parts), M.hole, side > 0 ? 'Hull_FloodOpenings_Starboard' : 'Hull_FloodOpenings_Port', hullGroup);
    }
  }

  // Крышки носовых торпедных аппаратов: по 3 на борт
  {
    const door = new THREE.ExtrudeGeometry((() => {
      const s = new THREE.Shape();
      s.absellipse(0, 0, 0.85, 0.55, 0, Math.PI * 2, false, 0);
      return s;
    })(), { depth: 0.05, bevelEnabled: false, curveSegments: 24 });
    for (const side of [1, -1]) {
      const parts = [];
      for (const [x, y] of [[73.6, -2.5], [72.4, -4.2], [73.6, -5.9]]) {
        const { point, normal } = hullSurface(x, y, side);
        parts.push(placed(door, point, normal, -0.01));
      }
      mesh(merge(parts), M.dark, side > 0 ? 'TorpedoDoors_Starboard' : 'TorpedoDoors_Port', hullGroup);
    }
  }

  // =========================================================================
  // РАКЕТНАЯ ПАЛУБА («горб») с вырезами под 16 шахт
  const deck = group('MissileDeck');
  const T = HUMP.top;
  const siloSpots = [];
  for (let i = 0; i < SILO.rows; i++) {
    const x = SILO.x0 - SILO.pitch * i;
    siloSpots.push({ x, side: 1, n: 2 * i + 1 }, { x, side: -1, n: 2 * i + 2 });
  }
  {
    const Ns = 6;
    const Nc = 8;
    const Nt = 16;
    const xs = [];
    const push = (x) => { if (!xs.length || x - xs[xs.length - 1] > 1e-6) xs.push(x); };
    for (let i = 0; i <= 38; i++) push(HUMP.xAe + ((HUMP.xA - HUMP.xAe) * i) / 38);
    for (let i = 0; i <= 36; i++) push(HUMP.xA + ((HUMP.xF - HUMP.xA) * i) / 36);
    for (let i = 0; i <= 20; i++) push(HUMP.xF + ((HUMP.xFe - HUMP.xF) * i) / 20);
    const ringAt = (x) => {
      const top = humpTop(x);
      const A = humpHalfWidth(x);
      const Rc = Math.min(HUMP.rc, A * 0.4);
      const Rv = Math.min(HUMP.rv, (top - HUMP.yb) * 0.6);
      const sideTop = top - Rv;
      const half = [];
      for (let j = 0; j < Ns; j++) {
        const y = HUMP.yb + ((sideTop - HUMP.yb) * j) / Ns;
        half.push([A + 0.25 * (1 - j / Ns), y]);
      }
      for (let j = 0; j < Nc; j++) {
        const psi = ((Math.PI / 2) * j) / Nc;
        half.push([A - Rc + Rc * Math.cos(psi), sideTop + Rv * Math.sin(psi)]);
      }
      const topPts = [];
      for (let j = 0; j <= Nt; j++) topPts.push([(A - Rc) * (1 - (2 * j) / Nt), top]);
      const pts = [...half, ...topPts, ...half.slice().reverse().map(([z, y]) => [-z, y])];
      return pts.map(([z, y]) => new THREE.Vector3(x, y, z));
    };
    const rows = xs.map(ringAt);
    const topStart = Ns + Nc;
    const topEnd = topStart + Nt;
    const center = topStart + Nt / 2;
    const inFlat = (i) => xs[i] >= HUMP.xA - 1e-6 && xs[i + 1] <= HUMP.xF + 1e-6;
    // Знаковая длина дуги от середины крыши (совпадает с z на плоской крыше)
    const arcs = rows.map((r) => {
      const a = new Array(r.length).fill(0);
      for (let p = center - 1; p >= 0; p--) a[p] = a[p + 1] + r[p].distanceTo(r[p + 1]);
      for (let p = center + 1; p < r.length; p++) a[p] = a[p - 1] - r[p].distanceTo(r[p - 1]);
      return a;
    });
    const casing = gridGeometry(rows, {
      flip: true,
      skip: (m, p) => inFlat(m) && p >= topStart && p + 1 <= topEnd,
      uv: (m, p, v) => [v.x / TILE, arcs[m][p] / TILE],
    });

    // Плоская крыша: контур точно по вершинам лофта, отверстия под шахты
    const zt = HUMP.a - HUMP.rc;
    const flatX = xs.filter((x) => x >= HUMP.xA - 1e-6 && x <= HUMP.xF + 1e-6);
    const shape = new THREE.Shape();
    const outline = [];
    for (const x of flatX) outline.push([x, -zt]);
    for (let j = 1; j < Nt; j++) outline.push([HUMP.xF, -zt * (1 - (2 * j) / Nt)]);
    for (const x of flatX.slice().reverse()) outline.push([x, zt]);
    for (let j = 1; j < Nt; j++) outline.push([HUMP.xA, zt * (1 - (2 * j) / Nt)]);
    outline.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    for (const { x, side } of siloSpots) {
      const h = new THREE.Path();
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2;
        const px = x + SILO.hole * Math.cos(a);
        const py = -side * SILO.z + SILO.hole * Math.sin(a);
        if (k) h.lineTo(px, py);
        else h.moveTo(px, py);
      }
      shape.holes.push(h);
    }
    const plate = new THREE.ShapeGeometry(shape);
    plate.rotateX(-Math.PI / 2);
    plate.translate(0, T, 0);
    const pp = plate.attributes.position;
    const puv = plate.attributes.uv;
    for (let i = 0; i < pp.count; i++) puv.setXY(i, pp.getX(i) / TILE, pp.getZ(i) / TILE);
    plate.deleteAttribute('normal');
    plate.computeVertexNormals();
    mesh(merge([casing, plate]), M.hull, 'MissileDeck_Casing', deck);

    // Шпигаты по бортам «горба»
    for (const side of [1, -1]) {
      const parts = [];
      const sideTop = T - HUMP.rv;
      for (const y of [1.6, 3.9]) {
        const z = HUMP.a + 0.25 * (1 - (y - HUMP.yb) / (sideTop - HUMP.yb));
        for (let x = HUMP.xA + 0.8; x <= HUMP.xF - 0.5; x += 1.25) {
          parts.push(placed(slot, new THREE.Vector3(x, y, side * z), new THREE.Vector3(0, 0, side), 0.03));
        }
      }
      // ряд по скату кормовой части
      for (let x = HUMP.xA - 1; x >= HUMP.xA - 9; x -= 1.25) {
        const z = humpHalfWidth(x) + 0.25 * 0.3;
        const y = Math.min(humpTop(x) - HUMP.rv - 0.4, 1.8);
        if (y < 1.0) continue;
        parts.push(placed(slot, new THREE.Vector3(x, y, side * z), new THREE.Vector3(0, 0, side), 0.03));
      }
      mesh(merge(parts), M.hole, side > 0 ? 'MissileDeck_FloodOpenings_Starboard' : 'MissileDeck_FloodOpenings_Port', deck);
    }
  }

  // Шахты: колодец (внутренние нормали) + мембрана; крышки на шарнирах
  const hatches = [];
  {
    const wall = new THREE.CylinderGeometry(SILO.hole, SILO.hole, 1.6, 40, 1, true);
    wall.translate(0, -0.8, 0);
    // Разворачиваем грани внутрь колодца
    const wi = wall.index.array;
    for (let i = 0; i < wi.length; i += 3) [wi[i + 1], wi[i + 2]] = [wi[i + 2], wi[i + 1]];
    const wn = wall.attributes.normal;
    for (let i = 0; i < wn.count; i++) wn.setXYZ(i, -wn.getX(i), -wn.getY(i), -wn.getZ(i));
    const membrane = new THREE.CircleGeometry(SILO.hole, 40).rotateX(-Math.PI / 2).translate(0, -1.6, 0);
    const ring = new THREE.CylinderGeometry(SILO.hole * 0.55, SILO.hole * 0.75, 0.15, 32).translate(0, -1.52, 0);
    const wellG = named(mergeGroups([[wall, 0], [membrane, 1], [ring, 1]]), 'Silo_Well');
    const lidG = named(boxUV(new THREE.CylinderGeometry(SILO.lid - 0.12, SILO.lid, 0.2, 48)), 'Silo_Hatch_Lid');
    const coaming = new THREE.RingGeometry(SILO.hole, SILO.lid + 0.14, 48, 1).rotateX(-Math.PI / 2);
    const knuckle = new THREE.CylinderGeometry(0.13, 0.13, 0.45, 12).rotateZ(Math.PI / 2);
    const coamings = [];
    const hinges = [];
    for (const { x, side, n } of siloSpots) {
      const id = String(n).padStart(2, '0');
      const z = side * SILO.z;
      mesh(wellG, [M.silo, M.cap], `Silo_Well_${id}`, deck, x, T, z);
      coamings.push(coaming.clone().translate(x, T + 0.006, z));
      const zh = side * (SILO.z + SILO.lid);
      for (const dx of [-0.75, 0.75]) hinges.push(knuckle.clone().translate(x + dx, T + 0.11, zh + side * 0.08));
      const pivot = group(`Hatch_Silo_${id}`, deck, x, T + 0.11, zh);
      pivot.userData.side = side;
      mesh(lidG, M.hull, `Hatch_Silo_${id}_Lid`, pivot, 0, 0, -side * SILO.lid);
      hatches.push(pivot);
    }
    mesh(merge(coamings), M.dark, 'MissileDeck_Coamings', deck);
    mesh(merge(hinges), M.metal, 'MissileDeck_Hinges', deck);
  }

  // =========================================================================
  // РУБКА (ограждение выдвижных устройств)
  const sail = group('Sail');
  {
    const S = SAIL;
    const Nx = 44;
    const ringAt = (y, inset = 0) => {
      const p = sailPlan(y, inset);
      const pts = [];
      for (let j = 0; j <= Nx; j++) {
        const x = p.xa + ((p.xf - p.xa) * (1 - Math.cos((Math.PI * j) / Nx))) / 2;
        pts.push(new THREE.Vector3(x, y, sailHalfWidth(x, p)));
      }
      for (let j = Nx - 1; j >= 1; j--) pts.push(pts[j].clone().setZ(-pts[j].z));
      return pts;
    };
    const rows = [];
    const r = 0.4;
    const yTopStraight = S.top - r;
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      rows.push(ringAt(S.yBase + (yTopStraight - S.yBase) * (1 - (1 - t) ** 1.6)));
    }
    for (let i = 1; i <= 5; i++) {
      const th = (i / 5) * (Math.PI / 2);
      rows.push(ringAt(S.top - r + r * Math.sin(th), r * (1 - Math.cos(th))));
    }
    const body = gridGeometry(rows, { closedP: true });
    // Крыша рубки
    const topRing = rows[rows.length - 1];
    const tris = THREE.ShapeUtils.triangulateShape(topRing.map((v) => new THREE.Vector2(v.x, v.z)), []);
    const f = flatFaces();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [a, b, c] of tris) f.tri(topRing[a], topRing[b], topRing[c], up);
    mesh(boxUV(merge([body, f.build()])), M.hull, 'Sail_Body', sail);

    // Окна ходового мостика в верхней носовой части
    const win = new THREE.BoxGeometry(0.42, 0.3, 0.06);
    const wins = [];
    const yw = S.top - 0.85;
    const pl = sailPlan(yw);
    for (const side of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const x = pl.xf - 1.0 - 0.6 * i;
        const hw = sailHalfWidth(x, pl);
        const d = (sailHalfWidth(x + 0.05, pl) - sailHalfWidth(x - 0.05, pl)) / 0.1;
        const nrm = new THREE.Vector3(-d * side * side, 0, side).normalize();
        nrm.x = -d;
        nrm.normalize();
        wins.push(placed(win, new THREE.Vector3(x, yw, side * hw), nrm, 0.0));
      }
    }
    mesh(merge(wins), M.glass, 'Sail_Bridge_Windows', sail);

    // Контур люка всплывающей спасательной камеры в кормовой части рубки
    const pod = roundedRect(4.6, 3.2, 1.2, 6).rotateX(-Math.PI / 2);
    const podIn = roundedRect(4.2, 2.8, 1.0, 6).rotateX(-Math.PI / 2);
    mesh(merge([pod.translate(21.6, S.top + 0.015, 0)]), M.dark, 'Sail_RescueChamber_Outline', sail);
    mesh(boxUV(merge([podIn.translate(21.6, S.top + 0.03, 0)])), M.hull, 'Sail_RescueChamber_Hatch', sail);
  }

  // Выдвижные устройства на крыше рубки
  const masts = group('Masts', sail);
  {
    const yT = SAIL.top;
    const cyl = (r, h, y, seg = 16, r2 = r) => new THREE.CylinderGeometry(r, r2, h, seg).translate(0, y + h / 2, 0);
    const openings = [];
    const mast = (name, x, z, parts) => {
      openings.push(new THREE.CircleGeometry(0.55, 24).rotateX(-Math.PI / 2).scale(1.4, 1, 1).translate(x, yT + 0.01, z));
      mesh(mergeGroups(parts), [M.metal, M.head, M.glass], name, masts, x, yT, z);
    };
    // командирский перископ
    mast('Mast_Periscope_Attack', 33.6, 0, [
      [cyl(0.17, 4.6, 0), 0], [cyl(0.2, 0.7, 4.6, 16, 0.2), 1],
      [new THREE.BoxGeometry(0.06, 0.18, 0.16).translate(0.2, 5.0, 0), 2],
    ]);
    // оптронная (зенитный перископ)
    mast('Mast_Optronic', 32.1, 0.4, [
      [cyl(0.24, 4.0, 0), 0], [cyl(0.34, 0.9, 4.0, 20), 1],
      [new THREE.SphereGeometry(0.34, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 4.9, 0), 1],
      [new THREE.BoxGeometry(0.1, 0.3, 0.3).translate(0.31, 4.45, 0), 2],
    ]);
    // РЛС
    mast('Mast_Radar', 30.5, -0.3, [
      [cyl(0.22, 3.4, 0), 0],
      [new THREE.SphereGeometry(0.5, 24, 12).scale(1.6, 0.4, 0.7).translate(0, 3.6, 0), 1],
    ]);
    // антенна связи
    mast('Mast_Comms', 29.0, 0.3, [
      [cyl(0.18, 5.0, 0), 0], [new THREE.SphereGeometry(0.34, 16, 10).translate(0, 5.2, 0), 1],
      [cyl(0.03, 1.4, 5.45, 6), 0],
    ]);
    // РЭБ / радиоразведка
    mast('Mast_ESM', 27.4, -0.2, [
      [cyl(0.22, 3.8, 0), 0], [cyl(0.42, 0.9, 3.8, 20), 1],
      [cyl(0.46, 0.08, 4.0, 20), 0], [cyl(0.46, 0.08, 4.35, 20), 0], [cyl(0.25, 0.3, 4.7, 16, 0.42), 1],
    ]);
    // РДП (шнорхель): овальный фальшборт и головка с решёткой
    mast('Mast_Snorkel', 25.4, 0, [
      [new THREE.CylinderGeometry(0.5, 0.5, 2.6, 24).scale(1.8, 1, 0.9).translate(0, 1.3, 0), 0],
      [new THREE.BoxGeometry(1.5, 0.5, 0.82).translate(0, 2.85, 0), 1],
      [new THREE.BoxGeometry(1.3, 0.25, 0.84).translate(0, 2.8, 0), 2],
    ]);
    // спутниковая связь / навигация
    mast('Mast_SatCom', 23.8, 0, [
      [cyl(0.2, 2.4, 0), 0],
      [new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2.4, 0), 1],
      [cyl(0.5, 0.15, 2.25, 20), 1],
    ]);
    mesh(merge(openings), M.dark, 'Mast_Openings', masts);
  }

  // =========================================================================
  // НОСОВЫЕ ГОРИЗОНТАЛЬНЫЕ РУЛИ (убираемые в корпус), показаны выдвинутыми
  const bowPlanes = group('BowPlanes');
  {
    const xb = 61;
    const yb = -1.5;
    const g = named(boxUV(foilGeometry({ root: 4.4, tip: 3.0, span: 4.2, thick: 0.12, sweep: -0.9 }).translate(1.8, 0, 0)), 'BowPlane_Foil');
    const recess = new THREE.BoxGeometry(5.0, 0.75, 0.06);
    const parts = [];
    for (const side of [1, -1]) {
      const z = hullHalfWidth(xb, yb);
      const p = group(side > 0 ? 'BowPlane_Starboard' : 'BowPlane_Port', bowPlanes, xb, yb, side * (z - 0.9));
      mesh(g, M.hull, p.name + '_Foil', p).rotation.x = (side * Math.PI) / 2;
      const { point, normal } = hullSurface(xb, yb, side);
      parts.push(placed(recess, point, normal, 0.0));
    }
    mesh(merge(parts), M.dark, 'BowPlane_Recesses', bowPlanes);
  }

  // =========================================================================
  // КОРМОВОЕ ОПЕРЕНИЕ: стабилизаторы с концевыми шайбами, вертикальные кили с рулями
  const yc = HULL.yc;
  const stern = group('SternPlanes');
  let rudderUpper;
  let rudderLower;
  {
    // Горизонтальные стабилизаторы и рули глубины; линия шарнира параллельна оси Z
    const hf = 0.68;
    const st = { root: 11, tip: 6.5, span: 8.6, thick: 0.11 };
    st.sweep = hf * (st.tip - st.root);
    const xLE = -64.2;
    const fixedG = named(boxUV(foilGeometry({ ...st, c1: hf })), 'Stabilizer_Foil');
    const flapG = named(boxUV(foilGeometry({ ...st, c0: hf + 0.01 }).translate(hf * st.root, 0, 0)), 'Elevator_Foil');
    const endG = named(boxUV(foilGeometry({ root: 6.2, tip: 4.4, span: 5.0, thick: 0.1, sweep: -1.0 }).translate(0, -2.5, 0)), 'EndPlate_Foil');
    for (const side of [1, -1]) {
      const sfx = side > 0 ? 'Starboard' : 'Port';
      mesh(fixedG, M.hull, `Stabilizer_${sfx}`, stern, xLE, yc, 0).rotation.x = (side * Math.PI) / 2;
      const ev = group(`Elevator_${sfx}`, stern, xLE - hf * st.root, yc, 0);
      mesh(flapG, M.hull, `Elevator_${sfx}_Foil`, ev).rotation.x = (side * Math.PI) / 2;
      mesh(endG, M.hull, `EndPlate_${sfx}`, stern, xLE + st.sweep + 0.6, yc, side * (st.span + 0.02));
    }

    // Верхний и нижний кили с рулями направления
    const fins = group('Stern_Fins');
    const hv = 0.7;
    const up = { root: 13.5, tip: 6.5, span: 9.9, thick: 0.1 };
    up.sweep = hv * (up.tip - up.root);
    const xu = -62.5;
    mesh(boxUV(foilGeometry({ ...up, c1: hv })), M.hull, 'Fin_Upper', fins, xu, yc, 0);
    rudderUpper = group('Rudder_Upper', fins, xu - hv * up.root, yc, 0);
    mesh(boxUV(foilGeometry({ ...up, c0: hv + 0.01 }).translate(hv * up.root, 0, 0)), M.hull, 'Rudder_Upper_Foil', rudderUpper);

    const lo = { root: 12, tip: 6.5, span: 7.8, thick: 0.1 };
    lo.sweep = hv * (lo.tip - lo.root);
    const xl = -63.5;
    const finLo = mesh(boxUV(foilGeometry({ ...lo, c1: hv })), M.hull, 'Fin_Lower', fins, xl, yc, 0);
    finLo.rotation.x = Math.PI;
    rudderLower = group('Rudder_Lower', fins, xl - hv * lo.root, yc, 0);
    rudderLower.rotation.x = Math.PI;
    mesh(boxUV(foilGeometry({ ...lo, c0: hv + 0.01 }).translate(hv * lo.root, 0, 0)), M.hull, 'Rudder_Lower_Foil', rudderLower);

    // Обтекатель буксируемой антенны на вершине верхнего киля
    const prof = [];
    const L = 9.0;
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const r = t < 0.25 ? 0.5 * Math.sin((t / 0.25) * Math.PI / 2) ** 0.7 : 0.5 - 0.1 * ((t - 0.25) / 0.75) ** 2;
      prof.push([-t * L, Math.max(r, 0.0)]);
    }
    prof.push([-L - 0.01, 0]);
    const podG = revolveX(prof, 32);
    mesh(boxUV(podG), M.hull, 'TowedArray_Fairing', fins, xu + up.sweep + 1.0, yc + up.span + 0.15, 0);
  }

  // =========================================================================
  // ВОДОМЁТНЫЙ ДВИЖИТЕЛЬ: насадка, спрямляющий аппарат, ротор
  const prop = group('Propulsor', sub, 0, HULL.yc, 0);
  let rotor;
  {
    const x0 = -77;
    const len = 7.2;
    const rIn = (t) => 3.3 - 0.35 * t;
    const th = (t) => 0.6 * 5 * 0.12 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4) / 0.12 * 0.75;
    const outer = [];
    const inner = [];
    for (let k = 0; k <= 30; k++) {
      const t = (1 - Math.cos((Math.PI * k) / 30)) / 2;
      const x = x0 - t * len;
      outer.push([x, rIn(t) + th(t) * 1.6 + 0.02]);
      inner.push([x, rIn(t) - 0.02]);
    }
    // Замкнутый профиль: по наружной поверхности к срезу и обратно по внутренней
    const loop = [...outer, ...inner.slice(1, -1).reverse()];
    mesh(boxUV(revolveX(loop, 72, true)), M.hull, 'Propulsor_Shroud', prop);

    // Спрямляющий аппарат: 9 лопаток перед ротором
    const vane = foilGeometry({ root: 1.3, tip: 1.1, span: 1.5, thick: 0.12, nc: 8, ns: 3 });
    vane.rotateY(THREE.MathUtils.degToRad(12));
    const vanes = [];
    for (let k = 0; k < 9; k++) {
      vanes.push(vane.clone().translate(x0 - 0.6, 2.0, 0).rotateX((k / 9) * Math.PI * 2 + 0.2));
    }
    mesh(boxUV(merge(vanes)), M.metal, 'Propulsor_Stator', prop);

    // Ротор: ступица с обтекателем и 7 саблевидных лопастей
    rotor = group('Propulsor_Rotor', prop);
    const hub = revolveX([[-79.2, 1.9], [-80.5, 1.88], [-83.0, 1.82], [-84.2, 1.6], [-85.2, 1.05], [-85.9, 0.45], [-86.3, 0.1], [-86.35, 0]], 40);
    const blade = foilGeometry({ root: 1.9, tip: 1.3, span: 1.32, thick: 0.08, sweep: -0.45, nc: 10, ns: 5 });
    blade.translate(0.95, 0, 0).rotateY(THREE.MathUtils.degToRad(48));
    const blades = [];
    for (let k = 0; k < 7; k++) blades.push(blade.clone().translate(-81.4, 1.72, 0).rotateX((k / 7) * Math.PI * 2));
    mesh(mergeGroups([[hub, 0], [merge(blades), 1]]), [M.metal, M.bronze], 'Propulsor_Rotor_Mesh', rotor);
  }

  // =========================================================================
  // Уникальные имена узлов (Blender не любит дубликаты)
  const seen = new Map();
  sub.traverse((o) => {
    if (o === sub) return;
    const base = o.name || o.type;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n > 1) o.name = `${base}_${n}`;
  });

  // =========================================================================
  // АНИМАЦИЯ
  // (а) вращение ротора движителя вокруг оси X, шаг ключей 30° — slerp идёт по короткой дуге
  const spinPeriod = 2.0;
  const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
  {
    const times = [];
    const values = [];
    for (let k = 0; k <= 12; k++) {
      times.push((k / 12) * spinPeriod);
      const q = qx((-2 * Math.PI * k) / 12);
      values.push(q.x, q.y, q.z, q.w);
    }
    sub.animations.push(new THREE.AnimationClip('Propulsor_Spin', spinPeriod, [
      new THREE.QuaternionKeyframeTrack(`${rotor.name}.quaternion`, times, values),
    ]));
  }
  // (б) крышки шахт открываются попарно от носа к корме и остаются открытыми
  {
    const dur = 6.0;
    const tracks = hatches.map((h, i) => {
      const start = Math.floor(i / 2) * 0.4;
      const times = [0];
      const values = [...qx(0).toArray()];
      for (let k = 0; k <= 6; k++) {
        times.push(start + 0.01 + (k / 6) * 2.4);
        const a = h.userData.side * SILO.openAngle * smooth(k / 6);
        values.push(...qx(a).toArray());
      }
      times.push(dur);
      values.push(...qx(h.userData.side * SILO.openAngle).toArray());
      return new THREE.QuaternionKeyframeTrack(`${h.name}.quaternion`, times, values);
    });
    sub.animations.push(new THREE.AnimationClip('SiloHatches_Open', dur, tracks));
  }

  sub.userData.update = (time) => {
    rotor.rotation.x = (-2 * Math.PI * time) / spinPeriod;
  };
  // 0 — закрыты, 1 — открыты
  sub.userData.setHatches = (amount) => {
    const a = Math.min(1, Math.max(0, amount));
    for (const h of hatches) h.rotation.x = h.userData.side * SILO.openAngle * a;
  };
  sub.userData.parts = { rotor, hatches, rudderUpper, rudderLower };

  return sub;
}
