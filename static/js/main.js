import { state, PHASE_ORDER } from './state.js';
import { api } from './api.js';
import { ui } from './ui.js';

// --- Global Helpers for HTML Event Handlers ---
window.toggleDuplicateSet = ui.toggleDuplicateSet;
window.copyToClipboard = ui.copyToClipboard;
window.toggleSetSelection = toggleSetSelection; // Defined below
window.previewFile = previewFile; // Defined below

// --- Event Listeners ---
const form = document.getElementById("scan-form");
const addPathBtn = document.getElementById("add-path-btn");
const hardlinkCheckbox = document.getElementById("hardlink");
const softlinkCheckbox = document.getElementById("softlink");
const deleteCheckbox = document.getElementById("delete");
const dryrunCheckbox = document.getElementById("dryrun");
const saveAutoCheckbox = document.getElementById("save_auto");
const submitButton = document.getElementById("submit-btn");
const clearCacheBtn = document.getElementById("clear-cache-btn");
const hardlinkBtn = document.getElementById("perform-hardlink-btn");
const softlinkBtn = document.getElementById("perform-softlink-btn");
const deleteBtn = document.getElementById("perform-delete-btn");
const downloadJsonBtn = document.getElementById("download-json-btn");
const downloadPdfBtn = document.getElementById("download-pdf-btn");
const cancelScanBtn = document.getElementById("cancel-scan-btn");
const pauseScanBtn = document.getElementById("pause-scan-btn");
const prevPageBtn = document.getElementById("prev-page-btn");
const nextPageBtn = document.getElementById("next-page-btn");
const pageSizeSelect = document.getElementById("page-size-select");
const filterPathInput = document.getElementById("filter-path");
const filterMinSizeSelect = document.getElementById("filter-min-size");
const clearFilterBtn = document.getElementById("clear-filter-btn");
const openSchedulerBtn = document.getElementById("open-scheduler-btn");
const closeSchedulerBtn = document.querySelector(".close-modal");
const addScheduleBtn = document.getElementById("add-schedule-btn");
const schedCron = document.getElementById("sched-cron-preset");
const darkToggle = document.getElementById('darkToggle');

// Attach Listeners
if (submitButton) submitButton.addEventListener("click", handleStartScan);
if (addPathBtn) addPathBtn.addEventListener("click", addPathInput);
if (clearCacheBtn) clearCacheBtn.addEventListener("click", clearResults);
if (darkToggle) darkToggle.addEventListener('click', () => ui.toggleDarkMode(true));
if (hardlinkBtn) hardlinkBtn.addEventListener("click", () => performLink('hard'));
if (softlinkBtn) softlinkBtn.addEventListener("click", () => performLink('soft'));
if (deleteBtn) deleteBtn.addEventListener("click", () => performLink('delete'));
if (downloadJsonBtn) downloadJsonBtn.addEventListener("click", downloadJson);
if (downloadPdfBtn) downloadPdfBtn.addEventListener("click", downloadPdf);
if (cancelScanBtn) cancelScanBtn.addEventListener("click", cancelScan);
if (pauseScanBtn) pauseScanBtn.addEventListener("click", togglePause);

// Pagination
if (prevPageBtn) prevPageBtn.addEventListener("click", () => changePage(-1));
if (nextPageBtn) nextPageBtn.addEventListener("click", () => changePage(1));
if (pageSizeSelect) pageSizeSelect.addEventListener("change", (e) => {
    state.itemsPerPage = parseInt(e.target.value, 10);
    state.currentPage = 1;
    renderPage();
});

// Filters
let filterDebounceTimer = null;
if (filterPathInput) filterPathInput.addEventListener("input", () => {
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(applyFilters, 300);
});
if (filterMinSizeSelect) filterMinSizeSelect.addEventListener("change", applyFilters);
if (clearFilterBtn) clearFilterBtn.addEventListener("click", clearFilters);

