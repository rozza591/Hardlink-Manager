/**
 * UI Module for Hardlink Manager
 * Handles DOM updates, view switching, and notifications.
 */

import State from './state.js';

const UI = {
    elements: {
        views: document.querySelectorAll('.view-section'),
        navItems: document.querySelectorAll('.nav-item'),
        toastContainer: null
    },

    init() {
        console.log('UI Module Initializing...');
        this.createToastContainer();
        this.bindEvents();
    },

    bindEvents() {
        // Nav Item Clicks
        this.elements.navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                if (view) State.setView(view);
            });
        });

        // Toggle Dark Mode
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const isDark = document.body.classList.toggle('dark-mode');
                localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
                themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            });
        }
    },

    renderView(viewName) {
        console.log(`Rendering view: ${viewName}`);
        this.elements.views.forEach(view => {
            view.classList.toggle('active', view.id === `${viewName}-view`);
        });

        this.elements.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });
    },

    // --- Notifications ---
    createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;
        document.body.appendChild(container);
        this.elements.toastContainer = container;
    },

    showNotification(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = `
            background-color: var(--bg-card);
            color: var(--text-main);
            padding: 12px 20px;
            border-radius: var(--border-radius);
            box-shadow: var(--shadow);
            border-left: 4px solid var(--${type});
            animation: slideIn 0.3s ease-out;
            min-width: 250px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        toast.innerHTML = `
            <span>${message}</span>
            <button style="background:none; border:none; color:var(--text-muted); cursor:pointer;">&times;</button>
        `;

        this.elements.toastContainer.appendChild(toast);

        // Auto remove
        setTimeout(() => this.removeToast(toast), 5000);

        toast.querySelector('button').onclick = () => this.removeToast(toast);
    },

    removeToast(toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    },

    // --- Formatters ---
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = 2;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}m ${s}s`;
    },

    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};

export default UI;
