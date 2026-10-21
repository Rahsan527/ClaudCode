import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Ракетный подводный крейсер стратегического назначения проекта 955А «Борей-А» — «Князь Владимир».
// Только внешний вид. Масштаб 1:1 в метрах. Ось Y вверх, нос смотрит в +X, правый борт — +Z,
// начало координат — мидель на диаметральной плоскости, y = 0 — ватерлиния в надводном положении
// (осадка 10 м: киль на y = −10). Корпус — лофт по шпангоутам (суперэллипсы) в BufferGeometry,
// рубка — лофт горизонтальных сечений, оперение и лопасти — лофт профилей NACA.
// Отличия 955А от 955: нет «горба» за рубкой (ракетная палуба плавно вписана в корпус),
// низкая обтекаемая рубка со скруглённой передней кромкой, новое кормовое оперение
// с наклонными концевыми шайбами, водомётный движитель, убираемые носовые рули.

// Все размеры корпуса в одном месте
const HULL = {
  xBow: 85, // носовая оконечность
  xFore: 56, // начало носового заострения
  xAft: -32, // начало кормового конуса
  xTail: -76, // условная вершина конуса (радиус rTail)
  xEnd: -75.5, // корпус заканчивается внутри ступицы движителя
  R: 6.75, // радиус прочного/лёгкого корпуса (ширина 13.5 м)
  B: 6.6, // глубина ниже оси (киль на y = −10)
  yc: -3.4, // ось корпуса
  rTail: 1.7,
  rise: 1.7, // подъём ракетной палубы над цилиндром
  stations: 300,
  ring: 128,
};
const TILE = 6; // период текстуры резиновых плиток, м (8 × 8 плиток по 0.75 м)

// Ракетные шахты: 2 ряда по 8, крышки откидываются к борту
const SILO = {
  xs: [16.5, 11.9, 7.3, 2.7, -1.9, -6.5, -11.1, -15.7],
  z: 2.55,
  r: 1.15,
  open: THREE.MathUtils.degToRad(110),
};

// Рубка
const SAIL = { y0: 2.0, deck: 4.95, top: 11.0, le: 44.0, te: 20.5, w: 2.45 };

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = THREE.MathUtils.lerp;

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА

// Радиус корпуса: эллипсоидный нос, цилиндр, кормовой конус к движителю
export function hullRadius(x) {
  if (x > HULL.xFore) {
    const u = clamp01((x - HULL.xFore) / (HULL.xBow - HULL.xFore));
    return HULL.R * Math.max(0, 1 - u ** 2.2) ** (1 / 2.2);
  }
  if (x < HULL.xAft) {
    const p = clamp01((HULL.xAft - x) / (HULL.xAft - HULL.xTail));
    return HULL.rTail + (HULL.R - HULL.rTail) * (1 - p ** 1.9);
  }
  return HULL.R;
}

// Подъём верха корпуса над ракетными шахтами: плавные обтекатели в нос и корму (без «горба»)
function deckRise(x) {
  if (x > 22) return HULL.rise * (1 - smooth((x - 22) / 50));
  if (x < -28) return HULL.rise * (1 - smooth((-28 - x) / 26));
  return HULL.rise;
}

// Сечение: полуширина w, высота над осью t, глубина под осью b, показатели суперэллипса
function section(x) {
  const r = hullRadius(x);
  const d = deckRise(x);
  return { yc: HULL.yc, w: r, t: r + d, b: (r * HULL.B) / HULL.R, nT: 2 + d / HULL.rise, nB: 2.15 };
}

// Точка обшивки: θ = 0 — правый борт, π/2 — верх, π — левый борт, −π/2 — киль
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;
function hullPos(x, th, out = new THREE.Vector3()) {
  const s = section(x);
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const n = sn >= 0 ? s.nT : s.nB;
  return out.set(x, s.yc + (sn >= 0 ? s.t : s.b) * spow(sn, 2 / n), s.w * spow(c, 2 / n));
}
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
function hullDTheta(x, th) {
  const h = 1e-4;
  return hullPos(x, th + h, new THREE.Vector3()).sub(hullPos(x, th - h, _a)).divideScalar(2 * h);
}
// Наружная нормаль: dP/dx × dP/dθ
function hullNormal(x, th) {
  if (x > HULL.xBow - 0.02) return new THREE.Vector3(1, 0, 0);
  const h = 0.01;
  const dx = hullPos(Math.min(HULL.xBow, x + h), th, new THREE.Vector3()).sub(hullPos(x - h, th, _b));
  const n = dx.cross(hullDTheta(x, th));
  return n.lengthSq() < 1e-12 ? new THREE.Vector3(1, 0, 0) : n.normalize();
}
// Отметка верха корпуса над точкой (x, z)
export function hullTopY(x, z) {
  const s = section(x);
  const c = Math.min(1, Math.abs(z) / s.w) ** (s.nT / 2);
  return s.yc + s.t * Math.sqrt(Math.max(0, 1 - c * c)) ** (2 / s.nT);
}
// Угол θ (правый борт), на котором обшивка проходит через высоту y
function thetaAtY(x, y) {
  const s = section(x);
  if (y >= s.yc) return Math.asin(Math.min(1, (y - s.yc) / s.t) ** (s.nT / 2));
  return -Math.asin(Math.min(1, (s.yc - y) / s.b) ** (s.nB / 2));
}
// Светлая полоса вдоль борта (как на инфографике): на мидели чуть выше ватерлинии
const stripeY = (x) => HULL.yc + 0.55 * hullRadius(x);

