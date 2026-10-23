import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Гидроавиатранспорт Королевского флота HMS Pegasus (бывший Ark Royal 1914 г., переименован в 1934 г.)
// в облике корабля-катапультного истребителя 1940–41 гг. Самолётов нет (по ТЗ это отдельные модели).
// Масштаб 1:1 в метрах. Ось Y вверх, нос +X, правый борт +Z. Киль на y = 0, ватерлиния y = 5.6 (осадка).
// Длина 111.6 м (366 фт), ширина 15.5 м, осадка 5.6 м. Корпус торгового судна: длинная носовая палуба
// над ангаром-трюмом с большим люком, два паровых крана, катапульта на баке; машины, мостик и высокая
// труба — в корме, бизань с парусом-стакселем для удержания носом на ветер. Один винт, один руль.
// Материалы: атлас окраски (борт, палуба, надстройки, труба) и шесть материалов цветом.

const XS = -55.8; // корма (срез подзора)
const XB = 55.8; // форштевень на уровне фальшборта
const B2 = 7.75; // полуширина
const RB = 1.5; // радиус скулы
const BUL = 1.05; // высота фальшборта
export const WL = 5.6; // ватерлиния над килем
const ATLAS = 2048;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// ОБВОДЫ КОРПУСА

// Палуба (седловатость к носу и корме), без погиби поперёк
export const deckY = (x) => 9.6 + 2.2 * Math.max(0, (x - 8) / 47.8) ** 2 + 0.8 * Math.max(0, (-x - 8) / 47.8) ** 2;
// Форштевень: скруглённый подъём носа у киля, выше — прямой наклонный
function xStem(y) {
  if (y <= 2.8) return 50.4 + Math.sqrt(Math.max(0, 2.8 * 2.8 - (2.8 - y) ** 2));
  return 53.2 + 0.259 * (y - 2.8);
}
// Корма: ахтерштевень до y = 5.6, выше — эллиптический подзор (крейсерская корма торгового судна)
function xSternEnd(y) {
  if (y <= 5.6) return -49.0;
  if (y <= 8.2) return -49.0 - 6.2 * Math.sqrt(Math.max(0, 1 - ((8.2 - y) / 2.6) ** 2));
  return -55.2 - 0.6 * Math.min(1, (y - 8.2) / 2.2);
}
// Доля полуширины в точке (x, y): заострение носа и кормы, полнота растёт кверху
function fullness(x, y) {
  const xf0 = 16, xa0 = -12;
  if (x > xf0) {
    const s = clamp01((x - xf0) / (xStem(y) - xf0));
    const p = 1.6 + 0.12 * Math.min(y, 11);
    const e = lerp(0.95, 0.72, smooth(y / 12));
    return Math.max(0, 1 - s ** p) ** e;
  }
  if (x < xa0) {
    const s = clamp01((xa0 - x) / (xa0 - xSternEnd(y)));
    const k = smooth((y - 4.0) / 4.2);
    const p = lerp(1.2 + 0.2 * Math.min(y, 5), 3.2, k);
    const e = lerp(1.0, 0.5, k);
    return Math.max(0, 1 - s ** p) ** e;
  }
  return 1;
}
// Полуширина борта на высоте y (выше скулы) в абсциссе x
export const sideZ = (x, y) => B2 * fullness(x, y);
// Абсцисса точки шпангоута t ∈ [0, 1] на высоте y
const X = (t, y) => xSternEnd(y) + t * (xStem(y) - xSternEnd(y));
// Нормаль борта (правый борт) в точке (x, y)
function sideNormal(x, y) {
  const h = 0.02;
  const z0 = sideZ(x, y);
  const dzdx = (sideZ(x + h, y) - sideZ(x - h, y)) / (2 * h);
  const dzdy = (sideZ(x, y + h) - sideZ(x, y - h)) / (2 * h);
  return new THREE.Vector3(-dzdx, -dzdy, 1).normalize().multiplyScalar(z0 > 0 ? 1 : 1);
}

// UV атласа: борт v 0.505…0.995 (по высоте), палуба 0.255…0.495, надстройки 0.005…0.245
const YMAX = 13.2;
const U = (x) => 0.005 + (0.99 * (x - XS)) / (XB - XS);
const V_SIDE = (y) => 0.505 + (0.49 * clamp01(y / YMAX));
const ZD = 7.85;
const V_DECK = (z) => 0.255 + (0.24 * (z + ZD)) / (2 * ZD);
const PERMAX = 104;
const UP = (per) => 0.005 + (0.99 * per) / PERMAX;
const BAND_ACC = [0.005, 0.105]; // стены надстроек с иллюминаторами, 0…3 м
const BAND_BRG = [0.115, 0.215]; // стены рубки с окнами, 0…3 м
const V_BAND = (band, h) => band[0] + (band[1] - band[0]) * clamp01(h / 3);
const V_FUN = 0.227; // серая полоска трубы
const V_FUN_TOP = 0.242; // чёрная полоска верха трубы
const V_FOUL = V_SIDE(1.0); // подводная окраска

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
  build({ orient = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const P = this.pos;
    const keep = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < this.idx.length; i += 3) {
      const [i0, i1, i2] = [this.idx[i], this.idx[i + 1], this.idx[i + 2]];
      a.fromArray(P, i0 * 3);
      b.fromArray(P, i1 * 3);
      c.fromArray(P, i2 * 3);
      if (b.sub(a).cross(c.sub(a)).length() > 1e-7) keep.push(i0, i1, i2);
    }
    if (orient && signedVolume(P, keep) < 0) {
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

// Тело вращения вокруг Y по профилю [[r, y], ...] снизу вверх. r = 0 на конце — полюс.
// Крышки: top/bottom (по умолчанию верх закрыт, низ открыт — деталь стоит на поверхности).
function lathe(profile, seg = 20, { bottom = false, top = true, uv = null } = {}) {
  const m = new Mesher();
  const n = profile.length;
  const rings = [];
  const uvf = uv || ((j, k) => [j / seg, k / (n - 1)]);
  for (let k = 0; k < n; k++) {
    const [r, y] = profile[k];
    if (r === 0) {
      rings.push(m.v(new THREE.Vector3(0, y, 0), ...uvf(0, k)));
      continue;
    }
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ring.push(m.v(new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a)), ...uvf(j, k)));
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
    const c = m.v(new THREE.Vector3(0, y, 0), ...uvf(0, k));
    const ids = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      ids.push(m.v(new THREE.Vector3(r * Math.cos(a), y, -r * Math.sin(a)), ...uvf(j, k)));
    }
    for (let j = 0; j < seg; j++) {
      if (up) m.tri(c, ids[(j + 1) % seg], ids[j]);
      else m.tri(c, ids[j], ids[(j + 1) % seg]);
    }
  };
  if (top) capAt(n - 1, true);
  if (bottom) capAt(0, false);
  return m.build();
}
const latheX = (profile, seg, opt = { bottom: true }) => lathe(profile, seg, opt).rotateZ(-Math.PI / 2);

// Стержень между двумя точками
function rod(a, b, r, seg = 6, caps = true) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, !caps);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// Ящик с выбрасываемыми гранями: skip — список из '+x','-x','+y','-y','+z','-z'
function box(sx, sy, sz, x = 0, y = 0, z = 0, skip = ['-y'], uvRect = null) {
  const m = new Mesher();
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const P = (i, j, k) => new THREE.Vector3(x + i * hx, y + j * hy, z + k * hz);
  const faces = {
    '+x': [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)],
    '-x': [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
    '+y': [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)],
    '-y': [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
    '+z': [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
    '-z': [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
  };
  const [u0, v0, u1, v1] = uvRect || [0, 0, 1, 1];
  for (const [k, q] of Object.entries(faces)) {
    if (skip.includes(k)) continue;
    const ids = [m.v(q[0], u0, v0), m.v(q[1], u1, v0), m.v(q[2], u1, v1), m.v(q[3], u0, v1)];
    m.quad(...ids);
  }
  return m.build({ orient: false });
}

// Призма: многоугольник в плоскости XY, толщина по Z (центр z = 0)
function prism(poly, th, uvc = null) {
  const m = new Mesher();
  const pts = poly.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const uv = uvc || (() => [0.5, 0.5]);
  const front = pts.map((p) => m.v(new THREE.Vector3(p.x, p.y, th / 2), ...uv(p)));
  const back = pts.map((p) => m.v(new THREE.Vector3(p.x, p.y, -th / 2), ...uv(p)));
  tris.forEach(([a, b, c]) => {
    m.tri(front[a], front[b], front[c]);
    m.tri(back[a], back[c], back[b]);
  });
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = m.v(new THREE.Vector3(pts[i].x, pts[i].y, th / 2), ...uv(pts[i]));
    const b = m.v(new THREE.Vector3(pts[j].x, pts[j].y, th / 2), ...uv(pts[j]));
    const c = m.v(new THREE.Vector3(pts[j].x, pts[j].y, -th / 2), ...uv(pts[j]));
    const d = m.v(new THREE.Vector3(pts[i].x, pts[i].y, -th / 2), ...uv(pts[i]));
    m.quad(a, d, c, b);
  }
  return m.build();
}

// Лофт замкнутых колец с крышками
function loftRings(rings, uvFn = () => [0.5, 0.5]) {
  const m = new Mesher();
  const ids = rings.map((ring) => ring.map((p) => m.v(p, ...uvFn(p))));
  for (let k = 0; k < ids.length - 1; k++) m.strip(ids[k], ids[k + 1], true);
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
  return m.build();
}

const naca = (t) => 5 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);

