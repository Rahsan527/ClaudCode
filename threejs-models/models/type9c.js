import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Немецкая подводная лодка типа IXC (Kriegsmarine), вид 1942 года: 10,5-см палубное орудие, «зимний сад» с 2-см Flak.
// Обобщённая лодка без бортового номера и эмблем. Масштаб 1:1 в метрах, Y вверх, нос +X, правый борт +Z.
// Киль на y = 0, конструктивная ватерлиния на y = 4.7 (осадка 4,7 м).
// Лёгкий корпус — лофт шпангоутов (суперэллипсы: «седловые» цистерны снизу, надстройка с плоской палубой сверху),
// рубка — лофт горизонтальных сечений одним замкнутым телом (наружная стенка, кромка, внутренняя стенка, пол мостика).
// Окраска, шпигаты, швы листов и крышки торпедных аппаратов — в текстуре-атласе, а не в сетке.

const XB = 38.38; // форштевень (верх)
const XS = -38.38; // корма (верх)
const LEN = XB - XS; // 76.76
const WL = 4.7; // ватерлиния
const BEAM = 3.38; // половина наибольшей ширины (6.76 м)

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = THREE.MathUtils.lerp;

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА

function deckY(x) {
  if (x > 14) return 6.25 + 0.9 * ((x - 14) / (XB - 14)) ** 2;
  if (x < -18) return 6.25 - 0.3 * ((-18 - x) / (-18 - XS)) ** 1.5;
  return 6.25;
}
function keelY(x) {
  let k = 0;
  if (x > 28) k = x < 34 ? 2 * ((x - 28) / 6) ** 3.4 : 2 + (x - 34) * 1.14;
  else if (x < -20) k = 3.7 * ((-20 - x) / (-20 - XS)) ** 1.6;
  return Math.min(k, deckY(x) - 0.16);
}
function section(x) {
  const yd = deckY(x);
  const kb = keelY(x);
  let B = BEAM;
  if (x > 8) B = BEAM * Math.max(0, 1 - ((x - 8) / (XB - 8)) ** 2.4) ** 0.55;
  else if (x < -12) B = BEAM * Math.max(0, 1 - ((-12 - x) / (-12 - XS)) ** 2.2) ** 0.62;
  let dw = 1.8;
  if (x > 10) dw = 1.8 * Math.max(0, 1 - ((x - 10) / (XB - 10)) ** 2.2) ** 0.7;
  else if (x < -14) dw = 1.8 * Math.max(0, 1 - ((-14 - x) / (-14 - XS)) ** 2) ** 0.8;
  dw = Math.max(0.04, dw);
  B = Math.max(B, dw + 0.03, 0.07);
  let yB = 3.55;
  if (x > 20) yB += 1.2 * ((x - 20) / (XB - 20)) ** 2;
  if (x < -15) yB += 1.3 * ((-15 - x) / (-15 - XS)) ** 1.5;
  const h = yd - kb;
  yB = Math.min(Math.max(yB, kb + 0.15 * h), yd - 0.25 * h);
  const kw = Math.min(0.22, 0.35 * B);
  // «седловые» цистерны IXC полнее (показатель больше); в носу сечение заостряется к V
  const nL = 2.5 - 0.9 * clamp01((x - 22) / 14);
  const nU = 2.2;
  const cam = 0.05 * (dw / 1.8);
  return { yd, kb, B, dw, yB, kw, nL, nU, cam };
}
const NL = 14;
const NU = 12;
const ND = 6;
// Правая половина шпангоута от киля к диаметральной плоскости палубы: [z, y]
function halfProfile(x) {
  const s = section(x);
  const pts = [[0, s.kb]];
  for (let i = 0; i <= NL; i++) {
    const a = (i / NL) * Math.PI / 2;
    pts.push([s.kw + (s.B - s.kw) * Math.sin(a) ** (2 / s.nL), s.yB - (s.yB - s.kb) * Math.cos(a) ** (2 / s.nL)]);
  }
  for (let j = 1; j <= NU; j++) {
    const a = (j / NU) * Math.PI / 2;
    pts.push([s.dw + (s.B - s.dw) * Math.cos(a) ** (2 / s.nU), s.yB + (s.yd - s.yB) * Math.sin(a) ** (2 / s.nU)]);
  }
  return { s, pts }; // последний — кромка палубы (dw, yd)
}
// Полуширина корпуса на высоте y
export function hullZ(x, y) {
  const { pts } = halfProfile(x);
  for (let i = 1; i < pts.length - 1; i++) {
    const [z0, y0] = pts[i];
    const [z1, y1] = pts[i + 1];
    if ((y - y0) * (y - y1) <= 0 && y1 !== y0) return lerp(z0, z1, (y - y0) / (y1 - y0));
  }
  return 0;
}
// Отметка верха палубы
export function deckTop(x, z = 0) {
  const s = section(x);
  const u = Math.min(1, Math.abs(z) / s.dw);
  return s.yd + s.cam * (1 - u * u);
}

