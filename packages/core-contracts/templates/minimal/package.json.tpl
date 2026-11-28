{
  "name": "{{PACKAGE_NAME}}",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "description": "{{CORE_ID}} 本人条目 Core 与受控宿主",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./admin": "./admin/index.tsx",
    "./http": {
      "types": "./dist/http.d.ts",
      "default": "./dist/http.js"
    },
    "./contracts": {
      "types": "./dist/contracts.d.ts",
      "default": "./dist/contracts.js"
    },
    "./mysql": {
      "types": "./dist/mysql.d.ts",
      "default": "./dist/mysql.js"
    },
    "./nest": {
      "types": "./dist/nest.d.ts",
      "default": "./dist/nest.js"
    },
    "./platform-host": {
      "types": "./dist/platform-host.d.ts",
      "default": "./dist/platform-host.js"
    },
    "./data-plan": {
      "types": "./dist/data-plan.d.ts",
      "default": "./dist/data-plan.js"
    }
  },
  "typesVersions": {
    "*": {
      "admin": [
        "admin/index.tsx"
      ],
      "http": [
        "dist/http.d.ts"
      ],
      "contracts": [
        "dist/contracts.d.ts"
      ],
      "mysql": [
        "dist/mysql.d.ts"
      ],
      "nest": [
        "dist/nest.d.ts"
      ],
      "platform-host": [
        "dist/platform-host.d.ts"
      ],
      "data-plan": [
        "dist/data-plan.d.ts"
      ]
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc -p host/api/tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit && tsc -p host/api/tsconfig.json --noEmit",
    "lint:admin": "tsc -p host/admin/tsconfig.json",
    "build:admin": "npm run lint:admin && vite build --configLoader runner --config host/admin/vite.config.mts",
    "dev:admin": "vite --configLoader runner --config host/admin/vite.config.mts --host 127.0.0.1 --strictPort",
    "start:api": "node host/api/dist/main.js",
    "prepare:deployment": "node host/api/dist/prepare-deployment.js",
    "metadata": "node dist/metadata.js",
    "prepack:core": "npm run build",
    "pack:core": "node scripts/package.cjs"
  },
  "dependencies": {{DEPENDENCIES}},
  "devDependencies": {{DEV_DEPENDENCIES}}
}
