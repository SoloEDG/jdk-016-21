<script setup lang="ts">
import { computed, ref } from "vue";
import type { Document, FoldMode } from "../../../shared/types";
import { auditSteps, type OpDrift } from "../lib/pose";
import {
  analyzeRemoval,
  type RemovalPlan,
  type RemovalStrategy,
} from "../model/editing";

const props = defineProps<{ doc: Document }>();
const emit = defineEmits<{
  seek: [id: string];
  play: [];
  capture: [];
  insert: [];
  duplicate: [id: string];
  move: [id: string, delta: number];
  confirm: [plan: RemovalPlan, strategy: RemovalStrategy];
  mode: [mode: FoldMode];
  update: [
    id: string,
    patch: { title?: string; note?: string; duration?: number },
  ];
  reanchor: [];
  lockAll: [];
}>();

const current = computed(
  () =>
    props.doc.steps.find((s) => s.id === props.doc.current) ??
    props.doc.steps[props.doc.step],
);
const audits = computed(() => auditSteps(props.doc.paper, props.doc.steps));
const warningMap = computed(
  () =>
    new Map(
      audits.value
        .filter((a) => a.drifts.length)
        .map((a) => [a.id, a.drifts] as const),
    ),
);
const warnings = computed(() =>
  props.doc.steps
    .map((step, index) => ({ step, index, drifts: warningMap.value.get(step.id) }))
    .filter((item) => item.drifts?.length),
);

const removal = ref<RemovalPlan | null>(null);
const strategy = ref<RemovalStrategy>("expand");
function askRemove(id: string) {
  removal.value = analyzeRemoval(props.doc, id) ?? null;
  strategy.value = "expand";
}
function cancelRemoval() {
  removal.value = null;
}
function confirmRemoval() {
  if (!removal.value) return;
  emitConfirm(removal.value);
  removal.value = null;
}
const emitConfirm = (plan: RemovalPlan) =>
  emit("confirm", plan, strategy.value);

function patch(field: "title" | "note" | "duration", event: Event) {
  const step = current.value;
  if (!step) return;
  const raw = (event.target as HTMLInputElement).value;
  emit("update", step.id, {
    [field]: field === "duration" ? Number(raw) : raw,
  });
}

function creaseName(id: string) {
  return props.doc.paper.creases.find((c) => c.id === id)?.name ?? id;
}
function driftText(drift: OpDrift) {
  if (drift.kind === "base")
    return `「${creaseName(drift.crease)}」的上一步角度已从 ${drift.expected}° 变为 ${drift.actual}°，这一步的相对折量将落在新的基准上`;
  return `「${creaseName(drift.crease)}」的折轴来自父纸面「${creaseName(drift.axisCrease)}」，其角度已从 ${drift.expected}° 变为 ${drift.actual}°`;
}

</script>

