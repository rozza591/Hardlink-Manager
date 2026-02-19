/**
 * Schedules Module for Hardlink Manager
 * Manages automated scan jobs.
 */

import State from './state.js';
import UI from './ui.js';
import API from './api.js';

const Schedules = {
    init() {
        console.log('Schedules Module Initializing...');
        this.bindEvents();
    },

    bindEvents() {
        const addBtn = document.getElementById('add-schedule-btn');
        if (addBtn) addBtn.onclick = () => this.addSchedule();
    },

    async render() {
        const container = document.getElementById('schedules-view');
        if (!container) return;

        container.innerHTML = `
            <header class="view-header">
                <h1>Automated Schedules</h1>
                <p>Manage recurring optimization tasks.</p>
            </header>

            <div class="card">
                <div class="card-title">Active Schedules</div>
                <div id="schedule-list" style="margin-top:20px;">
                    <p>Loading schedules...</p>
                </div>
            </div>

            <div class="card">
                <div class="card-title">Add New Schedule</div>
                <div class="form-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                    <div class="form-group">
                        <label>Task Name</label>
                        <input type="text" id="sched-name" placeholder="Weekly Cleanup">
                    </div>
                    <div class="form-group">
                        <label>Path</label>
                        <input type="text" id="sched-path" placeholder="/data">
                    </div>
                    <div class="form-group">
                        <label>Frequency (Cron)</label>
                        <select id="sched-cron">
                            <option value="0 0 * * *">Daily (Midnight)</option>
                            <option value="0 0 * * 0">Weekly (Sunday)</option>
                            <option value="0 3 * * 1">Monday 3AM</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Strategy</label>
                        <select id="sched-strategy">
                            <option value="report">Report Only</option>
                            <option value="hard">Hardlink</option>
                        </select>
                    </div>
                </div>
                <button class="btn btn-primary" id="add-schedule-btn" style="margin-top:20px;">
                    <i class="fas fa-save"></i> Save Schedule
                </button>
            </div>
        `;

        this.loadSchedules();
        this.bindEvents();
    },

    async loadSchedules() {
        try {
            const schedules = await API.getSchedules();
            this.renderScheduleList(schedules);
        } catch (e) {
            UI.showNotification('Failed to load schedules', 'danger');
        }
    },

    renderScheduleList(schedules) {
        const list = document.getElementById('schedule-list');
        if (!list) return;

        if (schedules.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);">No schedules configured.</p>';
            return;
        }

        let html = '<table style="width:100%; border-collapse: collapse;">';
        schedules.forEach(s => {
            html += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding:12px;"><strong>${s.name}</strong><br><small>${s.path}</small></td>
                    <td style="padding:12px;">${s.cron}</td>
                    <td style="padding:12px; text-align:right;">
                        <button class="btn btn-danger btn-small delete-sched-btn" data-id="${s.id}">Delete</button>
                    </td>
                </tr>
            `;
        });
        html += '</table>';
        list.innerHTML = html;

        list.querySelectorAll('.delete-sched-btn').forEach(btn => {
            btn.onclick = () => this.deleteSchedule(btn.dataset.id);
        });
    },

    async addSchedule() {
        const data = {
            name: document.getElementById('sched-name').value,
            path: document.getElementById('sched-path').value,
            cron: document.getElementById('sched-cron').value,
            options: {
                link_type: document.getElementById('sched-strategy').value === 'hard' ? 'hard' : null,
                dry_run: document.getElementById('sched-strategy').value === 'report'
            }
        };

        if (!data.name || !data.path) {
            UI.showNotification('Please fill in all fields', 'warning');
            return;
        }

        try {
            await API.addSchedule(data);
            UI.showNotification('Schedule added', 'success');
            this.loadSchedules();
        } catch (e) {
            UI.showNotification('Failed to add schedule', 'danger');
        }
    },

    async deleteSchedule(id) {
        if (!confirm('Delete this schedule?')) return;
        try {
            await API.deleteSchedule(id);
            UI.showNotification('Schedule deleted', 'info');
            this.loadSchedules();
        } catch (e) {
            UI.showNotification('Failed to delete schedule', 'danger');
        }
    }
};

export default Schedules;
