const form = document.getElementById("scan-form");
const pathInput = document.getElementById("path1");
const hardlinkCheckbox = document.getElementById("hardlink");
const softlinkCheckbox = document.getElementById("softlink");
const dryrunCheckbox = document.getElementById("dryrun");
const saveAutoCheckbox = document.getElementById("save_auto");
const submitButton = document.getElementById("submit-btn");
const statusMessage = document.getElementById("status-message");
const statusPhase = document.getElementById("status-phase");
const statusDetails = document.getElementById("status-details");
const statusCount = document.getElementById("status-count");
const statusEta = document.getElementById("status-eta");
const progressBar = document.getElementById("progress-bar-inner");
const resultsDiv = document.getElementById("results");
const errorMessageDiv = document.getElementById("error-message");
const duplicatesDiv = document.getElementById("duplicates");
const clearCacheBtn = document.getElementById("clear-cache-btn");
const darkToggle = document.getElementById('darkToggle');
const resultAction = document.getElementById("result-action");
const resultBeforeSize = document.getElementById("result-before-size");
const resultAfterSize = document.getElementById("result-after-size");
const resultSavings = document.getElementById("result-savings");
const resultDuration = document.getElementById("result-duration");
const linkActionsDiv = document.getElementById("link-actions");
const hardlinkBtn = document.getElementById("perform-hardlink-btn");
const softlinkBtn = document.getElementById("perform-softlink-btn");
const downloadJsonBtn = document.getElementById("download-json-btn");
const cancelScanBtn = document.getElementById("cancel-scan-btn");
const pauseScanBtn = document.getElementById("pause-scan-btn");
const paginationControls = document.getElementById("pagination-controls");
const prevPageBtn = document.getElementById("prev-page-btn");
const nextPageBtn = document.getElementById("next-page-btn");
const pageInfoSpan = document.getElementById("page-info");
const pageSizeSelect = document.getElementById("page-size-select");
const filterControls = document.getElementById("filter-controls");
const filterPathInput = document.getElementById("filter-path");
const filterMinSizeSelect = document.getElementById("filter-min-size");
const clearFilterBtn = document.getElementById("clear-filter-btn");
const filterInfo = document.getElementById("filter-info");
const spaceViz = document.getElementById("space-viz");
const vizBarUsed = document.getElementById("viz-bar-used");
const vizBarSaved = document.getElementById("viz-bar-saved");

// --- State Variables ---
let currentScanId = null;
let currentLinkOpId = null;
let scanPollInterval = null;
let linkPollInterval = null;
let lastCompletedScanId = null;
let lastPhase = null; // Track last phase for adaptive polling
const PHASE_ORDER = ['Finding Files', 'Pre-Hashing', 'Full Hashing', 'Analyzing Hashes', 'Linking Files', 'Complete'];
// Pagination State
let currentPage = 1;
let itemsPerPage = 25;
let allDuplicates = [];
let filteredDuplicates = []; // Filtered subset of allDuplicates
let selectedSetIndices = new Set(); // Stores indices of selected duplicate sets

// --- Event Listeners ---
if (submitButton) {
    submitButton.addEventListener("click", (e) => {
        e.preventDefault();
        if (!pathInput.value.trim()) { showError("Please enter a directory path."); pathInput.focus(); return; }
        if (!hardlinkCheckbox.checked && !softlinkCheckbox.checked && !dryrunCheckbox.checked) { showError("Please select an operation (Hardlink, Softlink, or Dry Run)."); return; }
        startScan();
    });
}
if (clearCacheBtn) clearCacheBtn.addEventListener("click", clearResults);
if (darkToggle) darkToggle.addEventListener('click', () => toggleDarkMode(true));
if (hardlinkBtn) hardlinkBtn.addEventListener("click", () => performLink('hard'));
if (softlinkBtn) softlinkBtn.addEventListener("click", () => performLink('soft'));
if (downloadJsonBtn) downloadJsonBtn.addEventListener("click", downloadJson);
if (cancelScanBtn) cancelScanBtn.addEventListener("click", cancelScan);
if (pauseScanBtn) pauseScanBtn.addEventListener("click", togglePause);
// Pagination Event Listeners
if (prevPageBtn) prevPageBtn.addEventListener("click", () => changePage(-1));
if (nextPageBtn) nextPageBtn.addEventListener("click", () => changePage(1));
if (pageSizeSelect) pageSizeSelect.addEventListener("change", (e) => {
    itemsPerPage = parseInt(e.target.value, 10);
    currentPage = 1; // Reset to first page
    renderDuplicatesPage();
    updatePaginationControls();
});

