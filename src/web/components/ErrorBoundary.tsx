import { Component, type ErrorInfo, type ReactNode } from "react"

type State = { error: Error | undefined }

// Anyone can write to Arkiv. Readers check every entity's shape, but if something on screen still fails to render,
// say so and offer a way out instead of leaving a blank page.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: undefined }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render failed", error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="page" role="alert">
        <h1 className="page__title">Something here could not be shown</h1>
        <p className="page__lede">{this.state.error.message}</p>
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              localStorage.removeItem("abhichahiye:district")
              window.location.assign("/")
            }}
          >
            Back to the default board
          </button>
        </div>
      </section>
    )
  }
}
