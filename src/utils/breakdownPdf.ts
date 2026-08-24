export type BreakdownPdfOrientation = 'portrait' | 'landscape';

const LETTER_MARGIN_POINTS = 0.4 * 72;

const getBreakdownPages = (root: HTMLElement): HTMLElement[] => {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('.export-breakdown-page'));
  if (!pages.length) {
    throw new Error('No breakdown pages available for export.');
  }
  return pages;
};

const createBreakdownPdf = async (
  root: HTMLElement,
  orientation: BreakdownPdfOrientation
) => {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const pages = getBreakdownPages(root);
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'letter' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = orientation === 'landscape' ? LETTER_MARGIN_POINTS : 0;
  const imageWidth = pageWidth - (margin * 2);
  const imageHeight = pageHeight - (margin * 2);

  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await html2canvas(pages[index], {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });
    if (index > 0) {
      pdf.addPage('letter', orientation);
    }
    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.94),
      'JPEG',
      margin,
      margin,
      imageWidth,
      imageHeight,
      undefined,
      'FAST'
    );
  }

  return pdf;
};

export const buildBreakdownPdfBytes = async (
  root: HTMLElement,
  orientation: BreakdownPdfOrientation
): Promise<Uint8Array> => {
  const pdf = await createBreakdownPdf(root, orientation);
  return new Uint8Array(pdf.output('arraybuffer'));
};

export const downloadBreakdownPdf = async (
  root: HTMLElement,
  filename: string,
  orientation: BreakdownPdfOrientation
): Promise<void> => {
  const pdf = await createBreakdownPdf(root, orientation);
  pdf.save(filename);
};
