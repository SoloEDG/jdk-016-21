import type { Document, FoldMode, Step } from "../../../shared/types";
import { clamp } from "../../../shared/document";
import {
  auditSteps,
  axisSnapshot,
  diffPose,
  driftForStep,
  lockStep,
  reanchorSteps,
  resolveStep,
  resolveSteps,
  primaryCrease,
  type OpDrift,
  type Pose,
  type PoseChange,
} from "../lib/pose";
import {
  cloneStep,
  ensureFlatStep,
  makeStepFromPose,
  recomputeAngles,
  type StepDraft,
} from "../lib/steps";

export interface StepImpact {
  id: string;
  index: number;
  title: string;
  drifts: OpDrift[];
  poseChanges: PoseChange[];
}

export interface RemovalPlan {
  targetId: string;
  targetTitle: string;
  index: number;
  /** 直接因为删除而无法按原样复现的后续步骤。 */
  affected: StepImpact[];
  /** 选择“展开引用”时会被锁定为绝对形态的步骤。 */
  expandLocks: { id: string; index: number; title: string }[];
  /** 选择“一起删除”时会一并删除的依赖步骤。 */
  cascade: { id: string; index: number; title: string }[];
  /** 删除后剩余的步骤数量（已考虑空教程自动补回起始步骤）。 */
  remainingCount: number;
  totalCount: number;
  originalPoses: Record<string, Pose>;
}

export function pause(doc: Document) {
  doc.playing = false;
}

export function stepIndex(doc: Document): number {
  const index = doc.steps.findIndex((s) => s.id === doc.current);
  return index >= 0
    ? index
    : clamp(doc.step, 0, Math.max(0, doc.steps.length - 1));
}

export function currentStep(doc: Document): Step | undefined {
  return doc.steps.find((s) => s.id === doc.current) ?? doc.steps[stepIndex(doc)];
}

/** 不修改任何步骤，只解析到某一步之前。 */
export function poseBefore(doc: Document, index: number): Pose {
  let pose: Pose = {};
  for (let i = 0; i < index; i++) {
    pose = resolveStep(doc.paper, doc.steps[i]!, pose);
  }
  return pose;
}

/**
 * 点“保存当前步骤”：按这一步原本的意图写回。
 * 相对步骤只记录与上一步的差值，绝对步骤锁死整份形态。
 */
export function captureStep(doc: Document) {
  const step = currentStep(doc);
  if (!step) {
    const flat = ensureFlatStep(doc.steps);
    doc.steps = [flat];
    focusStep(doc, flat.id);
    doc.angles = {};
    return flat;
  }
  pause(doc);
  const index = doc.steps.indexOf(step);
  if (step.mode === "absolute") {
    lockStep(doc.paper, step, { ...doc.angles });
  } else {
    const next = makeStepFromPose(
      doc.paper,
      poseBefore(doc, index),
      { ...doc.angles },
      doc.steps,
      {
        title: step.title,
        note: step.note,
        duration: step.duration,
        mode: "relative",
      },
    );
    step.ops = next.ops;
  }
  step.note = "已保存当前折叠形态，可随时还原。";
  step.revision += 1;
  recomputeAngles(doc.paper, doc.steps);
  doc.angles = { ...step.angles };
  return step;
}

/** 在当前位置之后插入一步，记录“上一步 → 当前拖出的形态”。 */
export function insertStep(doc: Document, draft: StepDraft = {}) {
  pause(doc);
  if (!doc.steps.length) doc.steps.push(ensureFlatStep(doc.steps));
  const index = stepIndex(doc);
  const previousPose = poseBefore(doc, index + 1);
  const step = makeStepFromPose(
    doc.paper,
    previousPose,
    { ...doc.angles },
    doc.steps,
    draft,
  );
  step.title = draft.title ?? `步骤 ${index + 2}`;
  if (!step.ops.length)
    step.note = "调整角度或移动折痕后，点击「保存当前步骤」记录这一折。";
  doc.steps.splice(index + 1, 0, step);
  recomputeAngles(doc.paper, doc.steps);
  focusStep(doc, step.id);
  return step;
}

/** 从当前纸面拖出的形态插入一步；标题可按折痕名生成。 */
export function insertFromCrease(doc: Document, crease: string) {
  const name = doc.paper.creases.find((c) => c.id === crease)?.name;
  return insertStep(doc, { title: name ? `${name} · 变体` : undefined });
}

/**
 * 复制一步，副本拥有全新 id 与独立的操作数组。
 * 相对操作保留“折多少度”的意图，但基准与折轴快照按新前一步重新记录；
 * 绝对操作仍是绝对值。复制之后两条步骤可以各自修改。
 */
