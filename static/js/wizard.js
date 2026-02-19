/**
 * Wizard Module for Hardlink Manager
 * Handles the multi-step scan creation process.
 */

import State from './state.js';
import UI from './ui.js';
import API from './api.js';

const Wizard = {
    pollInterval: null,

    init() {
        console.log('Wizard Module Initializing...');
        this.bindEvents();
    },

    bindEvents() {
        // Step 1 -> 2
        const next1 = document.getElementById('wizard-next-1');
        if (next1) {
            next1.onclick = () => {
                const paths = this.getPaths();
                if (paths.length === 0 || !paths[0]) {
                    UI.showNotification('Please enter at least one path', 'warning');
                    return;
                }
                State.updateWizard({ paths });
                this.goToStep(2);
            };
        }

        // Back 2 -> 1
        const prev2 = document.getElementById('wizard-prev-2');
        if (prev2) prev2.onclick = () => this.goToStep(1);

        // Add Path
        document.getElementById('wizard-add-path-btn').onclick = () => this.addPathInput();

        // Strategy Selection
        document.querySelectorAll('.strategy-card').forEach(card => {
            card.onclick = () => {
                document.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                State.updateWizard({ strategy: card.dataset.strategy });
            };
        });

        // Toggle Advanced
        document.getElementById('wizard-toggle-advanced').onclick = () => {
            const el = document.getElementById('wizard-advanced-filters');
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        };

        // Start button
        document.getElementById('wizard-start-btn').onclick = () => this.startScan();

        // Control buttons
        document.getElementById('wizard-cancel-btn').onclick = () => this.cancelScan();
        document.getElementById('wizard-pause-btn').onclick = () => this.togglePause();
    },

    goToStep(step) {
        State.setWizardStep(step);
        // UI updates
        document.querySelectorAll('.step').forEach(s => {
            const sNum = parseInt(s.dataset.step);
            s.classList.toggle('active', sNum === step);
            s.classList.toggle('completed', sNum < step);
        });

        document.querySelectorAll('.step-content').forEach(c => {
            c.style.display = c.id === `step-${step}-content` ? 'block' : 'none';
        });
    },

    addPathInput() {
        const container = document.getElementById('wizard-paths-container');
        const row = document.createElement('div');
        row.className = 'path-row';
        row.innerHTML = `
            <input type="text" placeholder="/path/to/media" class="wizard-path-input">
            <button class="btn btn-danger btn-icon remove-path-btn"><i class="fas fa-trash"></i></button>
        `;
        container.appendChild(row);

        row.querySelector('.remove-path-btn').onclick = () => row.remove();
    },

    getPaths() {
        return Array.from(document.querySelectorAll('.wizard-path-input'))
            .map(input => input.value.trim())
            .filter(v => v !== '');
    },

    async startScan() {
        const config = State.wizard;
        const formData = new FormData();

        config.paths.forEach(p => formData.append('scan_paths', p));
        formData.append('min_file_size', config.filters.minSize);
        formData.append('min_file_size_unit', config.filters.unit);
        formData.append('ignore_dirs', config.filters.ignoreDirs);
        formData.append('ignore_exts', config.filters.ignoreExts);

        if (config.strategy === 'report') {
            formData.append('dryrun', 'on');
        } else if (config.strategy === 'hard') {
            formData.append('hardlink', 'on');
        } else if (config.strategy === 'delete') {
            formData.append('delete', 'on');
        }

        try {
            this.goToStep(3);
            const data = await API.startScan(formData);
            State.setActiveTask(data.scan_id, 'scan');
            this.startPolling(data.scan_id, 'scan');
        } catch (error) {
            UI.showNotification(error.message, 'danger');
            this.goToStep(2);
        }
    },

    startPolling(taskId, type) {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(async () => {
            try {
                const data = type === 'scan'
                    ? await API.getScanProgress(taskId)
                    : await API.getLinkProgress(taskId);

                this.updateProgressUI(data);

                if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
                    clearInterval(this.pollInterval);
                    this.onTaskComplete(taskId, type, data.status);
                }
            } catch (e) {
                console.error('Polling error:', e);
            }
        }, 1500);
    },

    updateProgressUI(data) {
        const pct = data.percentage || 0;
        const fill = document.getElementById('wizard-gauge-fill');
        const pctText = document.getElementById('wizard-progress-pct');
        const phaseLabel = document.getElementById('wizard-phase-label');
        const countLabel = document.getElementById('wizard-processed-count');
        const totalLabel = document.getElementById('wizard-total-count');

        if (fill) {
            // Circle circumference is ~283 (2 * pi * 45)
            const offset = 283 - (pct / 100 * 283);
            fill.style.strokeDasharray = `${283 - offset} 283`;
        }
        if (pctText) pctText.textContent = `${pct}%`;
        if (phaseLabel) phaseLabel.textContent = data.phase || data.status;
        if (countLabel) countLabel.textContent = data.processed_items || 0;
        if (totalLabel) totalLabel.textContent = data.total_items || 0;

        const pauseBtn = document.getElementById('wizard-pause-btn');
        if (pauseBtn) {
            // Links don't have pause usually in core.py, but we'll show it if supported
            pauseBtn.style.display = State.activeTask.type === 'scan' ? 'flex' : 'none';
            pauseBtn.innerHTML = data.paused ? '<i class="fas fa-play"></i> Resume' : '<i class="fas fa-pause"></i> Pause';
            State.updateTaskProgress({ paused: data.paused });
        }
    },

    async togglePause() {
        const id = State.activeTask.id;
        if (!id || State.activeTask.type !== 'scan') return;
        try {
            await API.togglePause(id, State.activeTask.paused);
        } catch (e) {
            UI.showNotification('Failed to toggle pause', 'danger');
        }
    },

    async cancelScan() {
        const id = State.activeTask.id;
        if (!id) return;
        if (State.activeTask.type !== 'scan') {
            UI.showNotification('Link operations cannot be cancelled normally', 'warning');
            return;
        }
        if (!confirm('Are you sure you want to cancel?')) return;
        try {
            await API.cancelScan(id);
        } catch (e) {
            UI.showNotification('Failed to cancel scan', 'danger');
        }
    },

    onTaskComplete(taskId, type, status) {
        if (status === 'done') {
            UI.showNotification(`${type === 'scan' ? 'Scan' : 'Linking'} completed successfully`, 'success');
            if (type === 'scan') {
                this.showResults(taskId);
            } else {
                this.showLinkResults(taskId);
            }
        } else {
            UI.showNotification(`${type} ended with status: ${status}`, 'warning');
            State.setView('dashboard');
        }
    },

    async showLinkResults(linkOpId) {
        try {
            const results = await API.getLinkResult(linkOpId);
            // Link results are simpler, we can just show a success modal or update results view
            UI.showNotification(`Linked ${results.summary}`, 'success');
            State.setView('dashboard');
        } catch (e) {
            UI.showNotification('Failed to load link results', 'danger');
        }
    },

    async showResults(scanId) {
        try {
            const results = await API.getScanResults(scanId);
            State.lastResults = results;
            State.setView('results');
            // Implementation for rendering results would go here
        } catch (e) {
            UI.showNotification('Failed to load results', 'danger');
        }
    }
};

export default Wizard;