// Checkbox Logic
if (hardlinkCheckbox) hardlinkCheckbox.addEventListener('change', () => handleLinkTypeSelection(hardlinkCheckbox));
if (softlinkCheckbox) softlinkCheckbox.addEventListener('change', () => handleLinkTypeSelection(softlinkCheckbox));
if (deleteCheckbox) deleteCheckbox.addEventListener('change', () => handleLinkTypeSelection(deleteCheckbox));
if (dryrunCheckbox) dryrunCheckbox.addEventListener('change', () => handleDryRunSelection(dryrunCheckbox));


// Scheduler
if (openSchedulerBtn) openSchedulerBtn.addEventListener("click", () => {
    document.getElementById("scheduler-modal").style.display = "block";
    loadSchedules();
});
if (closeSchedulerBtn) closeSchedulerBtn.addEventListener("click", () => document.getElementById("scheduler-modal").style.display = "none");
if (addScheduleBtn) addScheduleBtn.addEventListener("click", addSchedule);
if (schedCron) schedCron.addEventListener("change", (e) => {
    document.getElementById("sched-cron-custom").style.display = e.target.value === 'custom' ? 'block' : 'none';
});
window.onclick = function (event) {
    const modal = document.getElementById("scheduler-modal");
    if (event.target == modal) modal.style.display = "none";
    const pModal = document.getElementById("preview-modal");
    if (event.target == pModal) pModal.style.display = "none";
};

// Preview Modal Close
const closePreviewBtn = document.getElementById("close-preview-modal");
if (closePreviewBtn) closePreviewBtn.onclick = () => document.getElementById("preview-modal").style.display = "none";

// Helpers for dynamic paths
window.removePathInput = function (btn) {
    const row = btn.parentNode;
    if (document.querySelectorAll('.path-input-row').length > 1) {
        row.remove();
        updateRemoveButtons();
    }
};

function addPathInput() {
    const container = document.getElementById("paths-container");
    const newRow = document.createElement("div");
    newRow.className = "path-input-row";
    newRow.style = "display:flex; gap:10px; margin-bottom:5px;";
    newRow.innerHTML = `
        <input type="text" name="scan_paths" required placeholder="/data/media">
        <button type="button" class="remove-path-btn" style="background:#dc3545; padding:5px 10px; margin:0;" onclick="removePathInput(this)">×</button>
    `;
    container.appendChild(newRow);
    updateRemoveButtons();
}

function updateRemoveButtons() {
    const rows = document.querySelectorAll('.path-input-row');
    const disabled = rows.length === 1;
    rows.forEach(row => {
        const btn = row.querySelector('.remove-path-btn');
        if (btn) btn.disabled = disabled;
    });
}

