// js/utils/constants.js

// API und Speicher-Schlüssel
export const API_URL = 'http://46.224.63.203:5000';
export const SHORTCUT_STORAGE_KEY = 'dhf_shortcuts';
export const COLOR_STORAGE_KEY = 'dhf_color_settings';
export const DHF_HIGHLIGHT_KEY = 'dhf_highlight_goto';

// Standard-Shortcuts und Farben
export const DEFAULT_SHORTCUTS = { 'T.': 't', 'N.': 'n', '6': '6', 'FREI': 'f', 'X': 'x', 'U': 'u' };
export const DEFAULT_COLORS = {
    'weekend_bg_color': '#fff8f8',
    'weekend_text_color': '#333333',
    'holiday_bg_color': '#ffddaa',
    'training_bg_color': '#daffdb',
    'shooting_bg_color': '#ffb0b0'
};

// Layout-Konstanten für das Grid
export const COL_WIDTH_NAME = 'minmax(160px, max-content)';
export const COL_WIDTH_DETAILS = 'minmax(110px, max-content)';
export const COL_WIDTH_UEBERTRAG = 'minmax(50px, 0.5fr)';
export const COL_WIDTH_DAY = 'minmax(45px, 1fr)';
export const COL_WIDTH_TOTAL = 'minmax(60px, 0.5fr)';