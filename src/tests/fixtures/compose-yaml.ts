/**
 * ⚠ TEST HELPER — reads the small YAML subset of deploy/import/compose.yaml (beta L2) so the
 * static tests can check the import specification without a YAML dependency: block maps by
 * two-space indentation, block lists ("- x"), flow lists ("[a, "b"]"), "{}", quoted and plain
 * scalars, comments. Anything else is an error — never a silent misreading.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  number: number;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(line[index - 1]!))) return line.slice(0, index);
  }
  return line;
}

function scalar(raw: string, number: number): YamlValue {
  const text = raw.trim();
  if (text === "{}") return {};
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new Error(`compose.yaml:${number}: ufuldstændig liste`);
    const inner = text.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((part) => scalar(part, number));
  }
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  // Plain scalars: braces only in a compose interpolation "${NAME:?}".
  if (/[{}[\]]/.test(text.replace(/\$\{[A-Z0-9_]+(?::\?)?\}/g, ""))) throw new Error(`compose.yaml:${number}: ikke understøttet: ${text}`);
  if (text === "true" || text === "false") return text === "true";
  if (text === "null" || text === "~") return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

function block(lines: Line[], start: number, indent: number): { value: YamlValue; next: number } {
  const first = lines[start];
  if (!first || first.indent < indent) return { value: null, next: start };
  if (first.text.startsWith("- ")) {
    const list: YamlValue[] = [];
    let index = start;
    while (index < lines.length && lines[index]!.indent === indent && lines[index]!.text.startsWith("- ")) {
      list.push(scalar(lines[index]!.text.slice(2), lines[index]!.number));
      index += 1;
    }
    return { value: list, next: index };
  }
  const map: { [key: string]: YamlValue } = {};
  let index = start;
  while (index < lines.length && lines[index]!.indent === indent) {
    const line = lines[index]!;
    const match = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line.text);
    if (!match) throw new Error(`compose.yaml:${line.number}: forventede "nøgle: værdi"`);
    const key = match[1]!;
    if (key in map) throw new Error(`compose.yaml:${line.number}: nøglen ${key} findes to gange`);
    if (match[2] !== undefined && match[2].trim() !== "") {
      map[key] = scalar(match[2], line.number);
      index += 1;
    } else {
      const child = lines[index + 1];
      if (child && child.indent > indent) {
        const nested = block(lines, index + 1, child.indent);
        map[key] = nested.value;
        index = nested.next;
      } else {
        map[key] = null;
        index += 1;
      }
    }
  }
  if (index < lines.length && lines[index]!.indent > indent) throw new Error(`compose.yaml:${lines[index]!.number}: uventet indrykning`);
  return { value: map, next: index };
}

export function parseComposeYaml(text: string): { [key: string]: YamlValue } {
  const lines: Line[] = [];
  text.split("\n").forEach((raw, index) => {
    if (raw.includes("\t")) throw new Error(`compose.yaml:${index + 1}: tabulator`);
    const content = stripComment(raw).trimEnd();
    if (content.trim() === "") return;
    lines.push({ indent: content.length - content.trimStart().length, text: content.trim(), number: index + 1 });
  });
  const { value, next } = block(lines, 0, 0);
  if (next !== lines.length) throw new Error(`compose.yaml:${lines[next]!.number}: kunne ikke læses`);
  return value as { [key: string]: YamlValue };
}
