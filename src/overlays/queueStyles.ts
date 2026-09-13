import { theme } from "../ui/theme";

// Mounted with this modal only. Never restyle another Steam/Decky dialog.
export const queueStyles = `
.FullModalOverlay:has(.dm-queue-modal) > .ModalOverlayBackground {
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: none;
}
.dm-queue-modal .dm-queue-dialog.DialogContent {
  position: fixed;
  inset: 48px 1.5rem 44px auto;
  width: clamp(22rem, 46vw, 28rem);
  max-width: calc(100vw - 3rem);
  height: auto;
  min-height: 0;
  max-height: none;
  margin: 0;
  padding: 0;
  background: ${theme.bg};
  color: ${theme.text};
  border: 0;
  border-left: 1px solid rgba(255,255,255,0.12);
  border-radius: ${theme.radius}px;
  box-shadow: -16px 0 40px rgba(0,0,0,0.3);
}
.dm-queue-dialog .DialogContent_InnerWidth,
.dm-queue-dialog .DialogContent_InnerWidth > form {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: none;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 0;
}
.dm-queue-shell { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dm-queue-header {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
}
.dm-queue-title { margin: 0; font-size: 1.15rem; font-weight: 700; flex: 1; min-width: 0; }
.dm-queue-count { color: ${theme.textDim}; font-size: 0.8rem; font-weight: 400; margin-left: 0.5rem; white-space: nowrap; }
.dm-queue-action {
  display: flex; align-items: center; justify-content: center;
  min-height: 2.25rem; padding: 0 0.65rem; box-sizing: border-box;
  border-radius: ${theme.radius}px; color: ${theme.textDim};
  font-size: 0.85rem; cursor: pointer; flex-shrink: 0;
}
.dm-queue-close { width: 2.25rem; padding: 0; color: ${theme.text}; }
.dm-queue-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0.5rem 0.75rem; scroll-padding: 0.5rem; }
.dm-queue-row {
  display: flex; align-items: center; gap: 0.65rem; position: relative;
  height: 68px; margin: 2px 0; padding: 0.5rem 0.55rem; box-sizing: border-box;
  border-radius: ${theme.radius}px; cursor: pointer;
}
.dm-queue-row[data-current="true"] { background: ${theme.listHighlight}; }
.dm-queue-row[data-current="true"]::after {
  content: ""; position: absolute; left: 0; top: 0.65rem; bottom: 0.65rem;
  width: 2px; background: ${theme.accent}; border-radius: 1px;
}
.dm-queue-dialog .dm-queue-focus {
  outline: 2px solid ${theme.text} !important; outline-offset: -2px;
  background: ${theme.listHighlight}; color: ${theme.text};
}
.dm-queue-cover {
  width: 48px; height: 48px; object-fit: cover; border-radius: ${theme.radius}px;
  background: #252528; flex-shrink: 0;
}
.dm-queue-track { flex: 1; min-width: 0; }
.dm-queue-track-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.95rem; }
.dm-queue-track-singer { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: ${theme.textDim}; font-size: 0.8rem; margin-top: 0.2rem; }
.dm-queue-duration { color: ${theme.textDim}; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.dm-queue-marker { width: 0.9rem; color: ${theme.textDim}; font-size: 0.72rem; text-align: center; flex-shrink: 0; }
.dm-queue-marker[data-current="true"] { color: ${theme.accent}; }
.dm-queue-radio { flex: 1; min-height: 0; overflow-y: auto; padding: 1.25rem; }
.dm-queue-label { color: ${theme.textDim}; font-size: 0.8rem; margin-bottom: 0.75rem; }
.dm-queue-radio-track { display: flex; align-items: center; gap: 0.85rem; }
.dm-queue-radio-track .dm-queue-cover { width: 64px; height: 64px; }
.dm-queue-radio-track .dm-queue-track-name { font-size: 1.05rem; }
.dm-queue-description { color: ${theme.textDim}; font-size: 0.85rem; line-height: 1.6; margin: 1.5rem 0 0; }
.dm-queue-secondary { padding: 0.75rem 1.1rem; border-top: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
.dm-queue-secondary .dm-queue-action { width: fit-content; }
.dm-queue-message { margin: auto; padding: 1.5rem; text-align: center; color: ${theme.textDim}; font-size: 0.9rem; }
.dm-queue-message .dm-queue-action { margin-top: 1rem; }
@media (max-width: 540px) {
  .dm-queue-modal .dm-queue-dialog.DialogContent { inset-inline: 1rem; width: auto; max-width: none; }
}
@media (max-height: 380px) {
  .dm-queue-modal .dm-queue-dialog.DialogContent { top: 32px; bottom: 36px; }
  .dm-queue-header { padding-block: 0.5rem; }
}
`;
