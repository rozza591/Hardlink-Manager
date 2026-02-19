/**
 * State Module for Hardlink Manager
 * Manages reactive UI state and session data.
 */

const State = {
    currentView: 'dashboard', // dashboard, wizard, results, schedules

    // Wizard State
    wizard: {
        currentStep: 1,
        paths: [''],
        strategy: 'hard', // report, hard, soft, delete
        isDryRun: true,
        filters: {
            minSize: 0,
            unit: 'MB',
            ignoreDirs: '',
            ignoreExts: ''
        }
    },

    // Active Task State
    activeTask: {
        id: null,
        type: null, // scan or link
        status: null,
        progress: 0,
        phase: null,
        history: [] // For charts
    },

    // Results Cache
    lastResults: null,

    // UI Callbacks
    listeners: [],

    subscribe(callback) {
        this.listeners.push(callback);
    },

    notify() {
        this.listeners.forEach(cb => cb(this));
    },

    setView(view) {
        this.currentView = view;
        this.notify();
    },

    setWizardStep(step) {
        this.wizard.currentStep = step;
        this.notify();
    },

    updateWizard(data) {
        this.wizard = { ...this.wizard, ...data };
        this.notify();
    },

    setActiveTask(id, type) {
        this.activeTask.id = id;
        this.activeTask.type = type;
        this.notify();
    },

    updateTaskProgress(data) {
        this.activeTask = { ...this.activeTask, ...data };
        this.notify();
    }
};

export default State;
