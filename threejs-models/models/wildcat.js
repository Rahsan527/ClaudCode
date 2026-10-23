import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Grumman F4F-4 Wildcat — палубный истребитель ВМС США 1942–43 гг.
// Масштаб 1:1, метры. Y вверх, нос +X, правое (starboard) крыло +Z.
// Длина 8.76 м (кок винта — руль направления), размах 11.58 м, винт Curtiss Electric Ø 2.97 м.
// Поза: на палубе, шасси выпущено, крылья разложены, стоянка на трёх точках (фюзеляж поднят на 12°), фонарь закрыт.
// Окраска 1942–43: Blue Gray сверху, Light Gray снизу, звёзды без красного круга, без бортовых номеров.
// Сначала всё строится в «связанной» системе самолёта (строительная горизонталь по оси винта, y = 0),
// потом планер поворачивается на угол стоянки THETA вокруг точки касания основных колёс.
// Подвижные части — группы с нулевым поворотом в покое и началом на оси шарнира (наклон оси — в геометрии).

const ATLAS = 2048;
const THETA = (12 * Math.PI) / 180; // угол стоянки (хвост опущен)
const DIH = (5 * Math.PI) / 180; // поперечное V крыла
const WY0 = -0.25; // плоскость хорд крыла у корня
const PROP = { x: 4.12, r: 1.485 };
const MAIN = { x: 1.62, yc: -1.31, z: 1.12, r: 0.338 }; // ось основного колеса
const TW = { x: -3.45, r: 0.13 };
const C_GROUND = { x: MAIN.x, y: MAIN.yc - MAIN.r };
TW.yc = C_GROUND.y + (C_GROUND.x - TW.x) * Math.tan(THETA) + TW.r; // хвостовое колесо касается палубы
const AIL = { a0: 3.3, a1: 5.4, xh: 0.08 }; // элерон: размах |z|, ось шарнира x
const STAB = { y: 0.18, xh: -3.85, half: 2.08 };
const FIN = { xh: -3.85 };
const XF0 = -3.8; // хвостовой торец фюзеляжа (за ним руль направления)

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function tab(table, x) {
  const asc = table[0][0] < table[table.length - 1][0];
  const T = asc ? table : [...table].reverse();
  if (x <= T[0][0]) return T[0][1];
  if (x >= T[T.length - 1][0]) return T[T.length - 1][1];
  for (let i = 1; i < T.length; i++) {
    if (x <= T[i][0]) {
      const t = (x - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
      return lerp(T[i - 1][1], T[i][1], smooth(t) * 0.5 + t * 0.5);
    }
  }
  return T[T.length - 1][1];
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
  fan(ring, center, flip) {
    for (let j = 0; j < ring.length; j++) {
      const k = (j + 1) % ring.length;
      if (flip) this.tri(center, ring[k], ring[j]);
      else this.tri(center, ring[j], ring[k]);
    }
  }
  build({ orient = true, flip = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const P = this.pos;
    const keep = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < this.idx.length; i += 3) {
      const [i0, i1, i2] = [this.idx[i], this.idx[i + 1], this.idx[i + 2]];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      a.fromArray(P, i0 * 3);
      b.fromArray(P, i1 * 3);
      c.fromArray(P, i2 * 3);
      if (b.sub(a).cross(c.sub(a)).length() > 2e-8) keep.push(i0, i1, i2);
    }
    if ((orient && signedVolume(P, keep) < 0) || flip) {
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
// открытая оболочка: развернуть нормали «от точки» inside
function orientAway(m, inside) {
  let g = m.build({ orient: false });
  const p = g.attributes.position, n = g.attributes.normal;
  let s = 0;
  for (let i = 0; i < p.count; i++) s += (p.getX(i) - inside.x) * n.getX(i) + (p.getY(i) - inside.y) * n.getY(i) + (p.getZ(i) - inside.z) * n.getZ(i);
  if (s < 0) g = m.build({ orient: false, flip: true });
  return g;
}

// Тело вращения вокруг Y: профиль [[r, y, u, v], ...] сверху вниз; r = 0 — полюс. Нормали наружу (по объёму).
function latheUV(profile, seg = 24) {
  const m = new Mesher();
  const rings = profile.map(([r, y, u, v]) => {
    if (r === 0) return m.v(V3(0, y, 0), u, v);
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), u, v));
    }
    return ring;
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    if (typeof A === 'number' && typeof B === 'number') continue;
    if (typeof A === 'number') for (let j = 0; j < seg; j++) m.tri(A, B[j], B[j + 1]);
    else if (typeof B === 'number') for (let j = 0; j < seg; j++) m.tri(A[j], B, A[j + 1]);
    else m.strip(A, B);
  }
  return m.build();
}

// Стержень — замкнутый цилиндр
function rod(a, b, r, seg = 8, uv = [0.5, 0.5]) {
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return setUV(g, ...uv);
}
// Обтекаемая стойка: эллиптическое сечение, торцы закрыты
function strut(a, b, cw, th, uv, seg = 10) {
  const m = new Mesher();
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A).normalize();
  const e1 = V3(1, 0, 0).addScaledVector(d, -d.x);
  if (e1.length() < 1e-3) e1.set(0, 0, 1);
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
  const ring = (P) => {
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const f = (j / seg) * Math.PI * 2;
      ids.push(m.v(P.clone().addScaledVector(e1, (cw / 2) * Math.cos(f)).addScaledVector(e2, (th / 2) * Math.sin(f)), ...uv));
    }
    return ids;
  };
  const RA = ring(A), RB = ring(B);
  m.strip(RA, RB, true);
  m.fan(RA, m.v(A, ...uv), true);
  m.fan(RB, m.v(B, ...uv), false);
  return m.build();
}

function loftRings(rings, uvFn = () => [0.5, 0.5]) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, ...uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    const c = new THREE.Vector3();
    rings[k].forEach((p) => c.add(p));
    c.divideScalar(rings[k].length);
    m.fan(ids[k], m.v(c, ...uvFn(c)), k !== 0);
  });
  return m.build();
}

const naca = (t) => {
  const c = clamp01(t);
  return 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
};

function mirrorZ(g, uFlip = false) {
  const out = g.clone();
  out.scale(1, 1, -1);
  const idx = out.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  out.index.needsUpdate = true;
  if (uFlip) {
    const uv = out.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uFlip(uv.getX(i)));
  }
  out.computeVertexNormals();
  return out;
}
function clean(g) {
  const out = g.index ? g : mergeVertices(g);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => mergeVertices(mergeGeometries(list.map(clean)), 1e-5);
function setUV(g, u, v) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}

// ---------------------------------------------------------------------------
// ПРОФИЛЬНЫЕ ПОВЕРХНОСТИ (как в catalina.js): foilLoft — неподвижная часть до стенки xCut, ctrlLoft — руль за шарниром

