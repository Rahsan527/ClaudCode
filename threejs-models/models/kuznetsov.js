import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Тяжёлый авианесущий крейсер «Адмирал Кузнецов» (проект 1143.5, бортовой 063).
// Единицы — метры в натуральную величину. Ось Y вверх, ватерлиния на y = 0,
// нос смотрит в +X, начало координат — мидель на диаметральной плоскости, правый борт +Z.
// Корпус лофтится из шпангоутов в BufferGeometry, палуба строится сеткой по плану,
// разметка, бортовой номер и название рисуются на CanvasTexture.

const KEEL = -10; // основная линия (осадка ~10 м)
const TOP = 15.5; // верхняя кромка корпуса под полётной палубой
const DECK = 17.5; // полётная палуба на миделе
const SKI_R = 57 / Math.sin((12 * Math.PI) / 180); // радиус трамплина: 57 м разгона до 12°
const DEG = Math.PI / 180;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Кусочно-линейная таблица [[аргумент, значение], ...]
const interp = (table, v) => {
  if (v <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (v <= table[i][0]) {
      const [a, b] = table[i - 1];
      const [c, d] = table[i];
      return b + ((d - b) * (v - a)) / (c - a);
    }
  }
  return table[table.length - 1][1];
};

// ---------- Обводы корпуса ----------
// Профиль кормы и форштевня: x оконечности на каждой высоте (батоксы у ДП)
const STERN = [[-10, -92], [-9, -100], [-8, -107], [-7, -113], [-6, -118], [-5, -122.5], [-4, -126.5],
  [-3, -129.5], [-2, -132], [-1, -134.2], [0, -136], [15.5, -146.8]];
const STEM = [[-10, 116], [-8, 123], [-6, 128], [-4, 131.8], [-2, 134.3], [0, 136], [5, 140.5], [10, 145], [15.5, 150]];
const sternX = (y) => interp(STERN, y);
const stemX = (y) => interp(STEM, y);

// Полуширина мидель-шпангоута: скула радиусом 3 м, прямой борт, развал выше ватерлинии
const midHalf = (y) => (y < -7 ? 16 + Math.sqrt(Math.max(0, 9 - (y + 7) ** 2)) : y < 0 ? 19 : 19 + 0.24 * y);

// Полуширина корпуса в точке (x, y). Носовые обводы острые внизу и полные с развалом вверху,
// корма широкая с транцем выше ватерлинии.
function hb(x, y) {
  const xs = sternX(y);
  const xe = stemX(y);
  if (x < xs || x > xe) return 0;
  const k = clamp((y - KEEL) / (TOP - KEEL), 0, 1);
  let f = 1;
  if (x > 30) {
    const t = Math.min(1, (x - 30) / (xe - 30));
    f = Math.pow(Math.max(0, 1 - Math.pow(t, 1.7 + 1.5 * k * k)), 0.85);
  } else if (x < -45) {
    const t = Math.min(1, (-45 - x) / (-45 - xs));
    const transom = 0.66 * smooth(-1.6, 0.8, y);
    f = transom + (1 - transom) * Math.pow(Math.max(0, 1 - Math.pow(t, 3 + 0.5 * k)), 0.6);
  }
  return midHalf(y) * f;
}

// Наименьшая высота, на которой корпус дотягивается до |z| (днище над винтом, рулём)
function hullBottomAt(x, z) {
  for (let y = KEEL; y < TOP; y += 0.05) if (hb(x, y) >= Math.abs(z)) return y;
  return TOP;
}

// ---------- План полётной палубы ----------
const DECK_STB = [[-151, 15], [-140, 18], [-120, 21.5], [-100, 24], [-80, 26], [-62, 27.5], [-56, 30.5], [-20, 31],
  [30, 31], [34, 31.5], [56, 31.5], [62, 29.5], [75, 27], [90, 23.5], [105, 20], [120, 16.5], [135, 13], [145, 10], [150, 7.5]];
const DECK_PORT = [[-151, 15], [-140, 19], [-120, 24], [-100, 27.5], [-80, 30], [-60, 32.5], [-40, 35], [-20, 37.5],
  [0, 39.5], [20, 40.5], [38, 40.5], [48, 37.5], [57, 31], [66, 26], [80, 23.5], [100, 20], [120, 16.5], [135, 13], [145, 10], [150, 7.5]];
const DECK_AFT = -151;
const DECK_FWD = 153.5;

// Полуширина палубы для борта s (+1 правый, -1 левый); палуба всегда накрывает корпус
function deckHalf(x, s) {
  if (x > 150) return 7.5 * Math.sqrt(Math.max(0, 1 - ((x - 150) / 3.5) ** 2));
  const base = interp(s > 0 ? DECK_STB : DECK_PORT, x);
  return Math.max(base, hb(Math.max(x, sternX(TOP)), TOP) + 0.8);
}

// Высота палубы: трамплин 12° в носу и скругление на срезе кормы
function deckY(x) {
  let y = DECK;
  if (x > 95) {
    const s = x - 95;
    y += SKI_R - Math.sqrt(SKI_R * SKI_R - s * s);
  }
  if (x < -145) y -= 0.6 * ((-145 - x) / 6) ** 2;
  return y;
}
const deckSlope = (x) => Math.atan2(deckY(x + 0.5) - deckY(x - 0.5), 1);

// Ось угловой посадочной палубы (~7° к ДП)
const LAND_A = new THREE.Vector2(-151, -4);
const LAND_B = new THREE.Vector2(40, -28);

// ---------- Утилиты геометрии ----------

// Добавляет треугольники в индекс, выбрасывая вырожденные; ориентацию выбирает «голосованием»:
// сумма скалярных произведений нормалей на подсказку наружного направления должна быть > 0.
function pushOriented(pos, index, tris, dirFn) {
  const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const kept = [];
  let vote = 0;
  for (const [a, b, c] of tris) {
    const A = v(a);
    const B = v(b);
    const C = v(c);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const area = Math.hypot(n[0], n[1], n[2]);
    if (area < 1e-7) continue;
    const d = dirFn((A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3);
    vote += (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / area;
    kept.push([a, b, c]);
  }
  for (const [a, b, c] of kept) {
    if (vote >= 0) index.push(a, b, c);
    else index.push(a, c, b);
  }
}

function indexedGeometry(pos, index, uv = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // Вершины, у которых остались только вырожденные треугольники, получают нормаль по умолчанию
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    if (Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) < 0.5) nrm.setXYZ(i, 0, 1, 0);
  }
  return g;
}

// Сетка rows × cols из функции точки, ориентированная по подсказке dirFn
function gridGeometry(rows, cols, pointFn, dirFn, uvFn = null) {
  const pos = [];
  const uv = uvFn ? [] : null;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      pos.push(...pointFn(i, j));
      if (uv) uv.push(...uvFn(i, j));
    }
  }
  const tris = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      tris.push([a, a + 1, a + cols + 1], [a, a + cols + 1, a + cols]);
    }
  }
  const index = [];
  pushOriented(pos, index, tris, dirFn);
  return indexedGeometry(pos, index, uv);
}

// Выпуклая призма/усечённая пирамида между двумя многоугольниками [x, z] на высотах y0 и y1.
// Плоские нормали — для надстроек с резкими гранями.
function prismGeometry(pts0, y0, pts1 = pts0, y1 = y0 + 1) {
  const pos = [];
  const n = pts0.length;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of [...pts0, ...pts1]) {
    cx += x;
    cz += z;
  }
  cx /= 2 * n;
  cz /= 2 * n;
  const cy = (y0 + y1) / 2;
  for (const [x, z] of pts0) pos.push(x, y0, z);
  for (const [x, z] of pts1) pos.push(x, y1, z);
  const tris = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([i, j, n + j], [i, n + j, n + i]);
  }
  for (let i = 1; i < n - 1; i++) {
    tris.push([0, i, i + 1], [n, n + i, n + i + 1]);
  }
  // Каждую грань ориентируем отдельно — от центра тела наружу
  const index = [];
  for (const t of tris) pushOriented(pos, index, [t], (x, y, z) => [x - cx, y - cy, z - cz]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

// Прямоугольник со срезанными углами [x, z]
const chamferRect = (x0, x1, z0, z1, c) => [
  [x0 + c, z0], [x1 - c, z0], [x1, z0 + c], [x1, z1 - c], [x1 - c, z1], [x0 + c, z1], [x0, z1 - c], [x0, z0 + c],
];

// Тело вращения с эллиптическими сечениями вдоль X: станции [x, полуширина, полувысота, yЦентра]
function loftGeometry(stations, seg = 12, zc = 0) {
  const pos = [];
  const tris = [];
  const ring = seg;
  stations.forEach(([x, w, h, y]) => {
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      pos.push(x, y + Math.sin(a) * h, zc + Math.cos(a) * w);
    }
  });
  for (let s = 0; s < stations.length - 1; s++) {
    for (let k = 0; k < ring; k++) {
      const a = s * ring + k;
      const b = s * ring + ((k + 1) % ring);
      tris.push([a, b, b + ring], [a, b + ring, a + ring]);
    }
  }
  // Торцы — веером к центру
  const capTris = [];
  for (const s of [0, stations.length - 1]) {
    const [x, , , y] = stations[s];
    const c = pos.length / 3;
    pos.push(x, y, zc);
    for (let k = 0; k < ring; k++) capTris.push([c, s * ring + k, s * ring + ((k + 1) % ring)]);
  }
  const centerY = (x) => {
    let best = stations[0];
    for (const st of stations) if (Math.abs(st[0] - x) < Math.abs(best[0] - x)) best = st;
    return best[3];
  };
  const index = [];
  pushOriented(pos, index, tris, (x, y, z) => [0, y - centerY(x), z - zc]);
  const first = stations[0][0];
  const last = stations[stations.length - 1][0];
  const dirX = Math.sign(last - first);
  pushOriented(pos, index, capTris.slice(0, ring), () => [-dirX, 0, 0]);
  pushOriented(pos, index, capTris.slice(ring), () => [dirX, 0, 0]);
  return indexedGeometry(pos, index);
}

