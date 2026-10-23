import * as THREE from 'three';

// Линкор типа «Ривендж» (R-class: Revenge, Resolution, Royal Oak, Royal Sovereign, Ramillies),
// обобщённый облик около 1939 г., без бортового номера. Масштаб 1:1, метры.
// Оси: Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния полной осадки — y = 9.5.
// Длина 189.6 м, ширина по булям 31.1 м (корпус 27 м). Полубак до кормовой надстройки, ниже — шканцы.
// Корпус — лофт по шпангоутам: суперэллипс днища, противоторпедные були, развал бортов в носу,
// крейсерская корма с подзором. Окраска корпуса, ватерлиния, броневой пояс, иллюминаторы, казематы —
// в атласе (цвет JPEG + нормали PNG). Палубный настил — плиточная текстура (texture.repeat).
// Подвижные части — Group с нулевым поворотом в покое, начало на оси: Turret_A/B/X/Y (поворот вокруг Y
// по центру барбета), Propeller_1..4 (ось вала X), Rudder (ось баллера Y), Boat_Derrick (поворот вокруг
// оси грот-мачты). Анимация одна: Propellers_Spin.

const WL = 9.5; // ватерлиния над килем
const XF = 95.0; // форштевень (палуба)
const XS = -94.6; // корма (палуба)
const XBRK = -30.0; // срез полубака
const B0 = 13.5; // полуширина корпуса без булей
const BD = 13.25; // полуширина палубы на миделе (лёгкий завал)
const FC = 17.1; // палуба полубака на миделе
const QD = 14.5; // палуба шканцев
const BOAT = 19.8; // шлюпочная палуба (крыша надстройки)
const XU = 96; // полудлина развёртки UV
const ZU = 16; // полуширина развёртки UV палубы
const CAMBER = 0.25;
const NS = 38; // сегментов по обводу (киль → палуба)
const ND = 16; // сегментов палубы поперёк
const NST = 186; // шпангоутов
const QL = 0.6;
const ATLAS = 2048;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// ОБВОДЫ

function deckLine(x) {
  if (x >= XBRK) return FC + 2.7 * clamp01((x - 28) / (XF - 28)) ** 2;
  return QD + 0.4 * clamp01((XBRK - x) / (XBRK - XS)) ** 2;
}
const bulgeAmp = (x) => 2.05 * smooth((x + 66) / 16) * smooth((76 - x) / 18);
function bulgeY(y) {
  if (y < 0.8) return 0;
  if (y < 3.8) return smooth((y - 0.8) / 3);
  if (y < WL - 0.3) return 1;
  return smooth((WL + 1.2 - y) / 1.5);
}

function sec(xn) {
  let W = B0, wd = BD, yk = 0, yw = WL - 0.6, nb = 6.5, rake = 0, s = 0, up = 0;
  const yd = deckLine(xn);
  if (xn > 36) {
    s = clamp01((xn - 36) / (XF - 36));
    W = B0 * Math.max(0, 1 - s ** 1.5);
    wd = BD * Math.max(0, 1 - s ** 2.2) ** 0.75;
    yk = 3.5 * s ** 30;
    nb = 6.5 - 4.4 * s;
    yw = WL - 0.6 + 1.2 * s * s;
    rake = -0.05 * s * s;
  } else if (xn < -44) {
    s = clamp01((-44 - xn) / (-44 - XS));
    W = B0 * Math.max(0, 1 - s ** 2.0) ** 0.8;
    wd = BD * Math.max(0, 1 - s ** 3.2) ** 0.5;
    yk = 9.0 * s ** 1.8;
    nb = 6.5 - 4.5 * s ** 0.7;
    yw = WL - 0.6 + 2.6 * s * s;
    rake = 0.15 * s * s;
    up = s;
  }
  W = Math.max(W, 0.08);
  wd = Math.max(wd, 0.08);
  yk = Math.min(yk, yw - 0.3);
  return { xn, s, W, wd, yk, yw, yd, nb, rake, up, bul: bulgeAmp(xn) };
}

// Точка обвода правого борта: q = 0 — киль, QL — наибольшая ширина, 1 — кромка палубы
function secPt(c, q) {
  let y, z;
  if (q <= QL) {
    const th = -Math.PI / 2 + (q / QL) * (Math.PI / 2);
    const e = 2 / c.nb;
    y = c.yw - (c.yw - c.yk) * Math.abs(Math.sin(th)) ** e;
    z = c.W * Math.abs(Math.cos(th)) ** e;
  } else {
    const t = (q - QL) / (1 - QL);
    y = c.yw + (c.yd - c.yw) * t;
    const fb = t ** 1.25, fs = 1 - (1 - t) ** 2.2;
    z = c.W + (c.wd - c.W) * lerp(fb, fs, c.up);
  }
  z += c.bul * bulgeY(y);
  return V3(c.xn + c.rake * (c.yd - y), y, z);
}

const DENSE = new Map();
function secDense(c, n = 300) {
  const key = c.xn + '|' + n;
  const hit = DENSE.get(key);
  if (hit) return hit;
  if (DENSE.size > 4000) DENSE.clear();
  const pts = [];
  let arc = 0, w = 0, prev = null, pd = null;
  for (let i = 0; i <= n; i++) {
    const q = i / n;
    const p = secPt(c, q);
    if (prev) {
      const ds = p.distanceTo(prev);
      arc += ds;
      let turn = 0;
      if (ds > 1e-9) {
        const d = [(p.y - prev.y) / ds, (p.z - prev.z) / ds];
        if (pd) turn = Math.acos(Math.min(1, Math.max(-1, d[0] * pd[0] + d[1] * pd[1])));
        pd = d;
      }
      w += ds + 2.5 * turn;
    }
    pts.push({ q, p, arc, w });
    prev = p;
  }
  DENSE.set(key, pts);
  return pts;
}

// Ряд вершин обвода: равномерно по «взвешенной» длине (гуще на скулах и плече булей)
function sectionRow(c) {
  const D = secDense(c);
  const wT = D[D.length - 1].w;
  const out = [];
  let i = 0;
  for (let k = 0; k <= NS; k++) {
    const target = (wT * k) / NS;
    while (i < D.length - 2 && D[i + 1].w < target) i++;
    const a = D[i], b = D[i + 1];
    const t = b.w > a.w ? clamp01((target - a.w) / (b.w - a.w)) : 0;
    const q = k === NS ? 1 : lerp(a.q, b.q, t);
    out.push({ p: secPt(c, q), arc: k === NS ? D[D.length - 1].arc : lerp(a.arc, b.arc, t) });
  }
  return out;
}

const STATIONS = (() => {
  const special = [XBRK - 0.02, XBRK + 0.02, 0];
  let xs = [];
  for (let i = 0; i <= NST; i++) {
    const t = i / NST;
    const u = 0.35 * t + 0.65 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    xs.push(XS + (XF - XS) * u);
  }
  xs = xs.filter((x, i) => i === 0 || i === NST || special.every((s) => Math.abs(x - s) > 0.35));
  xs.push(...special);
  xs.sort((a, b) => a - b);
  const st = [];
  for (const x of xs) {
    if (x === 0) {
      st.push({ xn: 0, half: 'A' }, { xn: 0, half: 'F' });
    } else st.push({ xn: x, half: x > 0 ? 'F' : 'A' });
  }
  return st;
})();
const GIRTH = Math.max(...STATIONS.map((s) => secDense(sec(s.xn), 120).at(-1).arc)) * 1.01;

// Участок борта в атласе: нос (x ≥ 0) и корма (x ≤ 0) — две полосы, чтобы удвоить разрешение
const REG = {
  F: { x0: 0, v0: 0.62, v1: 0.995 },
  A: { x0: -XU, v0: 0.24, v1: 0.615 },
};
const regU = (R, x) => 0.005 + (0.99 * (x - R.x0)) / XU;
const regX = (R, u) => R.x0 + ((u - 0.005) / 0.99) * XU;
const regV = (R, arc) => R.v0 + ((R.v1 - R.v0) * arc) / GIRTH;
const MISC_UV = [0.5, 0.222];
// полоса стен надстроек в атласе: v 0.03…0.2 — 2.8 м высоты, u — периметр до WALL_PER м
const WB0 = 0.03, WB1 = 0.2, WALL_H = 2.8, WALL_PER = 175;
const uvDeck = (x, z) => [clamp01((x + XU) / (2 * XU)), clamp01((z + ZU) / (2 * ZU))];

// Шпангоут, проходящий через точку борта (x, y) с учётом наклона штевней
function stationFor(x, y) {
  const f = (xn) => {
    const c = sec(xn);
    return xn + c.rake * (c.yd - Math.min(c.yd, Math.max(c.yk, y)));
  };
  if (x < f(XS) || x > f(XF)) return null;
  let lo = XS, hi = XF;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < x) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
