import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-page">
      <section className="auth-manifest nf" aria-label="页面不存在">
        <p className="nf-code" aria-hidden="true">404</p>
        <h1 className="nf-title">单页缺失</h1>
        <p className="nf-desc">这一页不存在，或已被移动到其他章节。</p>
        <Link className="button nf-back" href="/dashboard">返回录入行程</Link>
      </section>
    </main>
  );
}