function foilLoft(stations, { map, uv, xCut = null, N1 = 16, N2 = 5, caps = [true, true] }) {
  const m = new Mesher();
  const rings = [];
  for (const st of stations) {
    const { s, le, c, tc, cut } = st;
    let tcut = xCut !== null ? (le - xCut) / c : 0.75;
    if (!(tcut > 0.05 && tcut < 0.97)) tcut = 0.75;
    const hh = (t) => (t >= 0.999 ? 0 : Math.max(0.002, naca(t) * tc * c));
    const ts = [];
    for (let i = 0; i <= N1; i++) ts.push(tcut * (1 - Math.cos((Math.PI / 2) * (i / N1))));
    for (let i = 1; i <= N2; i++) ts.push(tcut + (1 - tcut) * (i / N2));
    const N = N1 + N2;
    const pt = (i, top) => {
      if (cut && i > N1) {
        const p = (i - N1) / N2;
        const h = (top ? 1 : -1) * hh(tcut) * (1 - p);
        return m.v(map(s, xCut, h), ...uv(s, Math.min(1, tcut + 0.004), top));
      }
      const t = ts[i];
      return m.v(map(s, le - t * c, (top ? 1 : -1) * hh(t)), ...uv(s, t, top));
    };
    const ring = [];
    for (let i = 0; i <= N; i++) ring.push(pt(i, true));
    for (let i = N; i >= 1; i--) ring.push(pt(i, false));
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    if (!caps[e]) return;
    const c = new THREE.Vector3();
    const P = m.pos;
    rings[k].forEach((i) => c.add(V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
    c.divideScalar(rings[k].length);
    const st = stations[k];
    m.fan(rings[k], m.v(c, ...uv(st.s, 0.3, true)), e === 1);
  });
  return m.build();
}

function ctrlLoft(stations, { map, uv, xh, M = 6 }) {
  const m = new Mesher();
  const rings = [];
  for (const st of stations) {
    const { s, le, c, tc } = st;
    const th = (le - xh) / c;
    const hh = (t) => (t >= 0.999 ? 0 : Math.max(0.002, naca(t) * tc * c));
    const H = hh(th);
    const ring = [];
    ring.push(m.v(map(s, xh + 0.02, 0), ...uv(s, th, true)));
    ring.push(m.v(map(s, xh + 0.013, 0.72 * H), ...uv(s, th, true)));
    for (let j = 0; j <= M; j++) {
      const t = th + ((1 - th) * j) / M;
      ring.push(m.v(map(s, le - t * c, hh(t)), ...uv(s, t, true)));
    }
    for (let j = M; j >= 0; j--) {
      const t = th + ((1 - th) * j) / M;
      ring.push(m.v(map(s, le - t * c, -hh(t)), ...uv(s, t, false)));
    }
    ring.push(m.v(map(s, xh + 0.013, -0.72 * H), ...uv(s, th, false)));
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    const c = new THREE.Vector3();
    const P = m.pos;
    rings[k].forEach((i) => c.add(V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
    c.divideScalar(rings[k].length);
    m.fan(rings[k], m.v(c, ...uv(stations[k].s, 0.9, true)), e === 1);
  });
  return m.build();
}

// ---------------------------------------------------------------------------
// ФЮЗЕЛЯЖ: «бочка» — суперэллипс с разной верхней и нижней половиной

// x, верх, низ, полуширина, уровень наибольшей ширины, показатель верха, показатель низа
const FUS = [
  [XF0, 0.36, -0.1, 0.075, 0.13, 2.0, 2.0],
  [-3.3, 0.5, -0.19, 0.19, 0.11, 2.0, 2.1],
  [-2.7, 0.68, -0.31, 0.29, 0.08, 1.9, 2.2],
  [-2.0, 0.85, -0.45, 0.39, 0.05, 1.85, 2.3],
  [-1.3, 0.96, -0.58, 0.47, 0.0, 1.85, 2.4],
  [-0.75, 0.98, -0.7, 0.535, -0.04, 1.95, 2.4],
  [-0.35, 0.86, -0.78, 0.57, -0.07, 2.2, 2.4],
  [0.45, 0.765, -0.86, 0.61, -0.1, 2.3, 2.4],
  [1.2, 0.745, -0.88, 0.64, -0.1, 2.3, 2.4],
  [2.0, 0.725, -0.86, 0.665, -0.08, 2.25, 2.35],
  [2.8, 0.71, -0.78, 0.69, -0.04, 2.15, 2.2],
  [3.6, 0.7, -0.71, 0.7, -0.01, 2.0, 2.0],
  [3.95, 0.67, -0.67, 0.67, 0.0, 2.0, 2.0],
];
const FCOL = (k) => FUS.map((r) => [r[0], r[k]]);
const FT = [1, 2, 3, 4, 5, 6].map(FCOL);
function sec(x) {
  return { top: tab(FT[0], x), bot: tab(FT[1], x), hw: tab(FT[2], x), ym: tab(FT[3], x), eT: tab(FT[4], x), eB: tab(FT[5], x) };
}
// точка сечения: phi = 0 — низ, π/2 — правый борт (+Z), π — верх
function secPt(c, phi) {
  const cc = -Math.cos(phi), ss = Math.sin(phi);
  const up = cc >= 0;
  const e = up ? c.eT : c.eB;
  const y = c.ym + (up ? c.top - c.ym : c.ym - c.bot) * Math.sign(cc) * Math.abs(cc) ** (2 / e);
  const z = c.hw * Math.sign(ss) * Math.abs(ss) ** (2 / e);
  return [y, z];
}
// полуширина фюзеляжа на высоте y
function fuseZ(x, y) {
  const c = sec(x);
  const up = y >= c.ym;
  const e = up ? c.eT : c.eB;
  const t = Math.abs((y - c.ym) / (up ? c.top - c.ym : c.ym - c.bot));
  if (t >= 1) return 0;
  return c.hw * (1 - t ** e) ** (1 / e);
}
// высота верхней (или нижней) поверхности над точкой (x, z)
function fuseY(x, z, upper = true) {
  const c = sec(x);
  const e = upper ? c.eT : c.eB;
  const q = Math.min(1, Math.abs(z) / c.hw);
  const f = (1 - q ** e) ** (1 / e);
  return upper ? c.ym + (c.top - c.ym) * f : c.ym - (c.ym - c.bot) * f;
}

const NF = 48;
function buildFuselage() {
  const m = new Mesher();
  const st = [];
  for (let x = XF0; x < 3.95 - 1e-6; x += 0.11) st.push({ x, c: sec(x) });
  st.push({ x: 3.95, c: sec(3.95) });
  // губа капота и внутренний канал
  const circ = (x, r) => ({ x, c: { top: r, bot: -r, hw: r, ym: 0, eT: 2, eB: 2 }, inner: r < 0.6 });
  st.push(circ(4.02, 0.648), circ(4.06, 0.62), circ(4.07, 0.59), circ(4.05, 0.565), circ(3.98, 0.552), circ(3.62, 0.556));
  let L = 0;
  const Ls = st.map((s, i) => {
    if (i > 0) L += Math.hypot(s.x - st[i - 1].x, s.c.hw - st[i - 1].c.hw);
    return L;
  });
  const rings = st.map((s, i) => {
    const u = 0.005 + (0.99 * Ls[i]) / L;
    const ring = [];
    for (let j = 0; j <= NF; j++) {
      const [y, z] = secPt(s.c, (j / NF) * Math.PI * 2);
      ring.push(m.v(V3(s.x, y, z), u, 0.505 + 0.49 * (j / NF)));
    }
    return ring;
  });
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
  // торцы: хвост и задняя стенка канала капота (за двигателем)
  const capRing = (k) => rings[k].slice(0, NF);
  const c0 = sec(XF0);
  m.fan(capRing(0), m.v(V3(XF0, (c0.top + c0.bot) / 2, 0), 0.003, 0.75), false);
  m.fan(capRing(rings.length - 1), m.v(V3(3.62, 0, 0), 0.997, 0.75), true);
  return m.build();
}

// ---------------------------------------------------------------------------
// КРЫЛО

const wy = (a) => WY0 + Math.max(0, Math.abs(a) - 0.5) * Math.tan(DIH);
function wingSt(a) {
  a = Math.abs(a);
  const f = clamp01((a - 0.5) / 5.29);
  let le = 1.95 - 0.87 * f, te = -0.55 + 0.35 * f;
  if (a > 5.47) {
    const s = clamp01((a - 5.47) / 0.32);
    const k = 1 - Math.sqrt(Math.max(0, 1 - s * s));
    le -= 0.3 * k;
    te += 0.22 * k;
  }
  return { le, c: le - te, tc: lerp(0.15, 0.095, f) };
}
const W_ROOT = 0.5;
const WU = (a) => 0.5 + (0.495 * a) / 5.8; // правое крыло; левое — 1 − u
const WV = (t, top) => 0.375 + (top ? 0.118 : -0.118) * clamp01(t);
const wingUV = (s, t, top) => [WU(s), WV(t, top)];
const wingMap = (s, x, h) => {
  const y = wy(s) + h;
  return V3(x, y, s <= W_ROOT + 1e-9 ? fuseZ(x, y) - 0.012 : s);
};
function buildWingR() {
  const A = [W_ROOT, 0.75, 1.1, 1.5, 1.75, 2.1, 2.45, 2.8, 3.05];
  const list = A.map((a) => ({ a, cut: false }));
  list.push({ a: AIL.a0, cut: false }, { a: AIL.a0, cut: true });
  [3.6, 3.9, 4.2, 4.5, 4.8, 5.1].forEach((a) => list.push({ a, cut: true }));
  list.push({ a: AIL.a1, cut: true }, { a: AIL.a1, cut: false });
  [5.47, 5.58, 5.67, 5.73, 5.77, 5.79].forEach((a) => list.push({ a, cut: false }));
  const st = list.map(({ a, cut }) => ({ s: a, cut, ...wingSt(a) }));
  return foilLoft(st, { map: wingMap, uv: wingUV, xCut: AIL.xh + 0.045, N1: 18, N2: 5, caps: [false, true] });
}
function buildAileronR() {
  const st = [];
  for (let i = 0; i <= 8; i++) {
    const a = lerp(AIL.a0 + 0.02, AIL.a1 - 0.02, i / 8);
    st.push({ s: a, ...wingSt(a) });
  }
  return ctrlLoft(st, { map: wingMap, uv: wingUV, xh: AIL.xh });
}

// ---------------------------------------------------------------------------
// ОПЕРЕНИЕ

function tailSt(a) {
  a = Math.abs(a);
  const f = Math.min(a, 1.75) / 1.75;
  let le = -2.95 - 0.22 * f, te = -4.3 + 0.08 * f;
  if (a > 1.75) {
    const s = clamp01((a - 1.75) / 0.33);
    const k = 1 - Math.sqrt(Math.max(0, 1 - s * s));
    le -= 0.42 * k;
    te += 0.28 * k;
  }
  return { le, c: le - te, tc: 0.1 };
}
const S_ROOT = 0.1;
const SU = (a) => 0.25 + (0.245 * a) / 2.1; // правая половина; левая — 0.5 − u
const SV = (t, top) => 0.125 + (top ? 0.118 : -0.118) * clamp01(t);
const stabUV = (s, t, top) => [SU(s), SV(t, top)];
const stabMap = (s, x, h) => {
  const y = STAB.y + h;
  return V3(x, y, s <= S_ROOT + 1e-9 ? Math.max(0.01, fuseZ(Math.max(x, XF0), y) - 0.01) : s);
};
function buildStabR() {
  const A = [S_ROOT, 0.2, 0.4, 0.7, 1.0, 1.3, 1.55, 1.75, 1.88, 1.97, 2.03, 2.065, STAB.half];
  const st = A.map((a) => ({ s: a, cut: true, ...tailSt(a) }));
  return foilLoft(st, { map: stabMap, uv: stabUV, xCut: STAB.xh + 0.045, N1: 12, N2: 4, caps: [false, true] });
}
function buildElevatorR() {
  const st = [];
  const A = [0.17, 0.4, 0.7, 1.0, 1.3, 1.55, 1.75, 1.88, 1.97, 2.03, 2.06];
  A.forEach((a) => st.push({ s: a, ...tailSt(a) }));
  return ctrlLoft(st, { map: stabMap, uv: stabUV, xh: STAB.xh, M: 5 });
}

function finLE(y) {
  if (y <= 0.95) {
    const q = clamp01((y - 0.7) / 0.25);
    return -3.25 + 0.65 * (1 - q) ** 2;
  }
  if (y <= 1.6) return -3.25 - (0.32 * (y - 0.95)) / 0.65;
  const s = clamp01((y - 1.6) / 0.2);
  return -3.57 - 0.26 * (1 - Math.sqrt(Math.max(0, 1 - s * s)));
}
const rudTE = (y) => tab([[-0.12, -4.05], [0.0, -4.22], [0.2, -4.33], [0.5, -4.37], [1.2, -4.36], [1.5, -4.3], [1.65, -4.2], [1.75, -4.08], [1.82, -3.93]], y);
const F_ROOT = 0.7;
const finMap = (s, x, h) => V3(x, s <= F_ROOT + 1e-9 ? fuseY(Math.max(x, XF0), h) - 0.012 : s, h);
const FNU = (x) => 0.505 + (0.24 * (x + 4.45)) / 2.0;
const FNV = (y) => 0.005 + (0.24 * (y + 0.2)) / 2.1;
function finUVfix(g) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, clamp01(FNU(p.getX(i))), clamp01(FNV(p.getY(i))));
  return g;
}
function buildFin() {
  const Y = [F_ROOT, 0.75, 0.82, 0.9, 1.0, 1.15, 1.3, 1.45, 1.6, 1.68, 1.73, 1.76];
  const st = Y.map((y) => {
    const le = finLE(y);
    return { s: y, cut: true, le, c: le - rudTE(y), tc: 0.12 };
  });
  return finUVfix(foilLoft(st, { map: finMap, uv: () => [0, 0], xCut: FIN.xh + 0.045, N1: 12, N2: 4, caps: [false, true] }));
}
function buildRudder() {
  const Y = [-0.1, 0.0, 0.15, 0.35, 0.6, 0.9, 1.2, 1.45, 1.6, 1.7, 1.77, 1.82];
  const st = Y.map((y) => {
    const le = y < 0.75 ? lerp(-3.0, finLE(0.75), clamp01(y / 0.75)) : finLE(Math.min(y, 1.72));
    return { s: y, le, c: le - rudTE(y), tc: 0.12 };
  });
  return finUVfix(ctrlLoft(st, { map: (s, x, h) => V3(x, s, h), uv: () => [0, 0], xh: FIN.xh, M: 6 }));
}

