/**
 * Results Module for Hardlink Manager
 * Renders scan results and handles deduplication actions.
 */

import State from './state.js';
import UI from './ui.js';
import API from './api.js';

const Results = {
    init() {
        console.log('Results Module Initializing...');
    },

    render(results) {
        const container = document.getElementById('results-view');
        if (!container) return;

        const summary = results.summary;
        const scanId = results.scan_id || State.activeTask.id;

        container.innerHTML = `
            <header class="view-header">
                <h1>Scan Results</h1>
                <p>Analysis for ${results.scan_id.substring(0, 8)} finished.</p>
            </header>

            <div class="card summary-card" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; border-bottom: 4px solid var(--primary);">
                <div>
                    <label>Actionable Savings</label>
                    <h2 style="color:var(--success); margin:0;">${UI.formatBytes(summary.potential_savings || 0)}</h2>
                </div>
                <div>
                    <label>Duplicate Sets</label>
                    <h2 style="margin:0;">${results.duplicates ? results.duplicates.length : 0}</h2>
                </div>
                <div>
                    <label>Total Scanned</label>
                    <h2 style="margin:0;">${UI.formatBytes(summary.before_size || 0)}</h2>
                </div>
            </div>

            <div class="action-bar card" style="display:flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin:0;">Apply Optimization</h4>
                    <p style="margin:0; font-size: 0.85rem; color:var(--text-muted);">Permanently link these files to save space.</p>
                </div>
                <div style="display:flex; gap:12px;">
                    <button class="btn btn-primary" id="apply-hardlink-btn">
                        <i class="fas fa-link"></i> Apply Hardlinks
                    </button>
                    <button class="btn btn-outline" id="apply-delete-btn">
                        <i class="fas fa-trash"></i> Delete Duplicates
                    </button>
                    <button class="btn btn-outline" id="download-report-btn">
                        <i class="fas fa-download"></i> JSON
                    </button>
                </div>
            </div>

            <div class="duplicates-container card">
                <div class="card-title">Detected Duplicate Sets</div>
                <div id="results-list">
                    ${this.renderList(results.duplicates)}
                </div>
            </div>
        `;

        this.bindEvents(results);
    },

    renderList(duplicates) {
        if (!duplicates || duplicates.length === 0) return '<p>No duplicates found.</p>';

        return duplicates.map((set, idx) => {
            const sizeInfo = set[0];
            const files = set.slice(1);
            return `
                <div class="duplicate-item" style="padding: 16px; border-bottom: 1px solid var(--border); transition: background 0.2s;">
                    <div style="display:flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="font-weight:700;">Set #${idx + 1}</span>
                        <span style="font-size:0.85rem; color:var(--text-muted);">${sizeInfo}</span>
                    </div>
                    <ul style="margin:0; padding-left: 18px; font-size: 0.9rem; color: var(--text-muted);">
                        ${files.map((f, fIdx) => `
                            <li style="${fIdx === 0 ? 'color:var(--text-main); font-weight:500;' : ''}">
                                ${f.path} ${f.already_linked ? '<span style="color:var(--success); font-size:0.75rem;">[Linked]</span>' : ''}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }).join('');
    },

    bindEvents(results) {
        const scanId = results.scan_id || State.activeTask.id;

        document.getElementById('apply-hardlink-btn').onclick = () => this.executeAction(scanId, 'hard');
        document.getElementById('apply-delete-btn').onclick = () => this.executeAction(scanId, 'delete');
        document.getElementById('download-report-btn').onclick = () => {
            window.location.href = `/download_results/${scanId}/json`;
        };
    },

    async executeAction(scanId, type) {
        if (!confirm(`Are you sure you want to perform ${type} linking? This will modify your files.`)) return;

        try {
            const data = await API.performLink(scanId, type, 'path');
            UI.showNotification(`Starting ${type} operation...`, 'info');

            // Re-use wizard Step 3 for tracking link progress?
            // For now, let's just go back to dashboard and notify completion via pooling (if we had a global tracker)
            State.setActiveTask(data.link_op_id, 'link');
            State.setView('wizard');
            State.setWizardStep(3);

            // We'd need to update Wizard module to handle polling for LINK tasks too
            // Let's assume Wizard.startPolling handles it or we add a generic Task module
        } catch (error) {
            UI.showNotification(error.message, 'danger');
        }
    }
};

export default Results;
