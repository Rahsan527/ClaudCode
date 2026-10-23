import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Подводный минный заградитель типа Л «Ленинец», серия II (Л-7…Л-12, обобщённый, без номера и надписей).
// Только внешний вид. Метры, Y вверх, нос в +X, правый борт +Z.
// В генераторе y = 0 — ватерлиния в надводном положении, киль на y = −3.96 (осадка);
// сборка (finalize_model.py) ставит киль на Y = 0, ватерлиния оказывается на высоте 3.96 м.
// Двухкорпусная лодка с седловидными цистернами и высокой надстройкой: корпус — лофт по шпангоутам
// (суперэллипс корпуса + надстройка с палубой), рубка — лофт горизонтальных сечений с открытым мостиком.
// Мины ПЛ-100 (20 шт.) — в двух кормовых минных трубах, выход через кормовые крышки Mine_Door_L/R.

export const MODEL_NAME = 'Submarine_L_Leninets_II';

const XB = 40.55; // верх форштевня
const XS = -39.6; // транец (выход минных труб)
const LEN = XB - XS;
const DRAFT = 3.96;
const REPEAT = 8; // повтор текстуры обшивки по длине (≈10 м на повтор)

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = THREE.MathUtils.lerp;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА (поперечное сечение как функция x)

const sternT = (x) => smooth((-22 - x) / (-22 - XS));
const yT = (x) => 2.0 + 0.55 * smooth((x - 22) / (XB - 22)) - 0.45 * smooth((-24 - x) / (-24 - XS));
function dw(x) {
  if (x > 24) {
    const u = clamp01((x - 24) / (XB - 24));
    return 0.1 + 1.4 * Math.sqrt(Math.max(0, 1 - u * u));
  }
  return 1.5 - 0.45 * smooth((-24 - x) / (-24 - XS));
}
function hw(x) {
  if (x > 16) {
    const u = clamp01((x - 16) / (XB - 16));
    return Math.max(0.1, 3.6 * Math.max(0, 1 - u ** 2.1) ** 0.55);
  }
  if (x < -14) return 1.3 + 2.3 * (1 - smooth((-14 - x) / (-14 - XS)));
  return 3.6;
}
function yB(x) {
  if (x > 28) {
    const u = clamp01((x - 28) / (XB - 28));
    return -DRAFT + (yT(XB) - 0.3 + DRAFT) * u ** 2.3;
  }
  if (x < -22) return -DRAFT + 3.08 * sternT(x);
  return -DRAFT;
}
function section(x) {
  const t = yT(x);
  const b = yB(x);
  const yM = Math.max(-0.6 + 0.4 * sternT(x), b + 0.55 * (t - b));
  const yK = Math.max(t - 1.05, yM + 0.3 * (t - yM));
  const hU = t - yM + 0.15;
  const nD = 2.1 - 0.75 * smooth((x - 22) / (XB - 22)) - 0.35 * sternT(x);
  return { yT: t, yB: b, yM, yK, hU, hD: yM - b, w: hw(x), dw: dw(x), nU: 2.3, nD };
}
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Правая половина шпангоута: от ДП палубы вниз до киля. Возвращает точки [z, y, v].
const N_A = 6;
const N_B = 9;
function halfSection(x) {
  const s = section(x);
  const pts = [];
  const d = s.dw;
  pts.push([0, s.yT, 1.0], [0.35 * d, s.yT - 0.012, 0.95], [0.7 * d, s.yT - 0.03, 0.9], [0.93 * d, s.yT - 0.05, 0.86]);
  pts.push([d, s.yT - 0.12, 0.82]);
  const wk = s.w * Math.max(0, 1 - Math.abs((s.yK - s.yM) / s.hU) ** s.nU) ** (1 / s.nU);
  pts.push([lerp(d, wk, 0.5) + 0.04, lerp(s.yT - 0.12, s.yK, 0.5), 0.75]);
  pts.push([wk, s.yK, 0.68]);
  // плотная полилиния корпуса от скулы надстройки до киля
  const phiK = Math.asin(Math.min(1, ((s.yK - s.yM) / s.hU)) ** (s.nU / 2));
  const dense = [];
  const M = 240;
  for (let i = 0; i <= M; i++) {
    const phi = lerp(phiK, -Math.PI / 2, i / M);
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const up = sn >= 0;
    const n = up ? s.nU : s.nD;
    const y = s.yM + (up ? s.hU : s.hD) * spow(sn, 2 / n);
    const z = i === M ? 0 : s.w * Math.abs(c) ** (2 / n);
    dense.push([z, y]);
  }
  const acc = [0];
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = acc[acc.length - 1];
  const at = (len) => {
    let i = 1;
    while (i < acc.length - 1 && acc[i] < len) i++;
    const f = (len - acc[i - 1]) / Math.max(1e-9, acc[i] - acc[i - 1]);
    return [lerp(dense[i - 1][0], dense[i][0], f), lerp(dense[i - 1][1], dense[i][1], f)];
  };
  let split;
  let vSplit;
  let vKeel;
  if (s.yB < -0.05 && s.yK > 0.05) {
    let i = 1;
    while (i < dense.length && dense[i][1] > 0) i++;
    const f = dense[i - 1][1] / (dense[i - 1][1] - dense[i][1]);
    split = lerp(acc[i - 1], acc[i], f);
    vSplit = 0.42;
    vKeel = 0;
  } else {
    split = total * 0.6;
    vSplit = 0.5;
    vKeel = 0.44;
  }
  for (let k = 1; k <= N_A; k++) {
    const [z, y] = at((split * k) / N_A);
    pts.push([z, y, lerp(0.68, vSplit, k / N_A)]);
  }
  for (let k = 1; k <= N_B; k++) {
    const f = k / N_B;
    const [z, y] = at(split + (total - split) * (1 - (1 - f) ** 1.15));
    pts.push([k === N_B ? 0 : z, y, lerp(vSplit, vKeel, f)]);
  }
  return pts;
}

