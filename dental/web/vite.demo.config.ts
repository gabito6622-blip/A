// Demo navegable para una página de Claude: rutas con #, rutas relativas y API grabada.
//   npx vite build --config web/vite.demo.config.ts   (los datos: scripts/demo-fixtures.cjs)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  mode: "demo",
  base: "./",
  plugins: [react()],
  build: { outDir: "dist-demo", emptyOutDir: true, sourcemap: false },
});
