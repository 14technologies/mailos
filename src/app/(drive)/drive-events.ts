export const DRIVE_UPLOAD_EVENT = "mailos:drive-upload";
export const DRIVE_NEW_FOLDER_EVENT = "mailos:drive-new-folder";
/** Detail: `DriveStorageDetail`. Sent by the page whenever a listing loads. */
export const DRIVE_STORAGE_EVENT = "mailos:drive-storage";
/** Sent after a listing loads so the sidebar can refresh its folder list. */
export const DRIVE_FOLDERS_EVENT = "mailos:drive-folders";

/** Asks the open listing to reload, e.g. after the sidebar created a folder. */
export const DRIVE_REFRESH_EVENT = "mailos:drive-refresh";

export type DriveStorageDetail = { used: number; limit: number | null };
