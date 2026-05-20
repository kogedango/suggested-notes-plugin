export function outlinkCountPenalty(outlinkCount: number): number {
  // Divide by log(1 + outlinkCount). Floors at 1 to avoid division by zero
  // and to leave low-outlink notes untouched.
  const denom = Math.log(1 + outlinkCount);
  return denom > 1 ? denom : 1;
}