// Плоский контур [x, z] (может быть невыпуклым) → пластина толщиной t (верх на y = 0)
function plateGeometry(pts, t) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // контур ложится в плоскость XZ, выдавливание идёт вверх
  g.translate(0, -t, 0);
  return g;
}

// Зеркалирование геометрии по Z с исправлением порядка вершин
function mirrorZ(geo) {
  const g = geo.clone();
  g.scale(1, 1, -1);
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.attributes[name];
      const s = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) {
        for (let c = 0; c < s; c++) {
          const a = attr.array[(i + 1) * s + c];
          attr.array[(i + 1) * s + c] = attr.array[(i + 2) * s + c];
          attr.array[(i + 2) * s + c] = a;
        }
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

// Собирает несколько геометрий с трансформациями в одну (детали одного материала)
function merged(parts) {
  const list = parts.map(([geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]]) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
      new THREE.Vector3(...scale),
    );
    g.applyMatrix4(m);
    return g;
  });
  return mergeGeometries(list);
}

// Леер: стойки и два прутка вдоль ломаной точек [x, y, z]
function railingGeometry(points, closed = false, height = 1.1, step = 1.6) {
  const parts = [];
  const post = new THREE.BoxGeometry(0.07, height, 0.07);
  const segs = closed ? points.length : points.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = new THREE.Vector3(...points[i]);
    const b = new THREE.Vector3(...points[(i + 1) % points.length]);
    const len = a.distanceTo(b);
    if (len < 0.05) continue;
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    for (const h of [height, height * 0.5]) {
      const bar = new THREE.BoxGeometry(len, 0.05, 0.05);
      bar.rotateZ(pitch);
      bar.rotateY(yaw);
      bar.translate(mid.x, mid.y + h, mid.z);
      parts.push(bar);
    }
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const p = a.clone().lerp(b, k / n);
      parts.push(post.clone().translate(p.x, p.y + height / 2, p.z));
    }
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    g.deleteAttribute('uv');
    return g;
  }));
}

// ---------- Текстуры ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function canvasTexture(c, name) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.name = name;
  t.anisotropy = 8;
  return t;
}

// Окно палубной текстуры в метрах
const TEX_X0 = -155;
const TEX_LX = 310;
const TEX_Z0 = -45;
const TEX_LZ = 90;

function deckTexture() {
  const W = 4096;
  const H = Math.round((W * TEX_LZ) / TEX_LX);
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#80868a';
  g.fillRect(0, 0, W, H);
  // Дальше рисуем в метрах палубы: x вправо, z (правый борт) вверх
  const sx = W / TEX_LX;
  const sz = H / TEX_LZ;
  g.setTransform(sx, 0, 0, -sz, -TEX_X0 * sx, H + TEX_Z0 * sz);
  const line = (pts, width, color, dash = null) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.lineWidth = width;
    g.strokeStyle = color;
    g.setLineDash(dash || []);
    g.stroke();
    g.setLineDash([]);
  };
  // Стыки настила
  for (let x = -150; x < 154; x += 6) line([[x, -42], [x, 42]], 0.06, 'rgba(60,64,68,0.35)');
  for (let z = -40; z < 42; z += 2.5) line([[-152, z], [154, z]], 0.04, 'rgba(60,64,68,0.25)');
  // Пятна копоти и резины в зоне посадки
  const d = LAND_B.clone().sub(LAND_A).normalize();
  const nrm = new THREE.Vector2(-d.y, d.x);
  const at = (s, o) => [LAND_A.x + d.x * s + nrm.x * o, LAND_A.y + d.y * s + nrm.y * o];
  g.fillStyle = 'rgba(40,42,46,0.22)';
  g.beginPath();
  [at(10, -5), at(150, -5), at(150, 5), at(10, 5)].forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
  g.fill();
  // Угловая палуба: кромки сплошные, ось — пунктир
  const len = LAND_A.distanceTo(LAND_B) + 8;
  line([at(2, -13), at(len, -13)], 0.45, '#e8e8e2');
  line([at(2, 13), at(len, 13)], 0.45, '#e8e8e2');
  line([at(4, 0), at(len, 0)], 0.7, '#f0f0ea', [7, 7]);
  // Предупредительная оранжевая полоса справа от посадочной зоны
  line([at(0, 16.5), at(len + 10, 16.5)], 0.6, '#d8792a', [4, 2]);
  // Порог: поперечные белые штрихи
  for (let o = -12; o <= 12; o += 2) line([at(2, o), at(10, o)], 0.6, '#e8e8e2');
  // Тросы аэрофинишёра — тёмные поперечные линии с метками
  for (const s of [45, 57, 69, 81]) {
    line([at(s, -14), at(s, 14)], 0.25, '#2e3134');
    line([at(s - 1.5, -15), at(s + 1.5, -15)], 0.6, '#e8e8e2');
    line([at(s - 1.5, 15), at(s + 1.5, 15)], 0.6, '#e8e8e2');
  }
  // Стартовые полосы к трамплину (жёлтые) и позиции старта
  for (const [p, q] of TAKEOFF) {
    line([p, q], 0.5, '#e2b53a');
    line([[p[0] - 12, p[1]], p], 0.5, '#e2b53a', [2, 2]);
  }
  // Боковые линии трамплина
  line([[95, 6], [152, 4.2]], 0.35, '#e8e8e2');
  line([[95, -6], [152, -4.2]], 0.35, '#e8e8e2');
  // Вертолётные площадки: круг, перекрестье
  for (const [x, z] of HELO_SPOTS) {
    g.beginPath();
    g.arc(x, z, 6.5, 0, Math.PI * 2);
    g.lineWidth = 0.45;
    g.strokeStyle = '#ecece6';
    g.stroke();
    line([[x - 2.5, z], [x + 2.5, z]], 0.4, '#ecece6');
    line([[x, z - 2.5], [x, z + 2.5]], 0.4, '#ecece6');
  }
  // Платформы лифтов: жёлто-чёрная кайма
  for (const [x0, x1] of [ELEV_FWD, ELEV_AFT]) {
    const z1 = Math.min(deckHalf(x0, 1), deckHalf(x1, 1));
    g.strokeStyle = '#d9b234';
    g.lineWidth = 0.6;
    g.setLineDash([1.2, 1.2]);
    g.strokeRect(x0 - 0.4, 17.1, x1 - x0 + 0.8, z1 - 17.1 + 1);
    g.setLineDash([]);
  }
  // Белая кромка по контуру палубы
  g.beginPath();
  DECK_RING.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
  g.closePath();
  g.lineWidth = 1.1;
  g.strokeStyle = '#d8d8d2';
  g.stroke();
  return canvasTexture(c, 'Deck_Markings');
}

// Табличка текста на прозрачном фоне
function textTexture(lines, w, h, color, name) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const { text, size, y, weight = 'bold', stroke = 0 } of lines) {
    g.font = `${weight} ${size}px "DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif`;
    const width = g.measureText(text).width;
    const sx = Math.min(1, (w * 0.96) / width);
    g.save();
    g.translate(w / 2, y);
    g.scale(sx, 1);
    if (stroke) {
      g.lineWidth = stroke;
      g.strokeStyle = 'rgba(20,22,24,0.85)';
      g.strokeText(text, 0, 0);
    }
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  }
  return canvasTexture(c, name);
}

function netTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(40,44,46,1)';
  g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.moveTo(0, i);
    g.lineTo(64, i);
    g.stroke();
  }
  const t = canvasTexture(c, 'Net_Mesh');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- Раскладка палубы ----------
const ELEV_FWD = [34, 54];
const ELEV_AFT = [-53, -33];
const TAKEOFF = [
  [[58, 5], [152, 1.5]],
  [[58, -9], [152, -1.5]],
  [[-25, -22], [152, -1]],
];
const HELO_SPOTS = [[-95, -14], [-113, -9], [-131, -3], [76, -15], [-75, 16], [104, 8]];