export function duplicateStep(doc: Document, id: string) {
  pause(doc);
  const index = doc.steps.findIndex((s) => s.id === id);
  if (index < 0) return undefined;
  const source = doc.steps[index]!;
  const base = resolveSteps(doc.paper, doc.steps)[index]!;
  const copy = cloneStep(source);
  copy.id = uniqueId(doc.steps, `${source.id}-copy`);
  copy.title = `${source.title} · 副本`;
  copy.revision = 1;
  const copyPose = resolveStep(doc.paper, copy, base);
  // 相对操作保留增量，只把“基准角度”和“折轴快照”换成新前一步的解析结果，
  // 因此副本不会把原步骤的旧数字带到错误的折轴上。
  copy.ops = copy.ops.map((op) => ({
    ...op,
    base: op.mode === "relative" ? (base[op.crease] ?? 0) : op.base,
    axis: axisSnapshot(doc.paper, op.crease, copyPose),
  }));
  doc.steps.splice(index + 1, 0, copy);
  recomputeAngles(doc.paper, doc.steps);
  focusStep(doc, copy.id);
  return copy;
}

function uniqueId(steps: Step[], base: string) {
  const used = new Set(steps.map((s) => s.id));
  let id = base,
    n = 1;
  while (used.has(id)) id = `${base}-${++n}`;
  return id;
}

export function moveStep(doc: Document, id: string, delta: number) {
  const from = doc.steps.findIndex((s) => s.id === id);
  return from >= 0 && moveStepTo(doc, id, from + delta);
}

export function moveStepTo(doc: Document, id: string, to: number) {
  pause(doc);
  const from = doc.steps.findIndex((s) => s.id === id);
  if (from < 0) return false;
  const target = clamp(to, 0, doc.steps.length - 1);
  if (from === target) return false;
  const currentId = doc.current;
  const [step] = doc.steps.splice(from, 1);
  doc.steps.splice(target, 0, step!);
  recomputeAngles(doc.paper, doc.steps);
  // 播放头留在同一个步骤身份上；如果那一步本身被移动，只是索引更新。
  focusStep(doc, doc.steps.some((s) => s.id === currentId) ? currentId : id);
  return true;
}

/** 切换当前步骤的意图：相对前一步，或锁定绝对形态。 */
export function setStepMode(doc: Document, mode: FoldMode) {
  pause(doc);
  const step = currentStep(doc);
  if (!step || step.mode === mode) return;
  const index = doc.steps.indexOf(step);
  const live = { ...doc.angles };
  if (mode === "absolute") {
    lockStep(doc.paper, step, live);
  } else {
    const previous = poseBefore(doc, index);
    const pose = { ...previous, ...live };
    const draft = makeStepFromPose(doc.paper, previous, pose, doc.steps, {
      mode: "relative",
      title: step.title,
      note: step.note,
      duration: step.duration,
    });
    step.mode = "relative";
    step.ops = draft.ops;
    step.angles = { ...pose };
  }
  step.revision += 1;
  recomputeAngles(doc.paper, doc.steps);
  focusStep(doc, step.id);
}

/**
 * 只读分析删除后果。整个过程在副本上推演，取消时原顺序、
 * 原内容与原播放头都完整保留。
 */
export function analyzeRemoval(
  doc: Document,
  id: string,
): RemovalPlan | undefined {
  const index = doc.steps.findIndex((s) => s.id === id);
  if (index < 0) return undefined;
  const target = doc.steps[index]!;
  const poses = resolveSteps(doc.paper, doc.steps);
  const originalPoses: Record<string, Pose> = Object.fromEntries(
    doc.steps.map((s, i) => [s.id, { ...poses[i]! }]),
  );
  const remaining = doc.steps
    .filter((s) => s.id !== id)
    .map((step) => cloneStep(step));

  const impacted = (steps: Step[], stepPoses: Pose[]) =>
    steps
      .map((step, i) => ({
        step,
        pose: stepPoses[i] ?? {},
        drifts: driftForStep(
          doc.paper,
          step,
          i > 0 ? stepPoses[i - 1]! : {},
          stepPoses[i] ?? {},
        ),
      }))
      .filter(
        ({ step, pose, drifts }) =>
          drifts.length || diffPose(originalPoses[step.id] ?? {}, pose).length,
      )
      .map(({ step, drifts, pose }) => ({
        id: step.id,
        index: steps.indexOf(step),
        title: step.title,
        drifts,
        poseChanges: diffPose(originalPoses[step.id] ?? {}, pose),
      }));

  const affected = impacted(remaining, resolveSteps(doc.paper, remaining));

  // “展开引用”：从最早受影响的步骤开始锁定为删除前的形态，
  // 把被删掉的折叠角度写进这一步，直到后续形态完全复原。
  const expandLocks: { id: string; index: number; title: string }[] = [];
  const expanded = remaining.map(cloneStep);
  for (let guard = 0; guard <= expanded.length; guard++) {
    const expandedPoses = resolveSteps(doc.paper, expanded);
    const hit = impacted(expanded, expandedPoses)[0];
    if (!hit) break;
    const step = expanded.find((s) => s.id === hit.id)!;
    lockStep(doc.paper, step, originalPoses[step.id] ?? {});
    expandLocks.push({ id: step.id, index: expanded.indexOf(step), title: step.title });
  }

  // “一起删除”：继续删除仍然受影响的步骤，直到剩余教程自洽。
  const cascade: { id: string; index: number; title: string }[] = [];
  let alive = remaining.map(cloneStep);
  for (let guard = 0; guard <= doc.steps.length; guard++) {
    const hit = impacted(alive, resolveSteps(doc.paper, alive))[0];
    if (!hit) break;
    const step = alive.find((s) => s.id === hit.id)!;
    cascade.push({ id: step.id, index: alive.indexOf(step), title: step.title });
    alive = alive.filter((s) => s.id !== hit.id);
  }

  return {
    targetId: target.id,
    targetTitle: target.title,
    index,
    affected,
    expandLocks,
    cascade,
    remainingCount: Math.max(1, remaining.length - cascade.length),
    totalCount: doc.steps.length,
    originalPoses,
  };
}

