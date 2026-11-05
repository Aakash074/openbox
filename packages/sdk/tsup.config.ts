import { defineConfig } from "tsup";
export default defineConfig([
  { entry: { index: "src/index.ts" }, format: ["esm"], dts: true, clean: true, noExternal: ["@openbox/shared"] },
  { entry: { "openbox-checkout": "src/global.ts" }, format: ["iife"], globalName: "OpenBoxBundle", minify: true, noExternal: [/.*/], platform: "browser" },
]);
