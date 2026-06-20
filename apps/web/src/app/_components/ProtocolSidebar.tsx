import Link from "next/link";

const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

type Section = { group: string; units: { id: string; title: string }[] };
type ShowcaseApp = { slug: string; name: string };

/**
 * Shared protocol sidebar (doc sections + showcase). Used both on the protocol
 * page and on the protocol-scoped app detail view, where `activeAppSlug`
 * highlights the showcased app. `sectionBase` lets the detail view link doc
 * sections back to the protocol page anchors instead of in-page `#` anchors.
 */
export function ProtocolSidebar({
  slug,
  sections,
  showcase,
  activeAppSlug,
  sectionBase = "",
}: {
  slug: string;
  sections: Section[];
  showcase: ShowcaseApp[];
  activeAppSlug?: string;
  sectionBase?: string;
}) {
  return (
    <aside className="sidebar">
      {sections.map((s) => (
        <div className="group" key={s.group}>
          <div className="group-title">{s.group}</div>
          <ul>
            {s.units.map((u) => (
              <li key={u.id}>
                <a href={`${sectionBase}#${anchor(u.title)}`}>{u.title}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {showcase.length > 0 && (
        <div className="group">
          <div className="group-title">Showcase</div>
          <ul>
            {showcase.map((a) => (
              <li key={a.slug} className={a.slug === activeAppSlug ? "active" : undefined}>
                <Link href={`/protocol/${slug}/app/${a.slug}`}>{a.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