// Половина ширины корпуса (правый борт) на высоте y
export function hullZ(x, y) {
  const h = halfSection(x);
  for (let i = 1; i < h.length; i++) {
    const [z0, y0] = h[i - 1];
    const [z1, y1] = h[i];
    if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return lerp(z0, z1, (y0 - y) / (y0 - y1));
  }
  return 0;
}
const deckY = (x, z) => {
  const s = section(x);
  return s.yT - 0.05 * Math.min(1, Math.abs(z) / (0.93 * s.dw)) ** 2;
};
const uOf = (x) => clamp01((x - XS) / LEN);

// ---------------------------------------------------------------------------
// ГЕОМЕТРИЧЕСКИЕ ПОМОЩНИКИ

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
  strip(A, B, closed = true) {
    const n = A.length;
    for (let j = 0; j < (closed ? n : n - 1); j++) {
      const k = (j + 1) % n;
      this.quad(A[j], B[j], B[k], A[k]);
    }
  }
  fan(points, uvFn) {
    const c = new THREE.Vector3();
    points.forEach((p) => c.add(p));
    c.divideScalar(points.length);
    const ci = this.v(c, ...uvFn(c));
    const ids = points.map((p) => this.v(p, ...uvFn(p)));
    for (let j = 0; j < ids.length; j++) this.tri(ci, ids[j], ids[(j + 1) % ids.length]);
  }
  build({ orient = true, boxUV = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (orient && signedVolume(this.pos, this.idx) < 0) {
      for (let i = 0; i < this.idx.length; i += 3) [this.idx[i + 1], this.idx[i + 2]] = [this.idx[i + 2], this.idx[i + 1]];
    }
    g.setIndex(this.idx);
    if (boxUV) setBoxUV(g);
    g.computeVertexNormals();
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
// UV одноцветных деталей: проекция по габариту в 0…1
function setBoxUV(g) {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const size = new THREE.Vector3().subVectors(max, min);
  const ax = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const c = [p.getX(i), p.getY(i), p.getZ(i)];
    for (let k = 0; k < 2; k++) {
      const a = ax[k];
      const span = size.getComponent(a) || 1;
      uv[i * 2 + k] = clamp01((c[a] - min.getComponent(a)) / span);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Подготовка к склейке: индексы, только position/normal/uv, UV в 0…1
function prep(g, { boxUV = true } = {}) {
  let r = g;
  for (const k of Object.keys(r.attributes)) if (!['position', 'normal', 'uv'].includes(k)) r.deleteAttribute(k);
  if (boxUV || !r.attributes.uv) setBoxUV(r);
  if (!r.index) r = mergeVertices(r);
  if (!r.attributes.normal) r.computeVertexNormals();
  return r;
}
const merge = (list) => mergeGeometries(list.map((g) => prep(g, { boxUV: false })), false);

// Лофт замкнутых колец с крышками
function loftRings(rings, { capStart = true, capEnd = true, orient = true } = {}) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p)));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1]);
  if (capStart) m.fan(rings[0], () => [0, 0]);
  if (capEnd) m.fan(rings[rings.length - 1], () => [0, 0]);
  return m.build({ orient, boxUV: true });
}
// Тело вращения вокруг оси X по профилю [[x, r], …] (r = 0 на концах — закрытое)
function revolveX(profile, segs = 24) {
  const m = new Mesher();
  const rows = profile.map(([x, r]) => {
    if (r <= 1e-6) return [m.v(V(x, 0, 0))];
    const row = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      row.push(m.v(V(x, r * Math.sin(a), r * Math.cos(a))));
    }
    return row;
  });
  for (let k = 0; k < rows.length - 1; k++) {
    const A = rows[k];
    const B = rows[k + 1];
    if (A.length === 1 && B.length === 1) continue;
    if (A.length === 1) for (let j = 0; j < segs; j++) m.tri(A[0], B[(j + 1) % segs], B[j]);
    else if (B.length === 1) for (let j = 0; j < segs; j++) m.tri(A[j], A[(j + 1) % segs], B[0]);
    else m.strip(A, B);
  }
  return m.build({ boxUV: true });
}
// Цилиндр между двумя точками (r0 у a, r1 у b), с торцами
function rod(a, b, r0, r1 = r0, segs = 10, caps = true) {
  const len = a.distanceTo(b);
  const prof = [];
  if (caps) prof.push([0, 0]);
  prof.push([0, r0], [len, r1]);
  if (caps) prof.push([len, 0]);
  const g = revolveX(prof, segs);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir));
  g.translate(a.x, a.y, a.z);
  return g;
}
// Труба по сплайну (закрытые торцы)
function tube(points, r, segs = 8, steps = 24) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(steps, false);
  const m = new Mesher();
  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const p = curve.getPointAt(i / steps);
    const ring = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      ring.push(p.clone().addScaledVector(frames.normals[i], r * Math.cos(a)).addScaledVector(frames.binormals[i], r * Math.sin(a)));
    }
    rings.push(ring);
  }
  return loftRings(rings);
}
// Коробка с центром c и размерами (не повёрнутая)
function box(c, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(c.x, c.y, c.z);
  return prep(g);
}
function cyl(c, r0, r1, h, segs = 16, axis = 'y') {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(c.x, c.y, c.z);
  return prep(g);
}
// Плоский многоугольник в плоскости XY, выдавленный по Z (толщина t, центр z0)
function plate(poly, t, z0 = 0) {
  const shape = poly.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(shape)) shape.reverse();
  const faces = THREE.ShapeUtils.triangulateShape(shape, []);
  const m = new Mesher();
  const n = shape.length;
  const front = shape.map((p) => m.v(V(p.x, p.y, z0 + t / 2)));
  const back = shape.map((p) => m.v(V(p.x, p.y, z0 - t / 2)));
  for (const [a, b, c] of faces) {
    m.tri(front[a], front[b], front[c]);
    m.tri(back[a], back[c], back[b]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = m.v(V(shape[i].x, shape[i].y, z0 + t / 2));
    const b = m.v(V(shape[j].x, shape[j].y, z0 + t / 2));
    const c = m.v(V(shape[j].x, shape[j].y, z0 - t / 2));
    const d = m.v(V(shape[i].x, shape[i].y, z0 - t / 2));
    m.quad(a, d, c, b);
  }
  return m.build({ boxUV: true });
}

