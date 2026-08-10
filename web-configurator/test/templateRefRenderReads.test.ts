// Source guard: no component may read a template ref during its own render.
//
// A template ref written into a render-time binding —
//
//   v-show="elChild && elChild.isActive()"
//
// — makes the parent's render depend on the child *instance*, not just on the
// state it wants. If that child ever fails to mount, Vue does not commit the
// subtree, so the next render creates it again; mounting writes the template
// ref; writing the ref invalidates the parent's render; which creates the child
// again. The screen locks up with "Maximum recursive updates exceeded" and, via
// the app-wide error handler, one error toast per round. It cost us the whole
// activity editor once (see test/interfacesPanelResilience.test.ts), and the
// same shape sat in the navbar — on every screen — in settings and in the
// devices list.
//
// The state belongs in an event the child emits and the parent keeps in a ref.
// Template refs are still fine for imperative calls from script (`open()`,
// `checkForUpdate()`) and from event handlers; neither runs during render.
//
// This is a whole-source scan rather than a per-component test because the
// defect is a shape, not a place: it can reappear in any of the templates. It
// only catches the direct form; a computed that reads `someRef.value` and is
// then used in a binding is the same hazard one hop further out.
import { describe, it, expect } from "vitest";

const sources = import.meta.glob("/src/**/*.vue", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** `name="value"`, values may span lines. */
const ATTRIBUTE = /([@:]?[\w.\-[\]]+)\s*=\s*"([^"]*)"/gs;
const INTERPOLATION = /\{\{(.*?)\}\}/gs;
const TEMPLATE_REF = /const\s+(\w+)\s*=\s*\n?\s*useTemplateRef/g;

function matches(pattern: RegExp, input: string): RegExpExecArray[] {
  const regex = new RegExp(pattern.source, pattern.flags);
  const all: RegExpExecArray[] = [];
  let match = regex.exec(input);
  while (match !== null) {
    all.push(match);
    match = regex.exec(input);
  }
  return all;
}

function renderTimeReads(file: string, source: string): string[] {
  const refs = matches(TEMPLATE_REF, source).map((m) => m[1]);
  if (refs.length === 0) {
    return [];
  }
  const template = /<template>(.*)<\/template>/s.exec(source);
  if (!template) {
    return [];
  }
  const body = template[1];
  const firstLine = source.slice(0, template.index).split("\n").length;

  const found: string[] = [];
  const record = (expression: string, at: number, binding: string) => {
    for (const ref of refs) {
      if (new RegExp(`\\b${ref}\\b`).test(expression)) {
        const line = firstLine + body.slice(0, at).split("\n").length - 1;
        found.push(`${file}:${line} ${binding}= reads ${ref}`);
      }
    }
  };

  for (const attribute of matches(ATTRIBUTE, body)) {
    const [, name, value] = attribute;
    // Handlers and the `ref="…"` declaration itself do not run during render;
    // static attributes are not expressions at all.
    if (name.startsWith("@") || name.startsWith("v-on") || name === "ref") {
      continue;
    }
    if (!name.startsWith(":") && !name.startsWith("v-")) {
      continue;
    }
    record(value, attribute.index, name);
  }
  for (const interpolation of matches(INTERPOLATION, body)) {
    record(interpolation[1], interpolation.index, "{{ }}");
  }
  return found;
}

describe("template refs are never read during render", () => {
  it("finds no component reading its own template ref from a binding", () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(100);

    const reads = files.flatMap((file) => renderTimeReads(file, sources[file]));

    expect(reads).toEqual([]);
  });
});