// Точка правого борта на высоте y: z, длина обвода от киля. null — там борта нет
export function sideAt(x, y) {
  const xn = stationFor(x, y);
  if (xn === null) return null;
  const c = sec(xn);
  if (y < c.yk - 1e-3 || y > c.yd + 1e-3) return null;
  const D = secDense(c);
  let lo = 0, hi = D.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (D[m].p.y < y) lo = m;
    else hi = m;
  }
  const a = D[lo], b = D[hi];
  const t = b.p.y > a.p.y ? clamp01((y - a.p.y) / (b.p.y - a.p.y)) : 0;
  return { z: lerp(a.p.z, b.p.z, t), arc: lerp(a.arc, b.arc, t), c };
}
function arcAt(x, y) {
  const r = sideAt(x, y);
  if (r) return r.arc;
  const c = sec(Math.min(XF, Math.max(XS, x)));
  if (y <= c.yk) return 0;
  return null;
}
// Нормаль правого борта (наружу)
function sideNormal(x, y) {
  const r = sideAt(x, y), rx = sideAt(x + 0.1, y), ry = sideAt(x, y + 0.1);
  return V3(-(rx.z - r.z) / 0.1, -(ry.z - r.z) / 0.1, 1).normalize();
}
// Высота днища в точке (x, z) — для проверки зазоров винтов и руля
function bottomAt(x, z) {
  z = Math.abs(z);
  let best = null, bd = Infinity;
  for (let xn = x - 2; xn <= x + 2; xn += 0.05) {
    const c = sec(xn);
    const D = secDense(c, 200);
    if (z <= D[0].p.z) {
      if (Math.abs(D[0].p.x - x) < bd) {
        bd = Math.abs(D[0].p.x - x);
        best = D[0].p.y;
      }
      continue;
    }
    for (let i = 0; i < D.length - 1; i++) {
      const a = D[i].p, b = D[i + 1].p;
      if ((a.z - z) * (b.z - z) <= 0 && b.z !== a.z) {
        const t = (z - a.z) / (b.z - a.z);
        const y = lerp(a.y, b.y, t), xp = lerp(a.x, b.x, t);
        if (Math.abs(xp - x) < bd) {
          bd = Math.abs(xp - x);
          best = y;
        }
        break;
      }
    }
  }
  return best;
}
const camberAt = (c, z) => CAMBER * Math.min(1, c.wd / 10) * Math.max(0, 1 - (z / c.wd) ** 2);
export function deckSurf(x, z = 0) {
  const c = sec(x);
  return c.yd + camberAt(c, Math.min(Math.abs(z), c.wd));
}

// ---------------------------------------------------------------------------
// ГЕОМЕТРИЯ: сборщик с несколькими материалами