function handleStartScan(e) {
    e.preventDefault();

    // Validate paths
    const pathInputs = document.querySelectorAll('input[name="scan_paths"]');
    let hasPath = false;
    pathInputs.forEach(input => { if (input.value.trim()) hasPath = true; });

    if (!hasPath) {
        ui.showError("Please enter at least one directory path.");
        if (pathInputs.length > 0) pathInputs[0].focus();
        return;
    }

    if (!hardlinkCheckbox.checked && !softlinkCheckbox.checked && !dryrunCheckbox.checked) {
        ui.showError("Please select an operation (Hardlink, Softlink, or Dry Run)."); return;
    }

    state.lastCompletedScanId = null;
    state.selectedSetIndices.clear();
    downloadJsonBtn.style.display = 'none';

    ui.resetStatusUI("Starting scan...");
    ui.elements.resultsDiv.style.display = "none";
    ui.elements.duplicatesDiv.innerHTML = "";
    ui.clearResultStats();
    ui.resetPhaseIndicator();

    if (state.scanPollInterval) { clearTimeout(state.scanPollInterval); state.scanPollInterval = null; }
    if (state.linkPollInterval) { clearTimeout(state.linkPollInterval); state.linkPollInterval = null; }

    const formData = new FormData(form);

    // UI State Locking
    submitButton.disabled = true; submitButton.textContent = 'Scanning...';
    pathInputs.forEach(input => input.disabled = true);
    if (addPathBtn) addPathBtn.disabled = true;
    document.querySelectorAll('.remove-path-btn').forEach(b => b.disabled = true);

    hardlinkCheckbox.disabled = true; softlinkCheckbox.disabled = true;
    dryrunCheckbox.disabled = true; saveAutoCheckbox.disabled = true;
    clearCacheBtn.disabled = true;

    api.runScan(formData).then(data => {
        if (data.status === "scan process started" && data.scan_id) {
            state.currentScanId = data.scan_id;
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('scan', data.scan_id);
            window.history.pushState({ scanId: data.scan_id }, '', newUrl);

            ui.updateStatusUI("Scan Queued", "Waiting...", 0);
            if (cancelScanBtn) cancelScanBtn.style.display = 'inline-block';
            if (pauseScanBtn) { pauseScanBtn.style.display = 'inline-block'; pauseScanBtn.textContent = 'Pause'; }

            pollForProgress(state.currentScanId, pollScanProgress);
        } else {
            throw new Error("Unexpected response: " + JSON.stringify(data));
        }
    }).catch(error => {
        console.error("Scan Start Error:", error);
        ui.showError("Scan failed to start: " + error.message);
        ui.resetStatusUI("Scan failed to start.", true);
        resetScanFormState();
    });
}

function resetScanFormState() {
    submitButton.textContent = 'Start Scan'; submitButton.disabled = false;
    document.querySelectorAll('input[name="scan_paths"]').forEach(input => input.disabled = false);
    if (addPathBtn) addPathBtn.disabled = false;
    updateRemoveButtons();

    hardlinkCheckbox.disabled = false; softlinkCheckbox.disabled = false;
    dryrunCheckbox.disabled = false; saveAutoCheckbox.disabled = false;
    clearCacheBtn.disabled = false;
    state.currentScanId = null;
    if (state.scanPollInterval) { clearTimeout(state.scanPollInterval); state.scanPollInterval = null; }
    if (cancelScanBtn) { cancelScanBtn.style.display = 'none'; cancelScanBtn.disabled = false; }
    if (pauseScanBtn) { pauseScanBtn.style.display = 'none'; pauseScanBtn.disabled = false; }
}

// --- Polling logic ---
function getAdaptiveInterval(phase, percentage) {
    if (phase === 'queued' || phase === 'init') return 2000;
    if (percentage > 95) return 500;
    if (percentage > 50) return 1000;
    return 1500;
}

function pollForProgress(id, pollFunction, intervalMs = 1500) {
    if (id === state.currentScanId && state.scanPollInterval) clearTimeout(state.scanPollInterval);
    if (id === state.currentLinkOpId && state.linkPollInterval) clearTimeout(state.linkPollInterval);

    function scheduleNext(interval) {
        const timeout = setTimeout(() => {
            if (pollFunction === pollScanProgress && id !== state.currentScanId) return;
            if (pollFunction === pollLinkProgress && id !== state.currentLinkOpId) return;
            pollFunction(id, () => {
                if (pollFunction === pollScanProgress) state.scanPollInterval = null;
                if (pollFunction === pollLinkProgress) state.linkPollInterval = null;
            });
        }, interval);
        if (pollFunction === pollScanProgress) state.scanPollInterval = timeout;
        if (pollFunction === pollLinkProgress) state.linkPollInterval = timeout;
    }

    pollFunction(id, () => { }); // Initial poll
}

