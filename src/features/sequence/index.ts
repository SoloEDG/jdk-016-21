export { default as SequencePanel } from "./ui/SequencePanel.vue";
export {
  makeSteps,
  makeFlatStep,
  makeStepFromPose,
  recomputeAngles,
} from "./lib/steps";
export { resolveStep, resolveSteps, auditSteps, driftForStep } from "./lib/pose";
export { seek, captureStep } from "./model/timeline";
export {
  insertStep,
  insertFromCrease,
  duplicateStep,
  moveStep,
  moveStepTo,
  setStepMode,
  analyzeRemoval,
  commitRemoval,
  lockAffectedStep,
  reanchorAffected,
  focusStep,
  ensureValidDocument,
  adoptSteps,
  currentStep,
  poseBefore,
} from "./model/editing";
export type {
  RemovalPlan,
  RemovalStrategy,
  StepImpact,
} from "./model/editing";
export { usePlayer } from "./model/player";
