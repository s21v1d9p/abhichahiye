/// <reference types="vite/client" />

// Fontsource packages map "./latin-400" to a CSS file via their exports field; the import only injects @font-face rules.
declare module "@fontsource/*"
