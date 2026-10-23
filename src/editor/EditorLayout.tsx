import React, { useId, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { CollapsableSection, Field, IconButton, Select, useStyles2, type FieldProps } from '@grafana/ui';
import { resetLabel, sourceText, type FieldSource } from './fieldSource';

/** What the editor shows about the source of a field. `scope` decides the words "to pattern" or "to default". */
export interface FieldSourceView extends FieldSource {
  scope: 'element' | 'pattern';
}
/** The source of a field with its reset action. */
export type EditorSource = FieldSourceView & { onReset?: () => void };
/** Props that a field takes to show its source: the lookup of the editor and the reset action. */
export interface SourceProps {
  sourceOf?: (path: string) => FieldSourceView | undefined;
  onReset?: (resetPath: string) => void;
}
/** The source of one path with its reset bound to the reset path. Undefined when the editor gives no sources. */
export function sourceFor({ sourceOf, onReset }: SourceProps, path?: string): EditorSource | undefined {
  const source = path ? sourceOf?.(path) : undefined;
  return source && { ...source, onReset: onReset ? () => onReset(source.resetPath) : undefined };
}

/** The chip "Pattern Core routers", "Override" or "Default", and the reset button when a reset has an effect. */
export function SourceChip({ label, source }: { label: string; source: EditorSource }) {
  const styles = useStyles2(getEditorStyles);
  return (
    <span className={styles.source} data-testid="dmap-field-source" data-source={source.owner}>
      <span className={styles.chip}>{sourceText(source)}</span>
      {source.resettable && source.onReset && (
        <IconButton
          name="times"
          size="sm"
          tooltip={resetLabel(label, source, source.scope)}
          aria-label={resetLabel(label, source, source.scope)}
          onClick={source.onReset}
        />
      )}
    </span>
  );
}

/** The chip of a group of controls that has no single label to carry it, for example a metric binding. */
export function SourceRow({ label, source }: { label: string; source: EditorSource }) {
  const styles = useStyles2(getEditorStyles);
  return (
    <div className={styles.sourceRow}>
      <SourceChip label={label} source={source} />
    </div>
  );
}

/** Associate visible field labels with controls, including Select's search input. The chip sits on the label line. */
export function EditorField({ children, source, ...props }: FieldProps & { source?: EditorSource }) {
  const id = useId();
  const styles = useStyles2(getEditorStyles);
  const suppliedId = children.props.inputId ?? children.props.id;
  const controlId = typeof suppliedId === 'string' ? suppliedId : id;
  const field = (
    <Field {...props} htmlFor={controlId}>
      {React.cloneElement(children, children.type === Select ? { inputId: controlId } : { id: controlId })}
    </Field>
  );
  // The chip is a sibling of the label, not a part of it: the accessible name of the control stays the label.
  return source ? (
    <div className={styles.sourced}>
      {field}
      <SourceChip label={typeof props.label === 'string' ? props.label : 'field'} source={source} />
    </div>
  ) : (
    field
  );
}

export function EditorSection({
  title,
  defaultOpen = false,
  children,
}: React.PropsWithChildren<{ title: React.ReactNode; defaultOpen?: boolean }>) {
  const [open, setOpen] = useState(defaultOpen);
  // Keep draft state after first opening without initializing unopened native editors.
  const [visited, setVisited] = useState(defaultOpen);
  const styles = useStyles2(getEditorStyles);
  return (
    <div className={styles.section}>
      <CollapsableSection
        label={title}
        isOpen={open}
        onToggle={(next) => {
          setOpen(next);
          if (next) {
            setVisited(true);
          }
        }}
        unmountContentWhenClosed={false}
        className={styles.sectionHeader}
        contentClassName={styles.sectionContent}
      >
        {visited ? children : null}
      </CollapsableSection>
    </div>
  );
}

export const getEditorStyles = (theme: GrafanaTheme2) => ({
  inspector: css({
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    minWidth: 0,
    minHeight: 0,
    maxWidth: '100%',
    height: '100%',
    boxSizing: 'border-box',
    background: theme.colors.background.primary,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    '& h3, & h4': {
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      margin: theme.spacing(0, 0, 1),
      lineHeight: theme.typography.h6.lineHeight,
    },
    '& p': { margin: theme.spacing(0, 0, 1), color: theme.colors.text.secondary },
    '& ul': { paddingLeft: theme.spacing(2), margin: theme.spacing(0, 0, 1) },
    '& pre': {
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      maxHeight: 240,
      overflow: 'auto',
      margin: 0,
    },
    '& input, & textarea': { minWidth: 0, maxWidth: '100%' },
    '& button': { maxWidth: '100%', whiteSpace: 'normal', height: 'auto', minHeight: theme.spacing(3) },
    '& button > span': { whiteSpace: 'normal', overflowWrap: 'anywhere' },
    '& output': { display: 'block', marginTop: theme.spacing(1), color: theme.colors.text.secondary },
  }),
  header: css({ padding: theme.spacing(1.5, 2, 0), borderBottom: `1px solid ${theme.colors.border.weak}` }),
  tabs: css({
    marginTop: theme.spacing(1),
    borderBottom: 0,
    '& button, & button > span': { whiteSpace: 'nowrap' },
    '& button': { padding: theme.spacing(1, 1) },
  }),
  body: css({
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: theme.spacing(2),
    scrollbarGutter: 'stable',
    '& > section': { marginBottom: theme.spacing(2) },
    '& button:not([aria-expanded])': { marginBottom: theme.spacing(1), marginRight: theme.spacing(0.5) },
  }),
  footer: css({
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
  }),
  section: css({
    minWidth: 0,
    flex: 'none',
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    marginBottom: theme.spacing(1),
    '& > div:first-child': { minWidth: 0 },
    '& > div:first-child > div': { minWidth: 0, overflowWrap: 'anywhere' },
  }),
  sourced: css({ position: 'relative' }),
  sourceRow: css({ position: 'relative', minHeight: theme.spacing(3), marginBottom: theme.spacing(0.5) }),
  source: css({
    position: 'absolute',
    top: -3,
    right: 0,
    maxWidth: '65%',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    // The label line has this height. The reset button is taller and centres on it.
    height: theme.spacing(2.5),
  }),
  chip: css({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: theme.spacing(0, 0.75),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.pxToRem(11),
    lineHeight: theme.typography.bodySmall.lineHeight,
  }),
  sectionHeader: css({ padding: theme.spacing(1), fontSize: theme.typography.body.fontSize }),
  sectionContent: css({ padding: theme.spacing(0, 2, 2), minWidth: 0 }),
});