// Перо: размах по +Y от y0, хорда по X (передняя кромка +X), толщина по Z
function foil({ root, tip, span, tc = 0.12, y0 = 0, nSpan = 4, nCh = 12, uvFn = null }) {
  const rings = [];
  for (let k = 0; k <= nSpan; k++) {
    const s = k / nSpan;
    const y = y0 + span * s;
    const le = lerp(root[0], tip[0], s), te = lerp(root[1], tip[1], s);
    const ch = le - te;
    const ring = [];
    const ts = [];
    for (let j = 0; j <= nCh; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / nCh));
    for (const t of ts) ring.push(new THREE.Vector3(le - t * ch, y, Math.max(0.006, naca(t) * tc * ch)));
    for (let j = nCh - 1; j >= 1; j--) ring.push(new THREE.Vector3(le - ts[j] * ch, y, -Math.max(0.006, naca(ts[j]) * tc * ch)));
    rings.push(ring);
  }
  return loftRings(rings, uvFn || ((p) => [clamp01((p.x - root[1]) / (root[0] - root[1] + 1e-6)), clamp01((p.y - y0) / span)]));
}

// Лопасть винта: радиальная ось +Y, ось вращения X
function bladeGeometry({ r0, r1, chord0, chord1, pitch, skew = 0, tc = 0.1, n = 7 }) {
  const rings = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const r = lerp(r0, r1, s);
    const ch = lerp(chord0, chord1, Math.sin(Math.PI * Math.min(s, 0.75) / 1.5)) * (k === n ? 0.45 : 1);
    const beta = Math.atan(pitch / (2 * Math.PI * r));
    const d = new THREE.Vector3(Math.sin(beta), 0, Math.cos(beta));
    const nn = new THREE.Vector3(Math.cos(beta), 0, -Math.sin(beta));
    const ring = [];
    const M = 8;
    const pts = [];
    for (let j = 0; j <= M; j++) pts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / M));
    const off = skew * s * s;
    const add = (t, sign) => {
      const c = (0.5 - t) * ch + off;
      const h = sign * Math.max(0.008, naca(t) * tc * ch * (1 - 0.6 * s));
      const p = d.clone().multiplyScalar(c).addScaledVector(nn, h);
      const ang = p.z / r;
      ring.push(new THREE.Vector3(p.x, r * Math.cos(ang), r * Math.sin(ang)));
    };
    for (const t of pts) add(t, 1);
    for (let j = M - 1; j >= 1; j--) add(pts[j], -1);
    rings.push(ring);
  }
  return loftRings(rings, (p) => [0.5 + 0.4 * Math.tanh(p.x), clamp01(p.y / r1)]);
}

// Трубка по точкам (изогнутые шлюпбалки, поручни)
function tube(points, r, radial = 6, segs = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, segs, r, radial, false);
}

function clean(g) {
  const out = g.index ? g : mergeVertices(g);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}
const merge = (list) => mergeVertices(mergeGeometries(list.map(clean)), 1e-5);
// UV всех вершин — в одну точку атласа (детали одноцветной окраски из атласа)
function uvAt(g, u, v) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}

// ---------------------------------------------------------------------------
// ТЕКСТУРЫ

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintAtlas() {
  const S = ATLAS;
  const col = makeCanvas(S, S), hgt = makeCanvas(S, S);
  const C = col.getContext('2d'), Hc = hgt.getContext('2d');
  let seed = 7654321;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const px = (u) => u * S;
  const py = (v) => (1 - v) * S;
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
  const ellipse = (ctx, cx, cy, rx, ry, fill, stroke = null, lw = 2) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  };
  // пиксели на метр
  const kU = (0.99 * S) / (XB - XS);
  const kV = (0.49 * S) / YMAX;
  const HX = (x) => px(U(x));
  const HY = (y) => py(V_SIDE(y));

  // ---- БОРТ (v 0.5…1)
  const top = 0, bot = S / 2;
  C.fillStyle = '#717a80';
  C.fillRect(0, top, S, bot);
  C.fillStyle = '#4c2b25'; // подводная часть
  C.fillRect(0, HY(5.32), S, bot - HY(5.32));
  C.fillStyle = '#1d1e20'; // полоса ватерлинии
  C.fillRect(0, HY(6.05), S, HY(5.32) - HY(6.05));
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * S, y = rnd() * bot;
    const r = 6 + rnd() * 30;
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.014)' : 'rgba(0,0,0,0.02)';
    C.beginPath();
    C.ellipse(x, y, r * 2.2, r, 0, 0, Math.PI * 2);
    C.fill();
  }
  // пояса обшивки и стыки листов
  const strakes = [0, 1.55, 3.15, 4.75, 6.35, 7.95, 9.55, 11.15, 12.75, YMAX];
  strakes.slice(1, -1).forEach((y) => {
    line(C, 0, HY(y), S, HY(y), 2, 'rgba(15,18,20,0.13)');
    line(Hc, 0, HY(y), S, HY(y), 3, 'rgb(150,150,150)');
  });
  for (let k = 0; k < strakes.length - 1; k++) {
    for (let x = XS + 1 + (k % 2) * 3.4; x < XB; x += 6.8) {
      line(C, HX(x), HY(strakes[k + 1]), HX(x), HY(strakes[k]), 1.5, 'rgba(15,18,20,0.09)');
      line(Hc, HX(x), HY(strakes[k + 1]), HX(x), HY(strakes[k]), 2, 'rgb(110,110,110)');
    }
  }
  // потёки ржавчины
  const streak = (x, y, len, a) => {
    const g = C.createLinearGradient(0, HY(y), 0, HY(y - len));
    g.addColorStop(0, `rgba(96,58,36,${a})`);
    g.addColorStop(1, 'rgba(96,58,36,0)');
    C.fillStyle = g;
    C.fillRect(HX(x) - 2, HY(y), 3 + rnd() * 3, HY(y - len) - HY(y));
  };
  // иллюминаторы: жилые помещения в корме и в носу
  const port = (x, y) => {
    ellipse(C, HX(x), HY(y), 0.21 * kU + 1.5, 0.21 * kV + 2, '#2c2f31', 'rgba(150,155,158,0.9)', 3);
    ellipse(C, HX(x), HY(y), 0.15 * kU, 0.15 * kV, '#14181b');
    ellipse(Hc, HX(x), HY(y), 0.22 * kU + 1.5, 0.22 * kV + 2, 'rgb(170,170,170)');
    ellipse(Hc, HX(x), HY(y), 0.15 * kU, 0.15 * kV, 'rgb(60,60,60)');
    if (rnd() < 0.3) streak(x + 0.05, y - 0.25, 0.8 + rnd() * 1.5, 0.22);
  };
  for (let x = -47.2; x < -13; x += 2.1) port(x, 8.05);
  for (let x = 35.5; x < 48.5; x += 2.2) port(x, 9.35);
  // клюзы
  ellipse(C, HX(52.35), HY(9.85), 0.5 * kU, 0.42 * kV, '#16181a', 'rgba(60,64,66,1)', 4);
  ellipse(Hc, HX(52.35), HY(9.85), 0.55 * kU, 0.45 * kV, 'rgb(50,50,50)');
  streak(52.3, 9.4, 3.2, 0.35);
  // шпигаты у палубы
  for (let x = -44; x < 46; x += 4.3) {
    const y = deckY(x) + 0.12;
    C.fillStyle = '#1b1d1e';
    C.fillRect(HX(x) - 3, HY(y + 0.12), 6, HY(y) - HY(y + 0.12));
    if (rnd() < 0.5) streak(x, y - 0.05, 1 + rnd() * 2.5, 0.2);
  }
  // марки углубления на носу и корме (белые цифры-штрихи)
  [[50.2, 1], [-48.3, 1]].forEach(([x]) => {
    for (let y = 1; y <= 6; y += 0.5) {
      C.fillStyle = 'rgba(225,225,220,0.85)';
      C.fillRect(HX(x) - 2, HY(y + 0.15), 5, HY(y) - HY(y + 0.15));
    }
  });

  // ---- ПАЛУБА (v 0.255…0.495) — деревянный настил
  const d0 = py(0.5), d1 = py(0.25);
  C.fillStyle = '#857862';
  C.fillRect(0, d0, S, d1 - d0);
  const plank = 0.16;
  for (let z = -ZD; z < ZD; z += plank) {
    const ya = py(V_DECK(z + plank)), yb = py(V_DECK(z));
    let x = XS - rnd() * 6;
    while (x < XB) {
      const len = 4 + rnd() * 4;
      const t = 118 + Math.round(rnd() * 22);
      C.fillStyle = `rgb(${t + 8},${t - 2},${t - 22})`;
      C.fillRect(HX(x), ya, HX(x + len) - HX(x), yb - ya);
      line(C, HX(x), ya, HX(x), yb, 1.5, 'rgba(40,34,26,0.7)');
      line(Hc, HX(x), ya, HX(x), yb, 1.5, 'rgb(100,100,100)');
      x += len;
    }
    line(C, 0, yb, S, yb, 1.5, 'rgba(38,32,24,0.8)');
    line(Hc, 0, yb, S, yb, 1.5, 'rgb(96,96,96)');
  }
  for (let i = 0; i < 700; i++) {
    C.fillStyle = rnd() < 0.5 ? 'rgba(255,250,240,0.04)' : 'rgba(0,0,0,0.06)';
    C.fillRect(rnd() * S, d0 + rnd() * (d1 - d0), 20 + rnd() * 90, 3 + rnd() * 7);
  }

  // ---- НАДСТРОЙКИ (v 0…0.25)
  const t0 = py(0.25);
  C.fillStyle = '#7d858a';
  C.fillRect(0, t0, S, S - t0);
  const BY = (band, h) => py(V_BAND(band, h));
  const kP = (0.99 * S) / PERMAX;
  // грязь у основания стен
  [BAND_ACC, BAND_BRG].forEach((band) => {
    const g = C.createLinearGradient(0, BY(band, 0), 0, BY(band, 0.6));
    g.addColorStop(0, 'rgba(50,44,36,0.35)');
    g.addColorStop(1, 'rgba(50,44,36,0)');
    C.fillStyle = g;
    C.fillRect(0, BY(band, 0.6), S, BY(band, 0) - BY(band, 0.6));
    // сварные/клёпаные швы
    [0.9, 2.1].forEach((h) => {
      line(C, 0, BY(band, h), S, BY(band, h), 2, 'rgba(20,24,26,0.2)');
      line(Hc, 0, BY(band, h), S, BY(band, h), 2, 'rgb(150,150,150)');
    });
    for (let p = 1.2; p < PERMAX; p += 2.4) {
      line(C, px(UP(p)), BY(band, 3), px(UP(p)), BY(band, 0), 1.5, 'rgba(20,24,26,0.12)');
      line(Hc, px(UP(p)), BY(band, 3), px(UP(p)), BY(band, 0), 1.5, 'rgb(118,118,118)');
    }
  });
  const kB = (BAND_ACC[1] - BAND_ACC[0]) * S / 3;
  // иллюминаторы и двери
  for (let p = 0.9; p < PERMAX; p += 1.7) {
    const cx = px(UP(p)), cy = BY(BAND_ACC, 1.65);
    if (Math.abs(((p + 6) % 13) - 6.5) < 0.9) continue;
    ellipse(C, cx, cy, 0.2 * kP + 1.5, 0.2 * kB + 1.5, '#303437', 'rgba(160,165,168,0.9)', 2);
    ellipse(C, cx, cy, 0.14 * kP, 0.14 * kB, '#121619');
    ellipse(Hc, cx, cy, 0.21 * kP + 1.5, 0.21 * kB + 1.5, 'rgb(170,170,170)');
    ellipse(Hc, cx, cy, 0.14 * kP, 0.14 * kB, 'rgb(60,60,60)');
  }
  for (let p = 6.5; p < PERMAX; p += 13) {
    const x0 = px(UP(p - 0.4)), x1 = px(UP(p + 0.4));
    C.fillStyle = '#6d7377';
    C.fillRect(x0, BY(BAND_ACC, 1.95), x1 - x0, BY(BAND_ACC, 0.15) - BY(BAND_ACC, 1.95));
    C.strokeStyle = 'rgba(25,28,30,0.9)';
    C.lineWidth = 3;
    C.strokeRect(x0, BY(BAND_ACC, 1.95), x1 - x0, BY(BAND_ACC, 0.15) - BY(BAND_ACC, 1.95));
    Hc.strokeStyle = 'rgb(60,60,60)';
    Hc.lineWidth = 4;
    Hc.strokeRect(x0, BY(BAND_ACC, 1.95), x1 - x0, BY(BAND_ACC, 0.15) - BY(BAND_ACC, 1.95));
  }
  // окна рулевой рубки
  for (let p = 0.4; p < PERMAX; p += 1.15) {
    const x0 = px(UP(p)), x1 = px(UP(p + 0.85));
    const ya = BY(BAND_BRG, 2.15), yb = BY(BAND_BRG, 1.3);
    C.fillStyle = '#1c2629';
    C.fillRect(x0, ya, x1 - x0, yb - ya);
    C.fillStyle = 'rgba(160,185,195,0.25)';
    C.fillRect(x0 + 2, ya + 2, (x1 - x0) * 0.4, (yb - ya) * 0.35);
    C.strokeStyle = 'rgba(190,195,198,0.9)';
    C.lineWidth = 3;
    C.strokeRect(x0, ya, x1 - x0, yb - ya);
    Hc.fillStyle = 'rgb(70,70,70)';
    Hc.fillRect(x0, ya, x1 - x0, yb - ya);
  }
  // труба: серая полоска и чёрная полоска верха
  C.fillStyle = '#80878c';
  C.fillRect(0, py(0.232), S, py(0.222) - py(0.232));
  C.fillStyle = '#18191a';
  C.fillRect(0, py(0.247), S, py(0.237) - py(0.247));

  // карта нормалей из высот
  const hd = Hc.getImageData(0, 0, S, S).data;
  const nrm = makeCanvas(S, S);
  const N = nrm.getContext('2d');
  const img = N.createImageData(S, S);
  const k = 2.0 / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const at = (xx, yy) => hd[(Math.min(S - 1, Math.max(0, yy)) * S + Math.min(S - 1, Math.max(0, xx))) * 4];
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      img.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  N.putImageData(img, 0, 0);

  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.mimeType = 'image/jpeg';
  map.anisotropy = 8;
  map.name = 'Paint_Atlas_Color';
  const normalMap = new THREE.CanvasTexture(nrm);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  normalMap.name = 'Paint_Atlas_Normal';
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// КОРПУС: замкнутая оболочка — днище, скула, борт, фальшборт, палуба

