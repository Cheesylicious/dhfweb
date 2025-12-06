// html/js/modules/schichtplan_api.js

import { apiFetch } from '../utils/api.js';

/**
 * API-Modul für den Schichtplan.
 * Kapselt alle Backend-Kommunikationen.
 */
export const PlanApi = {

    // --- GRUNDDATEN LADEN ---

    async fetchSettings() {
        return await apiFetch('/api/settings', 'GET');
    },

    async fetchShiftTypes() {
        return await apiFetch('/api/shifttypes');
    },

    async fetchShiftData(year, month, variantId = null) {
        let url = `/api/shifts?year=${year}&month=${month}`;
        if (variantId !== null) {
            url += `&variant_id=${variantId}`;
        }
        return await apiFetch(url);
    },

    async fetchSpecialDates(year, type) {
        return await apiFetch(`/api/special_dates?type=${type}&year=${year}`);
    },

    async fetchOpenQueries(year, month) {
        return await apiFetch(`/api/queries?year=${year}&month=${month}&status=offen`);
    },

    async fetchQueryUsage(year, month) {
        return await apiFetch(`/api/queries/usage?year=${year}&month=${month}`);
    },

    // --- SCHICHTEN & STATUS ---

    async saveShift(payload) {
        return await apiFetch('/api/shifts', 'POST', payload);
    },

    async toggleShiftLock(userId, dateStr, variantId = null) {
        const body = { user_id: userId, date: dateStr };
        if (variantId !== null) body.variant_id = variantId;
        return await apiFetch('/api/shifts/toggle_lock', 'POST', body);
    },

    async clearShiftPlan(year, month, variantId = null) {
        const body = { year: year, month: month };
        if (variantId !== null) body.variant_id = variantId;
        return await apiFetch('/api/shifts/clear', 'DELETE', body);
    },

    async updatePlanStatus(year, month, status, isLocked) {
        const payload = { year: year, month: month, status: status, is_locked: isLocked };
        return await apiFetch('/api/shifts/status', 'PUT', payload);
    },

    async sendCompletionNotification(year, month) {
        return await apiFetch('/api/shifts/send_completion_notification', 'POST', { year: year, month: month });
    },

    async saveStaffingOrder(payload) {
        return await apiFetch('/api/shifttypes/staffing_order', 'PUT', payload);
    },

    // --- ANFRAGEN (QUERIES) ---

    async createQuery(payload) {
        return await apiFetch('/api/queries', 'POST', payload);
    },

    async deleteQuery(queryId) {
        return await apiFetch(`/api/queries/${queryId}`, 'DELETE');
    },

    async updateQueryStatus(queryId, status) {
        return await apiFetch(`/api/queries/${queryId}/status`, 'PUT', { status: status });
    },

    async fetchQueryReplies(queryId) {
        return await apiFetch(`/api/queries/${queryId}/replies`);
    },

    async sendQueryReply(queryId, message) {
        return await apiFetch(`/api/queries/${queryId}/replies`, 'POST', { message: message });
    },

    // --- BULK OPERATIONS ---

    async bulkApproveQueries(queryIds) {
        return await apiFetch('/api/queries/bulk_approve', 'POST', { query_ids: queryIds });
    },

    async bulkDeleteQueries(queryIds) {
        return await apiFetch('/api/queries/bulk_delete', 'POST', { query_ids: queryIds });
    },

    // --- GENERATOR ---

    async getGeneratorConfig() {
        return await apiFetch('/api/generator/config');
    },

    async saveGeneratorConfig(configPayload) {
        return await apiFetch('/api/generator/config', 'PUT', configPayload);
    },

    async startGenerator(year, month, variantId = null) {
        const payload = { year: year, month: month };
        // Wichtig: variant_id nur senden, wenn es nicht null ist
        if (variantId !== null) {
            payload.variant_id = variantId;
        }
        return await apiFetch('/api/generator/start', 'POST', payload);
    },

    async getGeneratorStatus() {
        return await apiFetch('/api/generator/status');
    }
};