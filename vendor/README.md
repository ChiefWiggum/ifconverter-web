# Vendor fallbacks

Minified copies of `pako`, `jszip`, and `jspdf` for when CDN scripts fail (tests, offline, or blocked networks).

Regenerate after dependency bumps:

```bash
cp node_modules/pako/dist/pako.min.js vendor/pako.min.js
cp node_modules/jszip/dist/jszip.min.js vendor/jszip.min.js
cp node_modules/jspdf/dist/jspdf.umd.min.js vendor/jspdf.umd.min.js
```
