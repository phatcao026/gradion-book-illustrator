import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { ProjectDetail } from '../../shared/contracts';
import { getProject, recoverPipelineAttempt } from '../api';
import { PipelinePanel } from '../components/PipelinePanel';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

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

  async function recoverAttempt() {
    if (
      !projectId ||
      !project?.pipeline.attemptId ||
      !project.pipeline.startedAt
    ) {
      return;
    }

    setRecovering(true);
    setError(null);
    try {
      const result = await recoverPipelineAttempt(
        projectId,
        project.pipeline.attemptId,
        project.pipeline.startedAt,
      );
      setProject((current) =>
        current
          ? {
              ...current,
              status: statusFromPipeline(result.pipeline),
              pipeline: result.pipeline,
            }
          : current,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The interrupted attempt could not be recovered.',
      );
    } finally {
      setRecovering(false);
    }
  }

  return (
    <main className="content-page">
      <Link className="back-link" to="/projects">← Back to projects</Link>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      {!project && !error ? <div className="notice" role="status">Loading project…</div> : null}
      {project ? (
        <>
          <div className="detail-heading">
            <div>
              <span className={`status-pill ${project.status.toLowerCase()}`}>
                {statusLabel(project.status)}
              </span>
              <h1>{project.title}</h1>
              <p>Created {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(project.createdAt))}</p>
            </div>
          </div>

          <PipelinePanel
            onRecover={project.pipeline.isStale ? recoverAttempt : undefined}
            pipeline={project.pipeline}
            recovering={recovering}
          />

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

function statusLabel(status: ProjectDetail['status']): string {
  if (status === 'IN_PROGRESS') return 'In progress';
  if (status === 'DONE') return 'Done';
  return 'Draft';
}

function statusFromPipeline(
  pipeline: ProjectDetail['pipeline'],
): ProjectDetail['status'] {
  if (pipeline.completedStep === 5) return 'DONE';
  if (pipeline.completedStep === 0 && pipeline.runState === 'IDLE') return 'DRAFT';
  return 'IN_PROGRESS';
}