// ---------------------------------------------------------------------------
// ОСТЕКЛЕНИЕ: козырёк (неподвижный) и сдвижной фонарь. Нижние кромки уходят под обшивку.

function glassShell(xs, wFn, topFn, uFn, K = 16) {
  const m = new Mesher();
  const rings = xs.map((x, i) => {
    const w = wFn(x);
    const ys = fuseY(x, w) - 0.03;
    const yt = Math.max(ys + 0.02, topFn(x));
    const ids = [];
    for (let k = 0; k <= K; k++) {
      const f = (k / K) * Math.PI;
      const cf = Math.cos(f), sf = Math.sin(f);
      const e = 2 / 2.6;
      ids.push(m.v(V3(x, ys + (yt - ys) * Math.abs(sf) ** e, -w * Math.sign(cf) * Math.abs(cf) ** e), uFn(i / (xs.length - 1)), 0.02 + 0.96 * (k / K)));
    }
    return ids;
  });
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
  return orientAway(m, V3((xs[0] + xs.at(-1)) / 2, fuseY((xs[0] + xs.at(-1)) / 2, 0) - 0.3, 0));
}
const CANOPY = { x0: 0.46, x1: -0.82 };
function buildWindscreen() {
  const xs = [0.8, 0.74, 0.66, 0.58, 0.5, 0.44];
  return glassShell(xs, (x) => lerp(0.36, 0.3, (x - 0.44) / 0.36), (x) => lerp(1.045, fuseY(0.8, 0) + 0.025, ((x - 0.44) / 0.36) ** 0.9), (t) => 0.51 + 0.48 * t);
}
function buildCanopy() {
  const xs = [];
  for (let i = 0; i <= 12; i++) xs.push(lerp(CANOPY.x0, CANOPY.x1, i / 12));
  return glassShell(xs, (x) => (x > 0.3 ? lerp(0.375, 0.365, (x - 0.3) / 0.16) : 0.375 - 0.02 * clamp01((-0.5 - x) / 0.32)), (x) => tab([[0.46, 1.06], [0.3, 1.075], [-0.4, 1.075], [-0.82, 1.03]], x), (t) => 0.01 + 0.48 * t);
}