// Станции палубы по X: шаг 1.5 м и сгущение на скруглённом носу трамплина
const DECK_XS = (() => {
  const xs = [];
  for (let x = DECK_AFT; x < 150; x += 1.5) xs.push(x);
  xs.push(150, 150.8, 151.5, 152.1, 152.6, 153, 153.3, 153.5);
  return xs;
})();
const DECK_COLS = 40;
// Контур палубы по кругу: правый борт с кормы в нос, левый обратно, кормовой срез
const DECK_RING = (() => {
  const r = [];
  const m = DECK_XS.length - 1;
  for (let i = 0; i <= m; i++) r.push([DECK_XS[i], deckHalf(DECK_XS[i], 1)]);
  for (let i = m - 1; i >= 0; i--) r.push([DECK_XS[i], -deckHalf(DECK_XS[i], -1)]);
  const hp = deckHalf(DECK_AFT, -1);
  const hs = deckHalf(DECK_AFT, 1);
  for (let c = 1; c < DECK_COLS; c++) r.push([DECK_AFT, -hp + ((hs + hp) * c) / DECK_COLS]);
  return r;
})();

// Точка, где скос спонсона под кромкой палубы встречает борт
function skirtHullPoint(x, z) {
  const xT = clamp(x, sternX(TOP) + 0.05, stemX(TOP) - 0.05);
  const over = Math.abs(z) - hb(xT, TOP);
  const yk = clamp(TOP - Math.max(0, over) * 0.45, 9.5, TOP);
  const xk = clamp(x, sternX(yk) + 0.05, stemX(yk) - 0.05);
  return [xk, yk, Math.sign(z) * Math.min(Math.abs(z), hb(xk, yk))];
}

