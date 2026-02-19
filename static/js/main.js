/**
 * Main Entry Point for Hardlink Manager
 * Initializes modules and handles the main application loop.
 */

import State from './state.js';
import UI from './ui.js';
import API from './api.js';
import Wizard from './wizard.js';
import Results from './results.js';
import Schedules from './schedules.js';

const App = {
    async init() {
        console.log('App Initializing...');
        UI.init();
        Wizard.init();
        Results.init();
        Schedules.init();

        // Initial state sync
        this.syncState();

        // Subscribe to state changes
        State.subscribe((state) => this.onStateChange(state));

        // Initial view
        State.setView('dashboard');

        // Load initial data
        this.loadDashboardData();

        // Check for active tasks
        this.checkForActiveTask();
    },

    syncState() {
        // Load settings from localStorage if needed
        if (localStorage.getItem('darkMode') === 'enabled') {
            document.body.classList.add('dark-mode');
        }
    },

    onStateChange(state) {
        UI.renderView(state.currentView);

        if (state.currentView === 'dashboard') {
            this.loadDashboardData();
        } else if (state.currentView === 'results' && state.lastResults) {
            Results.render(state.lastResults);
        } else if (state.currentView === 'schedules') {
            Schedules.render();
        }
    },

    async loadDashboardData() {
        try {
            const history = await API.getHistory();
            this.renderHistory(history);
            this.updateStats(history);
        } catch (error) {
            console.error('Failed to load history:', error);
            UI.showNotification('Failed to load dashboard data', 'danger');
        }
    },

    renderHistory(history) {
        const container = document.getElementById('history-list');
        if (!container) return;

        if (history.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding: 20px;">No recent activity</p>';
            return;
        }

        let html = `
            <table class="history-table" style="width:100%; border-collapse: collapse;">
                <thead>
                    <tr style="text-align:left; border-bottom: 1px solid var(--border);">
                        <th style="padding: 12px;">Date</th>
                        <th style="padding: 12px;">Saved</th>
                        <th style="padding: 12px;">Status</th>
                        <th style="padding: 12px;">Action</th>
                    </tr>
                </thead>
                <tbody>
        `;

        history.slice(0, 5).forEach(item => {
            const date = new Date(item.date).toLocaleDateString();
            const savings = UI.formatBytes(item.summary.potential_savings || item.summary.space_saved || 0);
            html += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 12px;">${date}</td>
                    <td style="padding: 12px; font-weight:600; color:var(--success);">${savings}</td>
                    <td style="padding: 12px;"><span class="badge badge-success">Success</span></td>
                    <td style="padding: 12px;">
                        <button class="btn btn-outline btn-small view-history-btn" data-id="${item.scan_id}">View</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        // Bind view buttons
        container.querySelectorAll('.view-history-btn').forEach(btn => {
            btn.onclick = () => this.viewHistory(btn.dataset.id);
        });
    },

    updateStats(history) {
        const totalSaved = history.reduce((acc, item) => acc + (item.summary.potential_savings || item.summary.space_saved || 0), 0);
        const statsEl = document.getElementById('total-saved-stat');
        if (statsEl) statsEl.textContent = UI.formatBytes(totalSaved);

        const lastScanEl = document.getElementById('last-scan-stat');
        if (lastScanEl && history.length > 0) {
            const last = history[0];
            lastScanEl.textContent = new Date(last.date).toLocaleDateString();
        }
    },

    async viewHistory(scanId) {
        try {
            const results = await API.getScanResults(scanId);
            State.lastResults = results;
            State.setView('results');
            // We'll need a displayResults function in a results module eventually
            UI.showNotification(`Loaded results for scan ${scanId.substring(0, 8)}`, 'success');
        } catch (error) {
            UI.showNotification('Failed to load scan results', 'danger');
        }
    },

    async checkForActiveTask() {
        try {
            const active = await API.fetchJson('/get_active_task');
            if (active && active.id) {
                State.setActiveTask(active.id, active.type);
                State.setView('wizard');
                State.setWizardStep(3); // Go straight to progress
                Wizard.startPolling(active.id, active.type);
                UI.showNotification(`Resuming active ${active.type}...`, 'info');
            }
        } catch (e) { }
    }
};

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