<template>
  <section class="timeline">
    <div class="timeline-top">
      <div>
        <span class="eyebrow">折叠步骤</span><b>一步一折，慢慢成形。</b>
      </div>
      <div class="playback">
        <select v-model.number="doc.speed" aria-label="播放速度">
          <option :value="0.5">0.5×</option>
          <option :value="1">1×</option>
          <option :value="2">2×</option></select
        ><button
          title="上一步"
          aria-label="上一步"
          @click="emit('seek', doc.steps[doc.step - 1]?.id ?? current?.id ?? '')"
        >
          ‹</button
        ><button class="play" aria-label="播放步骤" @click="emit('play')">
          {{ doc.playing ? "Ⅱ" : "▶" }}</button
        ><button
          title="下一步"
          aria-label="下一步"
          @click="emit('seek', doc.steps[doc.step + 1]?.id ?? current?.id ?? '')"
        >
          ›</button
        ><button class="save-step" @click="emit('capture')">
          保存当前步骤
        </button>
        <button class="save-step insert-step" @click="emit('insert')">
          ＋ 插入步骤
        </button>
      </div>
    </div>

    <div class="step-track">
      <template v-for="(s, i) in doc.steps" :key="s.id">
        <div
          class="step-item"
          :class="{
            current: doc.current === s.id,
            done: doc.step > i,
            flagged: warningMap.has(s.id),
          }"
        >
          <button class="step-main" @click="emit('seek', s.id)">
            <span class="step-dot">{{
              doc.step > i ? "✓" : String(i + 1).padStart(2, "0")
            }}</span>
            <span class="step-copy"
              ><b>{{ s.title }}</b
              ><small
                ><template v-if="s.mode === 'relative'">跟随前一步</template
                ><template v-else>锁定形态</template>
                <template v-if="i === 0"> · START</template
                ><template v-else-if="i === doc.steps.length - 1"
                  > · FINISH</template
                ></small
              ></span
            >
          </button>
          <div class="step-actions">
            <button
              title="上移步骤"
              aria-label="上移步骤"
              :disabled="i === 0"
              @click="emit('move', s.id, -1)"
            >
              ↑</button
            ><button
              title="下移步骤"
              aria-label="下移步骤"
              :disabled="i === doc.steps.length - 1"
              @click="emit('move', s.id, 1)"
            >
              ↓</button
            ><button
              title="复制步骤"
              aria-label="复制步骤"
              @click="emit('duplicate', s.id)"
            >
              ⧉</button
            ><button
              title="删除步骤"
              aria-label="删除步骤"
              @click="askRemove(s.id)"
            >
              ✕</button
            >
          </div>
          <button
            v-if="warningMap.has(s.id)"
            class="step-flag"
            :title="warningMap.get(s.id)!.map(driftText).join('\n')"
            @click="emit('seek', s.id)"
          >
            ⚠ 父纸面已变化
          </button>
        </div>
        <i v-if="i < doc.steps.length - 1" class="step-link"></i>
      </template>
    </div>

    <div v-if="warnings.length" class="dependency-banner" role="status">
      <header>
        <b>⚠ {{ warnings.length }} 个后续动作基于已经变化的父纸面</b>
        <span>它们仍指向原来的折痕，只是折轴或基准已经不同。</span>
      </header>
      <ul>
        <li v-for="w in warnings" :key="w.step.id">
          <button class="warning-step" @click="emit('seek', w.step.id)">
            {{ String(w.index + 1).padStart(2, "0") }} · {{ w.step.title }}</button
          ><span>{{ driftText(w.drifts![0]!) }}</span>
          <small v-if="w.drifts!.length > 1"
            >另有 {{ w.drifts!.length - 1 }} 处依赖</small
          >
        </li>
      </ul>
      <div class="dependency-actions">
        <button @click="emit('reanchor')">保留折法 · 按新前一步重新锚定</button>
        <button class="ghost" @click="emit('lockAll')">
          锁定为当前形态
        </button>
      </div>
    </div>

    <div v-if="current" class="step-editor">
      <label class="editor-field"
        ><span>步骤标题</span
        ><input :value="current.title" @change="patch('title', $event)"
      /></label>
      <label class="editor-field wide"
        ><span>折叠说明</span
        ><input :value="current.note" @change="patch('note', $event)"
      /></label>
      <label class="editor-field duration"
        ><span>时长 (ms)</span
        ><input
          type="number"
          min="300"
          max="8000"
          step="100"
          :value="current.duration"
          @change="patch('duration', $event)"
      /></label>
      <div class="mode-switch" role="group" aria-label="步骤意图">
        <button
          :class="{ selected: current.mode === 'relative' }"
          @click="emit('mode', 'relative')"
        >
          相对前一步
        </button>
        <button
          :class="{ selected: current.mode === 'absolute' }"
          @click="emit('mode', 'absolute')"
        >
          锁定绝对形态
        </button>
      </div>
      <p class="mode-hint">
        {{
          current.mode === "relative"
            ? "相对步骤只记录这一折的增量。插入、复制或重排后，它会跟着新的前一步走，并在父纸面改变时提示。"
            : "绝对步骤锁定每根折痕的角度。重排不会改变形态，但折轴变化时仍会提示你确认。"
        }}
      </p>
    </div>

    <div v-if="removal" class="modal-backdrop" @click.self="cancelRemoval">
      <section class="removal-modal" role="dialog" aria-modal="true">
        <div class="eyebrow">DELETE STEP</div>
        <h2>删除「{{ removal.targetTitle }}」？</h2>
        <p v-if="!removal.affected.length" class="removal-quiet">
          没有其他步骤引用这一步，删除后其余步骤按原样复现。
        </p>
        <template v-else>
          <p class="removal-lead">
            有 {{ removal.affected.length }} 个后续步骤引用了这一步的折叠结果，
            请选择如何处理它们：
          </p>
          <div class="removal-options">
            <button
              :class="{ selected: strategy === 'expand' }"
              @click="strategy = 'expand'"
            >
              <b>展开引用 · 保留形态</b>
              <small
                >把被删掉的折叠角度写进最早受影响的步骤，后续动作仍复现原来的纸面。</small
              >
              <ul>
                <li v-for="lock in removal.expandLocks" :key="lock.id">
                  锁定「{{ lock.title }}」为绝对形态
                </li>
              </ul>
            </button>
            <button
              :class="{ selected: strategy === 'cascade' }"
              @click="strategy = 'cascade'"
            >
              <b>一起删除</b>
              <small>所有依赖这一步的后续动作也会被删除。</small>
              <ul>
                <li v-for="step in removal.cascade" :key="step.id">
                  {{ String(step.index + 1).padStart(2, "0") }} ·
                  {{ step.title }}
                </li>
              </ul>
            </button>
          </div>
        </template>
        <footer class="removal-footer">
          <span
            >删除后剩余 {{ removal.remainingCount }} 步
            <template v-if="removal.totalCount === 1"
              >（将自动补回起始步骤）</template
            ></span
          >
          <button class="ghost" @click="cancelRemoval">取消</button>
          <button class="danger" @click="confirmRemoval">确认删除</button>
        </footer>
      </section>
    </div>
  </section>
</template>
