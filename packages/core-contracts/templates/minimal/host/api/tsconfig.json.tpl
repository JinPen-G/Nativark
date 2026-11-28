{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src", "outDir": "dist", "declaration": false,
    "baseUrl": "../..", "paths": {
      "{{PACKAGE_NAME}}": ["dist/index.d.ts"], "{{PACKAGE_NAME}}/*": ["dist/*.d.ts"]
    }
  },
  "include": ["src/**/*.ts"]
}
