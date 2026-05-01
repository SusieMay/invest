/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Skala stone przepięta na zmienne CSS (kanały RGB) — pozwala
        // motywowi ciemnemu odwrócić paletę bez hacka filter: invert.
        stone: {
          50: 'rgb(var(--c-stone-50) / <alpha-value>)',
          100: 'rgb(var(--c-stone-100) / <alpha-value>)',
          200: 'rgb(var(--c-stone-200) / <alpha-value>)',
          300: 'rgb(var(--c-stone-300) / <alpha-value>)',
          400: 'rgb(var(--c-stone-400) / <alpha-value>)',
          500: 'rgb(var(--c-stone-500) / <alpha-value>)',
          600: 'rgb(var(--c-stone-600) / <alpha-value>)',
          700: 'rgb(var(--c-stone-700) / <alpha-value>)',
          800: 'rgb(var(--c-stone-800) / <alpha-value>)',
          900: 'rgb(var(--c-stone-900) / <alpha-value>)',
          950: 'rgb(var(--c-stone-950) / <alpha-value>)',
        },
        // Tokeny semantyczne motywu.
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        surface2: 'rgb(var(--c-surface2) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        strong: 'rgb(var(--c-strong) / <alpha-value>)',
        overlay: 'rgb(var(--c-overlay) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
