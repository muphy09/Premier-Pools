import { useEffect, useRef, useState } from 'react';
import {
  extractMessagePlainText,
  MESSAGE_BODY_MAX_LENGTH,
  sanitizeMessageHtml,
} from '../utils/messageRichText';
import './MessageUi.css';

type MessageRichTextEditorProps = {
  value: string;
  onChange: (html: string, plainText: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

type EditorCommand = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList';

const TOOLBAR_ITEMS: Array<{ command: EditorCommand; label: string; shortLabel: string }> = [
  { command: 'bold', label: 'Bold', shortLabel: 'B' },
  { command: 'italic', label: 'Italic', shortLabel: 'I' },
  { command: 'underline', label: 'Underline', shortLabel: 'U' },
  { command: 'insertUnorderedList', label: 'Bulleted list', shortLabel: '• List' },
  { command: 'insertOrderedList', label: 'Numbered list', shortLabel: '1. List' },
];

function MessageRichTextEditor({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
}: MessageRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastAcceptedHtmlRef = useRef(sanitizeMessageHtml(value));
  const [characterCount, setCharacterCount] = useState(() => extractMessagePlainText(value).length);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = sanitizeMessageHtml(value);
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
    lastAcceptedHtmlRef.current = nextHtml;
    setCharacterCount(extractMessagePlainText(nextHtml).length);
  }, [value]);

  useEffect(() => {
    if (autoFocus && !disabled) editorRef.current?.focus();
  }, [autoFocus, disabled]);

  const publishEditorValue = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const safeHtml = sanitizeMessageHtml(editor.innerHTML);
    const plainText = extractMessagePlainText(safeHtml);
    if (plainText.length > MESSAGE_BODY_MAX_LENGTH) {
      editor.innerHTML = lastAcceptedHtmlRef.current;
      return;
    }
    if (editor.innerHTML !== safeHtml) editor.innerHTML = safeHtml;
    lastAcceptedHtmlRef.current = safeHtml;
    setCharacterCount(plainText.length);
    onChange(safeHtml, plainText);
  };

  const runCommand = (command: EditorCommand) => {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false);
    publishEditorValue();
  };

  return (
    <div className={`message-editor${disabled ? ' is-disabled' : ''}`}>
      <div className="message-editor__toolbar" role="toolbar" aria-label="Message formatting">
        {TOOLBAR_ITEMS.map((item) => (
          <button
            key={item.command}
            type="button"
            className={`message-editor__tool message-editor__tool--${item.command}`}
            aria-label={item.label}
            title={item.label}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand(item.command)}
          >
            {item.shortLabel}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        className="message-editor__surface"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        data-placeholder="Write your message..."
        suppressContentEditableWarning
        onInput={publishEditorValue}
        onBlur={publishEditorValue}
      />
      <div className="message-editor__count" aria-live="polite">
        {characterCount.toLocaleString('en-US')} / {MESSAGE_BODY_MAX_LENGTH.toLocaleString('en-US')}
      </div>
    </div>
  );
}

export default MessageRichTextEditor;
