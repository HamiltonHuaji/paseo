import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import React, { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import type { PendingPermission } from "@/types/shared";
import { QuestionFormCard } from "./question-form-card";
import {
  AssistantFileLinkResolverProvider,
  type AssistantFileLinkResolverConfig,
} from "@/assistant-file-links/provider";

// Navigation is outside this form's boundary; keep the real Markdown and input engines.
vi.mock("@/viewers/use-open-viewer", () => ({ useOpenViewer: () => vi.fn() }));
vi.mock("@/contexts/toast-context", () => import("@/contexts/toast-api-context"));
vi.mock("react-native-unistyles", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../test-stubs/react-native-unistyles")>();
  const { darkTheme: theme } = await import("@/styles/theme");
  return {
    ...original,
    withUnistyles: <P extends object>(Component: ComponentType<P>) => {
      return function WithTheme({
        uniProps,
        ...props
      }: P & { uniProps?: (value: typeof theme, runtime: { breakpoint: string }) => Partial<P> }) {
        return createElement(Component, {
          ...uniProps?.(theme, { breakpoint: "md" }),
          ...props,
        } as P);
      };
    },
  };
});

// Load translations so controls expose their real accessible names.
void testI18n;

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * A real browser with the real web `EditingTextInput`, because the bug under test lives in the
 * gap between that input and React state: the input owns its text and never replays state, so a
 * card that drops the Other text from state alone keeps showing it while submit ignores it.
 */

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];
const toast = { show: vi.fn(), copied: vi.fn(), error: vi.fn() };

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function buildPermission(question: Record<string, unknown>): PendingPermission {
  return {
    key: "perm-1",
    agentId: "agent-1",
    request: {
      id: "perm-1",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: { questions: [question] },
    },
  };
}

function mountCard(
  question: Record<string, unknown>,
  fileContext: AssistantFileLinkResolverConfig = {},
) {
  const onRespond = vi.fn<(response: AgentPermissionResponse) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastApiProvider api={toast}>
          <AssistantFileLinkResolverProvider {...fileContext}>
            <QuestionFormCard
              permission={buildPermission(question)}
              onRespond={onRespond}
              isResponding={false}
              responseError={null}
            />
          </AssistantFileLinkResolverProvider>
        </ToastApiProvider>
      </QueryClientProvider>,
    ),
  );
  mounted.push({ root, container });

  const view = within(container);
  const optionRole = question.multiSelect ? "checkbox" : "radio";
  const otherInput = () =>
    view.getByRole<HTMLInputElement>("textbox", {
      name: (name) =>
        name.replace(/\s+/g, " ").trim() === String(question.question).replace(/\s+/g, " ").trim(),
    });
  const check = (label: string) => act(() => view.getByRole(optionRole, { name: label }).click());
  const type = (text: string) => {
    const input = otherInput();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) throw new Error("HTML input value setter is unavailable");
    act(() => {
      valueSetter.call(input, text);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    });
  };
  const submit = () => act(() => view.getByRole("button", { name: "Submit" }).click());
  const submittedAnswers = (): Record<string, string> => {
    const response = onRespond.mock.calls[0]?.[0];
    if (!response || response.behavior !== "allow") throw new Error("card did not submit");
    return (response.updatedInput as { answers: Record<string, string> }).answers;
  };
  return { check, type, otherInput, submit, submittedAnswers, container, view };
}

const multiSelectQuestion = {
  question: "Which fruits do you like?",
  header: "Fruits",
  options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }],
  multiSelect: true,
  allowOther: true,
};

const singleSelectQuestion = {
  question: "Which provider?",
  header: "Provider",
  options: [{ label: "Claude Code" }, { label: "Codex" }],
  multiSelect: false,
  allowOther: true,
};

