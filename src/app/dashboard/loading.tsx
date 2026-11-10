export default function Loading() {
  return (
    <div className="loading-skeleton" role="status" aria-label="加载中">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-gauge" />
      <div className="skeleton skeleton-table" />
    </div>
  );
}
