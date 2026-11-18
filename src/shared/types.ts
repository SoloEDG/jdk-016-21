export type Vec3 = [number, number, number];
export interface Face {
  id: string;
  points: Vec3[];
  parent?: string;
  hinge?: [Vec3, Vec3];
  crease?: string;
}
export interface Crease {
  id: string;
  name: string;
  description: string;
  face: string;
  target: number;
}
export interface Paper {
  id: string;
  name: string;
  subtitle: string;
  size: number;
  faces: Face[];
  creases: Crease[];
}
export type FoldMode = "relative" | "absolute";
/**
 * 一条折叠操作。操作始终绑定折痕 id，而不是数组下标，
 * 这样重排后不会把同一个数字角度套到另一根折轴上。
 */
export interface FoldOp {
  crease: string;
  /** 操作自身的语义；步骤级 mode 只表示新建/保存时的默认值。 */
  mode: FoldMode;
  /** 相对模式下是增量，绝对模式下是目标角度。 */
  value: number;
  /** 相对模式记录落笔时上一步的角度，用于发现依赖漂移。 */
  base?: number;
  /** 落笔时父纸面的角度快照，重排后用来判断折轴是否已经移动。 */
  axis: Record<string, number>;
}
export interface Step {
  id: string;
  title: string;
  note: string;
  mode: FoldMode;
  ops: FoldOp[];
  /** 该步骤解析后的完整形态，供播放与预览直接使用。 */
  angles: Record<string, number>;
  duration: number;
  /** 内容修订号，播放器据此确认目标仍是同一份内容。 */
  revision: number;
}
export interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  grid: boolean;
  wire: boolean;
}
export interface Document {
  paper: Paper;
  front: string;
  back: string;
  texture: string;
  selected: string;
  angles: Record<string, number>;
  directions: Record<string, number>;
  steps: Step[];
  step: number;
  /** 稳定的步骤身份，重排后仍指向同一步，而不是同一下标。 */
  current: string;
  playing: boolean;
  speed: number;
  view: View;
}
export interface PoseFace {
  id: string;
  points: Vec3[];
  normal: Vec3;
}
