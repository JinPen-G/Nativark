module.exports = {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "\"Segoe UI\"",
          "Roboto",
          "sans-serif"
        ]
      },
      colors: {
        rimo: "#00689E"
      }
    }
  },
  plugins: []
};
