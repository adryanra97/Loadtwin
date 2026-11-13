import Link from "next/link";

type ToolPageIntroProps = {
  title: string;
  description: string;
  category: string;
};

/**
 * One reusable page introduction for all capacity-analysis workspaces.
 * Consistent hierarchy, breadcrumb, page spacing and explanatory copy.
 */
export function ToolPageIntro({ title, description, category }: ToolPageIntroProps) {
  return (
    <header className="xp-page-intro">
      <nav className="xp-breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Overview</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{title}</span>
      </nav>
      <div className="xp-page-heading">
        <span className="xp-eyebrow">{category}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