// Filter Event Listeners
let filterDebounceTimer = null;
if (filterPathInput) filterPathInput.addEventListener("input", () => {
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(applyFilters, 300); // Debounce 300ms
});
if (filterMinSizeSelect) filterMinSizeSelect.addEventListener("change", applyFilters);
if (clearFilterBtn) clearFilterBtn.addEventListener("click", clearFilters);

// --- Initialization ---
if (localStorage.getItem('darkMode') === 'enabled') {
    document.body.classList.add('dark-mode');
    toggleDarkMode(false);
} else if (darkToggle) {
    darkToggle.textContent = 'Dark Mode';
    darkToggle.classList.remove('active');
}

// Check URL for scan ID on page load
(function checkUrlForScanId() {
    const urlParams = new URLSearchParams(window.location.search);
    const scanIdFromUrl = urlParams.get('scan');
    if (scanIdFromUrl) {
        console.log('Found scan ID in URL:', scanIdFromUrl);
        lastCompletedScanId = scanIdFromUrl;
        fetchResults(scanIdFromUrl);
    }
})();

// --- Checkbox Logic ---
function handleLinkTypeSelection(checkbox) {
    if (checkbox.checked) {
        dryrunCheckbox.checked = false;
        if (checkbox.id === 'hardlink') softlinkCheckbox.checked = false;
        else if (checkbox.id === 'softlink') hardlinkCheckbox.checked = false;
    }
}
function handleDryRunSelection(checkbox) {
    if (checkbox.checked) {
        hardlinkCheckbox.checked = false;
        softlinkCheckbox.checked = false;
    }
}

// --- Core Application Functions ---
function startScan() {
    lastCompletedScanId = null;
    downloadJsonBtn.style.display = 'none';
    resetStatusUI("Starting scan...");
    resultsDiv.style.display = "none";
    linkActionsDiv.style.display = "none";
    errorMessageDiv.style.display = "none";
    duplicatesDiv.innerHTML = "";
    duplicatesDiv.innerHTML = "";
    clearResultStats();
    resetPhaseIndicator();
    if (scanPollInterval) { clearTimeout(scanPollInterval); scanPollInterval = null; }
    if (linkPollInterval) { clearTimeout(linkPollInterval); linkPollInterval = null; }
    selectedSetIndices.clear(); // Clear selection
    const formData = new FormData(form);
    submitButton.disabled = true; submitButton.textContent = 'Scanning...';
    pathInput.disabled = true;
    hardlinkCheckbox.disabled = true; softlinkCheckbox.disabled = true;
    dryrunCheckbox.disabled = true; saveAutoCheckbox.disabled = true;
    clearCacheBtn.disabled = true;

    console.log("Starting scan process...");
    console.log("Form data:", Object.fromEntries(formData));

    fetch("/run_scan", { method: "POST", body: formData })
        .then(handleFetchResponse)
        .then(data => {
            if (data.status === "scan process started" && data.scan_id) {
                currentScanId = data.scan_id;
                // Update URL with scan ID for sharing/refreshing
                const newUrl = new URL(window.location);
                newUrl.searchParams.set('scan', data.scan_id);
                window.history.pushState({ scanId: data.scan_id }, '', newUrl);
                updateStatusUI("Scan Queued", "Waiting...", 0);
                // Show cancel and pause buttons
                if (cancelScanBtn) cancelScanBtn.style.display = 'inline-block';
                if (pauseScanBtn) { pauseScanBtn.style.display = 'inline-block'; pauseScanBtn.textContent = 'Pause'; }
                pollForProgress(currentScanId, pollScanProgress);
            } else {
                throw new Error("Unexpected response starting scan: " + (data.error || JSON.stringify(data)));
            }
        }).catch(error => {
            handleFetchError(error, "Scan Start");
            resetStatusUI("Scan failed to start.", true);
            resetScanFormState();
        });
}

