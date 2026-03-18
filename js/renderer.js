/**
 * Page Renderer
 * 
 * Renders iFolor photobook pages to HTML Canvas
 */

export class PageRenderer {
    constructor() {
        this.imageCache = new Map();
    }

    configureCanvasContext(ctx) {
        if (!ctx) return ctx;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        return ctx;
    }
    
    /**
     * Render a page to canvas
     * @param {Object} page - Parsed page data
     * @param {Object} project - Full project data
     * @param {Map} photos - Map of filename to File objects
     * @param {Map} texts - Map of filename to File objects
     * @param {IFolorParser} parser - Parser instance for text files
     * @param {number} scale - Scale factor for preview
     * @param {Object|string} renderOptions - Render options or legacy background color
     * @param {Function} log - Logging function
     * @returns {HTMLCanvasElement}
     */
    async renderPage(page, project, photos, texts, parser, scale = 1, renderOptions = {}, log = () => {}) {
        const desc = page.pageDescription;
        const width = Math.round(desc.width * scale);
        const height = Math.round(desc.height * scale);
        const dpiScale = (desc.dpi || 300) / 96;
        const options = this.normalizeRenderOptions(renderOptions);
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = this.configureCanvasContext(canvas.getContext('2d'));

        const pageBgColor = this.getPageBackgroundColor(page, options);
        
        // Fill background
        if (pageBgColor) {
            ctx.fillStyle = pageBgColor;
            ctx.fillRect(0, 0, width, height);
        }
        
        const sortByOrder = (a, b) => (a.order || 0) - (b.order || 0);
        const isText = (obj) => {
            const f = obj.foreground;
            return f && (f.type === 'text' || obj.defaultContentType === 'Text');
        };
        
        const allObjects = [];
        if (page.pageBackground?.pageObjects) allObjects.push(...page.pageBackground.pageObjects);
        if (page.pageLayers) {
            for (const layer of page.pageLayers) {
                if (layer.pageObjects) allObjects.push(...layer.pageObjects);
            }
        }
        allObjects.sort(sortByOrder);
        
        const nonText = allObjects.filter(o => !isText(o));
        const textOnly = allObjects.filter(isText);
        
        // Draw images and colors first, then all text on top (so text is never behind images)
        for (const obj of nonText) {
            await this.drawPageObject(ctx, obj, page, project, photos, texts, parser, scale, dpiScale, options, log);
        }
        for (const obj of textOnly) {
            await this.drawPageObject(ctx, obj, page, project, photos, texts, parser, scale, dpiScale, options, log);
        }

        return this.trimCoverBleed(canvas, page, scale);
    }
    
    normalizeRenderOptions(renderOptions) {
        if (typeof renderOptions === 'string') {
            return {
                backgroundMode: 'photobook',
                backgroundColor: renderOptions,
                fontColorMode: 'photobook',
                fontColor: '#000000',
                legacyFallback: true
            };
        }

        return {
            backgroundMode: renderOptions?.backgroundMode || 'photobook',
            backgroundColor: renderOptions?.backgroundColor || '#ffffff',
            fontColorMode: renderOptions?.fontColorMode || 'photobook',
            fontColor: renderOptions?.fontColor || '#000000',
            legacyFallback: false
        };
    }

    isTrimmedCoverSpread(page) {
        const desc = page?.pageDescription;
        const cutting = desc?.pageCutting;
        return Boolean(
            desc &&
            cutting?.isFolded &&
            cutting?.rectangle &&
            desc.firstSidePageNumber < 0 &&
            desc.secondSidePageNumber < 0 &&
            desc.arrangement === 'DoublePageHorizontal'
        );
    }

