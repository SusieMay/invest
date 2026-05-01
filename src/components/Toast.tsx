import { useEffect } from 'react'

export type ToastType = 'error' | 'success'

interface ToastProps {
  message: string
  type?: ToastType
  onClose: () => void
  /** Czas do automatycznego zamknięcia w ms. */
  duration?: number
}

/** Lekki, samozamykający się komunikat (toast) w prawym dolnym rogu. */
export default function Toast({ message, type = 'error', onClose, duration = 4000 }: ToastProps) {
  useEffect(() => {
    const id = setTimeout(onClose, duration)
    return () => clearTimeout(id)
  }, [onClose, duration])

  const isError = type === 'error'
  const accent = isError ? '#A83232' : '#2D6A4F'

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-[60] max-w-sm flex items-start gap-3 bg-[#EAE8E0] border border-dotted rounded-sm px-4 py-3 shadow-sm"
      style={{ borderColor: accent }}
    >
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        {isError ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        )}
      </svg>
      <p className="text-sm text-[#33332D] flex-1">{message}</p>
      <button
        onClick={onClose}
        className="text-stone-400 hover:text-[#33332D] transition-colors flex-shrink-0"
        aria-label="Zamknij"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
