import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ProjectSummary } from '../../shared/contracts';
import { listProjects } from '../api';

export function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void listProjects()
      .then((items) => {
        if (active) setProjects(items);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : 'Projects could not be loaded.');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="content-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>Projects</h1>
        </div>
        <Link className="primary-button" to="/projects/new">New project</Link>
      </div>

      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {projects === null && !error ? <div className="notice" role="status">Loading projects…</div> : null}
      {projects?.length === 0 ? (
        <section className="empty-state">
          <span className="empty-icon" aria-hidden="true">✦</span>
          <h2>No projects yet</h2>
          <p>Create your first project from pasted book text or a UTF-8 .txt file.</p>
          <Link className="secondary-button" to="/projects/new">Create a project</Link>
        </section>
      ) : null}
      {projects && projects.length > 0 ? (
        <div className="project-list">
          {projects.map((project) => (
            <Link className="project-row" key={project.id} to={`/projects/${project.id}`}>
              <div className="project-copy">
                <h2>{project.title}</h2>
                <p>Created {formatDate(project.createdAt)}</p>
              </div>
              <div className="progress" aria-label={`${project.completedSteps} of 5 steps complete`}>
                {[0, 1, 2, 3, 4].map((step) => (
                  <span className={step < project.completedSteps ? 'complete' : ''} key={step} />
                ))}
              </div>
              <span className="status-pill draft">Draft</span>
              <span className="row-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      ) : null}
    </main>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
