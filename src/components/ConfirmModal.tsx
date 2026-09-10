import React, { useEffect, useRef } from "react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}

export const ConfirmModal = React.memo(function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
}: ConfirmModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        cancelBtnRef.current?.focus();
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onCancel();
        } else if (e.key === "Tab") {
          const cancelBtn = cancelBtnRef.current;
          const confirmBtn = confirmBtnRef.current;
          if (!cancelBtn || !confirmBtn) return;

          if (e.shiftKey) {
            // Shift + Tab
            if (document.activeElement === cancelBtn) {
              e.preventDefault();
              confirmBtn.focus();
            }
          } else {
            // Tab
            if (document.activeElement === confirmBtn) {
              e.preventDefault();
              cancelBtn.focus();
            }
          }
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div id="confirm-modal-title" className="modal-title">{title}</div>
        <div className="modal-body">{message}</div>
        <div className="modal-actions">
          <button
            ref={cancelBtnRef}
            className="button secondary"
            onClick={onCancel}
            type="button"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            className="button primary"
            onClick={onConfirm}
            type="button"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
});
