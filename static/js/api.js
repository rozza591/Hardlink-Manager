export async function handleFetchResponse(response) {
    if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
            const errorData = await response.json();
            errorDetail = errorData.error || JSON.stringify(errorData);
        } catch (e) { }
        throw new Error(errorDetail);
    }
    return response.json();
}

export const api = {
    runScan: (formData) => fetch("/run_scan", { method: "POST", body: formData }).then(handleFetchResponse),
    cancelScan: (scanId) => fetch(`/cancel_scan/${scanId}`, { method: "POST" }).then(handleFetchResponse),
    pauseScan: (scanId) => fetch(`/pause_scan/${scanId}`, { method: "POST" }).then(handleFetchResponse),
    resumeScan: (scanId) => fetch(`/resume_scan/${scanId}`, { method: "POST" }).then(handleFetchResponse),
    performLink: (scanId, formData) => fetch(`/perform_link/${scanId}`, { method: "POST", body: formData }).then(handleFetchResponse),
    getProgress: (scanId) => fetch(`/get_progress/${scanId}`).then(handleFetchResponse),
    getLinkProgress: (linkOpId) => fetch(`/get_link_progress/${linkOpId}`).then(handleFetchResponse),
    getResults: (scanId) => fetch(`/get_results/${scanId}`).then(handleFetchResponse),
    getLinkResult: (linkOpId) => fetch(`/get_link_result/${linkOpId}`).then(handleFetchResponse),
    clearCache: () => fetch("/clear_cache", { method: "POST" }).then(handleFetchResponse),
    getSchedules: () => fetch("/get_schedules").then(handleFetchResponse),
    getActiveTask: () => fetch("/get_active_task").then(handleFetchResponse)
};