function pollScanProgress(scanId, stopFn) {
    api.getProgress(scanId).then(data => {
        ui.updatePhaseIndicator(data.phase);
        const nextInterval = getAdaptiveInterval(data.phase, data.percentage || 0);

        if (data.status === "done" || data.status === "error" || data.status === "cancelled") {
            stopFn();
            const statusLabel = data.status === "done" ? "Scan Complete" :
                data.status === "cancelled" ? "Scan Cancelled" : "Scan Error";
            ui.updateStatusUI(data.phase || statusLabel, data.status, 100);
            if (data.status === "cancelled") ui.showError("Scan was cancelled.");

            fetchResults(scanId);
            resetScanFormState();
        } else if (data.status === "unknown") {
            stopFn(); ui.showError("Scan ID lost."); resetScanFormState();
        } else {
            if (pauseScanBtn && data.paused) {
                pauseScanBtn.textContent = 'Resume';
                ui.updateStatusUI("Paused", "Scan paused.", data.percentage, null, data.processed_items, data.total_items);
            } else {
                if (pauseScanBtn && pauseScanBtn.textContent === 'Resume') pauseScanBtn.textContent = 'Pause';
                ui.updateStatusUI(data.phase, data.status, data.percentage, data.eta_seconds, data.processed_items, data.total_items);
                ui.updateMicroProgress(data.micro_progress);
            }
            // Schedule next via helper
            state.scanPollInterval = setTimeout(() => pollForProgress(scanId, pollScanProgress, nextInterval), nextInterval);
        }
    }).catch(e => { stopFn(); ui.showError("Poll Error: " + e.message); resetScanFormState(); });
}

function pollLinkProgress(linkOpId, stopFn) {
    api.getLinkProgress(linkOpId).then(data => {
        if (data.status === "done" || data.status === "error") {
            stopFn();
            ui.updateStatusUI(data.phase || "Linking Complete", data.status, 100);
            fetchLinkResults(linkOpId);
        } else if (data.status === "unknown") {
            stopFn(); ui.showError("Link ID lost.");
        } else {
            ui.updateStatusUI(data.phase || "Linking", data.status, data.percentage);
            // Simple fixed interval for linking
            state.linkPollInterval = setTimeout(() => pollForProgress(linkOpId, pollLinkProgress, 1000), 1000);
        }
    }).catch(e => { stopFn(); ui.showError("Link Poll Error: " + e.message); });
}

function fetchResults(scanId) {
    ui.updateStatusUI("Fetching Results", "...", 100);
    api.getResults(scanId).then(data => {
        ui.elements.statusMessage.style.display = "none";
        ui.elements.errorMessageDiv.style.display = "none";
        ui.elements.resultsDiv.style.display = "block";
        if (data.error) ui.showError(data.error);
        displayScanResults(data, scanId);
    }).catch(e => { ui.showError(e.message); });
}

function fetchLinkResults(linkOpId) {
    api.getLinkResult(linkOpId).then(data => {
        ui.elements.statusMessage.style.display = "none";
        ui.elements.resultsDiv.style.display = "block";
        // Update UI logic for link results needs to be in UI or here?
        // Let's implement displayLinkResults logic here or move to UI. 
        // For now, I'll update UI directly or move that function to ui.js?
        // ui.displayLinkResults(data) would be cleaner.
        // Let's assume ui.displayLinkResults exists or implement it here?
        // app.js had displayLinkResults. I missed adding it to ui.js?
        // Let's add it to main.js as a local helper or add to ui.js
        displayLinkResultsLocal(data);
    });
}

function displayLinkResultsLocal(data) {
    const el = ui.elements;
    el.resultAction.textContent = data.summary || 'Linking finished.';
    el.resultSavings.textContent = data.space_saved !== "Verification failed" ? ui.formatBytes(data.space_saved) : data.space_saved;
    document.getElementById("link-actions").style.display = "none";
    // Update download buttons
    if (data.download_json_available) {
        downloadJsonBtn.style.display = "inline-block";
        downloadJsonBtn.onclick = () => downloadJson(state.lastCompletedScanId);
    }
}


