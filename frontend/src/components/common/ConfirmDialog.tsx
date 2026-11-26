import React from 'react';
import Modal from './Modal';
import Button from './Button';
import { AlertTriangle, Info } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="sm">
      <div className="flex flex-col items-center text-center">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${
            variant === 'danger'
              ? 'bg-red-50 text-red-600 border border-red-100'
              : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
          }`}
        >
          {variant === 'danger' ? <AlertTriangle size={24} /> : <Info size={24} />}
        </div>

        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">{message}</p>

        <div className="flex items-center gap-2.5 w-full mt-6">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
            className="flex-1"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
            }}
            loading={loading}
            className="flex-1"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
