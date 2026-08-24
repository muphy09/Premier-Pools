import { useEffect, useMemo, useState } from 'react';
import type { CostLineItem } from '../types/proposal-new';
import type { CostBreakdownSubcategory } from '../utils/costBreakdownSubcategories';
import { hasLineItemSubcategory } from '../utils/costBreakdownSubcategories';
import { isOffContractLineItem } from '../utils/offContractLineItems';
import FranchiseLogo from './FranchiseLogo';
import './CogsReport.css';

export interface CogsReportCategory {
  name: string;
  items: CostLineItem[];
  subcategories?: CostBreakdownSubcategory[];
  hideBaseItems?: boolean;
}

export interface CogsReportDocumentProps {
  categories: CogsReportCategory[];
  customerName: string;
  franchiseId?: string;
  reportDate?: string | null;
  totalValue: number;
  overheadRate?: number;
  mode: 'viewer' | 'export';
}

interface NormalizedCogsCategory extends CogsReportCategory {
  total: number;
  lineCount: number;
  isOverhead?: boolean;
}

type CogsDetailRow =
  | {
      key: string;
      kind: 'category';
      label: string;
      total: number;
      continued?: boolean;
      weight: number;
    }
  | {
      key: string;
      kind: 'subcategory';
      label: string;
      total: number;
      continued?: boolean;
      weight: number;
    }
  | {
      key: string;
      kind: 'item';
      item: CostLineItem;
      quantityLabel?: string;
      hideUnitCost?: boolean;
      weight: number;
    };

interface CogsDetailPage {
  kind: 'detail';
  columns: [CogsDetailRow[], CogsDetailRow[]];
  compact: boolean;
}

interface CogsSummaryPage {
  kind: 'summary';
}

type CogsReportPage = CogsSummaryPage | CogsDetailPage;

const DETAIL_COLUMN_CAPACITY = 27;
const CATEGORY_ROW_WEIGHT = 1.55;
const SUBCATEGORY_ROW_WEIGHT = 1.15;

