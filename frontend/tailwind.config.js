/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        body: ["ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "SF Mono", "Consolas", "Liberation Mono", "monospace"],
      },
      boxShadow: {
        brutal: "8px 8px 0 0 #1c1917",
        "brutal-sm": "4px 4px 0 0 #1c1917",
        "brutal-lg": "16px 16px 0 0 #1c1917",
      },
    },
  },
  plugins: [],
};
