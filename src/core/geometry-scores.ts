/** Floating-point intersections may exceed an area by a few ulps. Preserve the
 * observed coordinates and normalize only the dimensionless geometric score. */
export function unitRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}
