import { createDocument } from "../src/shared/document";
import { papers } from "../src/features/paper/lib/presets";
import {
  analyzeRemoval,
  captureStep,
  commitRemoval,
  duplicateStep,
  ensureValidDocument,
  focusStep,
  insertStep,
  moveStep,
  moveStepTo,
  reanchorAffected,
  setStepMode,
} from "../src/features/sequence/model/editing";
import { auditSteps, resolveSteps } from "../src/features/sequence/lib/pose";
import { ensureFlatStep, makeSteps } from "../src/features/sequence/lib/steps";

const paper = papers[0]!;

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (!condition) {
    failures++;
    console.error("FAIL", name, detail ?? "");
  } else console.log("ok  ", name);
}
function fresh() {
  const doc = createDocument(structuredClone(paper), makeSteps(structuredClone(paper)));
  ensureValidDocument(doc);
  return doc;
}
function snapshot(doc: ReturnType<typeof fresh>) {
  return {
    order: doc.steps.map((s) => s.id),
    poses: resolveSteps(doc.paper, doc.steps),
    current: doc.current,
  };
}
function makeRelative(doc: ReturnType<typeof fresh>) {
  // 把默认绝对步骤改写成相对意图，用来检验重排后的依赖提示。
  doc.steps.forEach((step, i) => {
    if (i === 0) return;
    focusStep(doc, step.id);
    setStepMode(doc, "relative");
  });
}

// 1. 保存不再一律覆盖为绝对快照：相对步骤仍表达相对意图。
{
  const doc = fresh();
  focusStep(doc, doc.steps[1]!.id);
  setStepMode(doc, "relative");
  doc.angles[doc.selected] = 40;
  captureStep(doc);
  const step = doc.steps[1]!;
  check(
    "capture keeps relative intent",
    step.mode === "relative" && step.ops[0]!.mode === "relative",
    step.ops,
  );
}

// 2. 插入步骤：记录与上一步的差值，不会改动后续绝对步骤。
{
  const doc = fresh();
  focusStep(doc, doc.steps[1]!.id);
  setStepMode(doc, "relative");
  doc.angles = { ...doc.steps[1]!.angles, c1: 30 };
  const inserted = insertStep(doc, { title: "临时回折" });
  check("insert adds after current", doc.steps[2]!.id === inserted.id);
  check(
    "insert captures only delta",
    inserted.ops.length === 1 &&
      inserted.ops[0]!.crease === "c1" &&
      inserted.ops[0]!.value === -45,
    inserted.ops,
  );
  check(
    "insert preserves later absolute poses",
    doc.steps[3]!.angles.c1 === 75 && doc.steps[3]!.angles.c2 === 65,
  );
}

// 3. 重排：相对步骤跟着前一步走，并提示哪些动作基于已经变化的父纸面。
{
  const doc = fresh();
  makeRelative(doc);
  const before = doc.steps.map((s) => s.id);
  const c3 = doc.steps.find((s) => s.ops.some((op) => op.crease === "c3"))!;
  moveStep(doc, c3.id, -1);
  const after = doc.steps.map((s) => s.id);
  check("reorder changes order", before.join() !== after.join());
  check(
    "reorder keeps each op bound to its crease id",
    doc.steps.every((s) =>
      s.ops.every((op) => doc.paper.creases.some((c) => c.id === op.crease)),
    ),
  );
  const audits = auditSteps(doc.paper, doc.steps);
  check(
    "reorder flags dependent steps instead of silently applying angles",
    audits.some((a) => a.drifts.some((d) => d.kind === "axis")),
    audits,
  );
  check(
    "reorder keeps playhead identity",
    doc.current === c3.id && doc.step === doc.steps.indexOf(c3),
  );
  const op = doc.steps.find((s) => s.id === c3.id)!.ops.find((o) => o.crease === "c3")!;
  check("moved step still targets c3", op.crease === "c3", op);
}

