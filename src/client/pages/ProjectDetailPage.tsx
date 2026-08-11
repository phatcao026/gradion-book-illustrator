import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { ProjectDetail } from '../../shared/contracts';
import { getProject } from '../api';

const STEPS = ['Style', 'Characters', 'Portraits', 'Chapters', 'Illustrations'];

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!projectId) {
      setError('Project was not found.');
      return;
    }

    void getProject(projectId)
      .then((item) => {
        if (active) setProject(item);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Project could not be loaded.');
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  return (
    <main className="content-page">
      <Link className="back-link" to="/projects">← Back to projects</Link>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {!project && !error ? <div className="notice" role="status">Loading project…</div> : null}
      {project ? (
        <>
          <div className="detail-heading">
            <div>
              <span className="status-pill draft">Draft</span>
              <h1>{project.title}</h1>
              <p>Created {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(project.createdAt))}</p>
            </div>
          </div>

          <ol className="step-preview" aria-label="Illustration progress">
            {STEPS.map((step, index) => (
              <li className={index === 0 ? 'current' : ''} key={step}>
                <span>{index + 1}</span>{step}
              </li>
            ))}
          </ol>

          <section className="book-panel" aria-labelledby="book-text-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Source material</p>
                <h2 id="book-text-title">Full book text</h2>
              </div>
              <span>{project.bookText.length.toLocaleString()} characters</span>
            </div>
            <pre>{project.bookText}</pre>
          </section>
        </>
      ) : null}
    </main>
  );
}
