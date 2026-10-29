import { EarthScene } from "@/components/EarthScene";
import { LoginForm } from "@/components/LoginForm";
import Link from "next/link";
import styles from "./login.module.css";

export default function HomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="AirGuard home">
          <span className={styles.brandMark} aria-hidden="true">🌿</span>
          <span className={styles.brandText}>
            <b>AIR<span>GUARD</span></b>
            <small>SMART AIR • SMART HEALTH</small>
          </span>
        </Link>
        <Link className={styles.createLink} href="/register">Create account <span aria-hidden="true">↗</span></Link>
      </header>

      <div className={styles.layout}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <EarthScene className={styles.earthWrap} />
          <p className={styles.eyebrow}>A CLEARER VIEW OF THE AIR AROUND YOU</p>
          <h1 id="hero-title">Breathe today.<br /><span>Live better tomorrow.</span></h1>
          <p className={styles.heroCopy}>Understand air quality, discover pollution trends, and make informed everyday choices.</p>
          <div className={styles.features} aria-label="AirGuard features">
            <span>✓ AQI insights</span><span>✓ Personalised guidance</span><span>✓ Forecast overview</span>
          </div>
        </section>
        <LoginForm />
      </div>
      <footer className={styles.footer}>© {new Date().getFullYear()} AirGuard · Every breath matters</footer>
      <p className={styles.textureCredit}>Earth imagery: NASA Visible Earth, Blue Marble.</p>
    </main>
  );
}