class Mesher {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.lists = { 0: [] };
    this.cur = 0;
    this.keys = [0];
  }
  use(k) {
    this.cur = k;
    if (!this.lists[k]) {
      this.lists[k] = [];
      this.keys.push(k);
    }
    return this;
  }
  v(p, u = 0.5, w = 0.5) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(clamp01(u), clamp01(w));
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) {
    this.lists[this.cur].push(a, b, c);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  strip(A, B, closed = false) {
    const n = A.length;
    for (let j = 0; j < (closed ? n : n - 1); j++) {
      const k = (j + 1) % n;
      this.quad(A[j], B[j], B[k], A[k]);
    }
  }
  // добавить готовую геометрию в текущий материал
  add(g, k = this.cur) {
    this.use(k);
    const base = this.pos.length / 3;
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.uv.push(uv ? clamp01(uv.getX(i)) : 0.5, uv ? clamp01(uv.getY(i)) : 0.5);
    }
    const L = this.lists[k];
    if (g.index) for (let i = 0; i < g.index.count; i++) L.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) L.push(base + i);
    return this;
  }
  build({ orient = false } = {}) {
    const P = this.pos;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const keys = this.keys.filter((k) => this.lists[k].length);
    const kept = keys.map((k) => {
      const src = this.lists[k], keep = [];
      for (let i = 0; i < src.length; i += 3) {
        const [i0, i1, i2] = [src[i], src[i + 1], src[i + 2]];
        a.fromArray(P, i0 * 3);
        b.fromArray(P, i1 * 3);
        c.fromArray(P, i2 * 3);
        if (b.sub(a).cross(c.sub(a)).length() > 1e-7) keep.push(i0, i1, i2);
      }
      return keep;
    });
    if (orient && signedVolume(P, kept.flat()) < 0) {
      for (const keep of kept) for (let i = 0; i < keep.length; i += 3) [keep[i + 1], keep[i + 2]] = [keep[i + 2], keep[i + 1]];
    }
    // убрать неиспользуемые вершины
    const used = new Int32Array(P.length / 3).fill(-1);
    const pos = [], uv = [];
    const remap = (i) => {
      if (used[i] < 0) {
        used[i] = pos.length / 3;
        pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        uv.push(this.uv[i * 2], this.uv[i * 2 + 1]);
      }
      return used[i];
    };
    const index = [];
    const groups = [];
    kept.forEach((keep, gi) => {
      groups.push({ start: index.length, count: keep.length, key: keys[gi] });
      for (const i of keep) index.push(remap(i));
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    g.userData.groups = groups;
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
// одиночная геометрия: ориентировать наружу по объёму
const solid = (m) => m.build({ orient: true });

// Тело вращения вокруг Y по профилю [[r, y], ...]; r = 0 — полюс; верх с r > 0 — крышка (если top),
// низ с r > 0 открыт (стоит на поверхности), если не bottom
function lathe(profile, seg = 20, { bottom = false, top = true } = {}) {
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
  return solid(m);
}
const latheX = (profile, seg, opt) => lathe(profile, seg, opt).rotateZ(-Math.PI / 2);

function rod(a, b, r, seg = 8, open = false) {
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, open);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
const box = (sx, sy, sz, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
// Коробка без дна (стоит на палубе): y — низ
function boxNB(sx, sy, sz, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const idx = Array.from(g.index.array);
  idx.splice(18, 6);
  g.setIndex(idx);
  return g.translate(x, y + sy / 2, z);
}

// Призма: многоугольник в плоскости XY, толщина по Z; open — номера рёбер без боковой грани
function prism(poly, th, open = []) {
  const m = new Mesher();
  const pts = poly.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(pts)) {
    pts.reverse();
    open = open.map((i) => pts.length - 2 - i).map((i) => (i + pts.length) % pts.length);
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  pts.forEach((p) => {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  });
  const uv = (p) => [(p.x - x0) / (x1 - x0 || 1), (p.y - y0) / (y1 - y0 || 1)];
  const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => p.clone()), []);
  const front = pts.map((p) => m.v(V3(p.x, p.y, th / 2), ...uv(p)));
  const back = pts.map((p) => m.v(V3(p.x, p.y, -th / 2), ...uv(p)));
  tris.forEach(([a, b, c]) => {
    m.tri(front[a], front[b], front[c]);
    m.tri(back[a], back[c], back[b]);
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (open.includes(i)) continue;
    const j = (i + 1) % n;
    m.quad(front[i], back[i], back[j], front[j]);
  }
  return solid(m);
}

// Лофт замкнутых колец с крышками
function loftRings(rings, uvFn = () => [0.5, 0.5], caps = true) {
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
  return solid(m);
}

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
    for (const t of ts) ring.push(V3(le - t * ch, y, Math.max(0.01, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(V3(le - ts[j] * ch, y, -Math.max(0.01, naca(ts[j]) * tc * ch)));
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
    const ch = lerp(chord0, chord1, s) * (k === n ? 0.55 : 1) * (1 - 0.25 * s * s);
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
      const h = sign * Math.max(0.012, naca(t) * tc * ch * (1 - 0.6 * s));
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

// ---------------------------------------------------------------------------
// ПЛАН-КОНТУРЫ И НАДСТРОЙКИ

function ccw(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, z0] = loop[i], [x1, z1] = loop[(i + 1) % loop.length];
    a += x0 * z1 - x1 * z0;
  }
  return a >= 0 ? loop : [...loop].reverse();
}
// скруглённый прямоугольник
function rrect(x0, x1, hw, r, seg = 3) {
  const pts = [];
  const C = [
    [x1 - r, -hw + r, -90],
    [x1 - r, hw - r, 0],
    [x0 + r, hw - r, 90],
    [x0 + r, -hw + r, 180],
  ];
  for (const [cx, cz, a0] of C)
    for (let j = 0; j <= seg; j++) {
      const a = ((a0 + (90 * j) / seg) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  return pts;
}
function ellipse(cx, cz, rx, rz, n = 24) {
  const pts = [];
  for (let j = 0; j < n; j++) {
    const a = (2 * Math.PI * j) / n;
    pts.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]);
  }
  return pts;
}
const UVC = () => [0.5, 0.5];
const fnY = (y) => (typeof y === 'function' ? y : () => y);
// Стенки по контуру (наружу), y0/y1 — числа или функции (x, z)
function walls(m, loop, y0, y1, inward = false, band = null) {
  const L = ccw(loop);
  const n = L.length;
  const Y0 = fnY(y0), Y1 = fnY(y1);
  const pts = band === null ? L : [...L, L[0]];
  let per = 0;
  const us = pts.map((p, i) => (i > 0 ? (per += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])) : 0));
  const uv = (i, y) => (band === null ? [0.5, 0.5] : [0.005 + (0.99 * us[i]) / WALL_PER, WB0 + (WB1 - WB0) * clamp01((y - band) / WALL_H)]);
  const A = pts.map(([x, z], i) => m.v(V3(x, Y0(x, z), z), ...uv(i, Y0(x, z))));
  const B = pts.map(([x, z], i) => m.v(V3(x, Y1(x, z), z), ...uv(i, Y1(x, z))));
  for (let i = 0; i < n; i++) {
    const j = band === null ? (i + 1) % n : i + 1;
    if (!inward) m.quad(A[i], B[i], B[j], A[j]);
    else m.quad(A[i], A[j], B[j], B[i]);
  }
}
// Плоская грань (контур с дырами) на высоте y
function flatFace(m, contour, holes, y, up, uvFn = UVC) {
  const all = [...contour, ...holes.flat()];
  const tris = THREE.ShapeUtils.triangulateShape(
    contour.map(([x, z]) => new THREE.Vector2(x, z)),
    holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))),
  );
  const ids = all.map(([x, z]) => m.v(V3(x, y, z), ...uvFn(x, z)));
  for (const [a, b, c] of tris) {
    const [ax, az] = all[a], [bx, bz] = all[b], [cx, cz] = all[c];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny > 0 === up) m.tri(ids[a], ids[b], ids[c]);
    else m.tri(ids[a], ids[c], ids[b]);
  }
}
// Плита: низ — кольцо (outer минус inner), борт, верх (в материал topKey)
function slab(m, outer, inner, yb, yt, key, topKey = key) {
  m.use(key);
  flatFace(m, outer, inner ? [inner] : [], yb, false);
  walls(m, outer, yb, yt);
  m.use(topKey);
  flatFace(m, outer, [], yt, true, topKey === 'teak' ? uvDeck : UVC);
}
// Фальшборт толщиной th по контуру outer (inner — внутренний контур)
function bulwark(m, outer, inner, y0, y1) {
  walls(m, outer, y0, y1);
  walls(m, inner, y0, y1, true);
  flatFace(m, outer, [inner], y1, true);
}
const onDeck = (x, z) => deckSurf(x, z) - 0.06;

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function heightToNormal(hgt, W, H, k, wrap = false) {
  const hd = hgt.getContext('2d').getImageData(0, 0, W, H).data;
  const nrm = makeCanvas(W, H);
  const N = nrm.getContext('2d');
  const img = N.createImageData(W, H);
  const at = (x, y) => {
    if (wrap) {
      x = (x + W) % W;
      y = (y + H) % H;
    } else {
      x = Math.min(W - 1, Math.max(0, x));
      y = Math.min(H - 1, Math.max(0, y));
    }
    return hd[(y * W + x) * 4];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      img.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  N.putImageData(img, 0, 0);
  return nrm;
}

const GREY = '#7b8287';
const GREY_RGB = [123, 130, 135];

function paintHullAtlas() {
  const S = ATLAS;
  const col = makeCanvas(S, S), hgt = makeCanvas(S, S);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  let seed = 7654321;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const px = (u) => u * S;
  const py = (v) => (1 - v) * S;
  C.fillStyle = GREY;
  C.fillRect(0, 0, S, S);
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
  // пятна краски
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * S, y = rnd() * S;
    const r = 6 + rnd() * 30;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.016)' : 'rgba(0,0,0,0.022)';
    C.beginPath();
    C.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2);
    C.fill();
  }
  const CASEMATES = [39.5, 32.5, 25.5, 18.5, 11.5, 4.5];

  for (const R of [REG.F, REG.A]) {
    const yTop = py(R.v1), yBot = py(R.v0);
    C.save();
    Hc.save();
    for (const ctx of [C, Hc]) {
      ctx.beginPath();
      ctx.rect(0, yTop, S, yBot - yTop);
      ctx.clip();
    }
    const V = (a) => py(regV(R, a));
    // подводная часть, ватерлиния, броневой пояс — по столбцам
    for (let i = 0; i < S; i++) {
      const x = regX(R, (i + 0.5) / S);
      if (x < XS - 2 || x > XF + 1) continue;
      const aRed = arcAt(x, WL - 0.3), aBoot = arcAt(x, WL + 0.75);
      if (aRed !== null && aRed > 0) {
        C.fillStyle = '#6a2c26';
        C.fillRect(i, V(aRed), 1, V(0) - V(aRed) + 1);
      }
      if (aBoot !== null) {
        const a0 = aRed ?? 0;
        C.fillStyle = '#25282a';
        C.fillRect(i, V(aBoot), 1, V(a0) - V(aBoot) + 0.5);
        // грязный налёт над ватерлинией
        const aDirt = arcAt(x, WL + 1.6);
        if (aDirt !== null) {
          const g = C.createLinearGradient(0, V(aBoot), 0, V(aDirt));
          g.addColorStop(0, 'rgba(60,58,50,0.35)');
          g.addColorStop(1, 'rgba(60,58,50,0)');
          C.fillStyle = g;
          C.fillRect(i, V(aDirt), 1, V(aBoot) - V(aDirt));
        }
      }
      // броневой пояс: ступень по верхней кромке
      if (x > -60 && x < 68) {
        const aT = arcAt(x, WL + 2.5), aB = arcAt(x, WL - 1.0);
        if (aT !== null && aB !== null) {
          Hc.fillStyle = 'rgb(150,150,150)';
          Hc.fillRect(i, V(aT), 1, V(aB) - V(aT));
          C.fillStyle = 'rgba(30,34,36,0.45)';
          C.fillRect(i, V(aT) - 1, 1, 2);
          C.fillStyle = 'rgba(255,255,255,0.08)';
          C.fillRect(i, V(aT) + 1, 1, 1);
        }
      }
    }
    // швы обшивки: продольные (по обводу) и стыки листов
    for (let i = 0; i < S; i += 2) {
      const x = regX(R, (i + 1) / S);
      if (x < XS - 2 || x > XF + 1) continue;
      for (let y = 1.2; y < 20; y += 1.9) {
        const a = arcAt(x, y);
        if (!a) continue;
        C.fillStyle = 'rgba(20,24,26,0.14)';
        C.fillRect(i, V(a) - 0.75, 2, 1.5);
        Hc.fillStyle = 'rgb(108,108,108)';
        Hc.fillRect(i, V(a) - 0.75, 2, 1.5);
      }
    }
    for (let x = R.x0 + 2.2; x < R.x0 + XU; x += 5.4 + rnd() * 1.4) {
      const X = px(regU(R, x));
      line(C, X, yTop, X, yBot, 1.5, 'rgba(20,24,26,0.13)');
      line(Hc, X, yTop, X, yBot, 1.5, 'rgb(110,110,110)');
    }
    // фигура на борту в метрах вокруг (x, y)
    const hullShape = (x, y, dx, dy, fill, hFill, round = 0.5, stroke = null) => {
      if (regU(R, x) < -0.02 || regU(R, x) > 1.02) return null;
      const r = sideAt(x, y), ra = sideAt(x + 0.05, y), rb = sideAt(x, y + 0.05);
      if (!r || !ra || !rb) return null;
      const ex = [((regU(R, x + 0.05) - regU(R, x)) / 0.05) * S, (-(regV(R, ra.arc) - regV(R, r.arc)) / 0.05) * S];
      const ey = [0, (-(regV(R, rb.arc) - regV(R, r.arc)) / 0.05) * S];
      const draw = (ctx, f, st) => {
        ctx.save();
        ctx.setTransform(ex[0], ex[1], ey[0], ey[1], px(regU(R, x)), py(regV(R, r.arc)));
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
      draw(Hc, hFill, stroke ? ['rgb(80,80,80)', stroke[1]] : null);
      return r;
    };
    const streak = (x, y, len, alpha, w = 4) => {
      if (regU(R, x) < -0.02 || regU(R, x) > 1.02) return;
      const r = sideAt(x, y), r2 = sideAt(x, y - len);
      if (!r || !r2) return;
      const g = C.createLinearGradient(0, V(r.arc), 0, V(r2.arc));
      g.addColorStop(0, `rgba(88,60,40,${alpha})`);
      g.addColorStop(1, 'rgba(88,60,40,0)');
      C.fillStyle = g;
      C.fillRect(px(regU(R, x)) - w / 2, V(r.arc), w + rnd() * 2, V(r2.arc) - V(r.arc));
    };
    // иллюминаторы
    const port = (x, y) => {
      if (hullShape(x, y, 0.44, 0.44, '#1b1f22', 'rgb(70,70,70)', 0.5, ['rgba(180,186,190,0.55)', 1.2]) && rnd() < 0.12)
        streak(x, y - 0.25, 0.8 + rnd() * 1.5, 0.22, 3);
    };
    for (let x = -86; x <= 84; x += 2.35) {
      if (Math.abs(x - XBRK) < 1.2) continue;
      port(x, 13.0);
    }
    for (let x = 46; x <= 84; x += 2.35) port(x, 15.4);
    for (let x = -26; x < 46; x += 2.35) {
      if (CASEMATES.some((c) => Math.abs(x - c) < 2.0)) continue;
      port(x, 15.6);
    }
    // казематы 6-дюймовых орудий: ниши с рамой
    for (const xc of CASEMATES) {
      hullShape(xc, 15.35, 2.3, 1.9, 'rgba(46,50,53,1)', 'rgb(118,118,118)', 0.12, ['rgba(25,28,30,0.9)', 2]);
      hullShape(xc, 15.35, 1.5, 1.25, '#15181a', 'rgb(40,40,40)', 0.15);
      streak(xc + 0.6, 14.3, 1.8, 0.25, 4);
    }
    // клюзы
    hullShape(86.5, 17.0, 1.25, 1.0, '#141618', 'rgb(30,30,30)', 0.5, ['rgba(160,165,168,0.6)', 3]);
    streak(86.5, 16.4, 4.0, 0.4, 8);
    streak(86.0, 16.4, 3.0, 0.25, 5);
    // шпигаты под кромкой палубы
    for (let x = -88; x < 88; x += 6.1) {
      const y = deckLine(x) - 0.45;
      if (CASEMATES.some((c) => Math.abs(x - c) < 1.6) || Math.abs(x - XBRK) < 1) continue;
      if (hullShape(x, y, 0.3, 0.14, '#202427', 'rgb(60,60,60)', 0.5)) streak(x, y - 0.1, 1.2 + rnd() * 2.2, 0.28, 3);
    }
    C.restore();
    Hc.restore();
  }
  // стены надстроек: иллюминаторы и двери
  {
    const sx = (0.99 * S) / WALL_PER, sy = ((WB1 - WB0) * S) / WALL_H;
    const X = (p) => px(0.005) + p * sx, Y = (h) => py(WB0 + ((WB1 - WB0) * h) / WALL_H);
    const g = C.createLinearGradient(0, Y(0), 0, Y(0.6));
    g.addColorStop(0, 'rgba(50,48,42,0.3)');
    g.addColorStop(1, 'rgba(50,48,42,0)');
    C.fillStyle = g;
    C.fillRect(0, Y(0.6), S, Y(0) - Y(0.6));
    line(C, 0, Y(2.45), S, Y(2.45), 2, 'rgba(20,24,26,0.18)');
    for (let p = 1.0; p < WALL_PER; p += 2.3) {
      if ((p % 12.5) > 3.0 && (p % 12.5) < 5.2) continue;
      for (const ctx of [C, Hc]) {
        ctx.beginPath();
        ctx.ellipse(X(p), Y(1.6), 0.21 * sx, 0.21 * sy, 0, 0, Math.PI * 2);
        ctx.fillStyle = ctx === C ? '#1b1f22' : 'rgb(70,70,70)';
        ctx.fill();
        ctx.strokeStyle = ctx === C ? 'rgba(180,186,190,0.5)' : 'rgb(90,90,90)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    for (let p = 4.0; p < WALL_PER; p += 12.5) {
      C.fillStyle = '#5d6468';
      C.fillRect(X(p - 0.42), Y(1.95), 0.84 * sx, Y(0.05) - Y(1.95));
      C.strokeStyle = 'rgba(25,28,30,0.8)';
      C.lineWidth = 2;
      C.strokeRect(X(p - 0.42), Y(1.95), 0.84 * sx, Y(0.05) - Y(1.95));
      Hc.fillStyle = 'rgb(112,112,112)';
      Hc.fillRect(X(p - 0.42), Y(1.95), 0.84 * sx, Y(0.05) - Y(1.95));
      C.fillStyle = '#2a2e31';
      C.fillRect(X(p + 0.22), Y(1.0), 2, 6);
    }
  }
  // прочее (торцы, переборка полубака): ровная краска
  const N = heightToNormal(hgt, S, S, 2.0 / 255);
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.anisotropy = 8;
  map.name = 'Hull_Atlas_Color';
  const normalMap = new THREE.CanvasTexture(N);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = 'Hull_Atlas_Normal';
  return { map, normalMap };
}

// Палубный настил: плитка 8 × 3.6 м, 24 доски по 15 см
function paintDeck() {
  const W = 1024, H = 512, NP = 24;
  const col = makeCanvas(W, H), hgt = makeCanvas(W, H);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  C.fillStyle = '#7a6c56';
  C.fillRect(0, 0, W, H);
  Hc.fillStyle = 'rgb(140,140,140)';
  Hc.fillRect(0, 0, W, H);
  const ph = H / NP;
  for (let r = 0; r < NP; r++) {
    const y0 = r * ph;
    let x = -rnd() * 300;
    const cuts = [];
    while (x < W) {
      const len = 250 + rnd() * 300;
      const t = 100 + Math.round(rnd() * 24);
      const fill = `rgb(${t + 14},${t + 4},${t - 14})`;
      for (const off of [0, W, -W]) {
        C.fillStyle = fill;
        C.fillRect(x + off, y0, len, ph);
        // волокна
        for (let k = 0; k < 4; k++) {
          C.fillStyle = `rgba(60,45,30,${0.03 + rnd() * 0.04})`;
          C.fillRect(x + off, y0 + rnd() * ph, len, 1);
        }
      }
      cuts.push(x);
      x += len;
    }
    for (const cx of cuts)
      for (const off of [0, W, -W]) {
        C.fillStyle = 'rgba(40,32,24,0.8)';
        C.fillRect(cx + off - 1, y0, 2, ph);
        Hc.fillStyle = 'rgb(90,90,90)';
        Hc.fillRect(cx + off - 1, y0, 2, ph);
      }
    C.fillStyle = 'rgba(32,26,20,0.85)';
    C.fillRect(0, y0, W, 2);
    Hc.fillStyle = 'rgb(70,70,70)';
    Hc.fillRect(0, y0, W, 2);
  }
  for (let i = 0; i < 260; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,250,240,0.04)' : 'rgba(0,0,0,0.05)';
    const x = rnd() * W, y = rnd() * H, w = 30 + rnd() * 120, h = 4 + rnd() * 14;
    C.fillRect(x, y, w, h);
    C.fillRect(x - W, y, w, h);
  }
  const N = heightToNormal(hgt, W, H, 1.6 / 255, true);
  const rep = [(2 * XU) / 8, (2 * ZU) / 3.6];
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.name = 'Deck_Planks_Color';
  const normalMap = new THREE.CanvasTexture(N);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.name = 'Deck_Planks_Normal';
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...rep);
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// КОРПУС: борта + палубы (два материала в одной сетке, тело замкнуто)