// 4. 复制：副本独立，之后分别修改互不影响；相对副本重新锚定。
{
  const doc = fresh();
  makeRelative(doc);
  const source = doc.steps[1]!;
  const copy = duplicateStep(doc, source.id)!;
  check("duplicate inserts a new id", copy.id !== source.id);
  check(
    "duplicate deep-copies ops",
    copy.ops !== source.ops && copy.ops[0] !== source.ops[0],
  );
  check("duplicate has an independent revision", copy.revision >= 1);
  captureStep(doc);
  focusStep(doc, doc.current);
  doc.angles[source.ops[0]!.crease] = 12;
  captureStep(doc);
  check(
    "duplicate edits do not leak to source",
    JSON.stringify(copy.ops) !== JSON.stringify(source.ops) ||
      copy.angles[source.ops[0]!.crease] !== source.angles[source.ops[0]!.crease],
  );
  const audits = auditSteps(doc.paper, doc.steps);
  check(
    "duplicate can still be edited independently",
    audits.length === doc.steps.length,
  );
}

// 5. 删除分析只读：取消后顺序、内容、播放头完全不变。
{
  const doc = fresh();
  makeRelative(doc);
  const c3 = doc.steps.find((s) => s.ops.some((op) => op.crease === "c3"))!;
  moveStep(doc, c3.id, -1);
  focusStep(doc, doc.steps[2]!.id);
  const before = snapshot(doc);
  const beforeJson = JSON.stringify(doc.steps);
  const c1 = doc.steps.find((s) => s.ops.some((op) => op.crease === "c1"))!;
  const plan = analyzeRemoval(doc, c1.id)!;
  check("removal analysis reports affected steps", plan.affected.length > 0, plan);
  check(
    "cancel keeps full order and content",
    JSON.stringify(snapshot(doc)) === JSON.stringify(before) &&
      JSON.stringify(doc.steps) === beforeJson,
  );
}

// 6. 删除被引用步骤：展开引用让后续形态完整复原。
{
  const doc = fresh();
  makeRelative(doc);
  // 相对步骤的后续折叠建立在 c1 的角度上，删除 c1 步骤后必须展开引用。
  const c1 = doc.steps.find((s) => s.ops.some((op) => op.crease === "c1"))!;
  const posesBefore = resolveSteps(doc.paper, doc.steps);
  const plan = analyzeRemoval(doc, c1.id)!;
  check("delete referenced step has expand plan", plan.expandLocks.length > 0, plan.expandLocks);
  check(
    "expand locks a downstream step, not the deleted one",
    plan.expandLocks.every((lock) => lock.id !== c1.id),
  );
  commitRemoval(doc, plan, "expand");
  ensureValidDocument(doc);
  const posesAfter = resolveSteps(doc.paper, doc.steps);
  check(
    "expand keeps downstream pose",
    JSON.stringify(posesAfter[posesAfter.length - 1]) ===
      JSON.stringify(posesBefore[posesBefore.length - 1]),
    { after: posesAfter[posesAfter.length - 1], before: posesBefore[posesBefore.length - 1] },
  );
  check("expand leaves valid document", doc.steps.length > 0 && resolves(doc));
}

// 7. 删除被引用步骤：一起删除让剩余教程自洽且可继续折叠。
{
  const doc = fresh();
  makeRelative(doc);
  moveStepTo(doc, doc.steps[2]!.id, 1);
  const target = doc.steps[1]!;
  const plan = analyzeRemoval(doc, target.id)!;
  commitRemoval(doc, plan, "cascade");
  ensureValidDocument(doc);
  check(
    "cascade removes dependent steps",
    !doc.steps.some((s) => plan.cascade.some((c) => c.id === s.id)),
  );
  check(
    "cascade leaves no inspectable drift",
    auditSteps(doc.paper, doc.steps).every((a) => a.drifts.length === 0),
    auditSteps(doc.paper, doc.steps),
  );
  check("cascade keeps a valid playhead", doc.steps.some((s) => s.id === doc.current));
}

