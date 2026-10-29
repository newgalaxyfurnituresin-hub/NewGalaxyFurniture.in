/** Shared limits for private product-photo selections. Files travel one at a time. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_PHOTOS_PER_BATCH = 15;
export const MAX_PHOTO_BATCH_BYTES = MAX_PHOTO_BYTES * MAX_PHOTOS_PER_BATCH;