function buildHull() {
  const m = new Mesher();
  const rings = STATIONS.map((st) => {
    const c = sec(st.xn);
    const row = sectionRow(c);
    const R = REG[st.half];
    m.use('hull');
    const S = row.map(({ p, arc }) => m.v(p, regU(R, p.x), regV(R, arc)));
    const P = row.map(({ p, arc }) => m.v(V3(p.x, p.y, -p.z), regU(R, p.x), regV(R, arc)));
    const Dp = [];
    for (let j = 0; j <= ND; j++) {
      const z = c.wd * (1 - (2 * j) / ND);
      Dp.push(V3(c.xn, c.yd + camberAt(c, z), z));
    }
    m.use('teak');
    const D = Dp.map((p) => m.v(p, ...uvDeck(p.x, p.z)));
    return { st, c, row, S, P, D, Dp };
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k], b = rings[k + 1];
    if (a.st.half !== b.st.half) continue; // шов развёртки на миделе
    m.use('hull');
    m.strip(a.S, b.S);
    m.strip(b.P, a.P);
    if (a.st.xn < XBRK !== b.st.xn < XBRK) {
      // переборка среза полубака
      const Wa = a.Dp.map((p) => m.v(p, ...MISC_UV));
      const Wb = b.Dp.map((p) => m.v(p, ...MISC_UV));
      m.strip(Wa, Wb);
    } else {
      m.use('teak');
      m.strip(a.D, b.D);
    }
  }
  m.use('hull');
  [0, rings.length - 1].forEach((k) => {
    const r = rings[k];
    const pts = [...r.row.map((o) => o.p), ...r.Dp.slice(1, -1), ...[...r.row].reverse().slice(0, -1).map((o) => V3(o.p.x, o.p.y, -o.p.z))];
    const ids = pts.map((p) => m.v(p, ...MISC_UV));
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    c.divideScalar(pts.length);
    const ci = m.v(c, ...MISC_UV);
    for (let j = 0; j < ids.length; j++) {
      if (k === 0) m.tri(ci, ids[j], ids[(j + 1) % ids.length]);
      else m.tri(ci, ids[(j + 1) % ids.length], ids[j]);
    }
  });
  return m.build({ orient: true });
}

// ---------------------------------------------------------------------------
// БАШНЯ ГК 15"/42 Mk I (в своих координатах: к носу +X, начало — центр барбета на его верхнем срезе)

