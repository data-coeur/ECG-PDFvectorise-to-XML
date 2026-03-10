/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        primary: { DEFAULT: '#0891b2', light: '#22d3ee', dark: '#0e7490' },
        ecg: { trace: '#059669', paper: '#fff5f5', grid: '#fce4ec', gridDark: '#f8bbd0' },
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
};
