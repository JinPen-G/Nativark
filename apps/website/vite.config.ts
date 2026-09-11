import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The public site deliberately has no business API proxy or database connection.
export default defineConfig({ plugins: [react()] });