function resetScanFormState() {
    submitButton.textContent = 'Start Scan'; submitButton.disabled = false;
    pathInput.disabled = false;
    hardlinkCheckbox.disabled = false; softlinkCheckbox.disabled = false;
    dryrunCheckbox.disabled = false; saveAutoCheckbox.disabled = false;
    clearCacheBtn.disabled = false;
    currentScanId = null;
    if (scanPollInterval) { clearInterval(scanPollInterval); scanPollInterval = null; }
    // Hide cancel and pause buttons
    if (cancelScanBtn) { cancelScanBtn.style.display = 'none'; cancelScanBtn.disabled = false; }
    if (pauseScanBtn) { pauseScanBtn.style.display = 'none'; pauseScanBtn.disabled = false; }
}

function togglePause() {
    if (!currentScanId) return;
    const isPaused = pauseScanBtn.textContent === 'Resume';
    const action = isPaused ? 'resume_scan' : 'pause_scan';
    const newText = isPaused ? 'Pause' : 'Resume';

    pauseScanBtn.disabled = true;

    fetch(`/${action}/${currentScanId}`, { method: "POST" })
        .then(handleFetchResponse)
        .then(data => {
            pauseScanBtn.textContent = newText;
            pauseScanBtn.disabled = false;
        })
        .catch(error => {
            handleFetchError(error, "Pause/Resume");
            pauseScanBtn.disabled = false;
        });
}

function cancelScan() {
    if (!currentScanId) {
        showError("No active scan to cancel.");
        return;
    }
    if (!confirm("Are you sure you want to cancel the current scan?")) return;

    cancelScanBtn.disabled = true;
    cancelScanBtn.textContent = 'Cancelling...';

    fetch(`/cancel_scan/${currentScanId}`, { method: "POST" })
        .then(handleFetchResponse)
        .then(data => {
            console.log("Cancel response:", data);
            updateStatusUI("Cancelling", "Waiting for scan to stop...", null);
        })
        .catch(error => {
            handleFetchError(error, "Cancel Scan");
            cancelScanBtn.disabled = false;
            cancelScanBtn.textContent = 'Cancel Scan';
        });
}

function performLink(linkType) {
    if (!lastCompletedScanId) { showError("Cannot perform link: No completed dry run scan ID available."); return; }

    const selectionCount = selectedSetIndices.size;
    const confirmMsg = selectionCount > 0
        ? `Confirm ${linkType} linking for ${selectionCount} selected SETS? This modifies files.`
        : `Confirm ${linkType} linking for ALL duplicate sets based on the last dry run? This modifies files.`;

    if (!confirm(confirmMsg)) return;
    hardlinkBtn.disabled = true; softlinkBtn.disabled = true;
    linkActionsDiv.style.display = "none";
    resetStatusUI(`Starting ${linkType} linking...`);
    const formData = new FormData();
    formData.append('link_type', linkType);

    if (selectedSetIndices.size > 0) {
        formData.append('selected_indices', JSON.stringify(Array.from(selectedSetIndices)));
    }

    fetch(`/perform_link/${lastCompletedScanId}`, { method: "POST", body: formData })
        .then(handleFetchResponse)
        .then(data => {
            if (data.status === "linking process started" && data.link_op_id) {
                currentLinkOpId = data.link_op_id;
                updateStatusUI("Linking Initialized", "Waiting...", 0);
                pollForProgress(currentLinkOpId, pollLinkProgress);
            } else { throw new Error("Unexpected response starting linking: " + (data.error || JSON.stringify(data))); }
        }).catch(error => { handleFetchError(error, `Start ${linkType} Link`); resetStatusUI(`Failed to start ${linkType} linking.`, true); });
}

function toggleSetSelection(index) {
    if (selectedSetIndices.has(index)) {
        selectedSetIndices.delete(index);
    } else {
        selectedSetIndices.add(index);
    }
}

// --- Polling Functions ---
function getAdaptiveInterval(phase, percentage) {
    // Fast polling during active work, slower when queued or near completion
    if (phase === 'queued' || phase === 'init') return 2000;
    if (percentage > 95) return 500; // Very fast near completion
    if (percentage > 50) return 1000; // Faster in second half
    return 1500; // Normal speed
}

