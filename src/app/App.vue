<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  Layers,
  RotateCcw,
  ArrowUpRight,
  HelpCircle,
  Leaf,
} from "lucide-vue-next";
import { createDocument } from "../shared/document";
import { PaperPanel, papers, replacePaper } from "../features/paper";
import {
  CreasePanel,
  selectCrease,
  toggleDirection,
  selectedCrease,
} from "../features/creases";
import {
  FoldPanel,
  solvePose,
  hingePositions,
  changeAngle,
  flatten,
  applyTarget,
} from "../features/fold";
import {
  SequencePanel,
  makeSteps,
  seek,
  captureStep,
  usePlayer,
  insertStep,
  duplicateStep,
  moveStep,
  setStepMode,
  commitRemoval,
  lockAffectedStep,
  reanchorAffected,
  ensureValidDocument,
  adoptSteps,
  focusStep,
  auditSteps,
} from "../features/sequence";
import type {
  RemovalPlan,
  RemovalStrategy,
} from "../features/sequence";
import { Viewport, ObservePanel, setView } from "../features/observe";
const doc = reactive(createDocument(papers[0]!, makeSteps(papers[0]!)));
ensureValidDocument(doc);
const pose = computed(() => solvePose(doc.paper, doc.angles)),
  hinges = computed(() => hingePositions(doc.paper, pose.value));
const audits = computed(() => auditSteps(doc.paper, doc.steps));
const { toggle } = usePlayer(doc);
const help = ref(false),
  toast = ref("");
function notify(s: string) {
  toast.value = s;
  setTimeout(() => (toast.value = ""), 2400);
}
function choosePaper(id: string) {
  const p = papers.find((p) => p.id === id);
  if (p) {
    replacePaper(doc, p);
    adoptSteps(doc, makeSteps(p), 0);
    setView(doc, "iso");
  }
}
function reset() {
  flatten(doc);
  adoptSteps(doc, makeSteps(doc.paper), 0);
  setView(doc, "iso");
  notify("已回到平展纸张");
}
function capture() {
  const step = captureStep(doc);
  notify(
    step
      ? `步骤 ${doc.step + 1} 已按「${step.mode === "relative" ? "相对前一步" : "锁定形态"}」保存`
      : "已保存当前步骤",
  );
}
function insert() {
  const after = doc.step + 1;
  const step = insertStep(doc);
  notify(`已在第 ${after} 步后插入「${step.title}」`);
}
function duplicate(id: string) {
  const copy = duplicateStep(doc, id);
  if (copy) notify(`已复制为「${copy.title}」，可独立修改`);
}
function move(id: string, delta: number) {
  if (!moveStep(doc, id, delta)) return;
  const drifted = audits.value.filter((a) => a.drifts.length).length;
  notify(
    drifted
      ? `步骤已移动，${drifted} 个后续动作需要确认父纸面`
      : `步骤已移动到第 ${doc.steps.findIndex((s) => s.id === id) + 1} 位`,
  );
}
function confirmRemoval(plan: RemovalPlan, strategy: RemovalStrategy) {
  const { removed } = commitRemoval(doc, plan, strategy);
  notify(
    removed > 1
      ? `已删除 ${removed} 步（含依赖步骤），教程共 ${doc.steps.length} 步`
      : `已删除「${plan.targetTitle}」，教程共 ${doc.steps.length} 步`,
  );
}
function setMode(mode: "relative" | "absolute") {
  setStepMode(doc, mode);
  notify(
    mode === "relative"
      ? "这一步改为跟随前一步，重排后仍表达同一折法"
      : "这一步已锁定为当前绝对形态",
  );
}
function updateStep(
  id: string,
  patch: { title?: string; note?: string; duration?: number },
) {
  const step = doc.steps.find((s) => s.id === id);
  if (!step) return;
  if (patch.title !== undefined) step.title = patch.title;
  if (patch.note !== undefined) step.note = patch.note;
  if (patch.duration !== undefined)
    step.duration = Math.max(300, Math.min(8000, patch.duration || 300));
  step.revision += 1;
}
function reanchor() {
  if (reanchorAffected(doc))
    notify("已按新的前一步重新锚定，折法保持不变");
}
function lockAll() {
  const ids = audits.value.filter((a) => a.drifts.length).map((a) => a.id);
  ids.forEach((id) => lockAffectedStep(doc, id));
  notify(
    ids.length
      ? `已把 ${ids.length} 个受影响步骤锁定为当前形态`
      : "没有需要锁定的步骤",
  );
}

