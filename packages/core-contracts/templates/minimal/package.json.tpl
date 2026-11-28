{
  "name": "{{PACKAGE_NAME}}",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "description": "{{CORE_ID}} Core 开发起点",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./admin": { "types": "./dist/admin.d.ts", "default": "./dist/admin.js" },
    "./http": { "types": "./dist/http.d.ts", "default": "./dist/http.js" },
    "./contracts": { "types": "./dist/contracts.d.ts", "default": "./dist/contracts.js" }
  },
  "typesVersions": { "*": {
    "admin": ["dist/admin.d.ts"], "http": ["dist/http.d.ts"], "contracts": ["dist/contracts.d.ts"]
  } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "metadata": "node dist/metadata.js",
    "prepack:core": "npm run build",
    "pack:core": "node scripts/package.cjs"
  },
  "dependencies": {{DEPENDENCIES}},
  "devDependencies": {{DEV_DEPENDENCIES}}
}