function turretGeometry(rf) {
  const m = new Mesher();
  const bot = [[4.4, 3.0], [3.9, 4.55], [-4.6, 4.55], [-5.6, 3.8], [-6.0, 2.0], [-6.0, -2.0], [-5.6, -3.8], [-4.6, -4.55], [3.9, -4.55], [4.4, -3.0]];
  const top = [[3.1, 2.85], [2.65, 4.35], [-4.5, 4.35], [-5.45, 3.65], [-5.85, 1.95], [-5.85, -1.95], [-5.45, -3.65], [-4.5, -4.35], [2.65, -4.35], [3.1, -2.85]];
  const ring = (pts, y) => ccw(pts).map(([x, z]) => V3(x, y, z));
  m.add(loftRings([ring(bot, 0.04), ring(top, 2.95)]));
  const gun = latheX([[0.78, 3.0], [0.78, 4.6], [0.6, 5.2], [0.55, 7.0], [0.45, 13.5], [0.4, 16.8], [0.47, 17.1], [0.47, 17.6], [0.27, 17.6], [0.27, 17.3], [0, 17.3]], 18);
  [1, -1].forEach((sd) => m.add(gun.clone().translate(0, 1.55, sd * 1.2)));
  // колпаки прицелов
  const hood = lathe([[0.55, 2.93], [0.55, 3.2], [0.38, 3.42], [0, 3.48]], 14);
  [1, -1].forEach((sd) => m.add(hood.clone().translate(1.6, 0, sd * 3.3)));
  m.add(lathe([[0.5, 2.93], [0.5, 3.25], [0, 3.3]], 12).translate(-3.2, 0, -1.6)); // люк
  if (rf) {
    // дальномер на крыше
    m.add(rod([-4.0, 3.75, -5.0], [-4.0, 3.75, 5.0], 0.42, 14));
    [1, -1].forEach((sd) => m.add(rod([-4.0, 2.93, sd * 2.0], [-4.0, 3.4, sd * 2.0], 0.3, 10, true)));
  }
  return m.build();
}

// Корпус шлюпки: киль y = 0, нос +X, сверху тент
function boatGeometry(L, B, D) {
  const rings = [];
  const N = 12, M = 8;
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N;
    const k = t > 0 ? 1 - t ** 2.2 : 1 - (-t) ** 3.5;
    const hb = Math.max(0.04, (B / 2) * Math.sqrt(Math.max(0, k)));
    const sheer = D + 0.25 * t * t;
    const dep = D * Math.max(0.2, 1 - 0.5 * t ** 4);
    const ring = [];
    for (let j = 0; j <= M; j++) {
      const ph = (Math.PI * j) / M;
      ring.push(V3((t * L) / 2, sheer - dep * Math.sin(ph) ** 0.6, hb * Math.cos(ph)));
    }
    ring.push(V3((t * L) / 2, sheer + 0.12, 0));
    rings.push(ring);
  }
  return loftRings(rings);
}

// ---------------------------------------------------------------------------