// ---------------------------------------------------------------------------
// ГЕОМЕТРИЧЕСКИЕ ПОМОЩНИКИ

// Набор вершин/треугольников с UV; build() считает нормали и при необходимости
// разворачивает грани наружу по знаку объёма (для замкнутых тел)
class Mesher {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }
  v(p, u = 0, w = 0) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  // Полоса между двумя рядами индексов (кольцами)
  strip(A, B, closed = true) {
    const n = A.length;
    for (let j = 0; j < (closed ? n : n - 1); j++) {
      const k = (j + 1) % n;
      this.quad(A[j], B[j], B[k], A[k]);
    }
  }
  // Крышка-веер по контуру из точек (свои вершины, чтобы кромка осталась острой)
  cap(points, uvFn) {
    const c = new THREE.Vector3();
    points.forEach((p) => c.add(p));
    c.divideScalar(points.length);
    const ci = this.v(c, ...uvFn(c));
    const ids = points.map((p) => this.v(p, ...uvFn(p)));
    for (let j = 0; j < ids.length; j++) this.tri(ci, ids[j], ids[(j + 1) % ids.length]);
  }
  build(name, { orient = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (orient && signedVolume(this.pos, this.idx) < 0) {
      for (let i = 0; i < this.idx.length; i += 3) [this.idx[i + 1], this.idx[i + 2]] = [this.idx[i + 2], this.idx[i + 1]];
    }
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.name = name;
    return g;
  }
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

// Лофт замкнутых колец (массив массивов Vector3) с крышками на концах
function loftRings(name, rings, { uvFn = (p) => [p.x / TILE, p.y / TILE], capStart = true, capEnd = true } = {}) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, ...uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1]);
  if (capStart) m.cap(rings[0], uvFn);
  if (capEnd) m.cap(rings[rings.length - 1], uvFn);
  return m.build(name);
}

// Тело вращения вокруг оси X по профилю [[x, r], ...]
function revolveX(name, profile, segs = 48, { closed = false, uvScale = 1 } = {}) {
  const rings = [];
  for (const [x, r] of profile) {
    const ring = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      ring.push(new THREE.Vector3(x, r * Math.sin(a), r * Math.cos(a)));
    }
    rings.push(ring);
  }
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, (p.x / TILE) * uvScale, ((Math.atan2(p.y, p.z) + Math.PI) * 3) / TILE)));
  for (let k = 0; k < ids.length - (closed ? 0 : 1); k++) m.strip(ids[k], ids[(k + 1) % ids.length]);
  return m.build(name);
}

// Толщина симметричного профиля NACA 00xx (замкнутая задняя кромка)
const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);

// Перо (стабилизатор, руль, рубочный руль): размах по локальной +Y, хорда по X (передняя кромка — +X),
// толщина по Z. from/to — доля хорды (для разделения на неподвижную часть и руль).
function finGeometry(name, { root, tip, span, tc = 0.1, tipTc = tc, from = 0, to = 1, nSpan = 8, nCh = 14, y0 = 0 }) {
  const rings = [];
  for (let k = 0; k <= nSpan; k++) {
    const s = k / nSpan;
    const y = y0 + span * s;
    const le = lerp(root[0], tip[0], s);
    const te = lerp(root[1], tip[1], s);
    const ch = le - te;
    const th = lerp(tc, tipTc, s) * ch;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= nCh; j++) ts.push(from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * j) / nCh)));
    for (const t of ts) ring.push(new THREE.Vector3(le - t * ch, y, Math.max(0.012, naca(t) * th)));
    for (let j = nCh; j >= 0; j--) {
      if (j === 0 && from === 0) continue; // общая точка передней кромки
      ring.push(new THREE.Vector3(le - ts[j] * ch, y, -Math.max(0.012, naca(ts[j]) * th)));
    }
    rings.push(ring);
  }
  return loftRings(name, rings);
}

