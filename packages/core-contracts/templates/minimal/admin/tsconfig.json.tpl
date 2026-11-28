{
  "extends": "../../platform-admin/tsconfig.json",
  "compilerOptions": {
    "types": [
      "node",
      "vite/client"
    ],
    "paths": {
      "{{PACKAGE_NAME}}/contracts": [
        "../dist/contracts.d.ts"
      ],
      "{{PACKAGE_NAME}}/http": [
        "../dist/http.d.ts"
      ],
      "@/registry/*": [
        "../../ui-arc/vendor/registry/*"
      ],
      "@/lib/motion-tokens": [
        "../../ui-arc/vendor/lib/motion-tokens.ts"
      ],
      "@/lib/media": [
        "../../ui-arc/vendor/lib/media.ts"
      ],
      "@/lib/use-copy-feedback": [
        "../../ui-arc/vendor/lib/use-copy-feedback.ts"
      ],
      "@/lib/use-today": [
        "../../ui-arc/vendor/lib/use-today.ts"
      ],
      "@/lib/usePrefersReducedMotion": [
        "../../platform-admin/src/lib/usePrefersReducedMotion.ts"
      ]
    }
  },
  "include": [
    "**/*.tsx"
  ]
}
