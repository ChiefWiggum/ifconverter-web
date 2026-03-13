# Test Fixtures

Reference screenshots are organized by album:

```text
tests/fixtures/
  cook-islands/
  india-china/
```

Use filenames in the form:

```text
reference-pages-10-11.png
reference-pages-52-53.png
reference-pages-60.png
```

Each image should be a screenshot from the iFolor app for the exact spread or page named in the file.

The visual tests render the same selection in IFConverter Web, resize both images to a common size, and compare them with `pixelmatch`.
