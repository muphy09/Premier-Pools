import React from 'react';
import ReactDOM from 'react-dom/client';
import { CogsReportDocument, type CogsReportCategory } from '../../src/components/CogsReport';
import type { CostLineItem } from '../../src/types/proposal-new';
import { downloadBreakdownPdf } from '../../src/utils/breakdownPdf';
import '../../src/index.css';

const categoryLineCounts: Array<[string, number]> = [
  ['Plans & Engineering', 3],
  ['Layout', 3],
  ['Permit', 3],
  ['Excavation', 10],
  ['Plumbing', 16],
  ['Gas', 2],
  ['Steel', 10],
  ['Electrical', 6],
  ['Shotcrete', 9],
  ['Tile', 5],
  ['Coping/Decking', 4],
  ['Stone/Rockwork', 9],
  ['Drainage', 1],
  ['Water Features', 2],
  ['Equipment Ordered', 12],
  ['Equipment Set', 2],
  ['Cleanup', 5],
  ['Interior Finish', 5],
  ['Water Truck', 1],
  ['Startup/Orientation', 3],
  ['Custom Features', 2],
];

const createItems = (category: string, count: number, categoryIndex: number): CostLineItem[] =>
  Array.from({ length: count }, (_, itemIndex) => {
    const quantity = itemIndex % 4 === 0 ? 2 : 1;
    const unitPrice = 75 + (categoryIndex * 11) + (itemIndex * 7.5);
    return {
      category,
      description: `${category} detail line ${itemIndex + 1}${itemIndex === count - 1 && count > 10 ? ' with a longer descriptive label' : ''}`,
      quantity,
      unitPrice,
      total: quantity * unitPrice,
    };
  });

const categories: CogsReportCategory[] = categoryLineCounts.map(([name, count], categoryIndex) => {
  if (name === 'Custom Features') {
    return {
      name,
      items: [
        {
          category: name,
          description: 'Custom feature cost',
          quantity: 1,
          unitPrice: 800,
          total: 800,
        },
        {
          category: name,
          description: 'Retail-only price credit',
          quantity: 1,
          unitPrice: -250,
          total: -250,
        },
      ],
    };
  }

  const items = createItems(name, count, categoryIndex);
  const categoriesWithLaborAndMaterial = new Set(['Shotcrete', 'Tile', 'Coping/Decking', 'Stone/Rockwork']);
  if (!categoriesWithLaborAndMaterial.has(name)) return { name, items };

  const splitIndex = Math.ceil(items.length / 2);
  const labor = items.slice(0, splitIndex).map((item) => ({
    ...item,
    details: { ...item.details, subcategory: 'Labor' },
  }));
  const material = items.slice(splitIndex).map((item) => ({
    ...item,
    details: { ...item.details, subcategory: 'Material' },
  }));
  return {
    name,
    items: [...labor, ...material],
    subcategories: [
      { name: 'Labor', items: labor },
      { name: 'Material', items: material },
    ],
    hideBaseItems: true,
  };
});

const baseTotal = categories.reduce(
  (categorySum, category) => categorySum + category.items.reduce(
    (itemSum, item) => itemSum + (category.name === 'Custom Features' && item.total < 0 ? 0 : item.total),
    0
  ),
  0
);
const totalCogs = Math.round(baseTotal * 1.01 * 100) / 100;
const mode = new URLSearchParams(window.location.search).get('mode') === 'export' ? 'export' : 'viewer';

(window as Window & { downloadCogsFixturePdf?: () => Promise<void> }).downloadCogsFixturePdf = async () => {
  const root = document.querySelector<HTMLElement>('.cogs-report-test-fixture');
  if (!root) throw new Error('COGS fixture is not mounted.');
  await downloadBreakdownPdf(root, 'cogs-report-landscape.pdf', 'landscape');
};

function CogsReportFixture() {
  return (
    <main className={`cogs-report-test-fixture cogs-report-test-fixture--${mode}`}>
      <div className={mode === 'viewer' ? 'cogs-report-modal' : undefined}>
        <CogsReportDocument
          categories={categories}
          customerName="Playwright Customer"
          reportDate="2026-08-24T12:00:00.000Z"
          totalValue={totalCogs}
          overheadRate={0.01}
          mode={mode}
        />
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CogsReportFixture />
  </React.StrictMode>
);