</script>
<template>
  <div class="workspace">
    <header class="topbar">
      <a class="brand" href="#"
        ><span class="brand-mark">◩</span><strong>折间<span>ORI</span></strong
        ><i></i><small>三维折纸工作室</small></a
      >
      <nav>
        <span class="project-indicator"></span> 未命名的纸间探索
        <span class="local-badge">本次会话</span>
      </nav>
      <div class="header-actions">
        <button class="icon-button" aria-label="帮助" @click="help = !help">
          <HelpCircle :size="18" /></button
        ><button class="reset" @click="reset">
          <RotateCcw :size="14" />重新开始</button
        ><button class="primary" @click="seek(doc, doc.steps.length - 1)">
          观察成品 <ArrowUpRight :size="15" />
        </button>
      </div>
    </header>
    <main>
      <div class="page-title">
        <div>
          <div class="eyebrow">THE ART OF FOLDING</div>
          <h1>一张纸，无限可能<span>。</span></h1>
          <p>沿着折痕，让平面生长成空间。</p>
        </div>
        <div class="session-note">
          <Leaf :size="16" /><span>放慢一点，折出自己的节奏。</span>
        </div>
      </div>
      <div class="studio">
        <aside class="left-sidebar">
          <PaperPanel :doc="doc" @paper="choosePaper" /><CreasePanel
            :doc="doc"
            @select="selectCrease(doc, $event)"
          />
          <div class="sidebar-footer">
            <Layers :size="13" /> 单张纸 ·
            {{ doc.paper.faces.length }} 个关联纸面
          </div>
        </aside>
        <div class="center">
          <div class="canvas-label">
            <span
              >{{ doc.paper.name }}
              <small
                >/
                {{
                  doc.paper.id === "shelter" ? "PAPER GARDEN" : "VALLEY WALK"
                }}</small
              ></span
            ><span class="difficulty"
              >入门探索 <i></i><i></i><i class="empty"></i
            ></span>
          </div>
          <Viewport
            :doc="doc"
            :pose="pose"
            :hinges="hinges"
            @select="selectCrease(doc, $event)"
          />
          <div class="instruction">
            <span class="instruction-number">{{
              String(doc.step + 1).padStart(2, "0")
            }}</span>
            <div>
              <b>{{ doc.steps[doc.step]?.title }}</b>
              <p>{{ doc.steps[doc.step]?.note }}</p>
            </div>
            <span class="step-count"
              >{{ doc.step + 1 }} / {{ doc.steps.length }}</span
            >
          </div>
        </div>
        <aside class="right-sidebar">
          <div class="selected-heading">
            <span class="eyebrow">当前折痕</span>
            <h2>{{ selectedCrease(doc)?.name }}</h2>
            <p>{{ selectedCrease(doc)?.description }}</p>
          </div>
          <FoldPanel
            :doc="doc"
            @angle="changeAngle(doc, $event)"
            @direction="toggleDirection(doc)"
            @target="applyTarget(doc)"
          /><ObservePanel :doc="doc" />
        </aside>
      </div>
      <SequencePanel
        :doc="doc"
        @seek="(id) => seek(doc, doc.steps.findIndex((s) => s.id === id))"
        @play="toggle"
        @capture="capture"
        @insert="insert"
        @duplicate="duplicate"
        @move="move"
        @confirm="confirmRemoval"
        @mode="setMode"
        @update="updateStep"
        @reanchor="reanchor"
        @lock-all="lockAll"
      />
      <footer>
        <span>ORI / 折间 <i>用折叠，重新认识一张纸。</i></span
        ><span
          ><i class="status-dot"></i> 全部计算于浏览器本地
          <small>© 2026 ORI STUDIO</small></span
        >
      </footer>
    </main>
    <div v-if="toast" role="status" class="toast">✓ {{ toast }}</div>
    <div v-if="help" class="modal-backdrop" @click.self="help = false">
      <section class="help-modal">
        <button class="close" @click="help = false">×</button>
        <div class="eyebrow">A SMALL GUIDE</div>
        <h2>从第一道折痕开始</h2>
        <p>
          选择纸张与颜色，点选折痕后拖动角度滑杆。父纸面转动时，关联纸面会一起运动。
        </p>
        <p>
          下方步骤可保存、插入、复制、重排或删除。相对步骤只记录这一折的增量，
          重排后会提示哪些后续动作的父纸面已经变化。
        </p>
        <p>作品保留在本次会话中，刷新会重新开始。</p>
        <button class="primary" @click="help = false">开始探索 ↗</button>
      </section>
    </div>
  </div>
</template>
