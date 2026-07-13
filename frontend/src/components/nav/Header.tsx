import Link from "next/link";
import { Github, Linkedin, ExternalLink, GraduationCap } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex min-h-14 w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 sm:flex-nowrap sm:px-6 sm:py-0">
        <Link href="/" className="group flex items-center gap-3">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-md border border-brand-700/60 bg-brand-700/15">
            <span className="absolute inset-0 rounded-md bg-brand-600/15 blur-md transition-opacity group-hover:opacity-100" />
            <span className="relative font-mono text-[11px] font-semibold tracking-tight text-brand-400">
              UW
            </span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">
              UW Copilot
            </span>
            <span className="hidden font-mono text-2xs text-ink-dim lg:block">
              Julio Contreras · agentic AI portfolio
            </span>
          </div>
        </Link>

        <nav className="order-3 flex w-full items-center justify-between gap-1 overflow-x-auto text-xs sm:order-none sm:w-auto sm:justify-start sm:text-sm">
          <NavLink href="/">Overview</NavLink>
          <NavLink href="/architecture">Architecture</NavLink>
          <NavLink href="/pipeline">Pipeline</NavLink>
          <NavLink href="/chat">Live demo</NavLink>
        </nav>

        <div className="flex shrink-0 items-center gap-3 text-ink-muted">
          <a
            className="hover:text-ink"
            href="https://github.com/Juliorodrigo23"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub"
          >
            <Github size={16} />
          </a>
          <a
            className="hover:text-ink"
            href="https://www.linkedin.com/in/juliooocon/"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="LinkedIn"
          >
            <Linkedin size={16} />
          </a>
          <a
            className="hover:text-ink"
            href="https://scholar.google.com/citations?user=UvH6Ua4AAAAJ"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Google Scholar"
            title="Google Scholar"
          >
            <GraduationCap size={16} />
          </a>
          <a
            className="ml-2 hidden items-center gap-1 text-2xs font-mono text-ink-dim hover:text-ink-muted md:flex"
            href="https://juliooo.com"
            target="_blank"
            rel="noreferrer noopener"
          >
            juliooo.com <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="shrink-0 rounded px-2.5 py-1.5 text-ink-muted transition-colors hover:bg-bg-subtle hover:text-ink sm:px-3"
    >
      {children}
    </Link>
  );
}