function pollForProgress(id, pollFunction, intervalMs = 1500) {
    if (id === currentScanId && scanPollInterval) clearInterval(scanPollInterval);
    if (id === currentLinkOpId && linkPollInterval) clearInterval(linkPollInterval);

    let currentInterval = intervalMs;

    function doPoll() {
        if ((pollFunction === pollScanProgress && id !== currentScanId) || (pollFunction === pollLinkProgress && id !== currentLinkOpId)) {
            console.log(`Polling stopped for ${id}.`);
            return;
        }
        pollFunction(id, () => {
            if (pollFunction === pollScanProgress) scanPollInterval = null;
            if (pollFunction === pollLinkProgress) linkPollInterval = null;
        });
    }

    // Start polling with adaptive intervals
    function scheduleNext(interval) {
        const timeout = setTimeout(() => {
            doPoll();
        }, interval);
        if (pollFunction === pollScanProgress) scanPollInterval = timeout;
        if (pollFunction === pollLinkProgress) linkPollInterval = timeout;
    }

    doPoll(); // Initial immediate poll
    scheduleNext(currentInterval);
}
function pollScanProgress(scanId, stopFn) {
    fetch(`/get_progress/${scanId}`).then(handleFetchResponse).then(data => {
        updatePhaseIndicator(data.phase);
        const nextInterval = getAdaptiveInterval(data.phase, data.percentage || 0);
        if (data.status === "done" || data.status === "error" || data.status === "cancelled") {
            stopFn();
            let statusLabel = data.status === "done" ? "Scan Complete" :
                data.status === "cancelled" ? "Scan Cancelled" : "Scan Error";
            updateStatusUI(data.phase || statusLabel, data.status, 100);
            if (data.status === "cancelled") {
                showError("Scan was cancelled by user.");
            }
            fetchResults(scanId);
            resetScanFormState();
        }
        else if (data.status === "unknown") { stopFn(); showError("Scan ID lost."); resetStatusUI("Scan lost.", true); resetScanFormState(); }
        else {
            // Check if paused via status text or add explicit flag in backend response if needed
            // For now, if we locally know it's paused, we can update UI, but backend status is authoritative
            if (pauseScanBtn && data.paused) {
                pauseScanBtn.textContent = 'Resume';
                updateStatusUI("Paused", "Scan paused by user.", data.percentage || 0, null, data.processed_items, data.total_items);
            } else {
                if (pauseScanBtn && pauseScanBtn.textContent === 'Resume') pauseScanBtn.textContent = 'Pause';
                updateStatusUI(data.phase || "Processing", data.status || "Working...", data.percentage || 0, data.eta_seconds, data.processed_items, data.total_items);
            }
            // Schedule next poll with adaptive interval
            setTimeout(() => pollForProgress(scanId, pollScanProgress, nextInterval), nextInterval);
        }
    }).catch(error => { stopFn(); handleFetchError(error, "Scan Poll"); resetStatusUI("Polling error.", true); resetScanFormState(); });
}
function pollLinkProgress(linkOpId, interval) {
    fetch(`/get_link_progress/${linkOpId}`).then(handleFetchResponse).then(data => {
        if (data.status === "done" || data.status === "error") { clearInterval(interval); linkPollInterval = null; updateStatusUI(data.phase || (data.status === "done" ? "Linking Complete" : "Linking Error"), "Fetching final results...", 100); fetchLinkResults(linkOpId); }
        else if (data.status === "unknown") { clearInterval(interval); linkPollInterval = null; showError("Link operation ID lost."); resetStatusUI("Linking operation lost.", true); }
        else { updateStatusUI(data.phase || "Linking", data.status || "Working...", data.percentage || 0); }
    }).catch(error => { clearInterval(interval); linkPollInterval = null; handleFetchError(error, "Link Poll"); resetStatusUI("Link polling error.", true); });
}

