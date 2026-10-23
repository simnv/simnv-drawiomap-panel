import React, { useId, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { CollapsableSection, Field, Select, useStyles2, type FieldProps } from '@grafana/ui';

/** Associate visible field labels with controls, including Select's search input. */
export function EditorField({ children, ...props }: FieldProps) {
  const id = useId();
  const suppliedId = children.props.inputId ?? children.props.id;
  const controlId = typeof suppliedId === 'string' ? suppliedId : id;
  return (
    <Field {...props} htmlFor={controlId}>
      {React.cloneElement(children, children.type === Select ? { inputId: controlId } : { id: controlId })}
    </Field>
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
  sectionHeader: css({ padding: theme.spacing(1), fontSize: theme.typography.body.fontSize }),
  sectionContent: css({ padding: theme.spacing(0, 2, 2), minWidth: 0 }),
});
