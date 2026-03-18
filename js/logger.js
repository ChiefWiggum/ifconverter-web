/**
 * Logger - UI logging utility
 */

export class Logger {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.logEl = document.getElementById('log');
    }

    log(message, type = 'info') {
        if (!this.container) return;

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;

        const timestamp = new Date().toLocaleTimeString();
        entry.textContent = `[${timestamp}] ${message}`;

        this.container.appendChild(entry);
        this.container.scrollTop = this.container.scrollHeight;

        // Show log panel if hidden
        if (this.logEl) {
            this.logEl.classList.add('visible');
        }
    }

    info(message) {
        this.log(message, 'info');
    }

    success(message) {
        this.log(message, 'success');
    }

    warning(message) {
        this.log(message, 'warning');
    }

    error(message) {
        this.log(message, 'error');
    }

    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
