// Скачивает тяжёлые демо-сцены и оптимизирует их для веба через glTF Transform.
// Запуск: npm run models
//
// Модели не хранятся в репозитории: они большие и у Sponza своя лицензия
// (Cryengine Limited License). Результат кладётся в public/models/scenes/.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const OUT_DIR = 'public/models/scenes';
const CACHE_DIR = 'node_modules/.cache/scene-sources';

const SCENES = [
  {
    // Atrium Sponza (Crytek), PBR-версия из образцов Khronos: .gltf + .bin + 69 текстур, ~52 МБ
    name: 'Sponza',
    base: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Sponza/glTF/',
    entry: 'Sponza.gltf',
  },
  {
    // «Littlest Tokyo» by Glen Fox (CC BY 4.0), из примеров three.js: один .glb с Draco и анимацией
    name: 'LittlestTokyo',
    base: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/',
    entry: 'LittlestTokyo.glb',
  },
];

async function download(url, file) {
  try {
    await access(file);
    return; // уже скачано
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

await mkdir(OUT_DIR, { recursive: true });

for (const scene of SCENES) {
  const srcDir = path.join(CACHE_DIR, scene.name);
  const entry = path.join(srcDir, scene.entry);
  console.log(`\n▶ ${scene.name}: скачиваю…`);
  await download(scene.base + scene.entry, entry);

  // У .gltf буферы и текстуры лежат отдельными файлами — докачиваем их
  if (scene.entry.endsWith('.gltf')) {
    const gltf = JSON.parse(await readFile(entry, 'utf8'));
    const uris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])]
      .map((x) => x.uri)
      .filter((uri) => uri && !uri.startsWith('data:'));
    let done = 0;
    for (const uri of uris) {
      await download(scene.base + uri, path.join(srcDir, decodeURIComponent(uri)));
      process.stdout.write(`\r  файлов: ${++done}/${uris.length}`);
    }
    process.stdout.write('\n');
  }

  // Оптимизация: Meshopt-сжатие геометрии, текстуры в WebP (не больше 2048 px),
  // склейка мешей с одинаковым материалом. Упрощение геометрии выключено —
  // нам нужна сцена во всей её сложности.
  console.log(`  оптимизирую…`);
  execFileSync(
    process.execPath,
    [
      'node_modules/@gltf-transform/cli/bin/cli.js',
      'optimize',
      entry,
      path.join(OUT_DIR, `${scene.name}.glb`),
      '--compress', 'meshopt',
      '--texture-compress', 'webp',
      '--texture-size', '2048',
      '--simplify', 'false',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

console.log(`\nГотово: сцены лежат в ${OUT_DIR}/`);