function displayScanResults(data, scanId) {
    // Reset state variables
    state.lastCompletedScanId = null;
    ui.clearResultStats();

    if (!data.summary) { ui.showError("Invalid results."); return; }

    const s = data.summary;
    const el = ui.elements;

    el.resultAction.textContent = s.action_taken;
    el.resultBeforeSize.textContent = ui.formatBytes(s.before_size);
    el.resultSavings.textContent = ui.formatBytes(s.potential_savings);
    el.resultAfterSize.textContent = ui.formatBytes(s.after_size);
    el.resultDuration.textContent = s.duration ? s.duration.toFixed(2) + 's' : 'N/A';

    // Space Viz
    if (el.spaceViz) {
        if (s.before_size > 0) {
            el.spaceViz.style.display = 'block';
            el.vizBarSaved.style.width = ((s.potential_savings / s.before_size) * 100) + '%';
            el.vizBarUsed.style.width = ((s.after_size / s.before_size) * 100) + '%';
        } else {
            el.spaceViz.style.display = 'none';
        }
    }

    // Buttons
    if (s.is_dry_run && s.potential_savings > 0) {
        document.getElementById("link-actions").style.display = "block";
        hardlinkBtn.disabled = false;
        softlinkBtn.disabled = false;
        if (deleteBtn) deleteBtn.disabled = false;
    } else {
        document.getElementById("link-actions").style.display = "none";
    }

    if (data.download_json_available) {
        downloadJsonBtn.style.display = 'inline-block';
        state.lastCompletedScanId = scanId;
    }

    // Duplicates list
    if (data.duplicates && data.duplicates.length > 0) {
        state.allDuplicates = data.duplicates;
        state.filteredDuplicates = [...state.allDuplicates];
        state.currentPage = 1;
        document.getElementById("filter-controls").style.display = 'block';
        renderPage();
    } else {
        ui.elements.duplicatesDiv.innerHTML = "<p>No duplicates found.</p>";
        ui.elements.paginationControls.style.display = "none";
    }
}

function renderPage() {
    ui.renderDuplicatesPage(state.filteredDuplicates, state.currentPage, state.itemsPerPage, state.allDuplicates, state.selectedSetIndices);
    ui.updatePaginationControls(state.filteredDuplicates, state.currentPage, state.itemsPerPage);
}

function changePage(delta) {
    const maxPage = Math.ceil(state.filteredDuplicates.length / state.itemsPerPage);
    const newPage = state.currentPage + delta;
    if (newPage >= 1 && newPage <= maxPage) {
        state.currentPage = newPage;
        renderPage();
        ui.elements.duplicatesDiv.scrollIntoView({ behavior: 'smooth' });
    }
}

function toggleSetSelection(index) {
    if (state.selectedSetIndices.has(index)) {
        state.selectedSetIndices.delete(index);
    } else {
        state.selectedSetIndices.add(index);
    }
}

function previewFile(path) {
    const modal = document.getElementById("preview-modal");
    const content = document.getElementById("preview-content");
    const pathEl = document.getElementById("preview-path");

    pathEl.textContent = path;
    content.textContent = "Loading...";
    modal.style.display = "block";

    fetch(`/preview_file?path=${encodeURIComponent(path)}`)
        .then(r => r.text())
        .then(text => content.textContent = text)
        .catch(e => content.textContent = "Error: " + e.message);
}

