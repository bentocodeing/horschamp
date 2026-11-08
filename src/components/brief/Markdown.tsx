import { Fragment, type ReactNode } from "react";

/** Remove ```shotlist blocks (and json blocks that hold shots). Returns text and whether one was found. */
export function stripShotList(text: string): { text: string; hadShots: boolean } {
  let hadShots = false;
  const out = text.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang: string, body: string) => {
    if (lang === "shotlist" || (lang === "json" && body.includes('"model_id"'))) {
      hadShots = true;
      return "";
    }
    return m;
  });
  return { text: out.trim(), hadShots };
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**"))
      parts.push(
        <strong key={k++} className="font-semibold text-text-1">
          {t.slice(2, -2)}
        </strong>,
      );
    else if (t.startsWith("`"))
      parts.push(
        <code key={k++} className="rounded-[5px] bg-fill-2 px-1 py-px font-mono text-[12px] text-text-1">
          {t.slice(1, -1)}
        </code>,
      );
    else {
      const label = t.slice(1, t.indexOf("]"));
      parts.push(
        <span key={k++} className="text-accent underline-offset-2">
          {label}
        </span>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Small markdown subset: paragraphs, headings, ordered/bullet lists, code blocks, **bold**, `code`. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre
          key={key++}
          className="selectable overflow-x-auto rounded-xl bg-surface p-3 font-mono text-[12px] leading-relaxed text-text-2"
        >
          {body.join("\n")}
        </pre>,
      );
      continue;
    }
    if (/^\s*(\d+[.)]|[-*•])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*(\d+[.)]|[-*•])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(\d+[.)]|[-*•])\s+/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag
          key={key++}
          className={
            ordered ? "list-decimal space-y-1 pl-5 text-[#c9cacc]" : "list-disc space-y-1 pl-5 text-[#c9cacc]"
          }
        >
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <div key={key++} className="pt-1 text-[14px] font-semibold text-text-1">
          {inline(h[2])}
        </div>,
      );
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^\s*(\d+[.)]|[-*•])\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="selectable flex flex-col gap-2.5 leading-relaxed">{blocks}</div>;
}
