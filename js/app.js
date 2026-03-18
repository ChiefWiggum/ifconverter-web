/**
 * IFConverter Web - Browser-based iFolor Photobook Converter
 *
 * Converts iFolor photobooks to PNG images entirely in the browser.
 */

import { IFolorParser } from './parser.js';
import { PageRenderer } from './renderer.js';
import { Logger } from './logger.js';

class IFConverterApp {
    constructor() {
        this.parser = new IFolorParser();
        this.renderer = new PageRenderer();
        this.logger = new Logger('logContent');

        this.project = null;
        this.photos = new Map();
        this.texts = new Map();
        this.renderedPages = [];
        this.lastRenderedIndices = [];

        this.initElements();
        this.initEventListeners();
    }

    initElements() {
        // Drop zone
        this.dropZone = document.getElementById('dropZone');

        // File inputs
        this.ippFileInput = document.getElementById('ippFile');
        this.photosInput = document.getElementById('photosInput');
        this.textsInput = document.getElementById('textsInput');

        // Options
        this.optionsPanel = document.getElementById('optionsPanel');
        this.dpiSelect = document.getElementById('dpiSelect');
        this.outputFormatSelect = document.getElementById('outputFormatSelect');
        this.backgroundModeSelect = document.getElementById('backgroundModeSelect');
        this.bgColorInput = document.getElementById('bgColor');
        this.fontColorModeSelect = document.getElementById('fontColorModeSelect');
        this.fontColorInput = document.getElementById('fontColorInput');
        this.scaleSelect = document.getElementById('scaleSelect');

        // Status and info
        this.statusEl = document.getElementById('status');
        this.projectInfo = document.getElementById('projectInfo');
        this.projectDetails = document.getElementById('projectDetails');
        this.progressText = document.getElementById('progressText');
        this.progressFill = document.getElementById('progressFill');
        this.logEl = document.getElementById('log');

        // Buttons
        this.renderBtn = document.getElementById('renderBtn');
        this.renderSomeBtn = document.getElementById('renderSomeBtn');
        this.downloadAllBtn = document.getElementById('downloadAllBtn');
        this.clearLogBtn = document.getElementById('clearLogBtn');

        // Pages container
        this.pagesContainer = document.getElementById('pagesContainer');
    }

