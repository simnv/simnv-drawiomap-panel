import type { DataFrame, Field, Labels } from '@grafana/data';

export type QuerySnapshot =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; frames: DataFrame[]; fetchedAt: number; fromCache: boolean }
  | { state: 'empty'; fetchedAt: number; fromCache: boolean }
  | { state: 'error' | 'unsupported'; message: string };

export interface Series {
  refId: string;
  labels: Labels;
  field: Field;
  frameIndex: number;
  fieldIndex: number;
  times: number[];
  values: Array<number | null>;
}
