/**
 * IFolor File Parser
 *
 * Handles parsing of iFolor photobook files:
 * - Project.ipp (23-byte header + gzip XML)
 * - Text files (23-byte header + gzip ZIP containing XAML)
 */

export class IFolorParser {
    constructor() {
        this.GZIP_OFFSET = 23;
    }

    /**
     * Parse a Project.ipp file
     * @param {ArrayBuffer} buffer - The file contents
     * @returns {Object} Parsed project data
     */
    async parseProject(buffer) {
        // Skip the 23-byte header and decompress
        const gzipData = new Uint8Array(buffer, this.GZIP_OFFSET);
        const xmlData = pako.inflate(gzipData);
        const xmlString = new TextDecoder().decode(xmlData);

        // Parse XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'text/xml');

        // Check for parse errors
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Invalid XML in project file');
        }

        const root = doc.documentElement;

        return {
            designCenterVersion: root.getAttribute('designCenterVersion'),
            version: root.getAttribute('version'),
            created: root.getAttribute('created'),
            productId: this.getTextContent(root, 'ProductId'),
            projectId: this.getTextContent(root, 'ProjectId'),
            projectCare: this.parseProjectCare(root.querySelector('ProjectCare')),
            photoInformations: this.parsePhotoInformations(root.querySelector('PhotoInformations')),
            cover: this.parsePage(root.querySelector('Cover')),
            pages: this.parsePages(root.querySelector('Pages'))
        };
    }

    /**
     * Parse a text file containing XAML
     * @param {ArrayBuffer} buffer - The file contents
     * @returns {Object} Parsed text data with runs
     */
    async parseTextFile(buffer) {
        try {
            // Skip the 23-byte header and decompress the gzip
            const gzipData = new Uint8Array(buffer, this.GZIP_OFFSET);
            const zipData = pako.inflate(gzipData);

            const zip = await JSZip.loadAsync(zipData);

            // Find XAML: try known path then any .xaml file
            let xamlFile = zip.file('Xaml/Document.xaml') || zip.file('Document.xaml');
            if (!xamlFile && zip.files) {
                const xamlName = Object.keys(zip.files).find((n) => n.endsWith('.xaml'));
                if (xamlName) xamlFile = zip.file(xamlName);
            }
            if (!xamlFile) {
                throw new Error('No XAML found in text file');
            }

            const xamlString = await xamlFile.async('string');
            return this.parseXaml(xamlString);
        } catch (error) {
            console.error('Error parsing text file:', error);
            return { runs: [], textAlignment: 'Left' };
        }
    }

    /**
     * Parse XAML FlowDocument content
     * @param {string} xamlString - The XAML content
     * @returns {Object} Parsed text data
     */
    parseXaml(xamlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xamlString, 'text/xml');
        const root = doc.documentElement;

        const getAttr = (el, name, fallback) => {
            if (!el) return fallback;
            const v =
                el.getAttribute(name) ||
                el.getAttribute(name.charAt(0).toLowerCase() + name.slice(1));
            return v !== null && v !== undefined ? v : fallback;
        };

        const defaultStyle = {
            fontFamily: getAttr(root, 'FontFamily', 'Arial'),
            fontSize: parseFloat(getAttr(root, 'FontSize', '12')) || 12,
            fontWeight: getAttr(root, 'FontWeight', 'Normal'),
            fontStyle: getAttr(root, 'FontStyle', 'Normal'),
            foreground: getAttr(root, 'Foreground', '#000000'),
            textAlignment: getAttr(root, 'TextAlignment', 'Left'),
            lineHeight: getAttr(root, 'LineHeight', 'Auto')
        };

        const createStyle = (element, fallback = defaultStyle) => ({
            fontFamily: getAttr(element, 'FontFamily', fallback.fontFamily),
            fontSize:
                parseFloat(getAttr(element, 'FontSize', String(fallback.fontSize))) ||
                fallback.fontSize,
            fontWeight: getAttr(element, 'FontWeight', fallback.fontWeight),
            fontStyle: getAttr(element, 'FontStyle', fallback.fontStyle),
            foreground: getAttr(element, 'Foreground', fallback.foreground),
            textDecorations: getAttr(element, 'TextDecorations', fallback.textDecorations || '')
        });

        const paragraphs = [];
        const collectParagraphs = (node) => {
            if (!node || node.nodeType !== 1) return;
            if (node.localName === 'Paragraph') {
                paragraphs.push(node);
                return;
            }
            for (const child of node.childNodes) {
                collectParagraphs(child);
            }
        };
        collectParagraphs(root);

        const collectSegments = (node, inheritedStyle, target) => {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent || '';
                if (text) target.push({ text, ...inheritedStyle });
                return;
            }
            if (node.nodeType !== 1) return;

            const nextStyle = createStyle(node, inheritedStyle);
            if (node.localName === 'LineBreak') {
                target.push({ text: '\n', ...nextStyle });
                return;
            }
            if (node.localName === 'Run') {
                const text = node.textContent || '';
                if (text) target.push({ text, ...nextStyle });
                return;
            }
            for (const child of node.childNodes) {
                collectSegments(child, nextStyle, target);
            }
        };

        const structuredParagraphs = paragraphs
            .map((paragraph) => {
                const runs = [];
                collectSegments(paragraph, defaultStyle, runs);
                const textAlignment = getAttr(
                    paragraph,
                    'TextAlignment',
                    defaultStyle.textAlignment
                );
                return { runs, textAlignment };
            })
            .filter((paragraph) => paragraph.runs.some((run) => run.text && run.text !== '\n'));

        const runs = structuredParagraphs.flatMap((paragraph) =>
            paragraph.runs.filter((run) => run.text !== '\n')
        );
        if (runs.length === 0) {
            const text = root.textContent || '';
            if (text.trim()) runs.push({ text, ...defaultStyle });
        }

        return {
            defaultStyle,
            paragraphs: structuredParagraphs,
            runs,
            textAlignment: defaultStyle.textAlignment
        };
    }

    parseProjectCare(element) {
        if (!element) return null;
        return {
            plugInClipartsAdjusted: element.getAttribute('plugInClipartsAdjusted') === '1',
            cuttingToleranceAdjusted: element.getAttribute('cuttingToleranceAdjusted') === '1',
            imageOrientationAdjusted: element.getAttribute('imageOrientationAdjusted') === '1'
        };
    }

    parsePhotoInformations(element) {
        if (!element) return { photos: [] };

        const photos = [];
        const photoElements = element.querySelectorAll('PhotoInformation');

        for (const photo of photoElements) {
            photos.push({
                fileName: this.getTextContent(photo, 'FileName'),
                md5Hash: this.getTextContent(photo, 'Md5Hash'),
                originFilePath: this.getTextContent(photo, 'OriginFilePath'),
                isJpeg: photo.getAttribute('isJpeg') === '1',
                pictureOrientation: parseInt(photo.getAttribute('pictureOrientation') || '0', 10)
            });
        }

        return { photos };
    }

    parsePages(element) {
        if (!element) return [];

        const pages = [];
        const pageElements = element.querySelectorAll('IfolorPage');

        for (const page of pageElements) {
            pages.push(this.parsePage(page));
        }

        return pages;
    }

    parsePage(element) {
        if (!element) return null;

        return {
            pageDescription: this.parsePageDescription(element.querySelector('PageDescription')),
            pageBackground: this.parsePageBackground(element.querySelector('PageBackground')),
            previewId: this.getTextContent(element, 'PreviewId'),
            pageLayers: this.parsePageLayers(element.querySelector('PageLayers'))
        };
    }

    parsePageDescription(element) {
        if (!element) return null;

        return {
            width: parseInt(element.getAttribute('width') || '0', 10),
            height: parseInt(element.getAttribute('height') || '0', 10),
            dpi: parseInt(element.getAttribute('dpi') || '300', 10),
            arrangement: element.getAttribute('arrangement'),
            firstSidePageNumber: parseInt(element.getAttribute('firstSidePageNumber') || '-1', 10),
            secondSidePageNumber: parseInt(
                element.getAttribute('secondSidePageNumber') || '-1',
                10
            ),
            hasPageNumbers: element.getAttribute('hasPageNumbers') === '1',
            pageSpine: this.parsePageSpine(element.querySelector('PageSpine')),
            pageCutting: this.parsePageCutting(element.querySelector('PageCutting'))
        };
    }

    parsePageSpine(element) {
        if (!element) return null;
        return {
            vertical: element.getAttribute('vertical') === '1',
            pos1: parseInt(element.getAttribute('pos1') || '0', 10),
            pos2: parseInt(element.getAttribute('pos2') || '0', 10)
        };
    }

    parsePageCutting(element) {
        if (!element) return null;
        const rect = element.querySelector('Rectangle');
        return {
            isFolded: element.getAttribute('isFolded') === '1',
            rectangle: rect ? this.parseRectangle(rect) : null
        };
    }

    parsePageBackground(element) {
        if (!element) return null;

        return {
            order: parseInt(element.getAttribute('order') || '0', 10),
            acceptsNewPageObjects: element.getAttribute('acceptsNewPageObjects') === '1',
            pageObjects: this.parsePageObjects(element.querySelector('PageObjects'))
        };
    }

    parsePageLayers(element) {
        if (!element) return [];

        const layers = [];
        const layerElements = element.querySelectorAll('PageLayer');

        for (const layer of layerElements) {
            layers.push({
                order: parseInt(layer.getAttribute('order') || '0', 10),
                acceptsNewPageObjects: layer.getAttribute('acceptsNewPageObjects') === '1',
                pageObjects: this.parsePageObjects(layer.querySelector('PageObjects'))
            });
        }

        return layers;
    }

    parsePageObjects(element) {
        if (!element) return [];

        const objects = [];
        const objElements = element.querySelectorAll(':scope > PageObject');

        for (const obj of objElements) {
            objects.push(this.parsePageObject(obj));
        }

        return objects;
    }

    parsePageObject(element) {
        if (!element) return null;

        const foreground = element.querySelector('Foreground');

        return {
            id: element.getAttribute('id'),
            role: element.getAttribute('role'),
            anchor: element.getAttribute('anchor'),
            order: parseInt(element.getAttribute('order') || '0', 10),
            defaultContentType: element.getAttribute('defaultContentType'),
            shadow: element.getAttribute('shadow'),
            backgroundOpacity: parseFloat(element.getAttribute('backgroundOpacity') || '1'),
            foregroundOpacity: parseFloat(element.getAttribute('foregroundOpacity') || '1'),
            rectangle: this.parseRectangle(element.querySelector('Rectangle')),
            foreground: this.parseForeground(foreground),
            textStyle: this.parseTextStyle(element.querySelector('TextStyle')),
            processing: this.parseProcessing(element.querySelector('Processing'))
        };
    }

    parseForeground(element) {
        if (!element) return null;

        // Check for nested content types (2021 format)
        const imageContent = element.querySelector('PageObjectImageContent');
        const textContent = element.querySelector('PageObjectTextContent');
        const colorContent = element.querySelector('PageObjectColorContent');

        if (imageContent) {
            return {
                type: 'image',
                id: this.getTextContent(imageContent, 'Id'),
                imageType: imageContent.getAttribute('imageType'),
                imageQuality: imageContent.getAttribute('imageQuality'),
                imagePixelWidth: parseInt(imageContent.getAttribute('imagePixelWidth') || '0', 10),
                imagePixelHeight: parseInt(
                    imageContent.getAttribute('imagePixelHeight') || '0',
                    10
                ),
                isColorized: imageContent.getAttribute('isColorized') === '1',
                isMirroredHorizontally: imageContent.getAttribute('isMirroredHorizontally') === '1',
                isMirroredVertically: imageContent.getAttribute('isMirroredVertically') === '1',
                enhancement: imageContent.getAttribute('enhancement'),
                processing: this.parseProcessing(imageContent.querySelector('Processing'))
            };
        }

        if (textContent) {
            return {
                type: 'text',
                textId: this.getTextId(textContent),
                verticalTextAlign:
                    textContent.getAttribute('verticalTextAlign') ||
                    textContent.getAttribute('VerticalTextAlign'),
                isColorized: textContent.getAttribute('isColorized') === '1',
                margin: this.parseMargin(textContent.querySelector('Margin')),
                usedFonts: this.parseUsedFonts(textContent.querySelector('UsedFonts'))
            };
        }

        if (colorContent) {
            return {
                type: 'color',
                color: this.parseColor(colorContent.querySelector('Color')),
                isColorized: colorContent.getAttribute('isColorized') === '1',
                colorType: colorContent.getAttribute('type')
            };
        }

        // Legacy format - attributes directly on Foreground
        const contentType = element.getAttribute('contentType');
        const id = this.getTextContent(element, 'Id');
        const textId = this.getTextId(element);

        if (contentType === 'PageObjectImageContent' || id) {
            return {
                type: 'image',
                id: id,
                contentType: contentType,
                imageType: element.getAttribute('imageType'),
                imageQuality: element.getAttribute('imageQuality'),
                imagePixelWidth: parseInt(element.getAttribute('imagePixelWidth') || '0', 10),
                imagePixelHeight: parseInt(element.getAttribute('imagePixelHeight') || '0', 10),
                isColorized: element.getAttribute('isColorized') === '1',
                processing: this.parseProcessing(element.querySelector('Processing'))
            };
        }

        if (contentType === 'PageObjectTextContent' || textId) {
            return {
                type: 'text',
                textId: textId,
                verticalTextAlign: element.getAttribute('verticalTextAlign'),
                isColorized: element.getAttribute('isColorized') === '1',
                margin: this.parseMargin(element.querySelector('Margin'))
            };
        }

        return null;
    }

    parseTextStyle(element) {
        if (!element) return null;

        return {
            fontName: element.getAttribute('fontName'),
            fontSize: parseInt(element.getAttribute('fontSize') || '12', 10),
            bold: element.getAttribute('bold') === '1',
            italic: element.getAttribute('italic') === '1',
            underline: element.getAttribute('underline') === '1',
            horizontalAlign: element.getAttribute('horizontalAlign'),
            verticalAlign: element.getAttribute('verticalAlign'),
            color: this.parseColor(element.querySelector('Color'))
        };
    }

    parseColor(element) {
        if (!element) return null;

        return {
            a: parseInt(element.getAttribute('colorA') || '255', 10),
            r: parseInt(element.getAttribute('colorR') || '0', 10),
            g: parseInt(element.getAttribute('colorG') || '0', 10),
            b: parseInt(element.getAttribute('colorB') || '0', 10)
        };
    }

    parseMargin(element) {
        if (!element) return { left: 0, top: 0, right: 0, bottom: 0 };

        return {
            left: parseFloat(element.getAttribute('left') || '0'),
            top: parseFloat(element.getAttribute('top') || '0'),
            right: parseFloat(element.getAttribute('right') || '0'),
            bottom: parseFloat(element.getAttribute('bottom') || '0')
        };
    }

    parseUsedFonts(element) {
        if (!element) return [];

        const fonts = [];
        const fontElements = element.querySelectorAll('UsedFont');

        for (const font of fontElements) {
            fonts.push({
                familyName: font.getAttribute('familyName'),
                style: font.getAttribute('style')
            });
        }

        return fonts;
    }

    parseRectangle(element) {
        if (!element) return { x: 0, y: 0, width: 0, height: 0 };

        return {
            x: parseFloat(element.getAttribute('x') || '0'),
            y: parseFloat(element.getAttribute('y') || '0'),
            width: parseFloat(element.getAttribute('width') || '0'),
            height: parseFloat(element.getAttribute('height') || '0')
        };
    }

    parseProcessing(element) {
        if (!element) return null;

        const toApply = element.querySelector('ToApply');
        if (!toApply) return null;

        return {
            rotationOperation: this.parseRotationOperation(
                toApply.querySelector('RotationOperation')
            ),
            orthogonalRotationOperation: this.parseOrthogonalRotation(
                toApply.querySelector('OrthogonalRotationOperation')
            ),
            visibleRectOperation: this.parseVisibleRectOperation(
                toApply.querySelector('VisibleRectOperation')
            )
        };
    }

    parseRotationOperation(element) {
        if (!element) return null;
        return {
            degree: parseFloat(element.getAttribute('degree') || '0')
        };
    }

    parseOrthogonalRotation(element) {
        if (!element) return null;
        const rotation = element.getAttribute('rotation');
        let degree = 0;

        switch (rotation) {
            case 'Rotate90':
                degree = 90;
                break;
            case 'Rotate180':
                degree = 180;
                break;
            case 'Rotate270':
                degree = 270;
                break;
        }

        return { rotation, degree };
    }

    parseVisibleRectOperation(element) {
        if (!element) return null;

        return {
            x: parseFloat(element.getAttribute('x') || '0'),
            y: parseFloat(element.getAttribute('y') || '0'),
            scaleFactor: parseFloat(element.getAttribute('scaleFactor') || '1'),
            levelingAngle: parseFloat(element.getAttribute('levelingAngle') || '0')
        };
    }

    getTextContent(parent, tagName) {
        const element = parent.querySelector(tagName);
        return element ? element.textContent.trim() : '';
    }

    /** Get textId from element: attribute (any casing) or child element. */
    getTextId(element) {
        if (!element) return null;
        const attr =
            element.getAttribute('textId') ||
            element.getAttribute('TextId') ||
            element.getAttribute('documentId');
        if (attr) return attr;
        const tagNames = ['textId', 'TextId', 'documentId', 'DocumentId'];
        for (const tag of tagNames) {
            const child = element.querySelector(tag) || element.getElementsByTagName(tag)[0];
            if (child?.textContent) return child.textContent.trim();
        }
        return null;
    }
}
