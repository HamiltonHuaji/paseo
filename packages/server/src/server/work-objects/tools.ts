import { z } from "zod";
import {
  WorkListCardsSchema,
  WorkListItemsSchema,
  WorkGetCardSchema,
  WorkGetItemSchema,
  WorkCreateCardSchema,
  WorkCreateItemSchema,
  WorkUpdateCardSchema,
  WorkUpdateItemSchema,
} from "@getpaseo/protocol/work-objects";
import type { PaseoToolDefinition, PaseoToolResult } from "../agent/tools/types.js";
import type { WorkService } from "./service.js";
import { WorkError } from "./store.js";

interface WorkToolsOptions {
  service: WorkService;
  projectId: () => Promise<string>;
  callerAgentId?: string;
}

const VIEWER_GUIDANCE =
  " Viewer entries are optional, curated destinations for users; mounts/sources need no entries. Keep raw files in storage, settings/paths in Config, and outcomes in Result. In chat, link to an entry's href verbatim; path is an internal HTTP path, not a chat link.";

export function createWorkTools(options: WorkToolsOptions): PaseoToolDefinition[] {
  const { service, projectId, callerAgentId } = options;
  function tool<T>(
    name: string,
    description: string,
    schema: z.ZodType<T>,
    execute: (project: string, input: T) => Promise<unknown>,
  ): PaseoToolDefinition {
    return {
      name,
      description,
      inputSchema: schema,
      async handler(raw): Promise<PaseoToolResult> {
        try {
          const input = schema.parse(raw);
          const result = await execute(await projectId(), input);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          if (!(error instanceof WorkError)) throw error;
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: { code: error.code, message: error.message } }),
              },
            ],
          };
        }
      },
    };
  }
  return [
    tool(
      "list_cards",
      "Find Works cards in the current project. Returns one page of complete IDs, titles and bodies; do not traverse every page automatically.",
      WorkListCardsSchema,
      (project, input) => service.listCards(project, input),
    ),
    tool(
      "get_card",
      "Read one Works card. Select components or storage explicitly. Items are only included when requested, one page at a time. Use viewerEntries.entries[].href for clickable chat links.",
      WorkGetCardSchema,
      (project, input) => service.getCard(project, input),
    ),
    tool(
      "create_card",
      "Create an experiment or topic card, optionally with initial items and components. Returns allocated storage and viewer entry points." +
        VIEWER_GUIDANCE,
      WorkCreateCardSchema,
      (project, input) => service.createCard(project, input, callerAgentId),
    ),
    tool(
      "update_card",
      "Update a Works card. Omitted fields stay unchanged. Null removes a component. Sessions use add/remove; viewers patch keys; Result patches fields; other components replace." +
        VIEWER_GUIDANCE,
      WorkUpdateCardSchema,
      (project, input) => service.updateCard(project, input, callerAgentId),
    ),
    tool(
      "list_items",
      "Find items within one known card. Parent card ID is required; use list_cards first when the parent is unknown.",
      WorkListItemsSchema,
      (project, input) => service.listItems(project, input),
    ),
    tool(
      "get_item",
      "Read one Works item by its ID, selecting components or storage as needed. No parent ID is required. Use viewerEntries.entries[].href for clickable chat links.",
      WorkGetItemSchema,
      (project, input) => service.getItem(project, input),
    ),
    tool(
      "create_item",
      "Create an attempt or issue under a card, with optional components. Experimental runs, retries and resumes each get a new attempt; ongoing development can reuse an issue." +
        VIEWER_GUIDANCE,
      WorkCreateItemSchema,
      (project, input) => service.createItem(project, input, callerAgentId),
    ),
    tool(
      "update_item",
      "Update an item by its ID. Result.completed records completion and its time. Updating an item touches its parent too; linked Sessions stay explicit." +
        VIEWER_GUIDANCE,
      WorkUpdateItemSchema,
      (project, input) => service.updateItem(project, input, callerAgentId),
    ),
  ];
}
