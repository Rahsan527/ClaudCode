import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Атомная подводная лодка специального назначения К-329 «Белгород», проект 09853
// (удлинённый «Антей» пр. 949А). Только внешний вид, масштаб 1:1 в метрах.
// Ось Y вверх, нос смотрит в +X, начало координат — мидель на диаметральной плоскости,
// y = 0 — надводная ватерлиния. Правый борт — +Z, левый — −Z.
// Прочный и лёгкий корпус не разделяем: наружный корпус строится лофтом по шпангоутам
// (сечение — сплюснутый суперэллипс), рубка — лофтом по горизонтальным срезам.
// Полезные нагрузки (НПА, «Лошарик», «Посейдоны», «Клавесин») — отдельные группы Payload_*,
// их можно скрыть.

// Главные размеры корпуса
const HULL = {
  xNose: 92, // носовая точка
  xTail: -88, // конец кормового конуса
  halfBeam: 9.1, // полуширина (ширина 18.2 м)
  top: 5.4, // верх лёгкого корпуса над ватерлинией
  keel: -9.2, // киль (осадка в надводном положении ~9.2 м)
  stations: 240,
  ring: 96, // точек по обводу шпангоута (чётное)
  sonarRow: 28, // ряд по обводу, по которому проходит граница обтекателя ГАС
};
const TEX_SPAN = 4.8; // метров на один повтор текстуры резиновых плиток

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
// Эллиптическое скругление носа: 1 при t ≤ 0, 0 при t = 1
const ell = (t, p) => (t <= 0 ? 1 : t >= 1 ? 0 : (1 - t ** p) ** (1 / p));
// Кормовой конус: почти прямое сужение со скруглённым концом
const tailG = (t, p) => (t <= 0 ? 1 : t >= 1 ? 0 : 0.9 * (1 - t ** p) + 0.1 * Math.sqrt(1 - t ** 24));

// Параметры шпангоута в сечении x: центр по высоте, полуширина, полувысоты, показатели суперэллипса
export function hullSection(x) {
  const yc = -1.9 + 0.5 * smooth((x - 60) / 32) + 0.1 * smooth((-36 - x) / 52);
  let hw = HULL.halfBeam;
  let hT = HULL.top - yc;
  let hB = yc - HULL.keel;
  let nt = 2.7;
  let nb = 2.3;
  if (x > 50) {
    hw *= ell((x - 62) / 30, 2.6);
    hT *= ell((x - 64) / 28, 2.4);
    hB *= ell((x - 54) / 38, 2.2);
  }
  if (x < -36) {
    const t = (-36 - x) / 52;
    hw *= tailG(t, 1.7);
    hT *= tailG(t, 1.6);
    hB *= tailG(t, 1.8);
    const k = smooth(t);
    nt -= 0.7 * k;
    nb -= 0.3 * k;
  }
  return { yc, hw, hT, hB, nt, nb };
}

// Точка обвода шпангоута по параметру th (0 — верх, π/2 — правый борт, π — киль)
function sectionPoint(S, th) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const up = c >= 0;
  const e = 2 / (up ? S.nt : S.nb);
  return {
    y: S.yc + (up ? S.hT : -S.hB) * Math.abs(c) ** e,
    z: S.hw * Math.sign(s) * Math.abs(s) ** e,
  };
}

// Неявная функция поверхности корпуса: < 1 внутри, 1 на обшивке
export function hullF(x, y, z) {
  if (x >= HULL.xNose || x <= HULL.xTail) return 99;
  const S = hullSection(x);
  const dy = y - S.yc;
  const up = dy >= 0;
  const n = up ? S.nt : S.nb;
  const h = up ? S.hT : S.hB;
  if (S.hw < 1e-4 || h < 1e-4) return 99;
  return Math.abs(z / S.hw) ** n + Math.abs(dy / h) ** n;
}

// Высота верха корпуса в точке (x, z)
export function hullTopY(x, z = 0) {
  const S = hullSection(x);
  const q = Math.min(1, Math.abs(z / S.hw) ** S.nt);
  return S.yc + S.hT * (1 - q) ** (1 / S.nt);
}

// Точка на борту side (+1 правый, −1 левый) на высоте y и нормаль наружу
function hullSurface(x, y, side) {
  const S = hullSection(x);
  const dy = y - S.yc;
  const up = dy >= 0;
  const n = up ? S.nt : S.nb;
  const h = up ? S.hT : S.hB;
  const q = Math.min(1, Math.abs(dy / h) ** n);
  const z = side * S.hw * (1 - q) ** (1 / n);
  const p = new THREE.Vector3(x, y, z);
  const e = 0.02;
  const g = new THREE.Vector3(
    hullF(x + e, y, z) - hullF(x - e, y, z),
    hullF(x, y + e, z) - hullF(x, y - e, z),
    hullF(x, y, z + e) - hullF(x, y, z - e),
  );
  return { point: p, normal: g.normalize() };
}

// Нормаль в произвольной точке у поверхности
function hullNormal(p) {
  const e = 0.02;
  return new THREE.Vector3(
    hullF(p.x + e, p.y, p.z) - hullF(p.x - e, p.y, p.z),
    hullF(p.x, p.y + e, p.z) - hullF(p.x, p.y - e, p.z),
    hullF(p.x, p.y, p.z + e) - hullF(p.x, p.y, p.z - e),
  ).normalize();
}

// ---------------------------------------------------------------------------
// Геометрические помощники

function stripForMerge(g) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.clearGroups();
  return out;
}
const merge = (list) => mergeGeometries(list.map(stripForMerge));

// Замкнутая сетка: если знаковый объём отрицательный — нормали смотрят внутрь, переворачиваем
function ensureOutward(g) {
  const p = g.attributes.position;
  const idx = g.index;
  const cnt = idx ? idx.count : p.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < cnt; i += 3) {
    a.fromBufferAttribute(p, idx ? idx.getX(i) : i);
    b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1);
    c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2);
    vol += a.dot(b.clone().cross(c));
  }
  const flip = vol < 0;
  if (flip) {
    if (idx) {
      for (let i = 0; i < cnt; i += 3) {
        const t = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, t);
      }
    } else {
      for (const key of Object.keys(g.attributes)) {
        const at = g.attributes[key];
        for (let i = 0; i < at.count; i += 3) {
          for (let k = 0; k < at.itemSize; k++) {
            const t = at.getComponent(i + 1, k);
            at.setComponent(i + 1, k, at.getComponent(i + 2, k));
            at.setComponent(i + 2, k, t);
          }
        }
      }
    }
  }
  if (!g.attributes.normal || (flip && idx)) g.computeVertexNormals();
  else if (flip) {
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  }
  return g;
}

// Кубическая проекция UV в метрах (для деталей с резиновым покрытием)
function boxUV(g, span = TEX_SPAN) {
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
    if (ay >= ax && ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
    else if (az >= ax) [u, v] = [p.getX(i), p.getY(i)];
    else [u, v] = [p.getZ(i), p.getY(i)];
    uv[i * 2] = u / span;
    uv[i * 2 + 1] = v / span;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Тело вращения вдоль оси X: профиль [[r, x], ...] от кормы к носу
function latheX(profile, seg = 32, phiStart = 0, phiLength = Math.PI * 2) {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), seg, phiStart, phiLength);
  g.rotateZ(-Math.PI / 2);
  return g;
}