// --- Filter Logic ---
function applyFilters() {
    const pathFilter = (filterPathInput.value || '').toLowerCase().trim();
    const minSize = parseInt(filterMinSizeSelect.value || '0', 10);

    state.filteredDuplicates = state.allDuplicates.filter(set => {
        if (!set || set.length < 2) return false;
        const sizeInfo = set[0];
        const files = set.slice(1);

        // Path filter
        if (pathFilter && !files.some(f => f.path.toLowerCase().includes(pathFilter))) return false;

        // Size filter logic (parse size string)
        if (minSize > 0) {
            const sizeMatch = sizeInfo.match(/Size:\s*([\d.]+)\s*(Bytes|KB|MB|GB|TB)/i);
            if (sizeMatch) {
                const val = parseFloat(sizeMatch[1]);
                const unit = sizeMatch[2].toUpperCase();
                const mult = { 'BYTES': 1, 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4 };
                if (val * (mult[unit] || 1) < minSize) return false;
            }
        }
        return true;
    });

    state.currentPage = 1;
    renderPage();
    const info = document.getElementById("filter-info");
    if (state.filteredDuplicates.length !== state.allDuplicates.length) {
        info.textContent = `Showing ${state.filteredDuplicates.length} of ${state.allDuplicates.length}`;
    } else {
        info.textContent = '';
    }
}

function clearFilters() {
    filterPathInput.value = '';
    filterMinSizeSelect.value = '0';
    state.filteredDuplicates = [...state.allDuplicates];
    state.currentPage = 1;
    renderPage();
}

function performLink(type) {
    if (!state.lastCompletedScanId) return ui.showError("No scan ID.");

    let confirmMsg = `Perform ${type} linking?`;
    if (type === 'delete') confirmMsg = "WARNING: This will permanently DELETE duplicate files. Are you sure?";

    if (!confirm(confirmMsg)) return;

    const formData = new FormData();
    formData.append('link_type', type);
    const method = document.getElementById("link-strategy");
    if (method) formData.append('link_strategy', method.value);

    if (state.selectedSetIndices.size > 0) {
        formData.append('selected_indices', JSON.stringify(Array.from(state.selectedSetIndices)));
    }

    api.performLink(state.lastCompletedScanId, formData).then(data => {
        if (data.status === "linking process started") {
            state.currentLinkOpId = data.link_op_id;
            ui.updateStatusUI("Linking Started", "...", 0);
            pollForProgress(state.currentLinkOpId, pollLinkProgress);
        } else {
            throw new Error(data.error);
        }
    }).catch(e => ui.showError(e.message));
}

function cancelScan() {
    if (!state.currentScanId) return;
    if (!confirm("Cancel?")) return;
    api.cancelScan(state.currentScanId).then(() => {
        ui.updateStatusUI("Cancelling", "...", 0);
    });
}
function togglePause() {
    if (!state.currentScanId) return;
    const isPaused = pauseScanBtn.textContent === 'Resume';
    const action = isPaused ? api.resumeScan : api.pauseScan;
    action(state.currentScanId).then(() => {
        pauseScanBtn.textContent = isPaused ? 'Pause' : 'Resume';
    });
}
function clearResults() { ui.clearResults(); } // Need to add to UI or keep local? App.js had clearResults.
// Re-implement clearResults properly
function clearResults() {
    if (state.currentScanId) return alert("Scan likely in progress");
    ui.elements.resultsDiv.style.display = 'none';
    ui.elements.duplicatesDiv.innerHTML = '';
    state.lastCompletedScanId = null;
    api.clearCache();
}

// Helpers for checkboxes
function handleLinkTypeSelection(cb) {
    if (cb.checked) {
        dryrunCheckbox.checked = false;
        // Mutual exclusion for link types
        if (cb.id === 'hardlink') { softlinkCheckbox.checked = false; deleteCheckbox.checked = false; }
        else if (cb.id === 'softlink') { hardlinkCheckbox.checked = false; deleteCheckbox.checked = false; }
        else if (cb.id === 'delete') { hardlinkCheckbox.checked = false; softlinkCheckbox.checked = false; }
    }
}
function handleDryRunSelection(cb) {
    if (cb.checked) {
        hardlinkCheckbox.checked = false;
        softlinkCheckbox.checked = false;
        deleteCheckbox.checked = false;
    }
}

