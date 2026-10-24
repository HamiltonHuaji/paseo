import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../server/atomic-file.js";
import type { Task, TaskStatus } from "./types.js";

interface Span {
  start: number;
  end: number;
}
interface Line extends Span {
  text: string;
}
interface Section extends Span {
  name: string;
  contentStart: number;
}
interface Entry<T> extends Span {
  value: T;
}
interface Edit extends Span {
  text: string;
}

function lines(content: string, offset = 0): Line[] {
  return Array.from(content.matchAll(/[^\n]*(?:\n|$)/g))
    .filter((match) => match[0].length > 0)
    .map((match) => ({
      start: offset + match.index,
      end: offset + match.index + match[0].length,
      text: match[0].replace(/\r?\n$/, ""),
    }));
}

function markdownLines(content: string, offset = 0): Line[] {
  let fence: string | undefined;
  return lines(content, offset).filter((line) => {
    const marker = line.text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!marker) return !fence;
    if (!fence) fence = marker[1];
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
    return false;
  });
}

function layout(content: string) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new Error("Invalid task file: missing frontmatter");
  const bodyStart = frontmatter[0].length;
  const frontmatterStart = content.indexOf("\n") + 1;
  const frontmatterEnd = frontmatterStart + frontmatter[1].length;
  const headings: Array<Section> = [];
  for (const line of markdownLines(content.slice(bodyStart), bodyStart)) {
    const heading = line.text.match(/^#{1,2} +(.+?) *#* *$/);
    if (!heading) continue;
    if (headings.length) headings[headings.length - 1].end = line.start;
    headings.push({
      name: heading[1],
      start: line.start,
      contentStart: line.end,
      end: content.length,
    });
  }
  const sections = headings.filter((heading) => content.slice(heading.start).startsWith("## "));
  const firstSection = sections.find(
    (section) => section.name === "Acceptance Criteria" || section.name === "Notes",
  );
  return {
    frontmatter: lines(frontmatter[1], frontmatterStart),
    frontmatterEnd,
    body: { start: bodyStart, end: firstSection?.start ?? content.length },
    sections,
    eol: content.includes("\r\n") ? "\r\n" : "\n",
  };
}

function criteriaEntries(content: string, section: Section | undefined): Array<Entry<string>> {
  if (!section) return [];
  return markdownLines(
    content.slice(section.contentStart, section.end),
    section.contentStart,
  ).flatMap((line) => {
    const match = line.text.match(/^- \[[ xX]\] (.+)$/);
    return match ? [{ ...line, value: match[1].trim() }] : [];
  });
}

function noteEntries(
  content: string,
  section: Section | undefined,
): Array<Entry<Task["notes"][number]>> {
  if (!section) return [];
  const source = content.slice(section.contentStart, section.end);
  const visible = new Set(markdownLines(source).map((line) => line.start));
  // Future timestamp formats delimit opaque notes too; deleting a known note must
  // not absorb the next note merely because this reader cannot understand it.
  const markers = Array.from(
    source.matchAll(/^\*\*(\d{4}-\d{2}-\d{2}T[^\r\n]*?)\*\*\r?\n(?:\r?\n)?/gm),
  ).filter((marker) => visible.has(marker.index));
  return markers.flatMap((marker, index) => {
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.Z]+$/.test(marker[1]) || !/\r?\n\r?\n$/.test(marker[0]))
      return [];
    const end = section.contentStart + (markers[index + 1]?.index ?? source.length);
    const start = section.contentStart + marker.index;
    return [
      {
        start,
        end,
        value: {
          timestamp: marker[1],
          content: content.slice(start + marker[0].length, end).trim(),
        },
      },
    ];
  });
}

