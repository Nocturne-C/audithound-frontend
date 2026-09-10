import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, AlertCircle } from "lucide-react";

export type ToastType = "success" | "info" | "error";

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type = "success", duration = 3000, onClose }: ToastProps) {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLeaving(true);
    }, duration - 200);

    const closeTimer = setTimeout(() => {
      onClose();
    }, duration);

    return () => {
      clearTimeout(timer);
      clearTimeout(closeTimer);
    };
  }, [duration, onClose]);

  const renderIcon = () => {
    switch (type) {
      case "success":
        return <CheckCircle2 size={16} />;
      case "error":
        return <AlertCircle size={16} />;
      default:
        return <Info size={16} />;
    }
  };

  return (
    <div className={`toast is-${type} ${isLeaving ? "is-leaving" : ""}`} role="alert">
      <div className="toast-icon">{renderIcon()}</div>
      <div className="toast-message">{message}</div>
      <button 
        className="toast-close" 
        onClick={() => { 
          setIsLeaving(true); 
          setTimeout(onClose, 200); 
        }} 
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastWrapperProps {
  toasts: Array<{ id: string; message: string; type: ToastType }>;
  onRemove: (id: string) => void;
}

export function ToastWrapper({ toasts, onRemove }: ToastWrapperProps) {
  return (
    <div className="toast-wrapper">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
}