// ---------------------------------------------------------------------------
// ГЕОМЕТРИЯ

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
  build({ orient = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (orient && signedVolume(this.pos, this.idx) < 0) flipIdx(this.idx);
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
function flipIdx(idx) {
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
}
// Разворот обхода, если нормали в сумме смотрят «не туда» (test > 0 — правильно)
function orientBy(g, test) {
  const n = g.attributes.normal;
  const p = g.attributes.position;
  let score = 0;
  for (let i = 0; i < p.count; i++) score += test(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
  if (score < 0) {
    const a = Array.from(g.index.array);
    flipIdx(a);
    g.setIndex(a);
    g.computeVertexNormals();
  }
  return g;
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

// Лофт замкнутых колец Vector3 (одинаковое число точек) с крышками-веерами
function loft(rings, { capStart = true, capEnd = true } = {}) {
  const m = new Mesher();
  const ids = rings.map((r) => r.map((p) => m.v(p.x, p.y, p.z)));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
  const cap = (ring, rev) => {
    const c = new THREE.Vector3();
    ring.forEach((p) => c.add(p));
    c.divideScalar(ring.length);
    const ci = m.v(c.x, c.y, c.z);
    const id = ring.map((p) => m.v(p.x, p.y, p.z));
    for (let j = 0; j < id.length; j++) {
      const k = (j + 1) % id.length;
      if (rev) m.tri(ci, id[k], id[j]);
      else m.tri(ci, id[j], id[k]);
    }
  };
  if (capStart) cap(rings[0], false);
  if (capEnd) cap(rings[rings.length - 1], true);
  return m.build();
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
// Перенос/поворот, запечённые в геометрию
function xf(g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  M4.compose(V(...p), Q.setFromEuler(E.set(...r)), V(...s));
  g.applyMatrix4(M4);
  return g;
}
// Зеркало по Z с разворотом обхода (вместо отрицательного масштаба узла)
function mirrorZ(g) {
  const c = g.clone();
  c.scale(1, 1, -1);
  if (c.index) {
    const a = Array.from(c.index.array);
    flipIdx(a);
    c.setIndex(a);
  }
  c.computeVertexNormals();
  return c;
}
// Тело вращения вокруг Y по профилю [[r, y], ...]
function lathe(profile, segs = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)), segs);
}
// То же вокруг оси X (профиль [[r, x]])
function latheX(profile, segs = 24) {
  return lathe(profile, segs).rotateZ(-Math.PI / 2);
}
const box = (w, h, d, p = [0, 0, 0], r = [0, 0, 0]) => xf(new THREE.BoxGeometry(w, h, d), { p, r });
// Цилиндр между двумя точками
function rod(a, b, r, segs = 12, open = false) {
  const A = V(...a);
  const B = V(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), segs, 1, open);
  g.applyQuaternion(Q.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
function tubeAlong(points, r, segs = 40, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)));
  return new THREE.TubeGeometry(curve, segs, r, radial, false);
}

// Профиль NACA 00xx (толщина)
const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
// Перо: размах по +Y от y0 до y0+span, хорда по X (передняя кромка le, задняя te), толщина по Z
function foil({ le0, te0, le1, te1, span, y0 = 0, tc = 0.12, nSpan = 4, nCh = 10 }) {
  const rings = [];
  for (let k = 0; k <= nSpan; k++) {
    const s = k / nSpan;
    const le = lerp(le0, le1, s);
    const te = lerp(te0, te1, s);
    const ch = le - te;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= nCh; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nCh));
    for (const t of ts) ring.push(V(le - t * ch, y0 + span * s, Math.max(0.008, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(V(le - ts[j] * ch, y0 + span * s, -Math.max(0.008, naca(ts[j]) * tc * ch)));
    rings.push(ring);
  }
  return loft(rings);
}

// Лопасть гребного винта: радиальная ось +Y, ось вращения X, шаг pitch
function blade({ r0, R, chord, pitch, tc = 0.1, n = 9, M = 9, hand = 1 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, R, s);
    const ch = Math.max(0.07, chord * Math.sqrt(Math.max(0, 1 - s ** 2.6)) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, s * 1.3))));
    const beta = Math.atan(pitch / (2 * Math.PI * r));
    const d = V(Math.sin(beta) * hand, 0, Math.cos(beta));
    const nn = V(Math.cos(beta), 0, -Math.sin(beta) * hand);
    const thick = lerp(tc * 1.6, tc * 0.6, s);
    const skew = 0.12 * s * s;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= M; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const add = (t, sign) => {
      const c = (0.5 - t) * ch - skew;
      const h = sign * Math.max(0.006, naca(t) * thick * ch * 0.5);
      const p = d.clone().multiplyScalar(c).addScaledVector(nn, h);
      const ang = p.z / r;
      ring.push(V(p.x, r * Math.cos(ang), r * Math.sin(ang)));
    };
    for (const t of ts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(ts[j], -1);
    rings.push(ring);
  }
  return loft(rings, { capStart: false });
}

// Для мелочи без текстуры — UV проекцией в рамку 0…1 (картинки у таких материалов нет)
function boxUV(g) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const sz = bb.getSize(V(0, 0, 0));
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const fx = (p.getX(i) - bb.min.x) / (sz.x || 1);
    const fy = (p.getY(i) - bb.min.y) / (sz.y || 1);
    const fz = (p.getZ(i) - bb.min.z) / (sz.z || 1);
    let u, v;
    if (ax >= ay && ax >= az) { u = fz; v = fy; } else if (ay >= az) { u = fx; v = fz; } else { u = fx; v = fy; }
    uv[2 * i] = clamp01(u);
    uv[2 * i + 1] = clamp01(v);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function strip(g) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.clearGroups();
  return out;
}
// Склейка, индексы, удаление вырожденных треугольников
function finish(g) {
  const m = mergeVertices(g, 1e-5);
  const p = m.attributes.position;
  const idx = m.index.array;
  const keep = [];
  const a = V(0, 0, 0), b = V(0, 0, 0), c = V(0, 0, 0);
  for (let i = 0; i < idx.length; i += 3) {
    const [i0, i1, i2] = [idx[i], idx[i + 1], idx[i + 2]];
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1);
    c.fromBufferAttribute(p, i2);
    if (b.sub(a).cross(c.sub(a)).length() < 1e-7) continue;
    keep.push(i0, i1, i2);
  }
  m.setIndex(keep);
  return m;
}
// Набор деталей одного материала -> одна индексированная сетка
function mergePlain(list) {
  return finish(boxUV(mergeGeometries(list.map(strip))));
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ (атлас окраски и настил палубы)

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.mimeType = 'image/jpeg';
  return t;
}
// Атлас 2048²: верх (v 0.375…1) — борт корпуса в боковой проекции (x, y 0…10 м), низ (v 0…0.375) — рубка
const ATLAS = 2048;
const HULL_V0 = 0.375;
const hullUV = (x, y) => [clamp01((x - XS) / LEN), HULL_V0 + (1 - HULL_V0) * clamp01(y / 10)];
const TOWER_Y0 = 5.4;
const TOWER_Y1 = 9.8;
const towerV = (y) => HULL_V0 * clamp01((y - TOWER_Y0) / (TOWER_Y1 - TOWER_Y0)) * 0.999;