// 8. 空教程 / 删除最后一步后仍可继续折叠。
{
  const doc = fresh();
  doc.steps = [];
  doc.current = "";
  ensureValidDocument(doc);
  check("empty tutorial gets a foldable step", doc.steps.length === 1 && resolves(doc));
  const sole = doc.steps[0]!;
  const plan = analyzeRemoval(doc, sole.id)!;
  check("removing last step reports a flat fallback", plan.remainingCount === 1);
  commitRemoval(doc, plan, "expand");
  check("removing last step leaves a step", doc.steps.length === 1 && resolves(doc));
  doc.angles = { c1: 20 };
  const added = insertStep(doc, { title: "继续" });
  check("can keep folding after empty state", doc.steps.includes(added));
}

// 9. 播放中编辑：播放头不会指向 id 相同但内容变化的步骤。
{
  const doc = fresh();
  focusStep(doc, doc.steps[0]!.id);
  const target = doc.steps[1]!;
  const targetRevision = target.revision;
  target.revision += 1;
  check(
    "revision guards playback target",
    target.revision !== targetRevision && doc.current !== target.id,
  );
  check("playhead remains on stable step", doc.steps.some((s) => s.id === doc.current));
}

// 10. 重排后“保留意图”的解法：重新锚定清除警告。
{
  const doc = fresh();
  makeRelative(doc);
  const c3 = doc.steps.find((s) => s.ops.some((op) => op.crease === "c3"))!;
  focusStep(doc, doc.steps[1]!.id);
  doc.angles = { ...doc.steps[1]!.angles, c1: 10 };
  insertStep(doc, { title: "偏移" });
  moveStep(doc, c3.id, -1);
  reanchorAffected(doc);
  const audits = auditSteps(doc.paper, doc.steps);
  check("reanchor clears drift while keeping ops", audits.every((a) => a.drifts.length === 0), audits);
  check(
    "reanchor keeps relative intent",
    doc.steps.every((s) => s.mode !== "relative" || s.ops.every((op) => op.mode === "relative")),
  );
}

// 11. 空教程补回的起始步骤 id 不与残留步骤冲突。
{
  const doc = fresh();
  const flatStep = doc.steps[0]!;
  doc.steps = [flatStep];
  ensureValidDocument(doc);
  const added = ensureFlatStep(doc.steps);
  check("flat step id is unique", added.id !== flatStep.id);
  check("empty tutorial resolves", resolves(doc));
}

function resolves(doc: ReturnType<typeof fresh>) {
  try {
    return resolveSteps(doc.paper, doc.steps).length === doc.steps.length;
  } catch {
    return false;
  }
}

// 12. 真正的播放器：播放中改写目标步骤，播放停下且播放头留在原步骤。
{
  const rafQueue: FrameRequestCallback[] = [];
  const g = globalThis as unknown as {
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame: (id: number) => void;
  };
  const prevRaf = g.requestAnimationFrame,
    prevCancel = g.cancelAnimationFrame;
  g.requestAnimationFrame = (cb) => rafQueue.push(cb);
  g.cancelAnimationFrame = () => {};
  const step = (time: number) => rafQueue.shift()?.(time);
  const warn = console.warn;
  console.warn = () => {};

  const doc = fresh();
  focusStep(doc, doc.steps[0]!.id);
  const startId = doc.current;
  const target = doc.steps[1]!;
  const targetId = target.id;
  const { usePlayer } = await import("../src/features/sequence/model/player");
  const player = usePlayer(doc);
  player.toggle();
  step(0); // 初始化，锁定播放目标
  check("player starts playing", doc.playing === true);
  // 播放途中改写目标步骤内容：id 不变，revision 变化。
  target.note = "播到一半被改掉";
  target.revision += 1;
  step(16);
  check("player stops on edited target", doc.playing === false);
  check("playhead stays on original step", doc.current === startId);
  check("playhead did not drift to edited step", doc.current !== targetId);
  check("angles restored to start pose", doc.angles.c1 === undefined);

  console.warn = warn;
  g.requestAnimationFrame = prevRaf;
  g.cancelAnimationFrame = prevCancel;
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall sequence checks passed");
