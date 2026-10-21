import * as THREE from 'three';

// Ваза в чернофигурном стиле: форма — LatheGeometry, роспись — текстура,
// нарисованная кодом на <canvas>. Внешних картинок нет.
export function createVase() {
  const vase = new THREE.Group();
  vase.name = 'Vase';

  // Контрольные точки силуэта [радиус, высота]. Сплайн сглаживает их и делит
  // на отрезки равной длины, тогда роспись ложится без растяжений.
  const outline = new THREE.SplineCurve(
    [
      [0.34, 0], [0.4, 0.06], [0.36, 0.14], [0.5, 0.4], [0.72, 0.9], [0.76, 1.15],
      [0.66, 1.5], [0.42, 1.85], [0.3, 2.1], [0.3, 2.3], [0.44, 2.42],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
  );
  const profile = [new THREE.Vector2(0, 0), ...outline.getSpacedPoints(64)];
  const geometry = new THREE.LatheGeometry(profile, 64);

  const texture = new THREE.CanvasTexture(paintPattern());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const outer = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 }));
  vase.add(outer);

  // Внутренняя стенка: та же форма чуть меньше, видна только изнутри
  const innerGeometry = geometry.clone();
  innerGeometry.scale(0.92, 0.985, 0.92);
  innerGeometry.translate(0, 0.035, 0);
  const inner = new THREE.Mesh(
    innerGeometry,
    new THREE.MeshStandardMaterial({ color: 0x8a4526, roughness: 0.8, side: THREE.BackSide }),
  );
  vase.add(inner);

  // Кромка горлышка закрывает щель между стенками
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.4225, 0.02, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x1d1512, roughness: 0.5 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 2.42;
  vase.add(rim);

  return vase;
}

// Верх холста — горлышко, низ — ножка. По горизонтали узоры повторяются
// целое число раз, чтобы на шве текстуры не было стыка.
function paintPattern(size = 1024) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const clay = '#c8693a';
  const black = '#1d1512';
  const y = (fraction) => fraction * size;

  ctx.fillStyle = clay;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = black;
  const band = (from, to) => ctx.fillRect(0, y(from), size, y(to) - y(from));
  band(0, 0.05); // губа горлышка
  band(0.2, 0.225);
  band(0.335, 0.345);
  band(0.48, 0.49);
  band(0.52, 0.66); // фон для волн
  band(0.685, 0.695);
  band(0.86, 1); // ножка

  // Зигзаг на горлышке
  const teeth = 16;
  const toothW = size / teeth;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    ctx.moveTo(i * toothW, y(0.18));
    ctx.lineTo(i * toothW + toothW / 2, y(0.08));
    ctx.lineTo((i + 1) * toothW, y(0.18));
  }
  ctx.fill();

  // Ряд точек на плече
  const dots = 32;
  for (let i = 0; i < dots; i++) {
    ctx.beginPath();
    ctx.arc((i + 0.5) * (size / dots), y(0.28), 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // Меандр: спираль-ключ в каждой ячейке и общая линия снизу
  const cells = 16;
  const s = size / cells;
  const top = y(0.36);
  ctx.strokeStyle = black;
  ctx.lineWidth = 9;
  ctx.lineJoin = 'miter';
  for (let i = 0; i < cells; i++) {
    const x = i * s;
    ctx.beginPath();
    ctx.moveTo(x + 4, top + s);
    ctx.lineTo(x + 4, top + 4);
    ctx.lineTo(x + s * 0.82, top + 4);
    ctx.lineTo(x + s * 0.82, top + s * 0.72);
    ctx.lineTo(x + s * 0.28, top + s * 0.72);
    ctx.lineTo(x + s * 0.28, top + s * 0.3);
    ctx.lineTo(x + s * 0.56, top + s * 0.3);
    ctx.lineTo(x + s * 0.56, top + s * 0.48);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, top + s);
  ctx.lineTo(size, top + s);
  ctx.stroke();

  // Волны цвета глины на чёрном поясе
  ctx.strokeStyle = clay;
  ctx.lineWidth = 12;
  ctx.beginPath();
  for (let x = 0; x <= size; x += 4) {
    const wave = y(0.59) + Math.sin((x / size) * Math.PI * 2 * 8) * y(0.035);
    if (x === 0) ctx.moveTo(x, wave);
    else ctx.lineTo(x, wave);
  }
  ctx.stroke();

  // Лучи, растущие от ножки
  const rays = 24;
  const rayW = size / rays;
  ctx.beginPath();
  for (let i = 0; i < rays; i++) {
    ctx.moveTo(i * rayW + 3, y(0.86));
    ctx.lineTo(i * rayW + rayW / 2, y(0.72));
    ctx.lineTo((i + 1) * rayW - 3, y(0.86));
  }
  ctx.fill();

  return canvas;
}
