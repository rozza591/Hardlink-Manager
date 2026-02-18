export const PHASE_ORDER = ['Finding Files', 'Pre-Hashing', 'Full Hashing', 'Analyzing Hashes', 'Linking Files', 'Complete'];

export const state = {
    currentScanId: null,
    currentLinkOpId: null,
    scanPollInterval: null,
    linkPollInterval: null,
    lastCompletedScanId: null,
    lastPhase: null,
    currentPage: 1,
    itemsPerPage: 25,
    allDuplicates: [],
    filteredDuplicates: [],
    selectedSetIndices: new Set()
};