function parseTask(content: string, createdFallback = new Date().toISOString()): Task {
  const document = layout(content);
  const getValue = (key: string): string => {
    const line = document.frontmatter.find((candidate) => candidate.text.startsWith(`${key}:`));
    return line?.text.slice(key.length + 1).trim() ?? "";
  };
  const depsMatch = getValue("deps").match(/^\[(.*)\]$/);
  const priorityStr = getValue("priority");
  return {
    id: getValue("id"),
    title: getValue("title"),
    status: getValue("status") as TaskStatus,
    deps: depsMatch
      ? depsMatch[1]
          .split(",")
          .map((dep) => dep.trim())
          .filter(Boolean)
      : [],
    parentId: getValue("parentId") || undefined,
    body: content.slice(document.body.start, document.body.end).trim(),
    acceptanceCriteria: criteriaEntries(
      content,
      document.sections.find((section) => section.name === "Acceptance Criteria"),
    ).map((entry) => entry.value),
    notes: noteEntries(
      content,
      document.sections.find((section) => section.name === "Notes"),
    ).map((entry) => entry.value),
    created: getValue("created") || createdFallback,
    assignee: getValue("assignee") || undefined,
    priority: priorityStr ? parseInt(priorityStr, 10) : undefined,
    raw: content,
  };
}

function frontmatterValues(task: Task): Record<string, string | undefined> {
  const values = {
    id: task.id,
    title: task.title,
    status: task.status,
    deps: `[${task.deps.join(", ")}]`,
    created: task.created,
    parentId: task.parentId || undefined,
    assignee: task.assignee || undefined,
    priority: task.priority === undefined ? undefined : String(task.priority),
  };
  for (const value of Object.values(values)) {
    if (value?.match(/[\r\n]/)) throw new Error("Task frontmatter values must fit on one line");
  }
  return values;
}

function serializeTask(task: Task): string {
  const fields = Object.entries(frontmatterValues(task))
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  const criteria = task.acceptanceCriteria.length
    ? `\n## Acceptance Criteria\n\n${task.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}\n`).join("")}`
    : "";
  const notes = task.notes.length
    ? `\n## Notes\n${task.notes.map((note) => `\n**${note.timestamp}**\n\n${note.content}\n`).join("")}`
    : "";
  return `---\n${fields.join("\n")}\n---\n\n${task.body ? `${task.body}\n` : ""}${criteria}${notes}`;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Replace only understood entry spans; prose between entries and other sections stays verbatim. */
function editEntries<T>(
  content: string,
  entries: Array<Entry<T>>,
  next: T[],
  render: (value: T) => string,
  insertion: number,
): Edit[] {
  const unused = new Set(entries.map((_, index) => index));
  const replacements = next.map((value) => {
    const index = [...unused].find((candidate) => same(entries[candidate].value, value));
    if (index === undefined) return render(value);
    unused.delete(index);
    return content.slice(entries[index].start, entries[index].end);
  });
  const edits = entries.map((entry, index) => ({
    start: entry.start,
    end: entry.end,
    text: replacements[index] ?? "",
  }));
  const extra = replacements.slice(entries.length).join("");
  if (extra) edits.push({ start: insertion, end: insertion, text: extra });
  return edits;
}

function editFrontmatter(document: ReturnType<typeof layout>, previous: Task, task: Task): Edit[] {
  const eol = document.eol;
  const edits: Edit[] = [];
  const oldFields = frontmatterValues(previous);
  const fields = frontmatterValues(task);
  const addedFields: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === oldFields[key]) continue;
    const matches = document.frontmatter.filter((line) => line.text.startsWith(`${key}:`));
    if (matches.length > 1) throw new Error(`Cannot edit duplicate task frontmatter key: ${key}`);
    const line = matches[0];
    if (!line) {
      if (value !== undefined) addedFields.push(`${key}: ${value}`);
      continue;
    }
    const original = line.text.slice(key.length + 1).trim();
    const following = document.frontmatter.find((candidate) => candidate.start === line.end);
    if (
      /^[>|]/.test(original) ||
      (original === "" && following?.text.match(/^\s+\S/)) ||
      (key === "deps" && !/^\[.*\]$/.test(original))
    ) {
      throw new Error(`Cannot edit unsupported task frontmatter value: ${key}`);
    }
    // The final frontmatter line's newline is outside the captured content.
    edits.push({
      start: line.start,
      end: line.end,
      text:
        value === undefined
          ? ""
          : `${key}: ${value}${line.end > line.start + line.text.length ? eol : ""}`,
    });
  }
  if (addedFields.length)
    edits.push({
      start: document.frontmatterEnd,
      end: document.frontmatterEnd,
      text: `${eol}${addedFields.join(eol)}`,
    });
  return edits;
}

