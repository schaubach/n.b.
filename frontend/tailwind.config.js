/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["Outfit", "sans-serif"],
        body: ["Satoshi", "Outfit", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
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
