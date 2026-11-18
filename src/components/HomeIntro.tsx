import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  ClipboardList,
  CloudUpload,
  GraduationCap,
  Layers3,
  ScanSearch,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import heroHall from '../assets/HB.png';

interface HomeIntroProps {
  onNavigateToStudent: () => void;
  onNavigateToInstructor: () => void;
  isInstructorLoggedIn: boolean;
}

const workflow = [
  {
    number: '01',
    label: 'Set up the exam',
    detail: 'Create an instructor-controlled lobby',
    icon: ClipboardList,
  },
  {
    number: '02',
    label: 'Collect submissions',
    detail: 'Students upload source code with their ID',
    icon: CloudUpload,
  },
  {
    number: '03',
    label: 'Review results',
    detail: 'Inspect submissions and available risk scores',
    icon: ScanSearch,
  },
];

const features = [
  {
    number: '01',
    icon: ClipboardList,
    eyebrow: 'FOR INSTRUCTORS',
    title: 'Create an exam lobby',
    detail:
      'Configure the course, section, programming language, and duration. Share a unique lobby code or link with your class.',
  },
  {
    number: '02',
    icon: GraduationCap,
    eyebrow: 'FOR STUDENTS',
    title: 'Submit without an account',
    detail:
      'Students enter a lobby code and their Student ID, then submit their source files. AI risk scores remain instructor-only.',
  },
  {
    number: '03',
    icon: Braces,
    eyebrow: 'SOURCE FILES',
    title: 'A focused submission flow',
    detail:
      'Up to three C, Java, or Python source files per student, with a 200 KB limit for each file.',
  },
  {
    number: '04',
    icon: ShieldCheck,
    eyebrow: 'HUMAN-LED REVIEW',
    title: 'Make informed decisions',
    detail:
      'Available classifiers categorize AI probability as Low (< 0.40), Medium (0.40–0.70), or High (≥ 0.70) to help guide manual review.',
  },
];

export const HomeIntro: React.FC<HomeIntroProps> = ({
  onNavigateToStudent,
  onNavigateToInstructor,
  isInstructorLoggedIn,
}) => (
  <div className="ca-home">
    <section className="ca-hero ca-home-hero" aria-labelledby="ca-home-heading">
      <img
        src={heroHall}
        alt=""
        aria-hidden="true"
        className="ca-hero__media"
        decoding="async"
      />
      <div className="ca-hero__scrim" aria-hidden="true" />

      <div className="ca-hero__content ca-home-hero__content">
        <div className="ca-home-hero__grid">
          <div className="ca-home-hero__intro ca-fade-up">
            <div className="ca-home-kicker">
              <span className="ca-home-kicker__dot" aria-hidden="true" />
              CCIS · CARAGA STATE UNIVERSITY
            </div>

            <h1 id="ca-home-heading" className="ca-home-headline font-display">
              A smarter way to <span>review code.</span>
              <small>Built for laboratory exams.</small>
            </h1>

            <p className="ca-home-description">
              CodeAuthentic helps instructors examine potentially AI-generated source
              code, manage timed exam lobbies, and review student submissions in one
              focused workspace.
            </p>

            <div className="ca-home-actions">
              <button type="button" className="ca-btn-primary ca-home-primary" onClick={onNavigateToInstructor}>
                {isInstructorLoggedIn ? 'Open Instructor Dashboard' : 'Instructor Sign In'}
                <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <button type="button" className="ca-btn-secondary ca-home-secondary" onClick={onNavigateToStudent}>
                <Terminal size={18} aria-hidden="true" />
                Student Portal
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="ca-home-assurances" aria-label="Platform highlights">
              <span><CheckCircle2 size={16} aria-hidden="true" /> Designed for supervised exams</span>
              <span><ShieldCheck size={16} aria-hidden="true" /> Instructor-led decisions</span>
            </div>
          </div>

          <aside className="ca-home-showcase ca-fade-up" aria-label="CodeAuthentic exam workflow preview">
            <div className="ca-home-showcase__top">
              <div className="ca-home-showcase__symbol"><Layers3 size={21} aria-hidden="true" /></div>
              <div>
                <span className="ca-home-showcase__eyebrow">HOW CODEAUTHENTIC WORKS</span>
                <h2>One connected workflow</h2>
              </div>
              <span className="ca-home-showcase__index">01 / 03</span>
            </div>

            <div className="ca-home-showcase__list">
              {workflow.map((step) => {
                const Icon = step.icon;
                return (
                  <div className="ca-home-showcase__step" key={step.number}>
                    <span className="ca-home-showcase__number">{step.number}</span>
                    <div className="ca-home-showcase__step-icon"><Icon size={18} aria-hidden="true" /></div>
                    <div className="ca-home-showcase__step-copy">
                      <strong>{step.label}</strong>
                      <p>{step.detail}</p>
                    </div>
                    <CheckCircle2 className="ca-home-showcase__check" size={17} aria-hidden="true" />
                  </div>
                );
              })}
            </div>

            <div className="ca-home-showcase__footer">
              <span>Designed around source files</span>
              <div className="ca-home-lang-tags" aria-label="Languages: C, Java, Python">
                <span>C</span><span>Java</span><span>Python</span>
              </div>
            </div>
          </aside>
        </div>

        <div className="ca-home-hero__bottom" aria-hidden="true">
          <span>BUILT FOR ACADEMIC INTEGRITY</span>
          <span className="ca-home-hero__bottom-rule" />
          <span>01 / CODEAUTHENTIC</span>
        </div>
      </div>
    </section>

    <section className="ca-home-process" aria-labelledby="ca-home-process-title">
      <div className="ca-home-process__heading">
        <div>
          <p className="ca-section-label"><span className="ca-section-label__dash" /> SIMPLE BY DESIGN</p>
          <h2 id="ca-home-process-title" className="font-display">From first upload to <span>final review.</span></h2>
        </div>
        <p>A clear, structured experience for both instructors and students, with no unnecessary steps.</p>
      </div>

      <div className="ca-home-feature-grid">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <article className="ca-home-feature-card" key={feature.number}>
              <div className="ca-home-feature-card__top">
                <div className="ca-home-feature-card__icon"><Icon size={21} strokeWidth={1.9} aria-hidden="true" /></div>
                <span>{feature.number} / 04</span>
              </div>
              <p className="ca-home-feature-card__eyebrow">{feature.eyebrow}</p>
              <h3 className="font-display">{feature.title}</h3>
              <p className="ca-home-feature-card__detail">{feature.detail}</p>
            </article>
          );
        })}
      </div>

      <div className="ca-home-disclaimer" role="note">
        <div className="ca-home-disclaimer__icon"><ShieldCheck size={22} aria-hidden="true" /></div>
        <div>
          <strong>Technology supports judgment. It does not replace it.</strong>
          <p>
            AI risk probabilities are indicators for instructor-led review, not proof of academic
            dishonesty. Source code is handled as plain text and is never executed or compiled.
          </p>
        </div>
      </div>
    </section>
  </div>
);
