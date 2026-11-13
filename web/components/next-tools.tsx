import Link from "next/link";
import { nextTools, TOOLS, type ToolId } from "@/lib/tools";

/** After a result: the other methods that make sense next, chosen from how this one went. */
export function NextTools({ current, verdict }: { current: ToolId; verdict?: string }) {
  const picks = nextTools(current, verdict);
  return (
    <section className="next-tools" aria-labelledby={`next-${current}`}>
      <div className="next-tools-head">
        <h2 id={`next-${current}`}>Keep testing this setup</h2>
        <p>Same service, same model, a different question.</p>
      </div>
      <ul>
        {picks.map(({ id, why }) => {
          const t = TOOLS[id];
          return (
            <li key={id}>
              <Link href={t.href} className="next-tool">
                <span className="next-tool-group">{t.group}</span>
                <strong>{t.name}</strong>
                <span className="next-tool-why">{why}</span>
                <span className="next-tool-go" aria-hidden="true">
                  Open
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
