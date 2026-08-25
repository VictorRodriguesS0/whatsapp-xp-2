import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XP Atendimento",
    short_name: "XP Atendimento",
    description: "Central interna de atendimento da XP Eletrônicos.",
    start_url: "/conversas",
    scope: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    icons: [
      { src: "/icons/xp-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/xp-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/xp-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
