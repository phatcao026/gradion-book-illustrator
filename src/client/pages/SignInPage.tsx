import { useState, type FormEvent } from 'react';

import { identityInputSchema, type SessionUser } from '../../shared/contracts';
import { signIn } from '../api';

interface SignInPageProps {
  onSignedIn: (user: SessionUser) => void;
}

export function SignInPage({ onSignedIn }: SignInPageProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = identityInputSchema.safeParse({ name, email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details.');
      return;
    }

    setSubmitting(true);
    try {
      onSignedIn(await signIn(parsed.data));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Sign in could not be completed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="sign-in-title">
        <div className="auth-mark" aria-hidden="true">G</div>
        <p className="eyebrow">Book Illustration Studio</p>
        <h1 id="sign-in-title">Start or resume your story</h1>
        <p className="lede">
          Enter your name and email. No password is required for this local assessment.
        </p>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <label>
            Full name
            <input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mira Hassan"
            />
          </label>
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="mira@example.com"
            />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button full-width" disabled={submitting} type="submit">
            {submitting ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  );
}