// Лопасть (ротор, статор): радиальная ось +Y, ось вращения X; шаг и саблевидность
function bladeGeometry(name, { r0, r1, chord0, chord1, pitch, skew = 0, tc = 0.08, n = 8 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = lerp(chord0, chord1, s);
    const beta = Math.atan(pitch / (2 * Math.PI * r)); // угол шага к плоскости диска
    const d = new THREE.Vector3(Math.sin(beta), 0, Math.cos(beta));
    const nn = new THREE.Vector3(Math.cos(beta), 0, -Math.sin(beta));
    const ring = [];
    const M = 10;
    const pts = [];
    for (let j = 0; j <= M; j++) pts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const off = skew * s * s;
    const add = (t, sign) => {
      const c = (0.5 - t) * ch + off;
      const h = sign * Math.max(0.01, naca(t) * tc * ch);
      // точка на цилиндре радиуса r: хорда обвивает ось
      const p = d.clone().multiplyScalar(c).addScaledVector(nn, h);
      const ang = p.z / r;
      ring.push(new THREE.Vector3(p.x, r * Math.cos(ang), r * Math.sin(ang)));
    };
    for (const t of pts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(pts[j], -1);
    rings.push(ring);
  }
  return loftRings(name, rings, { uvFn: (p) => [p.x, p.y] });
}

// Плоский эллипс-наклейка на обшивке (шпигаты, крышки ТА): центр (x, θ), полуоси в метрах
function hullEllipse(m, x, th, a, b, off = 0.025, seg = 14) {
  const bt = b / hullDTheta(x, th).length();
  const at = (xx, tt) => hullPos(xx, tt).addScaledVector(hullNormal(xx, tt), off);
  const c = m.v(at(x, th));
  const ring = [];
  for (let j = 0; j < seg; j++) {
    const f = (j / seg) * Math.PI * 2;
    ring.push(m.v(at(x + a * Math.cos(f), th + bt * Math.sin(f))));
  }
  // обход против часовой в координатах (x, θ) — нормаль наружу
  for (let j = 0; j < seg; j++) m.tri(c, ring[j], ring[(j + 1) % seg]);
}

// Наклейка-диск (или кольцо) на палубе, повторяющая её поперечную погибь
function deckDisk(m, xc, zc, r0, r1, off, seg = 40, rings = 3) {
  const P = (r, a) => {
    const x = xc + r * Math.cos(a);
    const z = zc + r * Math.sin(a);
    return new THREE.Vector3(x, hullTopY(x, z) + off, z);
  };
  const uv = (p) => [p.x / TILE, p.z / TILE];
  const radii = [];
  for (let i = 0; i <= rings; i++) radii.push(lerp(r0, r1, i / rings));
  const ids = radii.map((r) => {
    const row = [];
    for (let j = 0; j < seg; j++) {
      const p = P(r, (j / seg) * Math.PI * 2);
      row.push(m.v(p, ...uv(p)));
    }
    return row;
  });
  // ось a: x = cos, z = sin — обход от внешнего кольца к внутреннему даёт нормаль вверх
  for (let i = 0; i < rings; i++) m.strip(ids[i + 1], ids[i]);
  if (r0 === 0) return;
}

function stripForMerge(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => mergeGeometries(list.map(stripForMerge));

// Текстура на canvas (в glb уходит встроенным PNG)
function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------

export function createBoreiA() {
  const sub = new THREE.Group();
  sub.name = 'BoreiA_KnyazVladimir';

  // Резиновое противогидролокационное покрытие: плитки 0.75 м со сдвигом рядов,
  // каждая чуть отличается тоном, швы темнее
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tileTex = canvasTexture(512, 512, (c, w, h) => {
    const n = 8;
    const s = w / n;
    c.fillStyle = '#16171a';
    c.fillRect(0, 0, w, h);
    for (let r = 0; r < n; r++) {
      for (let k = -1; k < n; k++) {
        const x = k * s + (r % 2 ? s / 2 : 0);
        const v = 27 + Math.round(rnd() * 4);
        c.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
        c.fillRect(x + 1, r * s + 1, s - 2, s - 2);
      }
    }
  });

  const std = (name, color, roughness = 0.8, metalness = 0.05, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const M = {
    hull: std('Hull_Anechoic_Black', 0xffffff, 0.82, 0.0, { map: tileTex }),
    sonar: std('Sonar_Bow_Black', 0xd4d6d8, 0.7, 0.0, { map: tileTex }),
    stripe: std('Marking_Light_Grey', 0x8f969c, 0.75, 0.0),
    hole: std('Flood_Openings_Black', 0x060607, 0.95, 0.0),
    silo: std('Silo_Interior_Black', 0x0a0b0c, 0.9, 0.0),
    membrane: std('Silo_Membrane', 0x34382f, 0.85, 0.0),
    coaming: std('Hatch_Seam_Dark', 0x101113, 0.9, 0.0),
    metal: std('Mast_Metal_Dark', 0x3a3f45, 0.5, 0.55),
    glass: std('Glass_Window', 0x0f1822, 0.15, 0.7),
    prop: std('Propulsor_Metal', 0x40454b, 0.55, 0.5),
    bronze: std('Rotor_Bronze', 0x8d6f42, 0.4, 0.85),
  };

  const cache = new Map();
  const geo = (key, make) => {
    if (!cache.has(key)) {
      const g = make();
      g.name = key;
      cache.set(key, g);
    }
    return cache.get(key);
  };
  const cylG = (rt, rb, h, seg = 20) => geo(`Cyl_${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
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

  // =========================================================================
  // КОРПУС: лофт по шпангоутам, аналитические нормали
  const hullGroup = group('Hull_Group');
  const xs = [];
  for (let i = 0; i <= HULL.stations; i++) {
    const t = i / HULL.stations;
    const u = 0.45 * t + 0.55 * (0.5 - 0.5 * Math.cos(Math.PI * t)); // гуще к оконечностям
    xs.push(HULL.xEnd + (HULL.xBow - HULL.xEnd) * u);
  }
  const thetas = [];
  for (let k = 0; k <= HULL.ring; k++) thetas.push(-Math.PI / 2 + (2 * Math.PI * k) / HULL.ring); // шов по килю
  const hullSkin = (i0, i1, name) => {
    const pos = [], nrm = [], uv = [], idx = [];
    const cols = HULL.ring + 1;
    for (let i = i0; i <= i1; i++) {
      const x = xs[i];
      let arc = 0;
      let prev = null;
      for (const th of thetas) {
        const p = hullPos(x, th);
        if (prev) arc += p.distanceTo(prev);
        prev = p;
        const n = hullNormal(x, th);
        pos.push(p.x, p.y, p.z);
        nrm.push(n.x, n.y, n.z);
        uv.push(x / TILE, arc / TILE);
      }
    }
    for (let i = 0; i < i1 - i0; i++) {
      for (let k = 0; k < HULL.ring; k++) {
        const a = i * cols + k;
        idx.push(a, a + cols, a + cols + 1, a, a + cols + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.name = name;
    return g;
  };
  // Носовая часть с антенной ГАК «Иртыш-Амфора» — отдельным объектом
  const iSonar = xs.findIndex((x) => x >= 68);
  mesh(hullSkin(0, iSonar, 'Hull'), M.hull, 'Hull', hullGroup);
  mesh(hullSkin(iSonar, HULL.stations, 'Hull_Sonar_Bow'), M.sonar, 'Hull_Sonar_Bow', hullGroup);

  // Светлая полоса вдоль борта
  for (const side of [1, -1]) {
    const m = new Mesher();
    let prevRow = null;
    for (let x = 83.5; x >= -63; x -= x > 70 ? 0.4 : 1.0) {
      const th0 = thetaAtY(x, stripeY(x));
      const th = side > 0 ? th0 : Math.PI - th0;
      const dth = 0.12 / hullDTheta(x, th).length();
      const row = [th - dth, th + dth].map((t) => m.v(hullPos(x, t).addScaledVector(hullNormal(x, t), 0.02)));
      // x убывает, θ растёт: обход (x, θ) по часовой — берём обратный порядок
      if (prevRow) m.quad(prevRow[0], prevRow[1], row[1], row[0]);
      prevRow = row;
    }
    mesh(m.build('Hull_Stripe', { orient: false }), M.stripe, side > 0 ? 'Hull_Stripe_Starboard' : 'Hull_Stripe_Port', hullGroup);
  }

  // Шпигаты (отверстия для заполнения лёгкого корпуса): у 955А — короткие группы щелей
  {
    const m = new Mesher();
    const upper = [[61, 53.5], [24.5, 18], [-11, -24], [-38, -45]];
    const lower = [[48, 36], [8, -6], [-20, -34]];
    for (const side of [1, -1]) {
      const at = (x, y) => {
        const t = thetaAtY(x, y);
        return side > 0 ? t : Math.PI - t;
      };
      for (const [x0, x1] of upper) for (let x = x0; x >= x1; x -= 1.5) hullEllipse(m, x, at(x, stripeY(x) + 1.4), 0.5, 0.14);
      for (const [x0, x1] of lower) for (let x = x0; x >= x1; x -= 1.4) hullEllipse(m, x, at(x, -8.6), 0.48, 0.16);
    }
    mesh(m.build('Flood_Openings', { orient: false }), M.hole, 'Flood_Openings', hullGroup);
  }

  // Крышки носовых торпедных аппаратов (6 × 533 мм, по 3 на борт в верхней части носа)
  {
    const ta = group('TorpedoTubes', hullGroup);
    [1, -1].forEach((side) => {
      [[76.0, 1.2], [73.8, 2.5], [76.2, 3.3]].forEach(([x, y], k) => {
        const m = new Mesher();
        const t = thetaAtY(x, y);
        hullEllipse(m, x, side > 0 ? t : Math.PI - t, 0.62, 0.55, 0.02, 24);
        mesh(m.build('TT_Shutter_Seam', { orient: false }), M.coaming, `TorpedoTube_Shutter_${side > 0 ? 'S' : 'P'}${k + 1}_Seam`, ta);
        const lid = new Mesher();
        hullEllipse(lid, x, side > 0 ? t : Math.PI - t, 0.56, 0.49, 0.035, 24);
        mesh(lid.build('TT_Shutter', { orient: false }), M.sonar, `TorpedoTube_Shutter_${side > 0 ? 'S' : 'P'}${k + 1}`, ta);
      });
    });
  }

  // =========================================================================
  // РУБКА: лофт горизонтальных сечений, наклонная скруглённая передняя кромка, галтель у палубы
  const sailGroup = group('Sail');
  const sailPlan = (y) => {
    const h = (y - SAIL.deck) / (SAIL.top - SAIL.deck);
    let le = SAIL.le - 2.0 * h;
    let te = SAIL.te + 1.2 * h;
    let w = SAIL.w;
    const round = (r) => {
      const q = clamp01((y - (SAIL.top - r)) / r);
      return r * (1 - Math.sqrt(1 - q * q));
    };
    le -= round(3.2); // большое скругление передней кромки сверху
    te += round(1.2);
    w -= round(0.7);
    const f = 1 - smooth((y - SAIL.deck + 0.4) / 1.4); // галтель у палубы
    return { le: le + 1.3 * f, te: te - 0.9 * f, w: w + 0.55 * f };
  };
  const sailHalf = (t) => {
    if (t < 0.24) return Math.sqrt(1 - ((0.24 - t) / 0.24) ** 2);
    if (t < 0.55) return 1;
    return 1 - 0.8 * ((t - 0.55) / 0.45) ** 1.6;
  };
  const sailPoint = (y, t, side) => {
    const p = sailPlan(y);
    return new THREE.Vector3(p.le - t * (p.le - p.te), y, side * p.w * sailHalf(t));
  };
  {
    const levels = [];
    for (let y = SAIL.y0; y < SAIL.top - 3.2; y += 0.3) levels.push(y);
    for (let k = 0; k <= 14; k++) levels.push(SAIL.top - 3.2 * Math.cos((k / 14) * (Math.PI / 2)));
    const M2 = 26;
    const ts = [];
    for (let j = 0; j <= M2; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M2));
    const rings = levels.map((y) => {
      const ring = ts.map((t) => sailPoint(y, t, 1));
      for (let j = M2; j >= 1; j--) ring.push(sailPoint(y, ts[j], -1));
      return ring;
    });
    mesh(loftRings('Sail_Body', rings), M.hull, 'Sail_Body', sailGroup);
  }
  // Ограждение мостика, люк спасательной камеры, окна ходового мостика
  {
    const top = SAIL.top;
    const plateG = (name, x0, x1, hw, h) => geo(name, () => new THREE.BoxGeometry(x1 - x0, h, hw * 2));
    mesh(plateG('Sail_Bridge_Well', 37.4, 38.8, 0.7, 0.04), M.hole, 'Sail_Bridge_Opening', sailGroup, 38.1, top + 0.02, 0);
    const ring = geo('Sail_Hatch_Ring', () => new THREE.RingGeometry(0.95, 1.05, 40).rotateX(-Math.PI / 2));
    mesh(ring, M.coaming, 'Sail_RescueChamber_Seam', sailGroup, 24.7, top + 0.02, 0);
    // окна в скруглённой передней части рубки
    const m = new Mesher();
    for (const side of [1, -1]) {
      for (const [t0, t1] of [[0.04, 0.085], [0.1, 0.145], [0.16, 0.205]]) {
        const y0 = top - 1.25;
        const y1 = top - 0.85;
        const quad = [[t0, y0], [t1, y0], [t1, y1], [t0, y1]].map(([t, y]) => {
          const p = sailPoint(y, t, side);
          return p.add(new THREE.Vector3(0.6 * (1 - t * 3), 0, side).normalize().multiplyScalar(0.03));
        });
        const ids = quad.map((p) => m.v(p));
        if (side > 0) m.quad(ids[0], ids[3], ids[2], ids[1]);
        else m.quad(ids[0], ids[1], ids[2], ids[3]);
      }
    }
    const win = m.build('Sail_Windows', { orient: false });
    mesh(win, M.glass, 'Sail_Windows', sailGroup);
  }

  // Выдвижные устройства в поднятом положении
  const masts = group('Masts', sailGroup);
  {
    const top = SAIL.top;
    const mast = (name, x, r, h, head) => {
      const g = group(name, masts, x, top, 0);
      mesh(cylG(r + 0.14, r + 0.2, 0.25, 24), M.metal, `${name}_Collar`, g, 0, 0.12, 0);
      mesh(cylG(r, r, h, 20), M.metal, `${name}_Tube`, g, 0, h / 2, 0);
      head(g, h);
      return g;
    };
    mast('Mast_Periscope_Attack', 36.6, 0.2, 6.6, (g, h) => {
      mesh(cylG(0.14, 0.2, 1.0, 16), M.metal, 'Periscope_Head', g, 0, h + 0.5, 0);
      mesh(geo('Periscope_Window', () => new THREE.BoxGeometry(0.1, 0.22, 0.2)), M.glass, 'Periscope_Window', g, 0.14, h + 0.7, 0);
    });
    mast('Mast_Optronic', 34.6, 0.3, 5.4, (g, h) => {
      mesh(cylG(0.42, 0.42, 1.0, 24), M.metal, 'Optronic_Head', g, 0, h + 0.5, 0);
      mesh(geo('Optronic_Window', () => new THREE.BoxGeometry(0.12, 0.35, 0.45)), M.glass, 'Optronic_Window', g, 0.39, h + 0.55, 0);
      mesh(geo('Optronic_Cap', () => new THREE.SphereGeometry(0.42, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2)), M.metal, 'Optronic_Cap', g, 0, h + 1.0, 0);
    });
    mast('Mast_Radar', 32.2, 0.28, 3.4, (g, h) => {
      mesh(geo('Radar_Antenna', () => new THREE.BoxGeometry(0.4, 0.55, 2.0)), M.metal, 'Radar_Antenna', g, 0, h + 0.25, 0);
      mesh(geo('Radar_Face', () => new THREE.BoxGeometry(0.04, 0.4, 1.8)), M.glass, 'Radar_Face', g, 0.21, h + 0.25, 0);
    });
    mast('Mast_Comms', 29.7, 0.22, 7.6, (g, h) => {
      mesh(cylG(0.3, 0.3, 0.9, 20), M.metal, 'Comms_Radome', g, 0, h + 0.45, 0);
      mesh(cylG(0.03, 0.06, 2.4, 8), M.metal, 'Comms_Whip', g, 0, h + 2.1, 0);
    });
    mast('Mast_ESM', 27.7, 0.26, 7.0, (g, h) => {
      mesh(cylG(0.45, 0.45, 0.7, 24), M.metal, 'ESM_Drum', g, 0, h + 0.35, 0);
      mesh(cylG(0.05, 0.45, 0.6, 24), M.metal, 'ESM_Cone', g, 0, h + 1.0, 0);
    });
  }

  // =========================================================================
  // РАКЕТНАЯ ПАЛУБА: 16 шахт Р-30 «Булава», крышки на шарнире у борта
  const deck = group('MissileDeck');
  const hatchFor = (side) => {
    const zc = side * SILO.z;
    const zh = side * (SILO.z + SILO.r + 0.05); // ось шарнира — у наружной кромки
    const yh = hullTopY(0, zh) + 0.06;
    // Крышка: верх повторяет погибь палубы, юбка уходит под обшивку
    const m = new Mesher();
    const seg = 48;
    const rr = [0, 0.4, 0.8, 1.0];
    const P = (r, a, dy) => {
      const x = r * SILO.r * Math.cos(a);
      const z = zc + r * SILO.r * Math.sin(a);
      return new THREE.Vector3(x, hullTopY(0, z) + dy - yh, z - zh);
    };
    const uv = (p) => [p.x / TILE, (p.z + zh) / TILE];
    const ringIds = (r, dy) => {
      const ids = [];
      for (let j = 0; j < seg; j++) {
        const p = P(r, (j / seg) * Math.PI * 2, dy);
        ids.push(m.v(p, ...uv(p)));
      }
      return ids;
    };
    const fanCenter = (dy, ring) => {
      const p = P(0, 0, dy);
      const c = m.v(p, ...uv(p));
      for (let j = 0; j < seg; j++) m.tri(c, ring[j], ring[(j + 1) % seg]);
    };
    const fanUp = (dy, ring) => {
      const p = P(0, 0, dy);
      const c = m.v(p, ...uv(p));
      for (let j = 0; j < seg; j++) m.tri(c, ring[(j + 1) % seg], ring[j]);
    };
    // верх
    const topRings = rr.slice(1).map((r) => ringIds(r, 0.07 + 0.03 * (1 - r)));
    fanUp(0.1, topRings[0]);
    for (let i = 0; i < topRings.length - 1; i++) m.strip(topRings[i + 1], topRings[i]);
    // юбка (свои вершины — острая кромка) и низ
    const edgeTop = ringIds(1, 0.07);
    const edgeBot = ringIds(1, -0.12);
    m.strip(edgeBot, edgeTop);
    const bot = ringIds(1, -0.12);
    fanCenter(-0.1, bot);
    const lid = m.build(`Hatch_Lid_${side > 0 ? 'S' : 'P'}`);
    // проушины шарнира
    const knuckles = [-0.55, 0.55].map((x) => new THREE.CylinderGeometry(0.08, 0.08, 0.36, 12).rotateZ(Math.PI / 2).translate(x, -0.04, 0));
    const lidFull = merge([lid, ...knuckles]);
    lidFull.name = lid.name;
    // Проём шахты: тёмное кольцо, светлая мембрана, шов вокруг крышки
    const mk = (name, r0, r1, off) => {
      const d = new Mesher();
      deckDisk(d, 0, zc, r0, r1, off);
      return d.build(name, { orient: false });
    };
    return {
      zh, yh, lid: lidFull,
      bore: mk(`Silo_Bore_${side > 0 ? 'S' : 'P'}`, 0.88, SILO.r - 0.02, 0.02),
      membrane: mk(`Silo_Membrane_${side > 0 ? 'S' : 'P'}`, 0.001, 0.9, 0.025),
      seam: mk(`Silo_Seam_${side > 0 ? 'S' : 'P'}`, SILO.r - 0.01, SILO.r + 0.08, 0.02),
    };
  };
  const H = { 1: hatchFor(1), [-1]: hatchFor(-1) };
  const hatches = [];
  SILO.xs.forEach((x, row) => {
    [-1, 1].forEach((side, k) => {
      const n = String(row * 2 + k + 1).padStart(2, '0');
      const h = H[side];
      const s = group(`Silo_${n}`, deck, x, 0, 0);
      mesh(h.bore, M.silo, `Silo_${n}_Bore`, s);
      mesh(h.membrane, M.membrane, `Silo_${n}_Membrane`, s);
      mesh(h.seam, M.coaming, `Silo_${n}_Seam`, s);
      const pivot = group(`Hatch_Silo_${n}`, s, 0, h.yh, h.zh);
      mesh(h.lid, M.hull, `Hatch_Silo_${n}_Lid`, pivot);
      hatches.push({ pivot, side, order: row * 2 + k });
    });
  });
  // Входные люки по диаметральной плоскости
  {
    const lidG = (x) => {
      const m = new Mesher();
      deckDisk(m, x, 0, 0.001, 0.6, 0.05, 32, 2);
      return m.build('Access_Hatch_Lid', { orient: false });
    };
    const seamG = (x) => {
      const m = new Mesher();
      deckDisk(m, x, 0, 0.6, 0.68, 0.03, 32, 1);
      return m.build('Access_Hatch_Seam', { orient: false });
    };
    [[50, 'Fwd'], [-23, 'Aft_1'], [-36, 'Aft_2']].forEach(([x, n]) => {
      mesh(lidG(x), M.hull, `Hatch_Access_${n}`, deck);
      mesh(seamG(x), M.coaming, `Hatch_Access_${n}_Seam`, deck);
    });
  }

  // =========================================================================
  // НОСОВЫЕ ГОРИЗОНТАЛЬНЫЕ РУЛИ (убираемые), показаны выдвинутыми
  const bowPlanes = group('BowPlanes');
  {
    const xp = 70.5;
    const yp = -4.2;
    const g = finGeometry('BowPlane', { root: [1.3, -2.3], tip: [0.7, -1.4], span: 3.2, tc: 0.11, tipTc: 0.09, y0: -0.4 });
    const rec = new Mesher();
    [1, -1].forEach((side) => {
      const t = thetaAtY(xp, yp);
      const th = side > 0 ? t : Math.PI - t;
      const root = hullPos(xp, th);
      const pv = group(side > 0 ? 'BowPlane_Starboard' : 'BowPlane_Port', bowPlanes, xp, yp, root.z);
      pv.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh(g, M.hull, `${pv.name}_Blade`, pv);
      hullEllipse(rec, xp - 0.5, th, 2.1, 0.32, 0.02, 20); // щель ниши
    });
    mesh(rec.build('BowPlane_Recess', { orient: false }), M.hole, 'BowPlane_Recesses', bowPlanes);
  }

  // =========================================================================
  // КОРМОВОЕ ОПЕРЕНИЕ
  const stern = group('Stern');
  const yc = HULL.yc;
  // Подвижная часть пера на своём шарнире: geometry с отрезанной долей хорды, ось — по линии шарнира
  const movable = (name, parent, opts, hingeFrac) => {
    const rootHinge = lerp(opts.root[0], opts.root[1], hingeFrac);
    const g = finGeometry(name, { ...opts, from: hingeFrac + 0.01, to: 1 });
    g.translate(-rootHinge, 0, 0);
    const pv = group(name, parent, rootHinge, 0, 0);
    mesh(g, M.hull, `${name}_Blade`, pv);
    return pv;
  };
  // Верхний вертикальный стабилизатор с рулём и гондолой буксируемой антенны
  {
    const g = group('Rudder_Upper', stern, 0, -1.5, 0);
    const opts = { root: [-55, -72.6], tip: [-63.2, -71.4], span: 10.1, tc: 0.1, tipTc: 0.085, nSpan: 10 };
    mesh(finGeometry('Fin_Upper', { ...opts, to: 0.7 }), M.hull, 'Rudder_Upper_Fin', g);
    movable('Rudder_Upper_Flap', g, opts, 0.7);
    const pod = revolveX('TowedArray_Pod', [[-61.4, 0.001], [-61.6, 0.18], [-62.2, 0.32], [-63.2, 0.38], [-70.2, 0.38], [-71.4, 0.3], [-72.2, 0.1], [-72.4, 0.001]], 24);
    mesh(pod, M.hull, 'TowedArray_Pod', g, 0, 10.1, 0);
  }
  // Нижний вертикальный стабилизатор
  {
    const g = group('Rudder_Lower', stern, 0, -5.0, 0);
    g.rotation.x = Math.PI;
    const opts = { root: [-58, -72.6], tip: [-64.5, -72.2], span: 4.8, tc: 0.1, tipTc: 0.09, nSpan: 6 };
    mesh(finGeometry('Fin_Lower', { ...opts, to: 0.7 }), M.hull, 'Rudder_Lower_Fin', g);
    movable('Rudder_Lower_Flap', g, opts, 0.7);
  }
  // Горизонтальные стабилизаторы с кормовыми рулями и наклонными концевыми шайбами
  {
    const sp = group('SternPlanes', stern);
    const opts = { root: [-59.5, -72.6], tip: [-66.0, -72.6], span: 8.4, tc: 0.1, tipTc: 0.08, nSpan: 10 };
    const fixedG = finGeometry('Stabilizer', { ...opts, to: 0.7 });
    const endG = finGeometry('Stabilizer_Endfin', { root: [-68.0, -72.8], tip: [-66.9, -71.9], span: 3.6, tc: 0.1, tipTc: 0.07, nSpan: 6 });
    [1, -1].forEach((side) => {
      const nm = side > 0 ? 'Starboard' : 'Port';
      const g = group(`Stabilizer_${nm}`, sp, 0, yc, 0);
      g.rotation.x = side * Math.PI / 2; // локальная +Y (размах) -> ±Z
      mesh(fixedG, M.hull, `Stabilizer_${nm}_Fixed`, g);
      movable(`SternPlane_${nm}`, g, opts, 0.7);
      // концевая шайба: в основном вниз, низ отведён наружу
      const e = group(`Stabilizer_Endfin_${nm}`, sp);
      const cant = THREE.MathUtils.degToRad(24);
      e.rotation.x = -side * cant;
      const up = new THREE.Vector3(0, Math.cos(cant), -side * Math.sin(cant));
      e.position.set(0, yc, side * 8.25).addScaledVector(up, -2.5);
      mesh(endG, M.hull, `Stabilizer_Endfin_${nm}_Blade`, e);
    });
  }

  // =========================================================================
  // ВОДОМЁТНЫЙ ДВИЖИТЕЛЬ: насадка, статор, ротор, ступица с обтекателем
  const prop = group('Propulsor', sub, 0, yc, 0);
  {
    // Насадка — кольцевое крыло
    const duct = [];
    const N = 22;
    const ductR = (t) => 3.3 - 0.35 * t;
    const ductTh = (t) => naca(t) * 0.06 * 7.0;
    for (let k = 0; k <= N; k++) {
      const t = 0.5 - 0.5 * Math.cos((Math.PI * k) / N);
      duct.push([-73.6 - 7.0 * t, ductR(t) + Math.max(0.015, ductTh(t))]);
    }
    for (let k = N - 1; k >= 1; k--) {
      const t = 0.5 - 0.5 * Math.cos((Math.PI * k) / N);
      duct.push([-73.6 - 7.0 * t, ductR(t) - Math.max(0.015, ductTh(t))]);
    }
    mesh(revolveX('Propulsor_Duct', duct, 72, { closed: true }), M.hull, 'Propulsor_Duct', prop);
    // Неподвижная ступица и кормовой обтекатель
    const hub = [[-75.0, 1.9], [-75.8, 1.84], [-76.6, 1.76], [-76.7, 1.6]];
    mesh(revolveX('Propulsor_Hub', hub, 48), M.prop, 'Propulsor_Hub', prop);
    const cone = [];
    for (let k = 0; k <= 16; k++) {
      const p = k / 16;
      cone.push([-78.5 - 6.4 * p, Math.max(0.001, 1.62 * (1 - p ** 1.7) ** 0.75)]);
    }
    mesh(revolveX('Propulsor_Cone', [[-78.5, 1.5], ...cone], 48), M.hull, 'Propulsor_Cone', prop);
    // Направляющий аппарат (статор) перед ротором
    const stator = group('Propulsor_Stator', prop);
    const vane = bladeGeometry('Stator_Vane', { r0: 1.7, r1: 3.15, chord0: 1.0, chord1: 0.9, pitch: 60, tc: 0.1, n: 5 });
    for (let b = 0; b < 11; b++) {
      const v = mesh(vane, M.prop, `Stator_Vane_${b + 1}`, stator, -74.9, 0, 0);
      v.rotation.x = (b / 11) * Math.PI * 2;
    }
    // Ротор
    const rotor = group('Propulsor_Rotor', prop, -77.6, 0, 0);
    mesh(revolveX('Rotor_Hub', [[0.95, 1.68], [0.6, 1.74], [-0.6, 1.72], [-0.95, 1.62]], 48), M.bronze, 'Rotor_Hub', rotor);
    const blade = bladeGeometry('Rotor_Blade', { r0: 1.6, r1: 2.86, chord0: 1.2, chord1: 1.0, pitch: 7.5, skew: 0.35, tc: 0.07, n: 8 });
    for (let b = 0; b < 9; b++) {
      const bl = mesh(blade, M.bronze, `Rotor_Blade_${b + 1}`, rotor);
      bl.rotation.x = (b / 9) * Math.PI * 2;
    }
  }

  // =========================================================================
  // Уникальные имена узлов (Blender не любит одинаковые)
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
  const rotor = sub.getObjectByName('Propulsor_Rotor');
  const rotorPeriod = 2; // с на оборот
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const spin = (() => {
    const steps = 8; // шаг 45° — slerp идёт по короткой дуге
    const times = [];
    const values = [];
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * rotorPeriod;
      times.push(t);
      q.setFromEuler(e.set((-2 * Math.PI * t) / rotorPeriod, 0, 0));
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.AnimationClip('Propulsor_Spin', rotorPeriod, [new THREE.QuaternionKeyframeTrack(`${rotor.name}.quaternion`, times, values)]);
  })();
  // Крышки открываются парами от носа к корме, держатся открытыми и закрываются
  const hatchClip = (() => {
    const duration = 12;
    const tracks = hatches.map(({ pivot, side, order }) => {
      const t0 = 0.5 + 0.2 * order;
      const times = [0, t0, t0 + 1.6, 8 + 0.1 * order, 9.6 + 0.1 * order, duration];
      const amounts = [0, 0, 1, 1, 0, 0];
      const values = [];
      for (const a of amounts) {
        q.setFromEuler(e.set(side * SILO.open * a, 0, 0));
        values.push(q.x, q.y, q.z, q.w);
      }
      return new THREE.QuaternionKeyframeTrack(`${pivot.name}.quaternion`, times, values);
    });
    return new THREE.AnimationClip('SiloHatches_Open', duration, tracks);
  })();
  sub.animations = [spin, hatchClip];

  sub.userData.update = (time) => {
    rotor.rotation.x = (-2 * Math.PI * time) / rotorPeriod;
  };
  sub.userData.setHatches = (amount) => {
    const a = clamp01(amount);
    for (const { pivot, side } of hatches) pivot.rotation.x = side * SILO.open * a;
  };

  return sub;
}