// ==================================================================
export function createKuznetsov() {
  const ship = new THREE.Group();
  ship.name = 'Kuznetsov';

  // ---------- Материалы ----------
  const std = (name, color, roughness = 0.75, metalness = 0.25, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const M = {
    hull: std('Hull_Grey', 0x5c6368, 0.72, 0.12),
    boot: std('Boot_Red', 0x9a3a26, 0.7, 0.08),
    under: std('Antifouling_Red', 0x6a2e26, 0.8, 0.05),
    deck: std('Deck', 0xffffff, 0.85, 0.1, { map: deckTexture() }),
    hatch: std('Deck_Hatch', 0x6c7276, 0.7, 0.15),
    island: std('Island_Grey', 0x666d72, 0.7, 0.12),
    light: std('Light_Grey', 0xa3aaae, 0.6, 0.12),
    panel: std('Radar_Panel', 0x8d9497, 0.55, 0.2),
    radome: std('Radome_White', 0xdadddc, 0.5, 0.05),
    glass: std('Glass', 0x24323e, 0.15, 0.5),
    dark: std('Dark_Metal', 0x33383c, 0.6, 0.4),
    weapon: std('Weapon_Grey', 0x737a7e, 0.6, 0.2),
    bronze: std('Propeller_Bronze', 0xb38b4d, 0.3, 0.9),
    rail: std('Railing', 0x9aa0a4, 0.6, 0.2),
    net: std('Nets', 0xffffff, 0.9, 0.1, { map: netTexture(), alphaTest: 0.4, side: THREE.DoubleSide }),
    boat: std('Boat_White', 0xd8dbd8, 0.6, 0.1),
    raft: std('Liferaft_White', 0xe4e4dc, 0.6, 0.05),
    orange: std('Rescue_Orange', 0xd9652a, 0.6, 0.1),
    su33: std('Su33_Paint', 0x9fb4c9, 0.55, 0.1),
    mig: std('MiG29K_Paint', 0x76889a, 0.55, 0.1),
    ka27: std('Ka27_Paint', 0x7b8a96, 0.6, 0.1),
    canopy: std('Canopy', 0x2a3f52, 0.1, 0.8),
    nozzle: std('Aircraft_Dark', 0x3a3d40, 0.5, 0.7),
    tire: std('Tire_Black', 0x161718, 0.9, 0.0),
    truck: std('Vehicle_Red', 0xb52a22, 0.5, 0.2),
    tug: std('Vehicle_Yellow', 0xd2a628, 0.5, 0.2),
  };

  const mesh = (geo, mat, name, parent, pos = [0, 0, 0], rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.set(...pos);
    m.rotation.set(rot[0], rot[1], rot[2], 'YXZ');
    parent.add(m);
    return m;
  };
  const group = (name, parent = ship, pos = [0, 0, 0], rotY = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...pos);
    g.rotation.y = rotY;
    parent.add(g);
    return g;
  };

  // ================= Корпус =================
  const hullGroup = group('HullStructure');

  // Часть корпуса между рядами высот rows; первый ряд может быть килевой линией (полуширина 0)
  const hullGeometry = (rows) => {
    const N = 300;
    const C = N + 1;
    const pos = [];
    const index = [];
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (const r of rows) {
        const xs = sternX(r.y);
        const xe = stemX(r.y);
        for (let i = 0; i <= N; i++) {
          const x = xs + ((xe - xs) * i) / N;
          pos.push(x, r.y, r.keel ? 0 : side * hb(x, r.y));
        }
      }
      const tris = [];
      for (let j = 0; j < rows.length - 1; j++) {
        for (let i = 0; i < N; i++) {
          const a = base + j * C + i;
          tris.push([a, a + 1, a + C + 1], [a, a + C + 1, a + C]);
        }
      }
      pushOriented(pos, index, tris, (x, y) => [0, y < KEEL + 0.01 ? -1 : 0, side]);
    }
    // Транец: полоса между левым и правым кормовыми краями
    const cap = pos.length / 3;
    rows.forEach((r) => {
      const x = sternX(r.y);
      const h = r.keel ? 0 : hb(x, r.y);
      pos.push(x, r.y, -h, x, r.y, h);
    });
    const tris = [];
    for (let j = 0; j < rows.length - 1; j++) {
      const p = cap + 2 * j;
      tris.push([p, p + 1, p + 3], [p, p + 3, p + 2]);
    }
    pushOriented(pos, index, tris, () => [-1, 0, 0]);
    return indexedGeometry(pos, index);
  };
  const rows = (ys) => ys.map((y) => ({ y }));
  mesh(hullGeometry([{ y: KEEL, keel: true }, ...rows([KEEL, -9.7, -9.2, -8.5, -7.6, -6.5, -5.3, -4.1, -2.9, -2, -1.2])]),
    M.under, 'Hull_Underwater', hullGroup);
  mesh(hullGeometry(rows([-1.2, -0.5, 0.2, 1, 1.8])), M.boot, 'Hull_BootTopping', hullGroup);
  mesh(hullGeometry(rows([1.8, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5, 14.5, TOP])), M.hull, 'Hull', hullGroup);

  // Бульб с ГАС «Полином»
  const dome = mesh(new THREE.SphereGeometry(1, 32, 16), M.under, 'SonarDome', hullGroup, [126, -6.3, 0]);
  dome.scale.set(12, 3.6, 4.1);

  // Скуловые кили и дейдвудный скег
  const bilgeKeel = plateGeometry([[-50, 0], [40, 0], [44, 0.9], [-54, 0.9]], 0.25);
  for (const s of [1, -1]) {
    // Пластина в плоскости XZ, повёрнутая вокруг X наружу-вниз под 45°
    mesh(bilgeKeel, M.under, s > 0 ? 'BilgeKeel_Starboard' : 'BilgeKeel_Port', hullGroup,
      [0, -8.75, s * 18.0], [s > 0 ? 45 * DEG : 135 * DEG, 0, 0]);
  }
  const skegShape = new THREE.Shape([[-85, -10], [-110, -10], [-122, -6.5], [-112, -4], [-90, -8.2]].map(([x, y]) => new THREE.Vector2(x, y)));
  const skeg = new THREE.ExtrudeGeometry(skegShape, { depth: 1.0, bevelEnabled: false });
  skeg.translate(0, 0, -0.5);
  mesh(skeg, M.under, 'Skeg', hullGroup);

  // Бортовой номер и название — участки, повторяющие обвод борта, с прозрачной текстурой
  const decal = (x0, x1, y0, y1, side, tex, name) => {
    const mat = std(name, 0xffffff, 0.7, 0.1, {
      map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    const nu = 40;
    const nv = 12;
    const geo = gridGeometry(nv + 1, nu + 1, (i, j) => {
      const x = x0 + ((x1 - x0) * i) / nu;
      const y = y0 + ((y1 - y0) * j) / nv;
      return [x, y, side * (hb(x, y) + 0.06)];
    }, () => [0, 0, side], (i, j) => [side < 0 ? 1 - i / nu : i / nu, j / nv]);
    mesh(geo, mat, name, hullGroup);
  };
  const numberTex = textTexture([{ text: '063', size: 380, y: 215, stroke: 14 }], 1024, 420, '#f4f4ee', 'HullNumber_063');
  const nameTex = textTexture([
    { text: 'АДМИРАЛ ФЛОТА СОВЕТСКОГО СОЮЗА', size: 84, y: 70 },
    { text: 'КУЗНЕЦОВ', size: 270, y: 280 },
  ], 1536, 440, '#e5bf3c', 'HullName');
  for (const [s, tag] of [[-1, 'Port'], [1, 'Starboard']]) {
    decal(94, 112, 5.2, 12.6, s, numberTex, `Markings_HullNumber_${tag}`);
    decal(113.5, 133, 4.2, 10, s, nameTex, `Markings_HullName_${tag}`);
  }

  // Клюзы и якоря
  const anchorGeo = merged([
    [new THREE.BoxGeometry(0.5, 3.4, 0.45), [0, 0, 0]],
    [new THREE.BoxGeometry(2.6, 0.5, 0.5), [0, -1.6, 0]],
    [new THREE.BoxGeometry(0.5, 1.2, 0.5), [1.15, -1.1, 0], [0, 0, -0.5]],
    [new THREE.BoxGeometry(0.5, 1.2, 0.5), [-1.15, -1.1, 0], [0, 0, 0.5]],
  ]);
  const hawseGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.3, 20).rotateX(Math.PI / 2);
  for (const [s, tag] of [[-1, 'Port'], [1, 'Starboard']]) {
    const x = 136.5;
    const y = 11;
    // Нормаль борта: градиент поверхности z = s·hb(x, y)
    const dx = hb(x + 0.5, y) - hb(x - 0.5, y);
    const yaw = Math.atan2(-dx, s);
    mesh(hawseGeo, M.dark, `Hawse_${tag}`, hullGroup, [x, y, s * (hb(x, y) + 0.05)], [0, yaw, 0]);
    mesh(anchorGeo, M.dark, `Anchor_${tag}`, hullGroup, [x - 0.3, y - 2.2, s * (hb(x - 0.3, y - 2.2) + 0.35)], [0, yaw, 0]);
  }

  // ================= Движители =================
  const prop = group('Propulsion');
  // Гребной винт: пять лопастей с шагом, ступица и обтекатель; ось — X
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, -0.35);
  bladeShape.bezierCurveTo(0.9, -0.75, 1.9, -0.6, 2.15, 0);
  bladeShape.bezierCurveTo(1.9, 0.45, 0.9, 0.55, 0, 0.35);
  bladeShape.lineTo(0, -0.35);
  const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.08, bevelEnabled: false, curveSegments: 8 });
  blade.translate(0, 0, -0.04);
  const propParts = [];
  for (let b = 0; b < 5; b++) {
    const g = blade.clone();
    g.rotateX(0.6); // шаг лопасти
    g.rotateY(Math.PI / 2); // лопасть в плоскости YZ
    g.rotateX((b / 5) * Math.PI * 2);
    propParts.push([g]);
  }
  propParts.push([new THREE.CylinderGeometry(0.45, 0.55, 1.4, 16).rotateZ(Math.PI / 2)]);
  propParts.push([new THREE.ConeGeometry(0.45, 0.9, 16).rotateZ(Math.PI / 2), [-1.1, 0, 0]]);
  const propGeo = merged(propParts.map(([g, p = [0, 0, 0]]) => [g, p]));
  const PR = 2.2;
  const shafts = [[-110, -12], [-122, -6], [-122, 6], [-110, 12]].map(([x, z], i) => ({
    x, z, y: hullBottomAt(x, z) - PR - 0.8, i: i + 1,
  }));
  const strut = new THREE.CylinderGeometry(0.22, 0.22, 1, 8);
  for (const s of shafts) {
    mesh(propGeo, M.bronze, `Propeller_${s.i}`, prop, [s.x, s.y, s.z]);
    // Вал идёт вперёд с подъёмом до входа в корпус
    const xIn = s.x + 34;
    const yIn = Math.max(s.y + 1.6, hullBottomAt(xIn, s.z) + 0.5);
    const a = new THREE.Vector3(s.x + 0.6, s.y, s.z);
    const b = new THREE.Vector3(xIn, yIn, s.z);
    const len = a.distanceTo(b);
    const shaft = mesh(new THREE.CylinderGeometry(0.35, 0.35, len, 12), M.dark, `Shaft_${s.i}`, prop,
      a.clone().add(b).multiplyScalar(0.5).toArray());
    shaft.rotation.set(0, 0, -Math.PI / 2 + Math.atan2(b.y - a.y, b.x - a.x));
    // Кронштейн гребного вала: две стойки от вала к корпусу
    const bx = s.x + 3.2;
    const by = s.y + (yIn - s.y) * (3.2 / 34);
    const parts = [];
    for (const dz of [-1, 1]) {
      const zTop = s.z + dz * 1.8;
      const top = new THREE.Vector3(bx, hullBottomAt(bx, zTop) + 0.4, zTop);
      const bot = new THREE.Vector3(bx, by, s.z);
      const l = top.distanceTo(bot);
      const g = strut.clone().scale(1, l, 1);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
      g.applyQuaternion(q);
      const m = top.clone().add(bot).multiplyScalar(0.5);
      g.translate(m.x, m.y, m.z);
      parts.push(g);
    }
    parts.push(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 12).rotateZ(Math.PI / 2).translate(bx, by, s.z));
    mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), M.under, `ShaftBracket_${s.i}`, prop);
  }
  // Рули за внутренними винтами
  [-6, 6].forEach((z, i) => {
    const x = -130;
    const top = hullBottomAt(x, z) + 0.6;
    const bottom = -7.8;
    const shape = new THREE.Shape([[2.4, top], [-2.6, top], [-2.4, bottom], [2.0, bottom + 0.3]].map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.2, bevelSegments: 2 });
    g.translate(0, 0, -0.4);
    mesh(g, M.under, `Rudder_${i + 1}`, prop, [x, 0, z]);
  });

  // ================= Полётная палуба =================
  const deckGroup = group('FlightDeck_Group');
  const nx = DECK_XS.length;
  const deckGeo = gridGeometry(nx, DECK_COLS + 1, (c, i) => {
    const x = DECK_XS[i];
    const zp = -deckHalf(x, -1);
    const zs = deckHalf(x, 1);
    return [x, deckY(x), zp + ((zs - zp) * c) / DECK_COLS];
  }, () => [0, 1, 0], (c, i) => {
    const x = DECK_XS[i];
    const zp = -deckHalf(x, -1);
    const zs = deckHalf(x, 1);
    const z = zp + ((zs - zp) * c) / DECK_COLS;
    return [(x - TEX_X0) / TEX_LX, (z - TEX_Z0) / TEX_LZ];
  });
  mesh(deckGeo, M.deck, 'FlightDeck', deckGroup);

  // Кромка палубы (торец настила) и скос спонсонов до борта
  const ringLoft = (ringA, ringB, dirFn) => {
    const pos = [];
    for (const p of ringA) pos.push(...p);
    for (const p of ringB) pos.push(...p);
    const n = ringA.length;
    const tris = [];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      tris.push([k, n + k, k2], [k2, n + k, n + k2]);
    }
    const index = [];
    pushOriented(pos, index, tris, dirFn);
    return indexedGeometry(pos, index);
  };
  const ringTop = DECK_RING.map(([x, z]) => [x, deckY(x), z]);
  const ringBottom = DECK_RING.map(([x, z]) => [x, deckY(x) - 1.0, z]);
  const ringHull = DECK_RING.map(([x, z]) => skirtHullPoint(x, z));
  const outward = (x, y, z) => [x > 151 ? 1 : x < -150 ? -1 : 0, 0, Math.sign(z)];
  mesh(ringLoft(ringTop, ringBottom, outward), M.hull, 'FlightDeck_Edge', deckGroup);
  mesh(ringLoft(ringBottom, ringHull, (x, y, z) => [x > 149 ? 1 : x < -146 ? -1 : 0, -0.4, Math.sign(z)]),
    M.hull, 'FlightDeck_Sponsons', deckGroup);

  // Бортовые самолётоподъёмники
  for (const [[x0, x1], tag] of [[ELEV_FWD, 'Fwd'], [ELEV_AFT, 'Aft']]) {
    const z1 = Math.min(deckHalf(x0, 1), deckHalf(x1, 1)) + 0.3;
    const z0 = 17.2;
    mesh(new THREE.BoxGeometry(x1 - x0, 0.7, z1 - z0), M.hatch, `Elevator_${tag}`, deckGroup,
      [(x0 + x1) / 2, DECK - 0.33, (z0 + z1) / 2]);
  }

  // Крышки 12 ПУ «Гранит» под палубой перед надстройкой
  const granitGeo = new THREE.BoxGeometry(5.6, 0.12, 4.6);
  let n = 1;
  for (const x of [69, 75.5, 82, 88.5]) {
    for (const z of [-6, 0, 6]) {
      mesh(granitGeo, M.hatch, `Granit_VLS_Cover_${String(n++).padStart(2, '0')}`, deckGroup, [x, DECK + 0.02, z]);
    }
  }
  // Барабанные ПУ «Кинжал»: 4 модуля по 6 крышек — в носу и в корме у бортов
  const kinzhalGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.12, 20);
  n = 1;
  for (const xs of [[122, 126.5, 131], [-124, -128.5, -133]]) {
    for (const s of [1, -1]) {
      for (const x of xs) {
        for (const inset of [3.4, 6.2]) {
          const z = s * (deckHalf(x, s) - inset);
          mesh(kinzhalGeo, M.hatch, `Kinzhal_Hatch_${String(n++).padStart(2, '0')}`, deckGroup,
            [x, deckY(x) + 0.03, z], [0, 0, deckSlope(x)]).rotation.order = 'XYZ';
        }
      }
    }
  }
  // Газоотбойные щиты стартовых позиций (опущены заподлицо)
  TAKEOFF.forEach(([p, q], i) => {
    const dir = new THREE.Vector2(q[0] - p[0], q[1] - p[1]).normalize();
    const yaw = Math.atan2(-dir.y, dir.x);
    mesh(new THREE.BoxGeometry(4.2, 0.18, 11), M.hatch, `JBD_${i + 1}`, deckGroup,
      [p[0] - dir.x * 13, DECK + 0.06, p[1] - dir.y * 13], [0, yaw, 0]);
  });
  // Тросы аэрофинишёра
  {
    const d = LAND_B.clone().sub(LAND_A).normalize();
    const yaw = Math.atan2(-d.y, d.x) + Math.PI / 2;
    const wire = new THREE.CylinderGeometry(0.06, 0.06, 28, 5).rotateZ(Math.PI / 2);
    [45, 57, 69, 81].forEach((s, i) => {
      mesh(wire, M.dark, `ArrestingWire_${i + 1}`, deckGroup, [LAND_A.x + d.x * s, DECK + 0.12, LAND_A.y + d.y * s], [0, yaw, 0]);
    });
  }
  // Оптическая система посадки «Луна» на левом борту
  mesh(merged([
    [new THREE.BoxGeometry(2.2, 2.6, 4.5), [0, 1.3, 0]],
    [new THREE.BoxGeometry(0.3, 0.8, 4.2), [1.2, 2.2, 0]],
  ]), M.light, 'Luna_OLS', deckGroup, [-62, DECK, -31.2]);

  // Сетки безопасности вдоль кромки палубы
  {
    const pos = [];
    const uv = [];
    const index = [];
    const strip = (x0, x1, s) => {
      const base = pos.length / 3;
      const steps = Math.max(1, Math.round((x1 - x0) / 3));
      for (let i = 0; i <= steps; i++) {
        const x = x0 + ((x1 - x0) * i) / steps;
        const e = deckHalf(x, s);
        pos.push(x, deckY(x) - 0.35, s * e, x, deckY(x) - 1.0, s * (e + 2.2));
        uv.push(x / 1.2, 0, x / 1.2, 2);
      }
      const tris = [];
      for (let i = 0; i < steps; i++) {
        const a = base + 2 * i;
        tris.push([a, a + 2, a + 3], [a, a + 3, a + 1]);
      }
      pushOriented(pos, index, tris, () => [0, 1, 0]);
    };
    strip(-140, -128, -1); strip(-117, -26, -1); strip(-14, 74, -1); strip(80, 108, -1);
    strip(-140, -128, 1); strip(-117, -110, 1); strip(-100, -76, 1); strip(-64, -54, 1); strip(60, 76, 1); strip(88, 108, 1);
    mesh(indexedGeometry(pos, index, uv), M.net, 'SafetyNets', deckGroup);
  }

  // ================= Островная надстройка =================
  const island = group('Island');
  const ip = (pts, y0, y1, mat, name, pts1 = pts) => mesh(prismGeometry(pts, y0, pts1, y1), mat, name, island);
  const islandRails = [];
  const railAround = (pts, y) => islandRails.push(railingGeometry(pts.map(([x, z]) => [x, y, z]), true));

  // Ярусы: основание у палубы, второй ярус, ходовой мостик, башня РЛС, верхний пост
  const baseP = chamferRect(-26, 30, 18.6, 31.4, 2.5);
  ip(baseP, 15.5, 25.5, M.island, 'Island_Base');
  ip(chamferRect(-22, 27, 19.6, 30.8, 2), 25.5, 31.5, M.island, 'Island_Level2', chamferRect(-21.5, 26.5, 19.9, 30.6, 2));
  railAround(chamferRect(-25.6, 29.6, 19, 31, 2.3), 25.5);
  // Пост управления полётами, выступающий к угловой палубе
  ip(chamferRect(-16, -2, 17.2, 20, 0.8), 26, 30, M.island, 'Island_FlightControl');
  ip(chamferRect(-15.8, -2.2, 17.05, 19.4, 0.8), 28.3, 29.3, M.glass, 'Island_FlightControl_Windows');
  // Ряды окон и иллюминаторов
  ip(chamferRect(-21.7, 27.3, 19.65, 30.75, 2), 28.6, 29.1, M.glass, 'Island_Level2_Windows');
  ip(chamferRect(-25.7, 30.3, 18.5, 31.5, 2.5), 22.6, 23.0, M.glass, 'Island_Base_Windows');
  // Ходовой мостик с крыльями
  ip(chamferRect(-6, 24, 20.2, 30.2, 2.5), 31.5, 37, M.island, 'Island_Bridge', chamferRect(-5, 23, 20.7, 29.7, 2.4));
  ip(chamferRect(-5.5, 24.05, 20.1, 30.3, 2.5), 35.0, 35.9, M.glass, 'Island_Bridge_Windows', chamferRect(-5.4, 23.85, 20.2, 30.2, 2.5));
  ip(chamferRect(21, 25, 18.4, 31.8, 0.6), 34.3, 34.7, M.island, 'Island_BridgeWings');
  railAround(chamferRect(-21, 26.6, 20, 30.4, 2), 31.5);
  railAround(chamferRect(21.2, 24.8, 18.6, 31.6, 0.5), 34.7);
  // Башня РЛС «Марс-Пассат»: восьмигранник с большими фасками под антенные полотна
  ip(chamferRect(0, 18, 21, 29, 3.4), 37, 50, M.island, 'Island_Tower', chamferRect(1, 17, 21.6, 28.4, 3.0));
  ip(chamferRect(-0.5, 18.5, 20.5, 29.5, 3.4), 50, 50.6, M.island, 'Island_TowerTop');
  railAround(chamferRect(-0.3, 18.3, 20.7, 29.3, 3.3), 50.6);
  railAround(chamferRect(-4.8, 22.8, 20.8, 29.6, 2.3), 37);
  const marsFrame = new THREE.CylinderGeometry(3.3, 3.3, 0.45, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8);
  const marsFace = new THREE.CylinderGeometry(2.9, 2.9, 0.1, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 0, 0.27);
  [[16.4, 22.6, 45], [16.4, 27.4, -45], [1.6, 22.6, 135], [1.6, 27.4, -135]].forEach(([x, z, a], i) => {
    // a — азимут нормали от +X; локальная +Z группы смотрит наружу, полотно отклонено назад на 12°
    const yaw = Math.atan2(Math.cos(a * DEG), -Math.sin(a * DEG));
    const out = [Math.cos(a * DEG), -Math.sin(a * DEG)];
    const g = group(`Radar_MarsPassat_${i + 1}`, island, [x + out[0] * 1.1, 44, z + out[1] * 1.1]);
    g.rotation.set(-12 * DEG, yaw, 0, 'YXZ');
    mesh(marsFrame, M.island, `Radar_MarsPassat_${i + 1}_Frame`, g);
    mesh(marsFace, M.panel, `Radar_MarsPassat_${i + 1}_Array`, g);
  });
  // Малые антенные полотна на основных гранях башни
  const smallPanel = new THREE.BoxGeometry(3.4, 2.4, 0.3);
  [[18.15, 25, 0], [-0.15, 25, 180], [9, 20.85, 90], [9, 29.15, -90]].forEach(([x, z, a], i) => {
    const yaw = Math.atan2(Math.cos(a * DEG), -Math.sin(a * DEG));
    mesh(smallPanel, M.panel, `Radar_Panel_Small_${i + 1}`, island, [x, 39.3, z], [0, yaw, 0]);
  });
  // Верхний цилиндрический пост и вращающаяся антенна «Фрегат-МА»
  mesh(new THREE.CylinderGeometry(4.3, 4.5, 5.4, 32), M.light, 'Island_TopCylinder', island, [10, 53.3, 25]);
  mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.3, 32), M.island, 'Island_TopCylinder_Deck', island, [10, 56.15, 25]);
  islandRails.push(railingGeometry(Array.from({ length: 28 }, (_, k) => {
    const a = (k / 28) * Math.PI * 2;
    return [10 + Math.cos(a) * 4.45, 56.3, 25 + Math.sin(a) * 4.45];
  }), true, 0.9, 1.2));
  mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.4, 16), M.dark, 'Radar_Fregat_Pedestal', island, [10, 57, 25]);
  const fregat = group('Radar_Fregat', island, [10, 57.7, 25]);
  const reflector = new THREE.BoxGeometry(7.6, 2.3, 0.22);
  mesh(merged([
    [reflector, [0, 1.25, 0.75], [-20 * DEG, 0, 0]],
    [reflector, [0, 1.25, -0.75], [20 * DEG, 0, 0]],
    [new THREE.BoxGeometry(1.4, 1.2, 1.2), [0, 0.6, 0]],
    [new THREE.BoxGeometry(7.6, 0.25, 0.3), [0, 0.1, 1.2]],
    [new THREE.BoxGeometry(7.6, 0.25, 0.3), [0, 0.1, -1.2]],
    [new THREE.BoxGeometry(5.0, 0.35, 0.3), [0, 2.75, 0]],
  ]), M.panel, 'Radar_Fregat_Antenna', fregat);
  // Мачта с реями и штыревыми антеннами (за цилиндром, вне круга вращения «Фрегата»)
  mesh(new THREE.CylinderGeometry(0.22, 0.4, 16, 8), M.light, 'Island_Mast', island, [1.5, 58.6, 25]);
  mesh(merged([
    [new THREE.BoxGeometry(0.2, 0.2, 8), [0, 0, 0]],
    [new THREE.BoxGeometry(0.15, 0.15, 5), [0, 3.5, 0]],
    [new THREE.CylinderGeometry(0.05, 0.05, 3, 4), [0, 1.5, 3.8]],
    [new THREE.CylinderGeometry(0.05, 0.05, 3, 4), [0, 1.5, -3.8]],
    [new THREE.BoxGeometry(1.6, 0.15, 0.15), [0.7, 5.5, 0]],
  ]), M.light, 'Island_MastYards', island, [1.5, 60, 25]);
  // Радиопрозрачные купола систем связи на площадках по бортам башни
  const radomeGeo = new THREE.SphereGeometry(1.8, 20, 12);
  const radomeBase = new THREE.CylinderGeometry(1.0, 1.2, 1.2, 12);
  [[14.5, 19.4], [5, 19.4], [14.5, 30.6], [5, 30.6]].forEach(([x, z], i) => {
    mesh(radomeBase, M.island, `Radome_${i + 1}_Base`, island, [x, 47.4, z]);
    mesh(radomeGeo, M.radome, `Radome_${i + 1}`, island, [x, 49.3, z]);
  });
  mesh(new THREE.BoxGeometry(14, 0.4, 3.6), M.island, 'Radome_Platform_Port', island, [9.75, 46.6, 19.6]);
  mesh(new THREE.BoxGeometry(14, 0.4, 3.6), M.island, 'Radome_Platform_Starboard', island, [9.75, 46.6, 30.4]);
  railAround([[2.75, 17.8], [16.75, 17.8], [16.75, 21.4], [2.75, 21.4]], 46.8);
  railAround([[2.75, 28.6], [16.75, 28.6], [16.75, 32.2], [2.75, 32.2]], 46.8);
  // Навигационные РЛС на кронштейнах
  const navGeo = merged([
    [new THREE.BoxGeometry(0.35, 0.35, 4.4), [0, 0.5, 0]],
    [new THREE.BoxGeometry(0.6, 0.4, 0.6), [0, 0.2, 0]],
  ]);
  mesh(new THREE.BoxGeometry(3, 0.4, 3), M.island, 'Radar_Nav_1_Platform', island, [19.6, 50.4, 25]);
  const nav1 = group('Radar_Nav_1', island, [19.6, 50.6, 25]);
  mesh(navGeo, M.dark, 'Radar_Nav_1_Antenna', nav1);
  // Дымовая труба в корме надстройки, с наклоном назад и газоотводами
  ip(chamferRect(-24, -6, 21.2, 29.8, 2), 31.5, 41.5, M.island, 'Funnel', chamferRect(-26.5, -10.5, 21.8, 29.2, 2));
  ip(chamferRect(-26.9, -10.1, 21.4, 29.6, 2), 41.5, 42.1, M.dark, 'Funnel_Cap');
  const exhaust = new THREE.BoxGeometry(3.2, 0.9, 2.6);
  [[-23, 23.6], [-23, 27.4], [-18.5, 23.6], [-18.5, 27.4]].forEach(([x, z], i) => {
    mesh(exhaust, M.dark, `Funnel_Exhaust_${i + 1}`, island, [x, 42.5, z]);
  });
  // Кормовая мачта со второй РЛС
  mesh(new THREE.CylinderGeometry(0.25, 0.4, 13, 8), M.light, 'Funnel_Mast', island, [-8, 47.5, 25.5]);
  mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), M.island, 'Radar_Nav_2_Platform', island, [-8, 51.5, 25.5]);
  const nav2 = group('Radar_Nav_2', island, [-8, 51.7, 25.5]);
  mesh(navGeo, M.dark, 'Radar_Nav_2_Antenna', nav2);
  // Спутниковые антенны (закрытые тарелки) и прожекторы
  const dish = merged([
    [new THREE.CylinderGeometry(0.95, 0.25, 0.45, 16), [0, 0, 0], [Math.PI / 2, 0, 0]],
    [new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), [0, -0.6, 0]],
  ]);
  [[22.8, 37, 21.5], [22.8, 37, 28.5], [-2, 37, 21], [-2, 37, 29]].forEach(([x, y, z], i) => {
    mesh(dish, M.light, `Island_Dish_${i + 1}`, island, [x, y + 1.2, z], [-0.5, i * 1.3, 0]);
  });
  const lamp = new THREE.CylinderGeometry(0.45, 0.45, 0.7, 12).rotateZ(Math.PI / 2);
  [[23.6, 21.2], [23.6, 28.8], [-25.8, 20], [-25.8, 30]].forEach(([x, z], i) => {
    mesh(lamp, M.dark, `Island_Searchlight_${i + 1}`, island, [x, x > 0 ? 32.4 : 26.1, z]);
  });
  mesh(mergeGeometries(islandRails), M.rail, 'Railings_Island', island);

  // ================= Вооружение =================
  const arms = group('Armament');
  // Боевой модуль «Каштан»: башня, две спарки АО-18, пакеты ракет, РЛС сопровождения
  const kashtanBody = merged([
    [new THREE.CylinderGeometry(1.35, 1.55, 1.0, 16), [0, 0.5, 0]],
    [new THREE.BoxGeometry(2.4, 1.3, 2.4), [0, 1.65, 0]],
    [new THREE.BoxGeometry(1.0, 0.7, 1.1), [0.1, 2.65, 0]],
    [new THREE.BoxGeometry(1.5, 0.55, 0.55), [0.5, 1.5, 1.55]],
    [new THREE.BoxGeometry(1.5, 0.55, 0.55), [0.5, 1.5, -1.55]],
    [new THREE.BoxGeometry(2.2, 0.55, 0.6), [0.4, 2.2, 1.6]],
    [new THREE.BoxGeometry(2.2, 0.55, 0.6), [0.4, 2.2, -1.6]],
  ]);
  const barrel = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6).rotateZ(Math.PI / 2);
  const kashtanDark = merged([
    [barrel, [2.4, 1.5, 1.45]], [barrel, [2.4, 1.5, 1.65]],
    [barrel, [2.4, 1.5, -1.45]], [barrel, [2.4, 1.5, -1.65]],
    [new THREE.CylinderGeometry(0.42, 0.42, 0.14, 14).rotateZ(Math.PI / 2), [0.68, 2.75, 0]],
    [new THREE.BoxGeometry(0.06, 0.45, 0.5), [1.53, 2.2, 1.6]],
    [new THREE.BoxGeometry(0.06, 0.45, 0.5), [1.53, 2.2, -1.6]],
  ]);
  // АК-630: колпак башни и шестиствольный блок
  const ak630Body = merged([
    [new THREE.CylinderGeometry(1.05, 1.15, 0.6, 16), [0, 0.3, 0]],
    [new THREE.SphereGeometry(1.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.6, 0]],
  ]);
  const ak630Gun = merged([
    [new THREE.CylinderGeometry(0.17, 0.17, 2.2, 8).rotateZ(Math.PI / 2), [1.6, 1.1, 0]],
    [new THREE.CylinderGeometry(0.28, 0.28, 0.6, 8).rotateZ(Math.PI / 2), [0.9, 1.1, 0]],
  ]);
  // РБУ-12000 «Удав»: десять стволов в два ряда на поворотной тумбе
  const tube = new THREE.CylinderGeometry(0.15, 0.15, 2.4, 8).rotateZ(Math.PI / 2);
  const rbuTubes = [];
  for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) rbuTubes.push([tube, [0.6, 1.6 + r * 0.34, (k - 2) * 0.34]]);
  const rbuGeo = merged([
    [new THREE.CylinderGeometry(0.9, 1.0, 0.9, 14), [0, 0.45, 0]],
    [new THREE.BoxGeometry(1.4, 0.8, 2.0), [0, 1.2, 0]],
    ...rbuTubes.map(([g, p]) => [g, p, [0, 0, 0.45]]),
  ]);

  // Спонсон: площадка за кромкой палубы с откосом к борту
  const sponsonRails = [];
  const sponson = (name, x0, x1, s, ext) => {
    const xm = (x0 + x1) / 2;
    const yP = deckY(xm) - 2.6;
    const zEdge = Math.max(deckHalf(x0, s), deckHalf(x1, s), deckHalf(xm, s));
    const zin = zEdge - 4;
    const zout = zEdge + ext;
    const top = [[x0, zin], [x1, zin], [x1, zout - 1.5], [x1 - 1.5, zout], [x0 + 1.5, zout], [x0, zout - 1.5]];
    const bot = top.map(([x, z]) => [x, zin + (z - zin) * 0.12]);
    const flip = (pts) => pts.map(([x, z]) => [x, s * z]);
    mesh(prismGeometry(flip(bot), yP - 4.5, flip(top), yP), M.hull, name, arms);
    sponsonRails.push(railingGeometry(flip([[x0, zEdge - 0.5], [x0, zout - 1.5], [x0 + 1.5, zout], [x1 - 1.5, zout], [x1, zout - 1.5], [x1, zEdge - 0.5]])
      .map(([x, z]) => [x, yP, z])));
    return { y: yP, z: s * (zout - 2.3) };
  };
  const ciws = (name, body, darkGeo, pos, yaw) => {
    const g = group(name, arms, pos, yaw);
    mesh(body, M.weapon, `${name}_Body`, g);
    mesh(darkGeo, M.dark, `${name}_Guns`, g);
  };
  let k = 1;
  for (const [x0, x1] of [[110, 124], [-128, -114]]) {
    for (const s of [-1, 1]) {
      const sp = sponson(`Sponson_Kashtan_${s < 0 ? 'Port' : 'Starboard'}_${x0 > 0 ? 'Fwd' : 'Aft'}`, x0, x1, s, 5);
      const face = x0 > 0 ? -s * 60 * DEG : -s * 120 * DEG;
      ciws(`CIWS_Kashtan_${k++}`, kashtanBody, kashtanDark, [x0 + 3.5, sp.y, sp.z], face);
      ciws(`CIWS_Kashtan_${k++}`, kashtanBody, kashtanDark, [x1 - 3.5, sp.y, sp.z], face);
    }
  }
  k = 1;
  for (const [x, s] of [[72, -1], [-18, -1], [-100, -1], [84, 1], [-68, 1], [-100, 1]]) {
    const sp = sponson(`Sponson_AK630_${k}`, x - 3, x + 3, s, 3.2);
    ciws(`AK630_${k}`, ak630Body, ak630Gun, [x, sp.y, s * (Math.abs(sp.z) + 0.6)], -s * 90 * DEG);
    k++;
  }
  [-1, 1].forEach((s, i) => {
    const sp = sponson(`Sponson_RBU_${i + 1}`, -142, -135, s, 3);
    mesh(rbuGeo, M.weapon, `RBU12000_${i + 1}`, arms, [-138.5, sp.y, sp.z], [0, s * 150 * DEG, 0]);
  });
  mesh(mergeGeometries(sponsonRails), M.rail, 'Railings_Sponsons', arms);

  // ================= Оборудование =================
  const equip = group('Equipment');
  // Точка на скосе спонсона: t = 0 у кромки палубы, 1 у борта
  const skirtAt = (x, s, t) => {
    const e = deckHalf(x, s) * s;
    const yb = deckY(x) - 1.0;
    const h = skirtHullPoint(x, e);
    return [x + (h[0] - x) * t, yb + (h[1] - yb) * t, e + (h[2] - e) * t];
  };
  // Стеллажи спасательных плотов ПСН-10 под кромкой палубы
  const raft = new THREE.CylinderGeometry(0.38, 0.38, 1.5, 10).rotateX(Math.PI / 2);
  const rackParts = [[new THREE.BoxGeometry(7.6, 0.15, 2.2), [0, -0.1, 0]]];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 8; c++) rackParts.push([raft, [(c - 3.5) * 0.92, 0.38 + r * 0.76, 0]]);
  const rackGeo = merged(rackParts);
  n = 1;
  for (const [x, s] of [[-122, 1], [-113, 1], [-96, 1], [-88, 1], [-30, -1], [-40, -1], [100, -1], [92, -1], [96, 1], [-90, -1], [10, -1]]) {
    const [px, py, pz] = skirtAt(x, s, 0.35);
    mesh(rackGeo, M.raft, `Liferafts_${String(n++).padStart(2, '0')}`, equip, [px, py - 1.6, pz + s * 1.6]);
  }
  // Катера под свесом палубы на шлюпбалках
  const boatHull = loftGeometry([[5.2, 0.05, 0.05, 0.6], [4.4, 0.9, 0.7, 0.7], [2, 1.5, 0.9, 0.8], [-3, 1.5, 0.9, 0.8], [-4.8, 1.3, 0.8, 0.85], [-5, 1.2, 0.6, 0.9]], 12);
  const boatCabin = merged([[new THREE.BoxGeometry(4, 1.3, 2.2), [0.4, 1.9, 0]], [new THREE.BoxGeometry(1.8, 0.3, 2.4), [0.6, 2.6, 0]]]);
  n = 1;
  for (const [x, s] of [[-78, 1], [-104, 1], [-64, -1]]) {
    const [px, py, pz] = skirtAt(x, s, 0.55);
    const g = group(`Boat_${n}`, equip, [px, py - 3.4, pz + s * 2.6]);
    mesh(boatHull, M.boat, `Boat_${n}_Hull`, g);
    mesh(boatCabin, M.orange, `Boat_${n}_Cabin`, g);
    mesh(merged([[new THREE.BoxGeometry(0.3, 3.4, 0.3), [3, 2.6, -s * 1.4]], [new THREE.BoxGeometry(0.3, 3.4, 0.3), [-3, 2.6, -s * 1.4]]]),
      M.dark, `Boat_${n}_Davits`, g);
    n++;
  }
  // Откидные штыревые антенны на кромке палубы
  n = 1;
  for (const [x, s, h] of [[2, -1, 14], [-32, -1, 12], [-138, 1, 11], [-138, -1, 11], [62, 1, 10]]) {
    const z = s * (deckHalf(x, s) + 0.6);
    mesh(new THREE.CylinderGeometry(0.06, 0.16, h, 6), M.light, `Antenna_Whip_${n++}`, equip, [x, deckY(x) - 1 + h / 2, z]);
  }
  // Леерное ограждение по кормовому срезу
  mesh(railingGeometry(Array.from({ length: 11 }, (_, i) => {
    const z = -14 + i * 2.8;
    return [DECK_AFT + 0.2, deckY(DECK_AFT + 0.2), z];
  })), M.rail, 'Railings_Stern', equip);

  // ================= Авиагруппа =================
  const air = group('AirWing');
  const su33 = jetType({ len: 1, canards: true, paint: M.su33, fin: 0 }, M);
  const mig29 = jetType({ len: 0.82, canards: false, paint: M.mig, fin: 6 * DEG }, M);
  const ka27 = helicopterType(M);
  const place = (factory, name, x, z, headingDeg, opts) => {
    const g = factory(name, opts);
    g.position.set(x, deckY(x), z);
    g.rotation.y = headingDeg * DEG;
    air.add(g);
  };
  const lane = (i) => {
    const [p, q] = TAKEOFF[i];
    return Math.atan2(-(q[1] - p[1]), q[0] - p[0]) / DEG;
  };
  // На стартовых позициях и у надстройки — с развёрнутыми крыльями
  place(su33, 'Su33_01', 52, 5, lane(0), { folded: false });
  place(su33, 'Su33_02', 52, -9, lane(1), { folded: false });
  place(su33, 'Su33_03', -31, -22.7, lane(2), { folded: false });
  place(su33, 'Su33_04', 14, 2, 30, { folded: false });
  // Стоянка вдоль правого борта за надстройкой — крылья сложены, хвосты к борту
  [[-62, 21], [-73, 20.5], [-84, 20], [-95, 19.5], [-106, 18.5]].forEach(([x, z], i) => {
    place(su33, `Su33_${String(i + 5).padStart(2, '0')}`, x, z, 62, { folded: true });
  });
  place(su33, 'Su33_10', 40, 22, 75, { folded: true });
  place(mig29, 'MiG29K_01', -117, 17, 60, { folded: true });
  place(mig29, 'MiG29K_02', 64, 20, 70, { folded: true });
  // Вертолёты Ка-27 на корме и у трамплина
  [[-95, -14, 20], [-113, -9, 10], [-131, -3, 0], [76, -15, -15], [104, 8, 180]].forEach(([x, z, h], i) => {
    place(ka27, `Ka27_0${i + 1}`, x, z, h, {});
  });
  // Пожарная машина и тягач у надстройки
  const truck = (name, mat, x, z, yaw) => {
    const g = group(name, air, [x, DECK, z], yaw * DEG);
    mesh(merged([[new THREE.BoxGeometry(7, 2.2, 2.5), [-0.6, 1.6, 0]], [new THREE.BoxGeometry(2, 2.3, 2.5), [3.6, 1.65, 0]]]),
      mat, `${name}_Body`, g);
    const wheel = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12).rotateX(Math.PI / 2);
    mesh(merged([[-3, 1.25], [-3, -1.25], [3.4, 1.25], [3.4, -1.25]].map(([wx, wz]) => [wheel, [wx, 0.5, wz]])),
      M.tire, `${name}_Wheels`, g);
  };
  truck('Vehicle_FireTruck', M.truck, 34, 15, 180);
  truck('Vehicle_Tug', M.tug, -20, 15.5, 90);

  // ================= Анимация: вращение РЛС =================
  const radars = [
    { node: fregat, period: 6 },
    { node: nav1, period: 3 },
    { node: nav2, period: 2.4 },
  ];
  const DURATION = 12; // кратно всем периодам — клип зацикливается без скачка
  const tracks = radars.map(({ node, period }) => {
    const turns = DURATION / period;
    const steps = Math.round(turns * 12); // ключ каждые 30°
    const times = [];
    const values = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i <= steps; i++) {
      const t = (DURATION * i) / steps;
      times.push(t);
      // Угол без взятия по модулю: соседние ключи не меняют знак кватерниона
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (2 * Math.PI * t) / period);
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values);
  });
  ship.animations = [new THREE.AnimationClip('RadarRotation', DURATION, tracks)];

  ship.userData.update = (time) => {
    for (const { node, period } of radars) node.rotation.y = ((time % period) / period) * Math.PI * 2;
  };

  return ship;
}

