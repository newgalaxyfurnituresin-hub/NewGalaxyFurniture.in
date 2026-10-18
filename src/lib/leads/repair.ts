/** Fits the existing bounded requirement column; no new database fields or lead types. */
export function repairRequirement(service: string, seating: string, contact: string): string {
  return [
    'Sofa repair enquiry',
    `Topic: ${service || 'Please advise'}`,
    `Sofa: ${seating || 'Not specified'}`,
    `Preferred contact: ${contact}`,
  ].join('\n');
}