    trimCoverBleed(canvas, page, scale) {
        if (!this.isTrimmedCoverSpread(page)) {
            return canvas;
        }

        const rect = page.pageDescription.pageCutting.rectangle;
        const cropX = Math.max(0, Math.round(rect.x * scale));
        const cropY = Math.max(0, Math.round(rect.y * scale));
        const cropWidth = Math.min(canvas.width - cropX, Math.round(rect.width * scale));
        const cropHeight = Math.min(canvas.height - cropY, Math.round(rect.height * scale));

        if (cropWidth <= 0 || cropHeight <= 0) {
            return canvas;
        }

        // Covers are authored with extra bleed; trim back to the cut area so previews
        // and exports match the printed/viewer composition without affecting inner pages.
        const trimmed = document.createElement('canvas');
        trimmed.width = cropWidth;
        trimmed.height = cropHeight;

        const trimmedCtx = this.configureCanvasContext(trimmed.getContext('2d'));
        trimmedCtx.drawImage(
            canvas,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );

        return trimmed;
    }


    async drawPageObject(ctx, obj, page, project, photos, texts, parser, scale, dpiScale, renderOptions, log) {
        const contentType = obj.defaultContentType;
        const foreground = obj.foreground;
        
        if (!foreground) {
            // Empty placeholder
            return;
        }
        
        try {
            if (foreground.type === 'color') {
                this.drawColorContent(ctx, obj, scale, renderOptions, log);
            } else if (foreground.type === 'text' || contentType === 'Text') {
                console.log('[renderer] Text object found, textId:', foreground.textId, 'contentType:', contentType);
                await this.drawText(ctx, obj, page, project, texts, parser, scale, dpiScale, renderOptions, log);
            } else if (foreground.type === 'image' || contentType === 'Image') {
                await this.drawImage(ctx, obj, project, photos, scale, log);
            } else {
                console.log('[renderer] Unknown object type:', foreground.type, contentType);
            }
        } catch (error) {
            log(`Error drawing object: ${error.message}`);
            console.error('Error drawing object:', error);
        }
    }
    
