import "@fontsource/atkinson-hyperlegible/latin-400"
import "@fontsource/atkinson-hyperlegible/latin-700"
import "@fontsource/big-shoulders-stencil-display/latin-800"
import "@fontsource/big-shoulders-stencil-display/latin-900"
import "@fontsource/ibm-plex-mono/latin-500"
import "@fontsource/ibm-plex-mono/latin-600"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./styles/index.css"

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
