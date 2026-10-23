import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Grumman TBF-1C Avenger — палубный торпедоносец ВМС США, 1943–44. Стоянка на палубе:
// шасси выпущено, крылья раскрыты, хвостовое колесо на палубе (трёхточечная стойка), фонарь закрыт.
// Масштаб 1:1, метры. Y вверх, нос +X, правое крыло +Z. Длина 12.48 м, размах 16.51 м,
// высота ~5.0 м (до конца лопасти, поднятой вертикально; 16 ft 4¼ in).
// Геометрия строится в связанной системе (строительная горизонталь фюзеляжа = ось винта, y = 0),
// затем весь самолёт поворачивается на угол стоянки PITCH (нос вверх) — поворот запекается в сетку.
// Окраска 1943 г.: Sea Blue сверху, Intermediate Blue на бортах и киле, Insignia White снизу;
// звёзды с полосами (синяя окантовка) — в текстуре; без бортовых и серийных номеров.

const ATLAS = 2048;
const PITCH = THREE.MathUtils.degToRad(11);
const PROP = { x: 5.92, r: 2.0 };
const BAY = { x0: 2.25, x1: -1.85, zh: 0.5, d: 0.08 };
const XF0 = -5.4, XF1 = 5.86; // диапазон X фюзеляжа в атласе
const MG = { x: 1.9, y: -1.87, zw: 1.83, zl: 2.06, r: 0.43 }; // основные колёса (ось)
const TW = { x: -4.5, r: 0.19 }; // хвостовое колесо

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
  // торец тонкого кольца [o0..oM, iM..i0] полосой четырёхугольников
  stripCap(ring, flip) {
    const n = ring.length, M = n / 2 - 1;
    for (let j = 0; j < M; j++) {
      const o0 = ring[j], o1 = ring[j + 1], i1 = ring[n - 2 - j], i0 = ring[n - 1 - j];
      if (flip) this.quad(o0, i0, i1, o1);
      else this.quad(o0, o1, i1, i0);
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

// Тело вращения вокруг Y по профилю [[r, y], ...] (r = 0 — полюс). Нормали наружу (ориентация по объёму).
function lathe(profile, seg = 20, { bottom = false, uvFn = null } = {}) {
  const m = new Mesher();
  const n = profile.length;
  const rings = [];
  const UV = (j, k) => (uvFn ? uvFn(j / seg, k) : [j / seg, k / (n - 1)]);
  for (let k = 0; k < n; k++) {
    const [r, y] = profile[k];
    if (r === 0) {
      rings.push(m.v(V3(0, y, 0), ...UV(seg / 2, k)));
      continue;
    }
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), ...UV(j, k)));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    if (typeof A === 'number') for (let j = 0; j < seg; j++) m.tri(A, B[j], B[j + 1]);
    else if (typeof B === 'number') for (let j = 0; j < seg; j++) m.tri(A[j], B, A[j + 1]);
    else m.strip(A, B);
  }
  const capAt = (k) => {
    const [r, y] = profile[k];
    if (r === 0) return;
    const c = m.v(V3(0, y, 0), ...UV(0, k));
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ids.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), ...UV(j, k)));
    }
    for (let j = 0; j < seg; j++) m.tri(c, ids[j], ids[(j + 1) % seg]);
  };
  capAt(n - 1);
  if (bottom) capAt(0);
  return m.build();
}
const latheX = (profile, seg, opt) => lathe(profile, seg, opt).rotateZ(-Math.PI / 2);

// Тело вращения замкнутого контура (шина): [[r, y], ...] — петля
function latheLoop(loop, seg = 28) {
  const m = new Mesher();
  const rings = loop.map(([r, y], k) => {
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(V3(r * Math.cos(a), y, -r * Math.sin(a)), j / seg, k / loop.length));
    }
    return ring;
  });
  for (let k = 0; k < rings.length; k++) m.strip(rings[k], rings[(k + 1) % rings.length]);
  return m.build();
}

function rod(a, b, r, seg = 8) {
  const A = V3(...a), B = V3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
function box(cx, cy, cz, sx, sy, sz) {
  return new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
}

function loftRings(rings, uvFn = () => [0.5, 0.5], { caps = [true, true] } = {}) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, ...uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    if (!caps[e]) return;
    const c = new THREE.Vector3();
    rings[k].forEach((p) => c.add(p));
    c.divideScalar(rings[k].length);
    m.fan(ids[k], m.v(c, ...uvFn(c)), k !== 0);
  });
  return m.build();
}

// Тонкостенное тело: сечения [{pts:[{p,uv}...]}] — замкнутые тонкие кольца, торцы полосой
function thinLoft(rings) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map(({ p, uv }) => m.v(p, ...uv)));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
  m.stripCap(ids[0], false);
  m.stripCap(ids[ids.length - 1], true);
  return m.build();
}

const naca = (t) => {
  const c = clamp01(t);
  return 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
};

function clean(g) {
  const out = g.index ? g : mergeVertices(g);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => mergeVertices(mergeGeometries(list.map(clean)), 1e-5);
const setUV = (g, u, v) => {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
};

// ---------------------------------------------------------------------------
// ПРОФИЛЬНЫЕ ПОВЕРХНОСТИ

// stations: [{s, le, c, tc, cut, xc}] — xc: задняя стенка (перед рулём); map(s, x, h) → точка; uv(s, x, top)
function foilLoft(stations, { map, uv, N1 = 16, N2 = 5, caps = [true, true] }) {
  const m = new Mesher();
  const rings = [];
  for (const st of stations) {
    const { s, le, c, tc, cut, xc } = st;
    let tcut = (le - xc) / c;
    if (!(tcut > 0.05 && tcut < 0.97)) tcut = 0.75;
    const hh = (t) => (t >= 0.999 ? 0 : Math.max(0.002, naca(t) * tc * c));
    const ts = [];
    for (let i = 0; i <= N1; i++) ts.push(tcut * (1 - Math.cos((Math.PI / 2) * (i / N1))));
    for (let i = 1; i <= N2; i++) ts.push(tcut + (1 - tcut) * (i / N2));
    const N = N1 + N2;
    const pt = (i, top) => {
      const sg = top ? 1 : -1;
      if (cut && i > N1) {
        const p = (i - N1) / N2;
        const x = le - tcut * c;
        return m.v(map(s, x, sg * hh(tcut) * (1 - p)), ...uv(s, x, top));
      }
      const x = le - ts[i] * c;
      return m.v(map(s, x, sg * hh(ts[i])), ...uv(s, x, top));
    };
    const ring = [];
    for (let i = 0; i <= N; i++) ring.push(pt(i, true));
    for (let i = N; i >= 0; i--) ring.push(pt(i, false));
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
    m.fan(rings[k], m.v(c, ...uv(st.s, st.le - 0.3 * st.c, true)), e === 1);
  });
  return m.build();
}

