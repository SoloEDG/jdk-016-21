import type { Paper, Step } from "../../../shared/types";
import { axisSnapshot, EPS, resolveSteps, type Pose } from "./pose";

let counter = 0;
export function nextStepId(existing: Step[]): string {
  const used = new Set(existing.map((s) => s.id));
  let id = "";
  do id = `step-${++counter}`;
  while (used.has(id));
  return id;
}

export function makeFlatStep(): Step {
  return {
    id: "flat",
    title: "准备纸张",
    note: "将纸张正面朝上，观察预设折痕。",
    mode: "relative",
    ops: [],
    angles: {},
    duration: 1000,
    revision: 1,
  };
}

/** 纸张内唯一的起始步骤；删除后自动补回时避免与残留 id 冲突。 */
export function ensureFlatStep(steps: Step[]): Step {
  const flat = makeFlatStep();
  if (steps.some((s) => s.id === "flat")) flat.id = nextStepId(steps);
  return flat;
}

/** 默认教程：每一步锁定完整形态，与旧版的快照语义一致。 */
export function makeSteps(paper: Paper): Step[] {
  const angles: Record<string, number> = {};
  const prefix = `step-${Date.now().toString(36)}-`;
  counter = 0;
  return [
    makeFlatStep(),
    ...paper.creases.map((c, i) => {
      angles[c.id] = c.target;
      return {
        id: prefix + i,
        title: c.name,
        note: c.description,
        mode: "absolute" as const,
        ops: paper.creases
          .filter((crease) => crease.id in angles)
          .map((crease) => ({
            crease: crease.id,
            mode: "absolute" as const,
            value: angles[crease.id]!,
            axis: axisSnapshot(paper, crease.id, angles),
          })),
        angles: { ...angles },
        duration: 1600,
        revision: 1,
      };
    }),
  ];
}

export interface StepDraft {
  title?: string;
  note?: string;
  duration?: number;
  mode?: Step["mode"];
}

/**
 * 从“上一步形态 → 当前形态”生成新步骤。
 * 默认用相对操作记录差值，这样插入后重排，折法仍然跟着前一步走；
 * 需要锁死形态时由调用方传入 absolute。
 */
export function makeStepFromPose(
  paper: Paper,
  previous: Pose,
  pose: Pose,
  existing: Step[],
  draft: StepDraft = {},
): Step {
  const mode = draft.mode ?? "relative";
  const creases = paper.creases
    .map((c) => c.id)
    .filter((id) => Math.abs((pose[id] ?? 0) - (previous[id] ?? 0)) > EPS);
  const ops = creases.map((id) => {
    const before = previous[id] ?? 0;
    return {
      crease: id,
      mode,
      value: mode === "relative" ? (pose[id] ?? 0) - before : (pose[id] ?? 0),
      base: before,
      axis: axisSnapshot(paper, id, pose),
    };
  });
  return {
    id: nextStepId(existing),
    title: draft.title ?? "新的折叠",
    note: draft.note ?? "从当前形态继续折。",
    mode,
    ops,
    angles: { ...pose },
    duration: draft.duration ?? 1400,
    revision: 1,
  };
}

/**
 * 用新的解析结果刷新所有步骤的缓存角度。形态真的变了就递增 revision，
 * 让正在播放的动画立即停下，而不是悄悄追到一个内容已经不同的目标。
 */
export function recomputeAngles(paper: Paper, steps: Step[]): Pose[] {
  const poses = resolveSteps(paper, steps);
  steps.forEach((step, i) => {
    const next = poses[i]!;
    const changed = [...new Set([...Object.keys(step.angles), ...Object.keys(next)])].some(
      (key) => Math.abs((step.angles[key] ?? 0) - (next[key] ?? 0)) > EPS,
    );
    step.angles = { ...next };
    if (changed) step.revision += 1;
  });
  return poses;
}

export function cloneStep(step: Step): Step {
  return {
    ...step,
    ops: step.ops.map((op) => ({ ...op, axis: { ...op.axis } })),
    angles: { ...step.angles },
  };
}

export function interpolate(
  a: Record<string, number>,
  b: Record<string, number>,
  t: number,
) {
  const ease = t * t * (3 - 2 * t);
  return Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [
      k,
      (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * ease,
    ]),
  );
}
