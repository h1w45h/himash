import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC нужен ради emitDecoratorMetadata: esbuild его не поддерживает, и DI в NestJS ломается.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  // Интеграционные файлы делят одну БД и тестовую игру — запускаем по очереди.
  test: { fileParallelism: false, include: ['src/**/*.test.ts'], testTimeout: 20_000 },
});
