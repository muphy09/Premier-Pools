import { getMessageDocumentHtml, type MessageDocument } from '../utils/messageRichText';
import './MessageUi.css';

function MessageBody({ document, plainText }: { document: MessageDocument; plainText: string }) {
  return (
    <div
      className="message-body"
      dangerouslySetInnerHTML={{ __html: getMessageDocumentHtml(document, plainText) }}
    />
  );
}

export default MessageBody;
