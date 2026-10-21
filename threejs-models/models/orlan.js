import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Тяжёлый атомный ракетный крейсер проекта 1144 «Орлан» — «Пётр Великий» (бортовой 099).
// Масштаб 1:1 в метрах. Ось Y вверх, ватерлиния y = 0, нос смотрит в +X,
// начало координат — мидель на диаметральной плоскости. Правый борт — +Z, левый — −Z.
// Корпус строится лофтом по шпангоутам в BufferGeometry, надстройки — призмы с наклонными
// стенками, вооружение — отдельные функции-сборщики, чтобы легко собрать другой корабль серии.

// Состав вооружения «Петра Великого» (пр. 1144.2). Для «Адмирала Нахимова» и др. — свой объект.
export const FIT_PETR_VELIKY = {
  name: 'ПЁТР ВЕЛИКИЙ',
  hullNumber: '099',
  granit: 20, // ПКР П-700 «Гранит» под палубой бака
  fort: { s300f: 6, s300fm: 6 }, // револьверные ПУ Б-203А «Форт» / «Форт-М»
  kinzhal: { fore: 8, aft: 8 }, // ЗРК «Кинжал», барабанные ПУ по 8 ракет
  kortik: 6, // ЗРАК «Кортик»
  mainGun: 'AK130', // спаренная 130-мм АУ АК-130 в корме
  udav: true, // РКПТЗ «Удав-1» на баке
  rbu1000: 2, // РБУ-1000 в корме
  torpedoTubes: 10, // 2 × 5 ТА за бортовыми щитами
  topDome: 2, // РЛС управления «Форт» (Top Dome) — нос и корма
};

// Все размеры корпуса в одном месте
const HULL = {
  xBow: 126, // форштевень на уровне палубы
  xWL: 113, // форштевень на ватерлинии
  xFoot: 92, // начало подъёма киля к форштевню
  xStern: -122.5, // транец на ватерлинии
  wl: 12.2, // полуширина по ватерлинии
  deck: 14.25, // полуширина по палубе (развал бортов)
  rowsBelow: 20,
  rowsAbove: 18,
  stations: 260,
};

const smooth = (t) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Отметка палубы (седловатость: бак поднимается к форштевню)
export function deckY(x) {
  if (x > 35) return 10.6 + 6.0 * ((x - 35) / 91) ** 2;
  if (x < -40) return 10.6 - 1.4 * smooth((-40 - x) / 83);
  return 10.6;
}
const deckSlope = (x) => (deckY(x + 0.5) - deckY(x - 0.5)) / 1;

// Линия киля: плоский киль в середине, подъём в корме под винты и к форштевню
function keelY(x) {
  if (x < -45) return -10 + 9.3 * smooth((-45 - x) / 77.5);
  if (x > 60) return -10 + 1.0 * smooth((x - 60) / 32);
  return -10;
}

// Полнота шпангоута ниже ватерлинии: V в носу, U в середине, плоское днище в корме
function sectionN(x) {
  if (x > 20) return 3 - 1.5 * smooth((x - 20) / 85);
  if (x < -30) return 3 + 3 * smooth((-30 - x) / 80);
  return 3;
}

function foreTaper(x, xf, a, b) {
  const xs = 0;
  if (x <= xs) return 1;
  const q = Math.min(1, (x - xs) / (xf - xs));
  return Math.max(0, 1 - q ** a) ** b;
}
function aftTaper(x, xa, tf) {
  const xt = -35;
  if (x >= xt) return 1;
  const p = Math.min(1, (xt - x) / (xt - xa));
  return 1 - (1 - tf) * p * p;
}

// Параметры «ватерлинии» (горизонтального ряда) корпуса: j от киля до палубы
function hullRow(j) {
  const nb = HULL.rowsBelow;
  if (j <= nb) {
    const r = j / nb;
    return { below: true, r, s: 0, xf: HULL.xFoot + (HULL.xWL - HULL.xFoot) * (1 - (1 - r) ** 2.2), xa: HULL.xStern };
  }
  const s = (j - nb) / HULL.rowsAbove;
  return { below: false, r: 1, s, xf: HULL.xWL + (HULL.xBow - HULL.xWL) * s ** 1.15, xa: HULL.xStern - 0.8 * s };
}

// Точка борта: высота y и полуширина для сечения x на ряду row
function hullPoint(x, row) {
  if (row.below) {
    const rr = 1 - row.r;
    const n = sectionN(x);
    const wl = HULL.wl * foreTaper(x, row.xf, 1.8, 0.85) * aftTaper(x, row.xa, 0.82);
    return { y: keelY(x) * rr, hw: wl * Math.max(0, 1 - rr ** n) ** (1 / n) };
  }
  const s = row.s;
  const w = HULL.wl + (HULL.deck - HULL.wl) * s ** 1.3;
  return { y: deckY(x) * s, hw: w * foreTaper(x, row.xf, 1.8 + 1.3 * s, 0.85 - 0.4 * s) * aftTaper(x, row.xa, 0.82) };
}

// Полуширина палубы в сечении x (нужна для лееров и размещения оборудования)
export function deckHalfWidth(x) {
  return hullPoint(x, hullRow(HULL.rowsBelow + HULL.rowsAbove)).hw;
}

// ---------------------------------------------------------------------------
// Геометрические помощники

// Призма с наклонными стенками: нижний многоугольник [x, z], верхний — сжат/смещён.
// Группа 0 — стенки и дно, группа 1 — крыша (можно покрасить в цвет палубы).
function loftPrism(poly, height, { topScale = [1, 1], topShift = [0, 0], topPoly = null } = {}) {
  const top = topPoly || poly.map(([x, z]) => [x * topScale[0] + topShift[0], z * topScale[1] + topShift[1]]);
  const pos = [];
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const center = new THREE.Vector3(cx, height / 2, cz);
  const tri = (a, b, c) => {
    // Проверяем направление нормали наружу (все призмы выпуклые)
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const m = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
    if (n.dot(m) < 0) [b, c] = [c, b];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const B = poly.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const T = top.map(([x, z]) => new THREE.Vector3(x, height, z));
  for (let i = 0; i < poly.length; i++) {
    const k = (i + 1) % poly.length;
    tri(B[i], B[k], T[k]);
    tri(B[i], T[k], T[i]);
  }
  const capTris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [a, b, c] of capTris) tri(B[a], B[b], B[c]);
  const sideCount = pos.length / 3;
  for (const [a, b, c] of capTris) tri(T[a], T[b], T[c]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.addGroup(0, sideCount, 0);
  g.addGroup(sideCount, pos.length / 3 - sideCount, 1);
  return g;
}

// Прямоугольник со скошенными углами (носовые кромки надстроек)
function chamferRect(x0, x1, hw, cf = 0, ca = 0) {
  return [
    [x1, -hw + cf], [x1, hw - cf], [x1 - cf, hw], [x0 + ca, hw], [x0, hw - ca], [x0, -hw + ca], [x0 + ca, -hw], [x1 - cf, -hw],
  ].filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]);
}