export type RemovalStrategy = "expand" | "cascade";

export function commitRemoval(
  doc: Document,
  plan: RemovalPlan,
  strategy: RemovalStrategy,
) {
  pause(doc);
  const currentId = doc.current;
  const currentIndex = doc.steps.findIndex((s) => s.id === currentId);
  const removeIds = new Set<string>([plan.targetId]);
  if (strategy === "cascade") plan.cascade.forEach((s) => removeIds.add(s.id));

  if (strategy === "expand") {
    for (const lock of plan.expandLocks) {
      const step = doc.steps.find((s) => s.id === lock.id);
      if (step && !removeIds.has(step.id)) {
        lockStep(doc.paper, step, plan.originalPoses[step.id] ?? {});
        step.revision += 1;
      }
    }
  }

  doc.steps = doc.steps.filter((s) => !removeIds.has(s.id));
  if (!doc.steps.length) doc.steps.push(ensureFlatStep(doc.steps));
  recomputeAngles(doc.paper, doc.steps);

  const kept = doc.steps.find((s) => s.id === currentId);
  if (kept) focusStep(doc, kept.id);
  else {
    const fallback = doc.steps[
      clamp(currentIndex > 0 ? currentIndex - 1 : 0, 0, doc.steps.length - 1)
    ]!;
    focusStep(doc, fallback.id);
  }
  return { removed: removeIds.size };
}

/** 把某一处依赖警告锁定为当前解析出的绝对形态。 */
export function lockAffectedStep(doc: Document, id: string) {
  pause(doc);
  const index = doc.steps.findIndex((s) => s.id === id);
  if (index < 0) return;
  const step = doc.steps[index]!;
  const pose = resolveSteps(doc.paper, doc.steps)[index]!;
  lockStep(doc.paper, step, pose);
  step.revision += 1;
  recomputeAngles(doc.paper, doc.steps);
  focusStep(doc, id);
}

/**
 * 保留步骤意图：把警告步骤的基准角度与折轴快照更新到新的前一步，
 * 形态随新的父纸面自然变化。
 */
export function reanchorAffected(doc: Document) {
  pause(doc);
  let changed = false;
  for (let guard = 0; guard <= doc.steps.length; guard++) {
    const ids = new Set(
      auditSteps(doc.paper, doc.steps)
        .filter((a) => a.drifts.length)
        .map((a) => a.id),
    );
    if (!ids.size) break;
    doc.steps.forEach((step) => {
      if (ids.has(step.id)) step.revision += 1;
    });
    reanchorSteps(doc.paper, doc.steps, ids);
    recomputeAngles(doc.paper, doc.steps);
    changed = true;
  }
  if (changed) focusStep(doc, doc.current);
  return changed;
}

export function focusStep(doc: Document, id: string) {
  const index = doc.steps.findIndex((s) => s.id === id);
  if (index < 0) return;
  const pose = resolveSteps(doc.paper, doc.steps)[index]!;
  doc.current = id;
  doc.step = index;
  doc.angles = { ...pose };
  const crease = primaryCrease(doc.steps[index]!);
  if (crease && doc.paper.creases.some((c) => c.id === crease))
    doc.selected = crease;
}

/** 保证教程至少有一个可继续编辑的步骤，并修复失效的播放头身份。 */
export function ensureValidDocument(doc: Document) {
  if (!doc.steps.length) doc.steps.push(ensureFlatStep(doc.steps));
  let repaired = false;
  doc.steps.forEach((step) => {
    if (!step.revision) {
      step.revision = 1;
      repaired = true;
    }
  });
  if (repaired) recomputeAngles(doc.paper, doc.steps);
  if (!doc.steps.some((s) => s.id === doc.current)) {
    doc.current = doc.steps[clamp(doc.step, 0, doc.steps.length - 1)]!.id;
  }
  focusStep(doc, doc.current);
}

/** 换纸或重置时整体采用一套新步骤。 */
export function adoptSteps(doc: Document, steps: Step[], index = 1) {
  doc.steps = steps;
  doc.current = steps[clamp(index, 0, steps.length - 1)]?.id ?? "";
  doc.step = clamp(index, 0, Math.max(0, steps.length - 1));
  ensureValidDocument(doc);
}