// ---------- Самолёты (низкая детализация, геометрия общая для всех экземпляров) ----------

// Реактивный истребитель схемы Су-27: фюзеляж, мотогондолы, крыло со складываемой консолью,
// ПГО (у Су-33), стабилизаторы, два киля, фонарь, шасси. МиГ-29К — тот же набор в масштабе.
function jetType({ len, canards, paint, fin }, M) {
  const S = len;
  const sc = (pts) => pts.map((p) => p.map((v) => v * S));
  const fus = loftGeometry(sc([[10.6, 0.03, 0.03, 2.1], [9.8, 0.35, 0.35, 2.15], [8.5, 0.6, 0.62, 2.22], [6.8, 0.82, 0.85, 2.32],
    [5, 1.0, 0.95, 2.4], [3, 1.5, 0.85, 2.35], [0, 2.3, 0.65, 2.3], [-4, 2.3, 0.6, 2.3], [-7, 1.9, 0.55, 2.35],
    [-9, 1.4, 0.48, 2.4], [-10.4, 0.5, 0.3, 2.45]]), 18);
  const nac = (s) => loftGeometry(sc([[3.6, 0.62, 0.55, 1.62], [2.5, 0.72, 0.68, 1.62], [-4, 0.75, 0.72, 1.7], [-8.5, 0.68, 0.66, 1.85],
    [-10.3, 0.58, 0.56, 1.92]]), 14, s * 1.25 * S);
  const body = merged([[fus], [nac(1)], [nac(-1)]]);
  const plate = (pts, t) => plateGeometry(sc(pts), t * S);
  const innerWing = plate([[7.5, 0.9], [2, 2.2], [0.66, 3.7], [-5.77, 3.7], [-6.6, 2.0], [-6.6, 0.9]], 0.2);
  const outerWing = plate([[0.66, 0], [-2.6, 3.65], [-4.0, 3.65], [-5.77, 0]], 0.16);
  const stab = plate([[-8.2, 1.5], [-10.4, 4.4], [-11.3, 4.4], [-11.1, 1.5]], 0.12);
  const canard = plate([[6.2, 0.9], [4.8, 3.1], [4.2, 3.1], [4.5, 0.9]], 0.1);
  const finShape = new THREE.Shape(sc([[-6.6, 0], [-9.9, 3.3], [-11.0, 3.3], [-10.8, 0]]).map(([x, y]) => new THREE.Vector2(x, y)));
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.14 * S, bevelEnabled: false });
  const sideParts = (geo, y, z = 0) => [[geo, [0, y * S, z]], [mirrorZ(geo), [0, y * S, -z]]];
  const fixed = merged([
    ...sideParts(innerWing, 2.35), ...sideParts(stab, 2.35),
    ...(canards ? sideParts(canard, 2.55) : []),
    [finGeo, [0, 2.6 * S, 2.0 * S], [-fin, 0, 0]],
    [finGeo, [0, 2.6 * S, -2.14 * S], [fin, 0, 0]],
  ]);
  const outerR = outerWing;
  const outerL = mirrorZ(outerWing);
  const canopy = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.6 * S, 0.62 * S, 0.5 * S).translate(6.6 * S, 2.95 * S, 0);
  const nozzles = merged([1, -1].map((s) => [new THREE.CylinderGeometry(0.55 * S, 0.5 * S, 1.0 * S, 12).rotateZ(Math.PI / 2), [-10.7 * S, 1.92 * S, s * 1.25 * S]]));
  const leg = new THREE.CylinderGeometry(0.1, 0.1, 1.6 * S, 6);
  const legs = merged([[leg, [7.4 * S, 0.9 * S, 0]], [leg, [-1.2 * S, 0.9 * S, 2.2 * S]], [leg, [-1.2 * S, 0.9 * S, -2.2 * S]]]);
  const wheel = (r) => new THREE.CylinderGeometry(r, r, 0.3, 12).rotateX(Math.PI / 2);
  const wheels = merged([[wheel(0.35), [7.4 * S, 0.35, 0.25]], [wheel(0.35), [7.4 * S, 0.35, -0.25]],
    [wheel(0.5), [-1.2 * S, 0.5, 2.2 * S]], [wheel(0.5), [-1.2 * S, 0.5, -2.2 * S]]]);

  return (name, { folded }) => {
    const g = new THREE.Group();
    g.name = name;
    const add = (geo, mat, part, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = `${name}_${part}`;
      parent.add(m);
      return m;
    };
    add(body, paint, 'Fuselage');
    add(fixed, paint, 'Wings');
    // Консоли крыла на шарнирах складывания
    for (const [s, geo, tag] of [[1, outerR, 'R'], [-1, outerL, 'L']]) {
      const hinge = new THREE.Group();
      hinge.name = `${name}_WingFold_${tag}`;
      hinge.position.set(0, 2.35 * S, s * 3.7 * S);
      hinge.rotation.x = folded ? -s * 100 * DEG : 0;
      g.add(hinge);
      add(geo, paint, `OuterWing_${tag}`, hinge);
    }
    add(canopy, M.canopy, 'Canopy');
    add(nozzles, M.nozzle, 'Nozzles');
    add(legs, M.nozzle, 'GearLegs');
    add(wheels, M.tire, 'Wheels');
    return g;
  };
}