function buildHull() {
  const m = new Mesher();
  const NST = 150;
  const ts = [];
  for (let i = 0; i <= NST; i++) {
    const u = i / NST;
    ts.push(0.3 * u + 0.7 * (0.5 - 0.5 * Math.cos(Math.PI * u)));
  }
  // высоты точек борта: гуще у ватерлинии и подзора
  const sideYs = (yTop) => {
    const ys = [];
    const seg = (a, b, n) => {
      for (let i = 0; i < n; i++) ys.push(lerp(a, b, i / n));
    };
    seg(RB, 4.6, 4);
    seg(4.6, 5.6, 3);
    seg(5.6, 6.3, 4);
    seg(6.3, 8.4, 6);
    seg(8.4, yTop, 4);
    ys.push(yTop);
    return ys;
  };
  const NB = 5, NBL = 8, ND = 6;
  const solveY = (t, f) => {
    let y = 10;
    for (let i = 0; i < 6; i++) y = f(X(t, y));
    return y;
  };
  const regions = { bottom: [], side: [], cap: [], inner: [], deck: [] };
  for (const t of ts) {
    const yTop = solveY(t, (x) => deckY(x) + BUL);
    const yDk = solveY(t, (x) => deckY(x));
    // днище
    const bottom = [];
    for (let j = 0; j <= NB; j++) {
      const zb = ((B2 - RB) * j) / NB;
      const x = X(t, 0);
      bottom.push([new THREE.Vector3(x, 0, zb * fullness(x, 0)), U(x), lerp(0.506, V_SIDE(0.35), j / NB)]);
    }
    // скула и борт
    const side = [];
    for (let j = 0; j <= NBL; j++) {
      const a = ((Math.PI / 2) * j) / NBL;
      const y = RB - RB * Math.cos(a);
      const zb = B2 - RB + RB * Math.sin(a);
      const x = X(t, y);
      side.push([new THREE.Vector3(x, y, zb * fullness(x, y)), U(x), V_SIDE(y)]);
    }
    const ys = sideYs(yTop);
    ys.slice(1).forEach((y) => {
      const x = X(t, y);
      side.push([new THREE.Vector3(x, y, B2 * fullness(x, y)), U(x), V_SIDE(y)]);
    });
    const outerTop = side[side.length - 1][0];
    const zIn = Math.max(0, outerTop.z - 0.2);
    const xTop = outerTop.x;
    // планширь
    const cap = [
      [outerTop.clone(), U(xTop), V_SIDE(yTop)],
      [new THREE.Vector3(xTop, yTop, zIn), U(xTop), V_SIDE(yTop - 0.05)],
    ];
    // внутренняя сторона фальшборта
    const inner = [];
    for (let j = 0; j <= 2; j++) {
      const y = lerp(yTop, yDk, j / 2);
      const x = X(t, y);
      inner.push([new THREE.Vector3(x, y, Math.max(0, Math.min(zIn, B2 * fullness(x, y) - 0.2))), U(x), V_SIDE(y)]);
    }
    // палуба
    const zEdge = inner[inner.length - 1][0].z;
    const xd = X(t, yDk);
    const deck = [];
    for (let j = 0; j <= ND; j++) {
      const z = zEdge * (1 - j / ND);
      deck.push([new THREE.Vector3(xd, yDk, z), U(xd), V_DECK(z)]);
    }
    const add = (name, list) => {
      const S = list.map(([p, u, v]) => m.v(p, u, v));
      const P = list.map(([p, u, v]) => m.v(new THREE.Vector3(p.x, p.y, -p.z), u, name === 'deck' ? V_DECK(-p.z) : v));
      regions[name].push({ S, P });
    };
    add('bottom', bottom);
    add('side', side);
    add('cap', cap);
    add('inner', inner);
    add('deck', deck);
  }
  for (const reg of Object.values(regions)) {
    for (let k = 0; k < reg.length - 1; k++) {
      const a = reg[k], b = reg[k + 1];
      m.strip(a.S, b.S);
      m.strip(b.P, a.P);
    }
  }
  return m.build();
}

