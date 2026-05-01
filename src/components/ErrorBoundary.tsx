import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Opcjonalny własny fallback. */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

/** Łapie błędy renderowania w poddrzewie, aby nie wywalić całej aplikacji. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary złapał błąd:', error, info)
  }

  handleReset = () => this.setState({ hasError: false })

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <svg className="w-10 h-10 text-[#A83232]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
          <p className="text-sm text-stone-600 font-medium">Coś poszło nie tak podczas ładowania tej sekcji.</p>
          <button
            onClick={this.handleReset}
            className="text-xs font-medium bg-stone-700 text-[#F4F3ED] px-3 py-1.5 rounded-sm hover:bg-stone-800 transition-colors"
          >
            Spróbuj ponownie
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