    initEventListeners() {
        // Drag and drop
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('drag-over');
        });

        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drag-over');
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('drag-over');
            this.handleDrop(e.dataTransfer);
        });

        // File inputs
        this.ippFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadProjectFile(e.target.files[0]);
            }
        });

        this.photosInput.addEventListener('change', (e) => {
            this.loadPhotos(e.target.files);
        });

        this.textsInput.addEventListener('change', (e) => {
            this.loadTexts(e.target.files);
        });

        // Buttons
        this.renderBtn.addEventListener('click', () => this.renderAllPages());
        this.renderSomeBtn.addEventListener('click', () => this.openPageSelectModal());
        this.downloadAllBtn.addEventListener('click', () => this.downloadAllAsZip());
        this.clearLogBtn.addEventListener('click', () => this.logger.clear());

        // Options change
        this.scaleSelect.addEventListener('change', () => {
            this.rerenderCurrentSelection();
        });
        this.outputFormatSelect.addEventListener('change', () => this.handleRenderOptionChange());
        this.backgroundModeSelect.addEventListener('change', () => this.handleRenderOptionChange());
        this.bgColorInput.addEventListener('change', () => this.handleRenderOptionChange());
        this.fontColorModeSelect.addEventListener('change', () => this.handleRenderOptionChange());
        this.fontColorInput.addEventListener('change', () => this.handleRenderOptionChange());

        this.updateOptionControlState();
    }

    handleRenderOptionChange() {
        this.updateOptionControlState();
    }

    updateOptionControlState() {
        const format = this.outputFormatSelect?.value || 'png';
        const transparentOption = this.backgroundModeSelect?.querySelector(
            'option[value="transparent"]'
        );
        if (transparentOption) {
            transparentOption.disabled = format === 'jpg';
        }
        if (format === 'jpg' && this.backgroundModeSelect?.value === 'transparent') {
            this.backgroundModeSelect.value = 'photobook';
        }
        if (this.bgColorInput) {
            this.bgColorInput.disabled = this.backgroundModeSelect?.value !== 'fixed';
        }
        if (this.fontColorInput) {
            this.fontColorInput.disabled = this.fontColorModeSelect?.value !== 'fixed';
        }
        this.updateDownloadLabels();
    }

    updateDownloadLabels() {
        if (!this.downloadAllBtn) return;
        const format = this.outputFormatSelect?.value || 'png';
        if (format === 'pdf') {
            this.downloadAllBtn.textContent = 'Download PDF';
        } else {
            this.downloadAllBtn.textContent = 'Download All as ZIP';
        }
        document.querySelectorAll('.btn-download').forEach((button) => {
            button.textContent = `Download ${this.getOutputLabel()}`;
        });
    }

    getRenderOptions() {
        return {
            dpi: parseInt(this.dpiSelect?.value || '300', 10),
            outputFormat: this.outputFormatSelect?.value || 'png',
            backgroundMode: this.backgroundModeSelect?.value || 'photobook',
            backgroundColor: this.bgColorInput?.value || '#ffffff',
            fontColorMode: this.fontColorModeSelect?.value || 'photobook',
            fontColor: this.fontColorInput?.value || '#000000'
        };
    }

    rerenderCurrentSelection() {
        if (this.renderedPages.length > 0 && this.lastRenderedIndices.length > 0) {
            this.renderSelectedPages(this.lastRenderedIndices);
        }
    }

    async handleDrop(dataTransfer) {
        const items = dataTransfer.items;

        for (const item of items) {
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry?.();
                if (entry) {
                    if (entry.isDirectory) {
                        await this.processDirectory(entry);
                    } else {
                        await this.processFile(entry);
                    }
                } else {
                    // Fallback for browsers without webkitGetAsEntry
                    const file = item.getAsFile();
                    if (file) {
                        await this.processDroppedFile(file);
                    }
                }
            }
        }

        this.checkReadyState();
    }

    async processDirectory(dirEntry) {
        this.logger.info(`Processing directory: ${dirEntry.name}`);

        const entries = await this.readDirectoryEntries(dirEntry);

        for (const entry of entries) {
            if (entry.isFile) {
                const file = await this.getFileFromEntry(entry);
                await this.processDroppedFile(file, entry.fullPath);
            } else if (entry.isDirectory) {
                // Process subdirectories (Photos, Texts)
                if (entry.name === 'Photos' || entry.name === 'Texts') {
                    await this.processDirectory(entry);
                }
            }
        }
    }

    readDirectoryEntries(dirEntry) {
        return new Promise((resolve) => {
            const reader = dirEntry.createReader();
            const entries = [];

            const readBatch = () => {
                reader.readEntries((batch) => {
                    if (batch.length === 0) {
                        resolve(entries);
                    } else {
                        entries.push(...batch);
                        readBatch();
                    }
                });
            };

            readBatch();
        });
    }

    getFileFromEntry(fileEntry) {
        return new Promise((resolve, reject) => {
            fileEntry.file(resolve, reject);
        });
    }

    async processDroppedFile(file, fullPath = '') {
        const path = fullPath || file.name;

        if (file.name === 'Project.ipp' || file.name.endsWith('.ipp')) {
            await this.loadProjectFile(file);
        } else if (path.includes('/Photos/') || path.includes('\\Photos\\')) {
            this.photos.set(file.name, file);
            this.logger.info(`Loaded photo: ${file.name}`);
        } else if (path.includes('/Texts/') || path.includes('\\Texts\\')) {
            this.texts.set(file.name, file);
            this.logger.info(`Loaded text: ${file.name}`);
        } else if (this.isImageFile(file.name)) {
            // Assume it's a photo if it's an image
            this.photos.set(file.name, file);
            this.logger.info(`Loaded photo: ${file.name}`);
        }
    }

    isImageFile(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
    }

    async loadProjectFile(file) {
        try {
            this.showStatus('Loading project file...', 'info');
            this.logger.info(`Loading project: ${file.name}`);

            const arrayBuffer = await file.arrayBuffer();
            this.project = await this.parser.parseProject(arrayBuffer);

            this.displayProjectInfo();
            this.showStatus('Project loaded successfully!', 'success');
            this.logger.success(`Project loaded: ${this.project.projectId}`);

            this.optionsPanel.classList.add('visible');
            this.projectInfo.classList.add('visible');
            this.logEl.classList.add('visible');
            this.updateOptionControlState();

            this.checkReadyState();
        } catch (error) {
            this.showStatus(`Error loading project: ${error.message}`, 'error');
            this.logger.error(`Failed to load project: ${error.message}`);
            console.error(error);
        }
    }

    loadPhotos(files) {
        for (const file of files) {
            this.photos.set(file.name, file);
            this.logger.info(`Loaded photo: ${file.name}`);
        }
        this.showStatus(`Loaded ${files.length} photos`, 'success');
        this.checkReadyState();
    }

    loadTexts(files) {
        this.texts.clear();
        let i = 0;
        for (const file of files) {
            this.texts.set(file.name, file);
            this.texts.set(String(i), file);
            i++;
            this.logger.info(`Loaded text: ${file.name}`);
        }
        this.showStatus(`Loaded ${files.length} text files`, 'success');
        this.checkReadyState();
    }

    countReferencedPhotosAndTexts(project) {
        const photoIds = new Set();
        const textIds = new Set();
        const collect = (objects) => {
            if (!objects) return;
            for (const obj of objects) {
                const f = obj.foreground;
                if (f?.type === 'image' && f.id) photoIds.add(f.id);
                if (f?.type === 'text' && f.textId) textIds.add(f.textId);
            }
        };
        const forPage = (page) => {
            if (page?.pageBackground?.pageObjects) collect(page.pageBackground.pageObjects);
            if (page?.pageLayers) {
                for (const layer of page.pageLayers) {
                    if (layer?.pageObjects) collect(layer.pageObjects);
                }
            }
        };
        if (project?.cover) forPage(project.cover);
        if (project?.pages) for (const page of project.pages) forPage(page);
        return { photoRefs: photoIds.size, textRefs: textIds.size };
    }

    displayProjectInfo() {
        if (!this.project) return;

        const totalPages = 1 + (this.project.pages?.length || 0);
        const { photoRefs, textRefs } = this.countReferencedPhotosAndTexts(this.project);
        const photosLabel = `${this.photos.size} (${photoRefs} referenced in book)`;
        const textsLabel = `${this.texts.size} (${textRefs} referenced in book)`;

        this.projectDetails.innerHTML = `
            <dt>Project ID</dt>
            <dd>${this.project.projectId || 'N/A'}</dd>
            <dt>Product ID</dt>
            <dd>${this.project.productId || 'N/A'}</dd>
            <dt>Version</dt>
            <dd>${this.project.version || 'N/A'}</dd>
            <dt>Design Center</dt>
            <dd>${this.project.designCenterVersion || 'N/A'}</dd>
            <dt>Created</dt>
            <dd>${this.project.created || 'N/A'}</dd>
            <dt>Total Pages</dt>
            <dd>${totalPages} (1 cover + ${totalPages - 1} pages)</dd>
            <dt>Photos Loaded</dt>
            <dd>${photosLabel}</dd>
            <dt>Texts Loaded</dt>
            <dd>${textsLabel}</dd>
        `;
    }

    checkReadyState() {
        const hasProject = this.project !== null;
        const hasPhotos = this.photos.size > 0;

        this.renderBtn.disabled = !hasProject;
        this.renderSomeBtn.disabled = !hasProject;
        this.displayProjectInfo();

        if (hasProject && hasPhotos) {
            this.logger.success('Ready to render! Click "Render All Pages" to start.');
        } else if (hasProject && !hasPhotos) {
            this.logger.warning('Project loaded but no photos. Add photos for complete rendering.');
        }
    }

    getPageList() {
        const list = [];
        if (this.project?.cover) {
            list.push({ page: this.project.cover, name: 'Cover', index: 0 });
        }
        if (this.project?.pages) {
            this.project.pages.forEach((page, i) => {
                const pageNum = page.pageDescription?.firstSidePageNumber;
                const pageNum2 = page.pageDescription?.secondSidePageNumber;
                let name = `Page ${i + 1}`;
                if (pageNum > 0 || pageNum2 > 0) {
                    name =
                        pageNum > 0 && pageNum2 > 0
                            ? `Pages ${pageNum}-${pageNum2}`
                            : `Page ${pageNum > 0 ? pageNum : pageNum2}`;
                }
                list.push({ page, name, index: i + 1 });
            });
        }
        return list;
    }

    openPageSelectModal() {
        const allPages = this.getPageList();
        if (allPages.length === 0) {
            this.showStatus('No pages in project', 'error');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay page-select-overlay';
        const listHtml = allPages
            .map(
                (p, i) =>
                    `<label class="page-select-item"><input type="checkbox" data-index="${i}" checked> ${p.name}</label>`
            )
            .join('');
        overlay.innerHTML = `
            <div class="lightbox-backdrop"></div>
            <div class="lightbox-content page-select-modal">
                <div class="lightbox-header">
                    <span class="lightbox-title">Select pages to render</span>
                    <button type="button" class="lightbox-close" aria-label="Close">×</button>
                </div>
                <div class="page-select-actions">
                    <button type="button" class="btn-small page-select-all">Select all</button>
                    <button type="button" class="btn-small page-select-none">Deselect all</button>
                </div>
                <div class="page-select-list">
                    ${listHtml}
                </div>
                <div class="page-select-footer">
                    <button type="button" class="btn btn-secondary page-select-cancel">Cancel</button>
                    <button type="button" class="btn btn-primary page-select-render">Render selected</button>
                </div>
            </div>
        `;

        const listEl = overlay.querySelector('.page-select-list');
        const close = () => {
            overlay.remove();
            document.body.style.overflow = '';
        };

        overlay.querySelector('.lightbox-backdrop').addEventListener('click', close);
        overlay.querySelector('.lightbox-close').addEventListener('click', close);
        overlay.querySelector('.page-select-cancel').addEventListener('click', close);
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        });

        overlay.querySelector('.page-select-all').addEventListener('click', () => {
            listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.checked = true;
            });
        });
        overlay.querySelector('.page-select-none').addEventListener('click', () => {
            listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.checked = false;
            });
        });

        overlay.querySelector('.page-select-render').addEventListener('click', () => {
            const indices = [...listEl.querySelectorAll('input[type="checkbox"]:checked')]
                .map((cb) => parseInt(cb.dataset.index, 10))
                .sort((a, b) => a - b);
            close();
            if (indices.length > 0) {
                this.renderSelectedPages(indices);
            } else {
                this.showStatus('Select at least one page', 'warning');
            }
        });

        document.body.style.overflow = 'hidden';
        document.body.appendChild(overlay);
        overlay.querySelector('.lightbox-close').focus();
    }

    async renderSelectedPages(indices) {
        if (!this.project) return;

        const allPages = this.getPageList();
        this.allPages = allPages;
        this.lastRenderedIndices = [...indices];

        this.renderBtn.disabled = true;
        this.renderSomeBtn.disabled = true;
        this.downloadAllBtn.disabled = true;
        this.pagesContainer.innerHTML = '';
        this.renderedPages = [];

        const scale = parseFloat(this.scaleSelect.value);
        const renderOptions = this.getRenderOptions();
        const total = indices.length;

        for (let k = 0; k < indices.length; k++) {
            const i = indices[k];
            const { page, name } = allPages[i];

            this.updateProgress(k, total, `Rendering ${name}...`);
            this.logger.info(`Rendering ${name}...`);

            try {
                const canvas = await this.renderer.renderPage(
                    page,
                    this.project,
                    this.photos,
                    this.texts,
                    this.parser,
                    scale,
                    renderOptions,
                    (msg) => this.logger.info(`  ${msg}`)
                );
                this.addPageCard(name, canvas, i);
                this.renderedPages.push({ name, canvas, pageIndex: i });
                this.logger.success(`  ${name} rendered successfully`);
            } catch (error) {
                this.logger.error(`  Error rendering ${name}: ${error.message}`);
                console.error(error);
            }
        }

        this.updateProgress(total, total, 'Complete!');
        this.renderBtn.disabled = false;
        this.renderSomeBtn.disabled = false;
        this.downloadAllBtn.disabled = this.renderedPages.length === 0;
        this.showStatus(`Rendered ${this.renderedPages.length} pages`, 'success');
    }

    async renderAllPages() {
        if (!this.project) {
            this.showStatus('No project loaded', 'error');
            return;
        }
        const allPages = this.getPageList();
        await this.renderSelectedPages(allPages.map((_, index) => index));
    }

    addPageCard(name, canvas, pageIndex) {
        const card = document.createElement('div');
        card.className = 'page-card';

        const dims = `${canvas.width} × ${canvas.height}`;

        card.innerHTML = `
            <h4>${name} <span>${dims}</span></h4>
            <div class="page-canvas-wrapper" role="button" tabindex="0" title="Click to view full screen"></div>
            <div class="page-actions">
                <button class="btn btn-primary btn-download">Download ${this.getOutputLabel()}</button>
            </div>
        `;

        const wrapper = card.querySelector('.page-canvas-wrapper');
        wrapper.appendChild(canvas);

        wrapper.addEventListener('click', (e) => {
            if (!e.target.closest('.btn-download')) this.openLightbox(pageIndex);
        });
        wrapper.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openLightbox(pageIndex);
            }
        });

        const downloadBtn = card.querySelector('.btn-download');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadCanvas(canvas, `${name.replace(/\s+/g, '_')}`);
        });

        this.pagesContainer.appendChild(card);
    }

    async openLightbox(pageIndex) {
        if (!this.allPages || !this.allPages[pageIndex]) return;
        const { page, name } = this.allPages[pageIndex];
        const renderOptions = this.getRenderOptions();

        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';
        overlay.innerHTML = `
            <div class="lightbox-backdrop"></div>
            <div class="lightbox-content">
                <div class="lightbox-header">
                    <span class="lightbox-title">${name} (fit to screen)</span>
                    <button type="button" class="lightbox-close" aria-label="Close">×</button>
                </div>
                <div class="lightbox-scroll">
                    <div class="lightbox-loading">Rendering…</div>
                </div>
            </div>
        `;

        const scrollEl = overlay.querySelector('.lightbox-scroll');
        const loadingEl = overlay.querySelector('.lightbox-loading');
        const titleEl = overlay.querySelector('.lightbox-title');

        const close = () => {
            overlay.remove();
            document.body.style.overflow = '';
        };

        overlay.querySelector('.lightbox-backdrop').addEventListener('click', close);
        overlay.querySelector('.lightbox-close').addEventListener('click', close);
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        });

        document.body.style.overflow = 'hidden';
        document.body.appendChild(overlay);
        overlay.querySelector('.lightbox-close').focus();

        try {
            const fullCanvas = await this.renderer.renderPage(
                page,
                this.project,
                this.photos,
                this.texts,
                this.parser,
                1,
                renderOptions,
                () => {}
            );
            loadingEl.remove();
            const img = document.createElement('img');
            img.src = fullCanvas.toDataURL('image/png');
            img.alt = name;
            img.className = 'lightbox-image fit-screen';
            const setMode = (mode) => {
                img.classList.toggle('fit-screen', mode === 'fit');
                img.classList.toggle('actual-size', mode === 'actual');
                scrollEl.classList.toggle('actual-size-mode', mode === 'actual');
                titleEl.textContent = `${name} (${mode === 'fit' ? 'fit to screen' : '100%'})`;
            };
            let mode = 'fit';
            img.addEventListener('click', () => {
                mode = mode === 'fit' ? 'actual' : 'fit';
                setMode(mode);
            });
            setMode(mode);
            scrollEl.appendChild(img);
        } catch (err) {
            loadingEl.textContent = 'Failed to render: ' + err.message;
        }
    }

    getOutputLabel() {
        const format = this.outputFormatSelect?.value || 'png';
        return format.toUpperCase();
    }

    getOutputExtension() {
        const format = this.outputFormatSelect?.value || 'png';
        return format === 'jpg' ? 'jpg' : format === 'pdf' ? 'pdf' : 'png';
    }

    getCanvasExportMimeType(format = this.outputFormatSelect?.value || 'png') {
        return format === 'jpg' ? 'image/jpeg' : 'image/png';
    }

    createExportCanvas(sourceCanvas, format = this.outputFormatSelect?.value || 'png') {
        if (format !== 'jpg') return sourceCanvas;
        const flattened = document.createElement('canvas');
        flattened.width = sourceCanvas.width;
        flattened.height = sourceCanvas.height;
        const ctx = flattened.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, flattened.width, flattened.height);
        ctx.drawImage(sourceCanvas, 0, 0);
        return flattened;
    }

    downloadCanvas(canvas, baseFilename) {
        const format = this.outputFormatSelect?.value || 'png';
        if (format === 'pdf') {
            this.downloadSinglePagePdf(canvas, baseFilename);
            return;
        }
        const exportCanvas = this.createExportCanvas(canvas, format);
        const link = document.createElement('a');
        link.download = `${baseFilename}.${this.getOutputExtension()}`;
        link.href = exportCanvas.toDataURL(this.getCanvasExportMimeType(format), 0.92);
        link.click();
    }

    downloadSinglePagePdf(canvas, baseFilename) {
        const pdf = new window.jspdf.jsPDF({
            orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`${baseFilename}.pdf`);
    }

    async downloadAllAsZip() {
        if (this.renderedPages.length === 0) return;

        this.downloadAllBtn.disabled = true;
        const format = this.outputFormatSelect?.value || 'png';
        this.logger.info(format === 'pdf' ? 'Creating PDF file...' : 'Creating ZIP file...');

        try {
            if (format === 'pdf') {
                await this.downloadAllAsPdf();
                this.logger.success('PDF downloaded!');
                return;
            }

            const zip = new JSZip();

            for (const { name, canvas } of this.renderedPages) {
                const exportCanvas = this.createExportCanvas(canvas, format);
                const dataUrl = exportCanvas.toDataURL(this.getCanvasExportMimeType(format), 0.92);
                const base64 = dataUrl.split(',')[1];
                zip.file(`${name.replace(/\s+/g, '_')}.${this.getOutputExtension()}`, base64, {
                    base64: true
                });
            }

            const content = await zip.generateAsync({ type: 'blob' });

            const link = document.createElement('a');
            link.download = `photobook_${this.project.projectId || 'export'}.zip`;
            link.href = URL.createObjectURL(content);
            link.click();

            URL.revokeObjectURL(link.href);
            this.logger.success('ZIP file downloaded!');
        } catch (error) {
            this.logger.error(`Failed to create export: ${error.message}`);
        } finally {
            this.downloadAllBtn.disabled = false;
        }
    }

    async downloadAllAsPdf() {
        const firstCanvas = this.renderedPages[0]?.canvas;
        if (!firstCanvas) return;

        const pdf = new window.jspdf.jsPDF({
            orientation: firstCanvas.width >= firstCanvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [firstCanvas.width, firstCanvas.height]
        });

        this.renderedPages.forEach(({ canvas }, index) => {
            if (index > 0) {
                pdf.addPage(
                    [canvas.width, canvas.height],
                    canvas.width >= canvas.height ? 'landscape' : 'portrait'
                );
            }
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
        });

        pdf.save(`photobook_${this.project.projectId || 'export'}.pdf`);
    }

    updateProgress(current, total, text) {
        const percent = total > 0 ? (current / total) * 100 : 0;
        this.progressFill.style.width = `${percent}%`;
        this.progressText.textContent = text;
    }

    showStatus(message, type = 'info') {
        this.statusEl.textContent = message;
        this.statusEl.className = `status visible ${type}`;

        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                this.statusEl.classList.remove('visible');
            }, 5000);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new IFConverterApp();
});