    async drawImage(ctx, obj, project, photos, scale, log) {
        const foreground = obj.foreground;
        if (!foreground) return;
        
        // Get the image ID
        let imageId = foreground.id;
        if (!imageId) return;
        
        // Extract the GUID from the ID (format: "guid|shell?path?timestamp" or "guid|plugin?...")
        const guid = imageId.split('|')[0];
        
        // Check if it's clipart
        if (imageId.includes('|plugin?') || foreground.imageType === 'PluginClipart') {
            log(`Skipping clipart: ${guid}`);
            return;
        }
        
        // Find the photo file
        let photoFile = photos.get(guid);
        
        // If not found by GUID, try to find by checking photo informations
        if (!photoFile && project.photoInformations?.photos) {
            const photoInfo = project.photoInformations.photos.find(p => p.fileName === guid);
            if (photoInfo) {
                // Try different possible keys
                photoFile = photos.get(photoInfo.fileName) || 
                           photos.get(photoInfo.md5Hash) ||
                           Array.from(photos.entries()).find(([k, v]) => k.includes(guid))?.[1];
            }
        }
        
        if (!photoFile) {
            log(`Photo not found: ${guid}`);
            return;
        }
        
        try {
            // Load the image
            const img = await this.loadImage(photoFile);
            
            // Get rectangle
            const rect = obj.rectangle;
            const x = rect.x * scale;
            const y = rect.y * scale;
            const width = rect.width * scale;
            const height = rect.height * scale;
            
            // Create a temporary canvas for transformations
            const tempCanvas = document.createElement('canvas');
            const tempCtx = this.configureCanvasContext(tempCanvas.getContext('2d'));
            
            // Start with the original image
            let currentImg = img;
            let currentWidth = img.width;
            let currentHeight = img.height;
            
            // Apply EXIF orientation if available
            const photoInfo = project.photoInformations?.photos?.find(p => p.fileName === guid);
            let rotationDegrees = 0;
            
            if (photoInfo?.pictureOrientation) {
                // PictureOrientation values: 0, 90, 180, 270
                // We need to apply counter-rotation to fix orientation
                switch (photoInfo.pictureOrientation) {
                    case 90: rotationDegrees = -90; break;
                    case 180: rotationDegrees = 180; break;
                    case 270: rotationDegrees = 90; break;
                }
            }
            
            // Apply orthogonal rotation from designer
            const orthoRot = foreground.processing?.orthogonalRotationOperation;
            if (orthoRot?.degree) {
                rotationDegrees = (rotationDegrees + orthoRot.degree) % 360;
            }
            
            // Apply rotation if needed
            if (rotationDegrees !== 0) {
                const rotated = this.rotateImage(currentImg, rotationDegrees);
                currentImg = rotated.canvas;
                currentWidth = rotated.width;
                currentHeight = rotated.height;
            }
            
            // Apply mirror/flip
            if (foreground.isMirroredHorizontally || foreground.isMirroredVertically) {
                tempCanvas.width = currentWidth;
                tempCanvas.height = currentHeight;
                tempCtx.save();
                
                if (foreground.isMirroredHorizontally) {
                    tempCtx.translate(currentWidth, 0);
                    tempCtx.scale(-1, 1);
                }
                if (foreground.isMirroredVertically) {
                    tempCtx.translate(0, currentHeight);
                    tempCtx.scale(1, -1);
                }
                
                tempCtx.drawImage(currentImg, 0, 0);
                tempCtx.restore();
                
                currentImg = tempCanvas;
            }
            
            // Apply visible rect operation (crop/zoom)
            const visRect = foreground.processing?.visibleRectOperation;
            let preLevelWidth = currentWidth;
            let preLevelHeight = currentHeight;
            if (visRect?.levelingAngle && Math.abs(visRect.levelingAngle) > 0.01) {
                const leveled = this.rotateImage(currentImg, visRect.levelingAngle);
                currentImg = leveled.canvas;
                currentWidth = leveled.width;
                currentHeight = leveled.height;
            }

            const cropped = this.applyCrop(
                currentImg,
                visRect,
                currentWidth,
                currentHeight,
                width,
                height,
                preLevelWidth,
                preLevelHeight,
                rect.width,
                rect.height
            );
            currentImg = cropped.canvas;
            currentWidth = cropped.width;
            currentHeight = cropped.height;
            
            // Apply free rotation from object processing
            const rotOp = obj.processing?.rotationOperation;
            if (rotOp?.degree && Math.abs(rotOp.degree) > 0.01) {
                const rotated = this.rotateImage(currentImg, rotOp.degree);
                currentImg = rotated.canvas;
                currentWidth = rotated.width;
                currentHeight = rotated.height;
            }
            
            // Draw to main canvas
            ctx.save();
            ctx.globalAlpha = obj.foregroundOpacity || 1;
            
            // Draw the image, scaling to fit the rectangle
            ctx.drawImage(currentImg, x, y, width, height);
            
            ctx.restore();
            
            log(`Drew image: ${guid}`);
        } catch (error) {
            log(`Error loading image ${guid}: ${error.message}`);
            console.error('Error loading image:', error);
        }
    }
    
    rotateImage(img, degrees) {
        const radians = degrees * Math.PI / 180;
        const sin = Math.abs(Math.sin(radians));
        const cos = Math.abs(Math.cos(radians));
        
        const srcWidth = img.width || img.naturalWidth;
        const srcHeight = img.height || img.naturalHeight;
        
        const newWidth = Math.round(srcWidth * cos + srcHeight * sin);
        const newHeight = Math.round(srcWidth * sin + srcHeight * cos);
        
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        
        const ctx = this.configureCanvasContext(canvas.getContext('2d'));
        ctx.translate(newWidth / 2, newHeight / 2);
        ctx.rotate(radians);
        ctx.drawImage(img, -srcWidth / 2, -srcHeight / 2);
        
        return { canvas, width: newWidth, height: newHeight };
    }
    