// ---------------------------------------------------------------------------
// ВИНТ Curtiss Electric: лопасть по радиусу +Y, ось вращения X

function bladeGeometry({ r0, r1, chord0, chord1, pitch, tc = 0.1, n = 10 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    let ch = lerp(chord0, chord1, Math.sin(Math.PI * Math.min(1, s * 1.4) * 0.5));
    if (k === n) ch *= 0.45;
    else if (k === n - 1) ch *= 0.82;
    const beta = Math.atan(pitch / (2 * Math.PI * Math.max(r, 0.3)));
    const d = V3(Math.sin(beta), 0, Math.cos(beta));
    const nn = V3(Math.cos(beta), 0, -Math.sin(beta));
    const ring = [];
    const M = 7;
    const pts = [];
    for (let j = 0; j <= M; j++) pts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const add = (t, sign) => {
      const c = (0.35 - t) * ch;
      const h = sign * Math.max(0.003, naca(t) * tc * ch * (1 - 0.6 * s));
      const p = d.clone().multiplyScalar(c).addScaledVector(nn, h);
      ring.push(V3(p.x, r, p.z));
    };
    for (const t of pts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(pts[j], -1);
    rings.push(ring);
  }
  return loftRings(rings, (p) => [0.25, clamp01(p.y / r1)]);
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ: атлас окраски рисуется «по поверхности» — каждый треугольник растеризуется в UV
// с интерполяцией точки в связанной системе, цвет и рельеф считаются по этой точке.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const COL = {
  blueGray: [92, 110, 128],
  lightGray: [188, 190, 186],
  insBlue: [28, 44, 104],
  insWhite: [236, 236, 232],
  interior: [70, 78, 58],
  well: [72, 76, 72],
  glass: [36, 50, 60],
  tyre: [30, 30, 31],
  hub: [150, 152, 150],
  strut: [178, 180, 176],
  dark: [44, 46, 47],
  walk: [70, 80, 90],
  red: [170, 40, 36],
  green: [40, 140, 70],
};
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const groove = (d, w = 0.006, pw = 0.005) => clamp01((w - Math.abs(d)) / pw + 0.5);
const nearest = (v, step, off = 0) => Math.abs(((v - off) / step - Math.round((v - off) / step)) * step);
// пятиконечная звезда (вершина вверх по оси dy), R — радиус описанной окружности
function inStar(dx, dy, R) {
  const rho = Math.hypot(dx, dy);
  if (rho > R) return false;
  let a = Math.atan2(dx, dy);
  const sec = (2 * Math.PI) / 5;
  a = ((a % sec) + sec) % sec;
  a = Math.abs(a - sec / 2);
  a = sec / 2 - a; // 0 — луч, 36° — впадина
  const ri = R * 0.382;
  const p1x = R, p1y = 0;
  const p2x = ri * Math.cos(Math.PI / 5), p2y = ri * Math.sin(Math.PI / 5);
  const qx = rho * Math.cos(a), qy = rho * Math.sin(a);
  const cr = (p2x - p1x) * (qy - p1y) - (p2y - p1y) * (qx - p1x);
  const co = (p2x - p1x) * (0 - p1y) - (p2y - p1y) * (0 - p1x);
  return cr * co >= 0;
}
function insignia(dx, dy, R) {
  if (Math.hypot(dx, dy) > R) return null;
  return inStar(dx, dy, R * 0.985) ? COL.insWhite : COL.insBlue;
}

// Швы и заклёпки: d — расстояние до линии (м); ряд заклёпок вдоль линии с шагом step
function rivetRow(d, along, off = 0.022, step = 0.045) {
  const dd = Math.abs(Math.abs(d) - off);
  const ds = nearest(along, step);
  const r = Math.hypot(dd, ds);
  return r < 0.006 ? 1 - r / 0.006 : 0;
}

function shadeFuselage(p) {
  const { x, y, z } = p;
  const az = Math.abs(z);
  const r = Math.hypot(y, z);
  if (x > 3.5 && r < 0.585) return [COL.dark, 0.5]; // канал капота за губой
  const yb = -0.22 + 0.035 * Math.sin(x * 2.3 + 0.6);
  let c = mix(COL.lightGray, COL.blueGray, smooth((y - yb) / 0.05 + 0.5));
  let h = 0.5;
  let ln = 0, rv = 0;
  // шпангоуты и стыки панелей
  const frames = [3.05, 2.8, 2.1, 1.35, 0.8, -0.82, -1.5, -2.2, -2.9, -3.45];
  for (const fx of frames) {
    ln = Math.max(ln, groove(x - fx));
    if (x < 2.8) rv = Math.max(rv, rivetRow(x - fx, Math.atan2(y, z) * 0.6));
  }
  // створки капота (юбка), кольцо передней части капота
  if (x > 2.8 && x < 3.05) ln = Math.max(ln, groove(nearest(Math.atan2(y, z) * r, 0.24)));
  ln = Math.max(ln, groove(x - 3.55));
  // продольные стыки: борт / гаргрот
  if (x < 2.8 && x > XF0 + 0.1) {
    ln = Math.max(ln, groove(y - (0.42 + 0.0 * x)) * (az > 0.2 ? 1 : 0));
    ln = Math.max(ln, groove(y + 0.42) * (az > 0.2 ? 0.8 : 0));
    rv = Math.max(rv, rivetRow(y - 0.42, x) * (az > 0.2 ? 1 : 0));
  }
  // лючки на борту
  const hatch = (x0, x1, y0, y1, side) => {
    if (side && Math.sign(z) !== side) return;
    if (x > x0 - 0.01 && x < x1 + 0.01 && y > y0 - 0.01 && y < y1 + 0.01)
      ln = Math.max(ln, groove(Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1))));
  };
  hatch(-2.75, -2.35, -0.05, 0.25, -1); // радиоотсек
  hatch(1.55, 2.0, 0.25, 0.5, 0); // маслобак
  hatch(-1.25, -1.0, -0.4, -0.2, 1);
  h -= 0.32 * ln;
  h += 0.12 * rv;
  c = mix(c, [50, 54, 58], 0.18 * ln);
  // ниши шасси в нижней части борта (колёса убираются в фюзеляж)
  if (az > 0.3) {
    const e = ((x - 1.48) / 0.42) ** 2 + ((y + 0.53) / 0.22) ** 2;
    if (e < 1) {
      c = mix(COL.well, [40, 42, 40], smooth((1 - e) / 0.6));
      h = 0.3 + 0.1 * (1 - e);
    } else if (e < 1.12) h = 0.62;
  }
  // кабина под фонарём (видна при сдвинутом фонаре)
  if (y > 0.6 && x < 0.44 && x > -0.76 && az < 0.3) {
    c = COL.interior;
    h = 0.42;
    if (x < -0.45 && x > -0.68 && az < 0.18) c = [52, 50, 46]; // бронеспинка
    if (az > 0.27 || x > 0.41 || x < -0.73) {
      c = COL.dark;
      h = 0.3;
    }
  }
  // окна за кабиной
  if (x > -1.32 && x < -0.92 && y > 0.6 && y < 0.82 && az > 0.25) {
    const frame = Math.min(x + 1.32, -0.92 - x, y - 0.6, 0.82 - y) < 0.02 || Math.abs(x + 1.12) < 0.012;
    c = frame ? COL.blueGray : COL.glass;
    h = frame ? 0.55 : 0.45;
  }
  // нагар выхлопа
  if (x < 2.65 && x > 0.9 && y < -0.2 && y > -0.66 && az > 0.35) {
    const f = smooth((x - 0.9) / 1.75) * smooth((y + 0.66) / 0.12) * smooth((-0.2 - y) / 0.15);
    c = mix(c, [62, 60, 58], 0.5 * f);
  }
  // опознавательная звезда на бортах
  if (az > 0.15) {
    const ins = insignia(x + 1.95, y - 0.16, 0.37);
    if (ins) c = ins;
  }
  return [c, h];
}

