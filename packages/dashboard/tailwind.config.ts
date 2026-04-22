import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        panel: "#111418",
        ink: "#e6eaf0",
        muted: "#6b7380",
        accent: "#7cffb0",
        danger: "#ff6b6b",
      },
    },
  },
  plugins: [],
};

export default config;