export function createRevenge() {
  const ship = new THREE.Group();
  ship.name = 'Battleship_Revenge_Class';
  const hullTex = paintHullAtlas();
  const deckTex = paintDeck();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    hull: std('Hull_Paint', 0xffffff, 0.72, 0.15, { map: hullTex.map, normalMap: hullTex.normalMap }),
    teak: std('Deck_Teak', 0xffffff, 0.85, 0.0, { map: deckTex.map, normalMap: deckTex.normalMap }),
    grey: std('Paint_Grey', 0x7b8287, 0.7, 0.2),
    dark: std('Paint_Dark', 0x2b2f32, 0.6, 0.35),
    light: std('Paint_Light_Grey', 0x9aa1a4, 0.75, 0.1),
    red: std('Antifouling_Red', 0x6a2c26, 0.8, 0.1),
    bronze: std('Propeller_Bronze', 0xa07a45, 0.35, 0.9),
  };
  const group = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const mesh = (src, name, parent, x = 0, y = 0, z = 0) => {
    const geo = src instanceof Mesher ? src.build() : src;
    const groups = geo.userData.groups || [{ key: 0 }];
    let mat;
    if (groups.length > 1) {
      geo.clearGroups();
      groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
      mat = groups.map((g) => M[g.key]);
    } else mat = M[groups[0].key];
    geo.userData = {};
    const mm = new THREE.Mesh(geo, mat);
    mm.name = name;
    geo.name = name;
    mm.position.set(x, y, z);
    parent.add(mm);
    return mm;
  };
  const one = (key, list) => {
    const m = new Mesher().use(key);
    list.forEach((g) => m.add(g));
    return m;
  };

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  mesh(buildHull(), 'Hull_Main', hullG);

  // подводные выступы: валы, кронштейны, дейдвуд, скуловые кили
  const PROPS = [
    { name: 'Propeller_1', x: -72.0, z: 7.6, sd: 1 },
    { name: 'Propeller_2', x: -79.0, z: 3.0, sd: 1 },
    { name: 'Propeller_3', x: -79.0, z: -3.0, sd: -1 },
    { name: 'Propeller_4', x: -72.0, z: -7.6, sd: -1 },
  ];
  const PROP_R = 1.45;
  // ось винта — на 0,45 м ниже днища над верхней половиной диска
  for (const p of PROPS) {
    let y = Infinity;
    for (let a = 0; a <= Math.PI + 1e-6; a += Math.PI / 12) {
      const b = bottomAt(p.x, p.z + PROP_R * Math.cos(a));
      if (b !== null) y = Math.min(y, b - PROP_R * Math.sin(a));
    }
    p.y = +(y - 0.45).toFixed(2);
  }
  const RUD = { x: -87.0, y0: 1.75 };
  RUD.y1 = bottomAt(RUD.x - 0.4, 0) - 0.12;
  const debug = { props: [], rudderTop: RUD.y1 };
  {
    const parts = [];
    for (const p of PROPS) {
      // клиренс диска до днища
      let clear = Infinity;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const zz = p.z + PROP_R * Math.cos(a), yy = p.y + PROP_R * Math.sin(a);
        const b = bottomAt(p.x, zz);
        if (b !== null) clear = Math.min(clear, b - yy);
      }
      // вал до входа в корпус
      let xe = p.x + 1;
      while (xe < -20) {
        const b = bottomAt(xe, p.z);
        if (b !== null && b < p.y - 0.4) break;
        xe += 0.5;
      }
      debug.props.push({ name: p.name, y: p.y, clear: +clear.toFixed(2), shaftIn: xe });
      parts.push(rod([p.x + 0.6, p.y, p.z], [xe, p.y, p.z], 0.24, 12, true));
      // кронштейн (A-образный)
      const xb = p.x + 1.6;
      [-1.4, 1.2].forEach((dz) => {
        const zz = p.z + p.sd * dz;
        const yb = bottomAt(xb + 0.8, zz);
        parts.push(rod([xb, p.y, p.z], [xb + 0.8, (yb ?? p.y + 2) + 0.35, zz], 0.13, 8, true));
      });
      parts.push(latheX([[0.42, -0.6], [0.42, 0.6]], 14, { top: false }).translate(xb, p.y, p.z));
    }
    // дейдвуд перед рулём: верхнее ребро внутри корпуса — без грани
    const sk = [];
    for (let x = -50; x >= -85.01; x -= 2.5) sk.push([x, Math.max(0, ((-50 - x) / 35) * 1.65)]);
    const top = [];
    for (let x = -85; x <= -50.01; x += 2.5) top.push([x, bottomAt(x, 0) + 0.3]);
    top.push([-50, 0.6]);
    const poly = [...sk, ...top];
    parts.push(prism(poly, 0.7, top.slice(0, -1).map((_, i) => sk.length + i)));
    // скуловые кили
    [1, -1].forEach((sd) => {
      const pts = [];
      for (let x = -32; x <= 34; x += 6) {
        const r = sideAt(x, 1.15);
        pts.push(V3(x, 1.15, sd * (r ? r.z : 13)));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.22, 4, false);
      parts.push(tube.scale(1, 1, 1));
    });
    mesh(one('red', parts), 'Hull_Appendages', hullG);
  }

  // кормовой балкон (stern walk) на уровне верхней палубы
  {
    const y = 12.6, th = 0.22, off = 1.15;
    let xt = -86;
    while (sideAt(xt - 0.05, y + th)) xt -= 0.05;
    const half = [];
    for (let k = 0; k <= 18; k++) {
      const x = -86 + (xt + 0.02 + 86) * Math.sin(((k / 18) * Math.PI) / 2);
      const r = sideAt(x, y + th);
      half.push([x, r ? Math.max(0.02, r.z - 0.04) : 0.02]);
    }
    const inner = [...half, ...[...half].reverse().map(([x, z]) => [x, -z])];
    const n = inner.length;
    const outer = inner.map((p, i) => {
      const a = inner[Math.max(0, i - 1)], b = inner[Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
      return [p[0] + (off * tz) / l, p[1] - (off * tx) / l];
    });
    const m = new Mesher();
    const contour = [...outer, ...[...inner].reverse()];
    flatFace(m, contour, [], y + th, true);
    flatFace(m, contour, [], y, false);
    const ob = outer.map(([x, z]) => m.v(V3(x, y, z))), ot = outer.map(([x, z]) => m.v(V3(x, y + th, z)));
    m.strip(ob, ot);
    [0, n - 1].forEach((i) => {
      const a = m.v(V3(inner[i][0], y, inner[i][1])), b = m.v(V3(inner[i][0], y + th, inner[i][1]));
      m.quad(a, b, ot[i], ob[i]);
    });
    const walk = solid(m);
    const parts = [walk];
    const rail = outer.map(([x, z], i) => {
      const [ix, iz] = inner[i];
      return [lerp(x, ix, 0.08), lerp(z, iz, 0.08)];
    });
    rail.forEach(([x, z], i) => {
      if (i % 2 === 0 || i === n - 1) parts.push(rod([x, y + th - 0.02, z], [x, y + th + 1.0, z], 0.035, 4, true));
      if (i > 0) [0.5, 1.0].forEach((h) => parts.push(rod([rail[i - 1][0], y + th + h, rail[i - 1][1]], [x, y + th + h, z], 0.03, 4, true)));
    });
    mesh(one('grey', parts), 'Sternwalk', hullG);
  }

  // ======================= БАШНИ ГК, БАРБЕТЫ
  const armG = group('Armament', ship);
  const TUR = [
    { name: 'Turret_A', x: 60.0, top: 18.9, aft: false, rf: false },
    { name: 'Turret_B', x: 47.5, top: 22.3, aft: false, rf: true },
    { name: 'Turret_X', x: -38.0, top: 19.0, aft: true, rf: true },
    { name: 'Turret_Y', x: -52.0, top: 15.6, aft: true, rf: false },
  ];
  {
    const parts = [];
    for (const t of TUR) {
      let lo = Infinity;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) lo = Math.min(lo, deckSurf(t.x + 4.2 * Math.cos(a), 4.2 * Math.sin(a)));
      parts.push(lathe([[4.2, lo - 0.08], [4.2, t.top]], 36, { top: false }).translate(t.x, 0, 0));
    }
    mesh(one('grey', parts), 'Barbettes', armG);
  }
  for (const t of TUR) {
    const g = group(t.name, armG, t.x, t.top, 0);
    const geo = turretGeometry(t.rf);
    if (t.aft) geo.rotateY(Math.PI);
    mesh(one('grey', [geo]), `${t.name}_House`, g);
  }

  // 6-дюймовые орудия в казематах
  {
    const parts = [];
    const barrel = latheX([[0.24, -0.3], [0.24, 0.35], [0.17, 0.6], [0.13, 5.0], [0.155, 5.15], [0.155, 5.4], [0.09, 5.4], [0.09, 5.2], [0, 5.2]], 12).rotateY(-Math.PI / 2);
    for (const xc of [39.5, 32.5, 25.5, 18.5, 11.5, 4.5]) {
      const r = sideAt(xc, 15.35);
      const g = barrel.clone().translate(xc, 15.35, r.z - 0.05);
      parts.push(g, mirrorZ(g));
    }
    mesh(one('grey', parts), 'Secondary_Guns_6in', armG);
  }
  // 4-дюймовые зенитные спарки и 8-ствольные «пом-помы» на шлюпочной палубе
  {
    const parts = [];
    const ha = () => {
      const p = [];
      p.push(lathe([[1.0, -0.05], [1.0, 0.25], [0.75, 0.35], [0.45, 0.45], [0.45, 1.0], [0.6, 1.1], [0, 1.15]], 18));
      p.push(box(1.5, 0.7, 1.1, 0.0, 1.45, 0));
      p.push(box(0.9, 0.9, 0.12, -0.2, 1.5, 0.75), box(0.9, 0.9, 0.12, -0.2, 1.5, -0.75)); // сиденья наводчиков
      [1, -1].forEach((sd) => {
        const b = latheX([[0.13, 0], [0.1, 0.4], [0.08, 4.0], [0.095, 4.05], [0.095, 4.25], [0, 4.25]], 10);
        b.rotateZ(0.22).translate(0.4, 1.55, sd * 0.27);
        p.push(b);
      });
      return p;
    };
    const pom = () => {
      const p = [];
      p.push(lathe([[1.0, -0.05], [1.0, 0.3], [0.8, 0.5], [0, 0.52]], 18));
      p.push(box(1.4, 1.1, 2.2, 0, 1.03, 0));
      for (const yy of [0.88, 1.2]) for (const zz of [-0.8, -0.27, 0.27, 0.8]) p.push(rod([0.6, yy, zz], [2.9, yy + 0.2, zz], 0.05, 6));
      return p;
    };
    for (const [x, z] of [[20.0, 6.6], [-23.5, 6.6]])
      [1, -1].forEach((sd) => ha().forEach((g) => parts.push(g.translate(x, BOAT, sd * z))));
    [1, -1].forEach((sd) => pom().forEach((g) => parts.push(g.translate(15.0, BOAT, sd * 6.0))));
    mesh(one('grey', parts), 'AA_Guns', armG);
  }

  // ======================= НАДСТРОЙКИ
  const supG = group('Superstructure', ship);
  {
    const m = new Mesher();
    // надстройка на полубаке (батарейная/шлюпочная палуба)
    const L0 = rrect(-26, 41.5, 8.2, 1.2);
    m.use('hull');
    walls(m, L0, onDeck, BOAT - 0.3, false, FC);
    slab(m, rrect(-26.3, 41.8, 8.5, 1.4), L0, BOAT - 0.3, BOAT, 'grey', 'teak');
    // боевая рубка
    const CT = ellipse(38.2, 0, 2.9, 2.5, 28);
    m.use('grey');
    walls(m, CT, BOAT - 0.02, 21.6);
    m.use('dark');
    walls(m, CT, 21.6, 21.95);
    slab(m, ellipse(38.2, 0, 3.15, 2.75, 28), CT, 21.95, 22.2, 'grey');
    // мостик: 1-й ярус (флагманский)
    const B1 = rrect(24.0, 35.0, 6.0, 1.8);
    m.use('hull');
    walls(m, B1, BOAT - 0.02, 22.6, false, BOAT);
    slab(m, rrect(23.6, 35.4, 7.2, 1.6), B1, 22.6, 22.9, 'grey');
    // 2-й ярус с крыльями
    const B2 = rrect(24.6, 34.4, 4.8, 1.6);
    m.use('grey');
    walls(m, B2, 22.9, 24.6);
    m.use('dark');
    walls(m, B2, 24.6, 25.2);
    m.use('grey');
    walls(m, B2, 25.2, 25.6);
    slab(m, rrect(24.2, 35.0, 9.8, 1.0), B2, 25.6, 25.9, 'grey');
    // 3-й ярус: рулевая рубка
    const B3 = rrect(25.6, 33.8, 3.8, 1.4);
    m.use('grey');
    walls(m, B3, 25.9, 26.9);
    m.use('dark');
    walls(m, B3, 26.9, 27.6);
    m.use('grey');
    walls(m, B3, 27.6, 28.0);
    const CP = rrect(25.0, 34.5, 5.4, 1.2);
    slab(m, CP, B3, 28.0, 28.3, 'grey');
    // открытый компасный мостик: фальшборт, штурманская рубка, визир
    m.use('grey');
    bulwark(m, CP, rrect(25.12, 34.38, 5.28, 1.08), 28.3, 29.4);
    const B4 = rrect(25.6, 28.6, 2.4, 0.7);
    walls(m, B4, 28.28, 30.0);
    slab(m, rrect(25.4, 28.8, 2.6, 0.8), B4, 30.0, 30.2, 'grey');
    m.use('grey');
    m.add(lathe([[0.7, 28.28], [0.7, 29.3], [0.45, 29.5], [0, 29.55]], 14).translate(32.4, 0, 0));
    // дальномер на крыше штурманской рубки
    m.add(rod([27.1, 30.75, -2.7], [27.1, 30.75, 2.7], 0.3, 12));
    [1, -1].forEach((sd) => m.add(rod([27.1, 30.18, sd * 1.0], [27.1, 30.5, sd * 1.0], 0.18, 8, true)));
    // кормовой командно-дальномерный пост (на шлюпочной палубе)
    const AC = rrect(-25.7, -23.3, 1.6, 0.6);
    m.use('hull');
    walls(m, AC, BOAT - 0.02, 22.4, false, BOAT);
    m.use('dark');
    walls(m, AC, 22.4, 22.8);
    slab(m, rrect(-25.9, -23.1, 1.8, 0.7), AC, 22.8, 23.0, 'grey');
    mesh(m, 'Superstructure_Main', supG);
  }
  // дымовая труба
  {
    const m = new Mesher();
    const N = 36, cx = 9.0, rx = 4.3, rz = 3.1;
    const ringAt = (y, s, off) =>
      Array.from({ length: N }, (_, j) => {
        const a = (2 * Math.PI * j) / N;
        const sh = -0.07 * (y - BOAT);
        return V3(cx + sh + (rx * s - off) * Math.cos(a), y, (rz * s - off) * Math.sin(a));
      });
    const rows = [
      [BOAT - 0.02, 1.0, 0, 'grey'],
      [33.0, 0.94, 0, 'both'],
      [34.4, 0.94, 0, 'dark'],
      [34.4, 0.94, 0.18, 'dark'],
      [33.7, 0.94, 0.18, 'dark'],
    ];
    const ids = rows.map(([y, s, off, k]) => {
      const pts = ringAt(y, s, off);
      const r = {};
      if (k !== 'dark') r.grey = (m.use('grey'), pts.map((p) => m.v(p)));
      if (k !== 'grey') r.dark = (m.use('dark'), pts.map((p) => m.v(p)));
      return r;
    });
    m.use('grey');
    m.strip(ids[0].grey, ids[1].grey, true);
    m.use('dark');
    for (let k = 1; k < 4; k++) m.strip(ids[k].dark, ids[k + 1].dark, true);
    const inner = ringAt(33.7, 0.94, 0.18);
    flatFace(m, inner.map((p) => [p.x, p.z]), [], 33.7, true);
    // паропроводы на задней стенке
    m.use('grey');
    [1, -1].forEach((sd) => m.add(rod([cx - 4.4, BOAT, sd * 0.9], [cx - 4.05 - 0.07 * 14.2, 34.0, sd * 0.9], 0.2, 8)));
    mesh(m, 'Funnel', supG);
  }
  // площадка прожекторов за трубой и прожекторы
  {
    const m = new Mesher();
    m.use('grey');
    slab(m, rrect(0.6, 4.0, 5.6, 0.6), null, 26.0, 26.3, 'grey');
    for (const [x, z] of [[1.0, 4.9], [3.6, 4.9], [1.0, -4.9], [3.6, -4.9]]) m.add(rod([x, BOAT, z], [x, 26.0, z], 0.16, 8, true));
    bulwark(m, rrect(0.6, 4.0, 5.6, 0.6), rrect(0.68, 3.92, 5.52, 0.52), 26.3, 27.0);
    const light = (x, y, z) => {
      m.use('light');
      m.add(lathe([[0.32, -0.02], [0.22, 0.9], [0, 0.95]], 12).translate(x, y, z));
      m.add(latheX([[0, -0.6], [0.45, -0.55], [0.6, -0.35], [0.6, 0.4]], 16, { top: false }).translate(x, y + 1.4, z));
      m.use('dark');
      m.add(latheX([[0.6, 0.4], [0.35, 0.47], [0, 0.5]], 16).translate(x, y + 1.4, z));
    };
    [4.2, 1.5, -1.5, -4.2].forEach((z) => light(2.3, 26.28, z));
    // прожекторы на крыльях мостика и на кормовом посту
    [1, -1].forEach((sd) => light(30.0, 25.88, sd * 8.6));
    [1, -1].forEach((sd) => light(-24.5, 22.98, sd * 1.1));
    [1, -1].forEach((sd) => light(23.9, 36.08, sd * 1.2));
    mesh(m, 'Searchlights', supG);
  }

  // ======================= МАЧТЫ
  const mastG = group('Masts', ship);
  {
    const m = new Mesher();
    m.use('grey');
    // треногая фок-мачта
    m.add(rod([22.5, BOAT - 0.02, 0], [22.5, 35.8, 0], 0.55, 14, true));
    m.add(rod([22.5, 36.1, 0], [22.5, 43.6, 0], 0.55, 14, true));
    slab(m, rrect(20.9, 24.6, 2.1, 0.6), null, 35.8, 36.1, 'grey');
    m.use('grey');
    [1, -1].forEach((sd) => m.add(rod([16.5, BOAT - 0.02, sd * 4.6], [22.1, 43.6, sd * 0.4], 0.42, 12, true)));
    // марс (пост управления огнём)
    slab(m, rrect(19.5, 26.5, 3.6, 1.0), null, 43.6, 44.0, 'grey');
    const T = rrect(20.1, 25.9, 3.0, 1.0);
    m.use('grey');
    walls(m, T, 44.0, 45.3);
    m.use('dark');
    walls(m, T, 45.3, 46.0);
    m.use('grey');
    walls(m, T, 46.0, 46.3);
    slab(m, rrect(19.9, 26.1, 3.2, 1.1), T, 46.3, 46.5, 'grey');
    // директор
    const DCT = rrect(21.5, 24.3, 1.5, 0.6);
    m.use('grey');
    walls(m, DCT, 46.48, 47.8);
    flatFace(m, DCT, [], 47.8, true);
    [1, -1].forEach((sd) => m.add(rod([22.9, 47.2, sd * 1.45], [22.9, 47.2, sd * 2.7], 0.25, 10)));
    // стеньга и рей
    m.add(rod([22.9, 47.78, 0], [22.9, 58.0, 0], 0.2, 10));
    m.add(rod([22.9, 53.0, -5.5], [22.9, 53.0, 5.5], 0.1, 6));
    // грот-мачта: тренога с площадкой
    m.add(rod([-20.5, BOAT - 0.02, 0], [-20.5, 29.0, 0], 0.45, 14, true));
    m.add(rod([-20.5, 29.3, 0], [-20.5, 37.5, 0], 0.38, 12, true));
    m.add(rod([-20.5, 37.5, 0], [-20.5, 45.0, 0], 0.17, 8));
    m.add(rod([-20.5, 41.0, -4.2], [-20.5, 41.0, 4.2], 0.09, 6));
    [1, -1].forEach((sd) => m.add(rod([-25.0, BOAT - 0.02, sd * 3.2], [-20.9, 29.0, sd * 0.25], 0.32, 10, true)));
    slab(m, rrect(-24.5, -17.0, 3.0, 0.8), null, 29.0, 29.3, 'grey');
    const HAD = rrect(-23.8, -21.3, 1.6, 0.6);
    m.use('grey');
    walls(m, HAD, 29.28, 31.0);
    flatFace(m, HAD, [], 31.0, true);
    m.add(lathe([[0.9, 30.98], [0.9, 31.5], [0.6, 31.8], [0, 31.85]], 14).translate(-22.5, 0, 0));
    mesh(m, 'Masts_Main', mastG);
  }
  // такелаж и антенны
  {
    const parts = [];
    const w = (a, b) => parts.push(rod(a, b, 0.035, 4));
    w([22.9, 57.5, 0], [94.0, 26.0, 0]);
    w([-20.5, 44.5, 0], [-93.4, 21.5, 0]);
    [1, -1].forEach((sd) => w([22.9, 52.9, sd * 5.3], [-20.5, 40.9, sd * 4.0]));
    [1, -1].forEach((sd) => {
      w([22.5, 43.7, sd * 3.3], [12.5, BOAT + 0.1, sd * 7.6]);
      w([-20.5, 37.0, sd * 0.3], [-24.0, BOAT + 0.1, sd * 7.0]);
    });
    mesh(one('dark', parts), 'Rigging', mastG);
  }
  // стрела для шлюпок (поворот вокруг оси грот-мачты)
  {
    const g = group('Boat_Derrick', mastG, -20.5, 21.5, 0);
    const parts = [];
    parts.push(rod([0.62, 0, 0], [15.5, 6.0, 0], 0.22, 10));
    parts.push(box(0.5, 0.35, 0.35, 0.5, 0, 0));
    parts.push(rod([15.5, 6.0, 0], [0.0, 16.0, 0], 0.04, 4));
    parts.push(rod([15.5, 6.0, 0], [15.5, 3.2, 0], 0.03, 4));
    parts.push(box(0.3, 0.4, 0.3, 15.5, 3.0, 0));
    mesh(one('grey', parts), 'Boat_Derrick_Boom', g);
  }

  // ======================= ШЛЮПКИ
  const boatsG = group('Boats', ship);
  {
    const m = new Mesher();
    const BB = [
      [-9.5, 4.9, 13.0, 3.3, 1.7, true],
      [-9.5, -4.9, 13.0, 3.3, 1.7, true],
      [-10.0, 1.45, 9.5, 2.5, 1.3, false],
      [-10.0, -1.45, 9.5, 2.5, 1.3, false],
    ];
    const y0 = BOAT + 0.55;
    for (const [x, z, L, B, D, cabin] of BB) {
      m.use('light');
      m.add(boatGeometry(L, B, D).translate(x, y0, z));
      if (cabin) {
        m.add(boxNB(3.6, 1.1, 2.0, x + 0.8, y0 + D, z));
        m.use('dark');
        m.add(lathe([[0.22, y0 + D + 0.05], [0.22, y0 + D + 1.4], [0, y0 + D + 1.4]], 10).translate(x - 2.0, 0, z));
      }
      m.use('grey');
      [-0.28, 0.28].forEach((f) => m.add(boxNB(0.3, 0.75, B * 0.55, x + f * L, BOAT - 0.02, z)));
    }
    mesh(m, 'Boats_All', boatsG);
  }

  // ======================= ПАЛУБНОЕ ОБОРУДОВАНИЕ
  const deckG = group('Deck_Equipment', ship);
  {
    const m = new Mesher();
    const at = (g, x, z = 0, dy = 0) => g.translate(x, deckSurf(x, z) + dy, z);
    m.use('dark');
    const capstan = () => lathe([[0.75, -0.1], [0.75, 0.12], [0.55, 0.2], [0.5, 0.7], [0.62, 0.8], [0.58, 0.9], [0, 0.95]], 18);
    [[79.0, 2.4], [79.0, -2.4], [-80.0, 2.2], [-80.0, -2.2]].forEach(([x, z]) => m.add(at(capstan(), x, z)));
    // клюзы на палубе и якорные цепи
    [1, -1].forEach((sd) => {
      const hx = 86.0, hz = sd * 3.6;
      m.add(at(lathe([[0.75, -0.12], [0.75, 0.15], [0.5, 0.18], [0.5, 0.05], [0, 0.05]], 16), hx, hz));
      const cx = 79.0, cz = sd * 2.4;
      const chain = rod([hx - 0.6, 0, hz - sd * 0.15], [cx + 0.7, 0, cz + sd * 0.15], 0.14, 6, true);
      const mid = (hx + cx) / 2;
      chain.scale(1, 0.6, 1).translate(0, deckSurf(mid, (hz + cz) / 2) + 0.03, 0);
      m.add(chain);
      m.add(at(lathe([[0.5, -0.1], [0.5, 0.12], [0, 0.14]], 12), 75.5, sd * 1.9));
      const ch2 = rod([cx - 0.75, 0, cz], [75.9, 0, sd * 1.95], 0.14, 6, true).scale(1, 0.6, 1).translate(0, deckSurf(77, cz) + 0.03, 0);
      m.add(ch2);
    });
    // кнехты
    const bollard = () => {
      const p = new Mesher();
      p.add(boxNB(1.5, 0.14, 0.55, 0, -0.08, 0));
      [-0.45, 0.45].forEach((dx) => p.add(lathe([[0.2, 0.05], [0.19, 0.48], [0.27, 0.52], [0.27, 0.6], [0, 0.61]], 12).translate(dx, 0, 0)));
      return p.build();
    };
    for (const x of [76, 62, 30, -6, -42, -62, -82]) {
      const c = sec(x);
      [1, -1].forEach((sd) => m.add(at(bollard(), x, sd * (c.wd - 0.9))));
    }
    // волнолом
    m.use('grey');
    [1, -1].forEach((sd) => {
      const a = [74.5, 0], b = [69.0, sd * 7.0];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const g = boxNB(len, 1.15, 0.14);
      g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      g.translate(mx, deckSurf(mx, mz) - 0.25, mz);
      m.add(g);
    });
    // вентиляторы-грибки и световые люки
    const vent = () => lathe([[0.35, -0.08], [0.35, 0.9], [0.62, 1.0], [0.5, 1.15], [0, 1.18]], 14);
    [[66, 9], [66, -9], [-62, 6], [-62, -6], [-70, 3.5], [-70, -3.5], [44, 9.5], [44, -9.5]].forEach(([x, z]) => m.add(at(vent(), x, z)));
    [[-66, 0], [-73, 0], [-88, 0]].forEach(([x, z]) => m.add(at(boxNB(2.6, 0.75, 1.8, 0, -0.08, 0), x, z)));
    // гюйсшток и флагшток
    m.use('dark');
    m.add(rod([94.0, deckSurf(94) - 0.05, 0], [94.0, 26.0, 0], 0.08, 6));
    m.add(rod([-93.4, deckSurf(-93.4) - 0.05, 0], [-93.8, 21.6, 0], 0.08, 6));
    // якоря у клюзов
    [1, -1].forEach((sd) => {
      const a = new Mesher();
      a.add(box(0.32, 2.6, 0.28, 0, -1.3, 0));
      a.add(box(1.8, 0.45, 0.42, 0, -2.6, 0));
      [1, -1].forEach((s2) => a.add(box(0.42, 1.3, 0.34, s2 * 0.75, -2.15, 0).rotateZ(-s2 * 0.25)));
      a.add(new THREE.TorusGeometry(0.22, 0.07, 6, 12).translate(0, 0.05, 0));
      const g = a.build();
      const n = sideNormal(86.5, 15.4);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n));
      const r = sideAt(86.5, 15.6);
      g.translate(86.5, 16.75, r.z + 0.32);
      m.add(sd > 0 ? g : mirrorZ(g));
    });
    mesh(m, 'Deck_Fittings', deckG);
  }

  // леерные ограждения
  {
    const parts = [];
    const railLine = (pts, h = 1.0) => {
      pts.forEach((p) => parts.push(rod([p[0], p[1] - 0.04, p[2]], [p[0], p[1] + h, p[2]], 0.035, 4, true)));
      for (let i = 1; i < pts.length; i++)
        [0.5, h].forEach((f) => parts.push(rod([pts[i - 1][0], pts[i - 1][1] + f, pts[i - 1][2]], [pts[i][0], pts[i][1] + f, pts[i][2]], 0.03, 4, true)));
    };
    const edge = (x0, x1, sd) => {
      const pts = [];
      const n = Math.max(1, Math.round((x1 - x0) / 2.4));
      for (let i = 0; i <= n; i++) {
        const x = lerp(x0, x1, i / n);
        const c = sec(x);
        const z = sd * (c.wd - 0.22);
        pts.push([x, deckSurf(x, z), z]);
      }
      return pts;
    };
    [1, -1].forEach((sd) => {
      railLine(edge(XBRK + 0.3, 80, sd));
      railLine(edge(-90.5, XBRK - 0.4, sd));
      // шлюпочная палуба
      const pts = [];
      for (let x = -25.5; x <= 22.6; x += 2.4) pts.push([x, BOAT, sd * 8.32]);
      railLine(pts);
    });
    // поперёк среза полубака
    const c = sec(XBRK + 0.3), pts = [];
    for (let i = 0; i <= 10; i++) {
      const z = (c.wd - 0.22) * (1 - (2 * i) / 10);
      pts.push([XBRK + 0.3, deckSurf(XBRK + 0.3, z), z]);
    }
    railLine(pts);
    // раструбные вентиляторы
    const cowl = (h, yaw) => {
      const p = new Mesher();
      p.add(lathe([[0.32, -0.08], [0.32, h]], 12, { top: false }));
      p.add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(V3(0, h, 0), V3(0, h + 0.55, 0), V3(0.55, h + 0.55, 0)), 6, 0.32, 12, false));
      p.add(latheX([[0.32, 0.5], [0.5, 0.72], [0.56, 0.86], [0.46, 0.86], [0.3, 0.62], [0, 0.6]], 12).translate(0, h + 0.55, 0));
      return p.build().rotateY(yaw);
    };
    [[14.0, 2.6, BOAT, 0], [14.0, -2.6, BOAT, 0], [-1.2, 1.7, BOAT, Math.PI], [-1.2, -1.7, BOAT, Math.PI]].forEach(([x, z, y, yaw]) => parts.push(cowl(1.3, yaw).translate(x, y, z)));
    [[53.5, 9.3], [53.5, -9.3], [-63.5, 9.0], [-63.5, -9.0]].forEach(([x, z]) => parts.push(cowl(1.0, x > 0 ? 0 : Math.PI).translate(x, deckSurf(x, z), z)));
    mesh(one('grey', parts), 'Rails_And_Vents', deckG);
  }

  // ======================= ВИНТЫ И РУЛЬ
  const propG = group('Propulsion', ship);
  const props = [];
  {
    const blade = bladeGeometry({ r0: 0.35, r1: PROP_R, chord0: 0.85, chord1: 1.2, pitch: 4.2, skew: 0.25, tc: 0.12 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = latheX([[0, 0.75], [0.36, 0.62], [0.44, 0.3], [0.44, -0.45], [0.33, -0.75], [0, -1.3]], 16);
    const pr = new Mesher().use('bronze');
    [...bl, hub].forEach((g) => pr.add(g));
    const propR = pr.build();
    const propL = mirrorZ(propR);
    propL.userData.groups = [{ key: 'bronze' }];
    for (const p of PROPS) {
      const g = group(p.name, propG, p.x, p.y, p.z);
      mesh(p.sd > 0 ? propR.clone() : propL.clone(), `${p.name}_Blades`, g);
      props.push(g);
    }
  }
  {
    const half = (RUD.y1 - RUD.y0) / 2;
    const g = group('Rudder', propG, RUD.x, RUD.y0 + half, 0);
    const f = foil({ root: [1.0, -3.4], tip: [1.0, -3.0], span: 2 * half, tc: 0.15, y0: -half, nSpan: 4 });
    const stock = rod([0, half - 0.05, 0], [0, half + 0.6, 0], 0.22, 10, true);
    mesh(one('red', [f, stock]), 'Rudder_Blade', g);
  }

  // Анимация: винты правого борта вращаются по часовой (если смотреть с кормы), левого — против
  {
    const T = 1.0, n = 8;
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
      new THREE.AnimationClip(
        'Propellers_Spin',
        T,
        PROPS.map((p) => new THREE.QuaternionKeyframeTrack(`${p.name}.quaternion`, times, p.sd > 0 ? vR : vL)),
      ),
    ];
  }

  ship.userData.debug = debug;
  const find = (n) => ship.getObjectByName(n);
  ship.userData.update = (t = 0) => {
    props.forEach((g, i) => (g.rotation.x = (PROPS[i].sd > 0 ? -1 : 1) * 2 * Math.PI * t));
  };
  ship.userData.pose = (k = 0) => {
    ['Turret_A', 'Turret_B', 'Turret_X', 'Turret_Y'].forEach((n, i) => (find(n).rotation.y = (i % 2 ? -1 : 1) * 0.8 * k));
    find('Rudder').rotation.y = 0.5 * k;
    find('Boat_Derrick').rotation.y = 0.9 * k;
  };
  return ship;
}
