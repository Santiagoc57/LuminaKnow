import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite una segunda copia de pruebas sin chocar con la que está abierta.
  distDir: process.env.LUMINA_DIST_DIR || ".next",
  agentRules: false,
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
  serverExternalPackages: ["better-sqlite3", "sqlite-vec", "@huggingface/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