// Кольцо (насадка винта, бандаж): замкнутый профиль сечения, повёрнутый вокруг оси X
function ringX(rIn, rOut, x0, x1, seg = 32) {
  const prof = [
    [rIn, x0], [rIn, x1], [(rIn + rOut) / 2 + 0.02, x1 + 0.02], [rOut, x1 - (x1 - x0) * 0.15], [rOut, x0 + (x1 - x0) * 0.2], [(rIn + rOut) / 2, x0 - 0.04], [rIn, x0],
  ];
  return ensureOutward(latheX(prof, seg));
}

// Профиль NACA 00xx: полутолщина в точке c ∈ [0, 1] хорды
const naca = (c) => 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);

// Крыло/стабилизатор: хорда вдоль X (передняя кромка — большее x), размах вдоль +Y,
// толщина вдоль Z. Корень на y = 0, законцовка на y = span.
function foilGeometry({ span, rootLE, rootTE, tipLE, tipTE, rootT, tipT, segs = 14, rows = 6 }) {
  const ring = [];
  for (let k = 0; k <= segs; k++) ring.push(0.5 - 0.5 * Math.cos((Math.PI * k) / segs));
  const loop = [];
  for (let k = segs; k >= 0; k--) loop.push([ring[k], 1]);
  for (let k = 1; k < segs; k++) loop.push([ring[k], -1]);
  const M = loop.length;
  const pos = [];
  const idx = [];
  for (let r = 0; r <= rows; r++) {
    const s = r / rows;
    const le = rootLE + (tipLE - rootLE) * s;
    const te = rootTE + (tipTE - rootTE) * s;
    const th = rootT + (tipT - rootT) * s;
    const chord = le - te;
    for (const [c, sg] of loop) pos.push(le - c * chord, s * span, sg * th * naca(c));
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < M; k++) {
      const a = r * M + k;
      const b = r * M + ((k + 1) % M);
      idx.push(a, b, b + M, a, b + M, a + M);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Торцы: веер из центра хорды, со своими вершинами (резкая кромка)
  const caps = [];
  for (const r of [0, rows]) {
    const s = r / rows;
    const le = rootLE + (tipLE - rootLE) * s;
    const te = rootTE + (tipTE - rootTE) * s;
    const cp = [];
    const c = new THREE.Vector3((le + te) / 2, s * span, 0);
    for (let k = 0; k < M; k++) {
      const a = r * M + k;
      const b = r * M + ((k + 1) % M);
      cp.push(c.x, c.y, c.z, pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.computeVertexNormals();
    if (cg.attributes.normal.getY(0) * (r === 0 ? -1 : 1) < 0) {
      const pa = cg.attributes.position.array;
      for (let i = 0; i < pa.length; i += 9) for (let k = 0; k < 3; k++) [pa[i + 3 + k], pa[i + 6 + k]] = [pa[i + 6 + k], pa[i + 3 + k]];
      cg.computeVertexNormals();
    }
    caps.push(cg);
  }
  // Боковины: нормаль на передней кромке должна смотреть вперёд (+X)
  if (g.attributes.normal.getX(segs) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return merge([g, ...caps]);
}

// Тонкий брус между двумя точками
function beamBetween(a, b, w, h = w) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(b, a, Math.abs(b.x - a.x) + Math.abs(b.z - a.z) < 1e-4 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

// Поставить геометрию на обшивку: локальная +Z смотрит по нормали
function placeOnHull(g, point, normal, offset = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const m = new THREE.Matrix4().compose(point.clone().addScaledVector(normal, offset), q, new THREE.Vector3(1, 1, 1));
  return g.clone().applyMatrix4(m);
}

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

// Детерминированный генератор (одинаковый узор плиток при каждой сборке)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------

export function createBelgorod() {
  const sub = new THREE.Group();
  sub.name = 'Belgorod_K329';

  // Противогидролокационное покрытие: сетка резиновых плиток (4 × 6 плиток на 4.8 м)
  const tileTex = canvasTexture(512, 512, (c, w, h) => {
    const rand = rng(329);
    const nx = 4;
    const ny = 6;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const v = 30 + Math.round((rand() - 0.5) * 6);
        c.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
        c.fillRect((i * w) / nx, (j * h) / ny, w / nx, h / ny);
      }
    }
    c.strokeStyle = 'rgb(48,51,55)';
    c.lineWidth = 3;
    for (let i = 0; i <= nx; i++) {
      c.beginPath(); c.moveTo((i * w) / nx, 0); c.lineTo((i * w) / nx, h); c.stroke();
    }
    for (let j = 0; j <= ny; j++) {
      c.beginPath(); c.moveTo(0, (j * h) / ny); c.lineTo(w, (j * h) / ny); c.stroke();
    }
  });

  const std = (name, color, roughness = 0.7, metalness = 0.1, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const M = {
    hull: std('Hull_Anechoic_Tiles', 0xffffff, 0.82, 0.05, { map: tileTex }),
    black: std('Hull_Black', 0x1d1f22, 0.8, 0.1),
    dark: std('Opening_Dark', 0x060707, 0.95, 0.0),
    sonar: std('Sonar_Fairing_Cream', 0xd8ceb0, 0.6, 0.0),
    metal: std('Metal_Dark', 0x3a3f45, 0.45, 0.7),
    bronze: std('Propeller_Bronze', 0xa98a52, 0.35, 0.9),
    glass: std('Window_Glass', 0x7fc8d8, 0.15, 0.3, { emissive: 0x0d2a30 }),
    mast: std('Mast_Grey', 0x2d3136, 0.6, 0.4),
    orange: std('DSRV_Orange', 0xe2581b, 0.55, 0.05),
    white: std('DSRV_White', 0xeceeea, 0.55, 0.05),
    blue: std('Losharik_Blue', 0x1d3f7a, 0.55, 0.2),
    blueDark: std('Losharik_Dark', 0x15191f, 0.7, 0.15),
    red: std('Losharik_Duct_Red', 0xb8361c, 0.5, 0.2),
    poseidon: std('Poseidon_Grey', 0x8d949a, 0.45, 0.45),
    yellow: std('Klavesin_Yellow', 0xe2c21c, 0.5, 0.1),
  };

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
  // ЛЁГКИЙ КОРПУС: лофт по шпангоутам, нижняя часть носа — обтекатель ГАС
  const hullGroup = group('Hull_Group');
  {
    const nS = HULL.stations;
    const K = HULL.ring;
    const half = K / 2;
    const kS = HULL.sonarRow;
    const thDefault = (kS / half) * Math.PI;
    // Граница обтекателя ГАС: в носу чуть ниже середины, к корме сходит к килю
    const thBound = (x) => {
      if (x >= 64) return thDefault + (0.97 * Math.PI - thDefault) * (1 - smooth((x - 64) / 7));
      return thDefault + (0.97 * Math.PI - thDefault) * smooth((x - 52) / 12);
    };
    const thAt = (k, x) => {
      const tb = thBound(x);
      const kk = k <= half ? k : K - k;
      const th = kk <= kS ? (kk / kS) * tb : tb + ((kk - kS) / (half - kS)) * (Math.PI - tb);
      return k <= half ? th : 2 * Math.PI - th;
    };
    const pos = [];
    const uv = [];
    const xs = [];
    for (let i = 0; i <= nS; i++) {
      const s = i / nS;
      // Шпангоуты сгущаются к носу и корме, где обводы скругляются
      const x = HULL.xTail + (HULL.xNose - HULL.xTail) * (s - (0.9 * Math.sin(2 * Math.PI * s)) / (2 * Math.PI));
      xs.push(x);
      const S = hullSection(Math.min(HULL.xNose - 1e-4, Math.max(HULL.xTail + 1e-4, x)));
      let arc = 0;
      let prev = null;
      for (let k = 0; k <= K; k++) {
        const p = i === 0 || i === nS ? { y: S.yc, z: 0 } : sectionPoint(S, thAt(k, x));
        if (prev) arc += Math.hypot(p.y - prev.y, p.z - prev.z);
        prev = p;
        pos.push(x, p.y, p.z);
        uv.push(x / TEX_SPAN, arc / TEX_SPAN);
      }
    }
    const R = K + 1;
    const hullIdx = [];
    const sonarIdx = [];
    for (let i = 0; i < nS; i++) {
      const sonar = (xs[i] + xs[i + 1]) / 2 > 64;
      for (let k = 0; k < K; k++) {
        const a = i * R + k;
        const b = a + R;
        const quad = [a, b + 1, b, a, a + 1, b + 1];
        (sonar && k >= kS && k < K - kS ? sonarIdx : hullIdx).push(...quad);
      }
    }
    const all = new THREE.BufferGeometry();
    all.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    all.setIndex([...hullIdx, ...sonarIdx]);
    ensureOutward(all);
    // Сшиваем нормали по шву (верх, k = 0 и k = K)
    const nrm = all.attributes.normal;
    for (let i = 0; i <= nS; i++) {
      const a = i * R;
      const b = a + K;
      const v = new THREE.Vector3(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
      nrm.setXYZ(a, v.x, v.y, v.z);
      nrm.setXYZ(b, v.x, v.y, v.z);
    }
    const idx = Array.from(all.index.array);
    const part = (from, to) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', all.attributes.position);
      g.setAttribute('normal', nrm);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx.slice(from, to));
      return g;
    };
    mesh(part(0, hullIdx.length), M.hull, 'Hull', hullGroup);
    mesh(part(hullIdx.length, idx.length), M.sonar, 'Sonar_Fairing', hullGroup);
  }

  // Палубная надстройка (лёгкая «спина» вдоль корпуса) — лофт трапеции
  const CASING = { x0: -54, x1: 80, hw: 2.9, h: 0.55 };
  const casingTop = (x) => {
    const r = smooth((x - CASING.x0) / 8) * smooth((CASING.x1 - x) / 10);
    return hullTopY(x, 0) + CASING.h * r - 0.02;
  };
  {
    const pos = [];
    const idx = [];
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const x = CASING.x0 + ((CASING.x1 - CASING.x0) * i) / n;
      const r = smooth((x - CASING.x0) / 8) * smooth((CASING.x1 - x) / 10);
      const hw = 0.6 + (CASING.hw - 0.6) * r;
      const top = casingTop(x);
      const prof = [
        [-hw - 0.7, hullTopY(x, hw + 0.7) - 0.25],
        [-hw - 0.15, top - 0.05],
        [-hw + 0.1, top],
        [hw - 0.1, top],
        [hw + 0.15, top - 0.05],
        [hw + 0.7, hullTopY(x, hw + 0.7) - 0.25],
      ];
      for (const [z, y] of prof) pos.push(x, y, z);
    }
    const P = 6;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = i * P + k;
        idx.push(a, a + 1, a + P + 1, a, a + P + 1, a + P);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Проверка направления: на верхней грани нормаль должна смотреть вверх
    if (g.attributes.normal.getY(3) < 0) {
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    boxUV(g);
    mesh(g, M.hull, 'Deck_Casing', hullGroup);
  }

  // Люки на палубе
  {
    const hatch = geo('Deck_Hatch', () => new THREE.CylinderGeometry(0.65, 0.7, 0.12, 24));
    [70, 62, 52, -6, -40, -47].forEach((x, i) => mesh(hatch, M.black, `Deck_Hatch_${i + 1}`, hullGroup, x, casingTop(x) + 0.05, 0));
  }

  // Шпигаты (отверстия для заполнения цистерн) — ряды щелей по бортам
  {
    const slot = new THREE.BoxGeometry(1.3, 0.32, 0.12);
    const slotLow = new THREE.BoxGeometry(0.9, 0.45, 0.12);
    for (const side of [1, -1]) {
      const parts = [];
      for (let x = -46; x <= 62; x += 2.0) {
        const up = hullSurface(x, 3.6, side);
        parts.push(placeOnHull(slot, up.point, up.normal, 0.0));
      }
      for (let x = -40; x <= 56; x += 1.6) {
        const lo = hullSurface(x, -7.4, side);
        parts.push(placeOnHull(slotLow, lo.point, lo.normal, 0.0));
      }
      mesh(merge(parts), M.dark, side > 0 ? 'Flood_Openings_Starboard' : 'Flood_Openings_Port', hullGroup);
    }
  }

  // Заплата на обшивке: сетка точек поверхности, смещённая по нормали
  const hullPatch = (x0, x1, y0, y1, side, off = 0.04, nx = 8, ny = 4) => {
    const pos = [];
    const idx = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const { point, normal } = hullSurface(x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny, side);
        point.addScaledVector(normal, off);
        pos.push(point.x, point.y, point.z);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        if (side > 0) idx.push(a, a + nx + 2, a + 1, a, a + nx + 1, a + nx + 2);
        else idx.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // Бортовые антенны ГАС (светлые панели) и решётки вентиляции в корме
  for (const side of [1, -1]) {
    const sn = side > 0 ? 'Starboard' : 'Port';
    mesh(hullPatch(-36, -26, -1.6, 0.4, side, 0.05), M.sonar, `Flank_Array_${sn}`, hullGroup);
    mesh(hullPatch(18, 34, -4.2, -2.4, side, 0.05, 10, 2), M.sonar, `Flank_Array_Fwd_${sn}`, hullGroup);
    const cell = new THREE.BoxGeometry(0.7, 0.7, 0.14);
    const parts = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const { point, normal } = hullSurface(-44 + i * 0.95, 0.6 + j * 0.95, side);
        parts.push(placeOnHull(cell, point, normal, 0.0));
      }
    }
    mesh(merge(parts), M.dark, `Vent_Grille_${sn}`, hullGroup);
  }

  // Вспомогательные выдвижные движители (гондолы в нижней части кормы)
  {
    const pod = geo('Aux_Pod', () => ensureOutward(latheX([[0, -2.6], [0.75, -2.4], [0.95, -1.6], [0.95, 1.4], [0.6, 2.4], [0, 2.6]], 24)));
    const podEnd = geo('Aux_Pod_Nozzle', () => new THREE.CircleGeometry(0.7, 20).rotateY(-Math.PI / 2));
    let n = 0;
    for (const x of [-50, -30]) {
      for (const side of [1, -1]) {
        n++;
        const { point, normal } = hullSurface(x, -6.2, side);
        point.addScaledVector(normal, 0.55);
        const g = group(`Aux_Propulsor_${n}`, hullGroup, point.x, point.y, point.z);
        mesh(pod, M.black, `Aux_Propulsor_${n}_Pod`, g);
        mesh(podEnd, M.dark, `Aux_Propulsor_${n}_Nozzle`, g, -2.45, 0, 0);
      }
    }
    // Подкилевой обтекатель в корме
    const fair = ensureOutward(latheX([[0, -6], [0.8, -5], [1.2, -2], [1.2, 2.5], [0.8, 5], [0, 6]], 24));
    fair.scale(1, 0.7, 1.6);
    const S = hullSection(-58);
    mesh(fair, M.black, 'Ventral_Fairing', hullGroup, -58, S.yc - S.hB + 0.15, 0);
  }

  // =========================================================================
  // РУБКА: длинная, низкая, со скруглёнными торцами
  const SAIL = { xf: 47.5, xrBase: 17.5, xrTop: 24.5, yBase: 3.2, yDeck: 5.6, yTop: 13.9, wBase: 3.3, wTop: 3.0, fillet: 0.7 };
  const sailFront = (y) => SAIL.xf - 0.35 * clamp01((y - SAIL.yDeck) / (SAIL.yTop - SAIL.yDeck)) ** 2;
  const sailRear = (y) => {
    const t = clamp01((y - SAIL.yDeck) / (SAIL.yTop - SAIL.yDeck));
    return SAIL.xrTop - (SAIL.xrTop - SAIL.xrBase) * Math.sqrt(1 - t * t);
  };
  const sailOutline = (y, nPts = 72) => {
    const xf = sailFront(y);
    const xr = sailRear(y);
    const t = clamp01((y - SAIL.yDeck) / (SAIL.yTop - SAIL.yDeck));
    let w = SAIL.wBase + (SAIL.wTop - SAIL.wBase) * t;
    let shrink = 0;
    const yf = SAIL.yTop - SAIL.fillet;
    if (y > yf) shrink = SAIL.fillet - Math.sqrt(Math.max(0, SAIL.fillet ** 2 - (y - yf) ** 2));
    w -= shrink;
    const xc = 36;
    const pts = [];
    for (let k = 0; k < nPts; k++) {
      const ph = (2 * Math.PI * k) / nPts;
      const c = Math.cos(ph);
      const s = Math.sin(ph);
      const front = c >= 0;
      const L = (front ? xf - xc : xc - xr) - shrink;
      const nx = front ? 2.3 : 2.1;
      const nz = front ? 4.5 : 3.2;
      pts.push([xc + L * Math.sign(c) * Math.abs(c) ** (2 / nx), w * Math.sign(s) * Math.abs(s) ** (2 / nz)]);
    }
    return pts;
  };
  const sailGroup = group('Sail');
  {
    const ys = [];
    for (let y = SAIL.yBase; y < SAIL.yTop - SAIL.fillet; y += 0.6) ys.push(y);
    for (let k = 0; k <= 6; k++) ys.push(SAIL.yTop - SAIL.fillet + SAIL.fillet * Math.sin((k / 6) * (Math.PI / 2)));
    const nP = 72;
    const pos = [];
    const idx = [];
    for (const y of ys) for (const [x, z] of sailOutline(y, nP)) pos.push(x, y, z);
    for (let r = 0; r < ys.length - 1; r++) {
      for (let k = 0; k < nP; k++) {
        const a = r * nP + k;
        const b = r * nP + ((k + 1) % nP);
        idx.push(a, b, b + nP, a, b + nP, a + nP);
      }
    }
    for (const [r, y] of [[0, ys[0]], [ys.length - 1, ys[ys.length - 1]]]) {
      const ci = pos.length / 3;
      pos.push(36, y, 0);
      for (let k = 0; k < nP; k++) idx.push(ci, r * nP + k, r * nP + ((k + 1) % nP));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    ensureOutward(g);
    boxUV(g);
    mesh(g, M.hull, 'Sail_Body', sailGroup);

    // Окна ходового мостика в передней части рубки
    const win = new THREE.BoxGeometry(0.55, 0.5, 0.1);
    const wins = [];
    const yW = SAIL.yTop - 1.3;
    const ol = sailOutline(yW, 288);
    for (let k = -5; k <= 5; k++) {
      if (k === 0) continue;
      const i = (k * 4 + 288) % 288;
      const [x, z] = ol[i];
      const [x2, z2] = ol[(i + 1) % 288];
      const tng = new THREE.Vector3(x2 - x, 0, z2 - z).normalize();
      const nrm = new THREE.Vector3(tng.z, 0, -tng.x);
      if (nrm.x * x + nrm.z * z < nrm.x * 36) nrm.negate();
      wins.push(placeOnHull(win, new THREE.Vector3(x, yW, z), nrm, 0.0));
    }
    mesh(merge(wins), M.glass, 'Sail_Windows', sailGroup);

    // Контур всплывающей спасательной камеры на боках рубки
    for (const side of [1, -1]) {
      const yy = [8.4, 12.3];
      const wAt = (x, y) => {
        const o = sailOutline(y, 288);
        let best = o[0];
        for (const p of o) if (Math.sign(p[1]) === side && Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
        return best[1] + side * 0.03;
      };
      const P = (x, y) => new THREE.Vector3(x, y, wAt(x, y));
      const pts = [P(25.5, yy[1]), P(29, yy[0]), P(41, yy[0]), P(43.5, yy[1])];
      const parts = [];
      for (let i = 0; i < pts.length - 1; i++) parts.push(beamBetween(pts[i], pts[i + 1], 0.12, 0.12));
      mesh(merge(parts), M.black, side > 0 ? 'Sail_Capsule_Seam_Starboard' : 'Sail_Capsule_Seam_Port', sailGroup);
    }

    // Выдвижные устройства: перископы, РЛС, связь, РДП — частично подняты
    const masts = group('Masts', sailGroup);
    const holeG = geo('Mast_Well', () => new THREE.CylinderGeometry(0.6, 0.6, 0.04, 20));
    const mastSpec = [
      ['Periscope_Commander', 43.2, 0, 0.22, 3.6],
      ['Periscope_Search', 41.6, 0, 0.26, 2.6],
      ['Radar_Mast', 39.4, 0, 0.35, 1.8],
      ['Comms_Mast', 37.0, 0.9, 0.22, 2.8],
      ['ESM_Mast', 37.0, -0.9, 0.25, 1.2],
      ['Snorkel_Mast', 33.5, 0, 0.45, 1.0],
    ];
    mastSpec.forEach(([name, x, z, r, h], i) => {
      const m = group(name, masts, x, SAIL.yTop, z);
      mesh(holeG, M.dark, `${name}_Well`, m, 0, 0.01, 0);
      mesh(geo(`MastTube_${r}_${h}`, () => new THREE.CylinderGeometry(r, r * 1.08, h, 16).translate(0, h / 2, 0)), M.mast, `${name}_Tube`, m);
      if (name.startsWith('Periscope')) {
        mesh(geo(`PeriHead_${r}`, () => new THREE.CylinderGeometry(r * 0.75, r, 0.7, 14).translate(0, 0.35, 0)), M.mast, `${name}_Head`, m, 0, h, 0);
        mesh(geo('PeriWindow', () => new THREE.BoxGeometry(0.04, 0.16, 0.14)), M.glass, `${name}_Window`, m, r * 0.85, h + 0.35, 0);
      } else if (name === 'Radar_Mast') {
        mesh(geo('RadarAntenna', () => new THREE.BoxGeometry(0.5, 0.45, 2.2).translate(0, 0.22, 0)), M.mast, `${name}_Antenna`, m, 0, h, 0);
      } else if (name === 'Snorkel_Mast') {
        mesh(geo('SnorkelHead', () => new THREE.BoxGeometry(1.4, 0.7, 0.8).translate(0, 0.35, 0)), M.mast, `${name}_Head`, m, 0, h, 0);
      } else if (name === 'Comms_Mast') {
        mesh(geo('CommsWhip', () => new THREE.CylinderGeometry(0.04, 0.08, 2.2, 8).translate(0, 1.1, 0)), M.mast, `${name}_Whip`, m, 0, h, 0);
      } else {
        mesh(geo('ESMDome', () => new THREE.SphereGeometry(0.32, 16, 10)), M.mast, `${name}_Dome`, m, 0, h + 0.1, 0);
      }
      void i;
    });
    // Ещё два закрытых колодца выдвижных устройств
    mesh(holeG, M.dark, 'Mast_Well_Spare_1', sailGroup, 30.8, SAIL.yTop + 0.01, 0);
    mesh(holeG, M.dark, 'Mast_Well_Spare_2', sailGroup, 28.6, SAIL.yTop + 0.01, 0);
  }

  // =========================================================================
  // НОСОВЫЕ ГОРИЗОНТАЛЬНЫЕ РУЛИ (выдвижные) и ниши для них
  const bowPlanes = group('BowPlanes');
  {
    const xP = 68;
    const yP = 2.2;
    const plane = geo('BowPlane', () => foilGeometry({ span: 4.6, rootLE: 2.4, rootTE: -2.4, tipLE: 1.5, tipTE: -1.9, rootT: 0.7, tipT: 0.4 }));
    for (const side of [1, -1]) {
      const sn = side > 0 ? 'Starboard' : 'Port';
      const { point } = hullSurface(xP, yP, side);
      const piv = group(`BowPlane_${sn}`, bowPlanes, xP, yP, point.z - side * 0.6);
      // Размах крыла (+Y) разворачиваем по борту наружу
      const m = mesh(plane, M.black, `BowPlane_${sn}_Foil`, piv);
      m.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      piv.rotation.z = 0.06;
      mesh(hullPatch(xP - 3.0, xP + 3.0, yP - 0.55, yP + 0.55, side, 0.03, 6, 2), M.dark, `BowPlane_Recess_${sn}`, bowPlanes);
    }
  }

  // =========================================================================
  // КОРМОВОЕ ОПЕРЕНИЕ: верхний и нижний вертикальные рули, стабилизаторы с концевыми шайбами
  const yAxis = -1.8;
  {
    const up = foilGeometry({ span: 13.3, rootLE: -21, rootTE: -84.5, tipLE: -70.5, tipTE: -81, rootT: 1.9, tipT: 0.85, rows: 10, segs: 18 });
    boxUV(up);
    const rUp = mesh(up, M.hull, 'Rudder_Upper', sub, 0, yAxis, 0);
    // Обтекатель буксируемой антенны на вершине киля
    const pod = ensureOutward(latheX([[0, -3.5], [0.3, -3.3], [0.55, -2.6], [0.55, 2.8], [0.35, 3.8], [0, 4.4]], 20));
    mesh(pod, M.black, 'Towed_Array_Pod', rUp, -74, 13.3 + 0.3, 0);
    const lo = foilGeometry({ span: 8.2, rootLE: -42, rootTE: -84, tipLE: -74, tipTE: -82, rootT: 1.6, tipT: 0.7, rows: 8, segs: 16 });
    lo.rotateX(Math.PI);
    boxUV(lo);
    mesh(lo, M.hull, 'Rudder_Lower', sub, 0, yAxis, 0);

    const stern = group('SternPlanes');
    const stab = geo('Stern_Stabilizer', () => boxUV(foilGeometry({ span: 12.4, rootLE: -50, rootTE: -84, tipLE: -69.5, tipTE: -80.5, rootT: 1.3, tipT: 0.6, rows: 8, segs: 16 })));
    const endFin = geo('Stern_Endplate', () => boxUV(foilGeometry({ span: 6.4, rootLE: -69, rootTE: -81, tipLE: -71.5, tipTE: -80.5, rootT: 0.6, tipT: 0.4, rows: 4 })));
    for (const side of [1, -1]) {
      const sn = side > 0 ? 'Starboard' : 'Port';
      const s = mesh(stab, M.hull, `Stabilizer_${sn}`, stern, 0, yAxis, 0);
      s.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      // концевая шайба: больше вниз, чем вверх
      mesh(endFin, M.hull, `Stabilizer_Endplate_${sn}`, stern, 0, yAxis - 4.6, side * 12.3);
    }
  }

  // =========================================================================
  // ДВИЖИТЕЛИ: два вала в обтекателях, два семилопастных винта противоположного вращения
  const propulsion = group('Propulsion');
  const propellers = [];
  {
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.55, 0.6);
    bladeShape.bezierCurveTo(-1.2, 1.5, -0.8, 2.6, 0.45, 2.95);
    bladeShape.bezierCurveTo(0.9, 2.3, 0.95, 1.3, 0.55, 0.6);
    bladeShape.lineTo(-0.55, 0.6);
    const makeBlades = (hand) => {
      const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.1, bevelEnabled: false, curveSegments: 16 });
      blade.translate(0, 0, -0.05);
      const p = blade.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const r = Math.max(0.5, v.y);
        const pitch = Math.atan(6.0 / (2 * Math.PI * r));
        const chord = v.x;
        const thick = v.z * (1.6 - 0.4 * r);
        v.set(chord * Math.sin(pitch) + thick * Math.cos(pitch), v.y, hand * (chord * Math.cos(pitch) - thick * Math.sin(pitch)));
        p.setXYZ(i, v.x, v.y, v.z);
      }
      blade.deleteAttribute('normal');
      blade.deleteAttribute('uv');
      const smoothBlade = ensureOutward(mergeVertices(blade, 1e-4));
      const list = [];
      for (let b = 0; b < 7; b++) list.push(smoothBlade.clone().rotateX((b / 7) * Math.PI * 2));
      return merge(list);
    };
    const bladesR = makeBlades(1);
    bladesR.name = 'Propeller_Blades_Right';
    const bladesL = makeBlades(-1);
    bladesL.name = 'Propeller_Blades_Left';
    const hub = ensureOutward(latheX([[0, -1.6], [0.35, -1.5], [0.65, -0.9], [0.8, 0], [0.8, 0.8], [0.7, 1.2]], 24));
    hub.name = 'Propeller_Hub';
    const bossing = geo('Shaft_Bossing', () => ensureOutward(latheX([[0.55, -14.2], [0.7, -13.5], [0.95, -10], [1.25, -3], [1.35, 6], [1.0, 14], [0, 14.5]], 24)));
    [1, -1].forEach((side, k) => {
      const n = k + 1;
      const zS = side * 5.2;
      mesh(bossing, M.black, `Shaft_Bossing_${n}`, propulsion, -73, yAxis, zS);
      mesh(geo('Shaft_Short', () => new THREE.CylinderGeometry(0.35, 0.35, 1.4, 14).rotateZ(Math.PI / 2)), M.metal, `Shaft_${n}`, propulsion, -87.7, yAxis, zS);
      const pr = group(`Propeller_${n}`, propulsion, -89.4, yAxis, zS);
      mesh(hub, M.bronze, `Propeller_${n}_Hub`, pr);
      mesh(side > 0 ? bladesR : bladesL, M.bronze, `Propeller_${n}_Blades`, pr);
      propellers.push({ obj: pr, dir: side > 0 ? 1 : -1 });
    });
  }

  // =========================================================================
  // НОСОВЫЕ АППАРАТЫ «ПОСЕЙДОНА»: 6 труб калибра ~2 м, крышки на шарнирах
  const tubes = group('Poseidon_Tubes');
  const doorHinges = [];
  const tubeAxes = [];
  {
    const R = 1.0;
    const layout = [
      [1.9, 1.4], [1.9, -1.4], [1.0, 3.9], [1.0, -3.9], [-0.9, 2.1], [-0.9, -2.1],
    ];
    const axis = new THREE.Vector3(1, 0, 0);
    layout.forEach(([y, z], i) => {
      const n = i + 1;
      // Точка выхода оси трубы на обшивку (бисекция по x)
      let a = 55;
      let b = HULL.xNose - 1e-3;
      for (let it = 0; it < 50; it++) {
        const m = (a + b) / 2;
        if (hullF(m, y, z) < 1) a = m;
        else b = m;
      }
      const P = new THREE.Vector3(a, y, z);
      const nrm = hullNormal(P);
      tubeAxes.push({ P, y, z });
      // Сечение трубы плоскостью касания — эллипс: малая полуось R, большая R/|a·n|
      const cosA = Math.max(0.35, Math.abs(axis.dot(nrm)));
      let mDir = axis.clone().addScaledVector(nrm, -axis.dot(nrm));
      if (mDir.lengthSq() < 1e-6) mDir = new THREE.Vector3(0, 1, 0).addScaledVector(nrm, -nrm.y);
      mDir.normalize();
      let kDir = mDir.clone().cross(nrm);
      // Шарнир — на внешней (бортовой) кромке, крышка открывается в сторону борта
      if (-kDir.z * Math.sign(z) < 0) {
        mDir.negate();
        kDir = mDir.clone().cross(nrm);
      }
      const major = R / cosA;
      const ellipse = (rx, rz, h, seg = 36) => {
        const shape = new THREE.Shape();
        shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
        const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: seg });
        g.rotateX(-Math.PI / 2); // форма в плоскости XZ, толщина вдоль +Y
        return g;
      };
      const basis = new THREE.Matrix4().makeBasis(mDir, nrm, kDir);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);
      // Темнота в трубе и ободок
      const bore = ellipse(major * 0.98, R * 0.98, 0.02);
      bore.translate(0, 0.0, 0);
      const boreMesh = mesh(bore, M.dark, `Tube_${n}_Bore`, tubes, P.x, P.y, P.z);
      boreMesh.quaternion.copy(q);
      boreMesh.position.addScaledVector(nrm, 0.01);
      // Шарнирная группа на кромке, крышка смещена на R внутрь от шарнира
      const hingePos = P.clone().addScaledVector(kDir, -R * 1.02).addScaledVector(nrm, 0.06);
      const hinge = group(`TubeDoor_${n}_Hinge`, tubes, hingePos.x, hingePos.y, hingePos.z);
      hinge.quaternion.copy(q);
      const pivot = group(`TubeDoor_${n}_Pivot`, hinge);
      const door = ellipse(major * 1.04, R * 1.04, 0.12);
      boxUV(door);
      mesh(door, M.hull, `TubeDoor_${n}`, pivot, 0, 0, R * 1.02);
      mesh(geo('Door_Hinge_Pin', () => new THREE.CylinderGeometry(0.1, 0.1, 1.0, 10).rotateZ(Math.PI / 2)), M.metal, `TubeDoor_${n}_HingePin`, hinge, 0, 0.08, 0);
      doorHinges.push(pivot);
    });
  }
  const DOOR_OPEN = -1.75; // угол открытой крышки (рад), поворот вокруг оси шарнира
  const setTubeDoors = (amount) => {
    const t = clamp01(amount);
    for (const p of doorHinges) p.rotation.x = DOOR_OPEN * t;
  };

  // =========================================================================
  // АНГАР ДЛЯ «КЛАВЕСИНА» за рубкой и посадочное место НПА
  const hangar = group('Klavesin_Hangar', hullGroup);
  {
    const x0 = 6;
    const x1 = 16;
    const yT = casingTop(11);
    // Комингс (рамка) и тёмная ниша
    const frame = [];
    frame.push(new THREE.BoxGeometry(x1 - x0, 0.45, 0.3).translate((x0 + x1) / 2, 0, 1.55));
    frame.push(new THREE.BoxGeometry(x1 - x0, 0.45, 0.3).translate((x0 + x1) / 2, 0, -1.55));
    frame.push(new THREE.BoxGeometry(0.3, 0.45, 3.4).translate(x0, 0, 0));
    frame.push(new THREE.BoxGeometry(0.3, 0.45, 3.4).translate(x1, 0, 0));
    mesh(boxUV(merge(frame)), M.hull, 'Klavesin_Hangar_Coaming', hangar, 0, yT + 0.1, 0);
    mesh(new THREE.BoxGeometry(x1 - x0 - 0.3, 0.06, 2.8), M.dark, 'Klavesin_Hangar_Well', hangar, (x0 + x1) / 2, yT + 0.06, 0);
    // Ложемент с оранжевыми опорами
    const cradle = [];
    for (let k = 0; k < 5; k++) cradle.push(new THREE.BoxGeometry(0.35, 0.5, 1.6).translate(x0 + 1.5 + k * 1.75, 0, 0));
    mesh(merge(cradle), M.orange, 'Klavesin_Cradle', hangar, 0, yT + 0.3, 0);
    // Открытая крышка ангара (откинута на правый борт)
    const lidHinge = group('Klavesin_Hangar_Lid_Hinge', hangar, (x0 + x1) / 2, yT + 0.33, 1.7);
    const lid = mesh(boxUV(new THREE.BoxGeometry(x1 - x0, 0.22, 3.3).translate(0, 0.11, -1.65)), M.hull, 'Klavesin_Hangar_Lid', lidHinge);
    void lid;
    lidHinge.rotation.x = 2.2;
  }
  const dsrvSeat = group('DSRV_Seat', hullGroup);
  const DSRV_X = -22;
  {
    const yT = casingTop(DSRV_X);
    mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.35, 32), M.black, 'DSRV_Docking_Collar', dsrvSeat, DSRV_X + 0.5, yT + 0.17, 0);
    mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.04, 28), M.dark, 'DSRV_Docking_Hatch', dsrvSeat, DSRV_X + 0.5, yT + 0.36, 0);
    // Опорные салазки
    const pads = [];
    for (const z of [-1.9, 1.9]) pads.push(new THREE.BoxGeometry(9, 0.3, 0.5).translate(DSRV_X, 0, z));
    mesh(merge(pads), M.metal, 'DSRV_Seat_Rails', dsrvSeat, 0, yT + 0.15, 0);
  }

  // =========================================================================
  // ПОЛЕЗНЫЕ НАГРУЗКИ
  // --- Глубоководный спасательный аппарат типа «Бестер» (пр. 18271) на спине
  const payloadDSRV = group('Payload_DSRV');
  {
    const yT = casingTop(DSRV_X);
    const yc = yT + 0.35 + 0.9 + 1.9;
    const d = group('DSRV_Bester', payloadDSRV, DSRV_X, yc, 0);
    const body = ensureOutward(latheX([[0, -6.3], [0.7, -6.15], [1.35, -5.5], [1.8, -4.3], [1.9, -3.0], [1.9, 4.3], [1.75, 5.3], [1.25, 6.05], [0, 6.35]], 40));
    mesh(body, M.orange, 'DSRV_Hull', d);
    const band = geo('DSRV_Band', () => new THREE.CylinderGeometry(1.93, 1.93, 1.15, 40, 1, true).rotateZ(Math.PI / 2));
    [-3.3, -0.4, 2.6].forEach((x, i) => mesh(band, M.white, `DSRV_Band_${i + 1}`, d, x, 0, 0));
    // Верхняя надстройка и входной люк
    const top = new THREE.BoxGeometry(7.5, 0.7, 1.6);
    mesh(top, M.white, 'DSRV_Top_Fairing', d, -0.5, 1.95, 0);
    mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.1, 24), M.orange, 'DSRV_Hatch_Tower', d, 1.2, 2.5, 0);
    mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 24), M.white, 'DSRV_Hatch_Cover', d, 1.2, 3.1, 0);
    // Стыковочная юбка снизу
    mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.95, 28), M.white, 'DSRV_Docking_Skirt', d, 0.5, -1.95, 0);
    // Кормовой винт в насадке, перо и стабилизаторы
    mesh(ringX(0.95, 1.12, -7.5, -6.4, 28), M.orange, 'DSRV_Prop_Duct', d);
    const bl = [];
    for (let b = 0; b < 4; b++) bl.push(new THREE.BoxGeometry(0.12, 0.85, 0.3).translate(0, 0.5, 0).rotateX((b / 4) * Math.PI * 2 + 0.4));
    mesh(merge(bl), M.metal, 'DSRV_Propeller', d, -6.95, 0, 0);
    const fins = [];
    for (let b = 0; b < 4; b++) fins.push(new THREE.BoxGeometry(1.2, 0.1, 1.3).translate(-6.2, 0, 0.6).rotateX((b / 4) * Math.PI * 2));
    mesh(merge(fins), M.white, 'DSRV_Tail_Fins', d);
    // Подруливающие устройства и фары
    for (const side of [1, -1]) {
      mesh(geo('DSRV_Thruster', () => new THREE.CylinderGeometry(0.35, 0.35, 0.8, 16).rotateX(Math.PI / 2)), M.metal, side > 0 ? 'DSRV_Thruster_Starboard' : 'DSRV_Thruster_Port', d, 4.2, -0.6, side * 1.7);
    }
    mesh(new THREE.SphereGeometry(0.28, 14, 10), M.glass, 'DSRV_Viewport', d, 6.25, -0.5, 0);
    // Белые опоры ложемента
    const legs = [];
    for (const x of [-3.6, 3.2]) {
      for (const side of [1, -1]) {
        legs.push(beamBetween(new THREE.Vector3(x, -1.2, side * 1.45), new THREE.Vector3(x + (x > 0 ? 0.6 : -0.6), -yc + yT + 0.3, side * 1.95), 0.16));
      }
    }
    mesh(merge(legs), M.white, 'DSRV_Cradle_Legs', d);
  }

  // --- Атомная глубоководная станция АС-31 «Лошарик» под днищем
  const payloadLosharik = group('Payload_Losharik');
  {
    const L = 64;
    const R = 3.3;
    const xc = -16;
    const yTopL = HULL.keel - 0.55;
    const yc = yTopL - R;
    const ls = group('Losharik_AS31', payloadLosharik, xc, yc, 0);
    const prof = [[0, -L / 2 - 0.2], [0.8, -L / 2], [1.6, -L / 2 + 2], [2.55, -L / 2 + 6], [3.15, -L / 2 + 11], [R, -L / 2 + 15], [R, L / 2 - 6], [3.05, L / 2 - 3], [2.4, L / 2 - 1.1], [1.3, L / 2 - 0.15], [0, L / 2]];
    // Верх синий, низ тёмный (две половины тела вращения)
    mesh(latheX(prof, 28, Math.PI - 0.35, Math.PI + 0.7), M.blue, 'Losharik_Hull_Upper', ls);
    mesh(latheX(prof, 20, Math.PI * 2 + 0.35, Math.PI - 0.7), M.blueDark, 'Losharik_Hull_Lower', ls);
    // Ограждение на спине (по оси, низкое) и стыковочные опоры к килю носителя
    const hump = ensureOutward(latheX([[0, -14], [0.6, -13], [1.1, -10], [1.25, -2], [1.2, 8], [0.8, 12], [0, 13]], 20));
    hump.scale(1, 0.75, 1.3);
    mesh(hump, M.blueDark, 'Losharik_Dorsal_Fairing', ls, 1, R - 0.25, 0);
    const clamp = geo('Losharik_Clamp', () => new THREE.BoxGeometry(1.6, 1.0, 3.2));
    [-22, -2, 18].forEach((x, i) => mesh(clamp, M.metal, `Losharik_Docking_Clamp_${i + 1}`, ls, x, R + 0.35, 0));
    // Кормовая насадка с винтом (красное кольцо) и крестообразное оперение
    mesh(ringX(1.6, 1.95, -L / 2 - 1.4, -L / 2 + 0.6, 32), M.red, 'Losharik_Prop_Duct', ls);
    const pb = [];
    for (let b = 0; b < 5; b++) pb.push(new THREE.BoxGeometry(0.14, 1.2, 0.45).translate(0, 0.75, 0).rotateX((b / 5) * Math.PI * 2 + 0.3));
    mesh(merge(pb), M.metal, 'Losharik_Propeller', ls, -L / 2 - 0.5, 0, 0);
    const fin = geo('Losharik_Fin', () => foilGeometry({ span: 2.4, rootLE: -L / 2 + 9, rootTE: -L / 2 + 1, tipLE: -L / 2 + 3.5, tipTE: -L / 2 + 0.6, rootT: 0.45, tipT: 0.25 }));
    for (let k = 0; k < 4; k++) {
      const f = mesh(fin, M.blueDark, `Losharik_Tail_Fin_${k + 1}`, ls);
      f.rotation.x = Math.PI / 4 + (k * Math.PI) / 2;
      // корень плавника — на поверхности кормового конуса
      f.position.set(0, 0, 0);
      f.translateY(1.7);
    }
    // Носовые и бортовые иллюминаторы/фары
    mesh(new THREE.SphereGeometry(0.35, 14, 10), M.glass, 'Losharik_Bow_Light', ls, L / 2 - 0.3, -0.6, 0);
  }

  // --- Шесть «Посейдонов» 2М39, выдвинутых из носовых аппаратов
  const payloadPoseidons = group('Payload_Poseidons');
  {
    const L = 20;
    const R = 0.9;
    const pg = geo('Poseidon_2M39', () => {
      const parts = [];
      parts.push(ensureOutward(latheX([[0, -L / 2], [0.35, -L / 2 + 0.05], [0.55, -L / 2 + 0.5], [0.75, -L / 2 + 1.8], [R, -L / 2 + 3], [R, L / 2 - 1.8], [0.8, L / 2 - 0.8], [0.55, L / 2 - 0.2], [0.2, L / 2], [0, L / 2 + 0.02]], 28)));
      // Водомётный движитель — насадка на корме
      parts.push(ringX(0.62, 0.8, -L / 2 - 0.4, -L / 2 + 0.9, 24));
      // Стабилизаторы крестом
      const f = foilGeometry({ span: 0.6, rootLE: -L / 2 + 3.4, rootTE: -L / 2 + 1.2, tipLE: -L / 2 + 2.6, tipTE: -L / 2 + 1.3, rootT: 0.12, tipT: 0.08, rows: 2, segs: 8 });
      for (let k = 0; k < 4; k++) parts.push(f.clone().translate(0, R - 0.25, 0).rotateX(Math.PI / 4 + (k * Math.PI) / 2));
      // Стыки секций — тонкие бандажи
      for (const x of [-4.5, 0.5, 5.5]) parts.push(ensureOutward(latheX([[R, x - 0.12], [R + 0.03, x - 0.1], [R + 0.03, x + 0.1], [R, x + 0.12]], 28)));
      return merge(parts);
    });
    tubeAxes.forEach(({ P, y, z }, i) => {
      // хвост остаётся в трубе на ~3 м
      mesh(pg, M.poseidon, `Poseidon_${i + 1}`, payloadPoseidons, P.x - 3 + L / 2, y, z);
    });
  }

  // --- Автономный необитаемый аппарат «Клавесин-2Р-ПМ», поднят над ангаром
  const payloadKlavesin = group('Payload_Klavesin');
  {
    const L = 6.6;
    const R = 0.52;
    const k = group('Klavesin_Drone', payloadKlavesin, 11, casingTop(11) + 2.6, 0);
    mesh(ensureOutward(latheX([[0, -L / 2], [0.3, -L / 2 + 0.2], [0.42, -L / 2 + 0.8], [R, -L / 2 + 1.6], [R, L / 2 - 0.9], [0.4, L / 2 - 0.3], [0, L / 2]], 28)), M.yellow, 'Klavesin_Body', k);
    mesh(ringX(0.42, 0.5, -L / 2 - 0.2, -L / 2 + 0.5, 24), M.yellow, 'Klavesin_Duct', k);
    const f = foilGeometry({ span: 0.45, rootLE: -L / 2 + 1.7, rootTE: -L / 2 + 0.6, tipLE: -L / 2 + 1.1, tipTE: -L / 2 + 0.7, rootT: 0.08, tipT: 0.05, rows: 2, segs: 8 });
    const fins = [];
    for (let j = 0; j < 4; j++) fins.push(f.clone().translate(0, 0.36, 0).rotateX((j * Math.PI) / 2));
    mesh(merge(fins), M.metal, 'Klavesin_Fins', k);
    // Окно гидроакустики в носу
    mesh(new THREE.SphereGeometry(0.2, 12, 8), M.dark, 'Klavesin_Sensor', k, L / 2 - 0.15, -0.15, 0);
  }

  // =========================================================================
  // Уникальные имена: Blender не любит одинаковые имена узлов
  const seen = new Map();
  sub.traverse((o) => {
    if (o === sub) return;
    const base = o.name || o.type;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n > 1) o.name = `${base}_${n}`;
  });

  // =========================================================================
  // АНИМАЦИИ
  // 1) Винты: противоположное вращение, период 3 с, ключи через 90° (slerp по короткой дуге)
  const PERIOD = 3;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const spin = propellers.map(({ obj, dir }) => {
    const times = [];
    const values = [];
    for (let k = 0; k <= 8; k++) {
      const t = (k / 8) * PERIOD;
      times.push(t);
      q.setFromEuler(e.set((dir * 2 * Math.PI * t) / PERIOD, 0, 0));
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${obj.name}.quaternion`, times, values);
  });
  // 2) Крышки аппаратов: закрыты → открыты → пауза → закрыты (с небольшой задержкой между трубами)
  const doors = doorHinges.map((p, i) => {
    const d = i * 0.15;
    const times = [0, 0.2 + d, 2.4 + d, 5.0, 7.0 + d, 9.0];
    const amounts = [0, 0, 1, 1, 0, 0];
    const values = [];
    for (const a of amounts) {
      q.setFromEuler(e.set(DOOR_OPEN * a, 0, 0));
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${p.name}.quaternion`, times, values);
  });
  sub.animations = [new THREE.AnimationClip('Propellers_Spin', PERIOD, spin), new THREE.AnimationClip('TubeDoors_Open', 9, doors)];

  // По умолчанию крышки открыты: «Посейдоны» выходят из аппаратов
  setTubeDoors(1);
  sub.userData.setTubeDoors = setTubeDoors;
  sub.userData.update = (time) => {
    for (const { obj, dir } of propellers) obj.rotation.x = (dir * 2 * Math.PI * time) / PERIOD;
  };

  return sub;
}