// Надстройка: скруглённый прямоугольник в плане, стены от палубы (или от плоского основания) до крыши
function roundRect(x0, x1, hw, r, segs = 3) {
  const pts = [];
  const corners = [
    [x1 - r, hw - r, 0],
    [x0 + r, hw - r, Math.PI / 2],
    [x0 + r, -hw + r, Math.PI],
    [x1 - r, -hw + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((Math.PI / 2) * i) / segs;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  }
  return pts;
}
// Контур по корпусу: полуширина hwFn(x), скруглённые торцы (суперэллипс)
function fitOutline(x0, x1, hwFn, n = 28) {
  const pts = [];
  const xc = (x0 + x1) / 2, hx = (x1 - x0) / 2;
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(xc + hx * Math.cos((Math.PI * i) / n));
  xs.forEach((x) => pts.push([x, hwFn(x) * Math.max(0, 1 - Math.abs((x - xc) / hx) ** 10) ** 0.1]));
  for (let i = n - 1; i >= 1; i--) pts.push([xs[i], -pts[i][1]]);
  return pts;
}
// Убрать точки контура, лежащие на прямой между соседями (иначе вырожденные треугольники крыши)
function dropCollinear(pts, tol = 0.01) {
  let out = pts.slice();
  let changed = true;
  while (changed && out.length > 4) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const lx = c[0] - a[0], lz = c[1] - a[1];
      const d = Math.abs((b[0] - a[0]) * lz - (b[1] - a[1]) * lx) / (Math.hypot(lx, lz) || 1);
      if (d < tol) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}
const hwT1 = (x) => Math.min(6.6, sideZ(x, deckY(x)) - 0.75);

function flipIf(g, bad) {
  if (!bad) return g;
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.computeVertexNormals();
  return g;
}
function deckhouse({ x0, x1, hw, r = 0.8, yTop, base, band = BAND_ACC, roof = true, outline = null }) {
  const m = new Mesher();
  const pts = outline ? outline.slice() : dropCollinear(roundRect(x0, x1, hw, r));
  pts.push(pts[0]);
  let per = 0;
  const bot = [], topR = [];
  pts.forEach(([x, z], i) => {
    if (i > 0) per += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    const yb = base(x) - 0.03;
    bot.push(m.v(new THREE.Vector3(x, yb, z), UP(per % PERMAX), V_BAND(band, 0)));
    topR.push(m.v(new THREE.Vector3(x, yTop, z), UP(per % PERMAX), V_BAND(band, yTop - yb)));
  });
  m.strip(bot, topR);
  const walls = m.build({ orient: false });
  // стены наружу: нормаль от центра
  const n = walls.attributes.normal, p = walls.attributes.position;
  const cx = (x0 + x1) / 2;
  let score = 0;
  for (let i = 0; i < n.count; i++) score += n.getX(i) * (p.getX(i) - cx) + n.getZ(i) * p.getZ(i);
  flipIf(walls, score < 0);
  if (!roof) return walls;
  const mr = new Mesher();
  const ring = pts.slice(0, -1);
  const ids = ring.map(([x, z]) => mr.v(new THREE.Vector3(x, yTop, z), U(x), V_DECK(z)));
  if (outline) {
    // контур fitOutline: правый борт 0…n, левый — в обратном порядке; крыша — полосой поперёк
    const nn = ring.length / 2;
    const Pi = (i) => (i === 0 ? 0 : i === nn ? nn : 2 * nn - i);
    for (let i = 0; i < nn; i++) mr.quad(ids[i], ids[i + 1], ids[Pi(i + 1)], ids[Pi(i)]);
  } else {
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    tris.forEach(([a, b, c]) => mr.tri(ids[a], ids[b], ids[c]));
  }
  const top = mr.build({ orient: false });
  flipIf(top, top.attributes.normal.getY(0) < 0);
  return merge([walls, top]);
}

// Леерное ограждение по ломаной [[x, z], ...] на высоте y (функция или число)
function railing(path, yb, { h = 1.0, step = 1.6, r = 0.03, closed = false } = {}) {
  const parts = [];
  const pts = closed ? [...path, path[0]] : path;
  const Y = typeof yb === 'function' ? yb : () => yb;
  let acc = step;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    if (i > 0) {
      const [xp, zp] = pts[i - 1];
      const d = Math.hypot(x - xp, z - zp);
      const n = Math.max(1, Math.round(d / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const sx = lerp(xp, x, t), sz = lerp(zp, z, t);
        if (k < n || !closed || i < pts.length - 1) parts.push(rod([sx, Y(sx) - 0.02, sz], [sx, Y(sx) + h, sz], r, 4, false));
      }
      [0.5, 1.0].forEach((f) => parts.push(rod([xp, Y(xp) + h * f, zp], [x, Y(x) + h * f, z], r * 0.8, 4, true)));
    } else parts.push(rod([x, Y(x) - 0.02, z], [x, Y(x) + h, z], r, 4, false));
    acc += 0;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// РАЗМЕРЫ НАДСТРОЕК И РАСПОЛОЖЕНИЕ

const T1 = { x0: -50.2, x1: -12.0, hw: 6.6, y: 12.9 }; // ют и средняя надстройка (шлюпочная палуба)
const T2 = { x0: -34.0, x1: -18.0, hw: 5.0, y: 15.4 }; // второй ярус (кожух машинного отделения)
const T3 = { x0: -21.2, x1: -17.4, hw: 3.4, y: 17.9 }; // рулевая рубка
const FUN = { x: -27.4, y0: T2.y, y1: 28.2, a: 1.85, b: 1.45, rake: 0.07 };
const HATCH = { x0: -2.5, x1: 24.0, hw: 5.0, h: 0.95 };
const CAT = { x: 40.0, y: 13.25 }; // ось поворота катапульты, верх тумбы
const CRANE = { x: -8.0, z: 5.7, h: 1.5 };
const FORE = { x: 27.0, top: 31.0 };
const MIZ = { x: -46.6, top: 29.0 };
const PROP = { x: -50.6, y: 2.8, r: 2.25 };
const RUD = { x: -53.55, y0: 0.6, y1: 6.15 };
const BOATS = [[-38.2, 4.55], [-44.2, 4.0]];
const GUNS = [
  ['Gun_1', -15.2, T1.y, -3.9],
  ['Gun_2', -15.2, T1.y, 3.9],
  ['Gun_3', -31.9, T2.y, 0],
  ['Gun_4', -52.6, null, 0],
];

// ---------------------------------------------------------------------------

export function createPegasus() {
  const ship = new THREE.Group();
  ship.name = 'Seaplane_Carrier_Pegasus';
  const { map, normalMap } = paintAtlas();
  const std = (name, color, roughness, metalness, extra = {}) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mt.name = name;
    return mt;
  };
  const M = {
    paint: std('Hull_Paint_Atlas', 0xffffff, 0.78, 0.12, { map, normalMap }),
    steel: std('Steel_Grey', 0x7a8287, 0.62, 0.25),
    dark: std('Steel_Dark', 0x2c2f32, 0.6, 0.35),
    gun: std('Gun_Steel', 0x5c6266, 0.45, 0.55),
    bronze: std('Propeller_Bronze', 0x9b7745, 0.32, 0.9),
    wire: std('Rigging_Wire', 0x2a2b2c, 0.55, 0.5),
    canvas: std('Canvas_Covers', 0xa49c86, 0.92, 0.0),
  };
  const group = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const mesh = (geo, mat, name, parent, x = 0, y = 0, z = 0) => {
    const mm = new THREE.Mesh(geo, mat);
    mm.name = name;
    geo.name = name;
    mm.position.set(x, y, z);
    parent.add(mm);
    return mm;
  };

  // ======================= КОРПУС
  const hullG = group('Hull', ship);
  mesh(buildHull(), M.paint, 'Hull_Shell', hullG);
  {
    // подводные выступы (окраска подводной части из атласа): пятка ахтерштевня, бобышка вала, скуловые кили
    const parts = [];
    parts.push(box(4.9, 0.45, 0.5, -51.45, 0.225, 0, []));
    parts.push(latheX([[0.62, -50.3], [0.62, -49.6], [0.75, -49.0], [0.75, -47.8]], 16, { bottom: true, top: true }).translate(0, PROP.y, 0));
    parts.push(lathe([[0.36, 0.3], [0.36, 0.62], [0, 0.66]], 12, { top: false }).translate(RUD.x, 0, 0)); // подпятник руля
    [1, -1].forEach((sd) => {
      const kz = B2 - RB + RB * Math.SQRT1_2;
      const ky = RB - RB * Math.SQRT1_2;
      const bk = box(40, 0.07, 0.5, 0, 0, 0, [], null).rotateX(sd * Math.PI / 4);
      bk.translate(-2, ky - 0.18, sd * (kz + 0.18));
      parts.push(bk);
    });
    const g = merge(parts);
    uvAt(g, U(-50), V_FOUL);
    mesh(g, M.paint, 'Hull_Appendages', hullG);
    // якоря в клюзах
    const anc = [];
    [1, -1].forEach((sd) => {
      const x = 52.35, y = 9.6;
      const n = sideNormal(x, y);
      const parts2 = [
        box(0.18, 1.1, 0.14, 0, 0.25, 0, []),
        prism([[-0.75, -0.3], [0.75, -0.3], [0.45, -0.75], [0, -0.45], [-0.45, -0.75]], 0.3),
        box(0.5, 0.2, 0.12, 0, 0.85, 0, []),
      ];
      const a = merge(parts2);
      if (sd < 0) n.z = -n.z;
      a.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
      a.translate(x, y, sd * (sideZ(x, y) + 0.05));
      anc.push(a);
    });
    mesh(merge(anc), M.dark, 'Anchors', hullG);
    // размагничивающая обмотка по борту (1940 г.): петля вокруг корпуса под палубой
    {
      const pts = [];
      const xs = [];
      for (let x = -55.2; x <= 55.0; x += 1.6) xs.push(x);
      xs.push(55.1);
      const at = (x, sd) => {
        const y = deckY(x) - 0.55;
        return new THREE.Vector3(x, y, sd * (sideZ(x, y) + 0.09));
      };
      xs.forEach((x) => pts.push(at(x, 1)));
      for (let i = xs.length - 1; i >= 0; i--) pts.push(at(xs[i], -1));
      const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
      mesh(new THREE.TubeGeometry(curve, 260, 0.08, 5, true), M.steel, 'Degaussing_Cable', hullG);
    }
  }

  // ======================= НАДСТРОЙКИ
  const supG = group('Superstructure', ship);
  {
    const parts = [];
    parts.push(deckhouse({ x0: T1.x0, x1: T1.x1, yTop: T1.y, base: deckY, outline: fitOutline(T1.x0, T1.x1, hwT1) }));
    parts.push(deckhouse({ x0: T2.x0, x1: T2.x1, hw: T2.hw, r: 0.9, yTop: T2.y, base: () => T1.y }));
    parts.push(deckhouse({ x0: T3.x0, x1: T3.x1, hw: T3.hw, r: 0.6, yTop: T3.y, base: () => T2.y, band: BAND_BRG }));
    // штурманская рубка на крыше (компасная площадка)
    parts.push(deckhouse({ x0: -20.6, x1: -19.0, hw: 1.2, r: 0.3, yTop: T3.y + 1.0, base: () => T3.y, band: BAND_BRG }));
    // световой люк машинного отделения
    parts.push(prism([[-0.0, 0], [2.6, 0], [2.6, 0.55], [1.3, 1.0], [0, 0.55]], 2.4, (p) => [0.3, V_BAND(BAND_ACC, 0.3)]).rotateX(0).translate(-24.6, T2.y - 0.02, 0));
    // кожух шахты в носовой части (вход в ангар)
    parts.push(deckhouse({ x0: 25.5, x1: 28.6, hw: 1.6, r: 0.4, yTop: deckY(28) + 2.3, base: deckY }));
    // рубка на баке (у брашпиля)
    parts.push(deckhouse({ x0: 31.0, x1: 33.6, hw: 2.4, r: 0.5, yTop: deckY(33.6) + 2.2, base: deckY }));
    mesh(merge(parts), M.paint, 'Deckhouses', supG);

    // крылья мостика: консоли от второго яруса к бортам
    const wings = [];
    [1, -1].forEach((sd) => {
      const w = box(3.4, 0.22, 2.75, T3.x0 + 1.9, T2.y - 0.11, sd * (T2.hw + 1.375), [sd > 0 ? '-z' : '+z']);
      wings.push(w);
      wings.push(rod([T3.x0 + 1.9, T1.y, sd * 6.1], [T3.x0 + 1.9, T2.y - 0.22, sd * 6.1], 0.09, 6, false));
    });
    const wingsG = merge(wings);
    uvAt(wingsG, 0.5, V_FUN - 0.003);
    mesh(wingsG, M.paint, 'Bridge_Wings', supG);

    // дымовая труба: высокая, с наклоном, чёрный верх, внутри — ниша
    {
      const m = new Mesher();
      const seg = 28;
      const ringAt = (y, s, v, inner = false) => {
        const ids = [];
        for (let j = 0; j <= seg; j++) {
          const a = (j / seg) * Math.PI * 2;
          const cx = FUN.x - FUN.rake * (y - FUN.y0);
          ids.push(m.v(new THREE.Vector3(cx + FUN.a * s * Math.cos(a), y, -FUN.b * s * Math.sin(a)), 0.005 + 0.99 * (j / seg), v));
        }
        return inner ? ids.reverse() : ids;
      };
      const yB = FUN.y1 - 1.3;
      const rows = [
        ringAt(FUN.y0 - 0.03, 1, V_FUN - 0.004),
        ringAt(FUN.y0 + 2, 1, V_FUN - 0.002),
        ringAt(yB, 1, V_FUN + 0.004),
      ];
      for (let k = 0; k < rows.length - 1; k++) m.strip(rows[k], rows[k + 1]);
      const t0 = ringAt(yB, 1, V_FUN_TOP - 0.003);
      const t1 = ringAt(FUN.y1, 1, V_FUN_TOP + 0.003);
      const l1 = ringAt(FUN.y1, 0.9, V_FUN_TOP + 0.004);
      const i0 = ringAt(FUN.y1 - 1.6, 0.9, V_FUN_TOP - 0.004);
      m.strip(t0, t1);
      m.strip(t1, l1);
      m.strip(l1, i0);
      const cx = FUN.x - FUN.rake * (FUN.y1 - 1.6 - FUN.y0);
      const c = m.v(new THREE.Vector3(cx, FUN.y1 - 1.6, 0), 0.5, V_FUN_TOP);
      for (let j = 0; j < seg; j++) m.tri(c, i0[j], i0[j + 1]);
      const g = m.build({ orient: false });
      // проверка: нормали наружной стены от оси
      const n = g.attributes.normal, p = g.attributes.position;
      let sc = 0;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < yB - 0.1) sc += n.getX(i) * (p.getX(i) - FUN.x) + n.getZ(i) * p.getZ(i);
      if (sc < 0) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
        g.computeVertexNormals();
      }
      mesh(g, M.paint, 'Funnel', supG);
    }

    // стальные детали надстроек: леера, вентиляторы-раструбы, свисток, прожектор, нактоуз, трапы
    const f = [];
    const rrT1 = fitOutline(T1.x0 + 0.15, T1.x1 - 0.15, (x) => hwT1(x) - 0.15, 20);
    f.push(...railing(rrT1, T1.y, { step: 1.8, closed: true }));
    f.push(...railing(roundRect(T2.x0 + 0.12, T2.x1 - 0.12, T2.hw - 0.12, 0.78), T2.y, { step: 1.8, closed: true }));
    f.push(...railing(roundRect(T3.x0 + 0.1, T3.x1 - 0.1, T3.hw - 0.1, 0.5), T3.y, { step: 1.2, closed: true, h: 0.9 }));
    [1, -1].forEach((sd) => {
      const xa = T3.x0 + 0.25, xb = T3.x0 + 3.55, zo = sd * (T2.hw + 2.65), zi = sd * (T2.hw - 0.05);
      f.push(...railing([[xa, zi], [xa, zo], [xb, zo], [xb, zi]], T2.y, { step: 1.2 }));
      // трапы между ярусами
      const lad = (x, y0, y1, z) => {
        const run = (y1 - y0) * 0.7;
        f.push(rod([x + run, y0, z - 0.35], [x, y1, z - 0.35], 0.04, 4));
        f.push(rod([x + run, y0, z + 0.35], [x, y1, z + 0.35], 0.04, 4));
        for (let k = 1; k < 9; k++) {
          const t = k / 9;
          f.push(box(0.22, 0.04, 0.62, x + run * (1 - t), lerp(y0, y1, t), z, []));
        }
      };
      lad(T1.x1, deckY(T1.x1 + 1), T1.y, sd * 2.2);
      lad(T2.x1, T1.y, T2.y, sd * 1.0);
    });
    // вентиляторы-раструбы у трубы
    const cowl = (x, z, y0, h, r, face) => {
      const m = new Mesher();
      const seg = 12;
      const dir = new THREE.Vector3(Math.cos(face), 0, -Math.sin(face));
      const rb = 1.3 * r;
      const rings = [];
      const ring = (c, t, rad) => {
        // кольцо в плоскости, перпендикулярной касательной t
        const a1 = new THREE.Vector3().crossVectors(t, dir).normalize();
        if (a1.lengthSq() < 1e-6) a1.set(-dir.z, 0, dir.x);
        const a2 = new THREE.Vector3().crossVectors(t, a1).normalize();
        const ids = [];
        for (let j = 0; j <= seg; j++) {
          const ang = (j / seg) * Math.PI * 2;
          ids.push(m.v(c.clone().addScaledVector(a1, rad * Math.cos(ang)).addScaledVector(a2, rad * Math.sin(ang)), j / seg, 0.5));
        }
        return ids;
      };
      const up = new THREE.Vector3(0, 1, 0);
      const P0 = new THREE.Vector3(x, y0 - 0.03, z);
      rings.push(ring(P0, up, r));
      rings.push(ring(new THREE.Vector3(x, y0 + h, z), up, r));
      const NB = 5;
      let last = null, lastT = null;
      for (let i = 1; i <= NB; i++) {
        const th = ((Math.PI / 2) * i) / NB;
        const c = new THREE.Vector3(x, y0 + h + rb * Math.sin(th), z).addScaledVector(dir, rb - rb * Math.cos(th));
        const t = new THREE.Vector3(0, Math.cos(th), 0).addScaledVector(dir, Math.sin(th)).normalize();
        const rad = r * (1 + 0.75 * smooth((i - 2) / (NB - 2)));
        rings.push(ring(c, t, rad));
        last = c;
        lastT = t;
      }
      const R = r * 1.75;
      rings.push(ring(last.clone().addScaledVector(lastT, 0.02), lastT, R * 0.86)); // кромка раструба
      const deep = last.clone().addScaledVector(lastT, -0.45 * r);
      rings.push(ring(deep, lastT, R * 0.8));
      for (let k = 0; k < rings.length - 1; k++) m.strip(rings[k], rings[k + 1]);
      const ci = m.v(deep.clone().addScaledVector(lastT, -0.05), 0.5, 0.5);
      const lr = rings[rings.length - 1];
      for (let j = 0; j < seg; j++) m.tri(ci, lr[j + 1], lr[j]);
      const g = m.build({ orient: false });
      // наружная стенка трубы смотрит от оси
      const nA = g.attributes.normal, pA = g.attributes.position;
      let sc = 0;
      for (let i = 0; i < (seg + 1) * 2; i++) sc += nA.getX(i) * (pA.getX(i) - x) + nA.getZ(i) * (pA.getZ(i) - z);
      return [flipIf(g, sc < 0)];
    };
    [[-23.0, 3.4, Math.PI], [-23.0, -3.4, Math.PI], [-31.5, 3.6, 0], [-31.5, -3.6, 0]].forEach(([x, z, a]) => f.push(...cowl(x, z, T2.y, 2.4, 0.45, a)));
    [[-40.0, 2.2, Math.PI], [-40.0, -2.2, Math.PI], [-48.6, 1.6, 0]].forEach(([x, z, a]) => f.push(...cowl(x, z, T1.y, 1.5, 0.33, a)));
    [[22.0, 6.2, 0], [22.0, -6.2, 0], [36.0, 3.6, Math.PI], [36.0, -3.6, Math.PI]].forEach(([x, z, a]) => f.push(...cowl(x, z, deckY(x), 1.6, 0.3, a)));
    // паровой свисток и паропровод на трубе
    f.push(rod([FUN.x + 1.6, T2.y, 0], [FUN.x + 0.95, FUN.y1 - 2.6, 0], 0.09, 6));
    f.push(lathe([[0.16, -0.3], [0.16, 0.5], [0, 0.6]], 8).translate(FUN.x + 0.95, FUN.y1 - 2.6, 0));
    // прожекторы на крыльях мостика и компас
    [1, -1].forEach((sd) => {
      f.push(lathe([[0.28, 0], [0.32, 0.25], [0.38, 0.5], [0.38, 0.9], [0, 0.95]], 12).translate(T3.x0 + 2.9, T2.y, sd * (T2.hw + 2.0)));
    });
    f.push(lathe([[0.22, 0], [0.16, 0.8], [0.26, 0.95], [0, 1.15]], 12).translate(-19.8, T3.y + 1.0, 0));
    // шлюпбалки
    BOATS.forEach(([bx, bz]) => {
      [1, -1].forEach((sd) => {
        [-2.6, 2.6].forEach((dx) => {
          const x = bx + dx;
          const zd = hwT1(x) - 0.45;
          f.push(tube([[x, T1.y - 0.05, sd * zd], [x, T1.y + 2.4, sd * zd], [x, T1.y + 3.6, sd * (zd - 0.3)], [x, T1.y + 3.9, sd * (bz + 0.4)], [x, T1.y + 3.6, sd * bz]], 0.09, 6, 10));
          f.push(rod([x, T1.y + 3.55, sd * bz], [x, T1.y + 1.7, sd * bz], 0.02, 4));
        });
        // кильблоки
        [-2.0, 2.0].forEach((dx) => f.push(box(0.3, 0.35, 1.6, bx + dx, T1.y + 0.175, sd * bz, ['-y'])));
      });
    });
    mesh(merge(f), M.steel, 'Superstructure_Fittings', supG);
  }

  // ======================= ПАЛУБА: люк ангара, кнехты, брашпиль, клюзы, тумбы кранов и катапульты
  const deckG = group('Deck', ship);
  {
    const parts = [];
    // комингс и крышка люка ангара (поперечные секции крышки — рёбра)
    {
      const m = new Mesher();
      const yT = deckY(HATCH.x1) + HATCH.h;
      const pts = roundRect(HATCH.x0, HATCH.x1, HATCH.hw, 0.35, 2);
      pts.push(pts[0]);
      const b = [], t = [];
      pts.forEach(([x, z]) => {
        b.push(m.v(new THREE.Vector3(x, deckY(x) - 0.03, z), 0, 0));
        t.push(m.v(new THREE.Vector3(x, yT, z), 0, 1));
      });
      m.strip(b, t);
      const ring = pts.slice(0, -1);
      const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      const ids = ring.map(([x, z]) => m.v(new THREE.Vector3(x, yT, z), 0.5, 0.5));
      tris.forEach(([a, bb, c]) => m.tri(ids[a], ids[bb], ids[c]));
      const g = m.build({ orient: false });
      if (g.attributes.normal.getY(g.attributes.normal.count - 1) < 0) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
        g.computeVertexNormals();
      }
      parts.push(g);
      for (let x = HATCH.x0 + 1.6; x < HATCH.x1 - 1; x += 2.95) parts.push(box(0.22, 0.14, 2 * HATCH.hw - 0.3, x, yT + 0.07, 0, ['-y']));
      parts.push(box(HATCH.x1 - HATCH.x0 - 0.8, 0.12, 0.18, (HATCH.x0 + HATCH.x1) / 2, yT + 0.06, 0, ['-y']));
      // рельсы сдвижной крышки вдоль комингса
      [1, -1].forEach((sd) => parts.push(box(HATCH.x1 - HATCH.x0 + 3, 0.1, 0.16, (HATCH.x0 + HATCH.x1) / 2 + 1.5, yT - 0.35, sd * (HATCH.hw + 0.08), [sd > 0 ? '-z' : '+z'])));
    }
    // тумбы кранов и катапульты (неподвижные)
    [1, -1].forEach((sd) => parts.push(lathe([[0.7, deckY(CRANE.x) - 0.05], [0.7, deckY(CRANE.x) + 0.25], [0.55, deckY(CRANE.x) + 0.4], [0.55, deckY(CRANE.x) + CRANE.h + 0.02]], 18, { top: false }).translate(CRANE.x, 0, sd * CRANE.z)));
    {
      const y0 = deckY(CAT.x - 1.6) - 0.05;
      parts.push(lathe([[1.7, y0], [1.7, y0 + 0.3], [1.3, y0 + 0.6], [1.15, CAT.y - 0.35], [1.25, CAT.y + 0.02]], 24, { top: false }).translate(CAT.x, 0, 0));
      // подкосы тумбы
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        parts.push(rod([CAT.x + 2.6 * Math.cos(a), deckY(CAT.x + 2.6 * Math.cos(a)) - 0.03, 2.6 * Math.sin(a)], [CAT.x + 1.18 * Math.cos(a), CAT.y - 0.5, 1.18 * Math.sin(a)], 0.09, 6));
      }
    }
    // кнехты парные
    const bollard = () => {
      const p = () => lathe([[0.18, -0.05], [0.16, 0.45], [0.22, 0.5], [0.22, 0.56], [0, 0.58]], 10);
      return merge([p().translate(0.45, 0, 0), p().translate(-0.45, 0, 0), box(1.3, 0.1, 0.5, 0, 0.0, 0)]);
    };
    [[48.5, 0.72], [37.5, 0.82], [10.0, 0.86], [-4.0, 0.86], [-51.3, 0.78]].forEach(([x, k]) => {
      [1, -1].forEach((sd) => parts.push(bollard().translate(x, deckY(x), sd * sideZ(x, deckY(x)) * k)));
    });
    // брашпиль на баке и цепные трубы
    {
      const x = 47.2, y = deckY(x);
      parts.push(box(2.2, 0.9, 1.6, x, y + 0.45, 0, ['-y']));
      parts.push(latheX([[0, -2.4], [0.45, -2.3], [0.45, -1.4], [0.5, -1.3], [0.5, 1.3], [0.45, 1.4], [0.45, 2.3], [0, 2.4]], 16, { top: false }).rotateY(Math.PI / 2).translate(x, y + 1.0, 0));
      [1, -1].forEach((sd) => {
        parts.push(lathe([[0.55, 0.06], [0.42, 0.25], [0.42, 0.55], [0.6, 0.6], [0.6, 0.7], [0, 0.72]], 16).translate(x + 1.6, y, sd * 1.75));
        parts.push(lathe([[0.42, -0.05], [0.42, 0.12], [0, 0.14]], 16).translate(51.3, deckY(51.3), sd * 1.9));
      });
    }
    // киповые планки на планшире
    [[44, 0.98], [20, 1], [-30, 1]].forEach(([x]) => {
      [1, -1].forEach((sd) => parts.push(box(0.9, 0.3, 0.32, x, deckY(x) + BUL + 0.15, sd * (sideZ(x, deckY(x) + BUL) - 0.1), ['-y'])));
    });
    mesh(merge(parts), M.steel, 'Deck_Fittings', deckG);
  }

  // ======================= МАЧТЫ И ТАКЕЛАЖ
  const mastG = group('Masts', ship);
  {
    const parts = [];
    const yF = deckY(28) + 2.3;
    parts.push(lathe([[0.34, yF - 0.05], [0.3, 20], [0.24, 23.6], [0.13, 23.6], [0.1, FORE.top], [0, FORE.top + 0.08]], 12).translate(FORE.x, 0, 0));
    parts.push(lathe([[0.12, 19.0], [0.95, 19.0], [1.0, 20.2], [0, 20.25]], 14, { bottom: true }).translate(FORE.x, 0, 0)); // марс-«воронье гнездо»
    parts.push(rod([FORE.x, 23.0, -2.4], [FORE.x, 23.0, 2.4], 0.1, 6)); // рей
    parts.push(rod([FORE.x + 0.2, 13.4, 0], [FORE.x + 6.4, 12.95, 0], 0.15, 8)); // грузовая стрела
    const yM = T1.y;
    parts.push(lathe([[0.3, yM - 0.05], [0.26, 21], [0.2, 24], [0.11, 24], [0.09, MIZ.top], [0, MIZ.top + 0.08]], 12).translate(MIZ.x, 0, 0));
    parts.push(rod([MIZ.x, 23.5, -2.0], [MIZ.x, 23.5, 2.0], 0.09, 6));
    parts.push(rod([MIZ.x - 0.3, yM + 2.2, 0], [-55.0, yM + 2.6, 0], 0.13, 8)); // гик бизани
    parts.push(rod([MIZ.x - 0.3, 21.0, 0], [-52.6, 24.6, 0], 0.1, 8)); // гафель
    // площадки сигнальных фонарей
    parts.push(lathe([[0.12, 25.2], [0.6, 25.2], [0.6, 25.35], [0, 25.36]], 12, { bottom: true }).translate(MIZ.x, 0, 0));
    mesh(merge(parts), M.steel, 'Masts_Spars', mastG);

    // парус-бизань убран на гике (чехол)
    {
      const a = new THREE.Vector3(MIZ.x - 0.6, yM + 2.25, 0), b = new THREE.Vector3(-54.6, yM + 2.6, 0);
      const len = a.distanceTo(b);
      const g = latheX([[0, 0], [0.32, 0.4], [0.42, len * 0.3], [0.38, len * 0.7], [0.25, len - 0.3], [0, len]], 10);
      g.rotateZ(Math.atan2(b.y - a.y, b.x - a.x));
      g.translate(a.x, a.y + 0.36, 0);
      // шлюпки: корпус (сталь) и брезентовый чехол
      const covers = [g];
      const hulls = [];
      BOATS.forEach(([bx, bz]) => {
        [1, -1].forEach((sd) => {
          const yg = T1.y + 1.3;
          const half = (upper) => {
            const m = new Mesher();
            const rows = [];
            const J = 8;
            for (let k = 0; k <= 14; k++) {
              const sx = -1 + (2 * k) / 14;
              const w = Math.max(0.03, Math.sqrt(Math.max(0, 1 - Math.abs(sx) ** (sx > 0 ? 2.0 : 3.0)))) * 1.05;
              const dep = 0.95 * (1 - 0.25 * sx * sx);
              const sheer = 0.18 * sx * sx;
              const row = [];
              for (let j = 0; j <= J; j++) {
                const ang = upper ? Math.PI - (j / J) * Math.PI : Math.PI + (j / J) * Math.PI;
                const yy = upper ? Math.sin(ang) * 0.24 * (w / 1.05 + 0.1) : Math.sin(ang) * dep * Math.min(1, w / 0.6);
                row.push(m.v(new THREE.Vector3(bx + sx * 3.45, yg + sheer + yy, sd * bz + Math.cos(ang) * w), k / 14, j / J));
              }
              rows.push(row);
            }
            for (let k = 0; k < rows.length - 1; k++) m.strip(rows[k], rows[k + 1]);
            const gg = m.build({ orient: false });
            const nA = gg.attributes.normal, pA = gg.attributes.position;
            let sc = 0;
            for (let i = 0; i < pA.count; i++) sc += nA.getY(i) * (pA.getY(i) - yg) + nA.getZ(i) * (pA.getZ(i) - sd * bz);
            return flipIf(gg, sc < 0);
          };
          covers.push(half(true));
          hulls.push(half(false));
        });
      });
      mesh(merge(hulls), M.steel, 'Boat_Hulls', mastG);
      mesh(merge(covers), M.canvas, 'Canvas_Covers', mastG);
    }

    // стоячий такелаж и антенны
    const w = [];
        w.push(rod([MIZ.x, MIZ.top - 0.4, 0], [-55.3, deckY(-55.3) + BUL, 0], 0.025, 4)); // бакштаг
    [1, -1].forEach((sd) => {
      [-1.4, 0.6].forEach((dx) => {
        const x = FORE.x + dx;
        w.push(rod([FORE.x, 22.5, 0], [x, deckY(x) + BUL, sd * (sideZ(x, deckY(x) + BUL) - 0.1)], 0.025, 4));
      });
      [-1.5, 1.2].forEach((dx) => w.push(rod([MIZ.x, 22.5, 0], [MIZ.x + dx, T1.y, sd * (hwT1(MIZ.x + dx) - 0.3)], 0.025, 4)));
      // оттяжки трубы
      [-1, 1].forEach((fx) => w.push(rod([FUN.x - FUN.rake * 8 + fx * 1.2, FUN.y0 + 8, sd * 1.0], [FUN.x + fx * 4.5, T2.y, sd * (T2.hw - 0.3)], 0.025, 4)));
      // топенанты катапультного крана нет — антенна: от фок-мачты к бизани через распорки
      w.push(rod([FORE.x, 23.0, sd * 2.3], [MIZ.x, 23.5, sd * 1.9], 0.018, 4));
    });
    // гафель-фал и шкоты
    w.push(rod([MIZ.x, 24.0, 0], [-52.6, 24.6, 0], 0.02, 4));
    w.push(rod([FORE.x, 22, 0], [FORE.x + 6.3, 13.05, 0], 0.025, 4)); // топенант стрелы
    mesh(merge(w), M.wire, 'Rigging', mastG);
  }

  // ======================= ВООРУЖЕНИЕ: 4 × 12-фунтовых зенитных орудия
  const armsG = group('Armament', ship);
  {
    const tubs = [], peds = [];
    GUNS.forEach(([, x, yb, z]) => {
      const y0 = yb ?? deckY(x);
      // кольцевой бруствер (открыт снизу, без пола)
      tubs.push(lathe([[1.85, y0 - 0.03], [1.85, y0 + 1.0], [1.78, y0 + 1.0], [1.78, y0 - 0.03]], 26, { top: false }).translate(x, 0, z));
      peds.push(lathe([[0.5, y0 - 0.03], [0.5, y0 + 0.12], [0.34, y0 + 0.2], [0.3, y0 + 0.95], [0.38, y0 + 1.0], [0.38, y0 + 1.08]], 18, { top: false }).translate(x, 0, z));
    });
    mesh(merge(tubs), M.steel, 'Gun_Tubs', armsG);
    mesh(merge(peds), M.gun, 'Gun_Pedestals', armsG);
    GUNS.forEach(([name, x, yb, z]) => {
      const y0 = (yb ?? deckY(x)) + 1.08;
      const g = group(name, armsG, x, y0, z);
      const p = [];
      const ty = 0.55;
      p.push(lathe([[0.46, -0.02], [0.46, 0.08], [0, 0.1]], 18));
      [1, -1].forEach((sd) => {
        p.push(prism([[-0.45, 0.06], [0.45, 0.06], [0.22, ty + 0.12], [-0.15, ty + 0.12]], 0.06).translate(0, 0, sd * 0.24));
        p.push(box(0.26, 0.05, 0.22, -0.55, 0.42, sd * 0.55, []));
        p.push(rod([-0.2, 0.1, sd * 0.27], [-0.55, 0.4, sd * 0.55], 0.03, 5));
        p.push(lathe([[0.17, -0.04], [0.17, 0.04], [0, 0.05]], 12).rotateX(Math.PI / 2).translate(0.1, ty - 0.1, sd * 0.36)); // маховики наводки
      });
      p.push(rod([0, ty, -0.27], [0, ty, 0.27], 0.07, 10));
      p.push(box(1.3, 0.3, 0.34, 0.2, ty, 0, []));
      p.push(latheX([[0.15, -0.95], [0.15, -0.55], [0.13, -0.45], [0.1, 0.4], [0.075, 2.2], [0.085, 2.25], [0.085, 2.38], [0.05, 2.38], [0.05, 2.2], [0, 2.2]], 14).translate(0, ty, 0));
      p.push(box(0.36, 0.34, 0.34, -1.1, ty, 0, []));
      p.push(rod([-0.55, ty + 0.22, 0], [0.8, ty + 0.22, 0], 0.07, 8));
      p.push(box(0.5, 0.18, 0.08, -0.25, ty + 0.15, -0.32, []));
      mesh(merge(p), M.gun, `${name}_Mount`, g);
    });
  }

  // ======================= АВИАЦИОННОЕ ОБОРУДОВАНИЕ: катапульта и два паровых крана
  const avG = group('Aviation', ship);
  // катапульта: поворот вокруг вертикали по центру тумбы
  {
    const g = group('Catapult', avG, CAT.x, CAT.y, 0);
    const p = [];
    p.push(lathe([[1.2, -0.02], [1.55, 0.03], [1.55, 0.32], [0, 0.34]], 24)); // поворотный круг
    // ферма-основание: от круга к балке
    const gb = 1.0, gt = 1.85; // низ и верх балки
    const x0 = -9.6, x1 = 12.4;
    [1, -1].forEach((sd) => {
      p.push(prism([[-2.6, 0.32], [2.6, 0.32], [1.6, gb + 0.02], [-1.6, gb + 0.02]], 0.16).translate(0, 0, sd * 0.42));
    });
    // балка: коробчатая, сужение к носу
    {
      const m = new Mesher();
      const sec = (x) => {
        const t = clamp01((x - 6) / (x1 - 6));
        const yb2 = lerp(gb, gt - 0.45, t * t);
        return [new THREE.Vector3(x, yb2, 0.55), new THREE.Vector3(x, gt, 0.55), new THREE.Vector3(x, gt, -0.55), new THREE.Vector3(x, yb2, -0.55)];
      };
      const xs = [x0, -4, 0, 6, 8, 10, x1];
      const rows = xs.map((x) => sec(x).map((v, i) => m.v(v, (x - x0) / (x1 - x0), i / 3)));
      for (let k = 0; k < rows.length - 1; k++) m.strip(rows[k], rows[k + 1], true);
      [0, rows.length - 1].forEach((k) => {
        const r = rows[k];
        if (k === 0) m.quad(r[0], r[1], r[2], r[3]);
        else m.quad(r[3], r[2], r[1], r[0]);
      });
      p.push(m.build());
      // рёбра жёсткости по бортам балки (снаружи, без внутренних граней)
      for (let x = x0 + 1.2; x < x1 - 0.5; x += 1.6) {
        const t = clamp01((x - 6) / (x1 - 6));
        const yb2 = lerp(gb, gt - 0.45, t * t);
        [1, -1].forEach((sd) => p.push(box(0.1, gt - yb2 - 0.04, 0.06, x, (gt + yb2) / 2, sd * 0.58, [sd > 0 ? '-z' : '+z'])));
      }
    }
    // направляющие рельсы и тележка-салазки
    [1, -1].forEach((sd) => p.push(box(x1 - x0 - 0.2, 0.12, 0.14, (x0 + x1) / 2, gt + 0.06, sd * 0.36, ['-y'])));
    p.push(box(1.8, 0.35, 1.3, x0 + 2.2, gt + 0.12 + 0.175, 0, ['-y']));
    [1, -1].forEach((sd) => p.push(box(0.3, 0.6, 0.12, x0 + 2.9, gt + 0.47 + 0.3, sd * 0.55, ['-y'])));
    // пневмоцилиндр под балкой
    p.push(latheX([[0.3, x0 + 0.6], [0.3, 5.5]], 14, { bottom: true, top: true }).translate(0, gb - 0.27, 0));
    [-6, 0, 4].forEach((x) => p.push(box(0.3, 0.12, 0.3, x, gb - 0.02, 0, ['-y', '+y'])));
    mesh(merge(p), M.steel, 'Catapult_Structure', g);
  }
  // паровые краны 3 т: поворот вокруг вертикали по оси колонны
  [1, -1].forEach((sd) => {
    const name = sd > 0 ? 'Crane_R' : 'Crane_L';
    const y0 = deckY(CRANE.x) + CRANE.h;
    const g = group(name, avG, CRANE.x, y0, sd * CRANE.z);
    const p = [];
    p.push(lathe([[0.52, -0.02], [1.35, 0.02], [1.35, 0.3], [0, 0.32]], 22)); // поворотная платформа
    // будка с котлом
    p.push(deckhouse({ x0: -2.5, x1: 0.7, hw: 1.1, r: 0.2, yTop: 2.5, base: () => 0.32 + 0.03 }));
    p.push(lathe([[0.18, 2.48], [0.18, 3.6], [0.24, 3.7], [0.24, 3.8]], 10, { top: false }).translate(-1.9, 0, 0)); // дымовая трубка
    p.push(box(3.4, 0.12, 2.4, -0.9, 2.56, 0, ['-y'])); // свес крыши
    // стрела: четыре пояса, решётка
    const ang = (36 * Math.PI) / 180;
    const L = 12.5;
    const foot = new THREE.Vector3(0.9, 0.7, 0);
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
    const nrm2 = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0);
    const P = (s, side, up) => {
      const w = lerp(0.6, 0.18, s);
      const h = lerp(0.55, 0.16, Math.abs(s - 0.4) * 1.6) * 0.9;
      return foot.clone().addScaledVector(dir, s * L).addScaledVector(nrm2, up * h).add(new THREE.Vector3(0, 0, side * w)).toArray();
    };
    const chords = [[1, 0], [-1, 0], [1, 1], [-1, 1]];
    chords.forEach(([s1, u1]) => p.push(rod(P(0, s1, u1), P(1, s1, u1), 0.07, 5)));
    const NBAY = 9;
    for (let k = 0; k < NBAY; k++) {
      const a = k / NBAY, b = (k + 1) / NBAY;
      p.push(rod(P(a, 1, 0), P(b, 1, 1), 0.035, 4));
      p.push(rod(P(a, -1, 1), P(b, -1, 0), 0.035, 4));
      p.push(rod(P(a, 1, 1), P(b, -1, 1), 0.03, 4));
      p.push(rod(P(a, -1, 0), P(b, 1, 0), 0.03, 4));
    }
    p.push(rod([foot.x, foot.y, -0.75], [foot.x, foot.y, 0.75], 0.09, 8)); // шарнир пяты
    const tip = foot.clone().addScaledVector(dir, L);
    p.push(rod([tip.x, tip.y, -0.25], [tip.x, tip.y, 0.25], 0.3, 12)); // шкив
    // А-образная стойка на будке и топенант
    const apex = [-2.2, 5.0, 0];
    p.push(rod([-1.0, 2.5, 0.9], apex, 0.08, 5));
    p.push(rod([-1.0, 2.5, -0.9], apex, 0.08, 5));
    p.push(rod([-2.4, 2.5, 0], apex, 0.08, 5));
    p.push(rod(apex, [tip.x - 0.2, tip.y + 0.12, 0.15], 0.03, 4));
    p.push(rod(apex, [tip.x - 0.2, tip.y + 0.12, -0.15], 0.03, 4));
    // грузовой трос и гак
    p.push(rod([tip.x + 0.25, tip.y, 0], [tip.x + 0.25, tip.y - 5.0, 0], 0.025, 4));
    p.push(box(0.35, 0.5, 0.25, tip.x + 0.25, tip.y - 5.25, 0, []));
    p.push(new THREE.TorusGeometry(0.18, 0.05, 5, 10, Math.PI * 1.4).rotateZ(Math.PI * 0.8).translate(tip.x + 0.25, tip.y - 5.68, 0));
    mesh(merge(p), M.steel, `${name}_Body`, g);
  });

  // ======================= ДВИЖИТЕЛЬ И РУЛЬ
  const propG = group('Propulsion', ship);
  let prop;
  {
    prop = group('Propeller', propG, PROP.x, PROP.y, 0);
    const blade = bladeGeometry({ r0: 0.4, r1: PROP.r, chord0: 0.9, chord1: 1.5, pitch: 4.2, skew: 0.25, tc: 0.12 });
    const bl = [0, 1, 2, 3].map((i) => blade.clone().rotateX((i * Math.PI) / 2));
    const hub = latheX([[0.0, 0.62], [0.36, 0.58], [0.5, 0.35], [0.5, -0.45], [0.42, -0.65], [0.2, -1.05], [0, -1.15]], 16);
    mesh(merge([...bl, hub]), M.bronze, 'Propeller_Blades', prop);
  }
  {
    const g = group('Rudder', propG, RUD.x, (RUD.y0 + RUD.y1) / 2, 0);
    const half = (RUD.y1 - RUD.y0) / 2;
    const rings = [];
    for (let k = 0; k <= 8; k++) {
      const sy = k / 8;
      const y = -half + 2 * half * sy;
      const ch = (1.55 + 0.7 * Math.sqrt(clamp01(sy / 0.22))) * (1 - 0.12 * smooth((sy - 0.8) / 0.2));
      const ring = [];
      const ts = [];
      for (let j = 0; j <= 10; j++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * j) / 10));
      for (const t of ts) ring.push(new THREE.Vector3(0.18 - t * ch, y, Math.max(0.01, naca(t) * 0.12 * ch)));
      for (let j = 9; j >= 1; j--) ring.push(new THREE.Vector3(0.18 - ts[j] * ch, y, -Math.max(0.01, naca(ts[j]) * 0.12 * ch)));
      rings.push(ring);
    }
    const f = loftRings(rings);
    const stock = lathe([[0.2, -half - 0.05], [0.2, half + 1.0], [0, half + 1.05]], 10, { bottom: true });
    const pintle = [-1.5, 0.2, 1.8].map((y) => box(0.5, 0.2, 0.42, -0.05, y, 0, []));
    const geo = merge([f, stock, ...pintle]);
    uvAt(geo, U(-53), V_FOUL);
    mesh(geo, M.paint, 'Rudder_Blade', g);
  }

  // Анимация: винт правого вращения, 1 оборот за 1 с, 9 ключей, петля замкнута
  {
    const T = 1.0;
    const n = 8;
    const times = [];
    const vals = [];
    const q = new THREE.Quaternion();
    const ax = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i <= n; i++) {
      times.push((T * i) / n);
      q.setFromAxisAngle(ax, -(2 * Math.PI * i) / n);
      vals.push(q.x, q.y, q.z, q.w);
    }
    ship.animations = [new THREE.AnimationClip('Propellers_Spin', T, [new THREE.QuaternionKeyframeTrack('Propeller.quaternion', times, vals)])];
  }

  const find = (n) => ship.getObjectByName(n);
  ship.userData.update = (t = 0) => {
    prop.rotation.x = -2 * Math.PI * t;
  };
  ship.userData.pose = (k = 0) => {
    find('Rudder').rotation.y = 0.6 * k;
    find('Catapult').rotation.y = 0.7 * k;
    find('Crane_L').rotation.y = -1.2 * k;
    find('Crane_R').rotation.y = 1.0 * k;
    find('Gun_1').rotation.y = 0.9 * k;
    find('Gun_2').rotation.y = -0.9 * k;
    find('Gun_3').rotation.y = 1.5 * k;
    find('Gun_4').rotation.y = -2.5 * k;
  };
  return ship;
}