const roundToTwo = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const formatCurrency = (value: number): string =>
  `$${(Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatReportDate = (value?: string | null): string => {
  const parsed = new Date(value || Date.now());
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return safeDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const categoryTotal = (items: CostLineItem[] = []): number =>
  roundToTwo(items.reduce((sum, item) => sum + (item.total ?? 0), 0));

const isReportableCogsItem = (categoryName: string, item: CostLineItem): boolean => {
  if (isOffContractLineItem(item)) return false;
  // Negative custom-feature entries are retail-only adjustments in the pricing engine.
  return categoryName !== 'Custom Features' || (item.total ?? 0) >= 0;
};

const itemWeight = (item: CostLineItem): number => {
  const descriptionLength = (item.description || '').trim().length;
  return 1 + Math.max(0, Math.ceil(descriptionLength / 42) - 1) * 0.55;
};

const normalizeCategories = (
  input: CogsReportCategory[],
  totalValue: number,
  overheadRate: number
): NormalizedCogsCategory[] => {
  const categories: NormalizedCogsCategory[] = input
    .map((category) => {
      const items = (category.items || []).filter((item) => isReportableCogsItem(category.name, item));
      const subcategories = category.subcategories
        ?.map((subcategory) => ({
          ...subcategory,
          items: (subcategory.items || []).filter((item) => isReportableCogsItem(category.name, item)),
        }))
        .filter((subcategory) => subcategory.items.length > 0);
      const baseItems = subcategories?.length
        ? items.filter((item) => !hasLineItemSubcategory(item))
        : items;
      const lineCount = baseItems.length + (subcategories?.reduce((sum, subcategory) => sum + subcategory.items.length, 0) || 0);

      return {
        ...category,
        items,
        subcategories,
        total: categoryTotal(items),
        lineCount,
      };
    })
    .filter((category) => category.lineCount > 0);

  const baseTotal = roundToTwo(categories.reduce((sum, category) => sum + category.total, 0));
  const overheadAmount = roundToTwo(totalValue - baseTotal);
  const overheadPercent = Math.max(0, overheadRate * 100);

  if (Math.abs(overheadAmount) >= 0.005 || overheadPercent > 0) {
    const overheadItem: CostLineItem = {
      category: 'COGS Overhead',
      description: 'COGS Overhead',
      quantity: overheadPercent,
      unitPrice: 0,
      total: overheadAmount,
    };
    categories.push({
      name: 'COGS Overhead',
      items: [overheadItem],
      total: overheadAmount,
      lineCount: 1,
      isOverhead: true,
    });
  }

  return categories;
};

const buildCategoryContentRows = (category: NormalizedCogsCategory): CogsDetailRow[] => {
  if (category.isOverhead) {
    const item = category.items[0];
    return [{
      key: 'cogs-overhead-item',
      kind: 'item',
      item,
      quantityLabel: `${item.quantity?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '0'}%`,
      hideUnitCost: true,
      weight: 1,
    }];
  }

  const rows: CogsDetailRow[] = [];
  const baseItems = category.subcategories?.length
    ? category.items.filter((item) => !hasLineItemSubcategory(item))
    : category.items;

  if (!category.hideBaseItems) {
    baseItems.forEach((item, index) => {
      rows.push({
        key: `${category.name}-base-${index}`,
        kind: 'item',
        item,
        weight: itemWeight(item),
      });
    });
  }

  category.subcategories?.forEach((subcategory, subcategoryIndex) => {
    rows.push({
      key: `${category.name}-subcategory-${subcategoryIndex}`,
      kind: 'subcategory',
      label: subcategory.name,
      total: categoryTotal(subcategory.items),
      weight: SUBCATEGORY_ROW_WEIGHT,
    });
    subcategory.items.forEach((item, itemIndex) => {
      rows.push({
        key: `${category.name}-subcategory-${subcategoryIndex}-item-${itemIndex}`,
        kind: 'item',
        item,
        weight: itemWeight(item),
      });
    });
  });

  return rows;
};

const rowsWeight = (rows: CogsDetailRow[]): number =>
  rows.reduce((sum, row) => sum + row.weight, 0);

const buildDetailPages = (categories: NormalizedCogsCategory[]): CogsDetailPage[] => {
  const categoryContents = categories.map((category) => ({
    category,
    rows: buildCategoryContentRows(category),
  }));
  const baseWeight = categoryContents.reduce(
    (sum, entry) => sum + CATEGORY_ROW_WEIGHT + rowsWeight(entry.rows),
    0
  );
  const detailPageCount = Math.max(1, Math.ceil(baseWeight / (DETAIL_COLUMN_CAPACITY * 2)));
  const columnCount = detailPageCount * 2;
  const targetWeight = Math.min(
    DETAIL_COLUMN_CAPACITY,
    Math.max(5, (baseWeight / columnCount) + 1.75)
  );
  const columns = Array.from({ length: columnCount }, () => [] as CogsDetailRow[]);
  const columnWeights = Array.from({ length: columnCount }, () => 0);
  let columnIndex = 0;

  const advanceColumn = () => {
    if (columnIndex < columnCount - 1) columnIndex += 1;
  };

  categoryContents.forEach(({ category, rows }, categoryIndex) => {
    let rowIndex = 0;
    let continued = false;

    while (rowIndex < rows.length) {
      const firstRowWeight = rows[rowIndex]?.weight || 1;
      if (
        columns[columnIndex].length > 0 &&
        columnWeights[columnIndex] + CATEGORY_ROW_WEIGHT + firstRowWeight > targetWeight &&
        columnIndex < columnCount - 1
      ) {
        advanceColumn();
      }

      const categoryRow: CogsDetailRow = {
        key: `${category.name}-header-${categoryIndex}-${columnIndex}-${rowIndex}`,
        kind: 'category',
        label: category.name,
        total: category.total,
        continued,
        weight: CATEGORY_ROW_WEIGHT,
      };
      columns[columnIndex].push(categoryRow);
      columnWeights[columnIndex] += categoryRow.weight;
      let rowsInFragment = 0;
      let activeSubcategory: Extract<CogsDetailRow, { kind: 'subcategory' }> | null = null;

      while (rowIndex < rows.length) {
        const row = rows[rowIndex];
        const nextRow = rows[rowIndex + 1];
        const orphanBuffer = row.kind === 'subcategory' && nextRow ? nextRow.weight : 0;
        const shouldAdvance =
          rowsInFragment > 0 &&
          columnWeights[columnIndex] + row.weight + orphanBuffer > targetWeight &&
          columnIndex < columnCount - 1;

        if (shouldAdvance) {
          advanceColumn();
          continued = true;
          break;
        }

        columns[columnIndex].push(row);
        columnWeights[columnIndex] += row.weight;
        rowsInFragment += 1;
        rowIndex += 1;

        if (row.kind === 'subcategory') {
          activeSubcategory = row;
        }
      }

      if (rowIndex < rows.length && activeSubcategory && rows[rowIndex].kind === 'item') {
        const repeatedSubcategory: CogsDetailRow = {
          ...activeSubcategory,
          key: `${activeSubcategory.key}-continued-${columnIndex}`,
          continued: true,
        };
        rows.splice(rowIndex, 0, repeatedSubcategory);
      }
    }
  });

  return Array.from({ length: detailPageCount }, (_, pageIndex) => {
    const left = columns[pageIndex * 2] || [];
    const right = columns[(pageIndex * 2) + 1] || [];
    return {
      kind: 'detail' as const,
      columns: [left, right],
      compact: Math.max(rowsWeight(left), rowsWeight(right)) > 28,
    };
  });
};

const isTaxLineItem = (item: CostLineItem): boolean =>
  (item.description || '').toLowerCase().includes('tax');

const renderQuantity = (row: Extract<CogsDetailRow, { kind: 'item' }>): string => {
  if (row.quantityLabel !== undefined) return row.quantityLabel;
  if (isTaxLineItem(row.item)) return '';
  return (row.item.quantity ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const renderUnitCost = (row: Extract<CogsDetailRow, { kind: 'item' }>): string => {
  if (row.hideUnitCost || isTaxLineItem(row.item)) return '';
  return formatCurrency(row.item.unitPrice);
};

function CogsReportHeader({
  kind,
  customerName,
  franchiseId,
  reportDate,
  totalValue,
}: {
  kind: CogsReportPage['kind'];
  customerName: string;
  franchiseId?: string;
  reportDate: string;
  totalValue: number;
}) {
  return (
    <header className={`cogs-report-header cogs-report-header--${kind}`}>
      <div className="cogs-report-heading">
        <p>COGS Cost Breakdown</p>
        <h2>{kind === 'summary' ? 'Cost of Goods Sold' : 'Detailed line-item breakdown'}</h2>
        <div className="cogs-report-meta">
          <span>{customerName || 'N/A'}</span>
          <span aria-hidden="true">|</span>
          <span>{reportDate}</span>
        </div>
      </div>
      <div className="cogs-report-total">
        <span>Total COGS</span>
        <strong>{formatCurrency(totalValue)}</strong>
      </div>
      {kind === 'summary' && (
        <div className="cogs-report-logo">
          <FranchiseLogo alt="Franchise Logo" franchiseId={franchiseId} />
        </div>
      )}
    </header>
  );
}

function CogsSummaryContent({
  categories,
  totalValue,
}: {
  categories: NormalizedCogsCategory[];
  totalValue: number;
}) {
  const rankedCategories = [...categories]
    .sort((left, right) => right.total - left.total)
    .map((category, index) => ({ category, rank: index + 1 }));
  const mixColumnSize = categories.length > 16
    ? Math.ceil(rankedCategories.length / 2)
    : rankedCategories.length;
  const mixColumns = Array.from(
    { length: categories.length > 16 ? 2 : 1 },
    (_, columnIndex) => rankedCategories.slice(
      columnIndex * mixColumnSize,
      (columnIndex + 1) * mixColumnSize
    )
  ).filter((column) => column.length > 0);

  return (
    <div
      className={`cogs-report-summary-grid${categories.length > 16 ? ' is-dense' : categories.length > 10 ? ' is-compact' : ''}`}
    >
      <section className="cogs-report-summary-section">
        <div className="cogs-report-section-heading">
          <h3>Category totals</h3>
          <p>Every COGS category and its subtotal</p>
        </div>
        <div className="cogs-report-summary-table" role="table" aria-label="COGS category totals">
          <div className="cogs-report-summary-table-head" role="row">
            <span role="columnheader">Category</span>
            <span role="columnheader">Lines</span>
            <span role="columnheader">Category total</span>
          </div>
          <div className="cogs-report-summary-table-body">
            {categories.map((category) => (
              <div className="cogs-report-summary-row" role="row" key={category.name}>
                <span role="cell">
                  <strong>{category.name}</strong>
                  <small>Included in total COGS</small>
                </span>
                <span role="cell">{category.lineCount}</span>
                <strong role="cell">{formatCurrency(category.total)}</strong>
              </div>
            ))}
          </div>
          <div className="cogs-report-summary-total">
            <span>Total COGS</span>
            <strong>{formatCurrency(totalValue)}</strong>
          </div>
        </div>
      </section>

      <section className="cogs-report-summary-section">
        <div className="cogs-report-section-heading">
          <h3>Category mix</h3>
          <p>Share of total COGS, ranked from largest to smallest</p>
        </div>
        <div className="cogs-report-mix-panel">
          <div className={`cogs-report-mix-list${mixColumns.length > 1 ? ' is-two-column' : ''}`}>
            {mixColumns.map((column, columnIndex) => (
              <div className="cogs-report-mix-column" key={`mix-column-${columnIndex}`}>
                {column.map(({ category, rank }) => {
                  const percent = totalValue > 0 ? Math.max(0, (category.total / totalValue) * 100) : 0;
                  return (
                    <div className="cogs-report-mix-row" key={category.name}>
                      <div className="cogs-report-mix-label">
                        <strong>{rank}. {category.name}</strong>
                        <span>{formatCurrency(category.total)}</span>
                      </div>
                      <div className="cogs-report-mix-bar-line">
                        <span className="cogs-report-mix-track">
                          <span
                            className={`cogs-report-mix-fill${rank === 1 ? ' is-leading' : ''}`}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </span>
                        <strong>{percent.toFixed(1)}%</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CogsDetailColumn({ rows }: { rows: CogsDetailRow[] }) {
  return (
    <div className="cogs-report-detail-column">
      <div className="cogs-report-detail-table-head">
        <span>Description</span>
        <span>Qty</span>
        <span>Unit cost</span>
        <span>Line total</span>
      </div>
      <div className="cogs-report-detail-table-body">
        {rows.map((row) => {
          if (row.kind === 'category') {
            return (
              <div className="cogs-report-detail-category-row" key={row.key}>
                <strong>{row.label}{row.continued ? ' (continued)' : ''}</strong>
                <strong>{formatCurrency(row.total)}</strong>
              </div>
            );
          }
          if (row.kind === 'subcategory') {
            return (
              <div className="cogs-report-detail-subcategory-row" key={row.key}>
                <strong>{row.label}{row.continued ? ' (continued)' : ''}</strong>
                <strong>{formatCurrency(row.total)}</strong>
              </div>
            );
          }
          return (
            <div className="cogs-report-detail-item-row" key={row.key}>
              <span>{row.item.description}</span>
              <span>{renderQuantity(row)}</span>
              <span>{renderUnitCost(row)}</span>
              <strong>{formatCurrency(row.item.total)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CogsReportPageView({
  page,
  pageIndex,
  pageCount,
  categories,
  customerName,
  franchiseId,
  reportDate,
  totalValue,
}: {
  page: CogsReportPage;
  pageIndex: number;
  pageCount: number;
  categories: NormalizedCogsCategory[];
  customerName: string;
  franchiseId?: string;
  reportDate: string;
  totalValue: number;
}) {
  return (
    <article
      className={`cogs-report-page cogs-report-page--${page.kind}${page.kind === 'detail' && page.compact ? ' is-compact' : ''}`}
      data-cogs-report-page={pageIndex + 1}
    >
      <CogsReportHeader
        kind={page.kind}
        customerName={customerName}
        franchiseId={franchiseId}
        reportDate={reportDate}
        totalValue={totalValue}
      />
      {page.kind === 'summary' ? (
        <CogsSummaryContent categories={categories} totalValue={totalValue} />
      ) : (
        <div className="cogs-report-detail-grid">
          <CogsDetailColumn rows={page.columns[0]} />
          <CogsDetailColumn rows={page.columns[1]} />
        </div>
      )}
      <footer className="cogs-report-page-footer">
        <span>{page.kind === 'summary' ? 'Category summary' : 'Detailed line-item breakdown'}&nbsp;&nbsp;|&nbsp;&nbsp;Amounts in USD</span>
        <strong>{pageIndex + 1} / {pageCount}</strong>
      </footer>
    </article>
  );
}

export function CogsReportDocument({
  categories: inputCategories,
  customerName,
  franchiseId,
  reportDate: reportDateValue,
  totalValue,
  overheadRate = 0.01,
  mode,
}: CogsReportDocumentProps) {
  const categories = useMemo(
    () => normalizeCategories(inputCategories, totalValue, overheadRate),
    [inputCategories, overheadRate, totalValue]
  );
  const pages = useMemo<CogsReportPage[]>(
    () => [{ kind: 'summary' }, ...buildDetailPages(categories)],
    [categories]
  );
  const reportDate = useMemo(() => formatReportDate(reportDateValue), [reportDateValue]);
  const [activePageIndex, setActivePageIndex] = useState(0);

  useEffect(() => {
    setActivePageIndex((current) => Math.min(current, pages.length - 1));
  }, [pages.length]);

  if (mode === 'export') {
    return (
      <>
        {pages.map((page, pageIndex) => (
          <div className="export-breakdown-page export-breakdown-page--cogs" key={`cogs-report-export-${pageIndex}`}>
            <CogsReportPageView
              page={page}
              pageIndex={pageIndex}
              pageCount={pages.length}
              categories={categories}
              customerName={customerName}
              franchiseId={franchiseId}
              reportDate={reportDate}
              totalValue={totalValue}
            />
          </div>
        ))}
      </>
    );
  }

  const activePage = pages[activePageIndex] || pages[0];
  return (
    <div className="cogs-report-viewer">
      <nav className="cogs-report-page-switch" role="tablist" aria-label="COGS report pages">
        {pages.map((page, pageIndex) => {
          const detailPageNumber = pageIndex;
          const label = page.kind === 'summary'
            ? 'Summary'
            : pages.length === 2
            ? 'Details'
            : `Details ${detailPageNumber}`;
          return (
            <button
              aria-controls="cogs-report-active-page"
              aria-selected={activePageIndex === pageIndex}
              className={activePageIndex === pageIndex ? 'is-active' : ''}
              key={`cogs-report-tab-${pageIndex}`}
              onClick={() => setActivePageIndex(pageIndex)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          );
        })}
      </nav>
      <div className="cogs-report-page-viewport" id="cogs-report-active-page" role="tabpanel">
        <CogsReportPageView
          page={activePage}
          pageIndex={activePageIndex}
          pageCount={pages.length}
          categories={categories}
          customerName={customerName}
          franchiseId={franchiseId}
          reportDate={reportDate}
          totalValue={totalValue}
        />
      </div>
    </div>
  );
}