// Толщина симметричного профиля NACA 00xx
const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
// Перо: хорда вдоль X (передняя кромка le → задняя te), размах s ∈ [0,1] → точка через map(x, thick, s)
function foil({ le, te, tc = 0.12, nS = 6, nC = 10, map }) {
  const rings = [];
  for (let k = 0; k <= nS; k++) {
    const s = k / nS;
    const L = le(s);
    const T = te(s);
    const ch = L - T;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= nC; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nC));
    for (const t of ts) ring.push(map(L - t * ch, Math.max(0.006, naca(t) * tc * ch * 0.5), s));
    for (let j = nC - 1; j >= 1; j--) ring.push(map(L - ts[j] * ch, -Math.max(0.006, naca(ts[j]) * tc * ch * 0.5), s));
    rings.push(ring);
  }
  return loftRings(rings);
}

// Лопасть гребного винта: ось вращения X, лопасть вдоль +Y; hand = ±1 — направление шага
function propBlade({ r0, R, chord, pitch, hand, tc = 0.1, skew = 0.12, n = 8, m = 12 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    const r = lerp(r0, R, f);
    const c = chord * (0.75 + 0.55 * Math.sin(Math.PI * Math.min(1, f * 0.85))) * Math.sqrt(Math.max(0.04, 1 - f ** 4));
    const beta = Math.atan(pitch / (2 * Math.PI * r));
    const ec = V(hand * Math.sin(beta), 0, Math.cos(beta));
    const et = V(Math.cos(beta), 0, -hand * Math.sin(beta));
    const th = tc * chord * (1 - 0.8 * f);
    const ring = [];
    const off = skew * f * f;
    for (let j = 0; j < m; j++) {
      const a = (j / m) * Math.PI * 2;
      const s = (c / 2) * Math.cos(a) + off;
      const t = (th / 2) * Math.sin(a) * (0.6 + 0.4 * Math.cos(a) ** 2);
      ring.push(V(0, r, 0).addScaledVector(ec, s).addScaledVector(et, t));
    }
    rings.push(ring);
  }
  return loftRings(rings);
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ ОБШИВКИ (одна плитка ≈ 10 м по длине; по вертикали — обвод от киля до ДП палубы)

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
// Рисуем «карту высот» и цвет в одних координатах: u — по длине, v — по обводу (v=1 вверху холста)
function hullTextures() {
  const W = 2048;
  const H = 2048;
  const tileM = LEN / REPEAT; // метров на плитку
  const pxPerM = W / tileM;
  const col = makeCanvas(W, H);
  const c = col.getContext('2d');
  const vy = (v) => (1 - v) * H; // v → y на холсте
  // базовые зоны
  const band = (v0, v1, color) => {
    c.fillStyle = color;
    c.fillRect(0, vy(v1), W, vy(v0) - vy(v1));
  };
  band(0, 0.42, '#2b2e30');
  band(0.42, 0.68, '#7a8186');
  band(0.68, 0.82, '#7f868b');
  band(0.82, 1.0, '#5f6468');
  // мягкая неровность окраски
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 20 + rnd() * 90;
    c.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.015 + rnd() * 0.02})`;
    c.beginPath();
    c.ellipse(x, y, r * 2, r, 0, 0, Math.PI * 2);
    c.fill();
  }
  // подтёки ржавчины/соли под шпигатами надстройки
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W;
    const g = c.createLinearGradient(0, vy(0.72), 0, vy(0.5));
    g.addColorStop(0, 'rgba(70,55,45,0.18)');
    g.addColorStop(1, 'rgba(70,55,45,0)');
    c.fillStyle = g;
    c.fillRect(x, vy(0.72), 4 + rnd() * 8, vy(0.5) - vy(0.72));
  }
  // ватерлиния: узкая светлая полоса налёта
  c.fillStyle = 'rgba(120,125,120,0.35)';
  c.fillRect(0, vy(0.43), W, vy(0.415) - vy(0.43));

  // карта высот для нормалей (1024²)
  const NW = 1024;
  const hgt = makeCanvas(NW, NW);
  const h = hgt.getContext('2d');
  h.fillStyle = '#808080';
  h.fillRect(0, 0, NW, NW);
  const k = NW / W;
  // линии швов: поперечные (стыки листов каждые ~2.5 м) и продольные (пояса обшивки)
  const seamsU = [];
  for (let x = 0; x < tileM; x += tileM / 4) seamsU.push(x * pxPerM);
  const seamsV = [0.1, 0.22, 0.34, 0.5, 0.6, 0.75];
  const drawSeams = (ctx, s, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * s;
    for (const x of seamsU) {
      ctx.beginPath();
      ctx.moveTo(x * s + 1, vy(0) * s);
      ctx.lineTo(x * s + 1, vy(0.82) * s);
      ctx.stroke();
    }
    for (const v of seamsV) {
      ctx.beginPath();
      ctx.moveTo(0, vy(v) * s);
      ctx.lineTo(W * s, vy(v) * s);
      ctx.stroke();
    }
  };
  drawSeams(c, 1, 'rgba(0,0,0,0.22)', 3);
  drawSeams(h, k, '#5a5a5a', 3);
  // заклёпочные ряды вдоль швов
  const rivets = (ctx, s, color, r) => {
    ctx.fillStyle = color;
    for (const x of seamsU) for (let y = vy(0.82); y < vy(0); y += 14) {
      ctx.beginPath();
      ctx.arc((x + 9) * s, y * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const v of seamsV) for (let x = 0; x < W; x += 14) {
      ctx.beginPath();
      ctx.arc(x * s, (vy(v) + 9) * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  rivets(h, k, '#9a9a9a', 3);
  rivets(c, 1, 'rgba(255,255,255,0.06)', 3);
  // шпигаты (лимберы) в борту надстройки: ряд продолговатых отверстий
  const slot = (ctx, s, x, y, w, hh, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x * s, y * s, w * s, hh * s, (hh / 2) * s);
    ctx.fill();
  };
  const slotW = 0.42 * pxPerM;
  const slotH = 0.16 * pxPerM;
  for (let x = 0.2 * pxPerM; x < W - slotW; x += 0.75 * pxPerM) {
    slot(c, 1, x, vy(0.705), slotW, slotH, '#121416');
    slot(h, k, x, vy(0.705), slotW, slotH, '#202020');
  }
  // кингстоны/шпигаты цистерн внизу (тёмное на тёмном)
  for (let x = 0.4 * pxPerM; x < W - slotW; x += 1.25 * pxPerM) {
    slot(c, 1, x, vy(0.16), slotW * 0.8, slotH * 0.9, '#141618');
    slot(h, k, x, vy(0.16), slotW * 0.8, slotH * 0.9, '#303030');
  }
  // палуба: продольные рейки настила с просветами
  for (let v = 0.83; v < 1.0; v += 0.0105) {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, vy(v) - 2, W, 4);
    h.fillStyle = '#404040';
    h.fillRect(0, (vy(v) - 2) * k, NW, 4 * k);
  }
  for (let x = 0; x < W; x += 0.62 * pxPerM) {
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(x, vy(1), 3, vy(0.83) - vy(1));
  }

  // высоты → нормали
  const src = h.getImageData(0, 0, NW, NW).data;
  const nrm = makeCanvas(NW, NW);
  const nc = nrm.getContext('2d');
  const out = nc.createImageData(NW, NW);
  const H_ = (x, y) => src[(((y + NW) % NW) * NW + ((x + NW) % NW)) * 4] / 255;
  const strength = 3.0;
  for (let y = 0; y < NW; y++) {
    for (let x = 0; x < NW; x++) {
      const dx = (H_(x + 1, y) - H_(x - 1, y)) * strength;
      const dy = (H_(x, y - 1) - H_(x, y + 1)) * strength; // +v — вверх по холсту
      const l = Math.hypot(dx, dy, 1);
      const i = (y * NW + x) * 4;
      out.data[i] = Math.round((-dx / l) * 127.5 + 127.5);
      out.data[i + 1] = Math.round((-dy / l) * 127.5 + 127.5);
      out.data[i + 2] = Math.round((1 / l) * 127.5 + 127.5);
      out.data[i + 3] = 255;
    }
  }
  nc.putImageData(out, 0, 0);

  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  const normalMap = new THREE.CanvasTexture(nrm);
  for (const t of [map, normalMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(REPEAT, 1);
    t.anisotropy = 8;
  }
  map.name = 'Hull_Paint_Color';
  normalMap.name = 'Hull_Paint_Normal';
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// МОДЕЛЬ

export function createLeninets2() {
  const tex = hullTextures();
  const M = {
    hull: new THREE.MeshStandardMaterial({ name: 'Hull_Paint', map: tex.map, normalMap: tex.normalMap, roughness: 0.72, metalness: 0.15 }),
    grey: new THREE.MeshStandardMaterial({ name: 'Steel_Grey', color: 0x767d82, roughness: 0.62, metalness: 0.3 }),
    black: new THREE.MeshStandardMaterial({ name: 'Hull_Black', color: 0x2a2d2f, roughness: 0.7, metalness: 0.2 }),
    gun: new THREE.MeshStandardMaterial({ name: 'Gun_Metal', color: 0x5b6266, roughness: 0.5, metalness: 0.55 }),
    bronze: new THREE.MeshStandardMaterial({ name: 'Propeller_Bronze', color: 0xa77a42, roughness: 0.32, metalness: 1.0 }),
  };

  const root = new THREE.Group();
  root.name = MODEL_NAME;
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

  // =========================================================================
  // КОРПУС
  const hullG = group('Hull');
  {
    const xs = [];
    for (let x = XS; x < XS + 8; x += 0.3) xs.push(x);
    for (let x = XS + 8; x < XB - 9; x += 0.8) xs.push(x);
    for (let x = XB - 9; x < XB - 0.001; x += 0.25) xs.push(x);
    xs.push(XB);
    const m = new Mesher();
    const rings = [];
    const ringPts = [];
    for (const x of xs) {
      const h = halfSection(x);
      const full = [...h, ...h.slice(1, -1).reverse().map(([z, y, v]) => [-z, y, v])];
      const u = uOf(x);
      ringPts.push(full.map(([z, y]) => V(x, y, z)));
      rings.push(full.map(([z, y, v]) => m.v(V(x, y, z), u, v)));
    }
    for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
    const capUV = (p) => [uOf(p.x), p.y < 0 ? 0.2 : 0.55];
    m.fan(ringPts[0], capUV);
    m.fan(ringPts[ringPts.length - 1], capUV);
    mesh(m.build(), M.hull, 'Hull_Outer', hullG);
  }

  // =========================================================================
  // РУБКА: ограждение с открытым мостиком, кормовая площадка 45-мм орудия, тумба перископов
  const TF = 5.6;
  const TA = -8.2;
  const TW = 1.42;
  const TXM = 0.2;
  const towerB = (x) => {
    if (x >= TXM) {
      const u = clamp01((x - TXM) / (TF - TXM));
      return TW * Math.max(0, 1 - u ** 2.0) ** 0.5;
    }
    const u = clamp01((TXM - x) / (TXM - TA));
    return TW * (1 - 0.35 * u * u) * Math.max(0, 1 - u ** 3.2) ** 0.45;
  };
  // контур в плане: правый борт от носа к корме, затем левый обратно; inset — отступ внутрь
  const NT = 30;
  const outline = (inset = 0, scale = 1) => {
    const pts = [];
    const xsOut = [];
    for (let j = 0; j <= NT; j++) xsOut.push(lerp(TF, TA, 0.5 - 0.5 * Math.cos((Math.PI * j) / NT)));
    const cx = (TF + TA) / 2;
    const raw = [];
    for (const x of xsOut) raw.push([x, towerB(x)]);
    for (let j = NT - 1; j >= 1; j--) raw.push([xsOut[j], -towerB(xsOut[j])]);
    for (let i = 0; i < raw.length; i++) {
      const [x, z] = raw[i];
      const [xa, za] = raw[(i - 1 + raw.length) % raw.length];
      const [xb, zb] = raw[(i + 1) % raw.length];
      // нормаль в плане (наружу)
      let nx = zb - za;
      let nz = -(xb - xa);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (nx * (x - cx) + nz * z < 0) { nx = -nx; nz = -nz; }
      pts.push([cx + (x - cx) * scale - nx * inset, z * scale - nz * inset]);
    }
    return pts;
  };
  const FLOOR = 3.65;
  const rimY = (x) => lerp(4.15, 4.62, smooth((x + 4.6) / 2.2));
  {
    const m = new Mesher();
    const uvT = (p, v) => [uOf(p.x), v];
    const levels = [[1.75, 1.0], [2.6, 0.995], [3.3, 0.985]];
    const rings = levels.map(([y, s]) => outline(0, s).map(([x, z]) => ({ p: V(x, y, z), v: lerp(0.45, 0.62, (y - 1.75) / 2.9) })));
    const top = outline(0, 0.975);
    rings.push(top.map(([x, z]) => ({ p: V(x, rimY(x) - 0.06, z), v: 0.64 })));
    rings.push(outline(0.035, 0.975).map(([x, z]) => ({ p: V(x, rimY(x), z), v: 0.66 })));
    const inner = outline(0.08, 0.975);
    rings.push(inner.map(([x, z]) => ({ p: V(x, rimY(x) - 0.03, z), v: 0.66 })));
    rings.push(inner.map(([x, z]) => ({ p: V(x, FLOOR, z), v: 0.58 })));
    const ids = rings.map((r) => r.map(({ p, v }) => m.v(p, ...uvT(p, v))));
    for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1]);
    // пол мостика — палубный настил
    m.fan(inner.map(([x, z]) => V(x, FLOOR, z)), (p) => [uOf(p.x), 0.9 + 0.05 * (p.z / TW)]);
    const fence = m.build();
    // ориентация: проверим по точке снаружи (нормаль у носа должна смотреть в +X)
    mesh(fence, M.hull, 'Tower_Fence', hullG);
  }
  // Тумба (ограждение) перископов на мостике
  const SCOPE_TOP = 5.12;
  const PX1 = 1.15;
  const PX2 = -0.55;
  {
    const sb = (x) => {
      const a = 2.05;
      const xm = 0.25;
      const u = clamp01(Math.abs(x - xm) / a);
      return 0.36 * Math.max(0, 1 - u ** 2.2) ** 0.5 * (x > xm ? 1 : 1 - 0.25 * u);
    };
    const ring = (y, s) => {
      const r = [];
      const n = 16;
      const xsS = [];
      for (let j = 0; j <= n; j++) xsS.push(lerp(2.3, -1.8, 0.5 - 0.5 * Math.cos((Math.PI * j) / n)));
      for (const x of xsS) r.push(V(x, y, sb(x) * s));
      for (let j = n - 1; j >= 1; j--) r.push(V(xsS[j], y, -sb(xsS[j]) * s));
      return r;
    };
    const m = new Mesher();
    const rings = [ring(FLOOR - 0.02, 1), ring(4.6, 0.97), ring(SCOPE_TOP, 0.9)];
    const ids = rings.map((r, k) => r.map((p) => m.v(p, uOf(p.x), [0.47, 0.55, 0.62][k])));
    for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1]);
    m.fan(rings[2], (p) => [uOf(p.x), 0.63]);
    mesh(m.build(), M.hull, 'Periscope_Standard', hullG);
  }

  // =========================================================================
  // НЕПОДВИЖНЫЕ ДЕТАЛИ ПАЛУБЫ И НАДСТРОЙКИ (одна сетка, Steel_Grey)
  const fit = [];
  // люки: торпедопогрузочный, носовой, кормовой, минный, рубочный (на полу мостика)
  for (const [x, r] of [[29.5, 0.42], [20.0, 0.36], [-14.5, 0.36], [-27.0, 0.42], [-31.5, 0.36]]) {
    const y = deckY(x, 0);
    fit.push(cyl(V(x, y + 0.05, 0), r + 0.03, r, 0.2, 20));
    fit.push(cyl(V(x, y + 0.18, 0), r + 0.06, r + 0.04, 0.06, 20));
    fit.push(box(V(x - r - 0.1, y + 0.17, 0), 0.12, 0.08, 0.3));
  }
  fit.push(cyl(V(-3.4, FLOOR + 0.08, 0), 0.4, 0.38, 0.2, 20));
  fit.push(cyl(V(-3.4, FLOOR + 0.2, 0), 0.44, 0.44, 0.05, 20));
  // кнехты: по паре в нос и корму с каждого борта
  for (const x of [33.5, 24.5, -24.0, -33.0]) for (const s of [1, -1]) {
    const z = s * Math.min(1.15, dw(x) * 0.78);
    const y = deckY(x, z);
    for (const dx of [-0.25, 0.25]) {
      fit.push(cyl(V(x + dx, y + 0.16, z), 0.11, 0.1, 0.4, 12));
      fit.push(cyl(V(x + dx, y + 0.37, z), 0.14, 0.14, 0.04, 12));
    }
    fit.push(box(V(x, y + 0.02, z), 0.9, 0.12, 0.34));
  }
  // шпиль
  fit.push(cyl(V(36.2, deckY(36.2, 0) + 0.15, 0), 0.28, 0.24, 0.36, 18));
  fit.push(cyl(V(36.2, deckY(36.2, 0) + 0.35, 0), 0.3, 0.3, 0.06, 18));
  // сетепрорезатель на форштевне (пила)
  {
    const yb = yT(XB);
    const poly = [
      [36.6, yb - 0.25], [XB - 0.15, yb - 0.25], [XB + 0.25, yb + 0.25], [XB - 0.05, yb + 0.3],
      [XB + 0.1, yb + 0.65], [XB - 0.25, yb + 0.68], [XB - 0.15, yb + 1.0], [XB - 0.55, yb + 1.0],
      [XB - 0.5, yb + 1.3], [XB - 1.0, yb + 1.45], [37.4, yb + 0.35],
    ];
    fit.push(plate(poly, 0.08));
  }
  // радиомачты на ограждении рубки и кормовая стойка антенны
  const MAST_F = V(TF - 0.8, 5.95, 0);
  const MAST_A = V(TA + 0.9, 5.7, 0);
  fit.push(rod(V(MAST_F.x, rimY(MAST_F.x) - 0.6, 0), MAST_F, 0.07, 0.04, 8));
  fit.push(rod(V(MAST_A.x, FLOOR - 0.05, 0), MAST_A, 0.07, 0.04, 8));
  const POST_S = V(-36.5, yT(-36.5) + 1.1, 0);
  fit.push(rod(V(POST_S.x, deckY(POST_S.x, 0) - 0.05, 0), POST_S, 0.06, 0.04, 8));
  // антенна-леер: сетепрорезатель → носовая мачта, кормовая мачта → кормовая стойка
  const CUT_TOP = V(XB - 0.95, yT(XB) + 1.4, 0);
  fit.push(rod(CUT_TOP, MAST_F, 0.018, 0.018, 6));
  fit.push(rod(MAST_A, POST_S, 0.018, 0.018, 6));
  // поручни мостика (кормовая площадка 45-мм)
  {
    const rail = [];
    const raw = outline(0.06, 0.975);
    for (const [x, z] of raw) if (x < -4.7) rail.push(V(x, rimY(x) + 0.55, z));
    rail.sort((a, b) => Math.atan2(a.z, a.x - TA - 2.5) - Math.atan2(b.z, b.x - TA - 2.5));
    for (let i = 0; i < rail.length - 1; i++) fit.push(rod(rail[i], rail[i + 1], 0.025, 0.025, 6));
    for (let i = 0; i < rail.length; i += 3) fit.push(rod(V(rail[i].x, rimY(rail[i].x) - 0.01, rail[i].z), rail[i], 0.022, 0.022, 6));
  }
  // носовые клюзы с якорями (якорь Холла, утоплен в клюз — показываем головку и лапы)
  for (const s of [1, -1]) {
    const x = 36.0;
    const y = 1.15;
    const z = hullZ(x, y);
    const g = [];
    g.push(box(V(0, 0, 0.11), 0.5, 0.75, 0.2));
    g.push(box(V(0, -0.38, 0.13), 0.8, 0.18, 0.24));
    g.push(box(V(-0.35, -0.3, 0.17), 0.14, 0.28, 0.14));
    g.push(box(V(0.35, -0.3, 0.17), 0.14, 0.28, 0.14));
    const a = merge(g);
    if (s < 0) { a.scale(1, 1, -1); flipIndex(a); }
    // повернуть вдоль борта (наклон обвода)
    const z2 = hullZ(x + 0.5, y);
    a.rotateY(-s * Math.atan2(z2 - z, 0.5));
    a.translate(x, y, s * (z - 0.06));
    fit.push(a);
  }
  mesh(merge(fit), M.grey, 'Deck_Fittings', hullG);

  // =========================================================================
  // ПОДВОДНАЯ ЧАСТЬ: кормовой дейдвуд (скег), валы, кронштейны, ограждения винтов,
  // крышки носовых торпедных аппаратов (Hull_Black)
  const PROP_X = -35.55;
  const PROP_Y = -2.05;
  const PROP_Z = 1.72;
  const PROP_R = 0.8;
  const RUD_X = -37.15;
  const under = [];
  {
    // скег от киля к пятке руля
    const poly = [];
    const x0 = -23.5;
    const x1 = RUD_X + 0.12;
    const yBot = (x) => lerp(-DRAFT, -3.12, smooth((x0 - x) / (x0 - x1)) ** 0.8);
    for (let k = 0; k <= 16; k++) {
      const x = lerp(x0, x1, k / 16);
      poly.push([x, Math.min(yBot(x), yB(x) - 0.02)]);
    }
    for (let k = 16; k >= 0; k--) {
      const x = lerp(x0, x1, k / 16);
      poly.push([x, yB(x) + 0.25]);
    }
    under.push(plate(poly, 0.2));
    // пятка (подпятник руля)
    under.push(box(V(RUD_X - 0.1, -3.14, 0), 0.5, 0.1, 0.2));
  }
  for (const s of [1, -1]) {
    const z = s * PROP_Z;
    // вал: от выхода из корпуса до ступицы
    const xin = -27.5;
    under.push(rod(V(xin, PROP_Y + 0.05 * (PROP_Y > 0 ? 1 : 1), z), V(PROP_X + 0.32, PROP_Y, z), 0.13, 0.11, 12));
    // мортира/выкружка вала
    under.push(rod(V(xin - 0.5, PROP_Y + 0.45, s * (PROP_Z - 0.35)), V(-31.2, PROP_Y + 0.02, z), 0.32, 0.18, 12));
    // кронштейн гребного вала: две стойки
    const bx = PROP_X + 1.05;
    const hub = V(bx, PROP_Y, z);
    under.push(cyl(hub, 0.2, 0.2, 0.55, 14, 'x'));
    const topY = yB(bx) + 0.15;
    under.push(rod(hub, V(bx, topY + 0.8, s * hullZ(bx, topY + 0.8) * 0.85), 0.07, 0.07, 8));
    under.push(rod(hub, V(bx, topY, s * 0.3), 0.07, 0.07, 8));
    // ограждение винта: дуга снаружи и снизу от винта
    const p0 = V(-31.0, -1.75, s * (hullZ(-31.0, -1.75) - 0.05));
    under.push(tube([
      p0,
      V(-33.2, -2.15, s * 2.62),
      V(-35.1, -2.35, s * 2.82),
      V(-36.4, -2.25, s * 2.7),
      V(-37.0, -1.6, s * 1.6),
      V(-37.35, -1.0, s * 0.62),
    ], 0.06, 8, 30));
    // крышки носовых торпедных аппаратов (по 3 на борт)
    for (const [x, y] of [[36.4, -0.45], [35.4, -1.35], [34.3, -2.25]]) {
      const zz = hullZ(x, y);
      const n = new THREE.Vector3(hullZ(x + 0.2, y) - hullZ(x - 0.2, y), hullZ(x, y + 0.2) - hullZ(x, y - 0.2), 0);
      // нормаль поверхности z = f(x, y): (-df/dx, -df/dy, 1) с учётом борта
      const nn = V(-n.x / 0.4, -n.y / 0.4, 1).normalize();
      const g = cyl(V(0, 0, 0), 0.33, 0.33, 0.05, 20, 'z');
      g.scale(1.25, 1, 1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), nn));
      g.translate(x + nn.x * 0.045, y + nn.y * 0.045, zz + nn.z * 0.045);
      if (s < 0) { g.scale(1, 1, -1); flipIndex(g); }
      under.push(g);
    }
  }
  mesh(merge(under), M.black, 'Hull_Underwater_Fittings', hullG);

  // =========================================================================
  // ВООРУЖЕНИЕ: 100-мм палубное орудие Б-24ПЛ перед рубкой и 45-мм 21-К на кормовой площадке мостика
  const arm = group('Armament');
  {
    const gx = 11.2;
    const gy = deckY(gx, 0);
    const pv = group('Deck_Gun_100mm', arm, gx, gy, 0);
    const p = [];
    const ty = 1.3; // ось цапф над палубой
    p.push(cyl(V(0, 0.05, 0), 0.62, 0.6, 0.14, 24)); // погон
    p.push(cyl(V(0, 0.48, 0), 0.42, 0.28, 0.72, 20)); // тумба
    p.push(box(V(0.05, ty - 0.12, 0), 0.9, 0.36, 0.62)); // вертлюг
    p.push(box(V(0.0, ty, 0.36), 0.7, 0.55, 0.08)); // щёки станка
    p.push(box(V(0.0, ty, -0.36), 0.7, 0.55, 0.08));
    p.push(cyl(V(0, ty, 0), 0.09, 0.09, 0.8, 12, 'z')); // цапфа
    p.push(box(V(-0.55, ty, 0), 0.75, 0.34, 0.34)); // казённик
    p.push(rod(V(-0.2, ty, 0), V(4.75, ty, 0), 0.105, 0.075, 16)); // ствол
    p.push(rod(V(4.75, ty, 0), V(4.95, ty, 0), 0.09, 0.09, 16)); // дульный утолщение
    p.push(rod(V(-0.6, ty + 0.2, 0), V(1.7, ty + 0.2, 0), 0.09, 0.09, 12)); // накатник
    p.push(rod(V(-0.6, ty - 0.2, 0), V(1.4, ty - 0.2, 0), 0.08, 0.08, 12)); // тормоз отката
    p.push(box(V(0.15, ty + 0.15, 0.48), 0.5, 0.22, 0.12)); // прицел
    p.push(box(V(-0.3, 0.75, 0.6), 0.45, 0.06, 0.32)); // площадки наводчиков
    p.push(box(V(-0.3, 0.75, -0.6), 0.45, 0.06, 0.32));
    p.push(rod(V(-0.3, 0.5, 0.42), V(-0.3, 0.73, 0.6), 0.03, 0.03, 6));
    p.push(rod(V(-0.3, 0.5, -0.42), V(-0.3, 0.73, -0.6), 0.03, 0.03, 6));
    mesh(merge(p), M.gun, 'Deck_Gun_100mm_Mount', pv);
  }
  {
    const gx = -6.3;
    const pv = group('Gun_45mm', arm, gx, FLOOR, 0);
    const p = [];
    const ty = 0.95;
    p.push(cyl(V(0, 0.04, 0), 0.36, 0.34, 0.1, 18));
    p.push(cyl(V(0, 0.42, 0), 0.2, 0.15, 0.7, 14));
    p.push(box(V(0, ty - 0.08, 0), 0.5, 0.22, 0.34));
    p.push(box(V(-0.2, ty, 0), 0.5, 0.2, 0.2));
    p.push(rod(V(-0.4, ty, 0), V(2.05, ty, 0), 0.05, 0.038, 12));
    p.push(rod(V(-0.3, ty + 0.11, 0), V(0.7, ty + 0.11, 0), 0.04, 0.04, 8));
    // щиток
    const sh = plate([[-0.5, -0.3], [0.5, -0.3], [0.5, 0.25], [0.15, 0.42], [-0.15, 0.42], [-0.5, 0.25]], 0.025);
    sh.rotateY(Math.PI / 2);
    sh.translate(0.28, ty + 0.05, 0);
    p.push(sh);
    p.push(box(V(-0.1, 0.6, 0.38), 0.3, 0.05, 0.26));
    p.push(box(V(-0.1, 0.6, -0.38), 0.3, 0.05, 0.26));
    mesh(merge(p), M.gun, 'Gun_45mm_Mount', pv);
  }

  // =========================================================================
  // ПЕРИСКОПЫ: выдвигаются по Y от верха тумбы
  const scopes = group('Periscopes');
  for (const [name, x, len, rHead] of [['Periscope_1', PX1, 0.85, 0.075], ['Periscope_2', PX2, 0.7, 0.1]]) {
    const pv = group(name, scopes, x, SCOPE_TOP, 0);
    const g = revolveX([[0, 0.11], [len - 0.25, 0.11], [len - 0.15, rHead + 0.02], [len, rHead], [len + 0.06, 0]], 14);
    g.rotateZ(Math.PI / 2);
    const win = box(V(0.09, len - 0.08, 0), 0.06, 0.07, 0.08);
    mesh(merge([g, win]), M.grey, `${name}_Tube`, pv);
  }

  // =========================================================================
  // РУЛИ: носовые горизонтальные (заваливающиеся), кормовые горизонтальные, вертикальный руль
  const ctrl = group('Control_Surfaces');
  {
    // Носовые горизонтальные рули: ось баллера вдоль Z, в 35 % хорды
    const x = 33.2;
    const y = 0.55;
    const zr = hullZ(x, y) - 0.04;
    for (const [nm, s] of [['Bow_Plane_R', 1], ['Bow_Plane_L', -1]]) {
      const pv = group(nm, ctrl, x, y, s * zr);
      const span = 1.75;
      const g = foil({
        le: (f) => 0.5 - 0.1 * f,
        te: (f) => -0.85 + 0.1 * f,
        tc: 0.13,
        map: (cx, t, f) => V(cx, t, s * span * f),
      });
      mesh(g, M.grey, `${nm}_Blade`, pv);
    }
  }
  {
    const x = -37.95;
    const y = -0.42;
    const zr = hullZ(x, y) - 0.04;
    for (const [nm, s] of [['Stern_Plane_R', 1], ['Stern_Plane_L', -1]]) {
      const pv = group(nm, ctrl, x, y, s * zr);
      const span = 1.75;
      const g = foil({
        le: (f) => 0.45 - 0.12 * f,
        te: (f) => -0.8 + 0.1 * f,
        tc: 0.13,
        map: (cx, t, f) => V(cx, t, s * span * f),
      });
      mesh(g, M.black, `${nm}_Blade`, pv);
    }
  }
  {
    const yTop = yB(RUD_X) - 0.06;
    const pv = group('Rudder', ctrl, RUD_X, yTop, 0);
    const h = yTop + 3.06;
    const g = foil({
      le: () => 0.12,
      te: (f) => -1.75 + 0.1 * f,
      tc: 0.15,
      nS: 4,
      map: (cx, t, f) => V(cx, -h * f, t),
    });
    const stock = cyl(V(0, 0.0, 0), 0.07, 0.07, 0.12, 10);
    mesh(merge([g, stock]), M.black, 'Rudder_Blade', pv);
  }

  // =========================================================================
  // ГРЕБНЫЕ ВИНТЫ (трёхлопастные, правого и левого вращения)
  const prop = group('Propulsion');
  const props = [];
  for (const [nm, s] of [['Propeller_R', 1], ['Propeller_L', -1]]) {
    const pv = group(nm, prop, PROP_X, PROP_Y, s * PROP_Z);
    const parts = [revolveX([[0.34, 0], [0.32, 0.15], [0.05, 0.19], [-0.25, 0.17], [-0.48, 0.09], [-0.56, 0]], 20)];
    const blade = propBlade({ r0: 0.12, R: PROP_R, chord: 0.5, pitch: 1.5, hand: s, tc: 0.12, skew: 0.08 });
    for (let b = 0; b < 3; b++) {
      const g = blade.clone();
      g.rotateX((b / 3) * Math.PI * 2 + 0.3);
      parts.push(g);
    }
    mesh(merge(parts), M.bronze, `${nm}_Blades`, pv);
    props.push({ pv, s });
  }

  // =========================================================================
  // КОРМОВЫЕ КРЫШКИ МИННЫХ ТРУБ (выход мин ПЛ-100), шарнир — вертикальная ось у наружной кромки
  const mines = group('Mine_Ports');
  {
    const yc = 0.12;
    const r = 0.42;
    const zc = 0.62;
    for (const [nm, s] of [['Mine_Door_R', 1], ['Mine_Door_L', -1]]) {
      const hz = s * (zc + r + 0.04);
      const pv = group(nm, mines, XS - 0.035, yc, hz);
      const disk = cyl(V(-0.03, 0, -s * (r + 0.04)), r, r, 0.06, 28, 'x');
      const hinge1 = cyl(V(-0.02, 0.22, 0), 0.04, 0.04, 0.14, 8);
      const hinge2 = cyl(V(-0.02, -0.22, 0), 0.04, 0.04, 0.14, 8);
      const arm1 = box(V(-0.06, 0.22, -s * 0.18), 0.04, 0.06, 0.36);
      const arm2 = box(V(-0.06, -0.22, -s * 0.18), 0.04, 0.06, 0.36);
      mesh(merge([disk, hinge1, hinge2, arm1, arm2]), M.black, `${nm}_Panel`, pv);
    }
  }

  // =========================================================================
  // АНИМАЦИЯ: оба винта, встречное вращение
  const period = 1.5;
  const steps = 8;
  const tracks = props.map(({ pv, s }) => {
    const times = [];
    const values = [];
    const q = new THREE.Quaternion();
    for (let k = 0; k <= steps; k++) {
      times.push((k / steps) * period);
      q.setFromAxisAngle(V(1, 0, 0), (s * 2 * Math.PI * k) / steps);
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${pv.name}.quaternion`, times, values);
  });
  root.animations = [new THREE.AnimationClip('Propellers_Spin', period, tracks)];
  root.userData.update = (t) => {
    for (const { pv, s } of props) pv.quaternion.setFromAxisAngle(V(1, 0, 0), (s * 2 * Math.PI * t) / period);
  };
  return root;
}

function flipIndex(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.index.needsUpdate = true;
  g.computeVertexNormals();
}
