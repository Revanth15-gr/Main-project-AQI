"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "./LoginForm.module.css";

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success">("error");
  const emailRef = useRef<HTMLInputElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const savedEmail = window.localStorage.getItem("airguardRememberedEmail");
      if (savedEmail && emailRef.current && rememberRef.current) {
        emailRef.current.value = savedEmail;
        rememberRef.current.checked = true;
      }
    } catch {
      // Remembered email is optional; private browsing may disable storage.
    }
  }, []);

  function rememberEmail() {
    try {
      if (rememberRef.current?.checked && emailRef.current?.value.trim()) {
        window.localStorage.setItem("airguardRememberedEmail", emailRef.current.value.trim());
      } else {
        window.localStorage.removeItem("airguardRememberedEmail");
      }
    } catch {
      // Do not block sign-in when browser storage is unavailable.
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessageType("error");
    setMessage("Secure sign-in is not connected yet. Use the demo dashboard or configure Better Auth and Supabase first.");
  }

  return (
    <section className={styles.card} aria-labelledby="login-title">
      <div className={styles.mobileBrand} aria-hidden="true">🌿 AIRGUARD</div>
      <span className={styles.eyebrow}>WELCOME BACK</span>
      <h2 id="login-title">Sign in to AirGuard</h2>
      <p className={styles.intro}>Your air-quality overview is one step away.</p>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field} htmlFor="email">
          <span>Email address</span>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" ref={emailRef} onChange={rememberEmail} required />
        </label>
        <label className={styles.field} htmlFor="password">
          <span>Password</span>
          <span className={styles.passwordRow}>
            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required />
            <button className={styles.iconButton} type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>◉</button>
          </span>
        </label>
        <div className={styles.between}>
          <label className={styles.remember}><input type="checkbox" name="rememberMe" ref={rememberRef} onChange={rememberEmail} /> Remember me</label>
          <button className={styles.forgot} type="button" onClick={() => setMessage("Password recovery requires a configured authentication backend.")}>Forgot password?</button>
        </div>
        <button className={`${styles.button} ${styles.primary}`} type="submit">Sign in <span aria-hidden="true">→</span></button>
        <p className={`${styles.message} ${message ? styles[messageType] : ""}`} role="status" aria-live="polite">{message}</p>
      </form>

      <div className={styles.divider}><span />OR<span /></div>
      <Link className={`${styles.button} ${styles.secondary}`} href="/dashboard">Explore demo dashboard</Link>
      <p className={styles.foot}>New to AirGuard? <Link href="/register">Create an account</Link></p>
      <p className={styles.note}>Demo data only. Do not enter a real password until secure sign-in is configured.</p>
    </section>
  );
}