const COL = {
  upper: [163, 168, 170],
  lower: [52, 56, 59],
  tower: [170, 174, 176],
};
function makeAtlas(rnd) {
  return canvasTex(ATLAS, ATLAS, (c, W) => {
    const HH = Math.round(ATLAS * (1 - HULL_V0)); // 1280 px — корпус
    const col = (x) => ((x - XS) / LEN) * W;
    const row = (y) => ((10 - y) / 10) * HH;
    const rgb = (a, k = 0, al = 1) => `rgba(${a[0] + k},${a[1] + k},${a[2] + k},${al})`;
    // корпус: светло-серый верх, тёмно-серый низ по ватерлинии
    c.fillStyle = rgb(COL.upper);
    c.fillRect(0, 0, W, row(WL));
    c.fillStyle = rgb(COL.lower);
    c.fillRect(0, row(WL), W, HH - row(WL));
    // пятна и неровность краски
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * W, y = rnd() * HH, w = 8 + rnd() * 70, h = 3 + rnd() * 26;
      c.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.015 + rnd() * 0.03})`;
      c.fillRect(x, y, w, h);
    }
    // швы листов обшивки
    c.lineWidth = 2;
    for (const y of [1.15, 2.3, 3.4, 5.25, 5.85]) {
      c.strokeStyle = y > WL ? 'rgba(70,74,78,0.35)' : 'rgba(18,20,22,0.45)';
      c.beginPath(); c.moveTo(0, row(y)); c.lineTo(W, row(y)); c.stroke();
    }
    for (let x = XS + 1.3; x < XB; x += 2.6) {
      for (const [y0, y1] of [[0, WL], [WL, 7.3]]) {
        c.strokeStyle = y0 > 0 ? 'rgba(70,74,78,0.3)' : 'rgba(18,20,22,0.4)';
        c.beginPath(); c.moveTo(col(x), row(y1)); c.lineTo(col(x), row(y0)); c.stroke();
      }
    }
    // шпигаты лёгкого корпуса: верхний ряд под палубой и нижний — группами
    const slot = (x, y, w, h, fill) => {
      const X = col(x - w / 2), Y = row(y + h / 2), Wd = col(x + w / 2) - X, Ht = row(y - h / 2) - Y;
      c.fillStyle = fill;
      c.beginPath();
      c.roundRect(X, Y, Wd, Ht, Math.min(Wd, Ht) / 2);
      c.fill();
    };
    for (let x = -31; x < 31.5; x += 0.72) {
      if (x > -6.5 && x < 5.5) continue;
      const y = deckY(x) - 0.38;
      // подтёки ржавчины
      const g = c.createLinearGradient(0, row(y), 0, row(y - 1.4));
      g.addColorStop(0, 'rgba(110,80,55,0.10)');
      g.addColorStop(1, 'rgba(110,80,55,0)');
      c.fillStyle = g;
      c.fillRect(col(x - 0.2), row(y), col(x + 0.2) - col(x - 0.2), row(y - 1.4) - row(y));
      slot(x, y, 0.5, 0.13, 'rgb(16,17,18)');
    }
    for (let x = -6.2; x < 5.4; x += 0.6) slot(x, deckY(x) - 0.38, 0.4, 0.12, 'rgb(16,17,18)');
    for (const xc of [-26, -18, -10, -2, 6, 14, 22]) {
      for (let k = -2; k <= 2; k++) slot(xc + k * 0.8, 0.9, 0.55, 0.22, 'rgb(14,15,16)');
      for (let k = -1; k <= 1; k++) slot(xc + 0.4 + k * 0.8, 5.35, 0.45, 0.16, 'rgb(16,17,18)');
    }
    // крышки носовых (4) и кормовых (2) торпедных аппаратов
    c.lineWidth = 3;
    for (const [x, y, w, h] of [[33.0, 2.25, 0.75, 0.6], [33.15, 3.35, 0.75, 0.6], [-36.6, 3.9, 0.7, 0.55]]) {
      c.strokeStyle = 'rgb(20,22,24)';
      c.beginPath();
      c.ellipse(col(x), row(y), (col(x + w / 2) - col(x - w / 2)) / 2, (row(y - h / 2) - row(y + h / 2)) / 2, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fill();
    }
    // клюз якоря (правый борт; на левом — такая же ниша)
    slot(34.6, 5.9, 0.5, 0.55, 'rgb(40,42,44)');

    // РУБКА: u — доля периметра, v — высота 5.4…9.8 м
    const T0 = HH;
    const TH = ATLAS - HH;
    const trow = (y) => T0 + ((TOWER_Y1 - y) / (TOWER_Y1 - TOWER_Y0)) * TH;
    c.fillStyle = rgb(COL.tower);
    c.fillRect(0, T0, W, TH);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * W, y = T0 + rnd() * TH, w = 6 + rnd() * 50, h = 3 + rnd() * 20;
      c.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.015 + rnd() * 0.03})`;
      c.fillRect(x, y, w, h);
    }
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(80,84,88,0.35)';
    for (const y of [7.1, 8.2]) { c.beginPath(); c.moveTo(0, trow(y)); c.lineTo(W, trow(y)); c.stroke(); }
    for (let u = 0.04; u < 1; u += 0.083) { c.beginPath(); c.moveTo(u * W, trow(8.2)); c.lineTo(u * W, trow(6.2)); c.stroke(); }
    // шпигаты у основания рубки
    for (let u = 0.03; u < 1; u += 0.024) {
      if (Math.abs(u - 0.5) < 0.06 || u > 0.97) continue;
      c.fillStyle = 'rgb(18,19,20)';
      c.beginPath();
      c.roundRect(u * W - 9, trow(6.75), 18, trow(6.6) - trow(6.75), 6);
      c.fill();
    }
    // окантовка кромки мостика
    c.fillStyle = 'rgba(60,64,68,0.5)';
    c.fillRect(0, trow(9.62), W, trow(9.5) - trow(9.62));
  });
}
// Деревянный настил: u — длина палубы, v — ширина (z −2…2 м); доски вдоль корпуса
function makeDeck(rnd) {
  return canvasTex(2048, 512, (c, W, H) => {
    const plank = 0.16;
    const px = H / 4;
    c.fillStyle = 'rgb(40,38,35)';
    c.fillRect(0, 0, W, H);
    const rows = Math.ceil(4 / plank);
    for (let r = 0; r < rows; r++) {
      const y0 = r * plank * px;
      let x = -rnd() * 4;
      while (x < LEN) {
        const len = 3.5 + rnd() * 2.5;
        const v = 112 + Math.round((rnd() - 0.5) * 22);
        c.fillStyle = `rgb(${v},${v - 6},${v - 15})`;
        const X0 = (x / LEN) * W, X1 = ((x + len) / LEN) * W;
        c.fillRect(X0 + 1, y0 + 1.5, X1 - X0 - 2, plank * px - 3);
        for (let g = 0; g < 4; g++) {
          c.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`;
          c.fillRect(X0, y0 + 2 + rnd() * (plank * px - 5), X1 - X0, 1);
        }
        x += len;
      }
    }
    for (let i = 0; i < 500; i++) {
      c.fillStyle = `rgba(${rnd() < 0.6 ? '20,20,20' : '200,200,200'},${0.03 + rnd() * 0.04})`;
      c.fillRect(rnd() * W, rnd() * H, 10 + rnd() * 80, 4 + rnd() * 20);
    }
  });
}

// ---------------------------------------------------------------------------
// КОРПУС

function hullGeometry() {
  const NS = 190;
  const xs = [];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    xs.push(XS + LEN * (0.55 * s + 0.45 * (0.5 - 0.5 * Math.cos(Math.PI * s))));
  }
  const side = new Mesher();
  const deck = new Mesher();
  const sideIds = [];
  const deckIds = [];
  const rings = [];
  for (const x of xs) {
    const { s, pts } = halfProfile(x);
    // борт: от правой кромки палубы вниз, через киль, к левой кромке
    const ring = [];
    for (let i = pts.length - 1; i >= 1; i--) ring.push([pts[i][0], pts[i][1]]);
    ring.push([0, s.kb]);
    for (let i = 1; i < pts.length; i++) ring.push([-pts[i][0], pts[i][1]]);
    sideIds.push(ring.map(([z, y]) => side.v(x, y, z, ...hullUV(x, y))));
    // палуба: от левой кромки к правой
    const dr = [];
    for (let k = -ND; k <= ND; k++) {
      const z = (k / ND) * s.dw;
      const y = s.yd + s.cam * (1 - (z / s.dw) ** 2);
      dr.push([z, y]);
    }
    deckIds.push(dr.map(([z, y]) => deck.v(x, y, z, clamp01((x - XS) / LEN), clamp01(0.5 + z / 4))));
    rings.push([...ring, ...dr.slice(1, -1)]);
  }
  for (let k = 0; k < xs.length - 1; k++) {
    side.strip(sideIds[k], sideIds[k + 1]);
    deck.strip(deckIds[k], deckIds[k + 1]);
  }
  // торцы (форштевень и корма) — веером, UV боковой проекции
  const caps = new Mesher();
  const capRing = (k, rev) => {
    const side = caps;
    const r = rings[k];
    const x = xs[k];
    let cy = 0;
    r.forEach(([, y]) => (cy += y));
    cy /= r.length;
    const ci = side.v(x, cy, 0, ...hullUV(x, cy));
    const id = r.map(([z, y]) => side.v(x, y, z, ...hullUV(x, y)));
    for (let j = 0; j < id.length; j++) {
      const n = (j + 1) % id.length;
      if (rev) side.tri(ci, id[n], id[j]);
      else side.tri(ci, id[j], id[n]);
    }
  };
  capRing(0, false);
  capRing(xs.length - 1, true);
  // согласуем обход: наружу (по общему объёму)
  const sg = side.build({ orient: false });
  const dg = deck.build({ orient: false });
  const cg = caps.build({ orient: false });
  // проверка ориентации: нормаль палубы в середине должна смотреть вверх, борта — наружу
  const fixUp = (g, test) => {
    const n = g.attributes.normal;
    const p = g.attributes.position;
    let score = 0;
    for (let i = 0; i < p.count; i += 7) score += test(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    if (score < 0) {
      const a = Array.from(g.index.array);
      flipIdx(a);
      g.setIndex(a);
      g.computeVertexNormals();
    }
  };
  fixUp(dg, (x, y, z, nx, ny) => ny);
  fixUp(sg, (x, y, z, nx, ny, nz) => (Math.abs(z) > 0.5 ? Math.sign(z) * nz : 0));
  fixUp(cg, (x, y, z, nx) => Math.sign(x) * nx);
  const g = mergeGeometries([mergeGeometries([strip(sg), strip(cg)]), strip(dg)], true);
  return finishGroups(g);
}
// finish() для сетки с группами материалов
function finishGroups(g) {
  const parts = g.groups.map((gr) => {
    const sub = new THREE.BufferGeometry();
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k];
      sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
    }
    return finish(sub);
  });
  return mergeGeometries(parts, true);
}

// ---------------------------------------------------------------------------
// РУБКА

// Контур рубки в плане: aft (корма) … fore (нос), полуширина W; u — доля периметра
const TM = 22;
function towerOutline(A, F, W, y, rf = 1.4, ra = 2.2) {
  const pts = [];
  for (let i = 0; i <= TM; i++) {
    const t = 0.5 - 0.5 * Math.cos((Math.PI * i) / TM);
    const x = A + (F - A) * t;
    let w = W;
    if (x > F - rf) w = W * Math.sqrt(Math.max(0, 1 - ((x - (F - rf)) / rf) ** 2));
    else if (x < A + ra) w = W * Math.max(0, 1 - ((A + ra - x) / ra) ** 1.7) ** 0.6;
    pts.push([x, w]);
  }
  const ring = [];
  for (let i = 0; i <= TM; i++) ring.push(V(pts[i][0], y, pts[i][1]));
  for (let i = TM - 1; i >= 1; i--) ring.push(V(pts[i][0], y, -pts[i][1]));
  return ring;
}
function towerGeometry() {
  const L = [
    // y, aft, fore, halfWidth, rf, ra
    [5.95, -6.1, 4.75, 1.45, 1.9, 2.8],
    [6.6, -6.0, 4.6, 1.42, 1.8, 2.7],
    [7.6, -5.8, 4.25, 1.33, 1.6, 2.5],
    [8.2, -5.65, 3.95, 1.28, 1.5, 2.4],
    [8.2, -2.5, 3.9, 1.23, 1.45, 0.9], // уступ: пол «зимнего сада»
    [8.9, -2.55, 3.85, 1.22, 1.4, 0.9],
    [9.35, -2.6, 3.98, 1.28, 1.45, 0.9],
    [9.58, -2.65, 4.12, 1.34, 1.5, 0.9], // ветроотбойник
    [9.58, -2.58, 4.03, 1.27, 1.45, 0.85], // внутренняя кромка
    [9.3, -2.5, 3.85, 1.2, 1.4, 0.85],
    [8.45, -2.42, 3.72, 1.14, 1.35, 0.85], // пол мостика
  ];
  const rings = L.map(([y, a, f, w, rf, ra]) => towerOutline(a, f, w, y, rf, ra));
  const m = new Mesher();
  const ids = rings.map((ring) => {
    // u — по длине дуги; дублируем первую точку в конце (шов UV)
    const pts = [...ring, ring[0]];
    let len = 0;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push((len += pts[i].distanceTo(pts[i - 1])));
    return pts.map((p, i) => m.v(p.x, p.y, p.z, clamp01(acc[i] / len), towerV(p.y)));
  });
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1]);
  // пол мостика — веер (отдельно, чтобы ориентировать нормалью вверх)
  const f = new Mesher();
  const last = rings[rings.length - 1];
  const c = V(0, 0, 0);
  last.forEach((p) => c.add(p));
  c.divideScalar(last.length);
  const ci = f.v(c.x, c.y, c.z, 0.5, towerV(c.y));
  const fl = [...last, last[0]].map((p) => f.v(p.x, p.y, p.z, 0.5 + (p.x - c.x) / 20, towerV(p.y)));
  for (let j = 0; j < fl.length - 1; j++) f.tri(ci, fl[j + 1], fl[j]);
  const walls = orientBy(m.build({ orient: false }), (x, y, z, nx, ny, nz) => (y < 8 ? Math.sign(z) * nz : 0));
  const floor = orientBy(f.build({ orient: false }), (x, y, z, nx, ny) => ny);
  const g = mergeGeometries([strip(walls), strip(floor)]);
  return finish(g);
}

// ---------------------------------------------------------------------------
// ВООРУЖЕНИЕ (каждое — в своих координатах: начало на оси наводки, ствол вперёд +X)

function deckGun105() {
  const L = [];
  L.push(lathe([[0.44, -0.12], [0.44, 0.04], [0.36, 0.1], [0.27, 0.32], [0.24, 0.66], [0.32, 0.72], [0.32, 0.8], [0, 0.8]], 28));
  // лафет: щёки, цапфы, люлька
  for (const z of [-0.27, 0.27]) {
    L.push(box(0.95, 0.6, 0.07, [0.02, 1.08, z]));
    L.push(rod([0.05, 1.25, z], [0.05, 1.25, z * 1.55], 0.1, 16));
  }
  L.push(box(1.5, 0.3, 0.38, [0.15, 1.25, 0]));
  // ствол с дульным утолщением и каналом
  L.push(latheX([[0, -0.78], [0.13, -0.78], [0.13, -0.3], [0.118, 0.85], [0.08, 4.0], [0.088, 4.04], [0.088, 4.2], [0.052, 4.2], [0.052, 3.95], [0, 3.95]], 24).translate(0, 1.42, 0));
  // накатник и тормоз отката
  L.push(latheX([[0, -0.4], [0.085, -0.4], [0.085, 1.75], [0, 1.75]], 18).translate(0, 1.63, 0));
  L.push(latheX([[0, -0.3], [0.06, -0.3], [0.06, 1.2], [0, 1.2]], 14).translate(0, 1.2, 0));
  // затвор
  L.push(box(0.32, 0.38, 0.36, [-0.92, 1.42, 0]));
  // прицелы и маховики наводки
  for (const z of [-0.52, 0.52]) {
    L.push(box(0.5, 0.12, 0.1, [-0.15, 1.6, z]));
    L.push(rod([-0.05, 1.6, z], [0.2, 1.6, z], 0.045, 12));
    L.push(xf(new THREE.TorusGeometry(0.13, 0.02, 6, 16), { p: [-0.3, 1.05, z * 1.1], r: [0, 0, 0] }));
    L.push(rod([-0.3, 1.05, z * 0.6], [-0.3, 1.05, z * 1.1], 0.025, 8));
    L.push(box(0.08, 0.5, 0.08, [-0.55, 0.85, z * 0.7]));
    L.push(box(0.35, 0.05, 0.25, [-0.65, 0.62, z * 0.95]));
  }
  return mergePlain(L);
}
function flak37() {
  const L = [];
  L.push(lathe([[0.3, -0.12], [0.3, 0.05], [0.2, 0.15], [0.16, 0.7], [0.22, 0.76], [0.22, 0.82], [0, 0.82]], 24));
  for (const z of [-0.17, 0.17]) L.push(box(0.55, 0.45, 0.05, [0, 1.0, z]));
  L.push(box(1.0, 0.2, 0.22, [0.05, 1.1, 0]));
  L.push(latheX([[0, -0.6], [0.07, -0.6], [0.065, 0.4], [0.042, 2.6], [0.05, 2.62], [0.05, 2.75], [0.03, 2.75], [0.03, 2.6], [0, 2.6]], 16).translate(0, 1.15, 0));
  L.push(box(0.4, 0.18, 0.2, [-0.6, 1.15, 0]));
  L.push(box(0.12, 0.35, 0.3, [-0.3, 1.38, 0])); // магазинная рамка
  for (const z of [-0.4, 0.4]) {
    L.push(box(0.4, 0.06, 0.06, [-0.1, 1.15, z]));
    L.push(box(0.06, 0.35, 0.06, [-0.4, 0.95, z * 0.9]));
    L.push(xf(new THREE.TorusGeometry(0.1, 0.018, 6, 14), { p: [-0.25, 0.92, z], r: [0, 0, 0] }));
  }
  const g = mergePlain(L);
  return g.rotateY(Math.PI); // по-походному стволом в корму
}
function flak20() {
  const L = [];
  L.push(lathe([[0.2, -0.05], [0.2, 0.04], [0.11, 0.1], [0.09, 0.7], [0.14, 0.75], [0.14, 0.8], [0, 0.8]], 20));
  L.push(box(0.36, 0.3, 0.26, [0, 0.95, 0]));
  L.push(latheX([[0, -0.45], [0.05, -0.45], [0.05, 0.2], [0.022, 0.2], [0.02, 1.15], [0.032, 1.17], [0.032, 1.3], [0, 1.3]], 14).translate(0, 1.05, 0));
  L.push(box(0.08, 0.32, 0.2, [-0.05, 1.25, 0.12])); // магазин
  // щиток (с толщиной)
  L.push(box(0.012, 0.62, 0.95, [0.32, 1.05, 0]));
  L.push(box(0.012, 0.25, 0.4, [0.32, 1.48, 0]));
  for (const z of [-0.22, 0.22]) L.push(box(0.35, 0.05, 0.05, [-0.35, 1.0, z])); // плечевые упоры
  const g = mergePlain(L);
  return g.rotateY(Math.PI);
}

// ---------------------------------------------------------------------------

export function createType9C() {
  let seed = 1942;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const mat = (name, color, roughness, metalness, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const M = {
    paint: mat('Hull_Paint', 0xffffff, 0.72, 0.15, { map: makeAtlas(rnd) }),
    wood: mat('Deck_Wood', 0xffffff, 0.9, 0.0, { map: makeDeck(rnd) }),
    grey: mat('Steel_Grey', 0xa3a8aa, 0.62, 0.25),
    dark: mat('Steel_Dark_Grey', 0x34383b, 0.7, 0.25),
    black: mat('Metal_Black', 0x1b1c1d, 0.55, 0.4),
    bronze: mat('Propeller_Bronze', 0xa47c48, 0.35, 1.0),
  };

  const root = new THREE.Group();
  root.name = 'Uboat_Type_IXC';
  const group = (name, parent = root, pos = [0, 0, 0]) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...pos);
    parent.add(g);
    return g;
  };
  const mesh = (name, geo, material, parent) => {
    geo.name = name;
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    parent.add(m);
    return m;
  };

  // --- корпус
  const hull = group('Hull');
  mesh('Hull_Casing', hullGeometry(), [M.paint, M.wood], hull);

  const fit = []; // светло-серая надводная мелочь
  const under = []; // тёмная подводная арматура
  const wire = []; // леера-тросы
  // шпили
  for (const x of [30.6, -30.2]) {
    const y = deckTop(x) - 0.04;
    fit.push(lathe([[0.3, 0], [0.3, 0.07], [0.2, 0.1], [0.17, 0.32], [0.22, 0.38], [0.2, 0.42], [0, 0.44]], 20).translate(x, y, 0));
  }
  // кнехты
  for (const x of [33.4, 26.5, 19.0, -18.5, -26.0, -33.0]) {
    for (const sgn of [-1, 1]) {
      const z = sgn * (section(x).dw - 0.28);
      const y = deckTop(x, z) - 0.05;
      for (const dx of [-0.22, 0.22]) fit.push(lathe([[0.09, 0], [0.09, 0.26], [0.12, 0.28], [0.12, 0.32], [0, 0.33]], 16).translate(x + dx, y, z));
    }
  }
  // люки на палубе (низкие овальные комингсы)
  for (const [x, rx, rz] of [[21.5, 0.55, 0.4], [12.5, 0.4, 0.4], [-14.5, 0.4, 0.4], [-22.0, 0.55, 0.4]]) {
    const g = lathe([[1, 0], [1, 0.12], [0.94, 0.16], [0.6, 0.18], [0, 0.18]], 24);
    g.scale(rx, 1, rz);
    fit.push(g.translate(x, deckTop(x) - 0.04, 0));
  }
  // ящики боезапаса у орудий (заподлицо с палубой, низкие)
  for (const x of [11.3, -12.6]) for (const z of [-0.95, 0.95]) fit.push(box(0.6, 0.18, 0.45, [x, deckTop(x, z) + 0.05, z]));
  // сетепрорезатель на форштевне
  {
    const sh = new THREE.Shape();
    const pts = [[0, 0], [0.4, 0.02], [0.85, 0.12], [1.25, 0.25]];
    sh.moveTo(-0.6, -0.15);
    for (const [x, y] of pts) sh.lineTo(x, y);
    sh.lineTo(1.25, 0.32);
    for (let k = 0; k < 5; k++) {
      const x = 1.05 - k * 0.32;
      sh.lineTo(x, 0.48 + 0.04 * (4 - k));
      sh.lineTo(x - 0.18, 0.36);
    }
    sh.lineTo(-0.6, 0.62);
    sh.lineTo(-0.6, -0.15);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false });
    g.translate(0, 0, -0.025);
    fit.push(g.translate(XB - 1.32, deckY(XB - 1.3) + 0.05, 0));
  }
  // стойки леера: на корме
  fit.push(rod([XS + 1.3, deckTop(XS + 1.3) - 0.05, 0], [XS + 1.35, 6.75, 0], 0.04, 10));
  // якорь (правый борт)
  {
    const x = 34.6;
    const y = 5.75;
    const z = hullZ(x, y);
    const g = mergeGeometries([
      box(0.16, 0.7, 0.1, [0, 0.1, 0]),
      box(0.62, 0.16, 0.14, [0, -0.28, 0]),
      box(0.14, 0.24, 0.12, [-0.26, -0.18, 0], [0, 0, 0.5]),
      box(0.14, 0.24, 0.12, [0.26, -0.18, 0], [0, 0, -0.5]),
    ].map(strip));
    under.push(g.translate(x, y, z + 0.0));
  }
  // гребные валы, кронштейны, стабилизатор кормовых рулей, скег, опоры рулей, ограждения винтов
  const PROP = { x: -32.6, y: 2.05, z: 1.55, R: 0.95 };
  for (const sg of [-1, 1]) {
    const z = sg * PROP.z;
    under.push(rod([-27.0, PROP.y, z], [PROP.x + 0.5, PROP.y, z], 0.11, 16));
    // кронштейн гребного вала (А-образный)
    for (const [dz, dy] of [[-0.9, 1.0], [-0.2, 1.35]]) {
      const top = [PROP.x + 1.6, keelY(PROP.x + 1.6) + 0.5, z + sg * dz];
      under.push(rod([PROP.x + 1.1, PROP.y, z], top, 0.06, 10));
      void dy;
    }
    under.push(latheX([[0.11, -0.2], [0.16, -0.12], [0.16, 0.25], [0.11, 0.33]], 16).translate(PROP.x + 1.1, PROP.y, z));
    // ограждение винта
    const y0 = 3.7;
    under.push(tubeAlong([
      [-29.8, y0 + 0.1, sg * (hullZ(-29.8, y0 + 0.1) - 0.2)],
      [-30.9, 3.45, sg * 2.45],
      [-32.0, 3.05, sg * 2.8],
      [-33.0, 2.45, sg * 2.88],
      [-33.6, 2.08, sg * 2.86],
    ], 0.07, 30, 10));
    // опора руля (кронштейн от кормы)
    under.push(foil({ le0: 0.32, te0: -0.32, le1: 0.3, te1: -0.3, span: 1.85, tc: 0.18, nSpan: 3, nCh: 8 }).rotateX(sg * Math.PI / 2).translate(-35.75, 3.3, 0));
  }
  // стабилизатор кормовых горизонтальных рулей (сквозной)
  under.push(foil({ le0: 0.6, te0: -0.6, le1: 0.6, te1: -0.6, span: 5.8, y0: -2.9, tc: 0.1, nSpan: 6, nCh: 10 }).rotateX(Math.PI / 2).translate(-33.95, PROP.y, 0));
  // кормовой скег
  {
    const sh = new THREE.Shape();
    const pts = [];
    for (let x = -24; x >= -35.4; x -= 0.6) {
      const t = clamp01((-24 - x) / 10.5);
      pts.push([x, lerp(keelY(x), 1.72, t ** 0.8)]);
    }
    sh.moveTo(-23.8, keelY(-23.8) + 0.5);
    for (const [x, y] of pts) sh.lineTo(x, y);
    sh.lineTo(-35.6, 1.85);
    sh.lineTo(-35.6, keelY(-35.6) + 0.45);
    for (let x = -35.2; x <= -24; x += 0.8) sh.lineTo(x, keelY(x) + 0.45);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.24, bevelEnabled: false, curveSegments: 1 });
    under.push(g.translate(0, 0, -0.12));
  }
  // киль-брус под килем? (нет — киль в обводах)
  mesh('Hull_Fittings', mergePlain(fit), M.grey, hull);
  mesh('Hull_Underwater_Fittings', mergePlain(under), M.dark, hull);

  // --- рубка
  const tower = group('Conning_Tower');
  mesh('Tower_Structure', towerGeometry(), M.paint, tower);
  const tf = [];
  const PERI = { attack: [0.25, 0.19, 10.0], sky: [1.55, 0.22, 10.15] }; // x, радиус тумбы, верх тумбы
  for (const [x, r, top] of Object.values(PERI)) {
    // тумба перископа — толстостенная труба (перископ ходит внутри)
    tf.push(lathe([[r + 0.06, 8.4], [r + 0.04, 8.75], [r, 9.0], [r, top - 0.05], [r - 0.02, top], [0.135, top], [0.135, 8.95], [0, 8.95]], 24).translate(x, 0, 0));
  }
  // визир УЗО, компас, рамочная антенна пеленгатора
  tf.push(lathe([[0.12, 8.4], [0.08, 8.5], [0.07, 9.4], [0.11, 9.45], [0, 9.5]], 16).translate(3.3, 0, 0));
  tf.push(box(0.14, 0.12, 0.42, [3.3, 9.55, 0]));
  tf.push(lathe([[0.16, 8.4], [0.16, 9.0], [0.2, 9.05], [0.2, 9.22], [0, 9.3]], 20).translate(2.55, 0, 0.55));
  tf.push(rod([2.2, 9.5, -0.95], [2.2, 10.25, -0.95], 0.035, 10));
  tf.push(xf(new THREE.TorusGeometry(0.28, 0.025, 8, 28), { p: [2.2, 10.52, -0.95], r: [0, 0, 0] }));
  // стойка троса над ветроотбойником
  tf.push(rod([3.95, 9.4, 0], [4.05, 10.15, 0], 0.04, 10));
  // ограждение «зимнего сада»
  const gardenRail = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const ang = -Math.PI / 2 + Math.PI * t; // от правого борта через корму к левому
    const x = -2.7 - 2.75 * Math.max(0, Math.cos(ang)) ** 0.8;
    const z = 1.15 * Math.sin(ang) * (ang > 0 ? -1 : -1);
    gardenRail.push([x, z]);
  }
  for (const h of [8.75, 9.25]) tf.push(tubeAlong(gardenRail.map(([x, z]) => [x, h, z]), 0.025, 40, 8));
  for (let i = 0; i <= 16; i += 2) {
    const [x, z] = gardenRail[i];
    tf.push(rod([x, 8.15, z], [x, 9.3, z], 0.025, 8));
  }
  mesh('Tower_Fittings', mergePlain(tf), M.grey, tower);

  // --- леерные тросы (jumping wire)
  wire.push(rod([XB - 0.55, deckY(XB - 0.5) + 0.62, 0], [4.05, 10.12, 0], 0.016, 8));
  wire.push(rod([-5.45, 9.3, 0], [XS + 1.35, 6.72, 0], 0.016, 8));
  mesh('Jumping_Wire', mergePlain(wire), M.black, hull);

  // --- подвижные части
  const movable = (name, parentGroup, pos, geo, material) => {
    const g = group(name, parentGroup, pos);
    mesh(`${name}_Mesh`, geo.translate(-pos[0], -pos[1], -pos[2]), material, g);
    return g;
  };
  const arm = group('Armament');
  const gunX = 8.6;
  movable('Deck_Gun', arm, [gunX, deckTop(gunX), 0], deckGun105().translate(gunX, deckTop(gunX), 0), M.grey);
  const f37x = -10.4;
  movable('Flak_37mm', arm, [f37x, deckTop(f37x), 0], flak37().translate(f37x, deckTop(f37x), 0), M.grey);
  movable('Flak_20mm', tower, [-4.25, 8.2, 0], flak20().translate(-4.25, 8.2, 0), M.grey);

  // перископы: начало у основания трубы, выдвигаются по Y
  const periscope = (name, x, top, head) => {
    const base = 9.0;
    const prof = head === 'attack'
      ? [[0, base], [0.1, base], [0.1, top - 0.55], [0.06, top - 0.25], [0.035, top - 0.05], [0.03, top], [0, top]]
      : [[0, base], [0.115, base], [0.115, top - 0.6], [0.09, top - 0.45], [0.09, top - 0.05], [0.06, top], [0, top]];
    const parts = [lathe(prof, 20)];
    if (head === 'sky') parts.push(box(0.1, 0.12, 0.12, [0.1, top - 0.25, 0]));
    else parts.push(box(0.06, 0.06, 0.06, [0.035, top - 0.13, 0]));
    return movable(name, tower, [x, base, 0], mergePlain(parts.map((g) => g.translate(x, 0, 0))), M.grey);
  };
  periscope('Periscope_Attack', PERI.attack[0], 10.55, 'attack');
  periscope('Periscope_Sky', PERI.sky[0], 10.75, 'sky');

  // рули: носовые горизонтальные (ось петли по Z), кормовые горизонтальные, вертикальные (баллер по Y)
  const ctrl = group('Control_Surfaces');
  {
    const x = 30.4;
    const y = 3.25;
    const z0 = hullZ(x, y) - 0.1;
    const tip = BEAM - 0.02;
    const g = foil({ le0: 0.4, te0: -0.75, le1: 0.3, te1: -0.6, span: tip - z0, tc: 0.12, nSpan: 4, nCh: 10 }).rotateX(Math.PI / 2);
    // после поворота размах идёт в −Z; разворачиваем в +Z
    const right = g;
    const R = finish(boxUV(strip(right)));
    const Lg = finish(boxUV(strip(mirrorZ(right))));
    movable('Bow_Plane_R', ctrl, [x, y, z0], R.translate(x, y, z0), M.dark);
    movable('Bow_Plane_L', ctrl, [x, y, -z0], Lg.translate(x, y, -z0), M.dark);
  }
  {
    const x = -34.55;
    const y = PROP.y;
    const z0 = 0.12;
    const g = foil({ le0: 0.02, te0: -0.88, le1: 0.02, te1: -0.78, span: 2.75, tc: 0.1, nSpan: 4, nCh: 10 }).rotateX(Math.PI / 2);
    const R = finish(boxUV(strip(g)));
    const Lg = finish(boxUV(strip(mirrorZ(g))));
    movable('Stern_Plane_R', ctrl, [x, y, z0], R.translate(x, y, z0), M.dark);
    movable('Stern_Plane_L', ctrl, [x, y, -z0], Lg.translate(x, y, -z0), M.dark);
  }
  {
    const x = -35.75;
    const top = 3.32;
    for (const [nm, sg] of [['Rudder_R', 1], ['Rudder_L', -1]]) {
      const g = finish(boxUV(strip(foil({ le0: 0.27, te0: -0.95, le1: 0.3, te1: -1.05, span: 2.3, y0: -2.3, tc: 0.13, nSpan: 4, nCh: 10 }))));
      movable(nm, ctrl, [x, top, sg * PROP.z], g.translate(x, top, sg * PROP.z), M.dark);
    }
  }

  // гребные винты: трёхлопастные, Ø 1.9 м
  const prop = group('Propulsion');
  const propGeo = (hand) => {
    const parts = [latheX([[0, 0.42], [0.12, 0.4], [0.2, 0.3], [0.22, 0.05], [0.2, -0.28], [0.14, -0.4], [0.14, -0.5], [0, -0.5]], 20)];
    for (let k = 0; k < 3; k++) {
      const b = blade({ r0: 0.17, R: PROP.R, chord: 0.7, pitch: 1.7 });
      b.rotateX((k * 2 * Math.PI) / 3);
      parts.push(b);
    }
    const g = mergePlain(parts);
    return hand > 0 ? g : finish(mirrorZ(g));
  };
  const props = {};
  for (const [nm, sg] of [['Propeller_R', 1], ['Propeller_L', -1]]) {
    const p = [PROP.x, PROP.y, sg * PROP.z];
    props[nm] = movable(nm, prop, p, propGeo(sg).translate(...p), M.bronze);
  }

  // анимация: винты в противоположные стороны, 8 ключей на оборот
  const period = 1.0;
  const steps = 8;
  const tracks = [];
  for (const [nm, dir] of [['Propeller_R', -1], ['Propeller_L', 1]]) {
    const times = [];
    const values = [];
    for (let k = 0; k <= steps; k++) {
      times.push((k / steps) * period);
      Q.setFromAxisAngle(V(1, 0, 0), (dir * 2 * Math.PI * k) / steps);
      values.push(Q.x, Q.y, Q.z, Q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${nm}.quaternion`, times, values));
  }
  root.animations = [new THREE.AnimationClip('Propellers_Spin', period, tracks)];
  return root;
}
export const TYPE9C = { WL, LEN, XB, XS };
