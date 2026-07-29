export function inverseDocumentFrequency(
  totalDocuments: number,
  documentFrequency: number,
): number {
  return totalDocuments > 0 && documentFrequency > 0
    ? Math.log(totalDocuments / documentFrequency)
    : 0;
}