describe("QuestionFormCard other answers", () => {
  it("renders technical Markdown and host-local images while keeping the answer usable", async () => {
    const imageBytes = (color: string) =>
      new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="${color}"/></svg>`,
      );
    const readFile = (color: string) =>
      vi.fn(async () => ({
        kind: "image" as const,
        path: "/project/chart.svg",
        mime: "image/svg+xml",
        size: imageBytes(color).byteLength,
        modifiedAt: "2026-10-23T00:00:00.000Z",
        bytes: imageBytes(color),
      }));
    const readA = readFile("red");
    const readB = readFile("blue");
    const openViewer = vi.fn();
    const openFile = vi.fn();
    const question = {
      question:
        "Review $x^2$ and `result.ts`\n\n| Metric | Value |\n| --- | --- |\n| loss | 0.25 |\n\n```ts\nconst result = 42;\n```\n\n![chart](chart.svg)\n\n[Report](paseo://h/host-a/view/v2/project/card/files/report/index.html) and [Source](/project/result.ts:12)",
      header: "Review",
      options: [{ label: "Accept", description: "Use **this result** with $x=2$." }],
      allowOther: true,
    };
    const context = (serverId: string, read: typeof readA) => ({
      serverId,
      workspaceRoot: "/project",
      client: {
        readFile: read,
        getDirectorySuggestions: async () => ({ entries: [], error: null }),
      },
      onOpenViewer: openViewer,
      onOpenWorkspaceFile: openFile,
    });
    const a = mountCard(question, context("host-a", readA));
    const b = mountCard(question, context("host-b", readB));
    await vi.waitFor(() => {
      expect(a.container.querySelector("table")?.textContent).toContain("0.25");
      expect(a.container.querySelector(".katex")).not.toBeNull();
      expect(a.container.textContent).toContain("const result = 42;");
      expect(a.container.querySelector<HTMLImageElement>("img[alt=chart]")?.naturalWidth).toBe(24);
      expect(b.container.querySelector<HTMLImageElement>("img[alt=chart]")?.naturalWidth).toBe(24);
    });
    const imageA = a.container.querySelector<HTMLImageElement>("img[alt=chart]")!;
    const imageB = b.container.querySelector<HTMLImageElement>("img[alt=chart]")!;
    expect(await (await fetch(imageA.src)).text()).toContain('fill="red"');
    expect(await (await fetch(imageB.src)).text()).toContain('fill="blue"');
    expect(readA).toHaveBeenCalledWith("/project", "chart.svg");
    expect(readB).toHaveBeenCalledWith("/project", "chart.svg");
    act(() => a.view.getByRole("link", { name: "Report" }).click());
    await vi.waitFor(() =>
      expect(openViewer).toHaveBeenCalledWith({
        serverId: "host-a",
        path: "/view/v2/project/card/files/report/index.html",
      }),
    );
    act(() => a.view.getByRole("link", { name: "Source" }).click());
    await vi.waitFor(() =>
      expect(openFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/project/result.ts", lineStart: 12 }),
        "preferred",
      ),
    );
    a.check("Accept");
    a.submit();
    expect(a.submittedAnswers()).toEqual({ Review: "Accept" });
    b.type("Please revise the chart");
    b.submit();
    expect(b.submittedAnswers()).toEqual({ Review: "Please revise the chart" });
  });

  it("keeps checked options when the other answer is typed afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    card.check("Apple");
    card.check("Cherry");
    card.type("durian");
    card.submit();

    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Cherry, durian" });
  });

  it("keeps the typed other answer when options are checked afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    card.type("durian");
    card.check("Apple");
    card.check("Banana");

    expect(card.otherInput().value).toBe("durian");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Banana, durian" });
  });

  it("replaces the selected option with the typed other answer (single-select)", () => {
    const card = mountCard(singleSelectQuestion);

    card.check("Codex");
    card.type("OpenCode");
    card.submit();

    expect(card.submittedAnswers()).toEqual({ Provider: "OpenCode" });
  });

  it("clears the typed other answer on screen when an option is picked afterwards (single-select)", () => {
    const card = mountCard(singleSelectQuestion);

    card.type("OpenCode");
    card.check("Codex");

    expect(card.otherInput().value).toBe("");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Provider: "Codex" });
  });
});
