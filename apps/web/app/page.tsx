import LeadSearchForm from "@/components/lead-search-form";
import LanguageToggle from "@/components/language-toggle";
import ThemeToggle from "@/components/theme-toggle";
import { I18nProvider } from "@/lib/i18n";

export default function Home() {
  return (
    <I18nProvider>
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-grid">
            <div className="topbar-brand">
              <div className="topbar-brand-icon" aria-hidden="true">
                8
              </div>
              <div className="topbar-brand-lockup">
                <div className="topbar-brand-title">the8bureau</div>
                <div className="topbar-brand-tool">MAPS LEAD EXTRACTOR</div>
                <div className="topbar-brand-tagline">
                  <span>Extractor de leads de Google Maps.</span>{" "}
                  <span>100% local.</span>
                </div>
              </div>
            </div>
            <div className="topbar-actions">
              <ThemeToggle />
              <LanguageToggle />
              <a
                className="app-signature"
                href="https://tomaspero.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Compilado/Optimizado</span>
                <span className="app-signature-name">por Tomás Peró</span>
              </a>
            </div>
          </div>
        </header>

        <main className="content">
          <LeadSearchForm />
        </main>

        <footer className="app-footer">
          <a
            className="app-footer-link"
            href="https://tomaspero.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Compilado y optimizado por <span className="app-footer-name">Tomás Peró</span>
          </a>
        </footer>
      </div>
    </I18nProvider>
  );
}
