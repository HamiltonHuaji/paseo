import { tex } from "@mdit/plugin-tex";
import type MarkdownIt from "markdown-it";

export function configureMarkdownMath(parser: MarkdownIt): MarkdownIt {
  parser.use(tex, {
    delimiters: "all",
    mathFence: false,
    allowInlineWithSpace: false,
    // react-native-markdown-display consumes parse() tokens rather than the
    // HTML returned by markdown-it's renderer. Keep this mandatory callback
    // inert and escaped in case this parser is ever passed to render().
    render: (content) => parser.utils.escapeHtml(content),
  });

  return parser;
}