function shadeWing(p) {
  const { x, y, z } = p;
  const a = Math.abs(z);
  const w = wingSt(a);
  const t = (w.le - x) / w.c;
  const top = y >= wy(a);
  let c = top ? COL.blueGray : COL.lightGray;
  if (Math.abs(y - wy(a)) < 0.03 && t < 0.03) c = mix(COL.blueGray, COL.lightGray, 0.5);
  let h = 0.5;
  let ln = 0, rv = 0;
  // линия складывания крыла (Sto-Wing) — только шов
  ln = Math.max(ln, groove(a - (1.75 + 0.06 * t)) * 1.0);
  rv = Math.max(rv, rivetRow(a - (1.75 + 0.06 * t), x));
  // лонжероны, нервюры
  ln = Math.max(ln, groove((t - 0.14) * w.c) * 0.7, groove((t - 0.66) * w.c) * 0.7);
  rv = Math.max(rv, rivetRow((t - 0.14) * w.c, a), rivetRow((t - 0.66) * w.c, a) * 0.8);
  if (x < AIL.xh && a > AIL.a0 && a < AIL.a1) ln = Math.max(ln, groove(nearest(a, 0.19, 0.05), 0.008) * 0.55);
  else if (t < 0.66) ln = Math.max(ln, groove(nearest(a, 0.55, 0.2)) * 0.5);
  // закрылки (щитки снизу)
  if (!top && a > 0.55 && a < AIL.a0 - 0.05) {
    const xf = w.le - w.c + 0.34;
    if (x < xf + 0.01) ln = Math.max(ln, groove(x - xf), groove(a - 1.75), groove(a - (AIL.a0 - 0.05)));
  }
  // люки пулемётов и патронных ящиков сверху
  if (top && a > 2.25 && a < 3.25 && t > 0.03 && t < 0.62) {
    ln = Math.max(ln, groove(Math.min(Math.abs(a - 2.25), Math.abs(a - 3.25))), groove((t - 0.03) * w.c), groove((t - 0.62) * w.c));
    if (t > 0.33) ln = Math.max(ln, groove((t - 0.33) * w.c));
  }
  h -= 0.32 * ln;
  h += 0.12 * rv;
  c = mix(c, [48, 52, 56], 0.16 * ln);
  // нескользящая дорожка у корня сверху
  if (top && a < 1.2 && t > 0.2 && t < 0.72) c = mix(c, COL.walk, 0.7);
  // АНО на законцовках
  if (a > 5.72 && t < 0.2) c = z < 0 ? COL.red : COL.green;
  // звёзды: сверху на левом крыле, снизу на правом
  if ((top && z < 0) || (!top && z > 0)) {
    const ws = wingSt(4.4);
    const ins = insignia(a - 4.4, x - (ws.le - 0.47 * ws.c), 0.58);
    if (ins) c = ins;
  }
  return [c, h];
}

function shadeStab(p) {
  const { x, y, z } = p;
  const a = Math.abs(z);
  const top = y >= STAB.y;
  let c = top ? COL.blueGray : COL.lightGray;
  let ln = groove(x - STAB.xh - 0.02) * 0.5;
  if (x < STAB.xh) ln = Math.max(ln, groove(nearest(a, 0.17, 0.05), 0.008) * 0.55);
  else ln = Math.max(ln, groove(nearest(a, 0.5, 0.1)) * 0.5, groove(x + 3.1) * 0.5);
  c = mix(c, [48, 52, 56], 0.16 * ln);
  return [c, 0.5 - 0.3 * ln];
}
function shadeFin(p) {
  const { x, y } = p;
  let ln;
  if (x < FIN.xh) ln = groove(nearest(y, 0.2, 0.05), 0.008) * 0.55;
  else ln = Math.max(groove(nearest(y, 0.45, 0.1)) * 0.5, groove(x + 3.3) * 0.4);
  return [mix(COL.blueGray, [48, 52, 56], 0.16 * ln), 0.5 - 0.3 * ln];
}

// Плашки однотонных цветов (стойки, колёса, ниши) — в углу атласа u 0.75…1, v 0…0.25
const SW = {
  strut: [0.78, 0.03],
  tyre: [0.84, 0.03],
  hub: [0.9, 0.03],
  dark: [0.96, 0.03],
  blueGray: [0.78, 0.09],
  interior: [0.84, 0.09],
};
const SWC = { strut: COL.strut, tyre: COL.tyre, hub: COL.hub, dark: COL.dark, blueGray: COL.blueGray, interior: COL.interior };

