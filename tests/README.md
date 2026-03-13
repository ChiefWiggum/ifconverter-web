# Visual Regression Tests

These tests render selected pages from the supported albums and compare them to reference screenshots from the iFolor app. You can run them repeatedly while adjusting the renderer and use the diff images to see exactly where the output diverges.

## Prerequisites

1. **Photobooks** present locally:
   - `d:\Documents\ifolor\Photobooks\Cook Islands 2014`
   - `d:\Documents\ifolor\Photobooks\Indien_China`
2. **Reference images** stored under:
   - `tests/fixtures/cook-islands/`
   - `tests/fixtures/india-china/`
3. **Playwright browser** installed once: `npx playwright install chromium`

## Run the test

```bash
npm run test:visual
```

The config starts the app automatically with `npm start` and runs the suite at `http://localhost:3000`.

The suite:

- Loads the project, photos, and texts from each album folder
- Opens `Render some pages`
- Selects the configured spread or page
- Renders it in the browser
- Compares the result against the matching reference image

Both images are resized to a common width before comparison. Most spread tests mask the center binding strip to avoid false positives from gutter rendering.

Rendered outputs and diff images are written under:

```text
tests/output/visual-comparisons/
```

## Current Fixture Layout

```text
tests/fixtures/
  cook-islands/
    reference-pages-1.png
    reference-pages-10-11.png
    reference-pages-14-15.png
  india-china/
    reference-pages-10-11.png
    reference-pages-16-17.png
    reference-pages-20-21.png
    reference-pages-22-23.png
    reference-pages-46-47.png
    reference-pages-52-53.png
    reference-pages-58-59.png
    reference-pages-60.png
```

## If the test fails

- Inspect the **diff image** (path is printed in the error) to see where our render differs from the reference.
- You can relax or tighten comparison in the spec:
  - `MAX_DIFF_RATIO` (default `0.05`) – allow more or fewer pixel differences.
  - `PIXEL_THRESHOLD` (default `0.2`) – sensitivity of pixel matching.
- If you add more references, extend the `ALBUM_CASES` list in `tests/album-visual-regression.spec.mjs`.

## First run without reference

If a reference file is missing, that individual test is skipped. Add the screenshot to the matching album subfolder and rerun the suite.
