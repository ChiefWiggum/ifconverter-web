# IFConverter Web

A browser-based converter for iFolor photobooks. Convert your photobooks to PNG images entirely in your browser - no server upload required!

## Features

- 🌐 **100% Browser-Based** - All processing happens locally, your files never leave your computer
- 📁 **Drag & Drop** - Simply drag your photobook folder to start
- 🖼️ **Full Page Rendering** - Renders cover and all pages with images and text
- 🔄 **Image Transformations** - Supports rotation, zoom, crop, and mirror
- 📝 **Text Rendering** - Parses and renders XAML text content
- 💾 **Batch Export** - Download all pages as individual PNGs or as a ZIP
- ⚙️ **Configurable** - Adjust DPI, preview scale, and background color

## Quick Start

### Option 1: Open directly

Just open `index.html` in a modern web browser (Chrome, Firefox, Edge, Safari).

### Option 2: Use a local server

For best results, serve the files with a local HTTP server:

```bash
# Using Python 3
python -m http.server 8080

# Using Node.js (npx)
npx serve .

# Using PHP
php -S localhost:8080
```

Then open http://localhost:8080 in your browser.

## Usage

1. **Load your photobook** - Either:
   - Drag and drop your entire photobook folder onto the drop zone
   - Use the file buttons to select `Project.ipp`, Photos, and Texts separately

2. **Configure options** (optional):
   - **Output DPI**: Quality of rendered images (72-600)
   - **Background Color**: Override the page background
   - **Preview Scale**: Reduce preview size for faster rendering

3. **Render pages**:
   - Click "Render All Pages" to generate PNG images
   - Each page will appear in a card with a download button

4. **Export**:
   - Download individual pages using the button on each card
   - Or click "Download All as ZIP" to get everything at once

## Photobook Folder Structure

Your iFolor photobook folder should have this structure:

```
PhotobookFolder/
├── Project.ipp          # Main project file (required)
├── Photos/              # User photos
│   ├── {guid1}
│   ├── {guid2}
│   └── ...
└── Texts/               # Text content files
    ├── {guid1}
    ├── {guid2}
    └── ...
```

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome 80+ | ✅ Full support |
| Firefox 75+ | ✅ Full support |
| Edge 80+ | ✅ Full support |
| Safari 14+ | ✅ Full support |
| Internet Explorer | ❌ Not supported |

## Technical Details

### File Format Handling

- **Project.ipp**: 23-byte header + GZip-compressed XML
- **Text files**: 23-byte header + GZip-compressed ZIP containing XAML

### Libraries Used

- [pako](https://github.com/nodeca/pako) - GZip decompression
- [JSZip](https://stuk.github.io/jszip/) - ZIP file handling

### Limitations

- **Clipart**: Plugin clipart is not supported (requires iFolor resources)
- **Speech Bubbles**: Not currently implemented
- **Some fonts**: May fall back to system fonts if specific fonts are unavailable
- **Large files**: Very large photobooks may be slow on older devices

## Privacy

**Your files are 100% private.** 

All processing happens entirely in your browser using JavaScript. No files are uploaded to any server. This application works completely offline after the initial page load.

## Development

The project structure:

```
ifconverter-web/
├── index.html          # Main HTML page
├── css/
│   └── style.css       # Styles
├── js/
│   ├── app.js          # Main application
│   ├── parser.js       # iFolor file parser
│   ├── renderer.js     # Canvas rendering
│   └── logger.js       # UI logging
└── README.md
```

To modify:

1. Edit the JavaScript modules in the `js/` folder
2. Styles are in `css/style.css`
3. Main HTML structure is in `index.html`

## License

MIT License - See LICENSE file for details.
