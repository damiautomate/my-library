import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/contexts/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: "#FDFBF5",
          100: "#F8F2E2",
          200: "#F1E8CE",
          300: "#E8DBB0",
          400: "#D9C68A",
        },
        ink: {
          500: "#7A6650",
          600: "#5C4A3A",
          700: "#3D2E22",
          800: "#2A1F18",
          900: "#1A1410",
        },
        oxblood: {
          50: "#FAF0EF",
          400: "#A0463F",
          600: "#7B2D26",
          700: "#5C201B",
          800: "#3F1612",
        },
        forest: {
          50: "#EEF3EF",
          400: "#3C6E50",
          600: "#1F3D2F",
          700: "#152A20",
          800: "#0D1B15",
        },
        gold: {
          400: "#C9A961",
          500: "#B89549",
          600: "#9C7E3D",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      boxShadow: {
        "paper": "0 1px 2px rgba(26, 20, 16, 0.04), 0 4px 16px rgba(26, 20, 16, 0.06)",
        "paper-lg": "0 2px 4px rgba(26, 20, 16, 0.05), 0 12px 32px rgba(26, 20, 16, 0.08)",
        "inset-warm": "inset 0 1px 2px rgba(26, 20, 16, 0.06)",
      },
      backgroundImage: {
        "paper-grain":
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")",
      },
    },
  },
  plugins: [],
};

export default config;
