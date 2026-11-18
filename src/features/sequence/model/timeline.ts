import type { Document } from "../../../shared/types";
import { clamp } from "../../../shared/document";
import { ensureValidDocument, focusStep } from "./editing";

export { captureStep } from "./editing";

/**
 * 按下标定位，但落点由该下标当前对应的步骤身份决定。
 * 空教程会自动补回一个可折叠的起始步骤。
 */
export function seek(doc: Document, index: number) {
  doc.playing = false;
  ensureValidDocument(doc);
  const step = doc.steps[clamp(index, 0, doc.steps.length - 1)];
  if (step) focusStep(doc, step.id);
}