    applyCrop(img, visRect, imgWidth, imgHeight, targetWidth, targetHeight, originalWidth = imgWidth, originalHeight = imgHeight, containerW_pu = 0, containerH_pu = 0) {
        const targetAspect = targetWidth / Math.max(targetHeight, 1);
        let cropWidth, cropHeight;
        const levelingAngle = Number(visRect?.levelingAngle) || 0;
        const rawScaleFactor = Number(visRect?.scaleFactor);
        const hasExplicitScale = Number.isFinite(rawScaleFactor) && rawScaleFactor > 0;

        if (hasExplicitScale && containerW_pu > 0 && containerH_pu > 0) {
            // scaleFactor = page-units per image-pixel.
            // Visible region in image-pixel space:
            cropWidth = containerW_pu / rawScaleFactor;
            cropHeight = containerH_pu / rawScaleFactor;

            cropWidth = Math.min(imgWidth, cropWidth);
            cropHeight = Math.min(imgHeight, cropHeight);
        } else {
            cropWidth = imgWidth;
            cropHeight = imgHeight;

            if (Math.abs(levelingAngle) > 0.01) {
                const angleRad = Math.abs(levelingAngle) * Math.PI / 180;
                const cosA = Math.cos(angleRad);
                const sinA = Math.abs(Math.sin(angleRad));

                if (sinA > 0.01) {
                    const contentWidth = originalWidth * cosA - originalHeight * sinA;
                    const contentHeight = originalHeight * cosA - originalWidth * sinA;

                    if (contentWidth > 0 && contentHeight > 0) {
                        cropWidth = Math.min(imgWidth, contentWidth);
                        cropHeight = Math.min(imgHeight, contentHeight);
                    } else {
                        const safeFactor = cosA * 0.9;
                        cropWidth = Math.min(imgWidth, imgWidth * safeFactor);
                        cropHeight = Math.min(imgHeight, imgHeight * safeFactor);
                    }
                }
            }

            // Aspect-fill fallback when no valid scaleFactor is available.
            if (cropWidth / cropHeight > targetAspect) {
                cropWidth = cropHeight * targetAspect;
            } else {
                cropHeight = cropWidth / targetAspect;
            }
        }

        const centerX = (Number.isFinite(visRect?.x) ? visRect.x : 0.5) * imgWidth;
        const centerY = (Number.isFinite(visRect?.y) ? visRect.y : 0.5) * imgHeight;

        let cropX = centerX - cropWidth / 2;
        let cropY = centerY - cropHeight / 2;

        cropX = Math.max(0, Math.min(cropX, imgWidth - cropWidth));
        cropY = Math.max(0, Math.min(cropY, imgHeight - cropHeight));

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(cropWidth));
        canvas.height = Math.max(1, Math.round(cropHeight));

        const ctx = this.configureCanvasContext(canvas.getContext('2d'));
        ctx.drawImage(
            img,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, canvas.width, canvas.height
        );