// Тонкий брус между двумя точками (поручни, стойки, распорки) — для слияния в одну сетку
function beamBetween(a, b, w, h = w) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(b, a, Math.abs(b.x - a.x) + Math.abs(b.z - a.z) < 1e-4 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

function stripForMerge(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => mergeGeometries(list.map(stripForMerge));

// Леер: стойки через ~2.5 м и два поручня вдоль ломаной path (точки на уровне палубы)
function railingGeometry(path, { closed = false, height = 1.1, spacing = 2.5 } = {}) {
  const parts = [];
  const pts = closed ? [...path, path[0]] : path;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = a.distanceTo(b);
    if (len < 1e-3) continue;
    const n = Math.max(1, Math.round(len / spacing));
    for (let k = 0; k < n; k++) {
      const p = a.clone().lerp(b, k / n);
      parts.push(beamBetween(p, p.clone().setY(p.y + height), 0.06));
    }
    for (const h of [height * 0.5, height]) {
      parts.push(beamBetween(a.clone().setY(a.y + h), b.clone().setY(b.y + h), 0.045));
    }
  }
  if (!closed) {
    const last = pts[pts.length - 1];
    parts.push(beamBetween(last, last.clone().setY(last.y + height), 0.06));
  }
  return merge(parts);
}

// Надпись/разметка, нарисованная на canvas (в glb попадёт как встроенный PNG)
function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------

export function createOrlan({ fit = FIT_PETR_VELIKY } = {}) {
  const ship = new THREE.Group();
  ship.name = 'Orlan_PyotrVelikiy';

  const std = (name, color, roughness = 0.7, metalness = 0.15, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const M = {
    hull: std('Hull_Grey', 0x9aa3a9, 0.75, 0.2),
    superGrey: std('Superstructure_Grey', 0xaeb6bb, 0.7, 0.15),
    deck: std('Deck_Red', 0x5c1f1e, 0.85, 0.05),
    boot: std('Boot_Red', 0x7c2a24, 0.7, 0.1),
    hatch: std('Hatch_Grey', 0xbfc5c8, 0.6, 0.2),
    lid: std('VLS_Lid_Grey', 0xa5adb2, 0.55, 0.25),
    radome: std('Radome_White', 0xf2f3f1, 0.45, 0.0),
    metal: std('Metal_Dark', 0x3b4046, 0.5, 0.6),
    antenna: std('Antenna_Grey', 0x8d969c, 0.55, 0.5, { side: THREE.DoubleSide }),
    glass: std('Glass_Window', 0x1b2630, 0.15, 0.6),
    black: std('Black_Paint', 0x1a1c1e, 0.8, 0.1),
    bronze: std('Propeller_Bronze', 0xb08a4a, 0.35, 0.9),
    boat: std('Boat_White', 0xe6e8e6, 0.5, 0.05),
    orange: std('Raft_White', 0xe9ece9, 0.6, 0.0),
    rail: std('Railing_Grey', 0xc4cacd, 0.6, 0.3),
  };
  const roofMats = [M.superGrey, M.deck];

  // Кэш геометрий: одинаковые детали ссылаются на одну BufferGeometry
  const cache = new Map();
  const geo = (key, make) => {
    if (!cache.has(key)) {
      const g = make();
      g.name = key;
      cache.set(key, g);
    }
    return cache.get(key);
  };
  const boxG = (w, h, d) => geo(`Box_${w}x${h}x${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cylG = (rt, rb, h, seg = 16) => geo(`Cyl_${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const sphG = (r, ws = 20, hs = 12) => geo(`Sphere_${r}_${ws}`, () => new THREE.SphereGeometry(r, ws, hs));
  const domeG = (r, ws = 24) => geo(`Dome_${r}`, () => new THREE.SphereGeometry(r, ws, 16, 0, Math.PI * 2, 0, Math.PI / 2));

  const mesh = (g, mat, name, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const group = (name, parent = ship, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  // Поставить объект на палубу с учётом седловатости
  const onDeck = (obj, x, z, dy = 0) => {
    obj.position.set(x, deckY(x) + dy, z);
    obj.rotation.z = Math.atan(deckSlope(x));
    return obj;
  };
  // Блок надстройки: x0..x1, полуширина hw, низ y0, высота h
  const block = (name, parent, x0, x1, hw, y0, h, { cf = 0, ca = 0, inset = 0.3, roof = true, mat = null } = {}) => {
    const poly = chamferRect(x0, x1, hw, cf, ca);
    const sx = ((x1 - x0) / 2 - inset) / ((x1 - x0) / 2);
    const sz = (hw - inset) / hw;
    const cx = (x0 + x1) / 2;
    const g = loftPrism(poly, h, { topScale: [sx, sz], topShift: [cx * (1 - sx), 0] });
    return mesh(g, mat || (roof ? roofMats : [M.superGrey, M.superGrey]), name, parent, 0, y0, 0);
  };

  const rotating = []; // { obj, period } — вращающиеся антенны РЛС

  // =========================================================================
  // КОРПУС: лофт по шпангоутам
  const hullGroup = group('Hull_Group');
  const nRows = HULL.rowsBelow + HULL.rowsAbove;
  const nU = HULL.stations;
  const grid = []; // grid[j][i] = { x, y, hw }
  for (let j = 0; j <= nRows; j++) {
    const row = hullRow(j);
    const line = [];
    for (let i = 0; i <= nU; i++) {
      const t = i / nU;
      const u = 0.55 * t + 0.45 * (0.5 - 0.5 * Math.cos(Math.PI * t));
      const x = row.xa + (row.xf - row.xa) * u;
      const p = hullPoint(x, row);
      line.push({ x, y: p.y, hw: p.hw });
    }
    grid.push(line);
  }

  // Обшивка между рядами j0..j1, оба борта, плюс кусок транца
  const skin = (j0, j1) => {
    const pos = [];
    const idx = [];
    const cols = nU + 1;
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let j = j0; j <= j1; j++) for (const p of grid[j]) pos.push(p.x, p.y, side * p.hw);
      for (let j = 0; j < j1 - j0; j++) {
        for (let i = 0; i < nU; i++) {
          const a = base + j * cols + i;
          const b = a + 1;
          const c = a + cols + 1;
          const d = a + cols;
          if (side > 0) idx.push(a, b, c, a, c, d);
          else idx.push(a, c, b, a, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Транец: полосы между правым и левым бортом на кормовом шпангоуте
    const tp = [];
    for (let j = j0; j < j1; j++) {
      const s0 = grid[j][0];
      const s1 = grid[j + 1][0];
      const S0 = [s0.x, s0.y, s0.hw];
      const S1 = [s1.x, s1.y, s1.hw];
      const P0 = [s0.x, s0.y, -s0.hw];
      const P1 = [s1.x, s1.y, -s1.hw];
      tp.push(...S0, ...S1, ...P1, ...S0, ...P1, ...P0);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tg.computeVertexNormals();
    const merged = mergeGeometries([g.toNonIndexed(), tg]);
    // Сглаженные нормали борта + плоские нормали транца
    return merged;
  };
  const hullAbove = mesh(skin(HULL.rowsBelow, nRows), M.hull, 'Hull', hullGroup);
  const hullBelow = mesh(skin(0, HULL.rowsBelow), M.boot, 'Hull_Underwater', hullGroup);

  // Главная палуба — полоса между кромками бортов
  {
    const top = grid[nRows];
    const pos = [];
    for (let i = 0; i < nU; i++) {
      const a = top[i];
      const b = top[i + 1];
      pos.push(a.x, a.y, a.hw, b.x, b.y, b.hw, b.x, b.y, -b.hw, a.x, a.y, a.hw, b.x, b.y, -b.hw, a.x, a.y, -a.hw);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    mesh(g, M.deck, 'Deck_Main', hullGroup);
  }

  // Носовой бульб с ГАК «Полином»: тело вращения вдоль X
  {
    const prof = [];
    const len = 26;
    for (let k = 0; k <= 32; k++) {
      const t = k / 32; // 0 — нос, 1 — корма бульба
      const r = t < 0.4 ? Math.sin((t / 0.4) * Math.PI / 2) ** 0.6 : 1 - 0.15 * ((t - 0.4) / 0.6) ** 2;
      prof.push(new THREE.Vector2(Math.max(0.001, r * 3.4), -t * len));
    }
    prof[0].x = 0;
    const g = new THREE.LatheGeometry(prof.reverse(), 28);
    g.rotateZ(-Math.PI / 2); // ось Y -> X (нос в +X)
    g.scale(1, 1.15, 0.92);
    mesh(g, M.boot, 'Sonar_Dome', hullGroup, 115, -5.2, 0);
  }
  // Брусковый киль
  mesh(boxG(150, 0.6, 0.8), M.boot, 'Keel', hullGroup, 5, -10.1, 0);

  // Скуловые кили: тонкие полосы по нормали к обшивке в районе скулы
  {
    const below = { below: true, r: 0.22, xf: HULL.xWL, xa: HULL.xStern };
    for (const side of [1, -1]) {
      const pos = [];
      const pts = [];
      for (let x = -55; x <= 45; x += 2.5) {
        const p = hullPoint(x, below);
        const q = hullPoint(x, { ...below, r: 0.24 });
        const nrm = new THREE.Vector2(-(q.hw - p.hw), q.y - p.y).normalize(); // нормаль к контуру: (y, z)
        if (nrm.y < 0) nrm.negate();
        pts.push([x, p.y, p.hw, nrm]);
      }
      const depth = (i) => 0.9 * Math.min(1, i / 4, (pts.length - 1 - i) / 4);
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0, z0, n0] = pts[i];
        const [x1, y1, z1, n1] = pts[i + 1];
        const a = [x0, y0, side * z0];
        const b = [x1, y1, side * z1];
        const c = [x1, y1 + n1.x * depth(i + 1), side * (z1 + n1.y * depth(i + 1))];
        const d = [x0, y0 + n0.x * depth(i), side * (z0 + n0.y * depth(i))];
        // две стороны полосы
        pos.push(...a, ...b, ...c, ...a, ...c, ...d, ...a, ...c, ...b, ...a, ...d, ...c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      mesh(g, M.boot, side > 0 ? 'Bilge_Keel_Starboard' : 'Bilge_Keel_Port', hullGroup);
    }
  }

  // Луч к обшивке снаружи: точка и нормаль на борту side (+1 правый, −1 левый)
  ship.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const hullHit = (x, y, side) => {
    ray.set(new THREE.Vector3(x, y, side * 40), new THREE.Vector3(0, 0, -side));
    const hit = ray.intersectObjects([hullAbove, hullBelow], false)[0];
    if (!hit) return { point: new THREE.Vector3(x, y, side * deckHalfWidth(x)), normal: new THREE.Vector3(0, 0, side) };
    const normal = hit.face.normal.clone();
    return { point: hit.point, normal };
  };
  const alignTo = (obj, normal) => obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

  // Бортовой номер «099»: декаль, повторяющая развал борта
  const numberTex = canvasTexture(1024, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#f4f4f0';
    c.font = 'bold 400px "Arial Narrow", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.save();
    c.translate(w / 2, h / 2 + 20);
    c.scale(0.95, 1);
    c.fillText(fit.hullNumber, 0, 0);
    c.restore();
  });
  const numberMat = std('Hull_Number_099', 0xffffff, 0.6, 0.0, { map: numberTex, transparent: true, alphaTest: 0.3 });
  const hullDecal = (name, cx, cy, w, h, side, mat) => {
    const nx = 16;
    const ny = 8;
    const pos = [];
    const uv = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = cx - side * (w / 2) + side * (w * i) / nx;
        const y = cy - h / 2 + (h * j) / ny;
        const { point, normal } = hullHit(x, y, side);
        point.addScaledVector(normal, 0.05);
        pos.push(point.x, point.y, point.z);
        uv.push(i / nx, j / ny);
      }
    }
    const idx = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return mesh(g, mat, name, hullGroup);
  };
  hullDecal('Hull_Number_Starboard', 86, 9.2, 15, 7.5, 1, numberMat);
  hullDecal('Hull_Number_Port', 86, 9.2, 15, 7.5, -1, numberMat);

  // Название на транце
  {
    const tex = canvasTexture(1024, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#e8e2c8';
      c.font = 'bold 92px Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(fit.name, w / 2, h / 2 + 4);
    });
    const mat = std('Stern_Name', 0xffffff, 0.6, 0.0, { map: tex, transparent: true, alphaTest: 0.3 });
    const g = new THREE.PlaneGeometry(16, 2);
    g.rotateY(-Math.PI / 2);
    const y = 6.6;
    const x = HULL.xStern - 0.8 * (y / deckY(HULL.xStern)) - 0.06;
    mesh(g, mat, 'Stern_Name', hullGroup, x, y, 0);
    // Кормовой лацпорт ГАС «Полином-Т»
    const door = new THREE.PlaneGeometry(6, 3.4);
    door.rotateY(-Math.PI / 2);
    mesh(door, M.black, 'Stern_VDS_Door', hullGroup, HULL.xStern - 0.8 * (2.6 / deckY(HULL.xStern)) - 0.05, 2.6, 0);
  }

  // =========================================================================
  // ДВИЖИТЕЛИ: валы, кронштейны, винты, рули
  const prop = group('Propulsion', hullGroup);
  {
    // Лопасть: эллиптический контур, закрученный по шагу
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.55, 0.45);
    bladeShape.bezierCurveTo(-1.1, 1.4, -0.9, 2.6, 0.05, 2.85);
    bladeShape.bezierCurveTo(0.7, 2.4, 0.85, 1.2, 0.55, 0.45);
    bladeShape.lineTo(-0.55, 0.45);
    const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.09, bevelEnabled: false, curveSegments: 10 });
    blade.translate(0, 0, -0.045);
    // Сейчас: хорда — X, радиус — Y, толщина — Z. Поворачиваем хорду в плоскость диска (Z) и закручиваем.
    const p = blade.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.max(0.4, v.y);
      const pitch = Math.atan(5.2 / (2 * Math.PI * r)); // шаг ~5.2 м
      const chord = v.x;
      const thick = v.z;
      // хорда идёт вдоль Z (по окружности) с наклоном pitch к оси X
      v.set(chord * Math.sin(pitch) + thick * Math.cos(pitch), v.y, chord * Math.cos(pitch) - thick * Math.sin(pitch));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    blade.computeVertexNormals();
    blade.name = 'Propeller_Blade';
    // Зеркальная лопасть для винта левого вращения (без отрицательного масштаба)
    const bladeMirror = blade.clone();
    bladeMirror.scale(1, 1, -1);
    const mp = bladeMirror.attributes.position;
    for (let i = 0; i < mp.count; i += 3) {
      const ax = mp.getX(i + 1), ay = mp.getY(i + 1), az = mp.getZ(i + 1);
      mp.setXYZ(i + 1, mp.getX(i + 2), mp.getY(i + 2), mp.getZ(i + 2));
      mp.setXYZ(i + 2, ax, ay, az);
    }
    bladeMirror.computeVertexNormals();
    bladeMirror.name = 'Propeller_Blade_Mirror';
    const hubProfile = [[0, -1.0], [0.45, -0.9], [0.6, -0.4], [0.62, 0.5], [0.4, 0.9], [0, 1.0]].map(([r, y]) => new THREE.Vector2(r, y));
    const hub = new THREE.LatheGeometry(hubProfile, 20);
    hub.rotateZ(-Math.PI / 2);
    hub.name = 'Propeller_Hub';

    const rudderShape = new THREE.Shape();
    rudderShape.moveTo(-2.1, 0);
    rudderShape.lineTo(2.0, 0);
    rudderShape.lineTo(1.7, -6.2);
    rudderShape.lineTo(-1.9, -6.0);
    rudderShape.lineTo(-2.1, 0);
    const rudder = new THREE.ExtrudeGeometry(rudderShape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.15, bevelSegments: 2 });
    rudder.translate(0, 0, -0.2);
    rudder.name = 'Rudder';

    [1, -1].forEach((side, k) => {
      const n = k + 1;
      const shaftA = new THREE.Vector3(-58, -8.0, side * 7.2);
      const shaftB = new THREE.Vector3(-103.2, -6.5, side * 6.6);
      const shafts = group(`Shaft_Line_${n}`, prop);
      mesh(beamBetween(shaftA, shaftB, 0.7), M.metal, `Shaft_${n}`, shafts);
      // Кронштейны: две стойки под углом к днищу
      for (const t of [0.55, 0.92]) {
        const at = shaftA.clone().lerp(shaftB, t);
        const parts = [-1, 1].map((d) => {
          const zTop = at.z + d * 2.2;
          return beamBetween(at, new THREE.Vector3(at.x, keelY(at.x) + 1.2, zTop), 0.35, 1.1);
        });
        mesh(merge(parts), M.boot, `Shaft_Bracket_${n}_${t < 0.7 ? 1 : 2}`, shafts);
      }
      const propeller = group(`Propeller_${n}`, prop, -104.6, -6.45, side * 6.6);
      propeller.rotation.x = 0;
      mesh(hub, M.bronze, `Propeller_${n}_Hub`, propeller);
      for (let b = 0; b < 5; b++) {
        // винты противоположного вращения: левый — зеркальный
        const bl = mesh(side > 0 ? blade : bladeMirror, M.bronze, `Propeller_${n}_Blade_${b + 1}`, propeller);
        bl.rotation.x = (b / 5) * Math.PI * 2;
      }
      const rx = -111.2;
      mesh(rudder, M.boot, `Rudder_${n}`, prop, rx, keelY(rx) + 1.0, side * 6.4);
    });
  }

  // =========================================================================
  // ЛЕЕРЫ ПО КРОМКЕ ПАЛУБЫ
  {
    const top = grid[nRows];
    for (const side of [1, -1]) {
      const path = [];
      for (let i = 0; i <= nU; i += 2) {
        const p = top[i];
        if (p.x > 124.5) break;
        path.push(new THREE.Vector3(p.x, p.y, side * Math.max(0, p.hw - 0.25)));
      }
      mesh(railingGeometry(path), M.rail, side > 0 ? 'Railing_Starboard' : 'Railing_Port', hullGroup);
    }
    const s = top[0];
    mesh(railingGeometry([new THREE.Vector3(s.x + 0.2, s.y, s.hw - 0.25), new THREE.Vector3(s.x + 0.2, s.y, -s.hw + 0.25)]), M.rail, 'Railing_Stern', hullGroup);
  }

  // =========================================================================
  // БАК: якорное устройство, кнехты, флагшток
  const fore = group('Forecastle');
  {
    const anchorShank = merge([
      new THREE.BoxGeometry(0.35, 3.0, 0.35).translate(0, -1.5, 0),
      new THREE.BoxGeometry(2.2, 0.45, 0.45).translate(0, -3.0, 0),
      new THREE.BoxGeometry(0.5, 1.4, 0.4).rotateZ(0.5).translate(-1.05, -2.5, 0),
      new THREE.BoxGeometry(0.5, 1.4, 0.4).rotateZ(-0.5).translate(1.05, -2.5, 0),
      new THREE.TorusGeometry(0.3, 0.08, 6, 12).translate(0, 0.25, 0),
    ]);
    anchorShank.name = 'Anchor';
    [1, -1].forEach((side, k) => {
      const { point, normal } = hullHit(113, 12.8, side);
      const a = mesh(anchorShank, M.black, `Anchor_${k + 1}`, fore);
      a.position.copy(point).addScaledVector(normal, 0.25);
      a.rotation.y = side > 0 ? Math.atan2(normal.x, normal.z) : Math.atan2(normal.x, normal.z);
      const hawse = mesh(cylG(0.75, 0.75, 0.3, 16), M.black, `Hawse_${k + 1}`, fore);
      hawse.position.copy(point).addScaledVector(normal, 0.05);
      hawse.position.y += 0.6;
      hawse.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      // Брашпиль и цепь
      const w = group(`Windlass_${k + 1}`, fore);
      onDeck(w, 108, side * 3.0);
      mesh(cylG(0.9, 0.9, 1.2, 16), M.metal, `Windlass_${k + 1}_Drum`, w, 0, 0.9, 0).rotation.x = Math.PI / 2;
      mesh(boxG(1.6, 0.6, 2.2), M.superGrey, `Windlass_${k + 1}_Base`, w, 0, 0.3, 0);
      const chainFrom = new THREE.Vector3(108.8, deckY(108.8) + 0.1, side * 3.0);
      const chainTo = new THREE.Vector3(115.5, deckY(115.5) + 0.1, side * 4.2);
      mesh(beamBetween(chainFrom, chainTo, 0.25, 0.12), M.metal, `Anchor_Chain_${k + 1}`, fore);
    });
    // Кнехты вдоль бортов: одна сетка на весь корабль
    const posts = [];
    for (const x of [116, 96, 60, 20, -20, -60, -95, -115]) {
      for (const side of [1, -1]) {
        const z = side * (deckHalfWidth(x) - 1.1);
        const y = deckY(x);
        posts.push(new THREE.CylinderGeometry(0.22, 0.25, 0.7, 10).translate(x - 0.4, y + 0.35, z));
        posts.push(new THREE.CylinderGeometry(0.22, 0.25, 0.7, 10).translate(x + 0.4, y + 0.35, z));
        posts.push(new THREE.BoxGeometry(1.4, 0.12, 0.7).translate(x, y + 0.06, z));
      }
    }
    mesh(merge(posts), M.metal, 'Bollards', fore);
    // Гюйсшток с гюйсом
    const jack = canvasTexture(256, 128, (c, w, h) => {
      c.fillStyle = '#d12b2b';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 26;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
      c.strokeStyle = '#1f4fa8';
      c.lineWidth = 16;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
      c.fillStyle = '#ffffff'; c.fillRect(w / 2 - 18, 0, 36, h); c.fillRect(0, h / 2 - 18, w, 36);
      c.fillStyle = '#d12b2b'; c.fillRect(w / 2 - 9, 0, 18, h); c.fillRect(0, h / 2 - 9, w, 18);
    });
    const flagMat = std('Flag_Jack', 0xffffff, 0.8, 0, { map: jack, side: THREE.DoubleSide });
    const jx = 124.6;
    mesh(cylG(0.06, 0.08, 5, 8), M.metal, 'Jackstaff', fore, jx, deckY(jx) + 2.5, 0);
    mesh(new THREE.PlaneGeometry(2.4, 1.2), flagMat, 'Flag_Jack', fore, jx - 1.25, deckY(jx) + 4.3, 0);
  }

  // =========================================================================
  // ВООРУЖЕНИЕ (каждый комплекс — свой сборщик)
  const weapons = group('Weapons');

  // --- РКПТЗ «Удав-1» (РБУ-12000) на баке, с отбойным щитом
  function buildUdav(parent) {
    const g = group('ASW_Udav1', parent);
    onDeck(g, 101, 0);
    mesh(cylG(1.8, 2.0, 0.8, 24), M.superGrey, 'Udav_Base', g, 0, 0.4, 0);
    const turret = group('Udav_Launcher', g, 0, 1.6, 0);
    mesh(boxG(2.4, 1.2, 2.8), M.superGrey, 'Udav_Cradle', turret, 0, -0.2, 0);
    const tubes = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
      tubes.push(new THREE.CylinderGeometry(0.17, 0.17, 2.6, 10).rotateZ(-Math.PI / 2 + 0.55).translate(0.6, 0.4 + r * 0.38, -0.9 + c * 0.44));
    }
    mesh(merge(tubes), M.superGrey, 'Udav_Tubes', turret);
    // отбойный щит перед установкой
    const shield = loftPrism([[0.5, -3.4], [1.1, -1.6], [1.3, 0], [1.1, 1.6], [0.5, 3.4], [0.1, 3.4], [0.1, -3.4]], 1.8, { topScale: [1, 0.95] });
    mesh(shield, [M.superGrey, M.superGrey], 'Udav_Blast_Shield', g, 2.4, 0, 0);
    return g;
  }

  // --- ПУ ЗРК «Кинжал»: круглые барабанные крышки
  const kinzhalLid = (name, parent, x, y, z) => {
    const g = group(name, parent, x, y, z);
    mesh(cylG(1.25, 1.3, 0.22, 36), M.lid, `${name}_Lid`, g, 0, 0.11, 0);
    mesh(cylG(0.35, 0.35, 0.1, 12), M.metal, `${name}_Hub`, g, 0, 0.26, 0);
    return g;
  };
  function buildKinzhal(parent, count, where) {
    const g = group(`VLS_Kinzhal_${where}`, parent);
    if (where === 'Fore') {
      // две приподнятые площадки на баке по 4 ПУ (как на фото)
      [[-4.6, 77, 0], [3.2, 75, 1]].forEach(([z, x, k]) => {
        const pad = group(`Kinzhal_Platform_${k + 1}`, g);
        onDeck(pad, x, z);
        mesh(boxG(8.6, 1.0, 6.2), M.hatch, `Kinzhal_Platform_${k + 1}_Body`, pad, 0, 0.5, 0);
        let n = 0;
        for (const dx of [-2.0, 2.0]) for (const dz of [-1.5, 1.5]) {
          if (k * 4 + n >= count) break;
          kinzhalLid(`VLS_Kinzhal_F${k * 4 + n + 1}`, pad, dx, 1.0, dz);
          n++;
        }
      });
    } else {
      let n = 0;
      for (const x of [-82.5, -86.5]) for (const z of [-9.6, -6.5, 6.5, 9.6]) {
        if (n >= count) break;
        const lid = kinzhalLid(`VLS_Kinzhal_A${n + 1}`, g, 0, 0, 0);
        onDeck(lid, x, z);
        n++;
      }
    }
    return g;
  }

  // --- ПУ С-300Ф «Форт» / С-300ФМ «Форт-М»: квадратные плиты с револьверной крышкой
  function buildFort(parent, fitFort) {
    const g = group('VLS_Fort', parent);
    const total = fitFort.s300f + fitFort.s300fm;
    const slots = [];
    [52, 58.5, 65].forEach((x, r) => {
      for (const z of [-9.2, -3.1, 3.1, 9.2]) slots.push([x, z + (r % 2 ? 1.2 : -1.2)]);
    });
    slots.slice(0, total).forEach(([x, z], i) => {
      const isM = i >= fitFort.s300f;
      const name = isM ? `VLS_FortM_${i - fitFort.s300f + 1}` : `VLS_Fort_${i + 1}`;
      const cell = group(name, g);
      onDeck(cell, x, z);
      mesh(boxG(3.6, 0.2, 3.6), M.hatch, `${name}_Plate`, cell, 0, 0.1, 0);
      mesh(cylG(1.45, 1.5, 0.2, 40), M.lid, `${name}_Lid`, cell, 0, 0.3, 0);
      mesh(cylG(0.45, 0.45, 0.1, 12), M.metal, `${name}_Hub`, cell, 0, 0.45, 0);
    });
    return g;
  }

  // --- ПКР П-700 «Гранит»: 20 наклонных шахт под плитой бака
  function buildGranit(parent, count) {
    const g = group('VLS_Granit', parent);
    const x0 = 21.5;
    const x1 = 46;
    const plate = new THREE.BoxGeometry(x1 - x0, 0.35, 19.4);
    mesh(plate, M.hatch, 'VLS_Granit_Deck', g, (x0 + x1) / 2, deckY(46) + 0.175, 0);
    let n = 0;
    for (let r = 0; r < 5; r++) {
      for (const z of [-7.2, -2.4, 2.4, 7.2]) {
        if (n >= count) break;
        const x = x0 + 2.45 + r * 4.9;
        mesh(boxG(4.3, 0.16, 4.3), M.lid, `VLS_Granit_Lid_${String(n + 1).padStart(2, '0')}`, g, x, deckY(46) + 0.43, z);
        n++;
      }
    }
    return g;
  }

  // --- ЗРАК «Кортик»: боевой модуль с двумя ГШ-6-30 и пакетами ракет
  let kortikTemplate = null;
  function buildKortikTemplate() {
    const t = new THREE.Group();
    mesh(cylG(1.7, 1.9, 0.9, 24), M.superGrey, 'Kortik_Base', t, 0, 0.45, 0);
    const head = group('Kortik_Head', t, 0, 0.9, 0);
    const body = loftPrism(chamferRect(-1.3, 1.3, 1.0, 0.5, 0.2), 1.5, { topScale: [0.85, 0.8] });
    mesh(body, [M.superGrey, M.superGrey], 'Kortik_Body', head);
    for (const s of [1, -1]) {
      const gun = merge([
        new THREE.CylinderGeometry(0.28, 0.28, 1.5, 12).rotateZ(Math.PI / 2).translate(0.4, 0, 0),
        new THREE.CylinderGeometry(0.16, 0.16, 1.6, 10).rotateZ(Math.PI / 2).translate(1.9, 0, 0),
      ]);
      gun.name = 'Kortik_Gun';
      mesh(geo('Kortik_Gun', () => gun), M.metal, 'Kortik_Gun', head, 0, 0.55, s * 1.3);
      mesh(boxG(2.2, 0.55, 0.75), M.superGrey, 'Kortik_Missiles', head, 0.4, 1.15, s * 1.35);
    }
    mesh(cylG(0.5, 0.5, 0.25, 16), M.superGrey, 'Kortik_Radar_Mount', head, -0.3, 1.62, 0);
    const dish = mesh(geo('Kortik_Dish', () => new THREE.CylinderGeometry(0.75, 0.75, 0.15, 20).rotateZ(Math.PI / 2)), M.antenna, 'Kortik_Radar', head, -0.3, 2.4, 0);
    dish.rotation.z = 0.25;
    return t;
  }
  function buildKortik(parent, name, x, z, dy = 0, facing = 0) {
    if (!kortikTemplate) kortikTemplate = buildKortikTemplate();
    const k = kortikTemplate.clone(); // клон делит геометрии и материалы с шаблоном
    k.name = name;
    k.position.set(x, deckY(x) + dy, z);
    k.rotation.y = facing;
    k.traverse((o) => { if (o !== k) o.name = `${name}_${o.name.replace('Kortik_', '')}`; });
    parent.add(k);
    return k;
  }

  // --- АК-130: спаренная 130-мм артустановка
  function buildAK130(parent, x) {
    const g = group('Gun_AK130', parent);
    onDeck(g, x, 0);
    g.rotation.y = Math.PI; // стволами в корму
    mesh(cylG(3.4, 3.6, 1.3, 32), M.superGrey, 'AK130_Barbette', g, 0, 0.65, 0);
    const turret = group('AK130_Turret', g, 0, 1.3, 0);
    const poly = [[4.2, -1.9], [4.2, 1.9], [2.8, 3.3], [-3.6, 3.3], [-4.0, 2.8], [-4.0, -2.8], [-3.6, -3.3], [2.8, -3.3]];
    const top = [[3.0, -1.4], [3.0, 1.4], [2.0, 2.7], [-3.4, 2.7], [-3.7, 2.3], [-3.7, -2.3], [-3.4, -2.7], [2.0, -2.7]];
    mesh(loftPrism(poly, 3.1, { topPoly: top }), [M.superGrey, M.superGrey], 'AK130_Housing', turret);
    for (const s of [1, -1]) {
      const barrel = geo('AK130_Barrel', () => merge([
        new THREE.CylinderGeometry(0.42, 0.42, 1.6, 16).rotateZ(-Math.PI / 2).translate(0.8, 0, 0),
        new THREE.CylinderGeometry(0.2, 0.26, 8.6, 16).rotateZ(-Math.PI / 2).translate(5.5, 0, 0),
        new THREE.CylinderGeometry(0.27, 0.27, 0.6, 16).rotateZ(-Math.PI / 2).translate(9.6, 0, 0),
      ]));
      const b = mesh(barrel, M.superGrey, `AK130_Barrel_${s > 0 ? 1 : 2}`, turret, 3.7, 1.4, s * 0.75);
      b.rotation.z = 0.06;
    }
    mesh(boxG(1.0, 1.0, 1.8), M.superGrey, 'AK130_Sight', turret, -1.5, 3.4, 1.6);
    return g;
  }

  // --- РБУ-1000 в корме
  function buildRBU1000(parent, name, x, z) {
    const g = group(name, parent);
    onDeck(g, x, z);
    mesh(cylG(1.1, 1.2, 0.8, 20), M.superGrey, `${name}_Base`, g, 0, 0.4, 0);
    const tubes = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      tubes.push(new THREE.CylinderGeometry(0.17, 0.17, 1.9, 10).rotateZ(Math.PI / 2 - 0.5).translate(-0.3, 0.3 + r * 0.38, -0.4 + c * 0.4));
    }
    mesh(geo('RBU1000_Tubes', () => merge(tubes)), M.superGrey, `${name}_Tubes`, g, 0, 1.1, 0);
    return g;
  }

  // --- Торпедные аппараты ПТА-53-1144 за бортовыми щитами
  function buildTorpedoShutters(parent, count) {
    const g = group('Torpedo_Tubes', parent);
    const perSide = Math.ceil(count / 2);
    [1, -1].forEach((side) => {
      for (const [k, x] of [-63, -68.5].entries()) {
        const { point, normal } = hullHit(x, 5.4, side);
        const d = mesh(boxG(4.6, 2.0, 0.12), M.hull, `Torpedo_Shutter_${side > 0 ? 'S' : 'P'}${k + 1}`, g);
        d.position.copy(point).addScaledVector(normal, 0.05);
        alignTo(d, normal);
        const frameGeo = geo('Torpedo_Shutter_Frame', () => merge([
          new THREE.BoxGeometry(4.8, 0.12, 0.1).translate(0, 1.0, 0),
          new THREE.BoxGeometry(4.8, 0.12, 0.1).translate(0, -1.0, 0),
          new THREE.BoxGeometry(0.12, 2.1, 0.1).translate(2.4, 0, 0),
          new THREE.BoxGeometry(0.12, 2.1, 0.1).translate(-2.4, 0, 0),
        ]));
        const frame = mesh(frameGeo, M.black, `Torpedo_Shutter_${side > 0 ? 'S' : 'P'}${k + 1}_Frame`, g);
        frame.position.copy(d.position).addScaledVector(normal, 0.04);
        frame.quaternion.copy(d.quaternion);
      }
      g.userData.tubesPerSide = perSide;
    });
    return g;
  }

  // =========================================================================
  // РАДИОЭЛЕКТРОНИКА

  // MP-800 «Восход» (Top Pair): две антенны спина к спине на общем поворотном основании
  function buildVoskhod(parent, x, y) {
    const g = group('Radar_Voskhod', parent, x, y, 0);
    mesh(cylG(1.2, 1.4, 1.0, 20), M.antenna, 'Voskhod_Pedestal', g, 0, 0.5, 0);
    mesh(boxG(3.6, 1.0, 2.0), M.antenna, 'Voskhod_Beam', g, 0, 1.5, 0);
    // Изогнутый отражатель: плоскость с нормалью +X, прогиб по параболе вдоль оси bendAxis
    const reflector = (w, h, depth, bendAxis) => {
      const g2 = new THREE.PlaneGeometry(w, h, bendAxis === 'z' ? 12 : 1, bendAxis === 'y' ? 12 : 1);
      g2.rotateY(Math.PI / 2); // нормаль +X, ширина вдоль Z, высота вдоль Y
      const p = g2.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = bendAxis === 'y' ? p.getY(i) / (h / 2) : p.getZ(i) / (w / 2);
        p.setX(i, -depth * (1 - t * t));
      }
      g2.computeVertexNormals();
      return g2;
    };
    // «Top Sail»: большой отражатель, изогнутый по вертикали и наклонённый назад
    const sail = group('Voskhod_TopSail', g, -1.4, 5.2, 0);
    sail.rotation.z = 0.28;
    mesh(geo('Voskhod_TopSail_Reflector', () => reflector(8.6, 7.2, 1.3, 'y')), M.antenna, 'Voskhod_TopSail_Reflector', sail);
    mesh(geo('Voskhod_TopSail_Frame', () => merge([
      new THREE.BoxGeometry(0.25, 0.25, 8.8).translate(0, 3.6, 0),
      new THREE.BoxGeometry(0.25, 0.25, 8.8).translate(0, -3.6, 0),
      new THREE.BoxGeometry(0.3, 7.4, 0.3).translate(-0.6, 0, 4.3),
      new THREE.BoxGeometry(0.3, 7.4, 0.3).translate(-0.6, 0, -4.3),
      new THREE.BoxGeometry(0.4, 7.0, 0.4).translate(-1.4, 0, 0),
    ])), M.metal, 'Voskhod_TopSail_Frame', sail);
    mesh(beamBetween(new THREE.Vector3(0, -3.2, 0), new THREE.Vector3(3.4, -0.4, 0), 0.2), M.metal, 'Voskhod_TopSail_Feed_Arm', sail);
    mesh(boxG(0.6, 0.8, 1.6), M.antenna, 'Voskhod_TopSail_Feed', sail, 3.4, -0.4, 0);
    // «Big Net»: широкий корыто-отражатель с обратной стороны, изогнут по горизонтали
    const net = group('Voskhod_BigNet', g, 1.6, 3.0, 0);
    net.rotation.y = Math.PI;
    net.rotation.z = 0.15;
    mesh(geo('Voskhod_BigNet_Reflector', () => reflector(9.6, 2.6, 1.0, 'z')), M.antenna, 'Voskhod_BigNet_Reflector', net);
    mesh(beamBetween(new THREE.Vector3(-1.0, 0, 0), new THREE.Vector3(2.0, 0, 0), 0.18), M.metal, 'Voskhod_BigNet_Feed_Arm', net);
    mesh(boxG(0.5, 0.5, 1.2), M.antenna, 'Voskhod_BigNet_Feed', net, 2.0, 0, 0);
    return g;
  }

  // MP-710 «Фрегат-М» (Top Plate): две плоские решётки спина к спине
  function buildFregatM(parent, x, y) {
    const g = group('Radar_FregatM', parent, x, y, 0);
    mesh(cylG(0.9, 1.1, 1.2, 20), M.antenna, 'FregatM_Pedestal', g, 0, 0.6, 0);
    for (const s of [1, -1]) {
      const a = mesh(boxG(0.45, 3.4, 5.2), M.antenna, `FregatM_Array_${s > 0 ? 1 : 2}`, g, s * 0.9, 2.9, 0);
      a.rotation.z = s * 0.32;
    }
    mesh(boxG(1.6, 0.5, 1.6), M.antenna, 'FregatM_Hub', g, 0, 1.4, 0);
    return g;
  }

  // Навигационная РЛС: щелевая антенна
  function buildNavRadar(parent, name, x, y, z) {
    const g = group(name, parent, x, y, z);
    mesh(cylG(0.35, 0.45, 0.6, 12), M.antenna, `${name}_Pedestal`, g, 0, 0.3, 0);
    mesh(boxG(0.4, 0.45, 4.2), M.antenna, `${name}_Bar`, g, 0, 0.8, 0);
    return g;
  }

  // 30Н6 / «Top Dome»: большой радиопрозрачный купол на барабане
  function buildTopDome(parent, name, x, y, facing = 0) {
    const g = group(name, parent, x, y, 0);
    g.rotation.y = facing;
    mesh(cylG(2.8, 3.0, 1.6, 32), M.superGrey, `${name}_Drum`, g, 0, 0.8, 0);
    mesh(domeG(2.75, 48), M.radome, `${name}_Radome`, g, 0, 1.6, 0);
    for (const z of [-1.9, 0, 1.9]) mesh(sphG(0.55, 14, 10), M.radome, `${name}_Small_${z}`, g, 2.6, 0.9, z);
    return g;
  }

  // 3Р95 (Cross Sword) — СУО «Кинжала»: короб с решёткой и двумя антеннами
  function buildCrossSword(parent, name, x, y, z = 0, facing = 0) {
    const g = group(name, parent, x, y, z);
    g.rotation.y = facing;
    mesh(cylG(1.3, 1.5, 0.7, 20), M.superGrey, `${name}_Base`, g, 0, 0.35, 0);
    mesh(boxG(2.2, 2.4, 2.8), M.superGrey, `${name}_Housing`, g, 0, 1.9, 0);
    const face = mesh(boxG(0.15, 2.0, 2.2), M.antenna, `${name}_Array`, g, 1.15, 1.95, 0);
    face.rotation.z = 0.2;
    for (const s of [1, -1]) mesh(sphG(0.45, 12, 8), M.radome, `${name}_Dome_${s > 0 ? 1 : 2}`, g, 0.6, 3.4, s * 0.9);
    return g;
  }

  // МР-184 (Kite Screech) — СУО АК-130
  function buildKiteScreech(parent, name, x, y, facing = 0) {
    const g = group(name, parent, x, y, 0);
    g.rotation.y = facing;
    mesh(cylG(1.0, 1.2, 1.2, 20), M.superGrey, `${name}_Base`, g, 0, 0.6, 0);
    mesh(boxG(1.8, 1.4, 2.2), M.superGrey, `${name}_Body`, g, 0, 1.9, 0);
    const d = mesh(geo('Dish_1.3', () => new THREE.CylinderGeometry(1.3, 1.0, 0.35, 24).rotateZ(Math.PI / 2)), M.antenna, `${name}_Dish`, g, 1.1, 2.3, 0);
    d.rotation.z = 0.1;
    mesh(geo('Dish_0.5', () => new THREE.CylinderGeometry(0.5, 0.4, 0.25, 16).rotateZ(Math.PI / 2)), M.antenna, `${name}_Dish_Small`, g, 1.0, 3.3, 0.9);
    return g;
  }

  // Радиопрозрачные купола связи (белые) и РЭБ (серые)
  const radomeOn = (parent, name, x, y, z, r, mat = M.radome) => {
    const g = group(name, parent, x, y, z);
    mesh(cylG(r * 0.45, r * 0.55, 1.0, 14), M.superGrey, `${name}_Pedestal`, g, 0, 0.5, 0);
    mesh(sphG(r, 32, 20), mat, `${name}_Sphere`, g, 0, 1.0 + r * 0.8, 0);
    return g;
  };

  // Мачта-пирамида с площадками
  const pyramidMast = (parent, name, x, y0, h, b0, b1) =>
    mesh(loftPrism(chamferRect(x - b0, x + b0, b0, 0.6, 0.6), h, { topScale: [b1 / b0, b1 / b0], topShift: [x * (1 - b1 / b0), 0] }), [M.superGrey, M.superGrey], name, parent, 0, y0, 0);

  // =========================================================================
  // НОСОВАЯ НАДСТРОЙКА
  const D0 = deckY(0);
  const LV = 3.2; // высота яруса
  // Двери и жалюзи вентиляции на стенках яруса: тонкие плитки, одна сетка на ярус
  const wallDetails = (name, parent, x0, x1, hw, y, every = 6) => {
    const parts = [];
    for (let x = x0 + every / 2; x < x1 - 1; x += every) {
      for (const s of [1, -1]) {
        parts.push(new THREE.BoxGeometry(1.0, 2.0, 0.12).translate(x, y + 1.05, s * (hw - 0.1)));
        parts.push(new THREE.BoxGeometry(1.6, 0.9, 0.12).translate(x + every / 2, y + 1.9, s * (hw - 0.14)));
      }
    }
    return mesh(merge(parts), M.hull, name, parent);
  };
  const roofRail = (x0, x1, hw, y, cf, ca, inset = 0.45) => railingGeometry(
    chamferRect(x0 + inset, x1 - inset, hw - inset, cf, ca).map(([x, z]) => new THREE.Vector3(x, y, z)),
    { closed: true, height: 1.0, spacing: 2.4 },
  );
  const raftRow = (name, parent, xa, xb, y, z) => {
    const rafts = [];
    for (let x = xa; x <= xb; x += 1.7) for (const s of [1, -1]) {
      rafts.push(new THREE.CylinderGeometry(0.38, 0.38, 1.3, 10).rotateX(Math.PI / 2).translate(x, y + 0.45, s * z));
    }
    return mesh(merge(rafts), M.orange, name, parent);
  };

  const ssFore = group('Superstructure_Fore');
  {
    block('Superstructure_Fore_L1', ssFore, -19, 20, 11, D0, LV, { cf: 3.5, ca: 1 });
    block('Superstructure_Fore_L2', ssFore, -14, 16, 9.5, D0 + LV, LV, { cf: 3, ca: 1 });
    block('Superstructure_Fore_L3', ssFore, -15, 12, 7.8, D0 + 2 * LV, LV, { cf: 2.5, ca: 1 });
    wallDetails('Superstructure_Fore_L1_Doors', ssFore, -17, 14, 11 - 0.15, D0, 7);
    wallDetails('Superstructure_Fore_L2_Doors', ssFore, -12, 10, 9.5 - 0.15, D0 + LV, 8);
    // Ходовой мостик с наклонным остеклением
    const by = D0 + 3 * LV;
    const bridge = loftPrism(chamferRect(-6, 9.5, 8, 2.4, 0.5), 2.9, { topScale: [0.92, 0.95], topShift: [-0.3, 0] });
    mesh(bridge, roofMats, 'Bridge', ssFore, 0, by, 0);
    mesh(boxG(0.25, 1.1, 9.4), M.glass, 'Bridge_Windows_Front', ssFore, 9.35, by + 1.65, 0).rotation.z = -0.12;
    for (const s of [1, -1]) {
      const w = mesh(boxG(0.25, 1.1, 3.2), M.glass, `Bridge_Windows_Corner_${s > 0 ? 'S' : 'P'}`, ssFore, 8.25, by + 1.65, s * 6.8);
      w.rotation.y = -s * 0.79;
      mesh(boxG(12, 1.1, 0.2), M.glass, `Bridge_Windows_Side_${s > 0 ? 'S' : 'P'}`, ssFore, 0.5, by + 1.65, s * 7.95);
      // Крылья мостика с прожекторами
      mesh(boxG(4, 0.3, 2.4), M.superGrey, `Bridge_Wing_${s > 0 ? 'S' : 'P'}`, ssFore, 4, by + 0.15, s * 9.0);
      mesh(cylG(0.35, 0.35, 0.6, 12), M.metal, `Searchlight_Fore_${s > 0 ? 'S' : 'P'}`, ssFore, 5, by + 0.7, s * 9.6).rotation.z = Math.PI / 2;
    }
    // Башня фок-мачты — высокая, с наклонными стенками
    const ty = D0 + 3 * LV;
    const th = 12;
    mesh(loftPrism(chamferRect(-17, -2, 7.2, 1.8, 1.0), th, { topScale: [0.8, 0.68], topShift: [-9.5 * 0.2, 0] }), roofMats, 'Tower_Fore', ssFore, 0, ty, 0);
    for (let k = 0; k < 4; k++) mesh(boxG(0.2, 0.7, 6.8 - k * 0.6), M.glass, `Tower_Fore_Windows_${k + 1}`, ssFore, -2.15 - k * 0.42, ty + 3.4 + k * 2.4, 0);
    // Спонсоны с антеннами на боках башни
    for (const s of [1, -1]) {
      mesh(boxG(5, 0.3, 2.2), M.superGrey, `Tower_Fore_Sponson_${s > 0 ? 'S' : 'P'}`, ssFore, -10, ty + 7, s * 6.9);
      mesh(boxG(2.2, 1.8, 0.4), M.antenna, `Tower_Fore_ESM_${s > 0 ? 'S' : 'P'}`, ssFore, -10, ty + 8.1, s * 7.5);
    }
    // Фок-мачта: закрытая пирамида
    const my = ty + th;
    pyramidMast(ssFore, 'Mast_Main', -9.5, my, 15, 4.0, 1.4);
    mesh(boxG(4.6, 0.25, 5.4), M.superGrey, 'Mast_Main_Platform_1', ssFore, -6.0, my + 6, 0);
    mesh(boxG(3.6, 0.25, 4.4), M.superGrey, 'Mast_Main_Platform_2', ssFore, -9.5, my + 15, 0);
    mesh(boxG(0.3, 0.3, 15), M.metal, 'Mast_Main_Yard', ssFore, -9.5, my + 11.5, 0);
    for (const s of [1, -1]) {
      mesh(boxG(1.0, 1.4, 0.8), M.antenna, `Mast_Main_ESM_${s > 0 ? 'S' : 'P'}`, ssFore, -8.0, my + 9, s * 2.6);
      mesh(cylG(0.05, 0.08, 6, 6), M.metal, `Mast_Main_Whip_${s > 0 ? 'S' : 'P'}`, ssFore, -9.5, my + 14.5, s * 7.0).rotation.x = s * 0.2;
    }
    rotating.push({ obj: buildVoskhod(ssFore, -9.5, my + 15.1), period: 6 });
    rotating.push({ obj: buildNavRadar(ssFore, 'Radar_Nav_1', -5.0, my + 6.1, 0), period: 3 });
    // Купола: РЭБ (серые) на первом ярусе, связь (белые) выше
    for (const s of [1, -1]) {
      radomeOn(ssFore, `Radome_ECM_Fore_${s > 0 ? 'S' : 'P'}`, 18, D0 + LV, s * 5.5, 1.3, M.superGrey);
      radomeOn(ssFore, `Radome_Satcom_Fore_${s > 0 ? 'S' : 'P'}`, 13.8, D0 + 2 * LV, s * 6.0, 1.15);
      radomeOn(ssFore, `Radome_Satcom_Bridge_${s > 0 ? 'S' : 'P'}`, -0.5, by + 2.9, s * 6.2, 0.95);
      radomeOn(ssFore, `Radome_Satcom_Tower_${s > 0 ? 'S' : 'P'}`, -13, ty + th, s * 3.6, 0.8);
    }
    if (fit.topDome >= 1) buildTopDome(ssFore, 'Radar_TopDome_Fore', 4.6, by + 2.85, 0);
    raftRow('Liferafts_Fore', ssFore, -12, 12, D0 + LV, 10.15);
    mesh(merge([roofRail(-19, 20, 11, D0 + LV, 3.5, 1), roofRail(-14, 16, 9.5, D0 + 2 * LV, 3, 1), roofRail(-15, 12, 7.8, D0 + 3 * LV, 2.5, 1)]), M.rail, 'Railing_Superstructure_Fore', ssFore);
  }

  // =========================================================================
  // СРЕДНЯЯ ЧАСТЬ: шлюпки, краны
  const mid = group('Midships');
  {
    block('Superstructure_Mid', mid, -35, -18, 5.0, D0, LV, { roof: true });
    wallDetails('Superstructure_Mid_Doors', mid, -34, -19, 4.85, D0, 7);
    const boatGeo = geo('Boat_Hull', () => new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
    const boatDeck = geo('Boat_Deck', () => new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2));
    const boat = (name, x, z, len) => {
      const g = group(name, mid);
      onDeck(g, x, z, 1.6);
      const h = mesh(boatGeo, M.boat, `${name}_Hull`, g);
      h.scale.set(len / 2, 1.3, len / 7);
      const d = mesh(boatDeck, M.boat, `${name}_Deck`, g);
      d.scale.set(len / 2, 1, len / 7);
      mesh(boxG(len * 0.45, 1.0, len / 4.2), M.superGrey, `${name}_Cabin`, g, -len * 0.05, 0.5, 0);
      mesh(boxG(len * 0.2, 0.5, len / 4.6), M.glass, `${name}_Windows`, g, len * 0.13, 0.65, 0);
      // Кильблоки
      for (const dx of [-len * 0.25, len * 0.25]) mesh(boxG(0.4, 1.6, len / 4), M.metal, `${name}_Cradle`, g, dx, -0.8, 0);
      return g;
    };
    boat('Boat_1', -26, 10.4, 10);
    boat('Boat_2', -26, -10.4, 10);
    boat('Boat_3', -43.5, 10.9, 8.5);
    boat('Boat_4', -43.5, -10.9, 8.5);
    // Краны: колонна и наклонная стрела вылетом за борт
    [1, -1].forEach((s, k) => {
      const c = group(`Crane_${k + 1}`, mid);
      onDeck(c, -33.5, s * 6.4);
      mesh(cylG(0.6, 0.75, 4.0, 14), M.superGrey, `Crane_${k + 1}_Column`, c, 0, 2.0, 0);
      mesh(boxG(1.6, 1.2, 1.6), M.superGrey, `Crane_${k + 1}_Cab`, c, 0, 4.4, 0);
      mesh(beamBetween(new THREE.Vector3(0, 4.6, 0), new THREE.Vector3(6.5, 8.0, s * 4.0), 0.5, 0.6), M.superGrey, `Crane_${k + 1}_Jib`, c);
      mesh(beamBetween(new THREE.Vector3(6.5, 8.0, s * 4.0), new THREE.Vector3(6.5, 4.8, s * 4.0), 0.05), M.metal, `Crane_${k + 1}_Hook_Line`, c);
    });
  }

  // =========================================================================
  // КОРМОВАЯ НАДСТРОЙКА: башня, грот-мачта, дымовая труба
  const ssAft = group('Superstructure_Aft');
  {
    block('Superstructure_Aft_L1a', ssAft, -50, -35, 7.5, D0, LV, { cf: 1.5 });
    block('Superstructure_Aft_L1b', ssAft, -81, -50, 10.5, deckY(-81), D0 - deckY(-81) + LV, { ca: 2 });
    block('Superstructure_Aft_L2', ssAft, -71, -36, 7.5, D0 + LV, LV, { cf: 1.5, ca: 1 });
    block('Superstructure_Aft_L3', ssAft, -66, -38, 6.2, D0 + 2 * LV, LV, { cf: 1.5, ca: 1 });
    wallDetails('Superstructure_Aft_L1_Doors', ssAft, -80, -52, 10.35, D0, 7);
    wallDetails('Superstructure_Aft_L2_Doors', ssAft, -70, -38, 7.35, D0 + LV, 8);
    const ty = D0 + 3 * LV;
    mesh(loftPrism(chamferRect(-53, -39, 5.6, 1.2, 0.8), 11, { topScale: [0.8, 0.72], topShift: [-46 * 0.2, 0] }), roofMats, 'Tower_Aft', ssAft, 0, ty, 0);
    for (let k = 0; k < 3; k++) mesh(boxG(0.2, 0.6, 5.6 - k * 0.4), M.glass, `Tower_Aft_Windows_${k + 1}`, ssAft, -39.3 - k * 0.45, ty + 2.5 + k * 2.6, 0);
    // Дымовая труба: наклонная коробка с газоотводами
    const fh = 12.5;
    const funnel = loftPrism(chamferRect(-62.5, -52.5, 4.3, 1.8, 1.8), fh, { topScale: [0.75, 0.82], topShift: [-57.5 * 0.25 - 1.2, 0] });
    mesh(funnel, [M.superGrey, M.black], 'Funnel', ssAft, 0, ty, 0);
    for (const s of [1, -1]) mesh(cylG(0.85, 0.85, 1.6, 16), M.black, `Funnel_Exhaust_${s > 0 ? 'S' : 'P'}`, ssAft, -58.8, ty + fh + 0.4, s * 1.5);
    for (const s of [1, -1]) mesh(boxG(4.5, 3.0, 0.3), M.hull, `Funnel_Louvres_${s > 0 ? 'S' : 'P'}`, ssAft, -57.3, ty + 3.5, s * 4.25);
    // Грот-мачта с «Фрегатом-М»
    const my = ty + 11;
    pyramidMast(ssAft, 'Mast_Aft', -46, my, 10.5, 3.0, 1.1);
    mesh(boxG(3.2, 0.25, 3.6), M.superGrey, 'Mast_Aft_Platform', ssAft, -46, my + 10.5, 0);
    mesh(boxG(0.3, 0.3, 11), M.metal, 'Mast_Aft_Yard', ssAft, -46, my + 7.5, 0);
    mesh(boxG(3.4, 0.25, 4.0), M.superGrey, 'Mast_Aft_Platform_Nav', ssAft, -42.9, my + 4.0, 0);
    for (const s of [1, -1]) mesh(cylG(0.05, 0.08, 6, 6), M.metal, `Mast_Aft_Whip_${s > 0 ? 'S' : 'P'}`, ssAft, -46, my + 10, s * 5.0).rotation.x = s * 0.25;
    rotating.push({ obj: buildFregatM(ssAft, -46, my + 10.6), period: 4 });
    rotating.push({ obj: buildNavRadar(ssAft, 'Radar_Nav_2', -42.0, my + 4.1, 0), period: 3 });
    for (const s of [1, -1]) {
      radomeOn(ssAft, `Radome_Satcom_Aft_${s > 0 ? 'S' : 'P'}`, -41, D0 + 3 * LV, s * 5.3, 0.85);
      radomeOn(ssAft, `Radome_ECM_Aft_${s > 0 ? 'S' : 'P'}`, -69.3, D0 + 2 * LV, s * 5.6, 1.0, M.superGrey);
    }
    if (fit.topDome >= 2) buildTopDome(ssAft, 'Radar_TopDome_Aft', -67.5, D0 + 2 * LV - 0.05, Math.PI);
    buildCrossSword(ssAft, 'Radar_CrossSword_Aft', -63.6, D0 + 3 * LV, 0, Math.PI);
    buildKiteScreech(ssAft, 'Radar_KiteScreech', -75.5, D0 + LV, Math.PI);
    raftRow('Liferafts_Aft', ssAft, -73, -52, D0 + LV, 9.65);
    mesh(merge([roofRail(-81, -50, 10.5, D0 + LV, 0, 2), roofRail(-71, -36, 7.5, D0 + 2 * LV, 1.5, 1)]), M.rail, 'Railing_Superstructure_Aft', ssAft);
  }

  // =========================================================================
  // ВООРУЖЕНИЕ НА МЕСТАХ
  if (fit.udav) buildUdav(weapons);
  // Носовая рубка с СУО «Кинжала» (как на фото — смещена к левому борту)
  {
    const h = group('Deckhouse_Fore', weapons);
    onDeck(h, 89, -1.5);
    mesh(loftPrism(chamferRect(-4, 4, 3.4, 1.2, 0.5), 2.2, { topScale: [0.9, 0.88] }), roofMats, 'Deckhouse_Fore_Body', h);
    buildCrossSword(h, 'Radar_CrossSword_Fore', 0.5, 2.2, 0, 0);
  }
  buildKinzhal(weapons, fit.kinzhal.fore, 'Fore');
  buildKinzhal(weapons, fit.kinzhal.aft, 'Aft');
  buildFort(weapons, fit.fort);
  buildGranit(weapons, fit.granit);
  const kortikSpots = [
    ['CIWS_Kortik_1', -16.6, 8.4, LV, 0],
    ['CIWS_Kortik_2', -16.6, -8.4, LV, 0],
    ['CIWS_Kortik_3', -36.5, 11.4, 0, Math.PI / 2],
    ['CIWS_Kortik_4', -36.5, -11.4, 0, -Math.PI / 2],
    ['CIWS_Kortik_5', -77.5, 6.6, D0 + LV - deckY(-77.5), Math.PI],
    ['CIWS_Kortik_6', -77.5, -6.6, D0 + LV - deckY(-77.5), Math.PI],
  ];
  kortikSpots.slice(0, fit.kortik).forEach(([n, x, z, dy, f]) => buildKortik(weapons, n, x, z, dy, f));
  if (fit.mainGun === 'AK130') buildAK130(weapons, -89);
  for (let k = 0; k < fit.rbu1000; k++) buildRBU1000(weapons, `ASW_RBU1000_${k + 1}`, -97, (k ? -1 : 1) * 10.2);
  buildTorpedoShutters(weapons, fit.torpedoTubes);

  // Иллюминаторы: ряд вдоль верхней части борта (одна сетка на борт)
  {
    const port = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12).rotateX(Math.PI / 2);
    for (const side of [1, -1]) {
      const parts = [];
      for (let x = -96; x <= 70; x += 3.2) {
        if (x > -73 && x < -58) continue; // щиты торпедных аппаратов
        for (const y of [deckY(x) - 2.0]) {
          const { point, normal } = hullHit(x, y, side);
          const m = new THREE.Matrix4().compose(point.clone().addScaledVector(normal, 0.02), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), new THREE.Vector3(1, 1, 1));
          parts.push(port.clone().applyMatrix4(m));
        }
      }
      mesh(merge(parts), M.glass, side > 0 ? 'Portholes_Starboard' : 'Portholes_Port', hullGroup);
    }
  }

  // =========================================================================
  // ВЕРТОЛЁТНАЯ ПЛОЩАДКА И АНГАР (подпалубный, с подъёмником)
  const heli = group('Helideck');
  {
    const x0 = -122.5;
    const x1 = -102;
    const len = x1 - x0;
    const width = 23;
    const tex = canvasTexture(1024, 1024, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      const sx = w / len;
      const sz = h / width;
      // Круг посадки
      const cx = w * 0.5;
      const cy = h * 0.5;
      c.fillStyle = 'rgba(126,160,140,0.85)';
      c.beginPath(); c.ellipse(cx, cy, 7.5 * sx, 7.5 * sz, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#f2f2ec';
      c.lineWidth = 0.35 * sx;
      c.beginPath(); c.ellipse(cx, cy, 7.5 * sx, 7.5 * sz, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.ellipse(cx, cy, 4.2 * sx, 4.2 * sz, 0, 0, Math.PI * 2); c.stroke();
      // Осевая линия и поперечная полоса
      c.fillStyle = '#f2f2ec';
      c.fillRect(0.6 * sx, cy - 0.15 * sz, (len - 1.2) * sx, 0.3 * sz);
      c.fillRect(cx - 0.15 * sx, cy - 6 * sz, 0.3 * sx, 12 * sz);
      // Рамка периметра
      c.lineWidth = 0.25 * sx;
      c.strokeRect(0.5 * sx, 0.6 * sz, (len - 1) * sx, (width - 1.2) * sz);
    });
    const mat = std('Helideck_Marking', 0xffffff, 0.8, 0, { map: tex, transparent: true, alphaTest: 0.05 });
    // Плоскость повторяет седловатость палубы (почти плоско)
    const g = new THREE.PlaneGeometry(len, width, 8, 1);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, deckY(p.getX(i) + (x0 + x1) / 2) + 0.04);
    g.computeVertexNormals();
    mesh(g, mat, 'Helideck_Marking', heli, (x0 + x1) / 2, 0, 0);
    // Подъёмник ангара (ангар под палубой юта)
    const lx = -112.25;
    const ly = deckY(lx) + 0.06;
    mesh(merge([
      new THREE.BoxGeometry(10, 0.1, 0.2).translate(0, 0, 3.6),
      new THREE.BoxGeometry(10, 0.1, 0.2).translate(0, 0, -3.6),
      new THREE.BoxGeometry(0.2, 0.1, 7.4).translate(5, 0, 0),
      new THREE.BoxGeometry(0.2, 0.1, 7.4).translate(-5, 0, 0),
    ]), M.hatch, 'Hangar_Lift_Frame', heli, lx, ly, 0);
    // Кормовой флагшток с Андреевским флагом
    const ens = canvasTexture(256, 168, (c, w, h) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#1f4fa8'; c.lineWidth = 26;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
    });
    const fm = std('Flag_Ensign', 0xffffff, 0.8, 0, { map: ens, side: THREE.DoubleSide });
    const fx = -121.8;
    mesh(cylG(0.07, 0.09, 6, 8), M.metal, 'Ensign_Staff', heli, fx, deckY(fx) + 3, 0).rotation.z = 0.25;
    mesh(new THREE.PlaneGeometry(2.6, 1.7), fm, 'Flag_Ensign', heli, fx - 1.9, deckY(fx) + 5.4, 0);
  }

  // =========================================================================
  // Уникальные имена: Blender не любит одинаковые имена узлов
  const seen = new Map();
  ship.traverse((o) => {
    if (o === ship) return;
    const base = o.name || o.type;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n > 1) o.name = `${base}_${n}`;
  });

  // =========================================================================
  // АНИМАЦИЯ: вращаются только антенны РЛС (по часовой стрелке, если смотреть сверху)
  const duration = 12; // общий период клипа, кратный периодам всех антенн
  const tracks = rotating.map(({ obj, period }) => {
    const steps = Math.round((duration / period) * 4); // шаг 90° — slerp идёт по короткой дуге
    const times = [];
    const values = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * duration;
      times.push(t);
      q.setFromEuler(e.set(0, (-2 * Math.PI * t) / period, 0));
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${obj.name}.quaternion`, times, values);
  });
  ship.animations = [new THREE.AnimationClip('Radars_Rotate', duration, tracks)];

  ship.userData.update = (time) => {
    for (const { obj, period } of rotating) obj.rotation.y = (-2 * Math.PI * time) / period;
  };

  return ship;
}
