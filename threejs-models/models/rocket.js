import * as THREE from 'three';

// Ракета: корпус, обтекатель и сопло — тела вращения (LatheGeometry),
// стабилизаторы — плоский контур, вытянутый через ExtrudeGeometry.
export function createRocket({ fins = 3 } = {}) {
  const rocket = new THREE.Group();
  rocket.name = 'Rocket';

  const hull = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.35, metalness: 0.2 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xd8432e, roughness: 0.45, metalness: 0.1 });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x4a5058,
    roughness: 0.4,
    metalness: 0.8,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fd8ff,
    emissive: 0x2a7fd4,
    emissiveIntensity: 0.5,
    roughness: 0.1,
    metalness: 0.3,
  });

  // Корабль висит над землёй, под ним помещается пламя
  const ship = new THREE.Group();
  rocket.add(ship);

  // Профиль: точки [радиус, высота] снизу вверх. Lathe вращает его вокруг оси Y.
  const lathe = (points, material, segments = 40) =>
    new THREE.Mesh(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments), material);

  ship.add(lathe([[0, 0], [0.4, 0], [0.48, 0.12], [0.54, 0.45], [0.56, 1.0], [0.53, 1.55]], hull));
  ship.add(lathe([[0.53, 1.55], [0.49, 1.85], [0.39, 2.15], [0.24, 2.45], [0.09, 2.66], [0, 2.72]], paint));
  ship.add(lathe([[0.52, 0.32], [0.557, 0.34], [0.557, 0.5], [0.542, 0.52]], paint)); // полоса
  ship.add(lathe([[0.38, -0.3], [0.31, -0.16], [0.25, -0.04], [0.3, 0.02]], metal, 24)); // сопло

  // Иллюминатор: кольцо и приплюснутая сфера
  const porthole = new THREE.Group();
  porthole.position.set(0, 1.12, 0.55);
  porthole.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 10, 32), metal));
  const pane = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12), glass);
  pane.scale.z = 0.3;
  porthole.add(pane);
  ship.add(porthole);

  // Стабилизатор рисуем контуром в плоскости XY и выдавливаем с фаской
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0.85);
  finShape.lineTo(0, 0.05);
  finShape.lineTo(0.5, -0.3);
  finShape.lineTo(0.56, -0.12);
  finShape.quadraticCurveTo(0.42, 0.4, 0, 0.85);
  const finGeometry = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 8,
  });
  finGeometry.translate(0.42, 0, -0.025);
  for (let i = 0; i < fins; i++) {
    const fin = new THREE.Mesh(finGeometry, paint);
    fin.rotation.y = Math.PI / 2 + (i / fins) * Math.PI * 2;
    ship.add(fin);
  }

  // Пламя: два открытых конуса остриём вниз
  const flame = new THREE.Group();
  flame.position.y = -0.28;
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 0.9, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85 }),
  );
  outer.rotation.x = Math.PI;
  outer.position.y = -0.45;
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.55, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2a8 }),
  );
  inner.rotation.x = Math.PI;
  inner.position.y = -0.275;
  flame.add(outer, inner);
  ship.add(flame);

  const hoverHeight = 1.22;
  ship.position.y = hoverHeight;

  rocket.userData.update = (time) => {
    ship.position.y = hoverHeight + Math.sin(time * 1.6) * 0.06;
    ship.rotation.z = Math.sin(time * 1.1) * 0.03;
    const flicker = 1 + Math.sin(time * 23) * 0.12 + Math.sin(time * 51) * 0.06;
    flame.scale.set(1 + Math.sin(time * 37) * 0.06, flicker, 1 + Math.sin(time * 41) * 0.06);
  };

  return rocket;
}