function paintAtlas(items) {
  const S = ATLAS;
  const C = new Float32Array(S * S * 3);
  const Hm = new Float32Array(S * S).fill(0.5);
  const done = new Uint8Array(S * S);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grime = new Float32Array(64 * 64).map(() => rnd());
  const noise = (u, v) => {
    const x = (u % 1) * 63, y = (v % 1) * 63;
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const g = (a, b) => grime[Math.min(63, b) * 64 + Math.min(63, a)];
    return lerp(lerp(g(i, j), g(i + 1, j), fx), lerp(g(i, j + 1), g(i + 1, j + 1), fx), fy);
  };
  const put = (o, c, h) => {
    C[o * 3] = c[0];
    C[o * 3 + 1] = c[1];
    C[o * 3 + 2] = c[2];
    Hm[o] = h;
    done[o] = 1;
  };
  for (const { geo, shade } of items) {
    const P = geo.attributes.position, U = geo.attributes.uv;
    const idx = geo.index.array;
    const p = new THREE.Vector3();
    for (let f = 0; f < idx.length; f += 3) {
      const ids = [idx[f], idx[f + 1], idx[f + 2]];
      const px = ids.map((i) => U.getX(i) * S), py = ids.map((i) => (1 - U.getY(i)) * S);
      const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
      if (Math.abs(area) < 0.3) continue;
      const el = [0, 1, 2].map((k) => Math.hypot(px[(k + 2) % 3] - px[(k + 1) % 3], py[(k + 2) % 3] - py[(k + 1) % 3]));
      const tol = el.map((l) => (0.9 * l) / Math.abs(area));
      const x0 = Math.max(0, Math.floor(Math.min(...px) - 1)), x1 = Math.min(S - 1, Math.ceil(Math.max(...px) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(...py) - 1)), y1 = Math.min(S - 1, Math.ceil(Math.max(...py) + 1));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const cx = xx + 0.5, cy = yy + 0.5;
          let w0 = ((px[1] - cx) * (py[2] - cy) - (px[2] - cx) * (py[1] - cy)) / area;
          let w1 = ((px[2] - cx) * (py[0] - cy) - (px[0] - cx) * (py[2] - cy)) / area;
          let w2 = 1 - w0 - w1;
          const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
          if (!inside && (w0 < -tol[0] || w1 < -tol[1] || w2 < -tol[2])) continue;
          const o = yy * S + xx;
          if (!inside && done[o]) continue;
          w0 = Math.max(0, w0);
          w1 = Math.max(0, w1);
          w2 = Math.max(0, w2);
          const sw = w0 + w1 + w2;
          p.set(0, 0, 0);
          [w0, w1, w2].forEach((w, k) => {
            p.x += (w / sw) * P.getX(ids[k]);
            p.y += (w / sw) * P.getY(ids[k]);
            p.z += (w / sw) * P.getZ(ids[k]);
          });
          const [c, h] = shade(p);
          const k = 0.95 + 0.07 * noise(cx / S * 3, cy / S * 3);
          put(o, [c[0] * k, c[1] * k, c[2] * k], h);
          if (!inside) done[o] = 2;
        }
      }
    }
  }
  // плашки
  for (const [name, [u, v]] of Object.entries(SW)) {
    const c = SWC[name];
    for (let yy = Math.round((1 - v - 0.025) * S); yy < Math.round((1 - v + 0.025) * S); yy++)
      for (let xx = Math.round((u - 0.025) * S); xx < Math.round((u + 0.025) * S); xx++) put(yy * S + xx, c, 0.5);
  }
  // расширение краёв островов (чтобы мипмапы не тянули фон)
  for (let pass = 0; pass < 6; pass++) {
    const add = [];
    for (let yy = 0; yy < S; yy++) {
      for (let xx = 0; xx < S; xx++) {
        const o = yy * S + xx;
        if (done[o]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = xx + dx, Y = yy + dy;
          if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
          const q = Y * S + X;
          if (done[q]) {
            add.push(o, q);
            break;
          }
        }
      }
    }
    for (let i = 0; i < add.length; i += 2) {
      const o = add[i], q = add[i + 1];
      C[o * 3] = C[q * 3];
      C[o * 3 + 1] = C[q * 3 + 1];
      C[o * 3 + 2] = C[q * 3 + 2];
      Hm[o] = Hm[q];
      done[o] = 3;
    }
  }
  const col = makeCanvas(S, S);
  const cx = col.getContext('2d');
  const img = cx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const filled = done[i];
    img.data[i * 4] = filled ? C[i * 3] : COL.lightGray[0];
    img.data[i * 4 + 1] = filled ? C[i * 3 + 1] : COL.lightGray[1];
    img.data[i * 4 + 2] = filled ? C[i * 3 + 2] : COL.lightGray[2];
    img.data[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const nrm = makeCanvas(S, S);
  const nx = nrm.getContext('2d');
  const out = nx.createImageData(S, S);
  const k = 2.4;
  const at = (xx, yy) => Hm[Math.min(S - 1, Math.max(0, yy)) * S + Math.min(S - 1, Math.max(0, xx))];
  for (let yy = 0; yy < S; yy++) {
    for (let xx = 0; xx < S; xx++) {
      const dx = (at(xx + 1, yy) - at(xx - 1, yy)) * k;
      const dy = (at(xx, yy + 1) - at(xx, yy - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (yy * S + xx) * 4;
      out.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      out.data[o + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
      out.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      out.data[o + 3] = 255;
    }
  }
  nx.putImageData(out, 0, 0);
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.anisotropy = 8;
  map.name = 'Airframe_Atlas_Color';
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = 'Airframe_Atlas_Normal';
  return { map, normalMap };
}

// Остекление: тонированное стекло с переплётами (левая половина — фонарь, правая — козырёк)
function paintGlass() {
  const S = 512;
  const c = makeCanvas(S, S);
  const C = c.getContext('2d');
  const g = C.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#34485a');
  g.addColorStop(0.5, '#1f2d38');
  g.addColorStop(1, '#3a5062');
  C.fillStyle = g;
  C.fillRect(0, 0, S, S);
  C.fillStyle = 'rgb(92,110,128)';
  const vbar = (u, w = 10) => C.fillRect(u * S - w / 2, 0, w, S);
  const hbar = (v, u0, u1, w = 10) => C.fillRect(u0 * S, (1 - v) * S - w / 2, (u1 - u0) * S, w);
  // фонарь: дуги переплёта и продольные рамы
  [0.01, 0.17, 0.33, 0.49].forEach((u) => vbar(u, u === 0.01 || u === 0.49 ? 14 : 9));
  [0.02, 0.98].forEach((v) => hbar(v, 0, 0.5, 18));
  [0.3, 0.7].forEach((v) => hbar(v, 0, 0.5, 8));
  // козырёк: плоское бронестекло посередине, боковые стёкла
  [0.51, 0.99].forEach((u) => vbar(u, 14));
  [0.02, 0.98].forEach((v) => hbar(v, 0.5, 1, 18));
  [0.36, 0.64].forEach((v) => hbar(v, 0.5, 1, 10));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = 'image/jpeg';
  t.name = 'Glazing_Frames';
  return t;
}
// Винт: чёрные лопасти с жёлтыми концами, кок и втулка — серые
function paintProp() {
  const S = 256;
  const c = makeCanvas(S, S);
  const C = c.getContext('2d');
  C.fillStyle = '#18191b';
  C.fillRect(0, 0, S / 2, S);
  C.fillStyle = '#d9b234';
  C.fillRect(0, 0, S / 2, S * 0.07);
  C.fillStyle = '#7d8a96';
  C.fillRect(S / 2, 0, S / 2, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = 'image/jpeg';
  t.name = 'Propeller_Paint_Color';
  return t;
}

// ---------------------------------------------------------------------------
// ШАССИ И МЕЛОЧИ

function wheelGeo(R, W, hubR, uvT, uvH, seg = 28) {
  // профиль тела вращения вокруг Y (ось колеса), сверху вниз
  const P = [
    [0, W * 0.62, ...uvH],
    [hubR * 0.55, W * 0.62, ...uvH],
    [hubR, W * 0.72, ...uvH],
    [hubR * 1.25, W * 0.85, ...uvH],
    [hubR * 1.25, W * 0.85, ...uvT],
    [R * 0.72, W, ...uvT],
    [R * 0.88, W * 0.92, ...uvT],
    [R * 0.97, W * 0.62, ...uvT],
    [R, W * 0.22, ...uvT],
    [R, -W * 0.22, ...uvT],
    [R * 0.97, -W * 0.62, ...uvT],
    [R * 0.88, -W * 0.92, ...uvT],
    [R * 0.72, -W, ...uvT],
    [hubR * 1.25, -W * 0.85, ...uvT],
    [hubR * 1.25, -W * 0.85, ...uvH],
    [hubR, -W * 0.72, ...uvH],
    [hubR * 0.55, -W * 0.62, ...uvH],
    [0, -W * 0.62, ...uvH],
  ];
  return latheUV(P, seg).rotateX(Math.PI / 2); // ось колеса — Z
}

function buildGear() {
  const parts = [];
  const sU = SW.strut;
  [1, -1].forEach((sd) => {
    const wz = sd * MAIN.z;
    parts.push(wheelGeo(MAIN.r, 0.085, 0.13, SW.tyre, SW.hub).translate(MAIN.x, MAIN.yc, wz));
    // основная стойка (амортизатор) из ниши в борту к оси колеса
    const top = [1.52, -0.62, sd * (fuseZ(1.52, -0.62) - 0.02)];
    const axle = [MAIN.x, MAIN.yc + 0.02, sd * (MAIN.z - 0.055)];
    parts.push(rod(top, axle, 0.048, 10, sU));
    parts.push(rod([1.6, -0.95, sd * 0.68], [1.6, -0.95 - 0.2, sd * 0.81], 0.062, 10, sU)); // гильза амортизатора
    // подкосы
    const mid = top.map((v, j) => lerp(v, axle[j], 0.55));
    parts.push(rod([1.05, -0.66, sd * (fuseZ(1.05, -0.66) - 0.02)], mid, 0.026, 8, sU));
    parts.push(rod([2.05, -0.6, sd * (fuseZ(2.05, -0.6) - 0.02)], mid, 0.024, 8, sU));
    // ось колеса
    parts.push(rod([MAIN.x, MAIN.yc, sd * (MAIN.z - 0.08)], [MAIN.x, MAIN.yc, sd * (MAIN.z - 0.04)], 0.045, 10, SW.hub));
  });
  // хвостовое колесо с вилкой
  const twY = TW.yc;
  parts.push(wheelGeo(TW.r, 0.04, 0.05, SW.tyre, SW.hub, 18).translate(TW.x, twY, 0));
  const crown = [TW.x + 0.06, twY + 0.17, 0];
  parts.push(rod([-3.28, fuseY(-3.28, 0, false) + 0.03, 0], crown, 0.028, 8, sU));
  [1, -1].forEach((sd) => parts.push(rod([crown[0], crown[1], sd * 0.052], [TW.x, twY, sd * 0.052], 0.014, 6, sU)));
  parts.push(rod([crown[0], crown[1], -0.065], [crown[0], crown[1], 0.065], 0.02, 6, sU));
  parts.push(rod([TW.x, twY, -0.066], [TW.x, twY, 0.066], 0.012, 6, SW.hub));
  return merge(parts);
}

// Двигатель R-1830 (передний ряд цилиндров, картер редуктора) в канале капота
function buildEngine() {
  const parts = [];
  const nose = latheUV([[0, 0.36, 0.5, 0.5], [0.12, 0.34, 0.5, 0.5], [0.2, 0.25, 0.5, 0.5], [0.3, 0.12, 0.5, 0.5], [0.33, 0.02, 0.5, 0.5], [0.33, -0.04, 0.5, 0.5], [0, -0.04, 0.5, 0.5]], 24);
  parts.push(nose.rotateZ(-Math.PI / 2).translate(3.6, 0, 0));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    parts.push(rod([3.72, 0.26 * ca, 0.26 * sa], [3.72, 0.53 * ca, 0.53 * sa], 0.075, 10));
    // задний ряд — между цилиндрами переднего
    const b = a + Math.PI / 7;
    parts.push(rod([3.64, 0.3 * Math.cos(b), 0.3 * Math.sin(b)], [3.64, 0.535 * Math.cos(b), 0.535 * Math.sin(b)], 0.07, 8));
  }
  // вал
  parts.push(rod([3.9, 0, 0], [4.02, 0, 0], 0.07, 12));
  return merge(parts);
}

function buildGuns() {
  const parts = [];
  [[2.45, 0.32], [2.75, 0.26], [3.05, 0.2]].forEach(([a, len]) => {
    const w = wingSt(a);
    const y = wy(a) - 0.01;
    const x0 = w.le - 0.06;
    [1, -1].forEach((sd) => {
      const z = sd * a;
      parts.push(rod([x0, y, z], [w.le + 0.07, y, z], 0.034, 10)); // кожух у кромки
      parts.push(rod([x0, y, z], [w.le + len, y, z], 0.019, 8)); // ствол
    });
  });
  return merge(parts);
}

function buildFittings() {
  const parts = [];
  // выхлопные патрубки за капотом
  [1, -1].forEach((sd) => {
    [[-0.4, 0.56], [-0.52, 0.48]].forEach(([y, zz]) => {
      const z0 = sd * (fuseZ(2.85, y) - 0.03);
      parts.push(rod([2.9, y, z0], [2.6, y - 0.03, sd * (Math.abs(z0) + 0.06)], 0.038, 8));
    });
  });
  // телескопический прицел сквозь козырёк
  const ys = 0.93;
  parts.push(rod([0.98, ys, 0], [0.22, ys, 0], 0.032, 10));
  parts.push(rod([0.94, fuseY(0.94, 0) - 0.02, 0], [0.94, ys - 0.02, 0], 0.014, 6));
  // посадочный гак (убран) под хвостом
  const hb = (x) => fuseY(x, 0, false);
  parts.push(rod([-2.85, hb(-2.85) + 0.012, 0], [-3.72, hb(-3.72) - 0.01, 0], 0.022, 8));
  parts.push(rod([-3.72, hb(-3.72) - 0.01, 0], [-3.78, hb(-3.72) - 0.07, 0], 0.024, 8));
  // антенна: мачта на гаргроте и провод к килю
  const mx = -1.55;
  const myb = fuseY(mx, 0) - 0.03;
  const tip = [mx + 0.14, myb + 0.46, 0];
  parts.push(strut([mx, myb, 0], tip, 0.07, 0.018, [0.5, 0.5], 8));
  parts.push(rod(tip, [-3.62, 1.7, 0], 0.005, 5));
  // приёмник ПВД под правым крылом
  const pw = wingSt(4.95);
  parts.push(rod([pw.le - 0.25, wy(4.95) - 0.05, 4.95], [pw.le + 0.32, wy(4.95) - 0.05, 4.95], 0.012, 6));
  parts.push(strut([pw.le - 0.15, wy(4.95) - 0.02, 4.95], [pw.le - 0.1, wy(4.95) - 0.06, 4.95], 0.08, 0.015, [0.5, 0.5], 6));
  return merge(parts);
}

// ---------------------------------------------------------------------------

export function createWildcat() {
  const root = new THREE.Group();
  root.name = 'Fighter_Wildcat';
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };

  // --- геометрия в связанной системе
  const fus = buildFuselage();
  const wingR = buildWingR();
  const wingL = mirrorZ(wingR, (u) => 1 - u);
  const ailR = buildAileronR();
  const ailL = mirrorZ(ailR, (u) => 1 - u);
  const stabR = buildStabR();
  const stabL = mirrorZ(stabR, (u) => 0.5 - u + 0.0);
  const elR = buildElevatorR();
  const elL = mirrorZ(elR, (u) => 0.5 - u + 0.0);
  const fin = buildFin();
  const rud = buildRudder();
  // левая половина стабилизатора: u = 0.5 − u (правая 0.25…0.495 → левая 0.005…0.25)

  const { map, normalMap } = paintAtlas([
    { geo: fus, shade: shadeFuselage },
    { geo: wingR, shade: shadeWing },
    { geo: wingL, shade: shadeWing },
    { geo: ailR, shade: shadeWing },
    { geo: ailL, shade: shadeWing },
    { geo: stabR, shade: shadeStab },
    { geo: stabL, shade: shadeStab },
    { geo: elR, shade: shadeStab },
    { geo: elL, shade: shadeStab },
    { geo: fin, shade: shadeFin },
    { geo: rud, shade: shadeFin },
  ]);
  const M = {
    paint: std('Airframe_Paint', 0xffffff, 0.66, 0.1, { map, normalMap }),
    glass: std('Glazing_Tinted', 0xffffff, 0.1, 0.25, { map: paintGlass() }),
    prop: std('Propeller_Paint', 0xffffff, 0.5, 0.3, { map: paintProp() }),
    metal: std('Metal_Dark', 0x2c2e30, 0.55, 0.65),
  };

  // --- стоянка на трёх точках: поворот на THETA вокруг точки касания основных колёс
  const R = new THREE.Matrix4().makeRotationZ(THETA);
  const c0 = V3(C_GROUND.x, C_GROUND.y, 0).applyMatrix4(R);
  const Mw = new THREE.Matrix4().makeTranslation(-c0.x, -c0.y, -c0.z).multiply(R);
  const toWorld = (g) => g.applyMatrix4(Mw);
  const ptWorld = (p) => V3(...p).applyMatrix4(Mw);
  const dirWorld = (d) => V3(...d).applyMatrix4(R).normalize();

  const group = (name, parent, pos = V3(0, 0, 0)) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.copy(pos);
    parent.add(g);
    return g;
  };
  const mesh = (geo, mat, name, parent) => {
    const mm = new THREE.Mesh(geo, mat);
    mm.name = name;
    geo.name = name;
    parent.add(mm);
    return mm;
  };
  // подвижная часть: начало — на оси (точка hinge в связанной системе), геометрия в местных координатах
  const movable = (name, parent, hinge, geo, mat, meshName) => {
    const g = group(name, parent, ptWorld(hinge));
    geo.translate(-hinge[0], -hinge[1], -hinge[2]).applyMatrix4(R);
    mesh(geo, mat, meshName, g);
    return g;
  };

  // ======================= ПЛАНЕР
  const air = group('Airframe', root);
  mesh(toWorld(fus), M.paint, 'Fuselage', air);
  mesh(toWorld(wingR), M.paint, 'Wing_R', air);
  mesh(toWorld(wingL), M.paint, 'Wing_L', air);
  mesh(toWorld(merge([fin, stabR, stabL])), M.paint, 'Tail_Fixed', air);
  mesh(toWorld(buildGear()), M.paint, 'Landing_Gear', air);
  mesh(toWorld(buildWindscreen()), M.glass, 'Windscreen', air);
  mesh(toWorld(buildEngine()), M.metal, 'Engine_Front', air);
  mesh(toWorld(buildGuns()), M.metal, 'Wing_Guns', air);
  mesh(toWorld(buildFittings()), M.metal, 'Fittings_Metal', air);

  // ======================= РУЛИ
  const ctl = group('Control_Surfaces', root);
  const za = (AIL.a0 + AIL.a1) / 2;
  const axes = {};
  movable('Aileron_R', ctl, [AIL.xh, wy(za), za], ailR, M.paint, 'Aileron_R_Surface');
  movable('Aileron_L', ctl, [AIL.xh, wy(za), -za], ailL, M.paint, 'Aileron_L_Surface');
  axes.Aileron_R = dirWorld([0, Math.sin(DIH), Math.cos(DIH)]);
  axes.Aileron_L = dirWorld([0, Math.sin(DIH), -Math.cos(DIH)]);
  const ze = 1.1;
  movable('Elevator_R', ctl, [STAB.xh, STAB.y, ze], elR, M.paint, 'Elevator_R_Surface');
  movable('Elevator_L', ctl, [STAB.xh, STAB.y, -ze], elL, M.paint, 'Elevator_L_Surface');
  axes.Elevator_R = V3(0, 0, 1);
  axes.Elevator_L = V3(0, 0, 1);
  movable('Rudder', ctl, [FIN.xh, 0.8, 0], rud, M.paint, 'Rudder_Surface');
  axes.Rudder = dirWorld([0, 1, 0]);

  // ======================= ФОНАРЬ (сдвигается назад вдоль оси фюзеляжа)
  const canopy = movable('Canopy_Slide', root, [CANOPY.x0, fuseY(CANOPY.x0, 0), 0], buildCanopy(), M.glass, 'Canopy_Glass');
  const slideDir = dirWorld([-1, 0, 0]);
  const canopy0 = canopy.position.clone();

  // ======================= ВИНТ (ось вала — наклонена вместе с фюзеляжем)
  {
    const blade = bladeGeometry({ r0: 0.16, r1: PROP.r, chord0: 0.2, chord1: 0.27, pitch: 3.2, tc: 0.11 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const spinner = latheUV([[0, 0.27, 0.75, 0.5], [0.1, 0.24, 0.75, 0.5], [0.17, 0.16, 0.75, 0.5], [0.21, 0.06, 0.75, 0.5], [0.22, -0.04, 0.75, 0.5], [0.21, -0.12, 0.75, 0.5], [0, -0.12, 0.75, 0.5]], 24).rotateZ(-Math.PI / 2);
    const g = merge([...bl, spinner]);
    g.translate(PROP.x, 0, 0);
    movable('Propeller', root, [PROP.x, 0, 0], g, M.prop, 'Propeller_Blades');
  }
  const propAxis = dirWorld([1, 0, 0]);

  // Анимация: винт вращается по часовой стрелке (вид сзади), 1 оборот за 0.25 с
  {
    const T = 0.25;
    const n = 8;
    const times = [];
    const vals = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i <= n; i++) {
      times.push((T * i) / n);
      q.setFromAxisAngle(propAxis, (2 * Math.PI * i) / n);
      vals.push(q.x, q.y, q.z, q.w);
    }
    root.animations = [new THREE.AnimationClip('Propeller_Spin', T, [new THREE.QuaternionKeyframeTrack('Propeller.quaternion', times, vals)])];
  }

  const find = (n) => root.getObjectByName(n);
  root.userData.axes = { ...axes, Propeller: propAxis, Canopy_Slide: slideDir };
  root.userData.update = (t = 0) => {
    find('Propeller').quaternion.setFromAxisAngle(propAxis, 8 * Math.PI * t);
  };
  // тестовая поза: рули отклонены, фонарь сдвинут назад
  root.userData.pose = (k = 0) => {
    const rot = (n, ang) => find(n).quaternion.setFromAxisAngle(axes[n], ang * k);
    rot('Aileron_R', 0.4);
    rot('Aileron_L', 0.4);
    rot('Elevator_R', 0.4);
    rot('Elevator_L', 0.4);
    rot('Rudder', 0.4);
    canopy.position.copy(canopy0).addScaledVector(slideDir, 0.55 * k);
  };
  return root;
}