        return { canvas, width: canvas.width, height: canvas.height };
    }

    colorToCss(color) {
        if (!color) return null;
        const alpha = Math.max(0, Math.min(1, (color.a ?? 255) / 255));
        return `rgba(${color.r ?? 0}, ${color.g ?? 0}, ${color.b ?? 0}, ${alpha})`;
    }

    hasImplicitWhiteBackground(objects, pageWidth, pageHeight) {
        if (!objects.length || !pageWidth || !pageHeight) return false;

        const emptyRects = objects.filter((obj) => obj?.rectangle && !obj?.foreground);
        if (emptyRects.length !== objects.length) return false;

        const coversFullHeight = emptyRects.every(({ rectangle }) =>
            Math.abs(rectangle.y) < 1 && Math.abs(rectangle.height - pageHeight) < 1
        );
        if (!coversFullHeight) return false;

        const minX = Math.min(...emptyRects.map(({ rectangle }) => rectangle.x));
        const maxX = Math.max(...emptyRects.map(({ rectangle }) => rectangle.x + rectangle.width));

        return Math.abs(minX) < 1 && Math.abs(maxX - pageWidth) < 1;
    }

    getPageBackgroundColor(page, renderOptions) {
        if (renderOptions.backgroundMode === 'transparent') {
            return null;
        }
        if (renderOptions.backgroundMode === 'fixed') {
            return renderOptions.backgroundColor;
        }

        const desc = page?.pageDescription;
        const pageWidth = desc?.width || 0;
        const pageHeight = desc?.height || 0;
        const objects = page?.pageBackground?.pageObjects || [];

        for (const obj of objects) {
            if (obj?.foreground?.type !== 'color' || !obj.rectangle) continue;
            const { x, y, width, height } = obj.rectangle;
            const coversPage =
                Math.abs(x) < 1 &&
                Math.abs(y) < 1 &&
                Math.abs(width - pageWidth) < 1 &&
                Math.abs(height - pageHeight) < 1;

            if (coversPage) {
                return this.colorToCss(obj.foreground.color) || renderOptions.backgroundColor;
            }
        }

        if (this.hasImplicitWhiteBackground(objects, pageWidth, pageHeight)) {
            return '#ffffff';
        }

        return renderOptions.legacyFallback ? renderOptions.backgroundColor : null;
    }
    
    /**
     * Resolve a text file by id. Project may reference by path, GUID, or filename.
     */
    getTextFile(texts, textId) {
        if (!textId || texts.size === 0) return null;
        const exact = texts.get(textId);
        if (exact) return exact;
        const base = textId.split(/[/\\]/).pop();
        if (base && base !== textId && texts.get(base)) return texts.get(base);
        const textIdLower = textId.toLowerCase();
        const stripExt = (s) => (s || '').replace(/\.[^.]+$/, '').toLowerCase();
        for (const [name, file] of texts) {
            if (name === textId || name.endsWith(textId) || textId.endsWith(name)) return file;
            if (name.toLowerCase() === textIdLower) return file;
            if (stripExt(name) === stripExt(textId)) return file;
        }
        if (texts.size === 1) return texts.values().next().value;
        return null;
    }
    
    async drawText(ctx, obj, page, project, texts, parser, scale, dpiScale, renderOptions, log) {
        const foreground = obj.foreground;
        if (!foreground) return;
        
        const textId = foreground.textId;
        if (!textId) {
            console.warn('[drawText] No textId on object', obj);
            return;
        }
        
        const textFile = this.getTextFile(texts, textId);
        if (!textFile) {
            log(`Text file not found: ${textId}`);
            console.warn('[drawText] Text file not found:', textId, 'Loaded keys:', texts.size, Array.from(texts.keys()).slice(0, 5));
            return;
        }
        
        try {
            const buffer = await textFile.arrayBuffer();
            const textData = await parser.parseTextFile(buffer);
            
            if (!textData.runs || textData.runs.length === 0) {
                log(`No text content in: ${textId}`);
                console.warn('[drawText] No runs in text file:', textId);
                return;
            }
            const textContent = textData.runs.map((run) => run.text || '').join('').trim();
            console.log('[drawText] Drawing text', textId, 'runs:', textData.runs.length, 'rect:', obj.rectangle);
            
            // Get rectangle
            const rect = obj.rectangle;
            const x = rect.x * scale;
            const y = rect.y * scale;
            let width = Math.max(1, rect.width * scale);
            let height = Math.max(1, rect.height * scale);
            
            // Get text style from object or use defaults
            const textStyle = obj.textStyle || {};
            const verticalAlign = (foreground.verticalTextAlign || textStyle.verticalAlign || 'Top');
            const horizontalAlign = (textStyle.horizontalAlign || textData.textAlignment || 'Left');
            
            const textCanvas = document.createElement('canvas');
            textCanvas.width = Math.round(width);
            textCanvas.height = Math.round(height);
            const textCtx = this.configureCanvasContext(textCanvas.getContext('2d'));
            
            const parseColor = (val) => {
                if (!val || typeof val !== 'string') return null;
                const s = val.trim();
                if (/^#([0-9A-Fa-f]{3}){1,2}$/.test(s) || /^#([0-9A-Fa-f]{6})$/.test(s)) return s;
                if (/^#([0-9A-Fa-f]{8})$/.test(s)) {
                    const a = parseInt(s.slice(1, 3), 16) / 255;
                    const r = parseInt(s.slice(3, 5), 16);
                    const g = parseInt(s.slice(5, 7), 16);
                    const b = parseInt(s.slice(7, 9), 16);
                    return `rgba(${r}, ${g}, ${b}, ${a})`;
                }
                const named = { white: '#ffffff', black: '#000000', transparent: null };
                const key = s.toLowerCase();
                return named[key] !== undefined ? named[key] : s;
            };
            
            const align = (horizontalAlign || 'Left').toLowerCase();
            const textScaleFactor = scale * dpiScale;
            const paragraphs = textData.paragraphs?.length
                ? textData.paragraphs
                : [{ runs: textData.runs, textAlignment: textData.textAlignment }];

            const createToken = (run, rawText, paragraphAlignment = align) => {
                if (!rawText) return null;
                const text = rawText.replace(/\t/g, '    ');
                if (!text) return null;

                let fontSize = (run.fontSize ?? textStyle.fontSize ?? textData.defaultStyle?.fontSize ?? 12) * textScaleFactor;
                if (!Number.isFinite(fontSize) || fontSize < 1) fontSize = Math.max(scale, 1);

                const fontFamily = (run.fontFamily || textStyle.fontName || textData.defaultStyle?.fontFamily || 'Arial').replace(/['"]/g, '');
                const fontWeight = (run.fontWeight === 'Bold' || textStyle.bold) ? 'bold' : 'normal';
                const fontStyle = (run.fontStyle === 'Italic' || textStyle.italic) ? 'italic' : 'normal';

                let fillStyle = null;
                if (renderOptions.fontColorMode === 'fixed') {
                    fillStyle = renderOptions.fontColor;
                } else if (run.foreground) {
                    fillStyle = parseColor(run.foreground);
                }
                if (fillStyle == null && textStyle.color) {
                    fillStyle = `rgba(${textStyle.color.r}, ${textStyle.color.g}, ${textStyle.color.b}, ${(textStyle.color.a ?? 255) / 255})`;
                }
                if (fillStyle == null) fillStyle = '#000000';

                const font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", Arial, sans-serif`;
                textCtx.font = font;
                const measuredWidth = textCtx.measureText(text).width;

                return {
                    text,
                    font,
                    fillStyle,
                    width: measuredWidth,
                    lineHeight: fontSize * 1.35,
                    textAlignment: paragraphAlignment
                };
            };

            const lines = [];
            for (const paragraph of paragraphs) {
                let lineTokens = [];
                let lineWidth = 0;
                let lineHeight = 0;

                const pushLine = () => {
                    lines.push({
                        tokens: lineTokens,
                        width: lineWidth,
                        height: lineHeight || ((textStyle.fontSize || textData.defaultStyle?.fontSize || 12) * textScaleFactor * 1.35),
                        textAlignment: (paragraph.textAlignment || align || 'left').toLowerCase()
                    });
                    lineTokens = [];
                    lineWidth = 0;
                    lineHeight = 0;
                };

                for (const run of paragraph.runs || []) {
                    if (!run?.text || run.text === '\n') continue;
                    const parts = run.text.replace(/\r/g, '').split(/(\s+)/);
                    for (const part of parts) {
                        if (!part) continue;
                        let token = createToken(run, part, paragraph.textAlignment);
                        if (!token) continue;

                        if (lineTokens.length === 0) {
                            const trimmed = token.text.replace(/^\s+/, '');
                            if (!trimmed) continue;
                            if (trimmed !== token.text) {
                                token = createToken(run, trimmed, paragraph.textAlignment);
                                if (!token) continue;
                            }
                        }

                        if (lineTokens.length > 0 && lineWidth + token.width > width) {
                            pushLine();
                            const trimmed = token.text.replace(/^\s+/, '');
                            if (!trimmed) continue;
                            if (trimmed !== token.text) {
                                token = createToken(run, trimmed, paragraph.textAlignment);
                                if (!token) continue;
                            }
                        }

                        lineTokens.push(token);
                        lineWidth += token.width;
                        lineHeight = Math.max(lineHeight, token.lineHeight);
                    }
                }

                if (lineTokens.length > 0 || lines.length === 0) {
                    pushLine();
                }
            }

            textCtx.textBaseline = 'top';
            let currentY = 0;
            for (const line of lines) {
                const lineAlign = (line.textAlignment || line.tokens[0]?.textAlignment || align || 'left').toLowerCase();
                let currentX = 0;
                if (lineAlign === 'center') currentX = Math.max(0, (width - line.width) / 2);
                else if (lineAlign === 'right') currentX = Math.max(0, width - line.width);

                for (const token of line.tokens) {
                    textCtx.font = token.font;
                    textCtx.fillStyle = token.fillStyle;
                    textCtx.fillText(token.text, currentX, currentY);
                    currentX += token.width;
                }
                currentY += line.height;
            }
            
            let destY = y;
            const textHeight = currentY;
            const vAlign = (verticalAlign || 'Top').toLowerCase();
            if (vAlign === 'center') destY = y + (height - textHeight) / 2;
            else if (vAlign === 'bottom') destY = y + height - textHeight;

            const rotOp = obj.processing?.rotationOperation;

            // Apply rotation if needed
            ctx.save();
            const textOpacity = Math.max(Number(obj.foregroundOpacity) || 1, 0.99);
            ctx.globalAlpha = textOpacity;

            if (rotOp?.degree && Math.abs(rotOp.degree) > 0.01) {
                const centerX = x + width / 2;
                const centerY = y + height / 2;
                ctx.translate(centerX, centerY);
                ctx.rotate(rotOp.degree * Math.PI / 180);
                ctx.translate(-centerX, -centerY);
            }
            
            // Draw text canvas to main canvas
            ctx.drawImage(textCanvas, x, destY);
            
            ctx.restore();
            
            log(`Drew text: ${textId}`);
            console.log('[drawText] Drew text at', Math.round(x), Math.round(destY), 'size', Math.round(width), 'x', Math.round(height));
        } catch (error) {
            log(`Error drawing text ${textId}: ${error.message}`);
            console.error('Error drawing text:', error);
        }
    }
    
    drawColorContent(ctx, obj, scale, renderOptions, log) {
        const foreground = obj.foreground;
        if (!foreground?.color) return;
        if (renderOptions.backgroundMode === 'transparent') return;
        
        const color = foreground.color;
        const rect = obj.rectangle;
        const fillStyle = renderOptions.backgroundMode === 'fixed'
            ? renderOptions.backgroundColor
            : `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
        
        ctx.save();
        ctx.globalAlpha = obj.foregroundOpacity || 1;
        ctx.fillStyle = fillStyle;
        ctx.fillRect(
            rect.x * scale,
            rect.y * scale,
            rect.width * scale,
            rect.height * scale
        );
        ctx.restore();
        
        log(`Drew color fill`);
    }
    
    async loadImage(file) {
        // Check cache first
        const cacheKey = file.name + file.size;
        if (this.imageCache.has(cacheKey)) {
            return this.imageCache.get(cacheKey);
        }
        
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            img.onload = () => {
                this.imageCache.set(cacheKey, img);
                URL.revokeObjectURL(img.src);
                resolve(img);
            };
            
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error(`Failed to load image: ${file.name}`));
            };
            
            img.src = URL.createObjectURL(file);
        });
    }
}