// --- Result Fetching ---
function fetchResults(scanId) {
    updateStatusUI("Fetching Scan Results", "Please wait...", 100);
    fetch(`/get_results/${scanId}`).then(handleFetchResponse).then(data => {
        statusMessage.style.display = "none"; resultsDiv.style.display = "block";
        errorMessageDiv.style.display = "none"; if (data.error) { showError(data.error); }
        displayScanResults(data, scanId);
    }).catch(error => { handleFetchError(error, "Fetch Scan Results"); resetStatusUI("Failed to get scan results.", true); });
}
function fetchLinkResults(linkOpId) {
    updateStatusUI("Fetching Link Results", "Please wait...", 100);
    fetch(`/get_link_result/${linkOpId}`).then(handleFetchResponse).then(data => {
        statusMessage.style.display = "none"; resultsDiv.style.display = "block";
        errorMessageDiv.style.display = "none"; if (data.error) { showError(data.error); }
        displayLinkResults(data);
    }).catch(error => { handleFetchError(error, "Fetch Link Results"); resetStatusUI("Failed to get link results.", true); });
}

// --- Display Functions ---
/**
 * Renders the scan results data into the HTML elements.
 * Populates summary stats, shows link buttons (if dry run), and lists duplicates.
 * MODIFIED to show hash instead of inode.
 * @param {object} data - The results object received from the backend.
 * @param {string} scanId - The ID of the scan these results belong to.
 */
function displayScanResults(data, scanId) {
    linkActionsDiv.style.display = "none"; hardlinkBtn.disabled = false; softlinkBtn.disabled = false;
    downloadJsonBtn.style.display = 'none';
    lastCompletedScanId = null;
    clearResultStats();

    if (!data || !data.summary) { showError("Incomplete scan results received."); return; }
    const summary = data.summary; const isDryRun = summary.is_dry_run;
    const hasAnyDuplicates = Array.isArray(data.duplicates) && data.duplicates.length > 0;
    const hasUnlinkedDuplicates = hasAnyDuplicates && summary.potential_savings > 0;

    resultAction.textContent = summary.action_taken || 'N/A';
    resultBeforeSize.textContent = formatBytes(summary.before_size);
    resultSavings.textContent = formatBytes(summary.potential_savings) + (hasUnlinkedDuplicates && isDryRun ? ' (Potential)' : (hasUnlinkedDuplicates ? ' (Actual)' : ' (None)'));
    resultAfterSize.textContent = formatBytes(summary.after_size) + (isDryRun ? " (Theoretical)" : "");
    resultDuration.textContent = summary.duration ? `${summary.duration.toFixed(2)} s` : 'N/A';

    // Update Space Visualization
    if (spaceViz && summary.before_size > 0) {
        spaceViz.style.display = 'block';
        const total = summary.before_size;
        const saved = summary.potential_savings;
        const used = summary.after_size;
        const savedPct = (saved / total) * 100;
        const usedPct = (used / total) * 100;

        if (vizBarUsed) vizBarUsed.style.width = `${usedPct}%`;
        if (vizBarSaved) vizBarSaved.style.width = `${savedPct}%`;
    } else if (spaceViz) {
        spaceViz.style.display = 'none';
    }

    if (isDryRun && hasUnlinkedDuplicates) { linkActionsDiv.style.display = "block"; }

    if (data.download_json_available && scanId) {
        downloadJsonBtn.style.display = 'inline-block';
        lastCompletedScanId = scanId;
    }
    if (lastCompletedScanId) console.log("Download buttons updated for scan:", lastCompletedScanId);

    // --- Pagination Logic ---
    if (Array.isArray(data.duplicates) && data.duplicates.length > 0) {
        allDuplicates = data.duplicates;
        filteredDuplicates = [...allDuplicates]; // Start with all duplicates
        currentPage = 1;
        // Show filter controls
        if (filterControls) filterControls.style.display = 'block';
        // Reset filter inputs
        if (filterPathInput) filterPathInput.value = '';
        if (filterMinSizeSelect) filterMinSizeSelect.value = '0';
        if (filterInfo) filterInfo.textContent = '';
        renderDuplicatesPage();
        updatePaginationControls();
    } else if (summary.no_duplicates) {
        duplicatesDiv.innerHTML = "<p>No duplicate files found.</p>";
        paginationControls.style.display = "none";
        if (filterControls) filterControls.style.display = 'none';
    } else {
        duplicatesDiv.innerHTML = "<p>No duplicate sets to display.</p>";
        paginationControls.style.display = "none";
        if (filterControls) filterControls.style.display = 'none';
    }
}

