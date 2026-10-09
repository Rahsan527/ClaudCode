// Просмотр своих моделей: перетащите .glb из Blender в окно браузера.
// Модель ставится рядом с персонажем в реальном масштабе, а справа
// показывается статистика — удобно проверять экспорт.
import * as THREE from 'three';
import { gltfLoader, enableShadows } from './loader.js';

const info = document.getElementById('info');

export class ModelViewer {
  constructor(scene, getAnchor) {
    this.scene = scene;
    this.getAnchor = getAnchor; // откуда ставить модель (позиция персонажа)
    this.model = null;
    this.mixer = null;

    document.getElementById('file').addEventListener('change', (e) => {
      if (e.target.files[0]) this.loadFile(e.target.files[0]);
      e.target.value = '';
    });

    let depth = 0;
    addEventListener('dragenter', (e) => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    addEventListener('dragleave', () => { if (--depth === 0) document.body.classList.remove('dragging'); });
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) this.loadFile(file);
    });
  }

  async loadFile(file) {
    if (!/\.(glb|gltf)$/i.test(file.name)) {
      this.showError(`«${file.name}» — не glTF. Экспортируйте из Blender: File → Export → glTF 2.0 (.glb).`);
      return;
    }
    try {
      // .gltf с внешними .bin/текстурами так не загрузится — используйте .glb
      const gltf = await gltfLoader.parseAsync(await file.arrayBuffer(), '');
      this.show(gltf, file);
    } catch (err) {
      console.error(err);
      this.showError(`Не удалось загрузить «${file.name}»: ${err.message}`);
    }
  }

  show(gltf, file) {
    if (this.model) this.scene.remove(this.model);

    const model = gltf.scene;
    enableShadows(model);

    // Ставим модель на землю справа от персонажа, с зазором 1 м
    const box = new THREE.Box3().setFromObject(model);
    const width = box.max.x - box.min.x;
    const anchor = this.getAnchor();
    model.position.set(
      anchor.x + 1 + width / 2 - (box.min.x + box.max.x) / 2,
      -box.min.y,
      anchor.z - (box.min.z + box.max.z) / 2,
    );
    this.scene.add(model);
    this.model = model;

    this.mixer = null;
    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(model);
      this.mixer.clipAction(gltf.animations[0]).play();
    }

    this.renderInfo(gltf, file, box);
  }

  renderInfo(gltf, file, box) {
    let meshes = 0, triangles = 0, skinned = false;
    const materials = new Set(), textures = new Set();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      skinned ||= o.isSkinnedMesh;
      const g = o.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of [o.material].flat()) {
        materials.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      }
    });

    const size = box.getSize(new THREE.Vector3());
    const fmt = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

    // Подсказки по типичным ошибкам экспорта
    const warnings = [];
    const maxSide = Math.max(size.x, size.y, size.z);
    if (maxSide > 100) warnings.push('Модель огромная — возможно, масштаб в Blender не 1 ед. = 1 м или не применены трансформации (Ctrl+A).');
    if (maxSide < 0.05) warnings.push('Модель крошечная — проверьте масштаб и Apply Scale (Ctrl+A).');
    if (triangles > 300_000) warnings.push('Много треугольников для веба — попробуйте модификатор Decimate.');
    if (file.size > 20 * 1024 * 1024) warnings.push('Файл больше 20 МБ — сожмите: npx @gltf-transform/cli optimize in.glb out.glb');

    info.innerHTML = `
      <h2>${escapeHtml(file.name)}</h2>
      <table>
        <tr><td>Размер файла</td><td>${fmt(file.size / 1024 / 1024)} МБ</td></tr>
        <tr><td>Габариты (Ш×В×Г)</td><td>${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} м</td></tr>
        <tr><td>Треугольников</td><td>${fmt(Math.round(triangles))}</td></tr>
        <tr><td>Мешей</td><td>${meshes}</td></tr>
        <tr><td>Материалов</td><td>${materials.size}</td></tr>
        <tr><td>Текстур</td><td>${textures.size}</td></tr>
        <tr><td>Скелет (skinning)</td><td>${skinned ? 'да' : 'нет'}</td></tr>
        <tr><td>Анимаций</td><td>${gltf.animations.length}</td></tr>
      </table>
      ${gltf.animations.length ? `<select id="anim">${gltf.animations.map((c, i) => `<option value="${i}">${escapeHtml(c.name)} (${fmt(c.duration)} с)</option>`).join('')}</select>` : ''}
      ${warnings.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join('')}
      <label class="button" id="remove">Убрать модель</label>
    `;
    info.hidden = false;

    info.querySelector('#anim')?.addEventListener('change', (e) => {
      this.mixer.stopAllAction();
      this.mixer.clipAction(gltf.animations[e.target.value]).play();
    });
    info.querySelector('#remove').addEventListener('click', () => {
      this.scene.remove(this.model);
      this.model = this.mixer = null;
      info.hidden = true;
    });
  }

  showError(message) {
    info.innerHTML = `<p class="warn">${escapeHtml(message)}</p>`;
    info.hidden = false;
  }

  update(dt) {
    this.mixer?.update(dt);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