function downloadJson(id) {
    const target = id && typeof id === 'string' ? id : state.lastCompletedScanId;
    if (target) window.location.href = `/download_results/${target}/json`;
}
function downloadPdf(id) {
    const target = id && typeof id === 'string' ? id : state.lastCompletedScanId;
    if (target) window.location.href = `/download_pdf/${target}`;
}

// Scheduler Helpers
function loadSchedules() {
    api.getSchedules().then(data => {
        const div = document.getElementById("schedule-list");
        if (data.length === 0) div.innerHTML = "No schedules.";
        else {
            div.innerHTML = "<ul>" + data.map(j => `<li>${j.name} (${j.cron}) <button onclick="deleteSchedule('${j.id}')">Del</button></li>`).join('') + "</ul>";
        }
    });
}
// Delete Schedule Helper needs to be window.deleteSchedule or via list re-render with listeners
window.deleteSchedule = (id) => {
    fetch(`/delete_schedule/${id}`, { method: 'POST' }).then(loadSchedules);
};
function addSchedule() {
    const name = document.getElementById("sched-name").value;
    const path = document.getElementById("sched-path").value;
    const cron = schedCron.value === 'custom' ? document.getElementById("sched-cron-custom").value : schedCron.value;
    // Add validation...
    const formData = new FormData();
    formData.append("name", name);
    formData.append("path", path);
    formData.append("cron", cron);
    // ... handling options ...
    // Simplified for this conversion step
    fetch("/add_schedule", { method: "POST", body: formData }).then(loadSchedules);
}

// --- Initialization ---

function init() {
    // 1. Dark Mode
    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        ui.toggleDarkMode(false);
    } else if (darkToggle) {
        darkToggle.textContent = 'Dark Mode';
        darkToggle.classList.remove('active');
    }

    // 2. Check URL for explicit scan result request
    const urlParams = new URLSearchParams(window.location.search);
    const scanIdFromUrl = urlParams.get('scan');
    if (scanIdFromUrl) {
        console.log('Found scan ID in URL:', scanIdFromUrl);
        state.lastCompletedScanId = scanIdFromUrl;
        fetchResults(scanIdFromUrl);
    }

    // 3. Discover Active Task (Live Update)
    api.getActiveTask().then(task => {
        if (!task || task.active_task === null || !task.type) return;

        if (task.type === 'scan') {
            console.log("Discovering active scan:", task.id);
            state.currentScanId = task.id;

            // Lock UI
            submitButton.disabled = true; submitButton.textContent = 'Scanning...';
            document.querySelectorAll('input[name="scan_paths"]').forEach(input => input.disabled = true);
            if (addPathBtn) addPathBtn.disabled = true;
            document.querySelectorAll('.remove-path-btn').forEach(b => b.disabled = true);
            hardlinkCheckbox.disabled = true; softlinkCheckbox.disabled = true;
            dryrunCheckbox.disabled = true; saveAutoCheckbox.disabled = true;
            clearCacheBtn.disabled = true;

            ui.updateStatusUI(task.data.phase || "Active Scan Found", task.data.status, task.data.percentage);
            if (cancelScanBtn) cancelScanBtn.style.display = 'inline-block';
            if (pauseScanBtn) {
                pauseScanBtn.style.display = 'inline-block';
                pauseScanBtn.textContent = task.data.paused ? 'Resume' : 'Pause';
            }

            pollForProgress(task.id, pollScanProgress);
        } else if (task.type === 'link') {
            console.log("Discovering active link operation:", task.id);
            state.currentLinkOpId = task.id;
            // Lock UI
            submitButton.disabled = true;
            ui.updateStatusUI(task.data.phase || "Active Linking Found", task.data.status, task.data.percentage);
            pollForProgress(task.id, pollLinkProgress);
        }
    }).catch(err => {
        console.warn("No active task discovered or error:", err);
    });
}

// Global entry point
init();
