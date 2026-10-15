import { Link, Route, Switch, useRoute } from "wouter"
import { EXPLORER } from "../core/arkiv"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { BackendProvider, useBackend } from "./lib/backend"
import { REPO_URL } from "./lib/config"
import { BoardProvider } from "./lib/store"
import Authority from "./pages/Authority"
import Board from "./pages/Board"
import Camp from "./pages/Camp"
import Donor from "./pages/Donor"
import NeedPage from "./pages/NeedPage"

const NAV = [
  ["/", "Board"],
  ["/camp", "I run a camp"],
  ["/donate", "I’m donating"],
  ["/authority", "District office"],
] as const

function NavLink({ to, children }: { to: string; children: string }) {
  const [active] = useRoute(to === "/" ? "/" : `${to}/*?`)
  return (
    <Link href={to} className="nav__link" aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const backend = useBackend()
  return (
    <>
      {backend.mode === "memory" && <p className="dev-banner">Development preview · in-memory chain, not Arkiv</p>}
      <header className="masthead">
        <Link href="/" className="brand" aria-label="AbhiChahiye, home">
          <span className="brand__hi" lang="hi">
            अभी चाहिए
          </span>
          <span className="brand__en">AbhiChahiye</span>
        </Link>
        <p className="masthead__tag">Relief needs that cannot go stale</p>
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="tape" aria-hidden="true" />
      <main>{children}</main>
      <footer className="footer">
        <p>
          Built on <a href="https://arkiv.network">Arkiv</a>, the Web3 database, on the Tiramisu testnet. AbhiChahiye keeps no database of its own: this page, the command line and any app you build read the same Arkiv
          entities. Two small helpers on this site only hand out test GLM and pass read queries along when the public endpoint is busy. All demo data is synthetic and labelled (demo).
        </p>
        <p className="footer__links">
          <a href={`${REPO_URL}/blob/main/arkiv/schema.md`}>Data contract</a>
          <a href={`${REPO_URL}/blob/main/arkiv/friction.md`}>Friction report</a>
          <a href={REPO_URL}>Source (MIT)</a>
          <a href={EXPLORER}>Block explorer</a>
        </p>
      </footer>
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BackendProvider>
        <BoardProvider>
          <Shell>
            <Switch>
              <Route path="/" component={Board} />
              <Route path="/n/:key">{(params) => <NeedPage needKey={params.key} />}</Route>
              <Route path="/camp" component={Camp} />
              <Route path="/donate" component={Donor} />
              <Route path="/authority" component={Authority} />
              <Route>
                <section className="page">
                  <h1 className="page__title">Page not found</h1>
                  <Link href="/" className="btn">
                    Back to the board
                  </Link>
                </section>
              </Route>
            </Switch>
          </Shell>
        </BoardProvider>
      </BackendProvider>
    </ErrorBoundary>
  )
}
