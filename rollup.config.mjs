import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

export default {
  input: "main.user.ts",
  output: {
    file: ".out/main.user.js",
    format: "es",
  },
  plugins: [nodeResolve({ browser: true }), commonjs(), json(), typescript()],
  // Do not bundle these — they are provided by the userscript runtime or global context
  external: [],
};
