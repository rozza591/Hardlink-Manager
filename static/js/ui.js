import { state, PHASE_ORDER } from './state.js';

export const ui = {
    elements: {
        statusMessage: document.getElementById("status-message"),
        statusPhase: document.getElementById("status-phase"),
        statusDetails: document.getElementById("status-details"),
        statusCount: document.getElementById("status-count"),
        statusEta: document.getElementById("status-eta"),
        progressBar: document.getElementById("progress-bar-inner"),
        microProgressContainer: document.getElementById("micro-progress-container"),
        microProgressList: document.getElementById("micro-progress-list"),
        resultsDiv: document.getElementById("results"),
        errorMessageDiv: document.getElementById("error-message"),
        duplicatesDiv: document.getElementById("duplicates"),
        resultAction: document.getElementById("result-action"),
        resultBeforeSize: document.getElementById("result-before-size"),
        resultAfterSize: document.getElementById("result-after-size"),
        resultSavings: document.getElementById("result-savings"),
        resultDuration: document.getElementById("result-duration"),
        spaceViz: document.getElementById("space-viz"),
        vizBarUsed: document.getElementById("viz-bar-used"),
        vizBarSaved: document.getElementById("viz-bar-saved"),
        paginationControls: document.getElementById("pagination-controls"),
        pageInfoSpan: document.getElementById("page-info"),
        prevPageBtn: document.getElementById("prev-page-btn"),
        nextPageBtn: document.getElementById("next-page-btn"),
        filterInfo: document.getElementById("filter-info")
    },

    showError(message) {
        console.error("UI Error:", message);
        this.elements.errorMessageDiv.textContent = message;
        this.elements.errorMessageDiv.style.display = "block";
    },

    resetStatusUI(message = "", isError = false) {
        this.elements.statusPhase.textContent = message;
        this.elements.statusDetails.textContent = "";
        this.elements.statusCount.textContent = "";
        this.elements.statusEta.textContent = "";
        this.elements.progressBar.style.width = isError ? "100%" : "0%";
        this.elements.progressBar.style.backgroundColor = isError ? "#dc3545" : "#007bff";
        this.elements.statusMessage.style.display = message ? "flex" : "none";
    },

    updateStatusUI(phase, details, percentage, etaSeconds, processedItems, totalItems) {
        this.elements.statusPhase.textContent = phase || "Processing";
        this.elements.statusDetails.textContent = details || "...";
        const clampedPercentage = Math.max(0, Math.min(100, percentage || 0));
        this.elements.progressBar.style.width = `${clampedPercentage}%`;
        this.elements.progressBar.style.backgroundColor = "#007bff";
        this.elements.statusMessage.style.display = "flex";

        if (processedItems !== undefined && totalItems !== undefined && totalItems > 0) {
            this.elements.statusCount.textContent = `Processed: ${processedItems} / ${totalItems}`;
        } else {
            this.elements.statusCount.textContent = "";
        }

        if (etaSeconds !== undefined && etaSeconds !== null) {
            this.elements.statusEta.textContent = `ETA: ${this.formatTime(etaSeconds)}`;
        } else {
            this.elements.statusEta.textContent = "";
        }
    },

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}h ${m}m ${s}s`;
        return `${m}m ${s}s`;
    },

    formatBytes(bytes, d = 2) {
        if (bytes === undefined || bytes === null || isNaN(bytes) || bytes < 0) return '0 Bytes';
        if (bytes < 1) return '0 Bytes';
        const k = 1024;
        const dm = d < 0 ? 0 : d;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const validIndex = Math.min(i, sizes.length - 1);
        return `${parseFloat((bytes / Math.pow(k, validIndex)).toFixed(dm))} ${sizes[validIndex]}`;
    },

    updatePhaseIndicator(currentPhase) {
        const phases = document.querySelectorAll('.progress-phase');
        phases.forEach(phaseEl => {
            const phaseName = phaseEl.dataset.phase;
            const currentIndex = PHASE_ORDER.indexOf(currentPhase);
            const phaseIndex = PHASE_ORDER.indexOf(phaseName);
            phaseEl.classList.remove('active', 'completed');
            if (phaseName === currentPhase || (currentPhase === 'Complete' && phaseName === 'Complete')) {
                phaseEl.classList.add('active');
            } else if (currentIndex > phaseIndex && currentIndex >= 0) {
                phaseEl.classList.add('completed');
            }
        });
    },

    resetPhaseIndicator() {
        document.querySelectorAll('.progress-phase').forEach(p => p.classList.remove('active', 'completed'));
        if (this.elements.microProgressContainer) this.elements.microProgressContainer.style.display = 'none';
        if (this.elements.microProgressList) this.elements.microProgressList.innerHTML = '';
    },

    updateMicroProgress(tasks) {
        if (!this.elements.microProgressContainer || !this.elements.microProgressList) return;

        if (!tasks || tasks.length === 0) {
            this.elements.microProgressContainer.style.display = 'none';
            this.elements.microProgressList.innerHTML = '';
            return;
        }

        this.elements.microProgressContainer.style.display = 'block';
        // Limit to showing top 5 tasks to avoid clutter
        const tasksToShow = tasks.slice(0, 5);
        const hiddenCount = tasks.length - tasksToShow.length;

        let html = '';
        tasksToShow.forEach(task => {
            const shortPath = task.file.split('/').slice(-2).join('/'); // Show last 2 segments
            html += `<li>Hashing: .../${this.escapeHtml(shortPath)} <span style="font-weight:bold;">${task.percentage}%</span></li>`;
        });

        if (hiddenCount > 0) {
            html += `<li style="font-style:italic;">...and ${hiddenCount} more files</li>`;
        }

        this.elements.microProgressList.innerHTML = html;
    },

    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },

    renderDuplicatesPage(filteredDuplicates, currentPage, itemsPerPage, allDuplicates, selectedSetIndices) {
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, filteredDuplicates.length);
        const pageItems = filteredDuplicates.slice(startIndex, endIndex);

        let html = `<h3>Duplicate File Sets Found: (Showing ${startIndex + 1}-${endIndex} of ${filteredDuplicates.length})</h3>`;

        if (filteredDuplicates.length === 0) {
            this.elements.duplicatesDiv.innerHTML = "<p>No duplicate files found matching criteria.</p>";
            return;
        }

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
            html += `<input type="checkbox" class="set-checkbox" ${isSelected ? 'checked' : ''} onchange="window.toggleSetSelection(${displayIndex})" onclick="event.stopPropagation()">`;
            html += `<h4 onclick="window.toggleDuplicateSet(${displayIndex})"><span>Set #${displayIndex + 1} (${fileInfos.length} files)${isSetAlreadyLinked ? ' - Already Linked' : ''}</span></h4>`;
            html += `</div>`;
            if (sizeInfo) { html += `<p class="size-info">${this.escapeHtml(sizeInfo)}</p>`; }
            html += "<ul>";
            fileInfos.forEach((fileInfo, fileIndex) => {
                const isOriginal = fileIndex === 0;
                const filePath = this.escapeHtml(fileInfo.path);
                const rawPath = fileInfo.path.replace(/'/g, "\\'");
                const fullHash = fileInfo.hash || 'N/A';
                const shortHash = fullHash.length > 8 ? fullHash.substring(0, 8) + '...' : fullHash;
                const hashDisplay = this.escapeHtml(shortHash);
                const linkedTag = fileInfo.already_linked ? '<span class="already-linked-tag">[Linked]</span>' : '';
                const originalTag = isOriginal ? ' <strong style="font-size: 0.85em;">(Keep This)</strong>' : '';
                const copyBtn = `<button class="copy-path-btn" onclick="window.copyToClipboard('${rawPath}', this); event.stopPropagation();" title="Copy path">&#128203;</button>`;
                const previewBtn = `<button class="small-btn info-btn" style="padding:2px 5px; margin-left:5px; font-size:0.8em;" onclick="window.previewFile('${rawPath}')" title="Preview File">👁️</button>`;
                html += `<li ${isOriginal ? 'style="font-weight:bold;"' : ''}>${filePath}${copyBtn}${previewBtn}<span class="hash-info" title="${this.escapeHtml(fullHash)}">[Hash: ${hashDisplay}]</span>${linkedTag}${originalTag}</li>`;
            });
            html += "</ul></div>";
        });
        this.elements.duplicatesDiv.innerHTML = html;
    },

    updatePaginationControls(filteredDuplicates, currentPage, itemsPerPage) {
        if (!this.elements.paginationControls) return;

        const maxPage = Math.max(1, Math.ceil(filteredDuplicates.length / itemsPerPage));
        if (filteredDuplicates.length === 0) {
            this.elements.paginationControls.style.display = "none";
            return;
        }
        this.elements.paginationControls.style.display = "flex";
        this.elements.pageInfoSpan.textContent = `Page ${currentPage} of ${maxPage} (${filteredDuplicates.length} sets)`;
        this.elements.prevPageBtn.disabled = currentPage === 1;
        this.elements.nextPageBtn.disabled = currentPage === maxPage;
    },

    toggleDuplicateSet(index) {
        const setDiv = document.querySelector(`.duplicate-set[data-set-index="${index}"]`);
        if (setDiv) {
            setDiv.classList.toggle('collapsed');
        }
    },

    copyToClipboard(text, buttonEl) {
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
    },

    clearResultStats() {
        this.elements.resultAction.textContent = 'N/A';
        this.elements.resultBeforeSize.textContent = 'N/A';
        this.elements.resultAfterSize.textContent = 'N/A';
        this.elements.resultSavings.textContent = 'N/A';
        this.elements.resultDuration.textContent = 'N/A';
    },

    toggleDarkMode(doToggleAndSave) {
        const body = document.body;
        const darkToggle = document.getElementById('darkToggle');
        if (doToggleAndSave) { body.classList.toggle('dark-mode'); }
        const isActive = body.classList.contains('dark-mode');

        if (darkToggle) {
            if (isActive) { darkToggle.textContent = 'Light Mode'; darkToggle.classList.add('active'); }
            else { darkToggle.textContent = 'Dark Mode'; darkToggle.classList.remove('active'); }
        }

        if (doToggleAndSave) {
            if (isActive) { localStorage.setItem('darkMode', 'enabled'); }
            else { localStorage.removeItem('darkMode'); }
        }
    }
};
