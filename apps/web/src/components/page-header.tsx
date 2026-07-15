import Link from "next/link";
import type { ReactNode } from "react";

export type Breadcrumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs = [],
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: Breadcrumb[];
}) {
  return (
    <header className="page-header">
      {breadcrumbs.length ? (
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((breadcrumb, index) => (
              <li key={`${breadcrumb.label}-${index}`}>
                {breadcrumb.href ? (
                  <Link href={breadcrumb.href}>{breadcrumb.label}</Link>
                ) : (
                  <span aria-current="page">{breadcrumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="page-header__content">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
