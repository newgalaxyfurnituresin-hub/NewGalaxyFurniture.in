/** Image-only saves may advance an editor's version only when they started from that version. */
export interface ProductRevision {
  previousUpdatedAt: string;
  updatedAt: string;
}
export function productRevisionHeaders(
  previousUpdatedAt: string,
  updatedAt: string,
): Record<string, string> {
  return { 'x-ngf-previous-updated-at': previousUpdatedAt, 'x-ngf-updated-at': updatedAt };
}
export function advanceProductRevision(current: string, revision?: ProductRevision): string {
  return revision?.previousUpdatedAt === current ? revision.updatedAt : current;
}
