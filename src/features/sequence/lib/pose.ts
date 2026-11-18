import type { FoldOp, Paper, Step } from "../../../shared/types";
import { normalizeAngle } from "../../fold/lib/angle";

export type Pose = Record<string, number>;
export const EPS = 1e-6;

export interface PoseChange {
  crease: string;
  before: number;
  after: number;
}

export interface OpDrift {
  opIndex: number;
  crease: string;
  kind: "base" | "axis";
  /** 相对模式引用自己的前一步角度；折轴引用某根父纸面折痕。 */
  axisCrease: string;
  expected: number;
  actual: number;
}

export interface StepAudit {
  id: string;
  drifts: OpDrift[];
}

/**
 * 折轴由父纸面链上的折痕决定：face 的 hinge 先经过所有祖先纸面的变换。
 * 这里按“离自己最近的父折痕”到根的顺序返回。
 */
export function axisCreases(paper: Paper, creaseId: string): string[] {
  const crease = paper.creases.find((c) => c.id === creaseId);
  const face = paper.faces.find((f) => f.id === crease?.face);
  const result: string[] = [];
  const seen = new Set<string>();
  let parent = face?.parent;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const node = paper.faces.find((f) => f.id === parent);
    if (!node) break;
    if (node.crease) result.push(node.crease);
    parent = node.parent;
  }
  return result;
}

/** 记录落笔时影响这根折轴的父纸面角度。 */
export function axisSnapshot(
  paper: Paper,
  creaseId: string,
  pose: Pose,
): Pose {
  return Object.fromEntries(
    axisCreases(paper, creaseId).map((id) => [id, pose[id] ?? 0]),
  );
}

/**
 * 相对操作的数值只累加到同一 crease id 上，绝不按下标迁移；
 * 绝对操作直接锁定该折痕的角度。
 */
export function resolveStep(paper: Paper, step: Step, previous: Pose): Pose {
  const next = { ...previous };
  for (const op of step.ops) {
    if (!paper.creases.some((c) => c.id === op.crease)) continue;
    const before = previous[op.crease] ?? 0;
    next[op.crease] = normalizeAngle(
      op.mode === "relative" ? before + op.value : op.value,
    );
  }
  return next;
}

export function resolveSteps(paper: Paper, steps: Step[]): Pose[] {
  const poses: Pose[] = [];
  let previous: Pose = {};
  for (const step of steps) {
    previous = resolveStep(paper, step, previous);
    poses.push(previous);
  }
  return poses;
}

/**
 * 用上一步的角度检查每个操作。相对值的基础角度变了、或父纸面折痕
 * 的角度变了，都说明这一步的“落笔上下文”已经不再成立。
 */
export function driftForStep(
  paper: Paper,
  step: Step,
  previous: Pose,
  pose: Pose,
): OpDrift[] {
  const drifts: OpDrift[] = [];
  step.ops.forEach((op, opIndex) => {
    if (!paper.creases.some((c) => c.id === op.crease)) return;
    if (op.mode === "relative" && op.base !== undefined) {
      const actual = previous[op.crease] ?? 0;
      if (Math.abs(actual - op.base) > EPS) {
        drifts.push({
          opIndex,
          crease: op.crease,
          kind: "base",
          axisCrease: op.crease,
          expected: op.base,
          actual,
        });
      }
    }
    for (const axis of axisCreases(paper, op.crease)) {
      const actual = pose[axis] ?? 0;
      const expected = op.axis?.[axis] ?? 0;
      if (Math.abs(actual - expected) > EPS) {
        drifts.push({
          opIndex,
          crease: op.crease,
          kind: "axis",
          axisCrease: axis,
          expected,
          actual,
        });
      }
    }
  });
  return drifts;
}

export function auditSteps(paper: Paper, steps: Step[]): StepAudit[] {
  const audits: StepAudit[] = [];
  let previous: Pose = {};
  for (const step of steps) {
    const pose = resolveStep(paper, step, previous);
    audits.push({ id: step.id, drifts: driftForStep(paper, step, previous, pose) });
    previous = pose;
  }
  return audits;
}

export function driftKey(drift: OpDrift) {
  return `${drift.kind}:${drift.crease}:${drift.axisCrease}`;
}

/**
 * 一步的主折痕：按折痕顺序最后出现的操作，通常是这一步新引入的折法。
 * 选中步骤时用它来高亮折痕，而不是用数组下标猜折痕。
 */
export function primaryCrease(step: Step): string | undefined {
  return step.ops[step.ops.length - 1]?.crease;
}

export function diffPose(before: Pose, after: Pose): PoseChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => Math.abs((before[key] ?? 0) - (after[key] ?? 0)) > EPS)
    .map((crease) => ({
      crease,
      before: before[crease] ?? 0,
      after: after[crease] ?? 0,
    }));
}

/**
 * 把这一步改写成绝对形态。目标姿势里的每一根折痕都会被写入，
 * 因而也把上游被删掉/挪走的折法“展开”进这一步。
 */
export function lockStep(paper: Paper, step: Step, target: Pose) {
  const creases = new Set([
    ...Object.keys(target),
    ...step.ops.map((op) => op.crease),
  ]);
  const ordered = [
    ...paper.creases.map((c) => c.id).filter((id) => creases.has(id)),
    ...[...creases]
      .filter((id) => !paper.creases.some((c) => c.id === id))
      .sort(),
  ];
  step.mode = "absolute";
  step.ops = ordered
    .filter((crease) => crease in target)
    .map(
      (crease): FoldOp => ({
        crease,
        mode: "absolute",
        value: normalizeAngle(target[crease] ?? 0),
        axis: axisSnapshot(paper, crease, target),
      }),
    );
  // 绝对步骤只写目标中实际存在的折痕，其余折痕沿用上一步。
  step.angles = { ...target };
}

/**
 * 保持相对意图，只把基础角度与折轴快照更新到新位置的前一步，
 * 清掉警告但允许形态随新的父纸面自然变化。
 */
export function reanchorStep(
  paper: Paper,
  step: Step,
  previous: Pose,
  pose: Pose,
) {
  for (const op of step.ops) {
    if (!paper.creases.some((c) => c.id === op.crease)) continue;
    if (op.mode === "relative") op.base = previous[op.crease] ?? 0;
    op.axis = axisSnapshot(paper, op.crease, pose);
  }
}

export function reanchorSteps(
  paper: Paper,
  steps: Step[],
  ids: Set<string>,
): Pose[] {
  const poses: Pose[] = [];
  let previous: Pose = {};
  for (const step of steps) {
    const pose = resolveStep(paper, step, previous);
    if (ids.has(step.id)) reanchorStep(paper, step, previous, pose);
    poses.push(pose);
    previous = pose;
  }
  return poses;
}
