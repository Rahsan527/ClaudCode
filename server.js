// Продакшен-сервер: раздаёт собранный Vite-ом клиент из dist/.
// Для разработки используйте `npm run dev` (Vite с горячей перезагрузкой).
import express from 'express';
import { existsSync } from 'node:fs';

const PORT = process.env.PORT || 3000;
const app = express();

if (!existsSync('dist')) {
  console.error('Папка dist/ не найдена. Сначала выполните: npm run build');
  process.exit(1);
}

app.use(express.static('dist'));
app.listen(PORT, () => console.log(`Игра запущена: http://localhost:${PORT}`));