function updateTask(task: Task): string {
  const content = task.raw;
  const previous = parseTask(content, task.created);
  if (!previous.id || previous.id !== task.id)
    throw new Error("Invalid task file: task ID changed or missing");
  const document = layout(content);
  const eol = document.eol;
  const edits = editFrontmatter(document, previous, task);
  if (task.body !== previous.body)
    edits.push({
      ...document.body,
      text: `${eol}${task.body ? `${task.body.replace(/\r?\n/g, eol)}${eol}${eol}` : ""}`,
    });
  let appended = "";
  const changeSection = <T>(
    name: string,
    entries: Array<Entry<T>>,
    before: T[],
    next: T[],
    render: (value: T) => string,
  ) => {
    if (same(before, next)) return;
    const sections = document.sections.filter((section) => section.name === name);
    if (sections.length > 1) throw new Error(`Cannot edit duplicate task section: ${name}`);
    const section = sections[0];
    if (!section) {
      if (next.length) appended += `${eol}## ${name}${eol}${eol}${next.map(render).join("")}`;
      return;
    }
    const insertion = entries.at(-1)?.end ?? section.end;
    const sectionEdits = editEntries(content, entries, next, render, insertion);
    for (const edit of sectionEdits) {
      if (
        edit.start === edit.end &&
        edit.text &&
        edit.start > 0 &&
        content[edit.start - 1] !== "\n"
      )
        edit.text = eol + edit.text;
    }
    edits.push(...sectionEdits);
  };
  changeSection(
    "Acceptance Criteria",
    criteriaEntries(
      content,
      document.sections.find((section) => section.name === "Acceptance Criteria"),
    ),
    previous.acceptanceCriteria,
    task.acceptanceCriteria,
    (criterion) => `- [ ] ${criterion}${eol}`,
  );
  changeSection(
    "Notes",
    noteEntries(
      content,
      document.sections.find((section) => section.name === "Notes"),
    ),
    previous.notes,
    task.notes,
    (note) => `**${note.timestamp}**${eol}${eol}${note.content.replace(/\r?\n/g, eol)}${eol}${eol}`,
  );
  if (appended)
    edits.push({
      start: content.length,
      end: content.length,
      text: (content.endsWith("\n") ? "" : eol) + appended,
    });
  // Insertions at a span's end precede its replacement when applying edits backwards.
  edits.sort((left, right) => right.start - left.start || right.end - left.end);
  let result = content;
  for (const edit of edits)
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

export async function readTaskDocument(filePath: string): Promise<Task> {
  return parseTask(await readFile(filePath, "utf-8"));
}

const pendingWrites = new Map<string, Promise<void>>();

export async function writeTaskDocument(filePath: string, task: Task): Promise<void> {
  const content = task.raw ? updateTask(task) : serializeTask(task);
  const expected = task.raw || undefined;
  const write = (pendingWrites.get(filePath) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      let existing: string | undefined;
      try {
        existing = await readFile(filePath, "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (existing !== expected)
        throw new Error("Task file changed since it was read; reload before saving");
      return writeFileAtomic(filePath, content);
    });
  pendingWrites.set(filePath, write);
  try {
    await write;
  } finally {
    if (pendingWrites.get(filePath) === write) pendingWrites.delete(filePath);
  }
}