// Руль за осью шарнира st.xh: закруглённый носок + задняя часть профиля
function ctrlLoft(stations, { map, uv, M = 6 }) {
  const m = new Mesher();
  const rings = [];
  for (const st of stations) {
    const { s, le, c, tc, xh } = st;
    const th = (le - xh) / c;
    const hh = (t) => (t >= 0.999 ? 0 : Math.max(0.002, naca(t) * tc * c));
    const H = hh(th);
    const ring = [];
    ring.push(m.v(map(s, xh + 0.02, 0), ...uv(s, xh, true)));
    ring.push(m.v(map(s, xh + 0.013, 0.72 * H), ...uv(s, xh, true)));
    for (let j = 0; j <= M; j++) {
      const x = le - (th + ((1 - th) * j) / M) * c;
      ring.push(m.v(map(s, x, hh(th + ((1 - th) * j) / M)), ...uv(s, x, true)));
    }
    for (let j = M; j >= 0; j--) {
      const x = le - (th + ((1 - th) * j) / M) * c;
      ring.push(m.v(map(s, x, -hh(th + ((1 - th) * j) / M)), ...uv(s, x, false)));
    }
    ring.push(m.v(map(s, xh + 0.013, -0.72 * H), ...uv(s, xh, false)));
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1], true);
  [0, rings.length - 1].forEach((k, e) => {
    const c = new THREE.Vector3();
    const P = m.pos;
    rings[k].forEach((i) => c.add(V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
    c.divideScalar(rings[k].length);
    m.fan(rings[k], m.v(c, ...uv(stations[k].s, stations[k].xh - 0.1, true)), e === 1);
  });
  return m.build();
}

// ---------------------------------------------------------------------------
// ФЮЗЕЛЯЖ: сечение — суперэллипс с разной высотой верха и низа

const T_YT = [[5.65, 0.74], [4.6, 0.745], [4.2, 0.76], [3.7, 0.8], [-0.6, 0.8], [-1.4, 0.78], [-2.2, 0.72], [-3.0, 0.62], [-4.0, 0.51], [-5.0, 0.43], [-5.4, 0.4]];
const T_YB = [[5.65, -0.74], [4.6, -0.755], [4.1, -0.9], [3.5, -1.08], [2.9, -1.17], [2.4, -1.2], [-1.85, -1.2], [-2.3, -1.08], [-2.5, -1.0], [-2.62, -0.72], [-3.2, -0.6], [-4.0, -0.45], [-4.8, -0.28], [-5.4, -0.04]];
const T_W = [[5.65, 0.74], [4.6, 0.745], [4.0, 0.75], [2.4, 0.75], [-1.85, 0.75], [-2.6, 0.64], [-3.5, 0.5], [-4.5, 0.33], [-5.2, 0.16], [-5.4, 0.08]];
const T_YW = [[5.65, 0], [4.6, 0], [3.8, -0.1], [2.4, -0.12], [-1.85, -0.12], [-3.0, -0.02], [-4.5, 0.08], [-5.4, 0.17]];
const T_NT = [[5.65, 2], [4.6, 2], [3.8, 2.4], [-5.4, 2.2]];
const T_NB = [[5.65, 2], [4.6, 2], [3.2, 2.6], [-1.85, 2.6], [-2.6, 2.4], [-5.4, 2.1]];
function fusSec(x) {
  return { yT: tab(T_YT, x), yB: tab(T_YB, x), W: tab(T_W, x), yW: tab(T_YW, x), nT: tab(T_NT, x), nB: tab(T_NB, x) };
}
const circSec = (r) => ({ yT: r, yB: -r, W: r, yW: 0, nT: 2, nB: 2 });
const inBay = (x) => x < BAY.x0 && x > BAY.x1;
const MB = 7, MS = 24;
// кольцо сечения: от середины низа через правый борт, верх и левый борт; rec — ниша бомбоотсека
function fusRing(c, rec) {
  const { yT, yB, W, yW, nT, nB } = c;
  const zh = Math.min(BAY.zh, 0.75 * W);
  const phiH = Math.asin(Math.pow(zh / W, nB / 2));
  const bot = (phi) => [yW - (yW - yB) * Math.pow(Math.max(0, Math.cos(phi)), 2 / nB), W * Math.pow(Math.sin(phi), 2 / nB)];
  const half = [];
  for (let i = 0; i <= MB; i++) {
    const [y, z] = bot((phiH * i) / MB);
    half.push({ y: y + (rec ? BAY.d : 0), z, rec });
  }
  for (let i = 0; i <= MS; i++) {
    const phi = phiH + ((Math.PI - phiH) * i) / MS;
    if (phi <= Math.PI / 2) {
      const [y, z] = bot(phi);
      half.push({ y, z, rec: false });
    } else {
      const s = Math.max(0, Math.sin(phi)), co = -Math.cos(phi);
      half.push({ y: yW + (yT - yW) * Math.pow(co, 2 / nT), z: W * Math.pow(s, 2 / nT), rec: false });
    }
  }
  const ring = half.map((p) => ({ ...p }));
  for (let i = half.length - 2; i >= 1; i--) ring.push({ y: half[i].y, z: -half[i].z, rec: half[i].rec });
  ring.push({ ...ring[0] }); // шов UV на середине низа
  let arc = 0;
  ring.forEach((p, i) => {
    if (i > 0) arc += Math.hypot(p.y - ring[i - 1].y, p.z - ring[i - 1].z);
    p.arc = arc;
  });
  return ring;
}
// высота верха фюзеляжа над точкой (x, z)
function fusTopY(x, z) {
  const c = fusSec(x);
  const r = Math.min(1, Math.abs(z) / c.W);
  return c.yW + (c.yT - c.yW) * Math.pow(1 - Math.pow(r, c.nT), 1 / c.nT);
}
function fusBotY(x, z = 0) {
  const c = fusSec(x);
  const r = Math.min(1, Math.abs(z) / c.W);
  return c.yW - (c.yW - c.yB) * Math.pow(1 - Math.pow(r, c.nB), 1 / c.nB);
}
// губа капота: [x, r, x для UV]
const LIP = [[5.5, 0.61, 5.85], [5.7, 0.625, 5.835], [5.775, 0.668, 5.8], [5.79, 0.703, 5.79], [5.765, 0.73, 5.775], [5.7, 0.74, 5.7]];
const FUS_ST = (() => {
  const st = [];
  for (let x = 5.62; x > -5.4; x -= 0.1) st.push(+x.toFixed(3));
  const extra = [BAY.x0, BAY.x1, -2.5, -2.62, 4.6, -5.4];
  const xs = [...new Set([...st, ...extra])].sort((a, b) => b - a).filter((x, i, arr) => i === 0 || arr[i - 1] - x > 0.02 || extra.includes(x));
  const out = [];
  for (const x of xs) {
    if (x === BAY.x0) out.push({ x, rec: false }, { x, rec: true });
    else if (x === BAY.x1) out.push({ x, rec: true }, { x, rec: false });
    else out.push({ x, rec: inBay(x) });
  }
  return out;
})();
const FU = (x) => 0.0025 + (0.995 * (x - XF0)) / (XF1 - XF0);
const GIRTH = Math.max(...FUS_ST.map(({ x, rec }) => fusRing(fusSec(x), rec).at(-1).arc)) * 1.01;
const FV = (arc) => 0.5025 + (0.495 * arc) / GIRTH;

function buildFuselage() {
  const m = new Mesher();
  const rings = [];
  for (const [x, r, xu] of LIP) rings.push(fusRing(circSec(r), false).map((p) => m.v(V3(x, p.y, p.z), FU(xu), FV(p.arc))));
  for (const { x, rec } of FUS_ST) rings.push(fusRing(fusSec(x), rec).map((p) => m.v(V3(x, p.y, p.z), FU(x), FV(p.arc))));
  for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
  // торцы: противопожарная перегородка в капоте (тёмная) и хвостовой конус
  const capF = fusRing(circSec(LIP[0][1]), false).slice(0, -1).map((p) => m.v(V3(LIP[0][0], p.y, p.z), FU(5.85), 0.75));
  m.fan(capF, m.v(V3(LIP[0][0], 0, 0), FU(5.85), 0.75), false);
  const xe = FUS_ST.at(-1).x;
  const ce = fusSec(xe);
  const last = rings.at(-1).slice(0, -1);
  m.fan(last, m.v(V3(xe - 0.005, (ce.yT + ce.yB) / 2, 0), FU(xe), FV(GIRTH * 0.25)), true);
  return m.build();
}

// Створки бомбоотсека: лист 35 мм по обводу низа, петли на |z| = BAY.zh
const DOOR_T = 0.035;
function buildBayDoor(side) {
  const NZ = 8;
  const xs = [];
  for (let i = 0; i <= 10; i++) xs.push(lerp(BAY.x0 - 0.012, BAY.x1 + 0.012, i / 10));
  const rings = xs.map((x) => {
    const outer = [], inner = [];
    const u = (side > 0 ? 0.3775 : 0.0025) + (0.37 * (BAY.x0 - x)) / (BAY.x0 - BAY.x1);
    for (let j = 0; j <= NZ; j++) {
      const z = lerp(0.006, BAY.zh - 0.006, j / NZ);
      const y = fusBotY(x, z);
      const v = 0.4025 + (0.095 * z) / BAY.zh;
      outer.push({ p: V3(x, y, side * z), uv: [u, v] });
      inner.push({ p: V3(x, y + DOOR_T, side * z), uv: [u, v] });
    }
    return [...outer, ...inner.reverse()];
  });
  return thinLoft(rings);
}

// ---------------------------------------------------------------------------
// КРЫЛО (центроплан без V, консоли с V 5.5°; линия складывания z = ±2.75)

const WG = { root: 0.55, fold: 2.75, tip0: 7.85, half: 8.255, y: -0.55, dih: Math.tan(THREE.MathUtils.degToRad(5.5)), a0: 4.75, a1: 7.75 };
function wingSt(a) {
  a = Math.abs(a);
  const k = clamp01((Math.min(a, WG.tip0) - WG.fold) / (WG.tip0 - WG.fold));
  let le = 3.25 - 0.5 * k, te = -0.15 + 1.35 * k;
  if (a > WG.tip0) {
    const s = clamp01((a - WG.tip0) / (WG.half - WG.tip0));
    const mid = (le + te) / 2 + 0.12 * s, hc = ((le - te) / 2) * Math.max(0.1, Math.sqrt(Math.max(0, 1 - s * s)));
    le = mid + hc;
    te = mid - hc;
  }
  const tc = a <= WG.fold ? lerp(0.18, 0.15, a / WG.fold) : lerp(0.15, 0.09, (a - WG.fold) / (WG.half - WG.fold));
  return { le, c: le - te, tc };
}
const wingY = (a) => WG.y + Math.max(0, Math.abs(a) - WG.fold) * WG.dih;
const H0 = (() => { const w = wingSt(WG.a0); return w.le - 0.75 * w.c; })();
const H1 = (() => { const w = wingSt(WG.a1); return w.le - 0.75 * w.c; })();
const ailX = (a) => lerp(H0, H1, (Math.abs(a) - WG.a0) / (WG.a1 - WG.a0));
const wingHalf = (x, a) => {
  const w = wingSt(a);
  return naca((w.le - x) / w.c) * w.tc * w.c;
};
const WBAND = { L: [0, 0.1], R: [0.2, 0.3] }; // [верх, низ]
const wingUV = (side) => (s, x, top) => [0.0025 + (0.745 * Math.abs(s)) / 8.3, WBAND[side > 0 ? 'R' : 'L'][top ? 0 : 1] + 0.0025 + (0.095 * (x + 0.25)) / 3.55];
const wingMap = (side) => (s, x, h) => V3(x, wingY(s) + h, side * s);

function buildWing(side) {
  const st = [];
  const add = (a, cut) => st.push({ s: a, cut, xc: ailX(a) + 0.045, ...wingSt(a) });
  [WG.root, 0.8, 1.2, 1.6, 2.0, 2.4, WG.fold, 3.1, 3.5, 3.9, 4.3].forEach((a) => add(a, false));
  add(WG.a0, false);
  add(WG.a0, true);
  [5.1, 5.45, 5.8, 6.15, 6.5, 6.85, 7.2, 7.5].forEach((a) => add(a, true));
  add(WG.a1, true);
  add(WG.a1, false);
  [7.85, 7.95, 8.05, 8.13, 8.19, 8.235, WG.half].forEach((a) => add(a, false));
  return foilLoft(st, { map: wingMap(side), uv: wingUV(side), N1: 16, N2: 5, caps: [false, true] });
}
function buildAileron(side) {
  const st = [];
  for (let i = 0; i <= 10; i++) {
    const a = lerp(WG.a0 + 0.02, WG.a1 - 0.02, i / 10);
    st.push({ s: a, xh: ailX(a), ...wingSt(a) });
  }
  return ctrlLoft(st, { map: wingMap(side), uv: wingUV(side) });
}

// ---------------------------------------------------------------------------
// ОПЕРЕНИЕ

const TP = { y: 0.22, half: 3.1, tip0: 2.6, xh: -5.0, e0: 0.22, e1: 2.85, tc: 0.11 };
function tailSt(a) {
  a = Math.abs(a);
  let le = -3.95 - (0.25 * Math.min(a, TP.tip0)) / TP.tip0, te = -5.85;
  if (a > TP.tip0) {
    const s = clamp01((a - TP.tip0) / (TP.half - TP.tip0));
    const mid = (le + te) / 2, hc = ((le - te) / 2) * Math.max(0.12, Math.sqrt(Math.max(0, 1 - s * s)));
    le = mid + hc;
    te = mid - hc;
  }
  return { le, c: le - te, tc: TP.tc };
}
const tailUV = (s, x, top) => [0.7525 + (0.245 * Math.abs(s)) / 3.15, (top ? 0.0025 : 0.1275) + (0.12 * (x + 5.9)) / 2.05];
const tailMap = (s, x, h) => V3(x, TP.y + h, s);
function buildStabilizer() {
  const half = [];
  [0, 0.12, TP.e0, 0.6, 1.0, 1.4, 1.8, 2.2, 2.6].forEach((a) => half.push({ a, cut: true }));
  half.push({ a: TP.e1, cut: true }, { a: TP.e1, cut: false });
  [2.95, 3.02, 3.07, TP.half].forEach((a) => half.push({ a, cut: false }));
  const list = [...half.slice(1).reverse().map((h) => ({ ...h, a: -h.a })), ...half];
  const st = list.map(({ a, cut }) => ({ s: a, cut, xc: TP.xh + 0.045, ...tailSt(a) }));
  return foilLoft(st, { map: tailMap, uv: tailUV, N1: 12, N2: 4 });
}
function buildElevator(side) {
  const st = [];
  for (let i = 0; i <= 8; i++) {
    const a = lerp(TP.e0 + 0.02, TP.e1 - 0.02, i / 8);
    st.push({ s: side * a, xh: TP.xh, ...tailSt(a) });
  }
  return ctrlLoft(st, { map: tailMap, uv: tailUV, M: 5 });
}

const FIN = { y0: 0.3, top: 3.1, xh: -5.46, tc: 0.11 };
function finSt(y) {
  let le = lerp(-3.6, -4.85, (y - 0.3) / 2.5);
  if (y > 2.8) le -= 0.55 * (1 - Math.sqrt(Math.max(0, 1 - ((y - 2.8) / 0.3) ** 2)));
  let te = -6.28;
  if (y > 2.5) te += 0.7 * (1 - Math.sqrt(Math.max(0, 1 - ((y - 2.5) / 0.61) ** 2)));
  return { le, c: le - te, tc: FIN.tc };
}
const finUV = (s, x) => [0.7525 + (0.245 * (x + 6.35)) / 2.95, 0.2525 + (0.245 * (s + 0.05)) / 3.2];
const finMap = (s, x, h) => V3(x, s, h);
function buildFin() {
  const Y = [FIN.y0, 0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.3, 2.55, 2.8, 2.93, 3.01, 3.06, FIN.top];
  const st = Y.map((y) => ({ s: y, cut: true, xc: FIN.xh + 0.045, ...finSt(y) }));
  return foilLoft(st, { map: finMap, uv: finUV, N1: 14, N2: 4, caps: [false, true] });
}
function buildRudder() {
  const Y = [0.02, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.6, 2.8, 2.93, 3.01, 3.07];
  return ctrlLoft(Y.map((y) => ({ s: y, xh: FIN.xh, ...finSt(y) })), { map: finMap, uv: finUV, M: 6 });
}

// ---------------------------------------------------------------------------
// ОСТЕКЛЕНИЕ: фонарь «оранжерея» — тонкая оболочка 12 мм, нижние кромки под обшивкой

const CAN = { wb: 0.43, K: 20, t: 0.012, grow: 0.016 };
const canTop = (x) => tab([[3.62, 0.7], [3.5, 1.0], [3.3, 1.27], [3.1, 1.4], [2.6, 1.43], [0.6, 1.42], [-0.2, 1.36], [-0.6, 1.31]], x);
const CU = (x) => 0.0025 + (0.995 * (x + 0.7)) / 4.4;
function canSec(x, grow = 0, inset = 0) {
  const wb = CAN.wb + grow;
  const yb = fusTopY(x, wb) - 0.045;
  const yr = Math.max(yb + 0.02, canTop(x) + grow);
  const arch = (w, top) => {
    const pts = [];
    for (let k = 0; k <= CAN.K; k++) {
      const f = (k / CAN.K) * Math.PI;
      const cf = Math.cos(f), sf = Math.sin(f);
      const e = 2 / 3;
      pts.push({ p: V3(x, yb + (top - yb) * Math.abs(sf) ** e, -w * Math.sign(cf) * Math.abs(cf) ** e), uv: [CU(x), 0.5025 + (0.495 * k) / CAN.K] });
    }
    return pts;
  };
  return { outer: arch(wb - inset, yr - inset), inner: arch(wb - CAN.t - inset, yr - CAN.t - inset), yb };
}
function canopyShell(x0, x1, n, grow) {
  const rings = [];
  for (let i = 0; i <= n; i++) {
    const s = canSec(lerp(x0, x1, i / n), grow);
    rings.push([...s.outer, ...s.inner.reverse()]);
  }
  return thinLoft(rings);
}
function canopyBulkhead() {
  const ring = (x) => canSec(x, 0, CAN.t + 0.002).outer.map((q) => q.p);
  return setUV(loftRings([ring(-0.56), ring(-0.58)]), 0.75, 0.375);
}

// Шаровая турель Grumman 150SE: начало — центр погона (local), ось поворота Y связанной системы
const TUR = { x: -1.4, y: 0.7, R: 0.52, yc: 0.38 };
function buildTurret() {
  const prof = [[0.5, -0.3, 0], [0.5, -0.05, 0.05], [0.5, 0.14, 0.1], [0.48, 0.17, 0.115]];
  [-20, -5, 10, 25, 40, 55, 70, 82].forEach((a) => {
    const r = THREE.MathUtils.degToRad(a);
    prof.push([TUR.R * Math.cos(r), TUR.yc + TUR.R * Math.sin(r), 0.12 + (0.38 * (a + 20)) / 110]);
  });
  prof.push([0, TUR.yc + TUR.R, 0.5]);
  const body = lathe(prof.map(([r, y]) => [r, y]), 32, { uvFn: (u, k) => [0.5 * u, prof[k][2]] });
  // .50 Browning — ствол назад, справа от центра
  const gun = merge([rod([-0.3, 0.4, 0.17], [-1.5, 0.42, 0.17], 0.03, 8), rod([-0.35, 0.4, 0.17], [-0.95, 0.41, 0.17], 0.05, 10), rod([-1.42, 0.42, 0.17], [-1.52, 0.42, 0.17], 0.042, 8)]);
  return merge([body, setUV(gun, 0.75, 0.125)]);
}

// ---------------------------------------------------------------------------
// ДВИГАТЕЛЬ, ВИНТ, ШАССИ

function buildEngine() {
  const parts = [latheX([[0.4, 5.49], [0.38, 5.56], [0.3, 5.62], [0.18, 5.66], [0.08, 5.68], [0, 5.685]], 24)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const b = a + Math.PI / 7;
    parts.push(rod([5.6, 0.3 * Math.cos(a), 0.3 * Math.sin(a)], [5.6, 0.585 * Math.cos(a), 0.585 * Math.sin(a)], 0.075, 8));
    parts.push(rod([5.53, 0.3 * Math.cos(b), 0.3 * Math.sin(b)], [5.53, 0.585 * Math.cos(b), 0.585 * Math.sin(b)], 0.07, 8));
  }
  // выхлопные патрубки по бокам за капотом
  [1, -1].forEach((sd) => {
    parts.push(rod([4.62, -0.3, sd * 0.69], [4.36, -0.33, sd * 0.745], 0.05, 8));
    parts.push(rod([4.62, -0.47, sd * 0.62], [4.36, -0.5, sd * 0.68], 0.046, 8));
  });
  return merge(parts.map((g) => setUV(g, 0.5, 0.5)));
}

// Лопасть: радиальная ось +Y, ось вращения X
function bladeGeometry({ r0, r1, chord0, chord1, pitch, tc = 0.1, n = 10 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = lerp(chord0, chord1, Math.sin(Math.PI * Math.min(1, s * 1.15) * 0.5)) * (k === n ? 0.45 : k === n - 1 ? 0.82 : 1);
    const beta = Math.atan(pitch / (2 * Math.PI * Math.max(r, 0.3)));
    const d = V3(Math.sin(beta), 0, Math.cos(beta));
    const nn = V3(Math.cos(beta), 0, -Math.sin(beta));
    const ring = [];
    const M = 7;
    const pts = [];
    for (let j = 0; j <= M; j++) pts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const add = (t, sign) => {
      const c = (0.35 - t) * ch;
      const h = sign * Math.max(0.004, naca(t) * tc * ch * (1 - 0.55 * s));
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
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const COL = {
  sea: [44, 56, 76],
  inter: [74, 94, 118],
  white: [226, 228, 224],
  insBlue: [28, 40, 92],
  insWhite: [238, 238, 234],
  bay: [168, 172, 150],
  glass: [30, 42, 54],
  walk: [42, 44, 46],
  dark: [26, 27, 28],
};
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// трёхцветная схема по нормали: Sea Blue — верх, Intermediate Blue — борта, белый — низ
function triColor(ny) {
  const a = smooth((ny - 0.38) / 0.16);
  const b = smooth((ny + 0.36) / 0.16);
  return mix(mix(COL.white, COL.inter, b), COL.sea, a);
}
// Звезда с полосами 1943–44 (синяя окантовка); up — вверх по знаку (dy)
function inStar(dx, dy, R) {
  const r = Math.hypot(dx, dy);
  if (r > R) return false;
  const sec = (2 * Math.PI) / 5;
  let f = Math.atan2(dx, dy);
  f = ((f % sec) + sec) % sec;
  if (f > sec / 2) f = sec - f;
  const ri = R * 0.382;
  const ax = 0, ay = R, bx = ri * Math.sin(sec / 2), by = ri * Math.cos(sec / 2);
  const px = r * Math.sin(f), py = r * Math.cos(f);
  const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const c0 = (bx - ax) * (0 - ay) - (by - ay) * (0 - ax);
  return cr * c0 >= 0;
}
function insignia(dx, dy, R) {
  const o = R / 8;
  const d = Math.hypot(dx, dy);
  if (d <= R) return inStar(dx, dy, R) ? COL.insWhite : COL.insBlue;
  const lo = -0.191 * R, hi = 0.309 * R;
  if (Math.abs(dx) <= 2 * R && dy >= lo && dy <= hi) return COL.insWhite;
  if (d <= R + o || (Math.abs(dx) <= 2 * R + o && dy >= lo - o && dy <= hi + o)) return COL.insBlue;
  return null;
}
const groove = (d, w, pw) => clamp01((w - Math.abs(d)) / pw + 0.5);
const nearest = (v, step, off = 0) => Math.abs(((v - off) / step - Math.round((v - off) / step)) * step);

function paintAtlas() {
  const S = ATLAS;
  const col = makeCanvas(S, S);
  const C = col.getContext('2d');
  const img = C.createImageData(S, S);
  const D = img.data;
  const Hm = new Float32Array(S * S).fill(0.5);
  for (let i = 0; i < S * S; i++) {
    D[i * 4] = COL.white[0];
    D[i * 4 + 1] = COL.white[1];
    D[i * 4 + 2] = COL.white[2];
    D[i * 4 + 3] = 255;
  }
  const put = (px, py, c, h = 0.5) => {
    const o = py * S + px;
    D[o * 4] = c[0];
    D[o * 4 + 1] = c[1];
    D[o * 4 + 2] = c[2];
    Hm[o] = h;
  };
  const rowOf = (v) => Math.round((1 - v) * S - 0.5);
  const colOf = (u) => Math.round(u * S - 0.5);
  const region = (u0, u1, v0, v1, fn) => {
    for (let py = Math.max(0, rowOf(v1)); py <= Math.min(S - 1, rowOf(v0)); py++) {
      const v = 1 - (py + 0.5) / S;
      for (let px = Math.max(0, colOf(u0)); px <= Math.min(S - 1, colOf(u1)); px++) fn((px + 0.5) / S, v, px, py);
    }
  };
  let seed = 1943;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grime = new Float32Array(64 * 64).map(() => rnd());
  const noise = (u, v) => {
    const x = u * 63, y = v * 63;
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const g = (a, b) => grime[Math.min(63, b) * 64 + Math.min(63, a)];
    return lerp(lerp(g(i, j), g(i + 1, j), fx), lerp(g(i, j + 1), g(i + 1, j + 1), fx), fy);
  };
  const finish = (c, u, v) => {
    const k = 0.95 + 0.07 * noise((u * 3) % 1, (v * 3) % 1);
    return [c[0] * k, c[1] * k, c[2] * k];
  };

  // ---- ФЮЗЕЛЯЖ (u — X, v — обвод от середины низа через правый борт)
  {
    const pwX = (XF1 - XF0) / (0.995 * S), pwA = GIRTH / (0.495 * S);
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;
      const x = XF0 + ((u - 0.0025) / 0.995) * (XF1 - XF0);
      const xs = Math.min(5.65, Math.max(XF0, x));
      const ring = fusRing(x > 5.65 ? circSec(0.74) : fusSec(xs), inBay(x));
      const total = ring.at(-1).arc;
      let k = 0;
      for (let py = rowOf(0.5025); py >= rowOf(0.9975); py--) {
        const v = 1 - (py + 0.5) / S;
        const arc = ((v - 0.5025) / 0.495) * GIRTH;
        if (arc > total + 0.05) continue;
        while (k < ring.length - 2 && ring[k + 1].arc < arc) k++;
        const A = ring[k], B = ring[k + 1];
        const f = clamp01((arc - A.arc) / (B.arc - A.arc || 1));
        const y = lerp(A.y, B.y, f), z = lerp(A.z, B.z, f);
        const ty = B.y - A.y, tz = B.z - A.z, tl = Math.hypot(ty, tz) || 1;
        const ny = -tz / tl, nz = ty / tl;
        const rec = A.rec || B.rec;
        let colr = triColor(ny);
        let h = 0.5;
        if (x > 5.8) {
          colr = COL.dark; // внутренняя губа капота и перегородка
        } else if (rec) {
          colr = COL.bay;
        } else {
          // шпангоуты, стрингеры, капот
          let ln = 0;
          if (x < 4.6) ln = Math.max(groove(nearest(x, 0.55, 4.6), 0.005, pwX) * 0.8, groove(nearest(arc, 0.9, 0.3), 0.004, pwA) * 0.4);
          else ln = Math.max(groove(x - 5.1, 0.006, pwX), groove(nearest(arc, total / 12), 0.006, pwA) * (x < 4.9 ? 1 : 0));
          ln = Math.max(ln, groove(x - 4.6, 0.008, pwX));
          // створки отсека и люки по краю ниши
          if (x < BAY.x0 + 0.02 && x > BAY.x1 - 0.02 && Math.abs(Math.abs(z) - BAY.zh) < 0.03) ln = Math.max(ln, 0.6);
          // входная дверь стрелка-радиста (правый борт)
          if (z > 0.2 && x > -1.78 && x < -1.08 && y > -0.52 && y < 0.42) {
            const e = Math.min(x + 1.78, -1.08 - x, y + 0.52, 0.42 - y);
            if (e < 0.012) ln = 1;
            if (Math.abs(x + 1.2) < 0.05 && Math.abs(y - 0.0) < 0.012) h = 0.65;
          }
          h -= 0.3 * ln;
          colr = mix(colr, [44, 48, 54], 0.12 * ln);
          // окна: радиоотсек под турелью, нижняя установка за ступенью
          const win = (cx, cy, w, hh) => Math.abs(z) > 0.25 && Math.abs(x - cx) < w / 2 && Math.abs(y - cy) < hh / 2;
          if (win(-0.85, 0.22, 0.32, 0.2) || win(-2.2, -0.62, 0.42, 0.16) || win(-2.53, -0.58, 0.12, 0.12)) {
            colr = COL.glass;
            h = 0.4;
          }
          // копоть выхлопа
          if (x < 4.4 && x > 2.6 && Math.abs(z) > 0.3 && y < 0.1 && y > -0.75)
            colr = mix(colr, [52, 50, 48], 0.5 * smooth((x - 2.6) / 1.8) * smooth((0.1 - y) / 0.25) * smooth((y + 0.75) / 0.25) * (0.7 + 0.3 * noise(u, v)));
          // звезда с полосами на обоих бортах
          if (Math.abs(nz) > 0.25) {
            const ins = insignia((x + 3.0) * Math.sign(z), y + 0.0, 0.42);
            if (ins) colr = ins;
          }
          // тёмная полоса-подножка на левом борту у кабины
          if (z < -0.3 && Math.abs(x - 2.4) < 0.11 && Math.abs(y - 0.25) < 0.06) {
            colr = COL.walk;
            h = 0.38;
          }
        }
        put(px, py, finish(colr, u, v), h);
      }
    }
  }

  // ---- КРЫЛЬЯ: планформа (u — размах, v — хорда); полосы L верх/низ, R верх/низ
  const wingPx = (side, top) => {
    const v0 = WBAND[side > 0 ? 'R' : 'L'][top ? 0 : 1];
    region(0, 0.75, v0, v0 + 0.1, (u, v, px, py) => {
      const a = ((u - 0.0025) / 0.745) * 8.3;
      const x = -0.25 + ((v - v0 - 0.0025) / 0.095) * 3.55;
      const w = wingSt(Math.min(a, WG.half));
      const t = (w.le - x) / w.c;
      const pwZ = 8.3 / (0.745 * S), pwX = 3.55 / (0.095 * S);
      let colr = top ? COL.sea : COL.white;
      let h = 0.5;
      // лонжероны, нервюры, складывание, закрылки
      let ln = Math.max(groove((t - 0.15) * w.c, 0.006, pwX), groove((t - 0.62) * w.c, 0.006, pwX) * 0.7);
      ln = Math.max(ln, groove(nearest(a, 0.55, 0.2), 0.005, pwZ) * (t < 0.62 ? 0.7 : 0.4));
      if (Math.abs(a - WG.fold) < 0.02) {
        ln = 1;
        h = 0.15;
      }
      if (!top && a > WG.root && a < WG.a0 - 0.05 && t > 0.74) ln = Math.max(ln, groove((t - 0.75) * w.c, 0.008, pwX), groove(a - (WG.a0 - 0.08), 0.008, pwZ), groove(a - 2.7, 0.008, pwZ));
      if (a > WG.a0 && a < WG.a1 && t > 0.75) ln = Math.max(ln, groove(nearest(a, 0.25), 0.004, pwZ) * 0.6); // нервюры полотна элерона
      if (a > WG.a0 + 1.2 && a < WG.a0 + 1.9 && Math.abs(x - ailX(a) + 0.18) < 0.09 && t > 0.75) ln = Math.max(ln, groove(Math.abs(x - ailX(a) + 0.18) - 0.09, 0.006, pwX)); // триммер
      h -= 0.3 * ln;
      colr = mix(colr, [40, 44, 50], 0.12 * ln);
      // противоскользящая дорожка у корня
      if (top && a > WG.root && a < 1.05 && x > 0.3 && x < 2.9) {
        colr = COL.walk;
        h = 0.45;
      }
      // пулемётные порты, огни на законцовке
      if (Math.abs(a - 3.2) < 0.05 && t < 0.04) colr = COL.dark;
      if (a > 8.12 && t < 0.25) colr = top ? (side > 0 ? [40, 140, 70] : [170, 40, 40]) : colr;
      // знак: сверху на левом крыле, снизу на правом; верх знака — вперёд
      if ((top && side < 0) || (!top && side > 0)) {
        const ins = insignia(a - 5.6, x - 1.79, 0.62);
        if (ins) colr = ins;
      }
      put(px, py, finish(colr, u, v), h);
    });
  };
  wingPx(-1, true);
  wingPx(-1, false);
  wingPx(1, true);
  wingPx(1, false);

  // ---- СТВОРКИ БОМБООТСЕКА (наружная сторона — белая)
  region(0, 0.75, 0.4, 0.5, (u, v, px, py) => {
    const right = u > 0.375;
    const x = BAY.x0 - ((u - (right ? 0.3775 : 0.0025)) / 0.37) * (BAY.x0 - BAY.x1);
    const z = ((v - 0.4025) / 0.095) * BAY.zh;
    const pw = (BAY.x0 - BAY.x1) / (0.37 * S);
    const ln = Math.max(groove(nearest(x, 0.68, 0.2), 0.005, pw), groove(z - 0.22, 0.004, pw) * 0.5);
    put(px, py, finish(mix(COL.white, [40, 44, 50], 0.1 * ln), u, v), 0.5 - 0.3 * ln);
  });

  // ---- СТАБИЛИЗАТОР И РУЛИ ВЫСОТЫ
  region(0.75, 1.0, 0.0, 0.25, (u, v, px, py) => {
    const top = v < 0.125;
    const a = ((u - 0.7525) / 0.245) * 3.15;
    const x = -5.9 + ((v - (top ? 0.0025 : 0.1275)) / 0.12) * 2.05;
    const pw = 3.15 / (0.245 * S);
    let ln = x < TP.xh ? groove(nearest(a, 0.25, 0.05), 0.006, pw) * 0.6 : groove(nearest(a, 0.6), 0.004, pw);
    if (x < TP.xh && a > 0.6 && a < 1.3 && x < -5.55) ln = Math.max(ln, groove(Math.min(Math.abs(a - 0.6), Math.abs(a - 1.3)), 0.005, pw));
    const colr = top ? COL.sea : COL.white;
    put(px, py, finish(mix(colr, [40, 44, 50], 0.12 * ln), u, v), 0.5 - 0.28 * ln);
  });

  // ---- КИЛЬ И РУЛЬ НАПРАВЛЕНИЯ (боковая проекция) — Intermediate Blue
  region(0.75, 1.0, 0.25, 0.5, (u, v, px, py) => {
    const x = -6.35 + ((u - 0.7525) / 0.245) * 2.95;
    const y = -0.05 + ((v - 0.2525) / 0.245) * 3.2;
    const pw = 2.95 / (0.245 * S);
    let ln = x < FIN.xh ? groove(nearest(y, 0.26, 0.05), 0.006, pw) * 0.6 : Math.max(groove(nearest(y, 0.55, 0.2), 0.004, pw), groove(nearest(x, 0.6, 0.1), 0.004, pw));
    if (x < -5.95 && y > 0.5 && y < 1.2) ln = Math.max(ln, groove(Math.min(Math.abs(y - 0.5), Math.abs(y - 1.2), Math.abs(x + 5.95)), 0.005, pw));
    put(px, py, finish(mix(COL.inter, [40, 44, 50], 0.12 * ln), u, v), 0.5 - 0.28 * ln);
  });

  C.putImageData(img, 0, 0);

  const nrm = makeCanvas(S, S);
  const N = nrm.getContext('2d');
  const out = N.createImageData(S, S);
  const k = 2.6;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const at = (xx, yy) => Hm[Math.min(S - 1, Math.max(0, yy)) * S + Math.min(S - 1, Math.max(0, xx))];
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      out.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      out.data[o + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
      out.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      out.data[o + 3] = 255;
    }
  }
  N.putImageData(out, 0, 0);

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

// Остекление: фонарь (верх), турель (низ слева), металл и краска (низ справа)
function paintGlass() {
  const S = 1024;
  const c = makeCanvas(S, S);
  const C = c.getContext('2d');
  const img = C.createImageData(S, S);
  const D = img.data;
  const toRGB = (a) => `rgb(${a.map((v) => Math.round(v)).join(',')})`;
  void toRGB;
  const BOWS = [3.6, 3.33, 3.1, 3.07, 2.55, 2.04, 2.0, 1.45, 0.9, 0.4, -0.1, -0.58];
  for (let py = 0; py < S; py++) {
    const v = 1 - (py + 0.5) / S;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;
      let colr;
      if (v >= 0.5) {
        const x = -0.7 + ((u - 0.0025) / 0.995) * 4.4;
        const k = (v - 0.5025) / 0.495;
        const up = Math.sin(Math.PI * clamp01(k));
        colr = mix([26, 36, 48], [86, 104, 122], 0.6 * up ** 3 + 0.1 * Math.sin(x * 2.1) ** 2);
        let frame = k < 0.07 || k > 0.93 || Math.abs(k - 0.31) < 0.009 || Math.abs(k - 0.69) < 0.009;
        if (BOWS.some((b) => Math.abs(x - b) < 0.022)) frame = true;
        if (x > 3.1 && (Math.abs(k - 0.39) < 0.008 || Math.abs(k - 0.61) < 0.008)) frame = true;
        if (frame) colr = mix(COL.sea, COL.inter, 1 - up);
      } else if (u < 0.5) {
        const uu = u / 0.5;
        if (v < 0.2) colr = COL.sea;
        else {
          colr = mix([26, 36, 48], [84, 100, 118], clamp01((v - 0.2) / 0.3) ** 2);
          if (nearest(uu, 1 / 8) < 0.01 || Math.abs(v - 0.327) < 0.006 || Math.abs(v - 0.21) < 0.008) colr = COL.sea;
        }
      } else if (v < 0.25) colr = [40, 42, 44];
      else colr = COL.sea;
      const o = (py * S + px) * 4;
      D[o] = colr[0];
      D[o + 1] = colr[1];
      D[o + 2] = colr[2];
      D[o + 3] = 255;
    }
  }
  C.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = 'image/jpeg';
  t.name = 'Glazing_Frames';
  return t;
}
// Винт Hamilton Standard: чёрные лопасти с жёлтыми концами, кок — серый
function paintProp() {
  const S = 256;
  const c = makeCanvas(S, S);
  const C = c.getContext('2d');
  C.fillStyle = '#151618';
  C.fillRect(0, 0, S / 2, S);
  C.fillStyle = '#d9b02c';
  C.fillRect(0, 0, S / 2, S * 0.05);
  C.fillStyle = '#5c6166';
  C.fillRect(S / 2, 0, S / 2, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = 'image/jpeg';
  t.name = 'Propeller_Paint_Color';
  return t;
}

// ---------------------------------------------------------------------------

export function createAvenger() {
  const root = new THREE.Group();
  root.name = 'Torpedo_Bomber_Avenger';
  const { map, normalMap } = paintAtlas();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    paint: std('Airframe_Paint', 0xffffff, 0.66, 0.1, { map, normalMap }),
    glass: std('Glazing_Tinted', 0xffffff, 0.12, 0.15, { map: paintGlass() }),
    prop: std('Propeller_Paint', 0xffffff, 0.45, 0.3, { map: paintProp() }),
    metal: std('Metal_Dark', 0x34373a, 0.5, 0.65),
    gear: std('Gear_White', 0xd9dbd6, 0.6, 0.1),
    tire: std('Tire_Rubber', 0x1b1b1c, 0.92, 0.0),
  };
  // связанная система → мир: поворот на угол стоянки
  const R = new THREE.Matrix4().makeRotationZ(PITCH);
  const W = (p) => V3(...p).applyMatrix4(R);
  const axis = (d) => V3(...d).applyMatrix4(new THREE.Matrix4().makeRotationZ(PITCH)).normalize();
  const group = (name, parent, pos = V3(0, 0, 0)) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.copy(pos);
    parent.add(g);
    return g;
  };
  const mesh = (geo, mat, name, parent, origin = null) => {
    const g = geo.clone().applyMatrix4(R);
    if (origin) g.translate(-origin.x, -origin.y, -origin.z);
    const mm = new THREE.Mesh(g, mat);
    mm.name = name;
    g.name = name;
    parent.add(mm);
    return mm;
  };
  const axes = {};

  // ======================= ПЛАНЕР
  const air = group('Airframe', root);
  mesh(buildFuselage(), M.paint, 'Fuselage', air);
  mesh(buildWing(-1), M.paint, 'Wing_L', air);
  mesh(buildWing(1), M.paint, 'Wing_R', air);
  mesh(merge([buildFin(), buildStabilizer()]), M.paint, 'Tail_Fixed', air);
  mesh(merge([canopyShell(3.62, 3.1, 8, 0), canopyShell(2.0, -0.6, 14, 0), canopyBulkhead()]), M.glass, 'Canopy_Fixed', air);
  mesh(buildEngine(), M.metal, 'Engine', air);

  // мелочи: пулемёты, ПВД, мачта и антенна, гак (убран)
  {
    const parts = [];
    [1, -1].forEach((sd) => parts.push(rod([3.0, wingY(3.2), sd * 3.2], [3.58, wingY(3.2), sd * 3.2], 0.022, 8)));
    const yp = wingY(6.6) - 0.05;
    parts.push(rod([2.6, yp, -6.6], [3.35, yp, -6.6], 0.014, 6), rod([2.7, yp + 0.06, -6.6], [2.75, yp - 0.005, -6.6], 0.02, 6));
    parts.push(rod([3.2, 1.25, 0], [3.14, 1.74, 0], 0.018, 6));
    parts.push(rod([3.14, 1.72, 0], [-4.9, 2.75, 0], 0.004, 5));
    // нижняя установка («жало»): .30 Browning назад-вниз из ступени
    parts.push(rod([-2.45, -0.8, 0], [-3.2, -0.92, 0], 0.024, 8), rod([-2.5, -0.81, 0], [-2.85, -0.865, 0], 0.04, 8));
    // посадочный гак под хвостом (убран)
    const yA = fusBotY(-4.72) - 0.03, yB = fusBotY(-5.28) - 0.03;
    parts.push(rod([-4.72, yA, 0], [-5.28, yB, 0], 0.028, 8), rod([-5.26, yB, 0], [-5.34, yB - 0.07, 0], 0.03, 8));
    mesh(merge(parts.map((g) => setUV(g, 0.5, 0.5))), M.metal, 'Fittings_Metal', air);
  }

  // ======================= ШАССИ (неподвижное, выпущено)
  const sinP = Math.sin(PITCH), cosP = Math.cos(PITCH);
  const yGround = MG.x * sinP + MG.y * cosP - MG.r;
  const yTail = (yGround + TW.r - TW.x * sinP) / cosP; // ось хвостового колеса
  const gearG = group('Landing_Gear', root);
  {
    const white = [], oleo = [], tires = [];
    const tire = latheLoop([[0.27, -0.1], [0.33, -0.12], [0.39, -0.115], [0.425, -0.08], [MG.r, 0], [0.425, 0.08], [0.39, 0.115], [0.33, 0.12], [0.27, 0.1], [0.255, 0]], 32).rotateX(Math.PI / 2);
    const hub = lathe([[0, -0.105], [0.2, -0.105], [0.26, -0.09], [0.28, 0], [0.26, 0.09], [0.2, 0.105], [0, 0.105]], 24).rotateX(Math.PI / 2);
    [1, -1].forEach((sd) => {
      const zl = sd * MG.zl, zw = sd * MG.zw;
      white.push(rod([2.0, -0.78, zl], [1.93, -1.36, zl], 0.075, 10));
      oleo.push(rod([1.94, -1.3, zl], [MG.x, MG.y, zl], 0.05, 10));
      white.push(rod([MG.x, MG.y, sd * (MG.zl + 0.05)], [MG.x, MG.y, zw], 0.045, 8));
      white.push(rod([1.95, -1.22, zl], [2.9, -0.79, sd * 2.0], 0.03, 8));
      white.push(box(1.97, -1.12, sd * 2.145, 0.36, 0.52, 0.022));
      tires.push(tire.clone().translate(MG.x, MG.y, zw));
      white.push(hub.clone().translate(MG.x, MG.y, zw));
    });
    // хвостовое колесо: вилка-стойка сбоку
    const yb = fusBotY(-4.4);
    white.push(rod([-4.4, yb + 0.06, 0.095], [TW.x, yTail, 0.095], 0.032, 8), rod([TW.x, yTail, 0.12], [TW.x, yTail, 0], 0.025, 8));
    const ttire = latheLoop([[0.12, -0.05], [0.16, -0.055], [TW.r, -0.03], [TW.r, 0.03], [0.16, 0.055], [0.12, 0.05], [0.11, 0]], 24).rotateX(Math.PI / 2);
    tires.push(ttire.translate(TW.x, yTail, 0));
    white.push(lathe([[0, -0.055], [0.12, -0.055], [0.13, 0], [0.12, 0.055], [0, 0.055]], 16).rotateX(Math.PI / 2).translate(TW.x, yTail, 0));
    mesh(merge(white.map((g) => setUV(g, 0.5, 0.5))), M.gear, 'Gear_Legs', gearG);
    mesh(merge(oleo.map((g) => setUV(g, 0.5, 0.5))), M.metal, 'Gear_Oleos', gearG);
    mesh(merge(tires.map((g) => setUV(g, 0.5, 0.5))), M.tire, 'Wheels', gearG);
  }

  // ======================= РУЛИ (группы с началом на оси шарнира, поворот 0)
  const ctl = group('Control_Surfaces', root);
  {
    [1, -1].forEach((sd) => {
      const n = sd > 0 ? 'R' : 'L';
      const am = (WG.a0 + WG.a1) / 2;
      const H = W([ailX(am), wingY(am), sd * am]);
      const g = group(`Aileron_${n}`, ctl, H);
      mesh(buildAileron(sd), M.paint, `Aileron_${n}_Surface`, g, H);
      const p0 = W([ailX(WG.a0), wingY(WG.a0), sd * WG.a0]), p1 = W([ailX(WG.a1), wingY(WG.a1), sd * WG.a1]);
      axes[g.name] = p1.sub(p0).normalize();
      const em = (TP.e0 + TP.e1) / 2;
      const HE = W([TP.xh, TP.y, sd * em]);
      const e = group(`Elevator_${n}`, ctl, HE);
      mesh(buildElevator(sd), M.paint, `Elevator_${n}_Surface`, e, HE);
      axes[e.name] = V3(0, 0, sd);
    });
    const HR = W([FIN.xh, 1.5, 0]);
    const rud = group('Rudder', ctl, HR);
    mesh(buildRudder(), M.paint, 'Rudder_Surface', rud, HR);
    axes.Rudder = axis([0, 1, 0]);
  }

  // ======================= СТВОРКИ БОМБООТСЕКА (ось — линия петель вдоль фюзеляжа)
  const bay = group('Bomb_Bay', root);
  [1, -1].forEach((sd) => {
    const n = sd > 0 ? 'R' : 'L';
    const H = W([(BAY.x0 + BAY.x1) / 2, fusBotY(0, BAY.zh), sd * BAY.zh]);
    const g = group(`Bomb_Bay_Door_${n}`, bay, H);
    mesh(buildBayDoor(sd), M.paint, `Bomb_Bay_Door_${n}_Panel`, g, H);
    axes[g.name] = axis([1, 0, 0]);
  });

  // ======================= ТУРЕЛЬ, СДВИЖНОЙ ФОНАРЬ ЛЁТЧИКА
  {
    const H = W([TUR.x, TUR.y, 0]);
    const g = group('Turret_Ball', root, H);
    mesh(buildTurret().translate(TUR.x, TUR.y, 0), M.glass, 'Turret_Ball_Body', g, H);
    axes.Turret_Ball = axis([0, 1, 0]);
    const HS = W([3.07, 0.7, 0]);
    const s = group('Canopy_Slide', root, HS);
    mesh(canopyShell(3.07, 2.03, 6, CAN.grow), M.glass, 'Canopy_Slide_Glass', s, HS);
    axes.Canopy_Slide = axis([1, 0, 0]);
  }

  // ======================= ВИНТ Hamilton Standard Ø 3.99 м, с коком (ось вала)
  let prop;
  {
    const blade = bladeGeometry({ r0: 0.16, r1: PROP.r, chord0: 0.22, chord1: 0.3, pitch: 3.6, tc: 0.1 });
    const bl = [0, 1, 2].map((i) => blade.clone().rotateX((i * 2 * Math.PI) / 3));
    const hub = setUV(latheX([[0.26, -0.21], [0.275, -0.05], [0.255, 0.08], [0.2, 0.18], [0.11, 0.26], [0, 0.29]], 20, { bottom: true }), 0.75, 0.5);
    const H = W([PROP.x, 0, 0]);
    prop = group('Propeller', root, H);
    mesh(merge([...bl, hub]).translate(PROP.x, 0, 0), M.prop, 'Propeller_Blades', prop, H);
    axes.Propeller = axis([1, 0, 0]);
  }

  // Анимация: винт, 1 оборот за 0.5 с, 9 ключей (через 45°), ось вала
  {
    const T = 0.5, n = 8, times = [], vals = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i <= n; i++) {
      times.push((T * i) / n);
      q.setFromAxisAngle(axes.Propeller, (-2 * Math.PI * i) / n);
      vals.push(q.x, q.y, q.z, q.w);
    }
    root.animations = [new THREE.AnimationClip('Propeller_Spin', T, [new THREE.QuaternionKeyframeTrack('Propeller.quaternion', times, vals)])];
  }

  const find = (n) => root.getObjectByName(n);
  root.userData.axes = axes;
  root.userData.update = (t = 0) => {
    prop.quaternion.setFromAxisAngle(axes.Propeller, -4 * Math.PI * t);
  };
  root.userData.pose = (k = 0) => {
    const rot = (n, a) => find(n).quaternion.setFromAxisAngle(axes[n], a * k);
    rot('Aileron_R', 0.4);
    rot('Aileron_L', 0.4);
    rot('Elevator_R', 0.4);
    rot('Elevator_L', -0.4);
    rot('Rudder', 0.45);
    rot('Bomb_Bay_Door_R', -1.4);
    rot('Bomb_Bay_Door_L', 1.4);
    rot('Turret_Ball', 1.2);
    const s = find('Canopy_Slide');
    s.userData.p0 ??= s.position.clone();
    s.position.copy(s.userData.p0).addScaledVector(axes.Canopy_Slide, -0.95 * k);
  };
  return root;
}
