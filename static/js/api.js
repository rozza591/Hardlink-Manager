/**
 * API Module for Hardlink Manager
 * Handles all communication with the Flask backend.
 */

const API = {
    async fetchJson(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            let errorText = `HTTP error! status: ${response.status}`;
            try {
                const err = await response.json();
                errorText = err.error || errorText;
            } catch (e) { }
            throw new Error(errorText);
        }
        return await response.json();
    },

    // Scan Operations
    startScan(formData) {
        return this.fetchJson('/run_scan', {
            method: 'POST',
            body: formData
        });
    },

    getScanProgress(scanId) {
        return this.fetchJson(`/get_progress/${scanId}`);
    },

    getScanResults(scanId) {
        return this.fetchJson(`/get_results/${scanId}`);
    },

    cancelScan(scanId) {
        return this.fetchJson(`/cancel_scan/${scanId}`, { method: 'POST' });
    },

    togglePause(scanId, isPaused) {
        const action = isPaused ? 'resume_scan' : 'pause_scan';
        return this.fetchJson(`/${action}/${scanId}`, { method: 'POST' });
    },

    // Linking Operations
    performLink(scanId, linkType, strategy, selectedIndices = null) {
        const formData = new FormData();
        formData.append('link_type', linkType);
        formData.append('link_strategy', strategy);
        if (selectedIndices) {
            formData.append('selected_indices', JSON.stringify(selectedIndices));
        }
        return this.fetchJson(`/perform_link/${scanId}`, {
            method: 'POST',
            body: formData
        });
    },

    getLinkProgress(linkOpId) {
        return this.fetchJson(`/get_link_progress/${linkOpId}`);
    },

    getLinkResult(linkOpId) {
        return this.fetchJson(`/get_link_result/${linkOpId}`);
    },

    // History & Global
    getHistory() {
        return this.fetchJson('/get_history');
    },

    deleteHistory(scanId) {
        return this.fetchJson(`/delete_history/${scanId}`, { method: 'DELETE' });
    },

    clearCache() {
        return this.fetchJson('/clear_cache', { method: 'POST' });
    },

    // Schedules
    getSchedules() {
        return this.fetchJson('/get_schedules');
    },

    addSchedule(data) {
        return this.fetchJson('/add_schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    },

    deleteSchedule(jobId) {
        return this.fetchJson(`/delete_schedule/${jobId}`, { method: 'DELETE' });
    }
};

export default API;
