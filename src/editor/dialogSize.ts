import { css } from '@emotion/css';

/**
 * The size of the editor dialogs (the draw.io editor and Edit bindings) in percent of the viewport. Both are in the
 * middle of the viewport. A phone shows them as a full-screen sheet.
 */
export const DIALOG_VW = 96;
export const DIALOG_VH = 94;

/** Narrow viewports and short landscape screens use a full-screen sheet. */
export const DIALOG_SHEET_MEDIA = '@media (max-width: 640px), (max-height: 480px)';

/**
 * A Grafana `Modal` with the size of the dialogs: the draw.io modal and the shell of the bindings popup while its
 * chunk loads. The doubled selector wins over the Grafana Modal rules (top 10%, max-height 80%, margins and padding).
 */
export const dialogModalClass = css`
  && {
    top: 50%;
    transform: translateY(-50%);
    width: ${DIALOG_VW}vw;
    max-width: ${DIALOG_VW}vw;
    height: ${DIALOG_VH}vh;
    height: ${DIALOG_VH}dvh;
    max-height: ${DIALOG_VH}vh;
    max-height: ${DIALOG_VH}dvh;
    display: flex;
    flex-direction: column;
  }
  ${DIALOG_SHEET_MEDIA} {
    && {
      top: 0;
      transform: none;
      width: 100vw;
      max-width: 100vw;
      height: 100vh;
      height: 100dvh;
      max-height: 100vh;
      max-height: 100dvh;
      border-radius: 0;
    }
  }
`;
