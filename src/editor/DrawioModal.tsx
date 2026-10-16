/** Props contract. Task 1 moves this type to src/types.ts; Task 8 implements the modal. */
export interface DrawioModalProps {
  editorUrl: string;
  xml: string;
  title?: string;
  mode: 'edit' | 'export-only';
  isDark: boolean;
  onSave: (result: { xml: string; svg: string }) => void;
  onClose: () => void;
}

export function DrawioModal(_props: DrawioModalProps) {
  return null;
}
