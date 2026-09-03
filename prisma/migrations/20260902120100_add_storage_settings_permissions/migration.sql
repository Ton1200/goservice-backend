-- GOS-70 — dedicated admin permissions gating the storage/image-processing
-- settings surface (`storageSettings` / `updateStorageSettings`). One
-- statement per value, same pattern as 20260819182106_add_quotes_read_permission.

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'STORAGE_SETTINGS_READ';

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'STORAGE_SETTINGS_WRITE';
