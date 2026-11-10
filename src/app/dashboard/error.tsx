"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  retry
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="error-boundary" role="alert">
      <h2>页面加载出错</h2>
      <p>{error.message || "发生了意外错误，请重试。"}</p>
      <button className="button button-dark" onClick={() => retry()}>重试</button>
    </div>
  );
}