function changePage(delta) {
    const maxPage = Math.ceil(filteredDuplicates.length / itemsPerPage);
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= maxPage) {
        currentPage = newPage;
        renderDuplicatesPage();
        updatePaginationControls();
        duplicatesDiv.scrollIntoView({ behavior: 'smooth' });
    }
}

function renderDuplicatesPage() {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredDuplicates.length);
    const pageItems = filteredDuplicates.slice(startIndex, endIndex);

    let html = `<h3>Duplicate File Sets Found: (Showing ${startIndex + 1}-${endIndex} of ${filteredDuplicates.length})</h3>`;
    pageItems.forEach((set_with_size, index) => {
        // Find original index in allDuplicates for consistent numbering
        const originalIndex = allDuplicates.indexOf(set_with_size);
        const displayIndex = originalIndex >= 0 ? originalIndex : startIndex + index;

        if (!Array.isArray(set_with_size) || set_with_size.length < 2) return;
        const sizeInfo = set_with_size[0];
        const fileInfos = set_with_size.slice(1);
        const isSetAlreadyLinked = fileInfos[0]?.already_linked === true;
        const isSelected = selectedSetIndices.has(displayIndex);

        html += `<div class="duplicate-set ${isSetAlreadyLinked ? 'already-linked' : ''}" data-set-index="${displayIndex}">`;
        html += `<div class="set-header">`;
        html += `<input type="checkbox" class="set-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSetSelection(${displayIndex})" onclick="event.stopPropagation()">`;
        html += `<h4 onclick="toggleDuplicateSet(${displayIndex})"><span>Set #${displayIndex + 1} (${fileInfos.length} files)${isSetAlreadyLinked ? ' - Already Linked' : ''}</span></h4>`;
        html += `</div>`;
        if (sizeInfo) { html += `<p class="size-info">${escapeHtml(sizeInfo)}</p>`; }
        html += "<ul>";
        fileInfos.forEach((fileInfo, fileIndex) => {
            const isOriginal = fileIndex === 0;
            const filePath = escapeHtml(fileInfo.path);
            const rawPath = fileInfo.path.replace(/'/g, "\\'");
            const fullHash = fileInfo.hash || 'N/A';
            const shortHash = fullHash.length > 8 ? fullHash.substring(0, 8) + '...' : fullHash;
            const hashDisplay = escapeHtml(shortHash);
            const linkedTag = fileInfo.already_linked ? '<span class="already-linked-tag">[Linked]</span>' : '';
            const originalTag = isOriginal ? ' <strong style="font-size: 0.85em;">(Keep This)</strong>' : '';
            const copyBtn = `<button class="copy-path-btn" onclick="copyToClipboard('${rawPath}', this); event.stopPropagation();" title="Copy path">&#128203;</button>`;
            html += `<li ${isOriginal ? 'style="font-weight:bold;"' : ''}>${filePath}${copyBtn}<span class="hash-info" title="${escapeHtml(fullHash)}">[Hash: ${hashDisplay}]</span>${linkedTag}${originalTag}</li>`;
        });
        html += "</ul></div>";
    });
    duplicatesDiv.innerHTML = html;
}

function updatePaginationControls() {
    const maxPage = Math.max(1, Math.ceil(filteredDuplicates.length / itemsPerPage));
    if (filteredDuplicates.length === 0) {
        paginationControls.style.display = "none";
        return;
    }
    paginationControls.style.display = "flex";
    pageInfoSpan.textContent = `Page ${currentPage} of ${maxPage} (${filteredDuplicates.length} sets)`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === maxPage;
}

