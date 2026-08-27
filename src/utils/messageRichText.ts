export const MESSAGE_SUBJECT_MAX_LENGTH = 120;
export const MESSAGE_BODY_MAX_LENGTH = 5000;

export type MessageDocument = {
  version: 1;
  html: string;
};

const ALLOWED_TAGS: Record<string, string> = {
  B: 'strong',
  STRONG: 'strong',
  I: 'em',
  EM: 'em',
  U: 'u',
  P: 'p',
  DIV: 'p',
  BR: 'br',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
};

const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH']);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeNode(node: Node, outputDocument: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return outputDocument.createTextNode(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  if (DROP_WITH_CONTENT.has(element.tagName)) return null;

  const allowedTag = ALLOWED_TAGS[element.tagName];
  if (!allowedTag) {
    const fragment = outputDocument.createDocumentFragment();
    Array.from(element.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(child, outputDocument);
      if (sanitizedChild) fragment.appendChild(sanitizedChild);
    });
    return fragment;
  }

  const sanitizedElement = outputDocument.createElement(allowedTag);
  Array.from(element.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeNode(child, outputDocument);
    if (sanitizedChild) sanitizedElement.appendChild(sanitizedChild);
  });
  return sanitizedElement;
}

export function sanitizeMessageHtml(value: unknown) {
  const html = typeof value === 'string' ? value : '';
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return escapeHtml(html);
  }

  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const source = parsed.body.firstElementChild;
  const container = document.createElement('div');
  if (!source) return '';

  Array.from(source.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeNode(child, document);
    if (sanitizedChild) container.appendChild(sanitizedChild);
  });

  return container.innerHTML
    .replace(/<p>(?:\s|&nbsp;|<br>)*<\/p>/gi, '')
    .trim();
}

function readPlainTextNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as Element;
  if (element.tagName === 'BR') return '\n';

  const content = Array.from(element.childNodes).map(readPlainTextNode).join('');
  if (element.tagName === 'LI') return `${content}\n`;
  if (element.tagName === 'P' || element.tagName === 'DIV') return `${content}\n`;
  return content;
}

export function extractMessagePlainText(value: unknown) {
  const safeHtml = sanitizeMessageHtml(value);
  if (typeof DOMParser === 'undefined') {
    return safeHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const parsed = new DOMParser().parseFromString(`<div>${safeHtml}</div>`, 'text/html');
  const source = parsed.body.firstElementChild;
  if (!source) return '';

  return Array.from(source.childNodes)
    .map(readPlainTextNode)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createMessageDocument(html: unknown): MessageDocument {
  return {
    version: 1,
    html: sanitizeMessageHtml(html),
  };
}

export function getMessageDocumentHtml(documentValue: unknown, plainText = '') {
  if (
    documentValue &&
    typeof documentValue === 'object' &&
    !Array.isArray(documentValue) &&
    (documentValue as { version?: unknown }).version === 1 &&
    typeof (documentValue as { html?: unknown }).html === 'string'
  ) {
    return sanitizeMessageHtml((documentValue as { html: string }).html);
  }

  return escapeHtml(String(plainText || '')).replace(/\r?\n/g, '<br>');
}
