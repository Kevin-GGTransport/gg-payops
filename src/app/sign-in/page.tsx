import { authenticate } from "@/app/actions";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-manifest" aria-label="值班登录">
        <header className="auth-head">
          <span className="auth-mark" aria-hidden="true">G&amp;G</span>
          <div className="auth-title">
            <h1>G&amp;G PayOps</h1>
            <p>运输结算中心</p>
          </div>
          <span className="auth-form" aria-hidden="true">GG·SIGN</span>
        </header>

        <div className="auth-body">
          {error ? (
            <p className="error" role="alert">
              {error === "missing"
                ? "请输入用户名和密码。"
                : error === "invalid"
                  ? "用户名或密码不正确。"
                  : "登录失败，请稍后重试。"}
            </p>
          ) : null}

          <form action={authenticate}>
            <div className="field">
              <label htmlFor="email">用户名 / 邮箱</label>
              <input id="email" name="email" type="text" autoComplete="username" required />
            </div>
            <div className="field">
              <label htmlFor="password">密码</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <button className="button" type="submit">登录</button>
          </form>
        </div>

        <footer className="auth-foot">
          <span>核算周期 · 周六 ~ 周五</span>
          <span className="mono">DEL · LIVE · EMPTY · BOBTAIL</span>
        </footer>
      </section>
    </main>
  );
}
