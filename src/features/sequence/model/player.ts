import { onUnmounted } from "vue";
import type { Document, Step } from "../../../shared/types";
import { interpolate } from "../lib/steps";
import { primaryCrease } from "../lib/pose";

/**
 * 播放器按步骤身份（id + revision）推进，而不是按下标。
 * 编辑导致目标被删除、替换或内容变化时，立即停在原地，
 * 不会把播放头交给“id 相同但内容已经不同”的步骤。
 */
export function usePlayer(doc: Document) {
  let frame = 0,
    last = 0,
    elapsed = 0,
    startPose: Record<string, number> = {},
    startId = "",
    targetId = "",
    targetRevision = 0;

  function stop() {
    doc.playing = false;
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  function snapTo(id: string) {
    const step =
      doc.steps.find((s) => s.id === id) ??
      doc.steps[Math.min(doc.step, doc.steps.length - 1)];
    if (!step) return;
    doc.current = step.id;
    doc.step = doc.steps.indexOf(step);
    doc.angles = { ...step.angles };
  }

  function begin() {
    const index = doc.steps.findIndex((s) => s.id === doc.current);
    const next: Step | undefined = doc.steps[index + 1];
    if (!next) {
      stop();
      return;
    }
    startId = doc.current;
    startPose = { ...doc.angles };
    targetId = next.id;
    targetRevision = next.revision;
    elapsed = 0;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function tick(now: number) {
    if (!doc.playing) {
      last = 0;
      return;
    }
    const target = doc.steps.find((s) => s.id === targetId);
    // 播放期间目标被删除或内容被改写过：停在原步骤，保留身份。
    if (!target || target.revision !== targetRevision) {
      stop();
      snapTo(startId);
      return;
    }
    if (!last) last = now;
    elapsed += (now - last) * doc.speed;
    last = now;
    doc.angles = interpolate(
      startPose,
      target.angles,
      Math.min(1, elapsed / target.duration),
    );
    if (elapsed >= target.duration) {
      const arrived = doc.steps.find((s) => s.id === targetId);
      if (!arrived || arrived.revision !== targetRevision) {
        stop();
        snapTo(startId);
        return;
      }
      snapTo(targetId);
      const reached = doc.steps.find((s) => s.id === targetId);
      const crease = reached && primaryCrease(reached);
      if (crease && doc.paper.creases.some((c) => c.id === crease))
        doc.selected = crease;
      startPose = { ...doc.angles };
      startId = targetId;
      const next = doc.steps[doc.steps.findIndex((s) => s.id === targetId) + 1];
      if (!next) {
        stop();
        return;
      }
      targetId = next.id;
      targetRevision = next.revision;
      elapsed = 0;
      last = 0;
    }
    frame = requestAnimationFrame(tick);
  }

  function toggle() {
    if (doc.playing) {
      stop();
      return;
    }
    doc.playing = true;
    begin();
  }

  onUnmounted(() => cancelAnimationFrame(frame));
  return { toggle, stop };
}
