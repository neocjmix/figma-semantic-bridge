# Guide screenshots

These images show the product with the generated example in `src/demo/project.ts`.
They contain no customer designs, personal data or real pairing tokens. Korean
and English screenshots show the same source content; changing the interface
language does not translate that content.

Regenerate after changing the interface:

```sh
npm run build:web
npx tsx scripts/capture-guide-screenshots.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using an installed Chrome binary.
The script runs an isolated local server and does not connect to Figma. The four
named PNGs are explicitly included in release packages and embedded in offline
guides; no other image directory contents are packaged automatically.