// --- Filter Functions ---
function applyFilters() {
    const pathFilter = (filterPathInput?.value || '').toLowerCase().trim();
    const minSizeFilter = parseInt(filterMinSizeSelect?.value || '0', 10);

    filteredDuplicates = allDuplicates.filter(set_with_size => {
        if (!Array.isArray(set_with_size) || set_with_size.length < 2) return false;

        // Extract size from the size info string (e.g., "Size: 1.5 MB")
        const sizeInfo = set_with_size[0];
        const fileInfos = set_with_size.slice(1);

        // Check path filter - any file in set must match
        if (pathFilter) {
            const hasMatchingPath = fileInfos.some(fi =>
                fi.path && fi.path.toLowerCase().includes(pathFilter)
            );
            if (!hasMatchingPath) return false;
        }

        // Check size filter
        if (minSizeFilter > 0) {
            // Parse size from "Size: X.XX MB" format
            const sizeMatch = sizeInfo.match(/Size:\s*([\d.]+)\s*(Bytes|KB|MB|GB|TB)/i);
            if (sizeMatch) {
                const sizeVal = parseFloat(sizeMatch[1]);
                const sizeUnit = sizeMatch[2].toUpperCase();
                const multipliers = { 'BYTES': 1, 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4 };
                const sizeBytes = sizeVal * (multipliers[sizeUnit] || 1);
                if (sizeBytes < minSizeFilter) return false;
            }
        }

        return true;
    });

    currentPage = 1;
    renderDuplicatesPage();
    updatePaginationControls();
    updateFilterInfo();
}

function clearFilters() {
    if (filterPathInput) filterPathInput.value = '';
    if (filterMinSizeSelect) filterMinSizeSelect.value = '0';
    filteredDuplicates = [...allDuplicates];
    currentPage = 1;
    renderDuplicatesPage();
    updatePaginationControls();
    if (filterInfo) filterInfo.textContent = '';
}

function updateFilterInfo() {
    if (!filterInfo) return;
    if (filteredDuplicates.length === allDuplicates.length) {
        filterInfo.textContent = '';
    } else {
        filterInfo.textContent = `Showing ${filteredDuplicates.length} of ${allDuplicates.length} sets (filtered)`;
    }
}

/**
 * Updates the results display (primarily the summary section) after a
 * linking operation completes.
 * @param {object} data - The results object received from the backend link result endpoint.
 */
function displayLinkResults(data) {
    if (!data || !data.summary) { showError("Incomplete link results received."); return; }
    resultAction.textContent = data.summary || 'Linking finished.';
    if (data.space_saved !== undefined && data.space_saved !== "Verification failed, savings uncertain") { resultSavings.textContent = formatBytes(data.space_saved) + ' (Actual)'; }
    else if (data.space_saved === "Verification failed, savings uncertain") { resultSavings.textContent = 'Verification failed, savings uncertain'; }
    linkActionsDiv.style.display = "none";

    // --- Update Download Buttons State (based on original scan) ---
    if (data.download_json_available && lastCompletedScanId) { downloadJsonBtn.style.display = 'inline-block'; }
    else { downloadJsonBtn.style.display = 'none'; }
    // PDF Button check removed

    if (lastCompletedScanId) console.log("Download buttons updated after linking, for original scan:", lastCompletedScanId);
}

// --- Download Functions ---
function downloadJson() {
    if (!lastCompletedScanId) { showError("Cannot download JSON: No completed scan ID available."); return; }
    console.log(`Triggering JSON download for scan ID: ${lastCompletedScanId}`);
    window.location.href = `/download_results/${lastCompletedScanId}/json`;
}

// --- UI & Utility Functions ---
function resetStatusUI(message = "", isError = false) {
    statusPhase.textContent = message;
    statusDetails.textContent = "";
    statusCount.textContent = "";
    statusEta.textContent = "";
    progressBar.style.width = isError ? "100%" : "0%";
    progressBar.style.backgroundColor = isError ? "#dc3545" : "#007bff";
    statusMessage.style.display = message ? "flex" : "none";
}

