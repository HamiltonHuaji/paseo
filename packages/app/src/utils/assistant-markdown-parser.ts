import MarkdownIt from "markdown-it";
import { configureMarkdownMath } from "@/components/markdown/configure-markdown-math";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = configureMarkdownMath(
    new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
    }),
  );
  const defaultValidateLink = parser.validateLink.bind(parser);

  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
