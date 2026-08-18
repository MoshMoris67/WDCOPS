import React from 'react';

interface ResponsiveListProps<T> {
  items: T[];
  keyFor: (item: T) => string;
  renderTableHead: () => React.ReactNode;
  renderTableRow: (item: T) => React.ReactNode;
  renderCard: (item: T) => React.ReactNode;
  emptyState?: React.ReactNode;
  isLoading?: boolean;
  /** 'auto' (default) = table at md:+ width, stacked cards below it — the ordinary
   * mobile reflow. 'table'/'deck' force one renderer at every width, for a manual
   * view-mode toggle built on top of the same renderers. */
  viewMode?: 'auto' | 'table' | 'deck';
  /** Grid density when viewMode='deck', e.g. 'md:grid-cols-2 xl:grid-cols-3'. */
  deckColumns?: string;
  tableClassName?: string;
}

export default function ResponsiveList<T>({
  items,
  keyFor,
  renderTableHead,
  renderTableRow,
  renderCard,
  emptyState,
  isLoading,
  viewMode = 'auto',
  deckColumns = 'sm:grid-cols-2',
  tableClassName = '',
}: ResponsiveListProps<T>) {
  const showTable = viewMode === 'table' || viewMode === 'auto';
  const showCards = viewMode === 'deck' || viewMode === 'auto';
  const tableWrapperClass = viewMode === 'auto' ? 'hidden md:block' : viewMode === 'table' ? 'block' : 'hidden';
  const cardsWrapperClass = viewMode === 'auto' ? 'md:hidden' : viewMode === 'deck' ? 'block' : 'hidden';

  if (!isLoading && items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {showTable && (
        <div className={`overflow-x-auto scrollbar-thin ${tableWrapperClass}`}>
          <table className={`w-full text-table-cell ${tableClassName}`}>
            <thead>{renderTableHead()}</thead>
            <tbody>{items.map((item) => <React.Fragment key={keyFor(item)}>{renderTableRow(item)}</React.Fragment>)}</tbody>
          </table>
        </div>
      )}
      {showCards && (
        <div className={`grid grid-cols-1 ${deckColumns} gap-3 ${cardsWrapperClass}`}>
          {items.map((item) => <React.Fragment key={keyFor(item)}>{renderCard(item)}</React.Fragment>)}
        </div>
      )}
    </>
  );
}
