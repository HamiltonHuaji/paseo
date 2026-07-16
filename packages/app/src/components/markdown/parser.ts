import MarkdownIt from "markdown-it";
import { configureMarkdownMath } from "./configure-markdown-math";

interface CreateMarkdownParserOptions {
  allowFileLinks?: boolean;
}

export function createMarkdownParser({
  allowFileLinks = false,
}: CreateMarkdownParserOptions = {}): MarkdownIt {
  const parser = configureMarkdownMath(new MarkdownIt({ typographer: true, linkify: true }));

  if (allowFileLinks) {
    const defaultValidateLink = parser.validateLink.bind(parser);
    parser.validateLink = (url: string) => {
      if (url.trim().toLowerCase().startsWith("file://")) {
        return true;
      }

      return defaultValidateLink(url);
    };
  }

  return parser;
}
