import type { Document, Paper, Step } from "./types";
export function createDocument(paper: Paper, steps: Step[]): Document {
  const start = Math.min(1, Math.max(0, steps.length - 1));
  return {
    paper,
    front: "#e88459",
    back: "#f8dec2",
    texture: "fiber",
    selected: paper.creases[0]?.id ?? "",
    angles: { ...steps[start]?.angles },
    directions: Object.fromEntries(paper.creases.map((c) => [c.id, 1])),
    steps,
    step: start,
    current: steps[start]?.id ?? "",
    playing: false,
    speed: 1,
    view: { yaw: -35, pitch: 50, zoom: 1, grid: true, wire: true },
  };
}
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