// Ка-27: фюзеляж, капот двигателей, соосные трёхлопастные винты, двухкилевое оперение, шасси
function helicopterType(M) {
  const fus = loftGeometry([[5.7, 0.2, 0.5, 1.9], [5.1, 1.1, 1.05, 1.95], [3.6, 1.6, 1.35, 2.15], [0, 1.75, 1.45, 2.25],
    [-2.6, 1.6, 1.35, 2.35], [-3.6, 0.9, 0.85, 2.65], [-5.6, 0.38, 0.4, 2.75], [-6.0, 0.08, 0.1, 2.75]], 20);
  const body = merged([
    [fus],
    [new THREE.BoxGeometry(4.6, 1.0, 2.2), [0.3, 3.9, 0]],
    [new THREE.BoxGeometry(1.0, 0.12, 4.6), [-5.6, 2.8, 0]],
    [new THREE.BoxGeometry(1.6, 1.7, 0.12), [-5.7, 3.0, 2.3]],
    [new THREE.BoxGeometry(1.6, 1.7, 0.12), [-5.7, 3.0, -2.3]],
  ]);
  const glass = loftGeometry([[5.55, 0.3, 0.35, 2.55], [4.9, 1.0, 0.65, 2.65], [3.9, 1.2, 0.6, 2.75]], 12);
  const mast = merged([
    [new THREE.CylinderGeometry(0.22, 0.28, 1.9, 10), [0, 5.3, 0]],
    [new THREE.CylinderGeometry(0.45, 0.45, 0.35, 10), [0, 4.9, 0]],
    [new THREE.CylinderGeometry(0.4, 0.4, 0.35, 10), [0, 6.05, 0]],
  ]);
  const bladeGeo = new THREE.BoxGeometry(7.6, 0.08, 0.45).translate(3.9, 0, 0);
  const rotor = (y, phase) => merged([0, 1, 2].map((b) => [bladeGeo, [0, y, 0], [0, phase + (b * 2 * Math.PI) / 3, 0]]));
  const rotors = merged([[rotor(4.95, 0.3)], [rotor(6.1, 1.2)]]);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10).rotateX(Math.PI / 2);
  const gear = merged([[wheel, [3.2, 0.33, 1.0]], [wheel, [3.2, 0.33, -1.0]], [wheel, [-1.6, 0.33, 1.6]], [wheel, [-1.6, 0.33, -1.6]]]);
  return (name) => {
    const g = new THREE.Group();
    g.name = name;
    const add = (geo, mat, part) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = `${name}_${part}`;
      g.add(m);
    };
    add(body, M.ka27, 'Fuselage');
    add(glass, M.canopy, 'Glazing');
    add(mast, M.nozzle, 'RotorHead');
    add(rotors, M.nozzle, 'Rotors');
    add(gear, M.tire, 'Wheels');
    return g;
  };
}
