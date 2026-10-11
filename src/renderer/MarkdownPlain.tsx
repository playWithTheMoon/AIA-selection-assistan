import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Bare renderer without the code-copy button: screenshot preview keeps its
// plain output by design — action/chat windows use MarkdownView instead.
export default function MarkdownPlain({ children }: { children: string }) {
  return <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
}
