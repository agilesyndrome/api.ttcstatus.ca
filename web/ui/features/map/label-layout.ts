export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectanglesOverlap(a: LabelRect, b: LabelRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Stable greedy placement: input order is the priority order. */
export function greedyLabelIndexes<T>(
  values: readonly T[],
  rectangleOf: (value: T) => LabelRect,
  occupied: LabelRect[] = [],
): number[] {
  const accepted: number[] = [];
  for (const [index, value] of values.entries()) {
    const rectangle = rectangleOf(value);
    if (occupied.some((other) => rectanglesOverlap(rectangle, other))) continue;
    occupied.push(rectangle);
    accepted.push(index);
  }
  return accepted;
}