function updateStatusUI(phase, details, percentage, etaSeconds, processedItems, totalItems) {
    statusPhase.textContent = phase || "Processing";
    statusDetails.textContent = details || "...";
    const clampedPercentage = Math.max(0, Math.min(100, percentage || 0));
    progressBar.style.width = `${clampedPercentage}%`;
    progressBar.style.backgroundColor = "#007bff";
    statusMessage.style.display = "flex";

    if (processedItems !== undefined && totalItems !== undefined && totalItems > 0) {
        statusCount.textContent = `Processed: ${processedItems} / ${totalItems}`;
    } else {
        statusCount.textContent = "";
    }

    if (etaSeconds !== undefined && etaSeconds !== null) {
        statusEta.textContent = `ETA: ${formatTime(etaSeconds)}`;
    } else {
        statusEta.textContent = "";
    }
}
function clearResultStats() { resultAction.textContent = 'N/A'; resultBeforeSize.textContent = 'N/A'; resultAfterSize.textContent = 'N/A'; resultSavings.textContent = 'N/A'; resultDuration.textContent = 'N/A'; }
function showError(message) { console.error("UI Error:", message); errorMessageDiv.textContent = message; errorMessageDiv.style.display = "block"; }
function clearResults() {
    if (currentScanId || currentLinkOpId) { alert("Cannot clear results while an operation is in progress."); return; }
    resultsDiv.style.display = "none"; errorMessageDiv.style.display = "none"; duplicatesDiv.innerHTML = "";
    clearResultStats(); resetStatusUI(); linkActionsDiv.style.display = "none";
    downloadJsonBtn.style.display = 'none';
    lastCompletedScanId = null;
    fetch("/clear_cache", { method: "POST" }).then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)).then(d => console.log("Clear Cache:", d.message)).catch(e => console.error("Clear cache failed:", e));
}
function toggleDarkMode(doToggleAndSave) {
    const body = document.body;
    if (doToggleAndSave) { body.classList.toggle('dark-mode'); }
    const isActive = body.classList.contains('dark-mode');
    if (isActive) { darkToggle.textContent = 'Light Mode'; darkToggle.classList.add('active'); }
    else { darkToggle.textContent = 'Dark Mode'; darkToggle.classList.remove('active'); }
    if (doToggleAndSave) {
        if (isActive) { localStorage.setItem('darkMode', 'enabled'); }
        else { localStorage.removeItem('darkMode'); }
    }
}
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}
function escapeHtml(unsafe) { if (typeof unsafe !== 'string') return unsafe; return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function formatBytes(bytes, d = 2) { if (bytes === undefined || bytes === null || isNaN(bytes) || bytes < 0) return '0 Bytes'; if (bytes < 1) return '0 Bytes'; const k = 1024; const dm = d < 0 ? 0 : d; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); const validIndex = Math.min(i, sizes.length - 1); return `${parseFloat((bytes / Math.pow(k, validIndex)).toFixed(dm))} ${sizes[validIndex]}`; }
async function handleFetchResponse(response) { if (!response.ok) { let errorDetail = `HTTP ${response.status}`; try { const errorData = await response.json(); errorDetail = errorData.error || JSON.stringify(errorData); } catch (e) { } throw new Error(errorDetail); } return response.json(); }
function handleFetchError(error, context = "Fetch") { console.error(`Error during ${context}:`, error); showError(`Operation failed (${context}): ${error.message}`); }

// --- New Utility Functions ---
function toggleDuplicateSet(index) {
    const setDiv = document.querySelector(`.duplicate-set[data-set-index="${index}"]`);
    if (setDiv) {
        setDiv.classList.toggle('collapsed');
    }
}

function copyToClipboard(text, buttonEl) {
    navigator.clipboard.writeText(text).then(() => {
        buttonEl.classList.add('copied');
        buttonEl.innerHTML = '&#10003;'; // Checkmark
        setTimeout(() => {
            buttonEl.classList.remove('copied');
            buttonEl.innerHTML = '&#128203;'; // Clipboard icon
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

function updatePhaseIndicator(currentPhase) {
    const phases = document.querySelectorAll('.progress-phase');
    let foundCurrent = false;

    phases.forEach(phaseEl => {
        const phaseName = phaseEl.dataset.phase;
        const currentIndex = PHASE_ORDER.indexOf(currentPhase);
        const phaseIndex = PHASE_ORDER.indexOf(phaseName);

        phaseEl.classList.remove('active', 'completed');

        if (phaseName === currentPhase || currentPhase === 'Complete' && phaseName === 'Complete') {
            phaseEl.classList.add('active');
            foundCurrent = true;
        } else if (currentIndex > phaseIndex && currentIndex >= 0) {
            phaseEl.classList.add('completed');
        }
    });
}

function resetPhaseIndicator() {
    document.querySelectorAll('.progress-phase').forEach(p => p.classList.remove('active', 'completed'));
}
