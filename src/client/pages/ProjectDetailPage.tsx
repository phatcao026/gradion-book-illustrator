import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { PipelineStepNumber, ProjectDetail } from '../../shared/contracts';
import {
  getProject,
  recoverPipelineAttempt,
  startPipelineStep,
} from '../api';
import { PipelinePanel } from '../components/PipelinePanel';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [starting, setStarting] = useState(false);

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

  useEffect(() => {
    if (!projectId || project?.pipeline.runState !== 'RUNNING') return;

    let active = true;
    let requestInFlight = false;
    const interval = window.setInterval(() => {
      if (requestInFlight) return;
      requestInFlight = true;
      void getProject(projectId)
        .then((item) => {
          if (active) setProject(item);
        })
        .catch((requestError: unknown) => {
          if (active) {
            setError(
              requestError instanceof Error
                ? requestError.message
                : 'Project progress could not be refreshed.',
            );
          }
        })
        .finally(() => {
          requestInFlight = false;
        });
    }, 1_500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectId, project?.pipeline.runState]);

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

  async function startStep(step: PipelineStepNumber) {
    if (!projectId || !project) return;

    setStarting(true);
    setError(null);
    try {
      const result = await startPipelineStep(
        projectId,
        step,
        step === 1 ? project.styleInput : '',
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
          : 'The pipeline step could not be started.',
      );
    } finally {
      setStarting(false);
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
            onStart={startStep}
            onStyleInputChange={(styleInput) =>
              setProject((current) =>
                current ? { ...current, styleInput } : current,
              )
            }
            pipeline={project.pipeline}
            recovering={recovering}
            starting={starting}
            styleInput={project.styleInput}
          />

          {project.style ? (
            <section className="result-panel" aria-labelledby="style-result-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {project.style.source === 'USER' ? 'Your art direction' : 'Gemini art direction'}
                  </p>
                  <h2 id="style-result-title">Art style</h2>
                </div>
              </div>
              <p className="result-copy">{project.style.text}</p>
            </section>
          ) : null}

          {project.pipeline.completedStep >= 4 ? (
            <section className="result-panel" aria-labelledby="chapters-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Selected book scene</p>
                  <h2 id="chapters-title">Chapter illustration</h2>
                </div>
                <span>{project.chapters.length} / 1</span>
              </div>
              <div className="chapter-grid">
                {project.chapters.map((chapter) => (
                  <article className="chapter-card" key={chapter.id}>
                    <IllustrationView
                      illustration={chapter.illustration}
                      name={chapter.name}
                    />
                    <div className="chapter-copy">
                      <h3>{chapter.name}</h3>
                      <p>{chapter.prompt}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {project.pipeline.completedStep >= 2 ? (
            <section className="result-panel" aria-labelledby="characters-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Adult characters</p>
                  <h2 id="characters-title">Character prompts</h2>
                </div>
                <span>{project.characters.length} / 2</span>
              </div>
              {project.characters.length === 0 ? (
                <div className="notice">No adult characters were found in this book.</div>
              ) : (
                <div className="character-grid">
                  {project.characters.map((character) => (
                    <article className="character-card" key={character.id}>
                      <PortraitView
                        name={character.name}
                        portrait={character.portrait}
                      />
                      <h3>{character.name}</h3>
                      <p>{character.prompt}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

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

function PortraitView({
  name,
  portrait,
}: {
  name: string;
  portrait: ProjectDetail['characters'][number]['portrait'];
}) {
  if (portrait?.status === 'COMPLETED' && portrait.imageUrl) {
    return <img alt={`Portrait of ${name}`} className="portrait-image" src={portrait.imageUrl} />;
  }
  if (portrait?.status === 'GENERATING') {
    return (
      <div className="portrait-placeholder generating" role="status">
        Generating portrait for {name}…
      </div>
    );
  }
  if (portrait?.status === 'QUEUED') {
    return <div className="portrait-placeholder queued">Portrait queued</div>;
  }
  if (portrait?.status === 'FAILED') {
    return (
      <div className="portrait-placeholder failed">
        <span>Portrait failed</span>
        <small>{portrait.error?.message ?? 'Retry the Portraits step.'}</small>
      </div>
    );
  }
  return <div className="portrait-placeholder">Portrait not generated</div>;
}

function IllustrationView({
  name,
  illustration,
}: {
  name: string;
  illustration: ProjectDetail['chapters'][number]['illustration'];
}) {
  if (illustration?.status === 'COMPLETED' && illustration.imageUrl) {
    return (
      <img
        alt={`Illustration for ${name}`}
        className="illustration-image"
        src={illustration.imageUrl}
      />
    );
  }
  if (illustration?.status === 'GENERATING') {
    return (
      <div className="illustration-placeholder generating" role="status">
        Generating chapter illustration…
      </div>
    );
  }
  if (illustration?.status === 'QUEUED') {
    return <div className="illustration-placeholder queued">Illustration queued</div>;
  }
  if (illustration?.status === 'FAILED') {
    return (
      <div className="illustration-placeholder failed">
        <span>Illustration failed</span>
        <small>{illustration.error?.message ?? 'Retry the Illustrations step.'}</small>
      </div>
    );
  }
  return <div className="illustration-placeholder">Illustration not generated</div>;
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
