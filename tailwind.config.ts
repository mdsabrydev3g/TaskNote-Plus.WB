import type { Config } from "tailwindcss";

/**
 * Every neutral colour resolves through a CSS variable defined in globals.css
 * and flipped by `.dark`, so existing `bg-white` / `text-slate-500` /
 * `border-slate-200` classes adapt to the dark theme without per-component
 * `dark:` variants. Brand/accent stay literal.
 */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // TaskNote Plus brand — calm indigo/teal, "reduce anxiety" per §4 Calm Rule
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        accent: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
        },

        // ── Themed neutrals ────────────────────────────────────────────────
        // `white` collapses to the raised-surface token so `bg-white` becomes
        // the card colour in dark mode. `text-white` must stay pure white
        // (it always sits on a brand/status fill), so it is overridden below.
        white: v("--bg-surface"),
        "pure-white": "#ffffff",
        surface: {
          DEFAULT: v("--bg-surface"),
          subtle: v("--bg-subtle"),
          muted: v("--bg-muted"),
          inset: v("--bg-inset"),
          border: v("--border"),
        },
        ink: {
          DEFAULT: v("--ink"),
          soft: v("--ink-soft"),
          muted: v("--ink-muted"),
          faint: v("--ink-faint"),
        },

        // The slate scale is remapped onto the semantic tokens. Components use
        // slate-50/100/200 for fills, borders and muted text, so routing them
        // through the tokens is what makes dark mode work globally.
        slate: {
          50: v("--bg-subtle"),
          100: v("--bg-muted"),
          200: v("--border"),
          300: v("--border-strong"),
          400: v("--ink-faint"),
          500: v("--ink-muted"),
          600: v("--ink-muted"),
          700: v("--ink-soft"),
          800: v("--ink-soft"),
          900: v("--ink"),
          950: v("--ink"),
        },

        // Semantic states (productivity status colours — not finance)
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
        info: "#3b82f6",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Inter",
          "Cairo",
          "Noto Sans Arabic",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        lift: "0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.05)",
        pop: "0 12px 32px -8px rgb(15 23 42 / 0.18)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-rtl": {
          from: { opacity: "0", transform: "translateX(12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in": "slide-in-rtl 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
