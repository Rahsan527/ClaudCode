// Уровни: тяжёлые сцены, скачанные `npm run models`.
// Добавить свой уровень — положите .glb в public/models/ и допишите сюда.
export const LEVELS = {
  meadow: {
    title: 'Поляна — примитивы Three.js',
  },
  sponza: {
    title: 'Sponza — дворец (262 тыс. треугольников, 69 текстур)',
    url: '/models/scenes/Sponza.glb',
    credit: 'Atrium Sponza © Crytek, PBR-текстуры Alexandre Pestana, Cryengine Limited License',
    meadow: false, // своя геометрия, поляна не нужна
    spawn: [0, 0, 0],
    camera: [-6, 3, 0], // смещение камеры от персонажа
  },
  tokyo: {
    title: 'Littlest Tokyo — анимированный квартал (~140 тыс. треугольников)',
    url: '/models/scenes/LittlestTokyo.glb',
    credit: '«Littlest Tokyo» by Glen Fox, CC BY 4.0',
    meadow: true,
    fit: 12, // вписать в 12 м по ширине
    at: [0, 0, -10], // где поставить на поляне
    spawn: [0, 0, 2],
    camera: [0, 9, 17], // общий план на квартал
  },
};
