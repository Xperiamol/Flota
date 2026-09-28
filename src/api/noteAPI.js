import { invoke, getNotesAPI } from './ipc';

const notesAPI = () => getNotesAPI();

export const fetchNotes = (options = {}) => invoke('note:get-all', options);
// 回收站一次取全（后端默认每页 50 条，以前超过 50 条的已删除笔记在回收站里看不到）
export const fetchDeletedNotes = () => invoke('note:get-deleted', { limit: 100000 });
export const emptyTrash = () => invoke('note:empty-trash');
export const fetchTrashPolicy = () => invoke('note:get-trash-policy');
export const setTrashRetention = (days) => invoke('note:set-trash-retention', days);
export const fetchNoteById = (id) => invoke('note:get-by-id', id);
export const fetchPinnedNotes = () => invoke('note:get-pinned');
export const fetchRecentlyModifiedNotes = (limit) => invoke('note:get-recently-modified', limit);

export const createNote = (noteData) => invoke('note:create', noteData);
export const updateNote = (id, updates) => invoke('note:update', id, updates);
export const autoSaveNote = (id, content) => invoke('note:auto-save', id, content);
export const deleteNote = (id) => invoke('note:delete', id);
export const restoreNote = (id) => invoke('note:restore', id);
export const permanentDeleteNote = (id) => invoke('note:permanent-delete', id);
export const togglePinNote = (id) => invoke('note:toggle-pin', id);

export const batchUpdateNotes = (ids, updates) => invoke('note:batch-update', ids, updates);
export const batchDeleteNotes = (ids) => invoke('note:batch-delete', ids);
export const batchRestoreNotes = (ids) => invoke('note:batch-restore', ids);
export const batchPermanentDeleteNotes = (ids) => invoke('note:batch-permanent-delete', ids);
export const batchSetNoteTags = (params) => invoke('note:batch-set-tags', params);

export const searchNotes = (query, options) => invoke('note:search', query, options);
export const fetchNoteStats = () => invoke('note:get-stats');
export const fetchActivityHeatmap = (days = 90) => invoke('note:get-activity-heatmap', days);
/** 日期范围内每天改过的笔记：{ 'YYYY-MM-DD': [sync_id, ...] } */
export const fetchNoteActivityRange = (startDay, endDay) => invoke('note:get-activity-range', startDay, endDay);
export const exportNotes = (options) => invoke('note:export', options);
export const importNotes = (data) => invoke('note:import', data);

export const onNoteCreated = (callback) => notesAPI().onNoteCreated?.(callback);
export const onNoteUpdated = (callback) => notesAPI().onNoteUpdated?.(callback);
export const onNoteDeleted = (callback) => notesAPI().onNoteDeleted?.(callback);
