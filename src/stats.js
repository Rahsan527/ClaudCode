// Панель производительности: FPS и то, что реально рисует видеокарта.
const el = document.getElementById('stats');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

let frames = 0;
let elapsed = 0;
let fps = 0;
let frameMs = 0;

export function updateStats(renderer, dt, cpuMs) {
  frames++;
  elapsed += dt;
  frameMs += cpuMs;
  if (elapsed < 0.5) return;

  fps = frames / elapsed;
  const { render, memory } = renderer.info;
  el.innerHTML = `
    <table>
      <tr><td>FPS</td><td>${fmt(fps)}</td></tr>
      <tr><td>Кадр на CPU</td><td>${(frameMs / frames).toFixed(1)} мс</td></tr>
      <tr><td>Треугольников в кадре</td><td>${fmt(render.triangles)}</td></tr>
      <tr><td>Draw calls</td><td>${fmt(render.calls)}</td></tr>
      <tr><td>Геометрий в памяти</td><td>${fmt(memory.geometries)}</td></tr>
      <tr><td>Текстур в памяти</td><td>${fmt(memory.textures)}</td></tr>
    </table>`;
  frames = 0;
  elapsed = 0;
  frameMs = 0;
}
