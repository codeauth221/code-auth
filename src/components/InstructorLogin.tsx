import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ScanSearch,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Instructor } from '../types';
import { loginInstructor, registerInstructor } from '../utils/api';
import heroHall from '../assets/HB.png';

interface InstructorLoginProps {
  onLogin: (instructor: Instructor, token: string) => void;
}

export const InstructorLogin: React.FC<InstructorLoginProps> = ({ onLogin }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectMode = (register: boolean) => {
    if (isSubmitting || register === isRegistering) return;
    setIsRegistering(register);
    setError(null);
    setShowPassword(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    let accountCreated = false;

    try {
      if (isRegistering) {
        await registerInstructor(name.trim(), email.trim(), password);
        accountCreated = true;
        // Registration remains immediately usable; preserve the existing auto-sign-in flow.
      }
      const token = await loginInstructor(email.trim(), password);
      const cleanEmail = email.trim().toLowerCase();
      onLogin({
        idNumber: cleanEmail,
        email: cleanEmail,
        name: name.trim() || cleanEmail.split('@')[0],
      }, token);
    } catch (requestError) {
      if (accountCreated) setIsRegistering(false);
      const detail = requestError instanceof Error ? requestError.message : 'Please try again.';
      setError(accountCreated
        ? `Account created successfully, but automatic sign-in failed. Sign in with your new credentials. ${detail}`
        : detail);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="ca-hero ca-hero--login ca-auth" aria-label="Instructor account access">
      <img src={heroHall} alt="" aria-hidden="true" className="ca-hero__media" decoding="async" />
      <div className="ca-hero__scrim" aria-hidden="true" />

      <div className="ca-hero__content ca-auth__content">
        <div className="ca-auth__layout">
          <div className="ca-auth__story ca-fade-up">
            <div className="ca-home-kicker"><span className="ca-home-kicker__dot" /> THE INSTRUCTOR WORKSPACE</div>
            <h1 className="ca-auth__story-heading font-display">Your classroom. <span>Your command center.</span></h1>
            <p className="ca-auth__story-description">
              Create exam lobbies, organize student submissions, and review AI-assisted
              risk information from one dedicated workspace.
            </p>
            <div className="ca-auth__highlights">
              <div><span><LockKeyhole size={18} aria-hidden="true" /></span><p><strong>Faculty workspace</strong><small>Manage your own exam lobbies</small></p></div>
              <div><span><ScanSearch size={18} aria-hidden="true" /></span><p><strong>Structured code review</strong><small>Keep submitted work in view</small></p></div>
              <div><span><ShieldCheck size={18} aria-hidden="true" /></span><p><strong>Informed decisions</strong><small>AI scores support manual evaluation</small></p></div>
            </div>
            <p className="ca-auth__story-foot"><CheckCircle2 size={15} aria-hidden="true" /> CODEAUTHENTIC · CCIS</p>
          </div>

          <div className="ca-auth__card ca-fade-up">
            <div className="ca-auth__card-top">
              <div className="ca-auth__card-mark"><KeyRound size={23} aria-hidden="true" /></div>
              <span>FACULTY ACCESS</span>
            </div>

            <h2 className="ca-auth__card-heading font-display">
              {isRegistering ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="ca-auth__card-description">
              {isRegistering
                ? 'Create an instructor account to start managing your laboratory exams.'
                : 'Sign in to continue to your instructor dashboard.'}
            </p>

            <div className="ca-auth__switch" aria-label="Instructor account mode">
              <button
                type="button"
                className={!isRegistering ? 'is-active' : ''}
                onClick={() => selectMode(false)}
                aria-pressed={!isRegistering}
                disabled={isSubmitting}
              >Sign in</button>
              <button
                type="button"
                className={isRegistering ? 'is-active' : ''}
                onClick={() => selectMode(true)}
                aria-pressed={isRegistering}
                disabled={isSubmitting}
              >Create account</button>
            </div>

            {error && (
              <div className="ca-auth__error" role="alert">
                <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="ca-auth__form">
              {isRegistering && (
                <div className="ca-auth__field">
                  <label htmlFor="ca-instructor-name">Full name</label>
                  <div className="ca-auth__input-wrap">
                    <UserRound size={18} aria-hidden="true" />
                    <input
                      id="ca-instructor-name"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      minLength={2}
                      maxLength={100}
                      autoComplete="name"
                      placeholder="Your full name"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              )}

              <div className="ca-auth__field">
                <label htmlFor="ca-instructor-email">Faculty email</label>
                <div className="ca-auth__input-wrap">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    id="ca-instructor-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@university.edu"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="ca-auth__field">
                <label htmlFor="ca-instructor-password">Password</label>
                <div className="ca-auth__input-wrap">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    id="ca-instructor-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={isRegistering ? 6 : undefined}
                    maxLength={100}
                    autoComplete={isRegistering ? 'new-password' : 'current-password'}
                    placeholder={isRegistering ? 'At least 6 characters' : 'Enter your password'}
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="ca-auth__password-toggle"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    disabled={isSubmitting}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={isSubmitting} className="ca-btn-primary ca-auth__submit">
                <span>{isSubmitting ? 'Please wait…' : isRegistering ? 'Create instructor account' : 'Sign in to dashboard'}</span>
                {isSubmitting ? <span className="ca-auth__spinner" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
              </button>
            </form>

            <div className="ca-auth__bottom">
              <span>{isRegistering ? 'Already have an account?' : 'New to CodeAuthentic?'}</span>
              <button type="button" onClick={() => selectMode(!isRegistering)} disabled={isSubmitting}>
                {isRegistering ? 'Sign in' : 'Create an account'}
              </button>
            </div>
            <p className="ca-auth__privacy"><ShieldCheck size={14} aria-hidden="true" /> AI-assisted results are for instructor review only.</p>
          </div>
        </div>
      </div>
    </section>
  );
};
