import { transform } from 'esbuild';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8's Oxc transform only lowers legacy decorators, so Lit's standard
  // `accessor` decorators would reach Node untransformed. Transpile TS with
  // esbuild instead, which lowers them like tsc does for the rollup build.
  oxc: false,
  plugins: [
    {
      name: 'esbuild-ts',
      enforce: 'pre',
      async transform(code, id) {
        if (!id.endsWith('.ts')) return null;
        const result = await transform(code, { loader: 'ts', target: 'es2022', sourcemap: true, sourcefile: id });
        return { code: result.code, map: result.map };
      },
    },
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/index.ts', 'src/ha-types.ts'],
    },
  },
});
